import uuid
import importlib
from types import SimpleNamespace
from django.apps import apps
from django.db import connection
from django.db import close_old_connections
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from django.utils import timezone
from django.test import TestCase
from rest_framework.test import APIClient
from .models import ChangeRequest, EcoFillerEvent
from .test_publication import PublicationFixture


class EcoFillerTests(PublicationFixture, TestCase):
    def setUp(self):
        super().setUp()
        self.approve(); self.publish()
        self.client.force_authenticate(self.c)
        self.assertIn(self.source.pk, [row['id'] for row in self.client.get('/api/ecr-publications/?state=published').data])
        self.assertEqual(self.client.get(self.path + 'stage-navigation/').data['stages'][1]['status'], 'not_created')
        self.creation = {'request_id': str(uuid.uuid4()), 'filler_id': self.b.pk}
        response = self.client.post(self.path + 'eco/', self.creation, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.eco = ChangeRequest.objects.get(pk=response.data['change']['id'])
        self.eco_path = f'/api/changes/{self.eco.pk}/'

    def transfer(self, target, actor=None, **extra):
        self.eco.refresh_from_db()
        self.client.force_authenticate(actor or self.b)
        payload = {'request_id': str(uuid.uuid4()), 'filler_id': target.pk, 'expected_filler_id': self.eco.applicant_id,
                   'expected_updated_at': self.eco.updated_at.isoformat(), **extra}
        return self.client.post(self.eco_path + 'eco-filler/', payload, format='json'), payload

    def test_any_filler_and_coordinator_read_only_every_sheet(self):
        self.assertEqual(self.eco.applicant_id, self.b.pk)
        for actor in [self.a, self.c, self.b]:
            self.client.force_authenticate(actor)
            for resource in ['', 'materials/', 'questions/', 'ecr-actions/', 'eco-actions/', 'emc/', 'execution-plan/', 'significant-change/', 'source-ecr/', 'stage-navigation/', 'stage-workflow/', 'eco-filler/']:
                self.assertEqual(self.client.get(self.eco_path + resource).status_code, 200, (actor.pk, resource))
            if actor != self.b:
                for resource in ['', 'questions/', 'eco-actions/eco_001/', 'emc/', 'execution-plan/', 'significant-change/']:
                    self.assertEqual(self.client.patch(self.eco_path + resource, {}, format='json').status_code, 409, resource)
                self.assertEqual(self.client.post(self.eco_path + 'materials/', {}, format='json').status_code, 409)
                self.assertEqual(self.client.post(self.eco_path + 'stage-submission/', {'request_id': str(uuid.uuid4()), 'expected_round': 0}, format='json').status_code, 409)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.assertIn(self.eco.pk, [row['id'] for row in self.client.get('/api/changes/').data])
        self.assertEqual(self.client.patch(self.eco_path, {'eco_no': 'ASSIGNED-ECO'}, format='json').status_code, 200)
        self.client.force_authenticate(self.d)
        self.assertEqual(self.client.get(self.eco_path).status_code, 404)
        self.assertEqual(self.client.post(self.path + 'eco/', {'request_id': str(uuid.uuid4()), 'filler_id': self.d.pk}, format='json').status_code, 404)

    def test_transfer_preserves_content_and_old_window_cannot_write(self):
        self.eco.publisher = self.c; self.eco.eco_no = 'PRESERVE'; self.eco.save()
        self.eco.stage_approvers.set([self.a, self.c])
        before_questions = list(self.eco.question_responses.values_list('number', 'answer', 'remark'))
        source_time = self.source.updated_at
        response, payload = self.transfer(self.d)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data['assignment'])
        self.eco.refresh_from_db(); self.source.refresh_from_db()
        self.assertEqual(self.eco.applicant_id, self.d.pk)
        self.assertEqual(self.eco.publisher_id, self.c.pk)
        self.assertEqual(self.eco.eco_no, 'PRESERVE')
        self.assertEqual(set(self.eco.stage_approvers.values_list('pk', flat=True)), {self.a.pk, self.c.pk})
        self.assertEqual(before_questions, list(self.eco.question_responses.values_list('number', 'answer', 'remark')))
        self.assertEqual(self.source.updated_at, source_time)
        self.assertEqual(self.client.patch(self.eco_path, {'title': 'stale'}, format='json').status_code, 409)
        self.assertEqual(self.client.get(self.eco_path).status_code, 404)
        self.assertEqual(self.client.get(self.eco_path + 'eco-filler/requests/' + payload['request_id'] + '/').status_code, 200)
        self.assertEqual(self.client.post(self.eco_path + 'eco-filler/', payload, format='json').status_code, 200)
        self.assertEqual(self.eco.filler_events.filter(kind='transfer').count(), 1)
        self.assertEqual(self.client.post(self.eco_path + 'eco-filler/', {**payload, 'filler_id': self.a.pk}, format='json').status_code, 409)
        self.client.force_authenticate(self.d)
        self.assertEqual(self.client.patch(self.eco_path, {'title': 'new filler'}, format='json').status_code, 200)
        self.client.force_authenticate(self.b)
        self.assertNotIn(self.eco.pk, [row['id'] for row in self.client.get('/api/changes/').data])

    def test_creation_retry_after_handoff_keeps_current_filler(self):
        response, _ = self.transfer(self.d, self.a)
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(self.c)
        repeated = self.client.post(self.path + 'eco/', self.creation, format='json')
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.data['receipt']['filler_id'], self.b.pk)
        self.assertEqual(repeated.data['change']['applicant'], self.d.pk)
        self.assertEqual(self.client.post(self.path + 'eco/', {**self.creation, 'filler_id': self.c.pk}, format='json').status_code, 409)
        self.client.force_authenticate(self.d)
        self.assertEqual(self.client.get(self.eco_path + 'eco-filler/requests/' + self.creation['request_id'] + '/').status_code, 404)

    def test_returned_transfer_keeps_tasks_and_opinion_authors(self):
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.patch(self.eco_path, {'eco_no': 'RETURN-HANDOFF', 'publisher_id': self.c.pk, 'stage_approver_ids': [self.a.pk]}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(self.eco_path + 'eco-actions/eco_001/', {'owner_user_ids': [self.b.pk, self.c.pk], 'extra_required': True}, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.eco_path + 'stage-submission/', {'request_id': str(uuid.uuid4()), 'expected_round': 0}, format='json').status_code, 200)
        self.client.force_authenticate(self.c)
        self.assertEqual(self.client.post(self.eco_path + 'review-rounds/1/return/', {'request_id': str(uuid.uuid4()), 'issues': [{'tab': 'eco', 'text': '修订后交接'}]}, format='json').status_code, 200)
        before = list(self.eco.review_rounds.get().tasks.values_list('id', 'owner_id', 'confirmed_at'))
        self.assertEqual(self.transfer(self.d, self.a)[0].status_code, 200)
        self.assertEqual(before, list(self.eco.review_rounds.get().tasks.values_list('id', 'owner_id', 'confirmed_at')))
        issue = self.eco.review_issues.get(); self.assertEqual(issue.author_id, self.c.pk)
        self.client.force_authenticate(self.d)
        self.assertEqual(self.client.post(self.eco_path + 'review-rounds/1/respond/', {'request_id': str(uuid.uuid4()), 'issue_id': issue.pk, 'version': issue.version, 'text': '由新填写人回应'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(self.eco_path + f'action-tasks/{before[0][0]}/', {'request_id': str(uuid.uuid4()), 'version': 1, 'result': '不能代填'}, format='json').status_code, 404)

    def test_stale_transfer_disabled_target_and_stage_lock(self):
        self.d.is_active = False; self.d.save()
        response, _ = self.transfer(self.d)
        self.assertEqual(response.status_code, 400)
        self.d.is_active = True; self.d.save()
        stale = self.eco.updated_at.isoformat()
        self.eco.title = 'saved later'; self.eco.save()
        response, _ = self.transfer(self.d, expected_updated_at=stale)
        self.assertEqual(response.status_code, 409)
        for state in ['pending', 'approved']:
            self.eco.status = state; self.eco.save()
            response, _ = self.transfer(self.d)
            self.assertEqual(response.status_code, 409)
            self.assertFalse(self.client.get(self.eco_path + 'eco-filler/').data['can_transfer'])
        self.eco.status = 'returned'; self.eco.save()
        response, _ = self.transfer(self.a, self.c)
        self.assertEqual(response.status_code, 200)

    def test_baseline_preserves_existing_writer_and_real_history_prevents_rollback(self):
        self.eco.filler_events.all().delete()
        before = (self.eco.applicant_id, self.eco.status, self.eco.updated_at)
        migration = importlib.import_module('changes.migrations.0023_eco_filler_handoff')
        editor = SimpleNamespace(connection=connection)
        migration.baseline(apps, editor)
        self.eco.refresh_from_db()
        self.assertEqual(before, (self.eco.applicant_id, self.eco.status, self.eco.updated_at))
        event = self.eco.filler_events.get()
        self.assertEqual(event.kind, 'baseline'); self.assertIsNone(event.actor_id); self.assertIsNone(event.request_id)
        migration.prevent_history_loss(apps, editor)
        self.assertEqual(self.transfer(self.a, self.c)[0].status_code, 200)
        with self.assertRaises(RuntimeError): migration.prevent_history_loss(apps, editor)

    def test_self_creation_and_strict_inputs_and_final_publication_lock(self):
        self.client.force_authenticate(self.c)
        source = ChangeRequest.objects.create(applicant=self.a, stage='ecr', status='published', title='Self fill', ecr_no='SELF-FILL', publisher=self.c, published_by=self.c, published_at=timezone.now(), publication_request_id=uuid.uuid4())
        created = self.client.post(f'/api/changes/{source.pk}/eco/', {'request_id': str(uuid.uuid4()), 'filler_id': self.c.pk}, format='json')
        self.assertEqual(created.status_code, 201); self.assertEqual(created.data['change']['applicant'], self.c.pk)
        for payload in [{}, {'request_id': str(uuid.uuid4())}, {'request_id': str(uuid.uuid4()), 'filler_id': True}, {'request_id': str(uuid.uuid4()), 'filler_id': str(self.c.pk)}]:
            self.assertEqual(self.client.post(self.path + 'eco/', payload, format='json').status_code, 400)
        self.eco.status = 'published'; self.eco.published_at = timezone.now(); self.eco.published_by = self.c; self.eco.publication_request_id = uuid.uuid4(); self.eco.save()
        response, _ = self.transfer(self.a, self.c)
        self.assertEqual(response.status_code, 409)
        self.assertFalse(self.client.get(self.eco_path + 'eco-filler/').data['can_transfer'])


class EcoFillerConcurrencyTests(TransactionTestCase):
    def test_parallel_handoffs_have_one_winner_and_no_lost_history(self):
        author, publisher, filler, target = [get_user_model().objects.create_user('handoff-' + name) for name in ['author', 'publisher', 'filler', 'target']]
        source = ChangeRequest.objects.create(applicant=author, stage='ecr', status='published', title='Race', ecr_no='HANDOFF-RACE', publisher=publisher, published_by=publisher, published_at=timezone.now(), publication_request_id=uuid.uuid4())
        eco = ChangeRequest.objects.create(applicant=filler, stage='eco', source_ecr=source, eco_creation_request_id=uuid.uuid4(), title='Original')
        barrier = Barrier(2)
        def handoff(actor_id, target_id):
            close_old_connections()
            try:
                client = APIClient(); client.force_authenticate(get_user_model().objects.get(pk=actor_id))
                barrier.wait(timeout=10)
                return client.post(f'/api/changes/{eco.pk}/eco-filler/', {'request_id': str(uuid.uuid4()), 'filler_id': target_id, 'expected_filler_id': filler.pk, 'expected_updated_at': eco.updated_at.isoformat()}, format='json').status_code
            finally: close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(handoff, author.pk, target.pk), pool.submit(handoff, publisher.pk, author.pk)]
            self.assertEqual(sorted(future.result(timeout=20) for future in futures), [200, 409])
        eco.refresh_from_db()
        self.assertIn(eco.applicant_id, [author.pk, target.pk]); self.assertEqual(eco.title, 'Original')
        self.assertEqual(eco.filler_events.filter(kind='transfer').count(), 1)
