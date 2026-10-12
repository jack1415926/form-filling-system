import uuid

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import ActionTask, ChangeRequest, EcrActionResponse, QuestionResponse


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class EcrStageTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.a, cls.b, cls.c = [get_user_model().objects.create_user('stage-' + name) for name in ['a', 'b', 'c']]

    def setUp(self):
        self.client = APIClient(); self.client.force_authenticate(self.a)
        self.change = ChangeRequest.objects.create(applicant=self.a, stage='ecr', publisher=self.c, title='Stage', ecr_no='ECR-STAGE')
        QuestionResponse.objects.bulk_create([QuestionResponse(change=self.change, number=number, answer='N') for number in range(1, 28)])
        self.path = f'/api/changes/{self.change.pk}/'

    def assign(self, key, owner, extra=True):
        return self.client.patch(self.path + f'ecr-actions/{key}/', {'owner_user_id': owner.pk, 'extra_required': extra}, format='json')

    def submit(self, number=0, **extra):
        payload = {'expected_round': number, 'request_id': str(uuid.uuid4()), **extra}
        return self.client.post(self.path + 'stage-submission/', payload, format='json'), payload

    def action(self, number, action, payload, actor):
        self.client.force_authenticate(actor)
        return self.client.post(self.path + f'review-rounds/{number}/{action}/', {'request_id': str(uuid.uuid4()), **payload}, format='json')

    def save_task(self, task, text='完成评估'):
        self.client.force_authenticate(task.owner)
        return self.client.patch(self.path + f'action-tasks/{task.pk}/', {'request_id': str(uuid.uuid4()), 'version': task.version,
            'result': text, 'status': 'completed', 'date': '2026-10-12'}, format='json')

    def confirm_task(self, task):
        task.refresh_from_db(); self.client.force_authenticate(task.owner)
        return self.client.post(self.path + f'action-tasks/{task.pk}/', {'request_id': str(uuid.uuid4()), 'version': task.version}, format='json')

    def test_assignment_self_permissions_required_values_and_legacy_entry_rejection(self):
        self.assertEqual(connection.vendor, 'mysql')
        created = self.client.post('/api/changes/', {}, format='json')
        self.assertEqual(created.data['stage'], 'ecr')
        self.assertEqual(self.assign('ecr_001', self.a).status_code, 200)
        self.assertEqual(self.assign('ecr_002', self.b).status_code, 200)
        self.assertEqual(self.client.patch(self.path + 'ecr-actions/ecr_001/', {'result': '代填'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(self.path + 'eco-actions/eco_001/', {'result': '未启动'}, format='json').status_code, 409)
        response, _ = self.submit(); self.assertEqual(response.status_code, 200)
        own_messages = self.client.get('/api/review/inbox/').data['items']
        self.assertTrue(any('ECR行动待处理1项' in item['summary'] and item['context'] == 'applicant' for item in own_messages))
        self.assertEqual(self.client.post(self.path + 'submission/', {'review_mode': 'designated', 'reviewer_ids': [self.b.pk]}, format='json').status_code, 409)
        self.assertEqual(self.action(1, 'approve', {}, self.b).status_code, 409)
        own, foreign = list(self.change.review_rounds.get(number=1).tasks.order_by('action_key'))
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.patch(self.path, {'title': '锁定'}, format='json').status_code, 409)
        self.assertEqual(self.client.patch(self.path + f'action-tasks/{foreign.pk}/', {'request_id': str(uuid.uuid4()), 'version': 1, 'result': '越权'}, format='json').status_code, 404)
        self.assertEqual(self.confirm_task(own).status_code, 400)
        self.assertEqual(self.save_task(own).status_code, 200)
        self.assertEqual(self.confirm_task(own).status_code, 200)
        self.assertFalse(self.client.get('/api/review/inbox/').data['items'])
        self.assertEqual(self.save_task(own).status_code, 409)
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'pending')
        self.assertEqual(self.save_task(foreign).status_code, 200)
        self.assertEqual(self.confirm_task(foreign).status_code, 200)
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'approved')
        self.client.force_authenticate(self.c)
        self.assertEqual(self.client.get(self.path).status_code, 404)

    def test_return_reassign_old_round_history_and_original_author_resolution(self):
        self.assign('ecr_001', self.a); self.assign('ecr_002', self.b)
        self.submit(); first, second = list(self.change.review_rounds.get(number=1).tasks.order_by('action_key'))
        self.save_task(first); self.confirm_task(first)
        response = self.action(1, 'return', {'issues': [{'tab': 'ecr', 'location': 'ecr_002', 'text': '修订基础'}]}, self.b)
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.assertIsNone(self.client.get(self.path + 'stage-workflow/').data['change'])
        self.assertEqual(self.save_task(second).status_code, 409)
        issue = self.change.review_issues.get()
        self.assertEqual(self.action(1, 'respond', {'issue_id': issue.pk, 'version': issue.version, 'text': '已修订'}, self.a).status_code, 200)
        self.client.force_authenticate(self.a); self.assign('ecr_002', self.c)
        response, _ = self.submit(1); self.assertEqual(response.status_code, 200)
        self.assertEqual(self.confirm_task(first).status_code, 409)
        current = list(self.change.review_rounds.get(number=2).tasks.order_by('action_key'))
        for task in current:
            self.assertIsNone(task.confirmed_at)
            self.save_task(task, '新轮评估'); self.assertEqual(self.confirm_task(task).status_code, 200)
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'pending')
        issue.refresh_from_db()
        self.assertEqual(self.action(2, 'return', {'issues': [{'tab': 'overview', 'text': '未授权新增意见'}]}, self.b).status_code, 403)
        response = self.action(2, 'resolve', {'issue_id': issue.pk, 'version': issue.version, 'text': '确认修订'}, self.b)
        self.assertEqual(response.status_code, 200)
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'approved')
        first.refresh_from_db(); self.assertEqual(first.result, '完成评估')
        self.client.force_authenticate(self.b)
        data = self.client.get(self.path + 'stage-workflow/').data
        self.assertFalse(any(task['can_edit'] for task in data['tasks']))
        history = self.client.get(self.path + 'review-rounds/2/').data['history']
        self.assertEqual(history[0]['tasks'][0]['result'], '完成评估')
        self.assertEqual(history[1]['tasks'][0]['result'], '新轮评估')

    def test_submission_guards_triggered_supplement_zero_and_receipts(self):
        QuestionResponse.objects.filter(change=self.change, number=1).update(answer='')
        self.assertEqual(self.submit(acknowledge_no_tasks=True)[0].status_code, 400)
        QuestionResponse.objects.filter(change=self.change, number=1).update(answer='Y')
        self.assertEqual(self.submit()[0].status_code, 400)
        self.assign('ecr_001', self.a, extra=False)
        self.assign('ecr_002', self.b)
        response, payload = self.submit(); self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['tasks']), 2)
        self.assertEqual(self.client.post(self.path + 'stage-submission/', payload, format='json').status_code, 200)
        self.assertEqual(self.change.review_rounds.count(), 1)
        payload['acknowledge_no_tasks'] = True
        self.assertEqual(self.client.post(self.path + 'stage-submission/', payload, format='json').status_code, 409)
        self.client.force_authenticate(self.c)
        self.assertEqual(self.client.get(self.path + 'stage-workflow/').status_code, 404)
        zero = ChangeRequest.objects.create(applicant=self.a, stage='ecr', publisher=self.c, title='Zero', ecr_no='ZERO')
        QuestionResponse.objects.bulk_create([QuestionResponse(change=zero, number=n, answer='N') for n in range(1, 28)])
        self.client.force_authenticate(self.a)
        url = f'/api/changes/{zero.pk}/stage-submission/'
        payload = {'request_id': str(uuid.uuid4()), 'expected_round': 0}
        self.assertEqual(self.client.post(url, payload, format='json').status_code, 400)
        payload['acknowledge_no_tasks'] = True
        self.assertEqual(self.client.post(url, payload, format='json').status_code, 200)
        zero.refresh_from_db(); self.assertEqual(zero.status, 'approved')
        self.assertTrue(zero.review_rounds.get().submission_payload['acknowledge_no_tasks'])

    def test_task_save_confirmation_version_replay_and_projection(self):
        self.assign('ecr_001', self.a); self.submit()
        task = ActionTask.objects.get(round__change=self.change)
        url = self.path + f'action-tasks/{task.pk}/'
        payload = {'request_id': str(uuid.uuid4()), 'version': 1, 'result': '无需变更，已说明原因', 'status': 'not_applicable', 'date': '2026-10-12'}
        self.assertEqual(self.client.patch(url, payload, format='json').status_code, 200)
        self.assertEqual(self.client.patch(url, payload, format='json').status_code, 200)
        self.assertEqual(task.operations.count(), 1)
        self.assertEqual(self.client.patch(url, {**payload, 'result': '不同内容'}, format='json').status_code, 409)
        self.assertEqual(self.client.patch(url, {**payload, 'request_id': str(uuid.uuid4())}, format='json').status_code, 409)
        task.refresh_from_db(); confirmation = {'request_id': str(uuid.uuid4()), 'version': task.version}
        self.assertEqual(self.client.post(url, confirmation, format='json').status_code, 200)
        self.assertEqual(self.client.post(url, confirmation, format='json').status_code, 200)
        response = EcrActionResponse.objects.get(change=self.change)
        self.assertEqual((response.result, response.status, str(response.date)), (payload['result'], payload['status'], payload['date']))

    def test_reverse_migration_guard_precedes_schema_removal(self):
        import importlib
        from django.apps import apps
        from types import SimpleNamespace
        migration = importlib.import_module('changes.migrations.0019_ecr_stage_tasks')
        self.assertEqual(migration.Migration.operations[-1].reverse_code, migration.prevent_stage_loss)
        with self.assertRaises(RuntimeError):
            migration.prevent_stage_loss(apps, SimpleNamespace(connection=connection))

    def test_self_author_revision_messages_are_single_and_keep_read_receipt(self):
        self.assign('ecr_001', self.a); self.submit()
        self.assertEqual(self.action(1, 'return', {'issues': [{'tab': 'ecr', 'text': '本人任务发现问题'}]}, self.a).status_code, 200)
        first = self.client.get('/api/review/inbox/').data
        self.assertEqual(len(first['items']), 1)
        item = first['items'][0]
        read = {'items': [{'change_id': item['change_id'], 'round': item['round'], 'message_key': item['message_key']}]}
        self.assertEqual(self.client.post('/api/review/inbox/read/', read, format='json').status_code, 200)
        issue = self.change.review_issues.get()
        self.assertEqual(self.action(1, 'respond', {'issue_id': issue.pk, 'version': issue.version, 'text': '本人已修订'}, self.a).status_code, 200)
        after = self.client.get('/api/review/inbox/').data
        self.assertEqual(len(after['items']), 1)
        self.assertEqual(after['items'][0]['message_key'], item['message_key'])
        self.assertEqual(after['unread_count'], 0)
        self.assertTrue(after['items'][0]['is_read'])
        self.assertEqual(self.client.post('/api/review/inbox/read/', read, format='json').status_code, 200)
