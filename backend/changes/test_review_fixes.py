import uuid
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from changes.models import ChangeRequest, QuestionResponse, ReviewRound
from changes.stage_workflow import approve_if_complete


class ReviewFixTests(TransactionTestCase):
    def setUp(self):
        self.a, self.b, self.c, self.d = [get_user_model().objects.create_user('review-probe-' + name) for name in 'abcd']
        self.client = APIClient(); self.client.force_authenticate(self.a)
        self.record = ChangeRequest.objects.create(applicant=self.a, stage='ecr', publisher=self.a, title='Review probe', ecr_no='REVIEW-PROBE')
        QuestionResponse.objects.bulk_create([QuestionResponse(change=self.record, number=n, answer='N') for n in range(1, 28)])
        self.path = f'/api/changes/{self.record.pk}/'

    def test_new_submission_without_approvers_must_be_rejected(self):
        response = self.client.post(self.path + 'stage-submission/', {'request_id': str(uuid.uuid4()), 'expected_round': 0, 'acknowledge_no_tasks': True}, format='json')
        self.record.refresh_from_db()
        self.assertEqual(response.status_code, 400)
        self.assertIn('stage_approver_ids', response.data)
        self.assertEqual(self.record.status, 'draft')
        self.assertFalse(self.record.review_rounds.exists())

    def test_published_source_exposes_both_owners_results_to_eco_filler(self):
        self.assertEqual(self.client.patch(self.path, {'stage_approver_ids': [self.a.pk]}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(self.path + 'ecr-actions/ecr_001/', {'owner_user_ids': [self.b.pk, self.c.pk], 'extra_required': True}, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.path + 'stage-submission/', {'request_id': str(uuid.uuid4()), 'expected_round': 0}, format='json').status_code, 200)
        texts = []
        for task in self.record.review_rounds.get().tasks.select_related('owner'):
            self.client.force_authenticate(task.owner)
            text = task.owner.username + '-confirmed-result'; texts.append(text)
            task_path = self.path + f'action-tasks/{task.pk}/'
            self.assertEqual(self.client.patch(task_path, {'request_id': str(uuid.uuid4()), 'version': 1, 'result': text, 'status': 'completed', 'date': '2026-10-13'}, format='json').status_code, 200)
            self.assertEqual(self.client.post(task_path, {'request_id': str(uuid.uuid4()), 'version': 2}, format='json').status_code, 200)
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.post(self.path + 'review-rounds/1/approve/', {'request_id': str(uuid.uuid4())}, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 1}, format='json').status_code, 200)
        response = self.client.post(self.path + 'eco/', {'request_id': str(uuid.uuid4()), 'filler_id': self.d.pk}, format='json')
        self.assertEqual(response.status_code, 201)
        self.client.force_authenticate(self.d)
        source = self.client.get(f"/api/changes/{response.data['change']['id']}/ecr-actions/")
        self.assertEqual(source.status_code, 200)
        action = next(row for row in source.data['actions'] if row['id'] == 'ecr_001')
        results = action['task_results']
        self.assertEqual([row['result'] for row in results], texts)
        self.assertEqual({row['owner']['id'] for row in results}, {self.b.pk, self.c.pk})
        self.assertTrue(all(row['status'] == 'completed' and row['date'] == '2026-10-13' and row['confirmed_at'] and row['round'] == 1 for row in results))
        self.assertEqual(self.client.get(self.path).status_code, 404)

    def test_create_with_valid_approvers_must_not_return_server_error(self):
        self.client.raise_request_exception = False
        response = self.client.post('/api/changes/', {'title': 'Configured draft', 'stage_approver_ids': [self.b.pk]}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['stage_approver_ids'], [self.b.pk])

    def test_existing_old_round_without_approvers_remains_compatible(self):
        self.record.status = 'pending'; self.record.current_review_round = 1; self.record.save()
        ReviewRound.objects.create(change=self.record, number=1, review_mode='designated', title=self.record.title, ecr_no=self.record.ecr_no, submitted_at=timezone.now())
        approve_if_complete(self.record)
        self.record.refresh_from_db(); self.assertEqual(self.record.status, 'approved')
