import uuid
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
from threading import Barrier
from unittest.mock import patch

from django.apps import apps
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import connections
from django.db.models.deletion import ProtectedError
from django.test import TestCase, TransactionTestCase, override_settings, tag
from rest_framework.test import APIClient

from .models import ChangeRequest, SystemFeedback, SystemFeedbackEvent
from .roles import FEEDBACK_ADMIN_GROUP, REVIEWER_GROUP
from .views import user_data

BASE = '/api/system-feedback/'


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def create_payload(**changes):
    return {'category': 'problem', 'content': '问题步骤', 'request_id': str(uuid.uuid4()), **changes}


def action_payload(**changes):
    return {'status': 'processing', 'text': '', 'expected_version': 0, 'request_id': str(uuid.uuid4()), **changes}


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class SystemFeedbackTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user('feedback-owner', password='test')
        cls.other = get_user_model().objects.create_user('feedback-other', password='test')
        cls.reviewer = get_user_model().objects.create_user('feedback-reviewer', password='test')
        cls.reviewer.groups.add(Group.objects.get_or_create(name=REVIEWER_GROUP)[0])
        cls.admin = get_user_model().objects.create_user('feedback-admin', password='test')
        cls.second = get_user_model().objects.create_user('feedback-admin-2', password='test')
        for user in [cls.admin, cls.second]:
            user.groups.add(Group.objects.get_or_create(name=FEEDBACK_ADMIN_GROUP)[0])

    def setUp(self):
        self.owner_client = client_for(self.owner)
        self.admin_client = client_for(self.admin)
        self.change = ChangeRequest.objects.create(applicant=self.owner, title='不应修改的申请')
        self.before = list(ChangeRequest.objects.values())

    def create(self, user=None, **changes):
        result = client_for(user or self.owner).post(BASE, create_payload(**changes), format='json')
        self.assertEqual(result.status_code, 201, result.data)
        return result.data

    def act(self, row, **changes):
        return self.admin_client.post(BASE+f'manage/{row["id"]}/actions/', action_payload(**changes), format='json')

    def test_owner_reviewer_access_and_no_application_effects(self):
        row = self.create()
        reviewer_row = self.create(self.reviewer, category='suggestion')
        for user, own in [(self.owner, row), (self.reviewer, reviewer_row)]:
            client = client_for(user)
            self.assertEqual(client.get(BASE).data['count'], 1)
            self.assertEqual(client.get(BASE+str(own['id'])+'/').status_code, 200)
            other = reviewer_row if user == self.owner else row
            self.assertEqual(client.get(BASE+str(other['id'])+'/').status_code, 404)
            self.assertEqual(client.get(BASE+'requests/'+other['request_id']+'/').status_code, 404)
            for method in [client.patch, client.delete]:
                self.assertEqual(method(BASE+str(own['id'])+'/', {}, format='json').status_code, 405)
        self.assertEqual(self.act(row).status_code, 200)
        self.assertEqual(list(ChangeRequest.objects.values()), self.before)

    def test_creation_replay_query_validation_and_immutable_original(self):
        values = create_payload()
        first = self.owner_client.post(BASE, values, format='json')
        self.assertEqual(first.status_code, 201)
        self.assertEqual(self.owner_client.post(BASE, values, format='json').status_code, 200)
        self.assertEqual(SystemFeedback.objects.count(), 1)
        altered = {**values, 'content': '不同内容'}
        self.assertEqual(self.owner_client.post(BASE, altered, format='json').status_code, 409)
        self.assertEqual(self.owner_client.get(BASE+'requests/'+values['request_id']+'/').data['id'], first.data['id'])
        self.assertEqual(self.owner_client.get(BASE+'requests/'+str(uuid.uuid4())+'/').status_code, 404)
        for patch_values in [{'content': ' '}, {'content': '字'*5001}, {'content': 5}, {'category': 'wrong'}, {'request_id': 'wrong'}, {'status': 'closed'}, {'change_id': self.change.pk}]:
            self.assertEqual(self.owner_client.post(BASE, create_payload(**patch_values), format='json').status_code, 400)
        self.assertEqual(self.create(category='other')['category'], 'other')

    def test_admin_group_additive_superuser_not_implicit_and_revocation(self):
        row = self.create()
        superuser = get_user_model().objects.create_superuser('feedback-super', password='test')
        for user in [self.owner, self.reviewer, superuser]:
            client = client_for(user)
            self.assertEqual(client.get(BASE+'manage/').status_code, 403)
            self.assertEqual(client.post(BASE+f'manage/{row["id"]}/actions/', action_payload(), format='json').status_code, 403)
            self.assertFalse(user_data(user)['can_manage_feedback'])
        self.reviewer.groups.add(Group.objects.get(name=FEEDBACK_ADMIN_GROUP))
        self.assertEqual(user_data(self.reviewer)['role'], 'reviewer')
        self.assertTrue(user_data(self.reviewer)['can_manage_feedback'])
        self.assertEqual(client_for(self.reviewer).get(BASE+'manage/').status_code, 200)
        self.assertEqual(self.admin_client.get(f'/api/changes/{self.change.pk}/').status_code, 404)
        self.admin.groups.remove(Group.objects.get(name=FEEDBACK_ADMIN_GROUP))
        revoked = self.act(row)
        self.assertEqual(revoked.status_code, 403)
        self.assertEqual(revoked.data['code'], 'feedback_permission_changed')
        self.assertEqual(SystemFeedbackEvent.objects.count(), 0)

    def test_state_flow_multiple_replies_close_reopen_and_public_history(self):
        row = self.create()
        self.assertEqual(self.act(row, status='pending').status_code, 400)
        self.assertEqual(self.act(row, status='closed').status_code, 400)
        self.assertEqual(self.act(row, status='pending', text='已收到').status_code, 200)
        self.assertEqual(self.act(row, expected_version=1).status_code, 200)
        self.assertEqual(self.act(row, status='closed', expected_version=2, text='已处理').status_code, 200)
        self.assertEqual(self.act(row, expected_version=3).status_code, 400)
        self.assertEqual(self.act(row, status='pending', expected_version=3, text='重开').status_code, 400)
        self.assertEqual(self.act(row, expected_version=3, text='重开继续核对').status_code, 200)
        result = self.owner_client.get(BASE+str(row['id'])+'/').data
        self.assertEqual(result['content'], row['content'])
        self.assertEqual(result['version'], 4)
        self.assertEqual([event['base_version'] for event in result['events']], [0, 1, 2, 3])
        self.assertEqual([event['text'] for event in result['events']], ['已收到', '', '已处理', '重开继续核对'])

    def test_action_replay_before_version_validation_and_cross_actor_conflict(self):
        row = self.create()
        values = action_payload()
        path = BASE+f'manage/{row["id"]}/actions/'
        self.assertEqual(self.admin_client.post(path, values, format='json').status_code, 200)
        self.assertEqual(self.act(row, expected_version=1, text='另一次更新').status_code, 200)
        self.assertEqual(self.admin_client.post(path, values, format='json').status_code, 200)
        self.assertEqual(SystemFeedbackEvent.objects.count(), 2)
        for payload in [{**values, 'text': '更改'}, {**values, 'expected_version': 1}]:
            self.assertEqual(self.admin_client.post(path, payload, format='json').status_code, 409)
        self.assertEqual(client_for(self.second).post(path, values, format='json').status_code, 409)
        query = BASE+f'manage/{row["id"]}/requests/{values["request_id"]}/'
        self.assertEqual(self.admin_client.get(query).status_code, 200)
        self.assertEqual(client_for(self.second).get(query).status_code, 404)
        self.assertEqual(self.act(row, text='过期版本').status_code, 409)
        for invalid in [{'text': '字'*5001}, {'text': None}, {'expected_version': True}, {'expected_version': -1}, {'actor_id': self.second.pk}, {'status': 'bad'}]:
            self.assertEqual(self.act(row, **invalid).status_code, 400)

    def test_event_and_state_atomic_rollback_user_protection(self):
        row = self.create()
        with patch('changes.system_feedback_views.SystemFeedback.save', side_effect=RuntimeError('controlled')):
            with self.assertRaises(RuntimeError):
                self.act(row)
        self.assertFalse(SystemFeedbackEvent.objects.exists())
        saved = SystemFeedback.objects.get(pk=row['id'])
        self.assertEqual(saved.version, 0)
        self.assertEqual(saved.status, 'pending')
        with self.assertRaises(ProtectedError):
            self.owner.delete()

    def test_pagination_filters_and_order(self):
        for i in range(22):
            SystemFeedback.objects.create(submitter=self.owner, category='problem', content=str(i), request_id=uuid.uuid4())
        mine = self.owner_client.get(BASE).data
        managed = self.admin_client.get(BASE+'manage/').data
        self.assertEqual(mine['count'], 22)
        self.assertEqual(len(mine['results']), 20)
        self.assertEqual(mine['results'][0]['content'], '21')
        self.assertEqual(managed['results'][0]['content'], '0')
        self.assertEqual(len(self.owner_client.get(BASE+'?page=2').data['results']), 2)
        self.assertEqual(self.owner_client.get(BASE+'?status=closed').data['count'], 0)
        self.assertEqual(self.owner_client.get(BASE+'?category=suggestion').data['count'], 0)
        self.assertEqual(self.owner_client.get(BASE+'?status=invalid').status_code, 400)

    def test_real_session_csrf_and_expected_account(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.get(BASE).status_code, 403)
        token = client.get('/api/auth/csrf/').json()['csrfToken']
        login = client.post('/api/auth/login/', {'username': self.reviewer.username, 'password': 'test'}, format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(login.status_code, 200)
        self.assertIn('can_manage_feedback', login.json()['user'])
        self.assertEqual(client.post(BASE, create_payload(), format='json').status_code, 403)
        self.assertEqual(client.post(BASE, create_payload(), format='json', HTTP_X_CSRFTOKEN=login.json()['csrfToken'], HTTP_X_EXPECTED_USER=str(self.other.pk)).status_code, 409)
        self.assertEqual(client.post(BASE, create_payload(), format='json', HTTP_X_CSRFTOKEN=login.json()['csrfToken'], HTTP_X_EXPECTED_USER=str(self.reviewer.pk)).status_code, 201)

    @tag('migration')
    def test_migration_group_and_reverse_history_guard(self):
        migration = import_module('changes.migrations.0015_system_feedback')
        schema = type('Schema', (), {'connection': connections['default']})()
        migration.create_admin_group(apps, schema)
        self.assertTrue(Group.objects.filter(name=FEEDBACK_ADMIN_GROUP).exists())
        self.assertFalse(self.owner.groups.filter(name=FEEDBACK_ADMIN_GROUP).exists())
        migration.prevent_history_loss(apps, schema)
        self.create()
        with self.assertRaises(RuntimeError):
            migration.prevent_history_loss(apps, schema)


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class SystemFeedbackConcurrencyTests(TransactionTestCase):
    def test_simultaneous_creation_and_admin_conflict(self):
        self.assertEqual(connections['default'].vendor, 'mysql')
        owner = get_user_model().objects.create_user('feedback-race-owner')
        admins = [get_user_model().objects.create_user('feedback-race-'+str(i)) for i in range(2)]
        group = Group.objects.get_or_create(name=FEEDBACK_ADMIN_GROUP)[0]
        for user in admins: user.groups.add(group)
        barrier = Barrier(2)
        values = create_payload()
        def create():
            try:
                barrier.wait(timeout=10)
                return client_for(owner).post(BASE, values, format='json').status_code
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: create(), range(2)))
        self.assertEqual(sorted(outcomes), [200, 201])
        self.assertEqual(SystemFeedback.objects.count(), 1)
        row = SystemFeedback.objects.get()
        barrier = Barrier(2)
        def handle(user):
            try:
                barrier.wait(timeout=10)
                return client_for(user).post(BASE+f'manage/{row.pk}/actions/', action_payload(text=user.username), format='json').status_code
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(handle, admins))
        self.assertEqual(sorted(outcomes), [200, 409])
        row.refresh_from_db()
        self.assertEqual(row.version, 1)
        self.assertEqual(row.events.count(), 1)
