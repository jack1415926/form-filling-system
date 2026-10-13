import hashlib
import json
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

from .models import ChangeRequest, ReviewInboxRead, ReviewIssue, ReviewIssueEvent, ReviewRecord, ReviewRound, ActionTask
REVIEWER_GROUP = '审核员'  # historical fixture name, not an application permission


class InboxReadConcurrencyTests(TransactionTestCase):
    def test_incoming_reply_waits_for_read_snapshot_and_new_read_wins(self):
        owner = get_user_model().objects.create_user('race-inbox-owner')
        reviewer = get_user_model().objects.create_user('race-inbox-reviewer')
        group, _ = Group.objects.get_or_create(name=REVIEWER_GROUP); reviewer.groups.add(group)
        change = ChangeRequest.objects.create(applicant=owner, title='Race', ecr_no='RACE-INBOX', status='pending', current_review_round=1)
        round = ReviewRound.objects.create(change=change, number=1, review_mode='designated', submitted_at=timezone.now(), title=change.title, ecr_no=change.ecr_no)
        ReviewRecord.objects.create(change=change, round=round, reviewer=reviewer)
        ActionTask.objects.create(round=round, action_key='ecr_001', owner=reviewer)
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
