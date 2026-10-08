from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Barrier, Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection, connections, IntegrityError, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest, EmcReference, EmcReferenceRow, EmcReferenceTest, EmcReferenceCell

CELL = 'emc_change_001/emc_test_001'


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class EmcFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user('emc-owner', password='test-password')
        cls.other = get_user_model().objects.create_user('emc-other')
        cls.admin = get_user_model().objects.create_superuser('emc-admin', password='test-password')

    def setUp(self):
        self.change = ChangeRequest.objects.create(applicant=self.user)
        self.path = f'/api/changes/{self.change.pk}/emc/'
        self.client = APIClient(enforce_csrf_checks=True)
        token = self.client.get('/api/auth/csrf/').json()['csrfToken']
        response = self.client.post('/api/auth/login/', {'username': self.user.username, 'password': 'test-password'}, format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.client.credentials(HTTP_X_CSRFTOKEN=response.json()['csrfToken'], HTTP_X_EXPECTED_USER=str(self.user.pk))

    def write(self, values):
        return self.client.patch(self.path, values, format='json')

    def test_read_and_empty_writes_do_not_initialize_or_change_application(self):
        before = self.change.updated_at
        for _ in range(2):
            response = self.client.get(self.path)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual((len(data['rows']), len(data['tests']), data['cells'], data['initialized']), (12, 11, {}, False))
            self.assertEqual(data['can_fill'], True)
        for values in [{}, {'cells': {}}, {'cells': {CELL: {'mark': '', 'remark': ''}}}]:
            self.assertEqual(self.write(values).status_code, 200)
        self.change.refresh_from_db()
        self.assertEqual(self.change.updated_at, before)
        self.assertEqual(EmcReference.objects.count(), 0)

    def test_save_reopen_partial_retry_clear_and_reference_isolation(self):
        response = self.write({'cells': {CELL: {'mark': 'X', 'remark': '说明\n第二行'}}})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['initialized'])
        self.assertEqual((EmcReference.objects.count(), EmcReferenceRow.objects.count(), EmcReferenceTest.objects.count(), EmcReferenceCell.objects.count()), (1, 12, 11, 1))
        self.assertEqual(self.write({'cells': {CELL: {'remark': '新说明'}}}).status_code, 200)
        before = ChangeRequest.objects.get(pk=self.change.pk).updated_at
        self.assertEqual(self.write({'cells': {CELL: {'remark': '新说明'}}}).status_code, 200)
        self.assertEqual(ChangeRequest.objects.get(pk=self.change.pk).updated_at, before)
        data = self.client.get(self.path).json()
        self.assertEqual(data['cells'][CELL], {'mark': 'X', 'remark': '新说明'})
        second = ChangeRequest.objects.create(applicant=self.user)
        self.assertEqual(self.client.get(f'/api/changes/{second.pk}/emc/').json()['cells'], {})
        self.assertEqual(self.write({'cells': {CELL: {'mark': '', 'remark': ''}}}).status_code, 200)
        self.assertEqual(EmcReferenceCell.objects.count(), 0)
        self.assertEqual(EmcReferenceRow.objects.count(), 12)

    def test_reference_fields_and_role_spoofing_are_rejected_including_admin(self):
        for body in [{'metadata': {'title': '越权'}}, {'rows': {}}, {'tests': {}}, {'delete_rows': []}, {'delete_tests': []}, {'role': 'admin'}, {'cells': {CELL: {'label': '越权'}}}]:
            with self.subTest(body=body):
                self.assertEqual(self.write(body).status_code, 400)
        admin_client = APIClient(); admin_client.force_authenticate(user=self.admin)
        self.assertEqual(admin_client.get(self.path).status_code, 404)
        own = ChangeRequest.objects.create(applicant=self.admin)
        self.assertEqual(admin_client.patch(f'/api/changes/{own.pk}/emc/', {'rows': {}}, format='json').status_code, 400)
        self.assertEqual(EmcReference.objects.count(), 0)

    def test_access_csrf_expected_account_readonly_and_cascade(self):
        self.assertEqual(APIClient().get(self.path).status_code, 403)
        foreign = ChangeRequest.objects.create(applicant=self.other)
        self.assertEqual(self.client.get(f'/api/changes/{foreign.pk}/emc/').status_code, 404)
        self.client.credentials(HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, HTTP_X_EXPECTED_USER=str(self.other.pk))
        self.assertEqual(self.write({'cells': {CELL: {'mark': 'X'}}}).status_code, 409)
        self.client.credentials(HTTP_X_EXPECTED_USER=str(self.user.pk))
        self.assertEqual(self.write({'cells': {CELL: {'mark': 'X'}}}).status_code, 403)
        self.client.credentials(HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, HTTP_X_EXPECTED_USER=str(self.user.pk))
        self.assertEqual(self.write({'cells': {CELL: {'mark': '(X)'}}}).status_code, 200)
        for state in ['pending', 'approved']:
            ChangeRequest.objects.filter(pk=self.change.pk).update(status=state)
            self.assertFalse(self.client.get(self.path).json()['can_fill'])
            self.assertEqual(self.write({'cells': {CELL: {'remark': '不应保存'}}}).status_code, 409)
        ChangeRequest.objects.filter(pk=self.change.pk).update(status='draft')
        self.assertEqual(self.client.delete(f'/api/changes/{self.change.pk}/').status_code, 204)
        self.assertEqual(sum(model.objects.count() for model in [EmcReference, EmcReferenceRow, EmcReferenceTest, EmcReferenceCell]), 0)
        self.assertEqual(self.write({'cells': {CELL: {'mark': 'X'}}}).status_code, 404)

    def test_validation_is_atomic_and_failed_initialization_rolls_back(self):
        for values in [[], {'cells': {CELL: {'mark': 'x'}}}, {'cells': {CELL: {'remark': 1}}}, {'cells': {CELL: {'remark': None}}}, {'cells': {'bad': {'mark': 'X'}}}, {'cells': {CELL: {'mark': 'X'}, 'unknown/unknown': {'mark': '(X)'}}}]:
            self.assertEqual(self.write(values).status_code, 400)
            self.assertEqual(EmcReference.objects.count(), 0)
        with patch('changes.emc_views.ChangeRequest.save', side_effect=RuntimeError('rollback')):
            with self.assertRaises(RuntimeError):
                self.write({'cells': {CELL: {'mark': 'X'}}})
        self.assertEqual(sum(model.objects.count() for model in [EmcReference, EmcReferenceRow, EmcReferenceTest, EmcReferenceCell]), 0)

    def test_database_constraints_reject_duplicates_and_cross_reference_cells(self):
        self.write({'cells': {CELL: {'mark': 'X'}}})
        first = EmcReference.objects.get()
        row = first.rows.first(); test = first.tests.first()
        second = EmcReference.objects.create(change=ChangeRequest.objects.create(applicant=self.user))
        for create in [
            lambda: EmcReference.objects.create(change=self.change),
            lambda: EmcReferenceRow.objects.create(reference=first, key=row.key, sort_order=1),
            lambda: EmcReferenceTest.objects.create(reference=first, key=test.key, sort_order=1),
            lambda: EmcReferenceCell.objects.create(reference=first, row=row, test=test),
            lambda: EmcReferenceCell.objects.create(reference=second, row=row, test=test),
            lambda: EmcReferenceRow.objects.create(reference=first, key='invalid-order', sort_order=0),
        ]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                create()
        other_test = EmcReferenceTest.objects.create(reference=second, key='other', sort_order=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            EmcReferenceCell.objects.create(reference=first, row=row, test=other_test)
        other_row = EmcReferenceRow.objects.create(reference=first, key='other', sort_order=2)
        with self.assertRaises(IntegrityError), transaction.atomic():
            EmcReferenceCell.objects.create(reference=second, row=other_row, test=other_test)
        with self.assertRaises(IntegrityError), transaction.atomic():
            EmcReferenceCell.objects.create(reference=first, row=other_row, test=test, mark='x')


class EmcConcurrencyTests(TransactionTestCase):
    def test_parallel_fields_and_initialization_retry_keep_one_snapshot(self):
        user = get_user_model().objects.create_user('emc-parallel')
        change = ChangeRequest.objects.create(applicant=user)
        barrier = Barrier(2)
        def write(fields):
            try:
                client = APIClient(); client.force_authenticate(user=user)
                barrier.wait(timeout=10)
                return client.patch(f'/api/changes/{change.pk}/emc/', {'cells': {CELL: fields}}, format='json').status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(write, values) for values in [{'mark': 'X'}, {'remark': '并发说明'}]]
            self.assertEqual([future.result(timeout=15) for future in futures], [200, 200])
        self.assertEqual((EmcReference.objects.count(), EmcReferenceCell.objects.count()), (1, 1))
        self.assertEqual((EmcReferenceCell.objects.get().mark, EmcReferenceCell.objects.get().remark), ('X', '并发说明'))

    def test_writer_waits_for_application_lock_and_rechecks_state(self):
        user = get_user_model().objects.create_user('emc-lock')
        change = ChangeRequest.objects.create(applicant=user)
        started = Event()
        def write():
            try:
                client = APIClient(); client.force_authenticate(user=user)
                def mark(execute, sql, params, many, context):
                    if sql.lstrip().upper().startswith('SELECT') and 'change_request' in sql:
                        started.set()
                    return execute(sql, params, many, context)
                with connection.execute_wrapper(mark):
                    return client.patch(f'/api/changes/{change.pk}/emc/', {'cells': {CELL: {'mark': 'X'}}}, format='json').status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as executor:
            with transaction.atomic():
                locked = ChangeRequest.objects.select_for_update().get(pk=change.pk)
                future = executor.submit(write)
                self.assertTrue(started.wait(timeout=10))
                with self.assertRaises(TimeoutError):
                    future.result(timeout=0.15)
                locked.status = 'pending'; locked.save(update_fields=['status'])
            self.assertEqual(future.result(timeout=15), 409)
        self.assertEqual(EmcReference.objects.count(), 0)
