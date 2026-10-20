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


class PublicationInboxTests(TestCase):
    def test_publication_entry_is_independent_of_stage_and_applicant(self):
        owner = get_user_model().objects.create_user('entry-owner')
        publisher = get_user_model().objects.create_user('entry-publisher')
        outsider = get_user_model().objects.create_user('entry-outsider')
        client = APIClient()
        for stage in ['ecr', 'eco']:
            for same_person in [True, False]:
                with self.subTest(stage=stage, same_person=same_person):
                    actor = owner if same_person else publisher
                    source = ChangeRequest.objects.create(applicant=owner, stage='ecr', status='published',
                        published_by=owner, published_at=timezone.now(), publication_request_id=uuid.uuid4()) if stage == 'eco' else None
                    change = ChangeRequest.objects.create(applicant=owner, publisher=actor, stage=stage,
                        source_ecr=source, eco_creation_request_id=uuid.uuid4() if source else None,
                        status='approved', current_review_round=2)
                    for number, state in [(1, 'returned'), (2, 'approved')]:
                        ReviewRound.objects.create(change=change, number=number, state=state,
                            review_mode='designated', submitted_at=timezone.now(), title='Publication entry')
                    path = f'/api/changes/{change.pk}/'
                    client.force_authenticate(actor)
                    item = next(row for row in client.get('/api/review/inbox/').data['items'] if row['change_id'] == change.pk)
                    self.assertEqual(item['context'], 'publication')
                    self.assertEqual(item['round'], 2)
                    self.assertFalse(item['open_issues'])
                    marked = client.post('/api/review/inbox/read/', {'items': [
                        {key: item[key] for key in ['change_id', 'round', 'message_key']}
                    ]}, format='json')
                    self.assertEqual(marked.status_code, 200)
                    self.assertTrue(next(row for row in marked.data['items'] if row['change_id'] == change.pk)['is_read'])
                    self.assertIn(change.pk, [row['id'] for row in client.get('/api/publications/').data])
                    self.assertEqual(client.get(path).status_code, 200)
                    self.assertTrue(client.get(path + 'publication/').data['can_publish'])
                    history = client.get(path + 'review-rounds/1/').data
                    self.assertFalse(history['is_current'])
                    self.assertFalse(history['can_approve'])
                    if not same_person:
                        client.force_authenticate(owner)
                        self.assertFalse(client.get(path + 'publication/').data['can_publish'])
                        self.assertEqual(client.post(path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 2}, format='json').status_code, 409)
                    client.force_authenticate(outsider)
                    self.assertNotIn(change.pk, [row['change_id'] for row in client.get('/api/review/inbox/').data['items']])
                    self.assertIn(client.post(path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 2}, format='json').status_code, [404, 409])
                    client.force_authenticate(actor)
                    response = client.post(path + 'publication/', {'request_id': str(uuid.uuid4()), 'expected_round': 2}, format='json')
                    self.assertEqual(response.status_code, 200, response.data)
                    self.assertFalse(response.data['can_publish'])
                    self.assertNotIn(change.pk, [row['change_id'] for row in client.get('/api/review/inbox/').data['items']])
                    self.assertNotIn(change.pk, [row['id'] for row in client.get('/api/publications/').data])


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
