from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Barrier, Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import IntegrityError, connection, connections, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest, MaterialChange, ReviewRecord
from .roles import REVIEWER_GROUP


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class SubmissionFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user('submit-owner', password='test-password')
        cls.other = get_user_model().objects.create_user('submit-other', password='test-password')
        cls.group, _ = Group.objects.get_or_create(name=REVIEWER_GROUP)
        cls.reviewers = [get_user_model().objects.create_user('submit-reviewer-'+str(i), password='test-password') for i in [1, 2]]
        for person in cls.reviewers: person.groups.add(cls.group)

    def setUp(self):
        self.change = ChangeRequest.objects.create(applicant=self.owner, title='Submission test', ecr_no='SUB-001')
        self.path = f'/api/changes/{self.change.pk}/submission/'
        self.client = APIClient(enforce_csrf_checks=True)
        csrf = self.client.get('/api/auth/csrf/').json()['csrfToken']
        result = self.client.post('/api/auth/login/', {'username': self.owner.username, 'password': 'test-password'}, format='json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(result.status_code, 200); self.assertEqual(result.json()['user']['role'], 'filler')
        self.client.credentials(HTTP_X_CSRFTOKEN=result.json()['csrfToken'], HTTP_X_EXPECTED_USER=str(self.owner.pk))

    def submit(self, mode='designated', ids=None, path=None):
        return self.client.post(path or self.path, {'review_mode': mode, 'reviewer_ids': [self.reviewers[0].pk] if ids is None else ids}, format='json')

    def test_read_has_no_side_effect_and_reviewer_list_is_minimal(self):
        self.assertEqual(connection.vendor, 'mysql')
        data = self.client.get(self.path).json()
        self.assertEqual(data['change']['review_mode'], ''); self.assertIsNone(data['change']['submitted_at']); self.assertEqual(data['reviewers'], [])
        self.assertFalse(ReviewRecord.objects.exists())
        data = self.client.get('/api/reviewers/').json()
        self.assertEqual([person['id'] for person in data], [p.pk for p in self.reviewers])
        self.assertTrue(all(set(person) == {'id', 'username', 'display_name'} for person in data))

    def test_designated_single_and_multiple_submit_restore_and_idempotence(self):
        result = self.submit()
        self.assertEqual(result.status_code, 200)
        data = result.json(); self.assertEqual(data['change']['status'], 'pending'); self.assertEqual(data['change']['review_mode'], 'designated')
        self.assertTrue(data['change']['submitted_at']); self.assertEqual(data['reviewers'][0]['id'], self.reviewers[0].pk)
        self.assertIsNone(ReviewRecord.objects.get(change=self.change).approved_at)
        self.assertEqual(self.client.get(self.path).json(), data)
        self.assertEqual(self.submit().json(), data); self.assertEqual(ReviewRecord.objects.count(), 1)
        self.assertEqual(self.submit('public', []).status_code, 409)
        self.assertEqual(self.submit(ids=[p.pk for p in self.reviewers]).status_code, 409)
        self.reviewers[0].groups.remove(self.group)
        self.assertEqual(self.submit().json(), data)  # A confirmed result survives later role configuration changes.
        self.reviewers[0].groups.add(self.group)
        second = ChangeRequest.objects.create(applicant=self.owner, title='Two reviewers', ecr_no='SUB-002')
        path = f'/api/changes/{second.pk}/submission/'
        ids = [p.pk for p in reversed(self.reviewers)]
        self.assertEqual(self.submit(ids=ids, path=path).status_code, 200)
        self.assertEqual(self.submit(ids=list(reversed(ids)), path=path).status_code, 200)
        self.assertEqual(ReviewRecord.objects.filter(change=second).count(), 2)

    def test_public_capacity_and_no_preassigned_records(self):
        self.reviewers[0].is_active = False; self.reviewers[0].save(update_fields=['is_active'])
        self.assertEqual(self.submit('public', []).status_code, 400)
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'draft')
        self.reviewers[1].groups.remove(self.group)
        self.assertEqual(self.submit('public', []).status_code, 400)
        self.reviewers[0].is_active = True; self.reviewers[0].save(update_fields=['is_active']); self.reviewers[1].groups.add(self.group)
        result = self.submit('public', [])
        self.assertEqual(result.status_code, 200); self.assertEqual(result.json()['reviewers'], [])
        self.assertFalse(ReviewRecord.objects.exists()); self.assertEqual(self.submit('public', []).json(), result.json())

    def test_strict_inputs_inactive_accounts_and_nonreviewers(self):
        for payload in [[], {}, {'review_mode': 'other', 'reviewer_ids': []}, {'review_mode': 'designated', 'reviewer_ids': []},
                        {'review_mode': 'public', 'reviewer_ids': [self.reviewers[0].pk]},
                        {'review_mode': 'designated', 'reviewer_ids': [self.reviewers[0].pk] * 2},
                        {'review_mode': 'designated', 'reviewer_ids': [self.other.pk]},
                        {'review_mode': 'designated', 'reviewer_ids': [999999]},
                        {'review_mode': 'designated', 'reviewer_ids': ['1']}, {'review_mode': 'designated', 'reviewer_ids': [True]},
                        {'review_mode': 'public', 'reviewer_ids': [], 'status': 'approved'}]:
            with self.subTest(payload=payload): self.assertEqual(self.client.post(self.path, payload, format='json').status_code, 400)
        self.reviewers[0].is_active = False; self.reviewers[0].save(update_fields=['is_active'])
        self.assertEqual(self.submit().status_code, 400)
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'draft'); self.assertFalse(ReviewRecord.objects.exists())

    def test_title_and_ecr_required_only_at_submission_and_transaction_rollback(self):
        for values in [{'title': ''}, {'title': '  '}, {'ecr_no': ''}, {'ecr_no': '  '}]:
            ChangeRequest.objects.filter(pk=self.change.pk).update(title='title', ecr_no='SUB-001')
            ChangeRequest.objects.filter(pk=self.change.pk).update(**values)
            self.assertEqual(self.submit().status_code, 400)
        ChangeRequest.objects.filter(pk=self.change.pk).update(title='title', ecr_no='SUB-001')
        with patch('changes.submission_views.ChangeRequest.save', side_effect=RuntimeError('controlled rollback')):
            with self.assertRaises(RuntimeError): self.submit()
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'draft'); self.assertIsNone(self.change.submitted_at); self.assertFalse(ReviewRecord.objects.exists())
        self.assertEqual(self.submit().status_code, 200)  # All other form fields remain blank.

    def test_permissions_csrf_expected_account_and_role_boundaries(self):
        self.assertEqual(APIClient().get(self.path).status_code, 403)
        self.client.credentials(HTTP_X_EXPECTED_USER=str(self.owner.pk)); self.assertEqual(self.submit().status_code, 403)
        csrf = self.client.get('/api/auth/csrf/').json()['csrfToken']
        self.client.credentials(HTTP_X_CSRFTOKEN=csrf, HTTP_X_EXPECTED_USER=str(self.other.pk)); self.assertEqual(self.submit().status_code, 409)
        self.client.credentials(HTTP_X_CSRFTOKEN=csrf, HTTP_X_EXPECTED_USER=str(self.owner.pk))
        foreign = ChangeRequest.objects.create(applicant=self.other)
        path = f'/api/changes/{foreign.pk}/submission/'
        self.assertEqual(self.client.get(path).status_code, 404); self.assertEqual(self.submit(path=path).status_code, 404)
        for field, value in [('review_mode', 'public'), ('submitted_at', '2026-10-04T12:00:00Z'), ('status', 'pending')]:
            self.assertEqual(self.client.patch(f'/api/changes/{self.change.pk}/', {field:value}, format='json').status_code, 400)
        self.owner.groups.add(self.group)
        for path in ['/api/changes/', self.path, '/api/reviewers/', f'/api/changes/{self.change.pk}/questions/']:
            self.assertEqual(self.client.get(path).status_code, 404 if path.endswith('/questions/') else 403)
        self.assertEqual(self.submit().json()['code'], 'role_forbidden')
        self.assertEqual(self.client.post('/api/changes/', {}, format='json').status_code, 403)
        self.assertEqual(self.client.get('/api/auth/me/').json()['role'], 'reviewer')

    def test_submission_locks_all_write_paths_and_preserves_read_access(self):
        material = MaterialChange.objects.create(change=self.change, category='revision')
        self.assertEqual(self.submit().status_code, 200)
        base = f'/api/changes/{self.change.pk}/'
        writes = [('patch', base, {'title':'must not write'}), ('delete', base, None),
                  ('post', base+'materials/', {'category':'revision'}), ('patch', base+f'materials/{material.pk}/', {'description':'no'}),
                  ('patch', base+f'materials/{material.pk}/', {'dispositions':{'company_finished':{'disposition':'NA'}}}),
                  ('delete', base+f'materials/{material.pk}/', None), ('patch', base+'questions/', {'responses':{}}),
                  ('patch', base+'ecr-actions/ecr_001/', {}), ('patch', base+'eco-actions/eco_001/', {}),
                  ('patch', base+'emc/', {'cells':{}}), ('patch', base+'execution-plan/', {'responses':{}}),
                  ('patch', base+'significant-change/', {})]
        for method, path, payload in writes:
            with self.subTest(path=path, method=method): self.assertEqual(getattr(self.client, method)(path, payload, format='json').status_code, 409)
        for suffix in ['', 'materials/', 'questions/', 'ecr-actions/', 'eco-actions/', 'emc/', 'execution-plan/', 'significant-change/', 'submission/']:
            self.assertEqual(self.client.get(base+suffix).status_code, 200)
        self.change.refresh_from_db(); self.assertEqual(self.change.title, 'Submission test'); self.assertTrue(MaterialChange.objects.filter(pk=material.pk).exists())

    def test_database_unique_mode_constraints_and_reviewer_protection(self):
        self.assertEqual(self.submit().status_code, 200)
        round = self.change.review_rounds.get(number=1)
        with self.assertRaises(IntegrityError), transaction.atomic(): ReviewRecord.objects.create(change=self.change, round=round, reviewer=self.reviewers[0])
        with self.assertRaises(IntegrityError), transaction.atomic(): ChangeRequest.objects.filter(pk=self.change.pk).update(review_mode='PUBLIC')
        with self.assertRaises(ProtectedError): self.reviewers[0].delete()
        self.change.delete(); self.assertFalse(ReviewRecord.objects.exists())


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class SubmissionTransactionTests(TransactionTestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('submit-concurrent')
        self.group, _ = Group.objects.get_or_create(name=REVIEWER_GROUP)
        self.reviewers = [get_user_model().objects.create_user('submit-concurrent-r'+str(i)) for i in [1,2]]
        for person in self.reviewers: person.groups.add(self.group)
        self.change = ChangeRequest.objects.create(applicant=self.owner, title='Submit', ecr_no='TX-001')
        self.path = f'/api/changes/{self.change.pk}/submission/'

    def request(self, method, path, payload, barrier=None, started=None):
        try:
            client=APIClient(); client.force_authenticate(self.owner)
            if barrier: barrier.wait(timeout=5)
            def mark_parent(execute, sql, params, many, context):
                if started and sql.lstrip().upper().startswith('SELECT') and 'change_request' in sql:
                    started.set()
                return execute(sql, params, many, context)
            with connection.execute_wrapper(mark_parent):
                result=getattr(client, method)(path,payload,format='json')
                return result.status_code, result.json() if result.content else None
        finally: connections['default'].close()

    def test_parallel_same_submission_deduplicates_and_conflicting_mode_rejects(self):
        payload={'review_mode':'designated','reviewer_ids':[self.reviewers[0].pk]}
        barrier=Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as pool:
            tasks=[pool.submit(self.request,'post',self.path,payload,barrier) for _ in range(2)]
            results=[task.result(timeout=10) for task in tasks]
        self.assertEqual([status for status,_ in results],[200,200]);self.assertEqual(results[0][1],results[1][1]);self.assertEqual(ReviewRecord.objects.count(),1)
        self.assertEqual(self.request('post',self.path,{'review_mode':'public','reviewer_ids':[]})[0],409)

    def test_waiting_submit_rechecks_saved_values_and_deleted_request(self):
        payload={'review_mode':'designated','reviewer_ids':[self.reviewers[0].pk]}
        for deleted in [False,True]:
            started=Event()
            with ThreadPoolExecutor(max_workers=1) as pool:
                with transaction.atomic():
                    row=ChangeRequest.objects.select_for_update().get(pk=self.change.pk)
                    task=pool.submit(self.request,'post',self.path,payload,None,started)
                    self.assertTrue(started.wait(timeout=5))
                    with self.assertRaises(TimeoutError):
                        task.result(timeout=0.15)
                    if deleted: row.delete()
                    else: row.title='';row.save(update_fields=['title'])
                self.assertEqual(task.result(timeout=10)[0],404 if deleted else 400)
        self.assertFalse(ReviewRecord.objects.exists())

    def test_save_and_delete_waiting_for_submit_reject_after_commit(self):
        started=[Event(),Event()];base=f'/api/changes/{self.change.pk}/'
        with ThreadPoolExecutor(max_workers=2) as pool:
            with transaction.atomic():
                ChangeRequest.objects.select_for_update().get(pk=self.change.pk)
                tasks=[pool.submit(self.request,'patch',base,{'title':'late'},None,started[0]),pool.submit(self.request,'delete',base,None,None,started[1])]
                self.assertTrue(all(event.wait(timeout=5) for event in started))
                for task in tasks:
                    with self.assertRaises(TimeoutError):
                        task.result(timeout=0.15)
                client=APIClient();client.force_authenticate(self.owner)
                result=client.post(self.path,{'review_mode':'public','reviewer_ids':[]},format='json')
                self.assertEqual(result.status_code,200)
            self.assertEqual([task.result(timeout=10)[0] for task in tasks],[409,409])
        self.assertEqual(ChangeRequest.objects.get(pk=self.change.pk).title,'Submit')
