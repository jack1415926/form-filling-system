
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.apps import apps
from django.db import connection
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import ChangeRequest, ReviewRound, ReviewRecord
from .views import user_data


class RetirementTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('retirement-owner')
        self.other = get_user_model().objects.create_user('retirement-other')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.old = ChangeRequest.objects.create(applicant=self.owner, stage='legacy', status='pending', current_review_round=1)
        self.round = ReviewRound.objects.create(change=self.old, number=1, title='retired', ecr_no='', review_mode='public', submitted_at=timezone.now())
        ReviewRecord.objects.create(change=self.old, round=self.round, reviewer=self.other)
        self.current = ChangeRequest.objects.create(applicant=self.owner, title='current')

    def test_old_plain_feedback_model_table_and_api_are_removed(self):
        with self.assertRaises(LookupError):
            apps.get_model('changes', 'ReviewFeedback')
        self.assertNotIn('review_feedback', connection.introspection.table_names())
        self.current.status = 'pending'; self.current.current_review_round = 1; self.current.save()
        ReviewRound.objects.create(change=self.current, number=1, title='Current', ecr_no='',
                                   review_mode='designated', submitted_at=timezone.now())
        path = f'/api/changes/{self.current.pk}/review-rounds/1/'
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('feedback', response.data)
        self.assertNotIn('can_feedback', response.data)
        self.assertIn('issues', response.data)
        self.assertIn('history', response.data)
        self.assertEqual(self.client.post(path + 'feedback/', {'text': 'retired'}, format='json').status_code, 404)

    def test_retired_requests_are_hidden_even_for_owner_and_assignee(self):
        self.assertEqual(self.current.stage, 'ecr')
        self.assertEqual([row['id'] for row in self.client.get('/api/changes/').data], [self.current.pk])
        for user in [self.owner, self.other]:
            self.client.force_authenticate(user)
            for suffix in ['', 'materials/', 'questions/', 'ecr-actions/', 'eco-actions/', 'emc/', 'execution-plan/', 'significant-change/', 'review-rounds/1/']:
                self.assertEqual(self.client.get(f'/api/changes/{self.old.pk}/{suffix}').status_code, 404, suffix)
            self.assertEqual(self.client.patch(f'/api/changes/{self.old.pk}/', {'title': 'forged'}, format='json').status_code, 404)
            self.assertEqual(self.client.post(f'/api/changes/{self.old.pk}/submission/', {}, format='json').status_code, 404)
            self.assertEqual(self.client.get('/api/review/').data, [])
            inbox = self.client.get('/api/review/inbox/').data
            self.assertNotIn('role', inbox)
            self.assertEqual(inbox['items'], [])

    def test_roles_do_not_exist_in_identity_and_old_group_grants_no_access(self):
        self.other.groups.add(Group.objects.get_or_create(name='审核员')[0])
        self.assertNotIn('role', user_data(self.other))
        self.assertTrue(user_data(self.owner)['can_review'])
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f'/api/changes/{self.current.pk}/').status_code, 404)
        self.assertEqual(self.client.get('/api/review/').data, [])
