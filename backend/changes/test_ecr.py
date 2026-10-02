from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest, EcrActionResponse, QuestionResponse


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class EcrFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user('ecr-owner', password='test-password')
        cls.other = get_user_model().objects.create_user('ecr-other')

    def setUp(self):
        self.change = ChangeRequest.objects.create(applicant=self.user)
        self.path = f'/api/changes/{self.change.pk}/ecr-actions/'
        self.client = APIClient(enforce_csrf_checks=True)
        self.login()

    def login(self):
        token = self.client.get('/api/auth/csrf/').json()['csrfToken']
        response = self.client.post('/api/auth/login/', {'username': self.user.username, 'password': 'test-password'}, format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.client.credentials(HTTP_X_CSRFTOKEN=response.json()['csrfToken'], HTTP_X_EXPECTED_USER=str(self.user.pk))

    def write(self, values, key='ecr_009'):
        return self.client.patch(self.path + key + '/', values, format='json')

    def test_definitions_saved_answer_linkage_and_defaults(self):
        self.assertEqual(connection.vendor, 'mysql')
        QuestionResponse.objects.create(change=self.change, number=6, answer='Y')
        data = self.client.get(self.path).json()
        self.assertEqual(len(data['actions']), 61)
        self.assertEqual(len({row['id'] for row in data['actions']}), 61)
        self.assertEqual(sum(row['question_answer'] == 'Y' for row in data['actions']), 11)
        self.assertTrue(all(row['owner'] == row['result'] == row['status'] == '' and row['date'] is None for row in data['actions']))
        self.assertEqual(EcrActionResponse.objects.count(), 0)
        self.assertEqual(self.client.head(self.path).status_code, 200)

    def test_save_reopen_relogin_partial_clear_and_answer_changes_preserve_results(self):
        values = {'owner': '负责人', 'result': '解释🧪\n第二行', 'status': 'completed', 'date': '2026-10-02'}
        self.assertEqual(self.write(values).status_code, 200)
        for _ in range(2):
            self.assertEqual(self.write({'result': '新解释'}).status_code, 200)
        self.login()
        row = self.client.get(self.path).json()['actions'][8]
        self.assertEqual((row['owner'], row['result'], row['status'], row['date']), ('负责人', '新解释', 'completed', '2026-10-02'))
        for answer in ['Y', 'N', '']:
            response = self.client.patch(f'/api/changes/{self.change.pk}/questions/', {'responses': {'6': {'answer': answer}}}, format='json')
            self.assertEqual(response.status_code, 200)
            row = self.client.get(self.path).json()['actions'][8]
            self.assertEqual((row['question_answer'], row['result'], row['status']), (answer, '新解释', 'completed'))
        self.assertEqual(self.write({'date': None}).status_code, 200)
        self.assertEqual(EcrActionResponse.objects.get().owner, '负责人')
        self.assertEqual(self.write({'owner': '', 'result': '', 'status': '', 'date': None}).status_code, 200)
        self.assertEqual(EcrActionResponse.objects.count(), 0)

    def test_empty_retries_validation_and_transaction_rollback(self):
        previous = self.change.updated_at
        for values in [{}, {'owner': '', 'date': None}]:
            self.assertEqual(self.write(values).status_code, 200)
            self.change.refresh_from_db()
            self.assertEqual(self.change.updated_at, previous)
        for invalid in [{'owner': 1}, {'owner': None}, {'owner': '字' * 256}, {'result': None}, {'status': 'Y'}, {'date': ''}, {'date': 'bad'}, {'question_answer': 'Y'}, {'action_key': 'ecr_001'}, []]:
            with self.subTest(invalid=invalid):
                self.assertEqual(self.write(invalid).status_code, 400)
                self.assertEqual(EcrActionResponse.objects.count(), 0)
        self.assertEqual(self.write({}, 'ecr_062').status_code, 404)
        with patch('changes.views.ChangeRequest.save', side_effect=RuntimeError('failed')):
            with self.assertRaises(RuntimeError):
                self.write({'result': 'rollback'})
        self.assertEqual(EcrActionResponse.objects.count(), 0)
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
        self.assertEqual(self.client.get(f'/api/changes/{foreign.pk}/ecr-actions/').status_code, 404)
        self.assertEqual(self.client.patch(f'/api/changes/{foreign.pk}/ecr-actions/ecr_001/', {}, format='json').status_code, 404)
        self.assertEqual(self.client.post(self.path, {}, format='json').status_code, 405)
        self.assertEqual(self.client.delete(self.path + 'ecr_009/').status_code, 405)
        self.assertEqual(self.client.delete(f'/api/changes/{self.change.pk}/').status_code, 204)
        self.assertEqual(EcrActionResponse.objects.count(), 0)
        self.assertEqual(self.write({'result': 'after delete'}).status_code, 404)

    def test_database_constraints(self):
        EcrActionResponse.objects.create(change=self.change, action_key='ecr_001')
        for key, status in [('ecr_001', ''), ('ecr_062', ''), ('ecr_002', 'invalid')]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                EcrActionResponse.objects.create(change=self.change, action_key=key, status=status)


class EcrConcurrencyTests(TransactionTestCase):
    def test_parallel_partial_saves_and_retries_keep_both_fields(self):
        user = get_user_model().objects.create_user('ecr-parallel')
        change = ChangeRequest.objects.create(applicant=user)
        path = f'/api/changes/{change.pk}/ecr-actions/ecr_009/'
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
        self.assertEqual(EcrActionResponse.objects.count(), 1)
        row = EcrActionResponse.objects.get()
        self.assertEqual((row.owner, row.result, row.status), ('并行负责人', '并行解释', 'completed'))


class EcrMigrationTests(TransactionTestCase):
    def test_new_table_preserves_all_previous_business_tables(self):
        user = get_user_model().objects.create_user('ecr-migration')
        before = [('changes', '0006_questionresponse')]
        after = [('changes', '0007_ecractionresponse')]
        try:
            executor = MigrationExecutor(connection); executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            change = apps.get_model('changes', 'ChangeRequest').objects.create(applicant_id=user.pk, title='原申请')
            apps.get_model('changes', 'QuestionResponse').objects.create(change_id=change.pk, number=6, answer='Y', remark='原备注')
            names = ['ChangeRequest', 'MaterialChange', 'MaterialDisposition', 'QuestionResponse']
            saved = {name: list(apps.get_model('changes', name).objects.values()) for name in names}
            executor = MigrationExecutor(connection); executor.migrate(after)
            apps = executor.loader.project_state(after).apps
            for name in names:
                self.assertEqual(list(apps.get_model('changes', name).objects.values()), saved[name])
            self.assertEqual(apps.get_model('changes', 'EcrActionResponse').objects.count(), 0)
        finally:
            executor = MigrationExecutor(connection); executor.migrate(executor.loader.graph.leaf_nodes())
