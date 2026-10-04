from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier, Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .execution_plan import PLAN_ACTIVITIES, PLAN_ACTIVITY_IDS
from .models import ChangeRequest, ExecutionPlanResponse


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ExecutionPlanFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user('plan-owner', password='test-password')
        cls.other = get_user_model().objects.create_user('plan-other', password='test-password')

    def setUp(self):
        self.change = ChangeRequest.objects.create(applicant=self.owner)
        self.path = f'/api/changes/{self.change.pk}/execution-plan/'
        self.client = APIClient(enforce_csrf_checks=True)
        token = self.client.get('/api/auth/csrf/').json()['csrfToken']
        login = self.client.post('/api/auth/login/', {'username': self.owner.username, 'password': 'test-password'}, format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(login.status_code, 200)
        self.client.credentials(HTTP_X_CSRFTOKEN=login.json()['csrfToken'], HTTP_X_EXPECTED_USER=str(self.owner.pk))

    def write(self, responses):
        return self.client.patch(self.path, {'responses': responses}, format='json')

    def test_complete_definitions_read_noop_and_empty_defaults(self):
        self.assertEqual(connection.vendor, 'mysql')
        self.assertEqual(PLAN_ACTIVITY_IDS, [f'plan_{i:03d}' for i in range(1, 12)])
        result = self.client.get(self.path)
        self.assertEqual(result.status_code, 200)
        self.assertEqual([r['activity'] for r in result.json()['rows']], [r['activity'] for r in PLAN_ACTIVITIES])
        self.assertEqual(result.json()['rows'][-1]['activity'], '里程碑 9')
        self.assertTrue(all(r['owner'] == r['remark'] == '' and r['start_date'] is r['end_date'] is None for r in result.json()['rows']))
        original = self.change.updated_at
        for payload in [{}, {'plan_001': {}}, {'plan_001': {'owner': '', 'remark': '', 'start_date': None, 'end_date': None}}]:
            self.assertEqual(self.write(payload).status_code, 200)
        self.change.refresh_from_db()
        self.assertEqual(self.change.updated_at, original)
        self.assertEqual(ExecutionPlanResponse.objects.count(), 0)

    def test_save_restore_partial_clear_dates_and_delete_empty_response(self):
        values = {'owner': '真实负责人', 'start_date': '2026-10-03', 'end_date': '2026-10-03', 'remark': '执行备注'}
        self.assertEqual(self.write({'plan_001': values, 'plan_011': {'remark': '里程碑备注'}}).status_code, 200)
        self.assertEqual({key: self.client.get(self.path).json()['rows'][0][key] for key in values}, values)
        self.assertEqual(self.write({'plan_001': {'start_date': None, 'remark': ''}}).status_code, 200)
        row = ExecutionPlanResponse.objects.get(activity_key='plan_001')
        self.assertEqual(row.owner, '真实负责人'); self.assertIsNone(row.start_date); self.assertEqual(row.end_date, date(2026, 10, 3))
        previous = ChangeRequest.objects.get(pk=self.change.pk).updated_at
        self.assertEqual(self.write({'plan_001': {'owner': '真实负责人'}}).status_code, 200)
        self.assertEqual(ChangeRequest.objects.get(pk=self.change.pk).updated_at, previous)
        self.assertEqual(self.write({'plan_001': {'owner': '', 'end_date': None}}).status_code, 200)
        self.assertFalse(ExecutionPlanResponse.objects.filter(activity_key='plan_001').exists())
        self.assertEqual(ExecutionPlanResponse.objects.get(activity_key='plan_011').remark, '里程碑备注')
        self.assertEqual(len(self.client.get(self.path).json()['rows']), 11)

    def test_strict_inputs_and_combined_date_order_roll_back_whole_patch(self):
        self.assertEqual(self.write({'plan_002': {'start_date': '2026-10-03'}}).status_code, 200)
        for values in [{'owner': 1}, {'owner': None}, {'owner': '字' * 256}, {'remark': None}, {'remark': 9}, {'activity': '改定义'}, {'start_date': ''}, {'start_date': '2026-02-30'}, {'end_date': '10000-10-03'}]:
            with self.subTest(values=values):
                self.assertEqual(self.write({'plan_001': values}).status_code, 400)
        for payload in [[], {}, {'rows': []}, {'responses': []}, {'responses': {'plan_012': {}}}, {'responses': {'plan_001': []}}]:
            self.assertEqual(self.client.patch(self.path, payload, format='json').status_code, 400)
        before = ChangeRequest.objects.get(pk=self.change.pk).updated_at
        invalid = self.write({'plan_001': {'owner': '必须回滚'}, 'plan_002': {'end_date': '2026-10-02'}})
        self.assertEqual(invalid.status_code, 400)
        self.assertIn('end_date', invalid.json()['responses']['plan_002'])
        self.assertFalse(ExecutionPlanResponse.objects.filter(activity_key='plan_001').exists())
        self.assertEqual(ChangeRequest.objects.get(pk=self.change.pk).updated_at, before)
        self.assertEqual(self.write({'plan_002': {'start_date': None, 'end_date': '2026-10-02'}}).status_code, 200)
        with patch('changes.execution_plan_views.ChangeRequest.save', side_effect=RuntimeError('controlled failure')):
            with self.assertRaises(RuntimeError):
                self.write({'plan_001': {'owner': '回滚'}, 'plan_002': {'remark': '回滚'}})
        self.assertFalse(ExecutionPlanResponse.objects.filter(activity_key='plan_001').exists())
        self.assertEqual(ExecutionPlanResponse.objects.get(activity_key='plan_002').remark, '')

    def test_permissions_csrf_expected_account_readonly_and_cascade(self):
        self.assertEqual(APIClient().get(self.path).status_code, 403)
        self.client.credentials(HTTP_X_EXPECTED_USER=str(self.owner.pk))
        self.assertEqual(self.write({'plan_001': {'owner': 'missing csrf'}}).status_code, 403)
        token = self.client.get('/api/auth/csrf/').json()['csrfToken']
        self.client.credentials(HTTP_X_CSRFTOKEN=token, HTTP_X_EXPECTED_USER=str(self.other.pk))
        self.assertEqual(self.write({'plan_001': {'owner': 'wrong account'}}).status_code, 409)
        self.client.credentials(HTTP_X_CSRFTOKEN=token, HTTP_X_EXPECTED_USER=str(self.owner.pk))
        other = ChangeRequest.objects.create(applicant=self.other)
        path = f'/api/changes/{other.pk}/execution-plan/'
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.patch(path, {'responses': {}}, format='json').status_code, 404)
        self.assertEqual(self.write({'plan_001': {'remark': 'cascade'}}).status_code, 200)
        for status in ['pending', 'approved']:
            ChangeRequest.objects.filter(pk=self.change.pk).update(status=status)
            self.assertEqual(self.client.get(self.path).status_code, 200)
            self.assertEqual(self.write({'plan_001': {'remark': 'locked'}}).status_code, 409)
        self.change.delete()
        self.assertEqual(ExecutionPlanResponse.objects.count(), 0)

    def test_database_unique_activity_and_date_constraints(self):
        ExecutionPlanResponse.objects.create(change=self.change, activity_key='plan_001', start_date=date(2026, 10, 3), end_date=date(2026, 10, 3))
        for values in [{'activity_key': 'plan_001'}, {'activity_key': 'plan_012'}, {'activity_key': 'PLAN_002'}, {'activity_key': 'plan_002', 'start_date': date(2026, 10, 3), 'end_date': date(2026, 10, 2)}]:
            with self.subTest(values=values), self.assertRaises(IntegrityError), transaction.atomic():
                ExecutionPlanResponse.objects.create(change=self.change, **values)
        ExecutionPlanResponse.objects.create(change=self.change, activity_key='plan_002', end_date=date(2026, 10, 2))


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ExecutionPlanTransactionTests(TransactionTestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('plan-concurrent')
        self.change = ChangeRequest.objects.create(applicant=self.owner)
        self.path = f'/api/changes/{self.change.pk}/execution-plan/'

    def writer(self, fields, barrier=None, started=None):
        try:
            client = APIClient(); client.force_authenticate(self.owner)
            if barrier: barrier.wait(timeout=5)
            if started: started.set()
            return client.patch(self.path, {'responses': {'plan_001': fields}}, format='json').status_code
        finally:
            connections['default'].close()

    def test_concurrent_creation_merges_fields_in_one_row(self):
        barrier = Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.writer, {'owner': 'owner'}, barrier), pool.submit(self.writer, {'remark': 'remark'}, barrier)]
            self.assertEqual([f.result(timeout=10) for f in futures], [200, 200])
        row = ExecutionPlanResponse.objects.get(change=self.change, activity_key='plan_001')
        self.assertEqual((row.owner, row.remark), ('owner', 'remark'))

    def test_waiting_write_rechecks_locked_status_and_deleted_request(self):
        for deleted in [False, True]:
            if deleted: self.change = ChangeRequest.objects.create(applicant=self.owner); self.path = f'/api/changes/{self.change.pk}/execution-plan/'
            started = Event()
            with ThreadPoolExecutor(max_workers=1) as pool:
                with transaction.atomic():
                    held = ChangeRequest.objects.select_for_update().get(pk=self.change.pk)
                    future = pool.submit(self.writer, {'owner': 'must not write'}, None, started)
                    self.assertTrue(started.wait(timeout=5))
                    if deleted: held.delete()
                    else: held.status = 'pending'; held.save(update_fields=['status'])
                self.assertEqual(future.result(timeout=10), 404 if deleted else 409)
        self.assertEqual(ExecutionPlanResponse.objects.count(), 0)

    def test_migration_roundtrip_preserves_existing_request_without_prefill(self):
        fields = [field.attname for field in ChangeRequest._meta.concrete_fields if field.name not in ['review_mode', 'submitted_at', 'current_review_round']]
        before = list(ChangeRequest.objects.values(*fields))
        try:
            executor = MigrationExecutor(connection); executor.migrate([('changes', '0009_emc_reference')])
            executor = MigrationExecutor(connection); executor.migrate([('changes', '0010_executionplanresponse')])
            self.assertEqual(list(ChangeRequest.objects.values(*fields)), before)
            self.assertEqual(ExecutionPlanResponse.objects.count(), 0)
            ExecutionPlanResponse.objects.create(change=self.change, activity_key='plan_001', owner='temporary')
            executor = MigrationExecutor(connection); executor.migrate([('changes', '0009_emc_reference')])
            self.assertEqual(list(ChangeRequest.objects.values(*fields)), before)
            self.assertNotIn('execution_plan_response', connection.introspection.table_names())
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
