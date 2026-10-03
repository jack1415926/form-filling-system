from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Barrier, Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest, EcoActionResponse, EcrActionResponse, QuestionResponse
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
        previous = self.change.updated_at
        for values in [{}, {'owner': '', 'date': None}]:
            self.assertEqual(self.write(values).status_code, 200)
            self.change.refresh_from_db()
            self.assertEqual(self.change.updated_at, previous)
        for invalid in [{'owner': 1}, {'owner': None}, {'owner': '字' * 256}, {'result': None}, {'status': 'Y'}, {'date': ''}, {'date': 'bad'}, {'date': '10000-02-04'}, {'question_answer': 'Y'}, {'action_key': 'eco_001'}, []]:
            with self.subTest(invalid=invalid):
                self.assertEqual(self.write(invalid).status_code, 400)
                self.assertEqual(EcoActionResponse.objects.count(), 0)
        self.assertEqual(self.write({}, 'eco_062').status_code, 404)
        with patch('changes.views.ChangeRequest.save', side_effect=RuntimeError('failed')):
            with self.assertRaises(RuntimeError):
                self.write({'result': 'rollback'})
        self.assertEqual(EcoActionResponse.objects.count(), 0)
        self.assertEqual(self.write({'result': 'same'}).status_code, 200)
        previous = ChangeRequest.objects.get(pk=self.change.pk).updated_at
        self.assertEqual(self.write({'result': 'same'}).status_code, 200)
        self.assertEqual(ChangeRequest.objects.get(pk=self.change.pk).updated_at, previous)

    def test_access_csrf_locked_account_context_and_cascade(self):
        self.assertEqual(APIClient().get(self.path).status_code, 403)
        self.client.credentials(HTTP_X_EXPECTED_USER=str(self.user.pk))
        self.assertEqual(self.write({'result': 'bad'}).status_code, 403)
        self.login()
        self.assertEqual(self.write({'result': '保留'}).status_code, 200)
        for state in ['pending', 'approved']:
            ChangeRequest.objects.filter(pk=self.change.pk).update(status=state)
            self.assertEqual(self.client.get(self.path).status_code, 200)
            self.assertEqual(self.write({'result': 'bad'}).status_code, 409)
        ChangeRequest.objects.filter(pk=self.change.pk).update(status='draft')
        self.client.credentials(HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, HTTP_X_EXPECTED_USER=str(self.other.pk))
        self.assertEqual(self.client.get(self.path).status_code, 409)
        self.assertEqual(self.write({'result': 'bad'}).status_code, 409)
        foreign = ChangeRequest.objects.create(applicant=self.other)
        self.login()
        self.assertEqual(self.client.get(f'/api/changes/{foreign.pk}/eco-actions/').status_code, 404)
        self.assertEqual(self.client.patch(f'/api/changes/{foreign.pk}/eco-actions/eco_001/', {}, format='json').status_code, 404)
        self.assertEqual(self.client.post(self.path, {}, format='json').status_code, 405)
        self.assertEqual(self.client.delete(self.path + 'eco_009/').status_code, 405)
        self.assertEqual(self.client.delete(f'/api/changes/{self.change.pk}/').status_code, 204)
        self.assertEqual(EcoActionResponse.objects.count(), 0)
        self.assertEqual(self.write({'result': 'after delete'}).status_code, 404)

    def test_database_constraints(self):
        EcoActionResponse.objects.create(change=self.change, action_key='eco_001')
        for key, status in [('eco_001', ''), ('eco_062', ''), ('eco_002', 'invalid')]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                EcoActionResponse.objects.create(change=self.change, action_key=key, status=status)


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
        user = get_user_model().objects.create_user('eco-parallel')
        change = ChangeRequest.objects.create(applicant=user)
        path = f'/api/changes/{change.pk}/eco-actions/eco_009/'
        barrier = Barrier(2)
        def write(values):
            try:
                client = APIClient(); client.force_authenticate(user=user)
                barrier.wait(timeout=10)
                return client.patch(path, values, format='json').status_code
            finally:
                connections.close_all()
        for values in [[{'owner': '并行负责人'}, {'result': '并行解释'}], [{'status': 'completed'}, {'status': 'completed'}]]:
            barrier = Barrier(2)
            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(write, value) for value in values]
                self.assertEqual([future.result(timeout=15) for future in futures], [200, 200])
        self.assertEqual(EcoActionResponse.objects.count(), 1)
        row = EcoActionResponse.objects.get()
        self.assertEqual((row.owner, row.result, row.status), ('并行负责人', '并行解释', 'completed'))


class EcoMigrationTests(TransactionTestCase):
    def test_new_table_preserves_all_previous_business_tables(self):
        user = get_user_model().objects.create_user('eco-migration')
        before = [('changes', '0007_ecractionresponse')]
        after = [('changes', '0008_ecoactionresponse')]
        try:
            executor = MigrationExecutor(connection); executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            change = apps.get_model('changes', 'ChangeRequest').objects.create(applicant_id=user.pk, title='原申请')
            material = apps.get_model('changes', 'MaterialChange').objects.create(change_id=change.pk, category='revision', material_no='000003151', old_revision='A', new_revision='B')
            apps.get_model('changes', 'MaterialDisposition').objects.create(material_id=material.pk, location_group='company', location_item='company_finished', disposition='NA', remark='原处置')
            apps.get_model('changes', 'QuestionResponse').objects.create(change_id=change.pk, number=6, answer='Y', remark='原备注')
            apps.get_model('changes', 'EcrActionResponse').objects.create(change_id=change.pk, action_key='ecr_001', result='原ECR')
            names = ['ChangeRequest', 'MaterialChange', 'MaterialDisposition', 'QuestionResponse', 'EcrActionResponse']
            saved = {name: list(apps.get_model('changes', name).objects.values()) for name in names}
            executor = MigrationExecutor(connection); executor.migrate(after)
            apps = executor.loader.project_state(after).apps
            for name in names:
                self.assertEqual(list(apps.get_model('changes', name).objects.values()), saved[name])
            self.assertEqual(apps.get_model('changes', 'EcoActionResponse').objects.count(), 0)
        finally:
            executor = MigrationExecutor(connection); executor.migrate(executor.loader.graph.leaf_nodes())
