from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Barrier, Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest, QuestionResponse
from .questions import QUESTIONS


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class QuestionFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user('question-owner', password='test-password')
        cls.other = get_user_model().objects.create_user('question-other', password='test-password')

    def setUp(self):
        self.record = ChangeRequest.objects.create(applicant=self.owner)
        self._original_time = self.record.updated_at
        self.path = f'/api/changes/{self.record.pk}/questions/'
        self.client = APIClient(enforce_csrf_checks=True)
        self.login()

    def login(self, username='question-owner'):
        token = self.client.get('/api/auth/csrf/').json()['csrfToken']
        response = self.client.post('/api/auth/login/', {'username': username, 'password': 'test-password'}, format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.client.credentials(HTTP_X_CSRFTOKEN=response.json()['csrfToken'], HTTP_X_EXPECTED_USER=str(self.owner.pk))

    def write(self, values):
        return self.client.patch(self.path, {'responses': values}, format='json')

    def test_complete_definitions_and_empty_defaults(self):
        self.assertEqual(connection.vendor, 'mysql')
        result = self.client.get(self.path)
        self.assertEqual(result.status_code, 200)
        rows = result.json()['questions']
        self.assertEqual([row['number'] for row in rows], list(range(1, 28)))
        self.assertEqual([row['function'] for row in rows], ['法规'] * 4 + ['风险'] + ['研发'] * 11 + ['生产'] * 4 + ['EHS'] + ['售后'] * 4 + ['QA'] * 2)
        self.assertTrue(all(row['text'] and row['answer'] == row['remark'] == '' for row in rows))
        self.assertEqual([row['number'] for row in rows if row['remark_hint']], [5, 13, 14])
        self.assertTrue(all(row['remark_hint']['answer'] == 'N' for row in rows if row['remark_hint']))
        self.assertEqual(rows[12]['text'], '该变更是否影响DHF的充分性和适宜性，是否需要设计评审。\n如果不影响DHF的充分性和适宜性，则说明理由')
        self.assertEqual(rows[13]['text'], '该变更是否需要设计验证来保证变更后产品能满足设计输入的要求？\n如果不需要设计验证，请备注理由。')
        self.assertEqual(QuestionResponse.objects.count(), 0)
        self.assertEqual(self.client.head(self.path).status_code, 200)
        self.assertEqual(self.client.options(self.path).status_code, 200)

    def test_partial_save_relogin_clear_and_retry(self):
        result = self.write({'5': {'answer': 'N'}, '13': {'remark': '  理由🧪\n第二行  '}, '14': {'answer': 'Y', 'remark': '验证'}})
        self.assertEqual(result.status_code, 200)  # Missing conditional reasons never block drafts.
        self.assertNotEqual(result.json()['updated_at'], self.record.updated_at.isoformat())
        for _ in range(2):
            self.assertEqual(self.write({'14': {'remark': '新备注'}}).status_code, 200)
        unchanged_time = ChangeRequest.objects.get(pk=self.record.pk).updated_at
        self.assertEqual(self.write({'14': {'remark': '新备注'}}).status_code, 200)
        self.assertEqual(ChangeRequest.objects.get(pk=self.record.pk).updated_at, unchanged_time)
        self.login()
        rows = self.client.get(self.path).json()['questions']
        self.assertEqual((rows[4]['answer'], rows[4]['remark']), ('N', ''))
        self.assertEqual((rows[12]['answer'], rows[12]['remark']), ('', '理由🧪\n第二行'))
        self.assertEqual((rows[13]['answer'], rows[13]['remark']), ('Y', '新备注'))
        self.assertEqual(QuestionResponse.objects.count(), 3)
        self.assertEqual(self.write({'14': {'answer': ''}}).status_code, 200)
        self.assertEqual(QuestionResponse.objects.get(number=14).remark, '新备注')
        self.assertEqual(self.write({'14': {'remark': ''}, '5': {'answer': ''}}).status_code, 200)
        self.assertEqual(list(QuestionResponse.objects.values_list('number', flat=True)), [13])
        self.assertEqual(self.write({'13': {'remark': ''}}).status_code, 200)
        self.assertEqual(QuestionResponse.objects.count(), 0)

    def test_empty_and_unchanged_requests_do_not_touch_timestamp(self):
        for values in [{}, {'1': {}}, {'2': {'answer': '', 'remark': '   '}}]:
            self.assertEqual(self.write(values).status_code, 200)
            self.record.refresh_from_db()
            self.assertEqual(QuestionResponse.objects.count(), 0)
            self.assertEqual(self.record.updated_at, self._original_time)

    def test_validation_is_atomic_and_errors_keep_paths(self):
        invalid_values = [
            {'05': {'answer': 'Y'}}, {'0': {}}, {'28': {}}, {'1': None},
            {'1': {'answer': None}}, {'1': {'answer': 'yes'}}, {'1': {'answer': 1}},
            {'1': {'remark': None}}, {'1': {'remark': 42}}, {'1': {'text': 'changed'}},
        ]
        for invalid in invalid_values:
            with self.subTest(invalid=invalid):
                response = self.write({'27': {'answer': 'Y'}, **invalid})
                self.assertEqual(response.status_code, 400)
                self.assertIn('responses', response.json())
                self.assertEqual(QuestionResponse.objects.count(), 0)
        for payload in [[], None, {}, {'responses': None}, {'responses': []}, {'responses': {}, 'applicant': self.other.pk}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.client.patch(self.path, payload, format='json').status_code, 400)
        self.record.refresh_from_db()
        self.assertEqual(self.record.updated_at, self._original_time)

    def test_permissions_csrf_readonly_and_cascade(self):
        anonymous = APIClient()
        self.assertEqual(anonymous.get(self.path).status_code, 403)
        self.client.credentials(HTTP_X_EXPECTED_USER=str(self.owner.pk))
        self.assertEqual(self.write({'1': {'answer': 'Y'}}).status_code, 403)
        self.login()
        self.assertEqual(self.write({'1': {'answer': 'Y'}}).status_code, 200)
        for method in ['post', 'put', 'delete']:
            self.assertEqual(getattr(self.client, method)(self.path, {}, format='json').status_code, 405)
        for status in ['pending', 'approved']:
            ChangeRequest.objects.filter(pk=self.record.pk).update(status=status)
            self.assertEqual(self.client.get(self.path).status_code, 200)
            self.assertEqual(self.write({'1': {'answer': 'N'}}).status_code, 409)
        ChangeRequest.objects.filter(pk=self.record.pk).update(status='draft')
        self.login('question-other')
        self.assertEqual(self.client.get(self.path).status_code, 409)
        self.assertEqual(self.write({'1': {'answer': 'N'}}).status_code, 409)
        self.client.credentials(HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, HTTP_X_EXPECTED_USER=str(self.other.pk))
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.assertEqual(self.write({'1': {'answer': 'N'}}).status_code, 404)
        self.login()
        self.assertEqual(self.client.delete(f'/api/changes/{self.record.pk}/').status_code, 204)
        self.assertEqual(QuestionResponse.objects.count(), 0)
        self.assertEqual(self.write({'1': {'answer': 'N'}}).status_code, 404)

    def test_constraints_and_database_failure_rollback(self):
        QuestionResponse.objects.create(change=self.record, number=1, answer='Y')
        for number, answer in [(1, 'N'), (0, ''), (28, ''), (2, 'X')]:
            with self.subTest(number=number, answer=answer), self.assertRaises(IntegrityError), transaction.atomic():
                QuestionResponse.objects.create(change=self.record, number=number, answer=answer)
        with patch('changes.views.ChangeRequest.save', side_effect=RuntimeError('write failed')):
            with self.assertRaisesRegex(RuntimeError, 'write failed'):
                self.write({'2': {'answer': 'Y'}, '3': {'answer': 'N'}})
        self.assertEqual(QuestionResponse.objects.count(), 1)
        self.record.refresh_from_db()
        self.assertEqual(self.record.updated_at, self._original_time)


class ConcurrentQuestionTests(TransactionTestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('question-concurrent')
        self.record = ChangeRequest.objects.create(applicant=self.owner)
        self.path = f'/api/changes/{self.record.pk}/questions/'

    def write(self, values, barrier=None, started=None):
        try:
            client = APIClient()
            client.force_authenticate(user=self.owner)
            if barrier:
                barrier.wait(timeout=10)
            def mark_select(execute, sql, params, many, context):
                if started and sql.lstrip().upper().startswith('SELECT') and 'change_request' in sql:
                    started.set()
                return execute(sql, params, many, context)
            with connection.execute_wrapper(mark_select):
                return client.patch(self.path, {'responses': values}, format='json').status_code
        finally:
            connections.close_all()

    def test_parallel_fields_questions_and_repeated_creation(self):
        self.assertEqual(connection.vendor, 'mysql')
        for first_values, second_values in [
            ({'1': {'answer': 'Y'}}, {'1': {'remark': '并行备注'}}),
            ({'2': {'answer': 'N'}}, {'3': {'answer': 'Y'}}),
            ({'4': {'answer': 'Y'}}, {'4': {'answer': 'Y'}}),
        ]:
            barrier = Barrier(2)
            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(self.write, values, barrier) for values in [first_values, second_values]]
                self.assertEqual([future.result(timeout=15) for future in futures], [200, 200])
        self.assertEqual(QuestionResponse.objects.count(), 4)
        row = QuestionResponse.objects.get(number=1)
        self.assertEqual((row.answer, row.remark), ('Y', '并行备注'))
        self.assertEqual(list(QuestionResponse.objects.values_list('answer', flat=True)), ['Y', 'N', 'Y', 'Y'])

    def test_lock_wait_rechecks_status_and_deleted_application(self):
        for delete in [False, True]:
            with self.subTest(delete=delete):
                self.record = ChangeRequest.objects.create(applicant=self.owner)
                self.path = f'/api/changes/{self.record.pk}/questions/'
                started = Event()
                with ThreadPoolExecutor(max_workers=1) as executor:
                    with transaction.atomic():
                        locked = ChangeRequest.objects.select_for_update().get(pk=self.record.pk)
                        future = executor.submit(self.write, {'1': {'answer': 'Y'}}, None, started)
                        self.assertTrue(started.wait(timeout=10))
                        with self.assertRaises(TimeoutError):
                            future.result(timeout=0.15)
                        if delete:
                            locked.delete()
                        else:
                            locked.status = 'pending'
                            locked.save(update_fields=['status'])
                    self.assertEqual(future.result(timeout=15), 404 if delete else 409)
        self.assertEqual(QuestionResponse.objects.count(), 0)

    def test_read_keeps_answers_and_timestamp_in_same_snapshot(self):
        QuestionResponse.objects.create(change=self.record, number=1, answer='N')
        previous_time = self.record.updated_at.isoformat()
        started = Event()
        future = None
        triggered = False
        client = APIClient()
        client.force_authenticate(user=self.owner)
        with ThreadPoolExecutor(max_workers=1) as executor:
            def interleave(execute, sql, params, many, context):
                nonlocal future, triggered
                result = execute(sql, params, many, context)
                if not triggered and sql.lstrip().upper().startswith('SELECT') and 'FROM `question_response`' in sql:
                    triggered = True
                    future = executor.submit(self.write, {'1': {'answer': 'Y'}}, None, started)
                    self.assertTrue(started.wait(timeout=10))
                    with self.assertRaises(TimeoutError):
                        future.result(timeout=0.15)
                return result
            with connection.execute_wrapper(interleave):
                result = client.get(self.path).json()
            self.assertTrue(triggered)
            self.assertEqual(result['updated_at'], previous_time)
            self.assertEqual(result['questions'][0]['answer'], 'N')
            self.assertEqual(future.result(timeout=15), 200)
        self.assertEqual(QuestionResponse.objects.get(number=1).answer, 'Y')


class QuestionMigrationTests(TransactionTestCase):
    def test_new_table_preserves_existing_business_data(self):
        owner = get_user_model().objects.create_user('question-migration')
        before = [('changes', '0005_materialdisposition')]
        after = [('changes', '0006_questionresponse')]
        try:
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            record = apps.get_model('changes', 'ChangeRequest').objects.create(applicant_id=owner.pk, title='旧概述')
            material = apps.get_model('changes', 'MaterialChange').objects.create(change_id=record.pk, category='revision', material_no='00001')
            apps.get_model('changes', 'MaterialDisposition').objects.create(material_id=material.pk, location_group='company', location_item='company_finished', disposition='NA', remark='保留')
            saved = {name: list(apps.get_model('changes', name).objects.values()) for name in ['ChangeRequest', 'MaterialChange', 'MaterialDisposition']}
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            apps = executor.loader.project_state(after).apps
            for name, rows in saved.items():
                self.assertEqual(list(apps.get_model('changes', name).objects.values()), rows)
            self.assertEqual(apps.get_model('changes', 'QuestionResponse').objects.count(), 0)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
