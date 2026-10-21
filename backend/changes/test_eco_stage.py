import importlib
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace

from django.apps import apps
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ActionTask, ChangeRequest, EcoActionResponse
from .serializers import ChangeRequestSerializer
from .test_publication import PublicationFixture


class EcoFixture(PublicationFixture):
    def setUp(self):
        super().setUp()
        self.approve(); self.publish()
        self.eco = self.create_eco()
        self.eco.stage_approvers.set([self.a])
        self.ecr_path = self.path; self.path = f'/api/changes/{self.eco.pk}/'
        self.source_before = ChangeRequestSerializer(self.source).data
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.patch(self.path, {'eco_no': 'ECO-STAGE', 'publisher_id': self.d.pk}, format='json').status_code, 200)

    def assign(self, key='eco_001', owner=None, extra=True):
        self.client.force_authenticate(self.a)
        return self.client.patch(self.path + f'eco-actions/{key}/', {'owner_user_ids': [(owner or self.b).pk], 'extra_required': extra}, format='json')

    def submit(self, round=0, **extra):
        self.client.force_authenticate(self.a)
        payload = {'request_id': str(uuid.uuid4()), 'expected_round': round, **extra}
        return self.client.post(self.path + 'stage-submission/', payload, format='json'), payload

    def save(self, task, status='completed', text='ECO result'):
        task.refresh_from_db(); self.client.force_authenticate(task.owner)
        payload = {'request_id': str(uuid.uuid4()), 'version': task.version, 'result': text, 'status': status, 'date': '2026-10-13'}
        return self.client.patch(self.path + f'action-tasks/{task.pk}/', payload, format='json'), payload

    def confirm(self, task):
        task.refresh_from_db(); self.client.force_authenticate(task.owner)
        payload = {'request_id': str(uuid.uuid4()), 'version': task.version}
        return self.client.post(self.path + f'action-tasks/{task.pk}/', payload, format='json'), payload

    def review(self, kind, actor, round=1, **values):
        self.client.force_authenticate(actor)
        return self.client.post(self.path + f'review-rounds/{round}/{kind}/', {'request_id': str(uuid.uuid4()), **values}, format='json')

    def publish_eco(self):
        self.client.force_authenticate(self.d)
        payload = {'request_id': str(uuid.uuid4()), 'expected_round': self.eco.current_review_round}
        self.eco.refresh_from_db(); payload['expected_round'] = self.eco.current_review_round
        return self.client.post(self.path + 'publication/', payload, format='json'), payload

    def approve_stage(self, number=1):
        client = APIClient(); client.force_authenticate(self.a)
        self.assertEqual(client.post(self.path + f'review-rounds/{number}/approve/', {'request_id': str(uuid.uuid4())}, format='json').status_code, 200)


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class EcoStageTests(EcoFixture, TestCase):
    def test_scope_number_publisher_trigger_and_zero_task_guards(self):
        self.assertEqual(connection.vendor, 'mysql')
        self.assign(extra=False)
        self.assertEqual(self.submit()[0].status_code, 400)
        self.eco.refresh_from_db(); self.assertEqual(self.eco.status, 'draft')
        for field, value in [('eco_no', ''), ('publisher_id', None)]:
            self.client.patch(self.path, {field: value}, format='json')
            self.assertEqual(self.submit(acknowledge_no_tasks=True)[0].status_code, 400)
            self.client.patch(self.path, {field: 'ECO-STAGE' if field == 'eco_no' else self.d.pk}, format='json')
        self.client.patch(self.path + 'questions/', {'responses': {'1': {'answer': 'Y'}}}, format='json')
        response, payload = self.submit(); self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['stage'], 'eco'); self.assertEqual(response.data['tasks'][0]['action_key'], 'eco_001')
        self.assertEqual(self.client.post(self.path + 'stage-submission/', payload, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.path + 'stage-submission/', {**payload, 'acknowledge_no_tasks': True}, format='json').status_code, 409)
        self.assertEqual(self.eco.review_rounds.count(), 1)
        self.assertEqual(self.eco.review_rounds.get().ecr_no, self.source.ecr_no)

    def test_owner_tasks_implementation_state_receipts_and_explicit_approval(self):
        self.assign(owner=self.a); self.assign('eco_002', self.b)
        self.assertEqual(self.submit()[0].status_code, 200)
        own, other = self.eco.review_rounds.get().tasks.order_by('action_key')
        self.assertEqual(self.client.patch(self.path, {'title': 'locked'}, format='json').status_code, 409)
        self.assertEqual(self.client.patch(self.path + f'action-tasks/{other.pk}/', {'request_id': str(uuid.uuid4()), 'version': 1, 'result': 'forged'}, format='json').status_code, 404)
        response, payload = self.save(own, status='implementation_stage'); self.assertEqual(response.status_code, 200)
        self.assertEqual(self.confirm(own)[0].status_code, 400)
        own.refresh_from_db(); self.assertIsNone(own.confirmed_at)
        self.assertEqual(self.client.patch(self.path + f'action-tasks/{own.pk}/', payload, format='json').status_code, 200)
        self.save(own, status='not_applicable', text='not applicable reason'); self.assertEqual(self.confirm(own)[0].status_code, 200)
        self.save(other); response, confirmation = self.confirm(other); self.assertEqual(response.status_code, 200)
        self.eco.refresh_from_db(); self.assertEqual(self.eco.status, 'pending')
        self.approve_stage()
        self.eco.refresh_from_db(); self.assertEqual(self.eco.status, 'approved')
        self.assertEqual(self.client.post(self.path + f'action-tasks/{other.pk}/', confirmation, format='json').status_code, 200)
        self.assertEqual(self.review('approve', self.b).status_code, 409)
        self.source.refresh_from_db(); self.assertEqual(ChangeRequestSerializer(self.source).data, self.source_before)

    def test_return_reassignment_new_round_and_original_author_resolution(self):
        self.assign(owner=self.a); self.assign('eco_002', self.b); self.submit()
        old = list(self.eco.review_rounds.get().tasks.order_by('action_key'))
        self.save(old[0]); self.confirm(old[0])
        self.assertEqual(self.review('return', self.b, issues=[{'tab': 'eco', 'location': 'eco_002', 'text': 'revise ECO'}]).status_code, 200)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.assertIsNone(self.client.get(self.path + 'stage-workflow/').data['change'])
        issue = self.eco.review_issues.get()
        self.assertEqual(self.review('respond', self.a, issue_id=issue.pk, version=issue.version, text='fixed').status_code, 200)
        self.assign('eco_002', self.d)
        self.assertEqual(self.submit(1)[0].status_code, 200)
        self.assertEqual(self.confirm(old[0])[0].status_code, 409)
        current = list(self.eco.review_rounds.get(number=2).tasks.order_by('action_key'))
        self.assertTrue(all(task.confirmed_at is None for task in current)); self.assertEqual(current[0].result, 'ECO result')
        for task in current:
            self.save(task); self.assertEqual(self.confirm(task)[0].status_code, 200)
        self.eco.refresh_from_db(); self.assertEqual(self.eco.status, 'pending')
        self.assertEqual(self.review('return', self.b, round=2, issues=[{'tab': 'eco', 'text': 'new unauthorized issue'}]).status_code, 403)
        issue.refresh_from_db()
        self.assertEqual(self.review('resolve', self.b, round=2, issue_id=issue.pk, version=issue.version, text='verified').status_code, 200)
        self.approve_stage(2)
        self.eco.refresh_from_db(); self.assertEqual(self.eco.status, 'approved')
        history = self.client.get(self.path + 'review-rounds/2/').data['history']
        self.assertEqual(history[0]['tasks'][0]['result'], 'ECO result')
        self.assertEqual(self.publish_eco()[0].status_code, 200)
        old[0].refresh_from_db(); self.assertIsNotNone(old[0].confirmed_at)

    def test_source_summary_navigation_and_independent_publication(self):
        self.assign(); self.submit()
        self.client.force_authenticate(self.b)
        brief = self.client.get(self.path + 'source-ecr/'); self.assertEqual(brief.status_code, 200)
        self.assertEqual(brief.data['overview']['title'], self.source.title); self.assertFalse(brief.data['can_open'])
        self.assertNotIn('tasks', brief.data); self.assertNotIn('review_issues', brief.data)
        self.assertEqual(self.client.get(self.ecr_path).status_code, 404)
        nav = self.client.get(self.path + 'stage-navigation/').data
        self.assertEqual(nav['stages'][0]['status'], 'published'); self.assertFalse(nav['stages'][0]['can_open'])
        self.assertIsNone(nav['stages'][0]['total']); self.assertTrue(nav['stages'][1]['can_open'])
        self.assertEqual(self.client.get(self.path + 'ecr-actions/').status_code, 200)
        task = self.eco.review_rounds.get().tasks.get(); self.save(task); self.confirm(task)
        self.approve_stage()
        self.client.force_authenticate(self.c)
        self.eco.refresh_from_db()
        masked = self.client.get(self.ecr_path + 'stage-navigation/').data['stages'][1]
        self.assertEqual(masked['status'], 'approved'); self.assertEqual(masked['id'], self.eco.pk); self.assertEqual(masked['number'], self.eco.eco_no)
        self.assertEqual(self.client.get(self.path).status_code, 200)
        self.assertEqual(self.client.patch(self.path, {'title': 'read only'}, format='json').status_code, 409)
        response, payload = self.publish_eco(); self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['can_create_eco']); self.assertIsNone(response.data['eco_id'])
        self.assertEqual(self.client.post(self.path + 'publication/', payload, format='json').status_code, 200)
        self.assertEqual(len(self.client.get('/api/publications/?stage=eco&state=published').data), 1)
        self.assertFalse(self.client.get('/api/ecr-publications/?state=published').data)
        self.assertEqual(self.client.get(self.path + 'stage-navigation/').data['stages'][1]['status'], 'published')
        self.client.force_authenticate(self.a)
        for suffix, body in [('', {'title': 'edit'}), ('questions/', {'responses': {}}), ('eco-actions/eco_001/', {'owner_user_ids': [self.a.pk]}),
                             ('emc/', {}), ('execution-plan/', {}), ('significant-change/', {})]:
            self.assertEqual(self.client.patch(self.path + suffix, body, format='json').status_code, 409, suffix)
        self.assertEqual(self.client.delete(self.path).status_code, 409)
        self.source.refresh_from_db(); self.assertEqual(ChangeRequestSerializer(self.source).data, self.source_before)

    def test_zero_task_publication_inbox_reads_are_unique_and_do_not_publish(self):
        self.client.patch(self.path, {'publisher_id': self.a.pk}, format='json')
        response, _ = self.submit(acknowledge_no_tasks=True); self.assertEqual(response.status_code, 200)
        self.approve_stage()
        inbox = self.client.get('/api/review/inbox/').data
        items = [item for item in inbox['items'] if item['change_id'] == self.eco.pk]
        self.assertEqual(len(items), 1); self.assertEqual(items[0]['status'], 'approved'); self.assertEqual(items[0]['stage'], 'eco')
        mark = {'items': [{key: items[0][key] for key in ['change_id', 'round', 'message_key']}]}
        self.assertEqual(self.client.post('/api/review/inbox/read/', mark, format='json').status_code, 200)
        reread = next(item for item in self.client.get('/api/review/inbox/').data['items'] if item['change_id'] == self.eco.pk)
        self.assertTrue(reread['is_read'])
        self.eco.refresh_from_db(); self.assertEqual(self.eco.status, 'approved')
        response = self.client.post(self.path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 1}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(any(item['change_id'] == self.eco.pk for item in self.client.get('/api/review/inbox/').data['items']))

    def test_return_progress_and_self_messages_migration_guard(self):
        empty_ecr = ChangeRequest.objects.create(applicant=self.a, stage='ecr', title='not submitted')
        self.assertEqual(self.client.get(f'/api/changes/{empty_ecr.pk}/stage-navigation/').data['stages'][1]['status'], 'not_created')
        self.assign(owner=self.a); self.submit()
        self.assertEqual(self.review('return', self.a, issues=[{'tab': 'eco', 'text': 'self correction'}]).status_code, 200)
        nav = self.client.get(self.path + 'stage-navigation/').data['stages'][1]
        self.assertEqual(nav['status'], 'returned'); self.assertEqual(nav['confirmed'], 0)
        issue = self.eco.review_issues.get()
        self.assertEqual(self.review('respond', self.a, issue_id=issue.pk, version=issue.version, text='fixed').status_code, 200)
        own = [item for item in self.client.get('/api/review/inbox/').data['items'] if item['change_id'] == self.eco.pk]
        self.assertEqual(len(own), 1)
        migration = importlib.import_module('changes.migrations.0021_eco_stage_navigation')
        self.assertEqual(migration.Migration.operations[-1].reverse_code, migration.prevent_eco_task_loss)
        with self.assertRaises(RuntimeError):
            migration.prevent_eco_task_loss(apps, SimpleNamespace(connection=connection))


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class EcoConcurrencyTests(EcoFixture, TransactionTestCase):
    def test_last_confirmation_competes_with_return_without_source_mutation(self):
        self.assign(); self.submit(); task = self.eco.review_rounds.get().tasks.get(); self.save(task); task.refresh_from_db()
        barrier = Barrier(2)
        def action(kind):
            close_old_connections()
            try:
                client = APIClient(); client.force_authenticate(get_user_model().objects.get(pk=self.b.pk)); barrier.wait(timeout=10)
                if kind == 'confirm':
                    return client.post(self.path + f'action-tasks/{task.pk}/', {'request_id': str(uuid.uuid4()), 'version': task.version}, format='json').status_code
                return client.post(self.path + 'review-rounds/1/return/', {'request_id': str(uuid.uuid4()), 'issues': [{'tab': 'eco', 'text': 'competing return'}]}, format='json').status_code
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(action, ['confirm', 'return']))
        self.assertIn(sorted(results), [[200, 200], [200, 409]])
        self.eco.refresh_from_db(); self.assertEqual(self.eco.status, 'returned')
        self.source.refresh_from_db(); self.assertEqual(ChangeRequestSerializer(self.source).data, self.source_before)

    def test_parallel_eco_publication_finishes_once(self):
        self.submit(acknowledge_no_tasks=True); self.approve_stage(); barrier = Barrier(2)
        def publish():
            close_old_connections()
            try:
                client = APIClient(); client.force_authenticate(get_user_model().objects.get(pk=self.d.pk)); barrier.wait(timeout=10)
                return client.post(self.path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 1}, format='json').status_code
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: publish(), range(2)))
        self.assertEqual(sorted(results), [200, 409]); self.eco.refresh_from_db(); self.assertEqual(self.eco.status, 'published')
