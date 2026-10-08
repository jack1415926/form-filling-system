from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest, EcrActionResponse, QuestionResponse
from .action_test_checks import (
    check_empty_retries_validation_and_transaction_rollback,
    check_access_csrf_locked_account_context_and_cascade,
    check_database_constraints,
    check_parallel_partial_saves_and_retries_keep_both_fields,
)


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
        check_empty_retries_validation_and_transaction_rollback(self, 'ecr', EcrActionResponse)

    def test_access_csrf_locked_account_context_and_cascade(self):
        check_access_csrf_locked_account_context_and_cascade(self, 'ecr', EcrActionResponse)

    def test_database_constraints(self):
        check_database_constraints(self, 'ecr', EcrActionResponse)


class EcrConcurrencyTests(TransactionTestCase):
    def test_parallel_partial_saves_and_retries_keep_both_fields(self):
        check_parallel_partial_saves_and_retries_keep_both_fields(self, 'ecr', EcrActionResponse)
