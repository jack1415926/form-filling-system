import uuid
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from .models import ChangeRequest, QuestionResponse


class MultiOwnerApprovalTests(TestCase):
    def setUp(self):
        self.applicant, self.first, self.second, self.outsider = [get_user_model().objects.create_user('multi-' + name) for name in ['applicant', 'first', 'second', 'outsider']]
        self.client = APIClient()
        self.client.force_authenticate(self.applicant)
        self.change = ChangeRequest.objects.create(stage='ecr', applicant=self.applicant, publisher=self.applicant, title='多人行动', ecr_no='MULTI-ECR')
        QuestionResponse.objects.bulk_create([QuestionResponse(change=self.change, number=n, answer='N') for n in range(1, 28)])
        self.path = f'/api/changes/{self.change.pk}/'

    def test_each_owner_and_each_approver_must_finish(self):
        stage = self.change.stage
        response = self.client.patch(self.path + f'{stage}-actions/{stage}_001/', {'owner_user_ids': [self.first.pk, self.second.pk], 'extra_required': True}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.patch(self.path, {'stage_approver_ids': [self.first.pk, self.second.pk]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        payload = {'request_id': str(uuid.uuid4()), 'expected_round': 0}
        submitted = self.client.post(self.path + 'stage-submission/', payload, format='json')
        self.assertEqual(submitted.status_code, 200, submitted.data)
        self.assertEqual(self.client.post(self.path + 'stage-submission/', payload, format='json').status_code, 200)
        self.assertEqual(self.client.patch(self.path, {'stage_approver_ids': []}, format='json').status_code, 409)
        tasks = list(self.change.review_rounds.get(number=1).tasks.order_by('owner_id'))
        self.assertEqual(len(tasks), 2)
        review = self.path + 'review-rounds/1/approve/'
        self.client.force_authenticate(self.first)
        self.assertEqual(self.client.post(review, {'request_id': str(uuid.uuid4())}, format='json').status_code, 409)
        for index, task in enumerate(tasks):
            self.client.force_authenticate(task.owner)
            task_path = self.path + f'action-tasks/{task.pk}/'
            self.assertEqual(self.client.patch(task_path, {'request_id': str(uuid.uuid4()), 'version': 1, 'result': '本人完成', 'status': 'completed', 'date': '2026-10-13'}, format='json').status_code, 200)
            self.assertEqual(self.client.post(task_path, {'request_id': str(uuid.uuid4()), 'version': 2}, format='json').status_code, 200)
            self.change.refresh_from_db()
            self.assertEqual(self.change.status, 'pending')
        self.client.force_authenticate(self.first)
        self.assertTrue(any('待本人同意批准' in row['summary'] for row in self.client.get('/api/review/inbox/').data['items']))
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.post(review, {'request_id': str(uuid.uuid4())}, format='json').status_code, 404)
        for actor, expected in [(self.first, 'pending'), (self.second, 'approved')]:
            self.client.force_authenticate(actor)
            approve = {'request_id': str(uuid.uuid4())}
            self.assertEqual(self.client.post(review, approve, format='json').status_code, 200)
            self.assertEqual(self.client.post(review, approve, format='json').status_code, 200)
            self.change.refresh_from_db()
            self.assertEqual(self.change.status, expected)

    def test_eco_multi_owner_and_approval(self):
        self.change.status = 'published'
        self.change.published_at = timezone.now()
        self.change.published_by = self.applicant
        self.change.publication_request_id = uuid.uuid4()
        self.change.save()
        self.change = ChangeRequest.objects.create(stage='eco', source_ecr=self.change, eco_creation_request_id=uuid.uuid4(), applicant=self.applicant, publisher=self.applicant, title='多人ECO', eco_no='MULTI-ECO')
        QuestionResponse.objects.bulk_create([QuestionResponse(change=self.change, number=n, answer='N') for n in range(1, 28)])
        self.path = f'/api/changes/{self.change.pk}/'
        self.test_each_owner_and_each_approver_must_finish()

    def test_approver_without_tasks_can_return_and_new_round_resets_approvals(self):
        self.change.stage_approvers.set([self.first, self.second])
        payload = {'request_id': str(uuid.uuid4()), 'expected_round': 0, 'acknowledge_no_tasks': True}
        self.assertEqual(self.client.post(self.path + 'stage-submission/', payload, format='json').status_code, 200)
        self.client.force_authenticate(self.first)
        self.assertTrue(self.client.get(self.path + 'review-rounds/1/').data['can_approve'])
        self.assertEqual(self.client.post(self.path + 'review-rounds/1/approve/', {'request_id': str(uuid.uuid4())}, format='json').status_code, 200)
        self.client.force_authenticate(self.second)
        self.assertEqual(self.client.post(self.path + 'review-rounds/1/return/', {'request_id': str(uuid.uuid4()), 'issues': [{'tab': 'overview', 'text': '请修订标题'}]}, format='json').status_code, 200)
        issue = self.change.review_issues.get()
        self.client.force_authenticate(self.applicant)
        self.assertEqual(self.client.post(self.path + 'review-rounds/1/respond/', {'request_id': str(uuid.uuid4()), 'issue_id': issue.pk, 'version': issue.version, 'text': '已修订'}, format='json').status_code, 200)
        payload.update(request_id=str(uuid.uuid4()), expected_round=1)
        self.assertEqual(self.client.post(self.path + 'stage-submission/', payload, format='json').status_code, 200)
        self.assertFalse(self.change.review_rounds.get(number=2).records.filter(approved_at__isnull=False).exists())
        self.assertTrue(self.change.review_rounds.get(number=1).records.filter(reviewer=self.first, approved_at__isnull=False).exists())

    def test_multi_owner_validation_and_clearing(self):
        self.second.is_active = False
        self.second.save()
        path = self.path + 'ecr-actions/ecr_001/'
        for owners in [[self.first.pk, self.first.pk], [self.second.pk], [True], ['1']]:
            self.assertEqual(self.client.patch(path, {'owner_user_ids': owners}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(path, {'owner_user_ids': [self.first.pk]}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(path, {'owner_user_ids': []}, format='json').status_code, 200)
        self.assertFalse(self.change.ecr_responses.exists())
