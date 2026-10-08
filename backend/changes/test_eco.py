from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event

from django.contrib.auth import get_user_model
from django.db import connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest, EcoActionResponse, QuestionResponse
from .action_test_checks import (
    check_empty_retries_validation_and_transaction_rollback,
    check_access_csrf_locked_account_context_and_cascade,
    check_database_constraints,
    check_parallel_partial_saves_and_retries_keep_both_fields,
)
from .eco import ECO_ACTIONS


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class EcoFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user('eco-owner', password='test-password')
        cls.other = get_user_model().objects.create_user('eco-other')

    def setUp(self):
        self.change = ChangeRequest.objects.create(applicant=self.user)
        self.path = f'/api/changes/{self.change.pk}/eco-actions/'
        self.client = APIClient(enforce_csrf_checks=True)
        self.login()

    def login(self):
        token = self.client.get('/api/auth/csrf/').json()['csrfToken']
        response = self.client.post('/api/auth/login/', {'username': self.user.username, 'password': 'test-password'}, format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.client.credentials(HTTP_X_CSRFTOKEN=response.json()['csrfToken'], HTTP_X_EXPECTED_USER=str(self.user.pk))

    def write(self, values, key='eco_009'):
        return self.client.patch(self.path + key + '/', values, format='json')

    def test_definitions_saved_answer_linkage_and_defaults(self):
        self.assertEqual(connection.vendor, 'mysql')
        QuestionResponse.objects.create(change=self.change, number=6, answer='Y')
        data = self.client.get(self.path).json()
        self.assertEqual(len(data['actions']), 61)
        self.assertEqual(len({row['id'] for row in data['actions']}), 61)
        self.assertEqual([row['id'] for row in data['actions']], [f'eco_{i:03}' for i in range(1, 62)])
        self.assertEqual({row['number'] for row in data['actions']}, set(range(1, 28)))
        self.assertTrue(all(row['text'] and row['function'] for row in ECO_ACTIONS))
        self.assertEqual(sum(row['question_answer'] == 'Y' for row in data['actions']), 11)
        self.assertTrue(all(row['owner'] == row['result'] == row['status'] == '' and row['date'] is None for row in data['actions']))
        self.assertEqual(EcoActionResponse.objects.count(), 0)
        self.assertEqual(self.client.head(self.path).status_code, 200)

    def test_save_reopen_relogin_partial_clear_and_answer_changes_preserve_results(self):
        values = {'owner': '负责人', 'result': '解释🧪\n第二行', 'status': 'completed', 'date': '2026-10-02'}
        self.assertEqual(self.write(values).status_code, 200)
        for _ in range(2):
            self.assertEqual(self.write({'result': '新解释'}).status_code, 200)
        self.login()
        row = self.client.get(self.path).json()['actions'][8]
        self.assertEqual((row['owner'], row['result'], row['status'], row['date']), ('负责人', '新解释', 'completed', '2026-10-02'))
        for status in ['completed', 'not_applicable', 'implementation_stage']:
            self.assertEqual(self.write({'status': status}).status_code, 200)
            self.assertEqual(EcoActionResponse.objects.get().status, status)
        self.write({'status': 'completed'})
        for answer in ['Y', 'N', '']:
            response = self.client.patch(f'/api/changes/{self.change.pk}/questions/', {'responses': {'6': {'answer': answer}}}, format='json')
            self.assertEqual(response.status_code, 200)
            row = self.client.get(self.path).json()['actions'][8]
            self.assertEqual((row['question_answer'], row['result'], row['status']), (answer, '新解释', 'completed'))
        self.assertEqual(self.write({'date': None}).status_code, 200)
        self.assertEqual(EcoActionResponse.objects.get().owner, '负责人')
        self.assertEqual(self.write({'owner': '', 'result': '', 'status': '', 'date': None}).status_code, 200)
        self.assertEqual(EcoActionResponse.objects.count(), 0)

    def test_empty_retries_validation_and_transaction_rollback(self):
        check_empty_retries_validation_and_transaction_rollback(self, 'eco', EcoActionResponse)

    def test_access_csrf_locked_account_context_and_cascade(self):
        check_access_csrf_locked_account_context_and_cascade(self, 'eco', EcoActionResponse)

    def test_database_constraints(self):
        check_database_constraints(self, 'eco', EcoActionResponse)


class EcoConcurrencyTests(TransactionTestCase):
    def test_save_waits_for_parent_lock_and_rechecks_status_or_deletion(self):
        user = get_user_model().objects.create_user('eco-lock')
        for delete in [False, True]:
            with self.subTest(delete=delete):
                change = ChangeRequest.objects.create(applicant=user)
                started = Event()
                def write():
                    try:
                        client = APIClient(); client.force_authenticate(user=user)
                        def mark(execute, sql, params, many, context):
                            if 'SELECT' in sql.upper() and 'change_request' in sql:
                                started.set()
                            return execute(sql, params, many, context)
                        with connection.execute_wrapper(mark):
                            return client.patch(f'/api/changes/{change.pk}/eco-actions/eco_001/', {'result': '不应保存'}, format='json').status_code
                    finally:
                        connections.close_all()
                with ThreadPoolExecutor(max_workers=1) as executor:
                    with transaction.atomic():
                        locked = ChangeRequest.objects.select_for_update().get(pk=change.pk)
                        future = executor.submit(write)
                        self.assertTrue(started.wait(timeout=10))
                        with self.assertRaises(TimeoutError):
                            future.result(timeout=0.15)
                        if delete:
                            locked.delete()
                        else:
                            locked.status = 'pending'; locked.save(update_fields=['status'])
                    self.assertEqual(future.result(timeout=15), 404 if delete else 409)
                self.assertEqual(EcoActionResponse.objects.count(), 0)

    def test_read_keeps_answer_and_action_in_one_locked_snapshot(self):
        user = get_user_model().objects.create_user('eco-read')
        change = ChangeRequest.objects.create(applicant=user)
        QuestionResponse.objects.create(change=change, number=1, answer='Y')
        EcoActionResponse.objects.create(change=change, action_key='eco_001', result='old')
        started = Event()
        def update():
            try:
                started.set()
                with transaction.atomic():
                    locked = ChangeRequest.objects.select_for_update().get(pk=change.pk)
                    QuestionResponse.objects.filter(change=locked, number=1).update(answer='N')
                    EcoActionResponse.objects.filter(change=locked, action_key='eco_001').update(result='new')
            finally:
                connections.close_all()
        future = None
        with ThreadPoolExecutor(max_workers=1) as executor:
            def after_answers(execute, sql, params, many, context):
                nonlocal future
                result = execute(sql, params, many, context)
                if future is None and sql.lstrip().upper().startswith('SELECT') and 'question_response' in sql:
                    future = executor.submit(update)
                    self.assertTrue(started.wait(timeout=10))
                    with self.assertRaises(TimeoutError):
                        future.result(timeout=0.15)
                return result
            client = APIClient(); client.force_authenticate(user=user)
            with connection.execute_wrapper(after_answers):
                row = client.get(f'/api/changes/{change.pk}/eco-actions/').json()['actions'][0]
            self.assertEqual((row['question_answer'], row['result']), ('Y', 'old'))
            self.assertIsNotNone(future)
            future.result(timeout=15)
        self.assertEqual((QuestionResponse.objects.get().answer, EcoActionResponse.objects.get().result), ('N', 'new'))

    def test_parallel_partial_saves_and_retries_keep_both_fields(self):
        check_parallel_partial_saves_and_retries_keep_both_fields(self, 'eco', EcoActionResponse)
