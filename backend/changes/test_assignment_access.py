import hashlib
import json
import uuid

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import ChangeRequest, ReviewRound, ReviewRecord, ReviewIssue, ReviewIssueEvent, ReviewInboxRead
from .roles import REVIEWER_GROUP, can_review
from .review_access import eligible


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class AssignmentAccessTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.a = User.objects.create_user('assignment-a')
        cls.b = User.objects.create_user('assignment-b')
        cls.c = User.objects.create_user('assignment-c')
        cls.legacy = User.objects.create_user('assignment-legacy')
        cls.legacy.groups.add(Group.objects.get_or_create(name=REVIEWER_GROUP)[0])

    def client_for(self, user):
        client = APIClient(); client.force_authenticate(user)
        return client

    def create(self):
        self.assertEqual(connection.vendor, 'mysql')
        self.change = ChangeRequest.objects.create(applicant=self.a, title='Assignment', ecr_no=str(uuid.uuid4()))
        self.base = f'/api/changes/{self.change.pk}/'
        self.owner = self.client_for(self.a); self.reviewer = self.client_for(self.b)

    def submit(self, number=0):
        return self.owner.post(self.base+'submission/', {'review_mode':'designated', 'reviewer_ids':[self.b.pk], 'expected_round':number, 'request_id':str(uuid.uuid4())}, format='json')

    def act(self, client, action, number=1, **values):
        return client.post(self.base+f'review-rounds/{number}/{action}/', {'request_id':str(uuid.uuid4()), **values}, format='json')

    def test_ordinary_accounts_are_candidates_and_assignees_can_finish(self):
        self.create()
        ids = [row['id'] for row in self.owner.get('/api/reviewers/').data]
        self.assertIn(self.b.pk, ids); self.assertNotIn(self.a.pk, ids)
        self.assertTrue(can_review(self.b))
        ordinary = self.client_for(self.c); ordinary.force_login(self.c)
        self.assertTrue(ordinary.get('/api/auth/me/').json()['can_review'])
        self.assertEqual(ordinary.post('/api/changes/', {}, format='json').status_code,201)
        self.assertEqual(self.submit().status_code, 200)
        self.assertEqual(self.client_for(self.c).get('/api/review/').data, [])
        self.assertEqual(self.reviewer.get('/api/review/').data[0]['change_id'], self.change.pk)
        self.assertEqual(self.act(self.reviewer, 'approve').status_code, 200)
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'approved')

    def test_outsider_self_disabled_and_foreign_write_are_rejected(self):
        self.create(); self.submit()
        outsider = self.client_for(self.c)
        self.assertEqual(outsider.get(self.base).status_code, 404)
        self.assertEqual(self.act(outsider, 'approve').status_code, 404)
        self.assertEqual(self.act(self.owner, 'approve').status_code, 403)
        self.assertEqual(self.reviewer.patch(self.base, {'title':'No'}, format='json').status_code, 404)
        self.assertEqual(self.act(self.reviewer, 'return', issues=[{'tab':'overview','text':'Explain'}]).status_code, 200)
        self.assertEqual(self.reviewer.get(self.base).status_code, 404)
        self.b.is_active = False; self.b.save(update_fields=['is_active'])
        self.assertFalse(eligible(self.b, self.change.review_rounds.get(number=1)))
        self.assertEqual(self.reviewer.get('/api/review/').data, [])
        self.assertEqual(self.submit(1).status_code, 409)  # Disabled original author blocks re-submission.
        self.b.is_active = True; self.b.save(update_fields=['is_active'])

    def test_ordinary_issue_author_receives_replies_resolves_and_keeps_reads(self):
        self.create(); self.submit()
        initial = self.reviewer.get('/api/review/inbox/').data['items'][0]
        expected = hashlib.sha256(json.dumps(['reviewer', self.change.review_rounds.get().pk, 0]).encode()).hexdigest()
        self.assertEqual(initial['message_key'], expected)
        receipt = {'items':[{key:initial[key] for key in ['change_id','round','message_key']}]}
        self.assertEqual(self.reviewer.post('/api/review/inbox/read/', receipt, format='json').data['unread_count'], 0)
        self.assertEqual(self.act(self.reviewer,'return',issues=[{'tab':'overview','text':'Explain'}]).status_code,200)
        self.a.groups.add(Group.objects.get(name=REVIEWER_GROUP))
        self.assertTrue(self.owner.get(self.base+'review-rounds/1/').data['issues'][0]['can_respond'])
        issue = ReviewIssue.objects.get(change=self.change)
        self.assertEqual(self.act(self.owner,'respond',issue_id=issue.pk,version=issue.version,text='Explained').status_code,200)
        self.assertEqual(self.submit(1).status_code,200)
        self.assertFalse(self.owner.get(self.base+'review-rounds/2/').data['can_approve'])
        self.assertEqual(self.act(self.owner,'approve',2).status_code,403)
        items = self.reviewer.get('/api/review/inbox/').data['items']
        self.assertEqual(items[0]['context'],'reviewer'); self.assertFalse(items[0]['is_read'])
        issue.refresh_from_db()
        self.assertEqual(self.act(self.reviewer,'resolve',2,issue_id=issue.pk,version=issue.version,text='Verified').status_code,200)
        self.assertEqual(self.act(self.reviewer,'approve',2).status_code,200)
        self.assertTrue(ReviewInboxRead.objects.filter(user=self.b).exists())

    def test_new_public_rejected_but_legacy_visibility_and_request_receipt_survive(self):
        self.create()
        payload = {'review_mode':'public','reviewer_ids':[], 'expected_round':0,'request_id':str(uuid.uuid4())}
        self.assertEqual(self.owner.post(self.base+'submission/',payload,format='json').status_code,400)
        self.assertFalse(ReviewRound.objects.exists()); self.assertFalse(ReviewRecord.objects.exists())
        self.change.refresh_from_db(); self.assertEqual(self.change.status,'draft')
        old = ReviewRound.objects.create(change=self.change,number=1,review_mode='public',state='approved',submitted_at=timezone.now(),title='Legacy',ecr_no=self.change.ecr_no,request_id=payload['request_id'])
        self.change.status='approved'; self.change.review_mode='public'; self.change.current_review_round=1; self.change.submitted_at=old.submitted_at; self.change.save()
        self.assertEqual(self.owner.get(self.base).status_code,200)
        self.assertEqual(self.client_for(self.legacy).get(self.base).status_code,200)
        self.assertEqual(self.reviewer.get(self.base).status_code,404)
        self.assertEqual(self.owner.post(self.base+'submission/',payload,format='json').status_code,200)
        self.change.status='returned'; self.change.save()
        new = {**payload,'expected_round':1,'request_id':str(uuid.uuid4())}
        self.assertEqual(self.owner.post(self.base+'submission/',new,format='json').status_code,400)
        self.assertEqual(ReviewRound.objects.count(),1)

    def test_current_assignee_cannot_receive_opinions_from_inaccessible_legacy_public_round(self):
        self.create()
        old=ReviewRound.objects.create(change=self.change,number=1,review_mode='public',state='returned',submitted_at=timezone.now(),title='Legacy',ecr_no=self.change.ecr_no)
        issue=ReviewIssue.objects.create(change=self.change,source_round=old,author=self.legacy,tab='overview',text='Private historical opinion',state='resolved')
        ReviewIssueEvent.objects.create(change=self.change,round=old,issue=issue,author=self.legacy,kind='resolve',text='Private historical explanation',state='resolved',version=1,request_id=uuid.uuid4(),payload={})
        self.change.current_review_round=1;self.change.status='returned';self.change.review_mode='public';self.change.save()
        self.assertEqual(self.submit(1).status_code,200)
        data=self.reviewer.get(self.base+'review-rounds/2/').data
        self.assertEqual([row['number'] for row in data['history']],[2])
        self.assertEqual(data['issues'],[])
        owner_data=self.owner.get(self.base+'review-rounds/2/').data
        self.assertEqual(owner_data['issues'][0]['text'],'Private historical opinion')
