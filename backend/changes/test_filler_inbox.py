import uuid
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from .models import ChangeRequest, EcoFillerInboxRead


class FillerInboxTests(TestCase):
    def setUp(self):
        self.actor, self.filler, self.other = [get_user_model().objects.create_user('inbox-' + name) for name in ['actor', 'filler', 'other']]
        self.source = ChangeRequest.objects.create(applicant=self.actor, stage='ecr', status='published',
            ecr_no='INBOX-ECR', title='Inbox', publisher=self.actor, published_by=self.actor,
            published_at=timezone.now(), publication_request_id=uuid.uuid4())
        self.client = APIClient(); self.client.force_authenticate(self.actor)
        response = self.client.post(f'/api/changes/{self.source.pk}/eco/', {'request_id': str(uuid.uuid4()), 'filler_id': self.filler.pk}, format='json')
        self.assertEqual(response.status_code, 201)
        self.eco = ChangeRequest.objects.get(pk=response.data['change']['id'])
        self.inbox = '/api/eco-filler/inbox/'

    def test_creation_read_is_persistent_and_does_not_change_business_state(self):
        self.client.force_authenticate(self.filler)
        data = self.client.get(self.inbox).data
        self.assertEqual(data['unread_count'], 1)
        item = data['items'][0]
        self.assertEqual((item['change_id'], item['kind'], item['source_ecr_no']), (self.eco.pk, 'create', 'INBOX-ECR'))
        before = (self.eco.status, self.eco.updated_at, self.eco.applicant_id)
        for _ in range(2):
            self.assertEqual(self.client.post(self.inbox + 'read/', {'event_id': item['event_id']}, format='json').status_code, 200)
        client = APIClient(); client.force_authenticate(self.filler)
        self.assertEqual(client.get(self.inbox).data['unread_count'], 0)
        self.assertEqual(EcoFillerInboxRead.objects.count(), 1)
        self.eco.refresh_from_db()
        self.assertEqual(before, (self.eco.status, self.eco.updated_at, self.eco.applicant_id))

    def test_transfer_only_notifies_current_recipient_and_old_read_cannot_hide_new_event(self):
        self.client.force_authenticate(self.filler)
        original = self.client.get(self.inbox).data['items'][0]
        self.client.force_authenticate(self.actor)
        def transfer(filler):
            self.eco.refresh_from_db()
            response = self.client.post(f'/api/changes/{self.eco.pk}/eco-filler/', {'request_id': str(uuid.uuid4()),
                'filler_id': filler.pk, 'expected_filler_id': self.eco.applicant_id, 'expected_updated_at': self.eco.updated_at.isoformat()}, format='json')
            self.assertEqual(response.status_code, 200)
        transfer(self.other)
        self.client.force_authenticate(self.filler)
        self.assertEqual(self.client.get(self.inbox).data['unread_count'], 0)
        self.assertEqual(self.client.post(self.inbox + 'read/', {'event_id': original['event_id']}, format='json').status_code, 404)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.inbox).data['items'][0]['kind'], 'transfer')
        self.client.force_authenticate(self.actor); transfer(self.filler)
        self.client.force_authenticate(self.filler)
        self.assertEqual(self.client.post(self.inbox + 'read/', {'event_id': original['event_id']}, format='json').status_code, 409)
        self.assertEqual(self.client.get(self.inbox).data['unread_count'], 1)

    def test_isolation_account_guard_self_assignment_and_strict_read_payload(self):
        self.client.force_authenticate(self.filler)
        item = self.client.get(self.inbox).data['items'][0]
        self.client.credentials(HTTP_X_EXPECTED_USER=str(self.other.pk))
        self.assertEqual(self.client.get(self.inbox).status_code, 409)
        self.client.credentials()
        for payload in [{}, {'event_id': True}, {'event_id': str(item['event_id'])}, {'event_id': item['event_id'], 'extra': 1}]:
            self.assertEqual(self.client.post(self.inbox + 'read/', payload, format='json').status_code, 400)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.inbox).data['unread_count'], 0)
        self.assertEqual(self.client.post(self.inbox + 'read/', {'event_id': item['event_id']}, format='json').status_code, 404)
        self.eco.filler_events.all().delete()
        self.eco.filler_events.create(kind='baseline', filler=self.filler)
        self.client.force_authenticate(self.filler)
        self.assertEqual(self.client.get(self.inbox).data['unread_count'], 0)
        self.eco.filler_events.all().delete()
        self.eco.filler_events.create(kind='transfer', filler=self.filler, actor=self.filler, request_id=uuid.uuid4())
        self.assertEqual(self.client.get(self.inbox).data['unread_count'], 0)
