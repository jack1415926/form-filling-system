import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import ChangeRequest, ReviewInboxRead, ReviewIssue, ReviewIssueEvent, ReviewRecord, ReviewRound
from .roles import REVIEWER_GROUP


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ReviewInboxTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user('inbox-owner')
        cls.other = get_user_model().objects.create_user('inbox-other')
        cls.reviewer = get_user_model().objects.create_user('inbox-reviewer')
        cls.second = get_user_model().objects.create_user('inbox-second')
        group, _ = Group.objects.get_or_create(name=REVIEWER_GROUP)
        cls.reviewer.groups.add(group); cls.second.groups.add(group)

    def record(self, mode='designated', state='pending', owner=None, assigned=None):
        change = ChangeRequest.objects.create(applicant=owner or self.owner, title='Current title',
                    ecr_no=str(uuid.uuid4()), status=state, current_review_round=1)
        round = ReviewRound.objects.create(change=change, number=1, review_mode=mode, state=state,
                    submitted_at=timezone.now(), title='Submitted title', ecr_no=change.ecr_no)
        if mode == 'designated':
            ReviewRecord.objects.create(change=change, round=round, reviewer=assigned or self.reviewer)
        return change, round

    def inbox(self, user, **headers):
        client = APIClient(); client.force_authenticate(user)
        return client.get('/api/review/inbox/', **headers)

    def mark_read(self, user, items):
        client = APIClient(); client.force_authenticate(user)
        return client.post('/api/review/inbox/read/', {'items': [{key: item[key] for key in
                           ['change_id', 'round', 'message_key']} for item in items]}, format='json')

    def test_read_persists_per_account_without_completing_tasks(self):
        change, round = self.record('public')
        item = self.inbox(self.reviewer).data['items'][0]
        self.assertEqual(self.mark_read(self.reviewer, [item]).status_code, 200)
        data = self.inbox(self.reviewer).data
        self.assertEqual(data['unread_count'], 0); self.assertEqual(data['count'], 1)
        self.assertTrue(data['items'][0]['is_read'])
        self.assertEqual(self.inbox(self.second).data['unread_count'], 1)
        self.assertEqual(self.mark_read(self.reviewer, [item]).status_code, 200)
        self.assertEqual(ReviewInboxRead.objects.count(), 1)
        change.refresh_from_db(); self.assertEqual(change.status, 'pending')
        self.assertFalse(ReviewRecord.objects.filter(approved_at__isnull=False).exists())
        change.title = 'Ordinary edit'; change.save()
        self.assertEqual(self.inbox(self.reviewer).data['unread_count'], 0)

    def test_new_response_and_new_round_notify_again_and_stale_read_cannot_hide_them(self):
        change, round = self.record('public')
        old = self.inbox(self.reviewer).data['items'][0]
        self.mark_read(self.reviewer, [old])
        issue = ReviewIssue.objects.create(change=change, source_round=round, author=self.reviewer,
                                          tab='overview', text='Response', state='awaiting_review')
        def incoming():
            ReviewIssueEvent.objects.create(change=change, round=round, issue=issue, author=self.owner,
                kind='respond', text='New response', state='awaiting_review', version=issue.version,
                request_id=uuid.uuid4(), payload={})
        incoming()
        new = self.inbox(self.reviewer).data
        self.assertEqual(new['unread_count'], 2)
        self.assertEqual(self.mark_read(self.reviewer, [old]).status_code, 409)
        self.mark_read(self.reviewer, new['items'])
        issue.version += 1; issue.save()
        incoming()
        self.assertEqual(self.inbox(self.reviewer).data['unread_count'], 2)
        self.mark_read(self.reviewer, self.inbox(self.reviewer).data['items'])
        issue.state = 'resolved'; issue.save()
        self.assertEqual(self.inbox(self.reviewer).data['unread_count'], 0)
        self.mark_read(self.reviewer, self.inbox(self.reviewer).data['items'])
        change.current_review_round = 2; change.save()
        ReviewRound.objects.create(change=change, number=2, review_mode='public', submitted_at=timezone.now(),
                                  title=change.title, ecr_no=change.ecr_no)
        self.assertEqual(self.inbox(self.reviewer).data['unread_count'], 1)

    def test_batch_reads_are_atomic_and_cannot_mark_an_inaccessible_application(self):
        self.record('public')
        self.record(assigned=self.second)
        own = self.inbox(self.reviewer).data['items'][0]
        private = next(item for item in self.inbox(self.second).data['items'] if item['change_id'] != own['change_id'])
        self.assertEqual(self.mark_read(self.reviewer, [own, private]).status_code, 409)
        self.assertEqual(ReviewInboxRead.objects.count(), 0)
        self.assertEqual(self.mark_read(self.reviewer, [own, own]).status_code, 400)

    def test_read_write_requires_csrf_for_session_authentication(self):
        self.record('public')
        item = self.inbox(self.reviewer).data['items'][0]
        payload = {'items': [{key: item[key] for key in ['change_id', 'round', 'message_key']}]}
        client = APIClient(enforce_csrf_checks=True); client.force_login(self.reviewer)
        self.assertEqual(client.post('/api/review/inbox/read/', payload, format='json').status_code, 403)
        self.assertEqual(ReviewInboxRead.objects.count(), 0)
        token = client.get('/api/auth/csrf/').json()['csrfToken']
        self.assertEqual(client.post('/api/review/inbox/read/', payload, format='json', HTTP_X_CSRFTOKEN=token).status_code, 200)

    def test_pending_tasks_obey_assigned_public_current_round_and_personal_vote(self):
        designated, round = self.record()
        public, _ = self.record('public')
        private, _ = self.record(assigned=self.second)
        approved, _ = self.record(state='approved')
        self.assertEqual({row['change_id'] for row in self.inbox(self.reviewer).data['items']}, {designated.pk, public.pk})
        ReviewRecord.objects.filter(round=round).update(approved_at=timezone.now())
        self.assertEqual(self.inbox(self.reviewer).data['count'], 1)
        self.assertEqual({row['change_id'] for row in self.inbox(self.second).data['items']}, {private.pk, public.pk})
        self.assertEqual(self.inbox(self.owner).data['count'], 0)
        public.current_review_round = 2; public.save()
        self.assertEqual(self.inbox(self.reviewer).data['count'], 0)

    def test_returned_opinions_are_owner_only_and_responses_original_author_only(self):
        change, round = self.record('public', 'returned')
        issue = ReviewIssue.objects.create(change=change, source_round=round, author=self.reviewer,
                                          tab='overview', text='Please revise')
        self.assertEqual(self.inbox(self.owner).data['count'], 1)
        self.assertTrue(self.inbox(self.owner).data['items'][0]['open_issues'])
        self.mark_read(self.owner, self.inbox(self.owner).data['items'])
        self.assertEqual(self.inbox(self.other).data['count'], 0)
        self.assertEqual(self.inbox(self.reviewer).data['count'], 0)
        issue.state = 'awaiting_review'; issue.save()
        self.assertEqual(self.inbox(self.owner).data['unread_count'], 0)
        result = self.inbox(self.reviewer).data
        self.assertEqual(result['count'], 1)
        self.assertIn('待填写员重提', result['items'][0]['summary'])
        self.assertEqual(result['items'][0]['title'], 'Submitted title')
        self.assertEqual(self.inbox(self.second).data['count'], 0)
        self.assertFalse(self.inbox(self.owner).data['items'][0]['open_issues'])
        issue.state = 'resolved'; issue.save()
        self.assertEqual(self.inbox(self.reviewer).data['count'], 0)

    def test_unassigned_author_and_changed_account_cannot_read_messages(self):
        change, round = self.record(assigned=self.second)
        ReviewIssue.objects.create(change=change, source_round=round, author=self.reviewer,
                                   tab='overview', text='Old author', state='awaiting_review')
        self.assertEqual(self.inbox(self.reviewer).data['items'], [])
        self.assertEqual(self.inbox(self.owner, HTTP_X_EXPECTED_USER=str(self.other.pk)).status_code, 409)
        self.assertIn(APIClient().get('/api/review/inbox/').status_code, [401, 403])

    def test_task_and_responses_count_separately_and_terminal_states_disappear(self):
        change, round = self.record('public')
        for _ in range(2):
            ReviewIssue.objects.create(change=change, source_round=round, author=self.reviewer,
                                       tab='overview', text='Reply', state='awaiting_review')
        self.assertEqual(self.inbox(self.reviewer).data['count'], 3)
        round.state = 'approved'; round.save(); change.status = 'approved'; change.save()
        self.assertEqual(self.inbox(self.reviewer).data['count'], 0)


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class InboxReadConcurrencyTests(TransactionTestCase):
    def test_incoming_reply_waits_for_read_snapshot_and_new_read_wins(self):
        owner = get_user_model().objects.create_user('race-inbox-owner')
        reviewer = get_user_model().objects.create_user('race-inbox-reviewer')
        group, _ = Group.objects.get_or_create(name=REVIEWER_GROUP); reviewer.groups.add(group)
        change = ChangeRequest.objects.create(applicant=owner, title='Race', ecr_no='RACE-INBOX', status='pending', current_review_round=1)
        round = ReviewRound.objects.create(change=change, number=1, review_mode='public', submitted_at=timezone.now(), title=change.title, ecr_no=change.ecr_no)
        issue = ReviewIssue.objects.create(change=change, source_round=round, author=reviewer, tab='overview', text='Revise')
        client = APIClient(); client.force_authenticate(reviewer)
        old = client.get('/api/review/inbox/').data['items'][0]
        marker_reached, release = Event(), Event()
        original = ReviewInboxRead.objects.update_or_create

        def paused_marker(*args, **kwargs):
            marker_reached.set()
            if not release.wait(5):
                raise RuntimeError('Read test release timed out')
            return original(*args, **kwargs)

        def mark_old():
            try:
                local = APIClient(); local.force_authenticate(reviewer)
                return local.post('/api/review/inbox/read/', {'items': [{key: old[key] for key in ['change_id', 'round', 'message_key']}]}, format='json').status_code
            finally:
                connections.close_all()

        def incoming_and_read():
            try:
                with transaction.atomic():
                    ChangeRequest.objects.select_for_update().get(pk=change.pk)
                    ReviewIssue.objects.filter(pk=issue.pk).update(state='awaiting_review', version=2)
                    ReviewIssueEvent.objects.create(change=change, round=round, issue=issue, author=owner, kind='respond', state='awaiting_review', version=2, request_id=uuid.uuid4(), payload={})
                local = APIClient(); local.force_authenticate(reviewer)
                new = local.get('/api/review/inbox/').data['items'][0]
                return local.post('/api/review/inbox/read/', {'items': [{key: new[key] for key in ['change_id', 'round', 'message_key']}]}, format='json').status_code
            finally:
                connections.close_all()

        with patch.object(ReviewInboxRead.objects, 'update_or_create', side_effect=paused_marker):
            with ThreadPoolExecutor(max_workers=2) as pool:
                old_request = pool.submit(mark_old)
                self.assertTrue(marker_reached.wait(5))
                newer = pool.submit(incoming_and_read)
                try:
                    with self.assertRaises(TimeoutError):
                        newer.result(timeout=.3)
                finally:
                    release.set()
                self.assertEqual(old_request.result(timeout=8), 200)
                self.assertEqual(newer.result(timeout=8), 200)
        self.assertEqual(client.get('/api/review/inbox/').data['unread_count'], 0)
