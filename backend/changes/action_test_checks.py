from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.db import IntegrityError, connections, transaction
from rest_framework.test import APIClient
from .models import ChangeRequest

def check_empty_retries_validation_and_transaction_rollback(self, prefix, model):
    previous = self.change.updated_at
    for values in [{}, {'owner': '', 'date': None}]:
        self.assertEqual(self.write(values).status_code, 200)
        self.change.refresh_from_db()
        self.assertEqual(self.change.updated_at, previous)
    for invalid in [{'owner': 1}, {'owner': None}, {'owner': '字' * 256}, {'result': None}, {'status': 'Y'}, {'date': ''}, {'date': 'bad'}, {'date': '10000-02-04'}, {'question_answer': 'Y'}, {'action_key': f'{prefix}_001'}, []]:
        with self.subTest(invalid=invalid):
            self.assertEqual(self.write(invalid).status_code, 400)
            self.assertEqual(model.objects.count(), 0)
    self.assertEqual(self.write({}, f'{prefix}_062').status_code, 404)
    with patch('changes.views.ChangeRequest.save', side_effect=RuntimeError('failed')):
        with self.assertRaises(RuntimeError):
            self.write({'result': 'rollback'})
    self.assertEqual(model.objects.count(), 0)
    self.assertEqual(self.write({'result': 'same'}).status_code, 200)
    previous = ChangeRequest.objects.get(pk=self.change.pk).updated_at
    self.assertEqual(self.write({'result': 'same'}).status_code, 200)
    self.assertEqual(ChangeRequest.objects.get(pk=self.change.pk).updated_at, previous)


def check_access_csrf_locked_account_context_and_cascade(self, prefix, model):
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
    self.assertEqual(self.client.get(f'/api/changes/{foreign.pk}/{prefix}-actions/').status_code, 404)
    self.assertEqual(self.client.patch(f'/api/changes/{foreign.pk}/{prefix}-actions/{prefix}_001/', {}, format='json').status_code, 404)
    self.assertEqual(self.client.post(self.path, {}, format='json').status_code, 405)
    self.assertEqual(self.client.delete(self.path + f'{prefix}_009/').status_code, 405)
    self.assertEqual(self.client.delete(f'/api/changes/{self.change.pk}/').status_code, 204)
    self.assertEqual(model.objects.count(), 0)
    self.assertEqual(self.write({'result': 'after delete'}).status_code, 404)


def check_database_constraints(self, prefix, model):
    model.objects.create(change=self.change, action_key=f'{prefix}_001')
    for key, status in [(f'{prefix}_001', ''), (f'{prefix}_062', ''), (f'{prefix}_002', 'invalid')]:
        with self.assertRaises(IntegrityError), transaction.atomic():
            model.objects.create(change=self.change, action_key=key, status=status)


def check_parallel_partial_saves_and_retries_keep_both_fields(self, prefix, model):
    user = get_user_model().objects.create_user(f'{prefix}-parallel')
    change = ChangeRequest.objects.create(applicant=user)
    path = f'/api/changes/{change.pk}/{prefix}-actions/{prefix}_009/'
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
    self.assertEqual(model.objects.count(), 1)
    row = model.objects.get()
    self.assertEqual((row.owner, row.result, row.status), ('并行负责人', '并行解释', 'completed'))
