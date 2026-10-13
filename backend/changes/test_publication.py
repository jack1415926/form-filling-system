import importlib
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch

from django.apps import apps
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (ChangeRequest, QuestionResponse, MaterialChange, MaterialDisposition,
                     ExecutionPlanResponse, SignificantAssessment, SignificantChartResponse,
                     SignificantQuestionResponse, ActionTask, ReviewIssue)
from .emc_views import matrix_data, persist
from .dispositions import LOCATIONS
from .execution_plan import PLAN_ACTIVITY_IDS
from .significant_change import QUESTION_IDS


class PublicationFixture:
    def setUp(self):
        self.a, self.b, self.c, self.d = [get_user_model().objects.create_user('publish-' + name) for name in 'abcd']
        self.client = APIClient(); self.client.force_authenticate(self.a)
        self.source = ChangeRequest.objects.create(applicant=self.a, stage='ecr', publisher=self.c, title='Baseline', ecr_no='ECR-PUB')
        QuestionResponse.objects.bulk_create([QuestionResponse(change=self.source, number=n, answer='N', remark='original') for n in range(1, 28)])
        self.path = f'/api/changes/{self.source.pk}/'

    def approve(self, with_task=False):
        self.client.force_authenticate(self.a)
        self.source.stage_approvers.set([self.a])
        if with_task:
            self.assertEqual(self.client.patch(self.path + 'ecr-actions/ecr_001/', {'owner_user_id': self.b.pk, 'extra_required': True}, format='json').status_code, 200)
        response = self.client.post(self.path + 'stage-submission/', {'request_id': str(uuid.uuid4()), 'expected_round': 0, 'acknowledge_no_tasks': not with_task}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        if with_task:
            task = ActionTask.objects.get(round__change=self.source)
            self.client.force_authenticate(self.b)
            url = self.path + f'action-tasks/{task.pk}/'
            self.save_payload = {'request_id': str(uuid.uuid4()), 'version': 1, 'result': 'confirmed baseline', 'status': 'completed', 'date': '2026-10-13'}
            self.assertEqual(self.client.patch(url, self.save_payload, format='json').status_code, 200)
            self.confirm_payload = {'request_id': str(uuid.uuid4()), 'version': 2}
            self.assertEqual(self.client.post(url, self.confirm_payload, format='json').status_code, 200)
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.post(self.path + 'review-rounds/1/approve/', {'request_id': str(uuid.uuid4())}, format='json').status_code, 200)
        self.source.refresh_from_db(); self.assertEqual(self.source.status, 'approved')

    def publish(self):
        self.client.force_authenticate(self.c)
        self.publish_payload = {'request_id': str(uuid.uuid4()), 'expected_round': 1}
        response = self.client.post(self.path + 'publication/', self.publish_payload, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.source.refresh_from_db()
        return response

    def create_eco(self):
        self.client.force_authenticate(self.a)
        self.creation_payload = {'request_id': str(uuid.uuid4()), 'filler_id': self.a.pk}
        response = self.client.post(self.path + 'eco/', self.creation_payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return ChangeRequest.objects.get(pk=response.data['change']['id'])


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class PublicationTests(PublicationFixture, TestCase):
    def test_publisher_without_task_read_only_access_lists_and_terminal_receipts(self):
        self.client.force_authenticate(self.c)
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.approve(with_task=True)
        self.client.force_authenticate(self.c)
        self.assertEqual(len(self.client.get('/api/ecr-publications/').data), 1)
        for suffix in ['', 'materials/', 'questions/', 'ecr-actions/', 'emc/', 'execution-plan/', 'significant-change/', 'stage-workflow/']:
            self.assertEqual(self.client.get(self.path + suffix).status_code, 200, suffix)
        review = self.client.get(self.path + 'review-rounds/1/').data
        self.assertTrue(review['can_view_form']); self.assertFalse(review['can_return']); self.assertFalse(review['can_approve'])
        self.assertEqual(self.source.review_records.filter(reviewer=self.c).count(), 0)
        self.publish(); stamp = self.source.published_at
        self.assertEqual(self.client.post(self.path + 'publication/', self.publish_payload, format='json').status_code, 200)
        self.source.refresh_from_db(); self.assertEqual(self.source.published_at, stamp)
        self.assertEqual(self.client.post(self.path + 'publication/', {**self.publish_payload, 'expected_round': 2}, format='json').status_code, 409)
        self.assertEqual(len(self.client.get('/api/ecr-publications/?state=published').data), 1)
        self.assertFalse(self.client.get('/api/ecr-publications/').data)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(self.path).status_code, 200)
        self.assertTrue(self.client.get(self.path + 'review-rounds/1/').data['can_view_form'])
        task = ActionTask.objects.get(round__change=self.source)
        self.assertEqual(self.client.patch(self.path + f'action-tasks/{task.pk}/', self.save_payload, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.path + f'action-tasks/{task.pk}/', self.confirm_payload, format='json').status_code, 200)
        self.assertEqual(self.client.patch(self.path + f'action-tasks/{task.pk}/', {**self.save_payload, 'request_id': str(uuid.uuid4())}, format='json').status_code, 409)

    def test_publish_and_creation_permissions_account_binding_and_strict_fields(self):
        self.assertEqual(connection.vendor, 'mysql')
        self.approve()
        for actor in [self.a, self.d]:
            self.client.force_authenticate(actor)
            self.assertIn(self.client.post(self.path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 1}, format='json').status_code, [404, 409])
        self.d.is_staff = self.d.is_superuser = True; self.d.save()
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.post(self.path + 'eco/', {'request_id': str(uuid.uuid4()), 'filler_id': self.a.pk}, format='json').status_code, 409)
        self.client.force_authenticate(self.c)
        self.assertEqual(self.client.post(self.path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 1}, format='json', HTTP_X_EXPECTED_USER=str(self.a.pk)).status_code, 409)
        self.assertEqual(self.client.post(self.path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 1, 'status': 'published'}, format='json').status_code, 400)
        self.c.is_active = False; self.c.save()
        self.assertIn(self.client.post(self.path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 1}, format='json').status_code, [404, 409])
        self.c.is_active = True; self.c.save(); self.publish()
        self.assertEqual(self.client.post(self.path + 'eco/', {'request_id': str(uuid.uuid4()), 'filler_id': self.a.pk}, format='json').status_code, 201)
        self.client.force_authenticate(self.a)
        for field in ['stage', 'source_ecr_id', 'publication_request_id', 'published_at', 'eco_creation_request_id']:
            self.assertEqual(self.client.post('/api/changes/', {field: 'forged'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.path + 'eco/', {'request_id': str(uuid.uuid4()), 'eco_no': 'forged'}, format='json').status_code, 400)

    def test_publication_rechecks_current_round_tasks_and_issues(self):
        self.approve(with_task=True)
        self.client.force_authenticate(self.c)
        payload = {'request_id': str(uuid.uuid4()), 'expected_round': 1}
        self.assertEqual(self.client.post(self.path + 'publication/', {**payload, 'expected_round': 2}, format='json').status_code, 409)
        task = ActionTask.objects.get(round__change=self.source)
        stamp = task.confirmed_at; task.confirmed_at = None; task.save()
        self.assertEqual(self.client.post(self.path + 'publication/', payload, format='json').status_code, 409)
        task.confirmed_at = stamp; task.save()
        ReviewIssue.objects.create(change=self.source, source_round=task.round, author=self.b, tab='ecr', text='unresolved')
        self.assertEqual(self.client.post(self.path + 'publication/', payload, format='json').status_code, 409)
        self.assertFalse(hasattr(self.source, 'emc_reference'))

    def test_published_base_rejects_every_write_and_default_emc_is_frozen(self):
        material = MaterialChange.objects.create(change=self.source, category='addition', material_no='SOURCE')
        self.approve(); self.publish()
        matrix = matrix_data(self.source)
        self.assertTrue(matrix['initialized'])
        with patch('changes.emc_views.REFERENCE', {'title': 'changed template'}):
            self.assertEqual(matrix_data(self.source), matrix)
        self.client.force_authenticate(self.a)
        for suffix, body in [('', {'title': 'overwrite'}), ('questions/', {'responses': {'1': {'answer': 'Y'}}}),
            ('ecr-actions/ecr_001/', {'owner_user_id': self.a.pk}), ('eco-actions/eco_001/', {'owner_user_id': self.a.pk}),
            ('emc/', {'cells': {}}), ('execution-plan/', {}), ('significant-change/', {}),
            (f'materials/{material.pk}/', {'description': 'overwrite'})]:
            self.assertEqual(self.client.patch(self.path + suffix, body, format='json').status_code, 409, suffix)
        self.assertEqual(self.client.post(self.path + 'materials/', {'category': 'addition'}, format='json').status_code, 409)
        self.assertEqual(self.client.delete(self.path).status_code, 409)
        self.assertEqual(self.client.delete(self.path + f'materials/{material.pk}/').status_code, 409)

    def test_complete_copy_new_foreign_keys_independent_edits_and_no_workflow_copy(self):
        material = MaterialChange.objects.create(change=self.source, category='addition', request_id=uuid.uuid4(), material_no='SOURCE', description='original')
        location, group = next(iter(LOCATIONS.items()))
        MaterialDisposition.objects.create(material=material, location_group=group, location_item=location, remark='original')
        plan = ExecutionPlanResponse.objects.create(change=self.source, activity_key=PLAN_ACTIVITY_IDS[0], owner='initial', remark='plan')
        SignificantAssessment.objects.create(change=self.source)
        SignificantChartResponse.objects.create(change=self.source, chart_key='A', reason='original')
        SignificantQuestionResponse.objects.create(change=self.source, question_key=QUESTION_IDS[0], reason='original')
        matrix = matrix_data(self.source); row = matrix['rows'][0]['id']; test = matrix['tests'][0]['id']
        matrix['cells'][f'{row}/{test}'] = {'mark': 'X', 'remark': 'original'}; persist(self.source, matrix)
        self.approve(with_task=True); self.publish(); baseline = matrix_data(self.source)
        eco = self.create_eco(); path = f'/api/changes/{eco.pk}/'
        self.assertEqual((eco.stage, eco.status, eco.ecr_no, eco.eco_no, eco.current_review_round, eco.publisher_id), ('eco', 'draft', '', '', 0, None))
        self.assertEqual(eco.source_ecr_id, self.source.pk)
        for relation in ['question_responses', 'execution_plan_responses', 'significant_charts', 'significant_questions']:
            original = list(getattr(self.source, relation).all()); copied = list(getattr(eco, relation).all())
            self.assertEqual(len(original), len(copied)); self.assertTrue(all(a.pk != b.pk for a, b in zip(original, copied)))
        self.assertNotEqual(eco.significant_assessment.pk, self.source.significant_assessment.pk)
        copied_material = eco.materials.get(); self.assertNotEqual(copied_material.pk, material.pk); self.assertIsNone(copied_material.request_id)
        self.assertEqual(copied_material.dispositions.get().remark, 'original')
        self.assertEqual(list(eco.question_responses.values_list('number', 'answer', 'remark')), list(self.source.question_responses.values_list('number', 'answer', 'remark')))
        self.assertEqual(eco.execution_plan_responses.get().remark, 'plan')
        self.assertEqual(eco.significant_charts.get().reason, 'original')
        self.assertEqual(eco.significant_questions.get().reason, 'original')
        self.assertEqual(matrix_data(eco)['cells'], baseline['cells'])
        self.assertNotEqual(eco.emc_reference.pk, self.source.emc_reference.pk)
        cell = eco.emc_reference.cells.get(); self.assertEqual(cell.row.reference_id, eco.emc_reference.pk); self.assertEqual(cell.test.reference_id, eco.emc_reference.pk)
        for relation in ['review_rounds', 'review_records', 'review_issues', 'ecr_responses', 'eco_responses']:
            self.assertEqual(getattr(eco, relation).count(), 0)
        self.assertEqual(self.client.patch(path, {'title': 'ECO revised', 'eco_no': 'ECO-INDEPENDENT'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(path + 'questions/', {'responses': {'1': {'answer': 'Y', 'remark': 'ECO'}}}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(path + f'materials/{copied_material.pk}/', {'description': 'ECO'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(path + 'emc/', {'cells': {f'{row}/{test}': {'mark': '(X)', 'remark': 'ECO'}}}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(path + 'execution-plan/', {'responses': {plan.activity_key: {'remark': 'ECO'}}}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(path + 'significant-change/', {'assessment': {'final_conclusion': 'significant'}, 'charts': {'A': {'reason': 'ECO'}}, 'questions': {QUESTION_IDS[0]: {'reason': 'ECO'}}}, format='json').status_code, 200)
        added = self.client.post(path + 'materials/', {'category': 'addition', 'material_no': 'ECO-only'}, format='json')
        self.assertEqual(added.status_code, 201)
        self.assertFalse(self.source.materials.filter(material_no='ECO-only').exists())
        self.assertEqual(matrix_data(self.source), baseline)
        self.source.refresh_from_db(); material.refresh_from_db(); plan.refresh_from_db()
        self.assertEqual((self.source.title, material.description, plan.remark), ('Baseline', 'original', 'plan'))
        self.assertEqual(self.source.significant_assessment.final_conclusion, '')
        self.assertEqual(self.source.significant_charts.get().reason, 'original')
        self.assertEqual(self.source.significant_questions.get().reason, 'original')
        source_action = self.client.get(path + 'ecr-actions/').data['actions'][0]
        self.assertEqual((source_action['question_answer'], source_action['result']), ('N', 'confirmed baseline'))
        self.assertEqual(self.client.delete(path + f'materials/{copied_material.pk}/').status_code, 204)
        self.assertTrue(MaterialChange.objects.filter(pk=material.pk).exists())

    def test_eco_number_owner_only_actions_replay_and_legacy_rejection(self):
        self.approve(); self.publish(); eco = self.create_eco(); path = f'/api/changes/{eco.pk}/'
        self.assertEqual(self.client.delete(path).status_code, 409)
        for body in [{'ecr_no': 'fake'}, {'source_ecr_id': self.source.pk}, {'stage': 'legacy'}]:
            self.assertEqual(self.client.patch(path, body, format='json').status_code, 400)
        legacy = ChangeRequest.objects.create(applicant=self.a, ecr_no='LEGACY', eco_no='TAKEN')
        self.assertEqual(self.client.patch(path, {'eco_no': 'TAKEN'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(path, {'eco_no': 'UNIQUE', 'title': 'changed'}, format='json').status_code, 200)
        for payload in [self.creation_payload, {'request_id': str(uuid.uuid4()), 'filler_id': self.a.pk}]:
            again = self.client.post(self.path + 'eco/', payload, format='json')
            self.assertEqual(again.status_code, 200); self.assertFalse(again.data['created']); self.assertEqual(again.data['change']['title'], 'changed')
        self.assertEqual(self.client.patch(path + 'eco-actions/eco_001/', {'owner_user_id': self.a.pk}, format='json').status_code, 200)
        for body in [{'result': 'premature'}, {'status': 'completed'}, {'date': '2026-10-13'}]:
            self.assertEqual(self.client.patch(path + 'eco-actions/eco_001/', body, format='json').status_code, 400)
        self.assertEqual(self.client.patch(path + 'ecr-actions/ecr_001/', {'owner_user_id': self.a.pk}, format='json').status_code, 409)
        submission = {'review_mode': 'designated', 'reviewer_ids': [self.b.pk], 'request_id': str(uuid.uuid4())}
        self.assertEqual(self.client.post(path + 'submission/', submission, format='json').status_code, 404)
        self.assertEqual(self.client.post(path + 'stage-submission/', {'request_id': str(uuid.uuid4()), 'expected_round': 0}, format='json').status_code, 400)
        self.assertEqual(self.client.post(path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 1}, format='json').status_code, 409)
        self.assertEqual(self.client.post(f'/api/changes/{legacy.pk}/eco/', {'request_id': str(uuid.uuid4()), 'filler_id': self.a.pk}, format='json').status_code, 409)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_copy_failure_rolls_back_and_migration_guard(self):
        self.approve(); self.publish(); self.client.force_authenticate(self.a)
        def partial_failure(source, eco):
            QuestionResponse.objects.create(change=eco, number=1, answer='N')
            raise RuntimeError('injected copy failure')
        with patch('changes.publication.copy_base', side_effect=partial_failure), self.assertRaises(RuntimeError):
            self.client.post(self.path + 'eco/', {'request_id': str(uuid.uuid4()), 'filler_id': self.a.pk}, format='json')
        self.assertFalse(ChangeRequest.objects.filter(stage='eco').exists())
        self.assertEqual(QuestionResponse.objects.count(), 27)
        migration = importlib.import_module('changes.migrations.0020_ecr_publication_eco')
        self.assertEqual(migration.Migration.operations[-1].reverse_code, migration.prevent_publication_loss)
        with self.assertRaises(RuntimeError):
            migration.prevent_publication_loss(apps, SimpleNamespace(connection=connection))


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class PublicationConcurrencyTests(PublicationFixture, TransactionTestCase):
    def test_parallel_creation_returns_one_eco(self):
        self.approve(); self.publish(); barrier = Barrier(2)
        def create():
            close_old_connections()
            try:
                client = APIClient(); client.force_authenticate(get_user_model().objects.get(pk=self.a.pk))
                barrier.wait(timeout=10)
                response = client.post(self.path + 'eco/', {'request_id': str(uuid.uuid4()), 'filler_id': self.a.pk}, format='json')
                return response.status_code, response.data['change']['id']
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: create(), range(2)))
        self.assertEqual(sorted(status for status, _ in results), [200, 201])
        self.assertEqual(len({pk for _, pk in results}), 1)
        self.assertEqual(ChangeRequest.objects.filter(source_ecr=self.source).count(), 1)

    def test_parallel_number_reservation_leaves_one_winner(self):
        self.approve(); self.publish(); first = self.create_eco()
        other_source = ChangeRequest.objects.create(applicant=self.a, stage='ecr', status='published', title='other source', ecr_no='OTHER-SOURCE', publisher=self.c, published_by=self.c, published_at=timezone.now(), publication_request_id=uuid.uuid4())
        second = ChangeRequest.objects.create(applicant=self.a, stage='eco', source_ecr=other_source, eco_creation_request_id=uuid.uuid4(), title='other')
        barrier = Barrier(2)
        def reserve(pk):
            close_old_connections()
            try:
                client = APIClient(); client.force_authenticate(get_user_model().objects.get(pk=self.a.pk))
                barrier.wait(timeout=10)
                return client.patch(f'/api/changes/{pk}/', {'eco_no': 'RACE-ECO'}, format='json').status_code
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(reserve, [first.pk, second.pk]))
        self.assertEqual(sorted(results), [200, 400])
        self.assertEqual(ChangeRequest.objects.filter(eco_no='RACE-ECO').count(), 1)
