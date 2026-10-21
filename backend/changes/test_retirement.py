
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib import admin
from django.apps import apps
from django.db import connection
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory

from .models import ChangeRequest, ReviewRound, ReviewRecord, EcrActionResponse
from .views import user_data


class RetirementTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('retirement-owner')
        self.other = get_user_model().objects.create_user('retirement-other')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.old = ChangeRequest.objects.create(applicant=self.owner, stage='legacy', status='pending', current_review_round=1)
        self.round = ReviewRound.objects.create(change=self.old, number=1, title='retired', ecr_no='', review_mode='designated', submitted_at=timezone.now())
        ReviewRecord.objects.create(round=self.round, reviewer=self.other)
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

    def test_removed_single_owner_and_public_review_interfaces_are_rejected(self):
        path = f'/api/changes/{self.current.pk}/ecr-actions/ecr_001/'
        for values in [{'owner': 'old text'}, {'owner_user_id': self.owner.pk}]:
            self.assertEqual(self.client.patch(path, values, format='json').status_code, 400)
        self.assertEqual(self.client.get('/api/review/?kind=public').status_code, 400)
        with self.assertRaises(IntegrityError), transaction.atomic():
            ChangeRequest.objects.create(applicant=self.owner, review_mode='public')
        with self.assertRaises(IntegrityError), transaction.atomic():
            ReviewRecord.objects.create(reviewer=self.owner)

    def test_multi_owner_accounts_remain_protected_in_orm_and_admin(self):
        row = EcrActionResponse.objects.create(change=self.current, action_key='ecr_001')
        first = get_user_model().objects.create_user('protected-first')
        second = get_user_model().objects.create_user('protected-second')
        row.owners.set([first, second])
        request = APIRequestFactory().get('/admin/auth/user/')
        request.user = self.owner
        user_admin = admin.site._registry[get_user_model()]
        for user in [first, second]:
            with self.assertRaises(ProtectedError), transaction.atomic():
                user.delete()
            protected = user_admin.get_deleted_objects(get_user_model().objects.filter(pk=user.pk), request)[3]
            self.assertTrue(protected)
        row.owners.remove(second)
        second.delete()
        self.assertTrue(get_user_model().objects.filter(pk=first.pk).exists())

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
