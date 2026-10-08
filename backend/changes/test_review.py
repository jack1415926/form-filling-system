import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings, tag
from rest_framework.test import APIClient

from .models import ChangeRequest, ReviewRound, ReviewRecord, ReviewFeedback, MaterialChange
from .roles import REVIEWER_GROUP


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ReviewFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner=get_user_model().objects.create_user('review-owner',password='test-password')
        cls.other=get_user_model().objects.create_user('review-other',password='test-password')
        group,_=Group.objects.get_or_create(name=REVIEWER_GROUP)
        cls.reviewers=[get_user_model().objects.create_user('review-person-'+str(i),password='test-password') for i in [1,2,3]]
        for user in cls.reviewers:user.groups.add(group)

    def setUp(self):
        self.change=ChangeRequest.objects.create(applicant=self.owner,title='Original title',ecr_no='REVIEW-001',eco_no='ECO-001')
        self.base=f'/api/changes/{self.change.pk}/'
        self.owner_client=self.client_for(self.owner)
        self.clients=[self.client_for(user) for user in self.reviewers]

    def client_for(self,user):
        client=APIClient();client.force_authenticate(user);return client

    def submit(self,mode='designated',people=None):
        self.change.refresh_from_db()
        payload={'review_mode':mode,'reviewer_ids':[u.pk for u in self.reviewers[:2]] if people is None else people,
                 'expected_round':self.change.current_review_round,'request_id':str(uuid.uuid4())}
        return self.owner_client.post(self.base+'submission/',payload,format='json'),payload

    def action(self,index,kind,number=1,text='Reason',request_id=None):
        data={'request_id':str(request_id or uuid.uuid4())} if kind=='approve' else {'request_id':str(request_id or uuid.uuid4()),'issues':[{'tab':'overview','text':text}]} if kind=='return' else {'text':text}
        if kind=='feedback':data['request_id']=str(request_id or uuid.uuid4())
        return self.clients[index].post(self.base+f'review-rounds/{number}/{kind}/',data,format='json')

    def legacy_return(self,index=0,number=1,text='Legacy reason'):
        # Fixture for an application returned before formal opinions existed.
        self.change.refresh_from_db()
        round=self.change.review_rounds.get(number=number)
        round.state='returned';round.returned_by=self.reviewers[index];round.return_reason=text;round.save()
        self.change.status='returned';self.change.save()

    def metadata(self,client=None,number=1):
        return (client or self.clients[0]).get(self.base+f'review-rounds/{number}/')

    def test_assigned_list_and_all_eight_form_gets_are_readonly_and_isolated(self):
        response,_=self.submit();self.assertEqual(response.status_code,200)
        list=self.clients[0].get('/api/review/?kind=designated').json();self.assertEqual(len(list),1);self.assertEqual(list[0]['number'],1)
        for suffix in ['', 'materials/', 'questions/', 'ecr-actions/', 'eco-actions/', 'emc/', 'execution-plan/', 'significant-change/']:
            with self.subTest(suffix=suffix):
                self.assertEqual(self.clients[0].get(self.base+suffix).status_code,200)
                self.assertEqual(self.clients[2].get(self.base+suffix).status_code,404)
        self.assertEqual(self.clients[0].patch(self.base,{'title':'no'},format='json').status_code,403)
        self.assertEqual(self.metadata(self.client_for(self.other)).status_code,404)
        draft=ChangeRequest.objects.create(applicant=self.owner)
        self.assertEqual(self.clients[0].get(f'/api/changes/{draft.pk}/').status_code,404)

    def test_designated_approvals_deduplicate_and_move_to_handled_before_final_approval(self):
        self.submit();first=self.action(0,'approve');self.assertEqual(first.status_code,200)
        self.change.refresh_from_db();self.assertEqual(self.change.status,'pending')
        self.assertEqual(self.clients[0].get('/api/review/?kind=designated').json(),[])
        self.assertEqual(len(self.clients[0].get('/api/review/?kind=handled').json()),1)
        self.assertTrue(first.json()['can_return']);self.assertFalse(first.json()['can_approve'])
        self.assertEqual(self.action(0,'approve').status_code,200)
        self.assertEqual(self.action(1,'approve').status_code,200)
        self.change.refresh_from_db();self.assertEqual(self.change.status,'approved')
        self.assertEqual(ReviewRecord.objects.filter(approved_at__isnull=False).count(),2)
        self.assertEqual(self.action(0,'return').status_code,409)
        self.assertEqual(self.action(0,'feedback').status_code,409)
        self.assertEqual(self.submit()[0].status_code,409)

    def test_public_two_people_approve_and_third_cannot_add_a_vote_after_completion(self):
        self.assertEqual(self.submit('public',[])[0].status_code,200)
        self.assertEqual(len(self.clients[2].get('/api/review/?kind=public').json()),1)
        self.assertEqual(self.action(0,'approve').status_code,200);self.change.refresh_from_db();self.assertEqual(self.change.status,'pending')
        self.assertEqual(self.action(1,'approve').status_code,200);self.change.refresh_from_db();self.assertEqual(self.change.status,'approved')
        self.assertEqual(self.action(2,'approve').status_code,409);self.assertEqual(ReviewRecord.objects.count(),2)
        self.assertEqual(self.action(1,'approve').status_code,200)

    def test_return_after_personal_approval_hides_editing_form_and_reopens_all_owner_writes(self):
        material=MaterialChange.objects.create(change=self.change,category='revision')
        self.submit();self.action(0,'approve')
        self.assertEqual(self.action(0,'return',text='Need clarification').status_code,200)
        self.change.refresh_from_db();self.assertEqual(self.change.status,'returned')
        data=self.metadata().json();self.assertFalse(data['can_view_form']);self.assertIsNone(data['form']);self.assertFalse(data['can_feedback'])
        for suffix in ['', 'materials/', 'questions/', 'ecr-actions/', 'eco-actions/', 'emc/', 'execution-plan/', 'significant-change/']:
            self.assertEqual(self.clients[0].get(self.base+suffix).status_code,404)
        writes=[(self.base,{'title':'Revised private title'}),(self.base+f'materials/{material.pk}/',{'description':'updated'}),
                (self.base+'questions/',{'responses':{'1':{'answer':'Y'}}}),(self.base+'ecr-actions/ecr_001/',{'owner':'owner'}),
                (self.base+'eco-actions/eco_001/',{'owner':'owner'}),(self.base+'emc/',{'cells':{'emc_change_001/emc_test_001':{'mark':'X'}}}),
                (self.base+'execution-plan/',{'responses':{'plan_001':{'remark':'updated'}}}),
                (self.base+'significant-change/',{'charts':{'A':{'reason':'updated'}}})]
        for path,payload in writes:self.assertEqual(self.owner_client.patch(path,payload,format='json').status_code,200)
        self.assertEqual(self.owner_client.post(self.base+'materials/',{'category':'addition'},format='json').status_code,201)
        self.assertEqual(self.owner_client.delete(self.base+f'materials/{material.pk}/').status_code,204)
        self.assertEqual(self.owner_client.delete(self.base).status_code,409)
        self.assertEqual(self.metadata().json()['round']['title'],'Original title')
        self.assertEqual(self.action(1,'approve').status_code,409)

    def test_legacy_resubmission_starts_fresh_round_revokes_old_reviewer_and_retains_opinions(self):
        self.submit();ReviewFeedback.objects.create(round=self.change.review_rounds.get(number=1),author=self.reviewers[0],text='Original opinion',request_id=uuid.uuid4());self.action(0,'approve');self.legacy_return(1)
        note=ReviewFeedback.objects.first();self.assertIsNotNone(note)
        self.owner_client.patch(self.base,{'title':'New title'},format='json')
        response,payload=self.submit(people=[self.reviewers[2].pk]);self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['change']['current_review_round'],2)
        self.assertEqual(self.owner_client.post(self.base+'submission/',payload,format='json').status_code,200)
        self.assertEqual(self.clients[0].get(self.base).status_code,404)
        self.assertEqual(self.metadata(self.clients[0],2).status_code,404)
        new=self.metadata(self.clients[2],2).json();self.assertTrue(new['can_view_form']);self.assertEqual(new['round']['approvals'],[])
        self.assertEqual(new['feedback'][0]['text'],'Original opinion')
        self.assertEqual(self.action(0,'approve',number=1).status_code,409)
        self.assertEqual(self.action(0,'feedback',number=1).status_code,409)
        old=self.metadata(self.clients[0],1).json();self.assertEqual([r['number'] for r in old['history']],[1]);self.assertFalse(old['can_feedback'])
        self.assertEqual(self.action(2,'approve',number=2).status_code,200)
        self.change.refresh_from_db();self.assertEqual(self.change.status,'approved')

    def test_legacy_retired_submission_request_cannot_create_or_confirm_a_new_round(self):
        _,original=self.submit();self.legacy_return()
        self.assertEqual(self.owner_client.post(self.base+'submission/',original,format='json').status_code,200)
        self.assertEqual(ReviewRound.objects.count(),1)
        response,new=self.submit('public',[]);self.assertEqual(response.status_code,200)
        self.assertEqual(self.owner_client.post(self.base+'submission/',original,format='json').status_code,409)
        self.assertEqual(self.owner_client.post(self.base+'submission/',new,format='json').status_code,200)
        self.assertEqual(ReviewRound.objects.count(),2)

    def test_returned_discussion_list_includes_unapproved_assignees_and_excludes_outsiders(self):
        self.submit();self.legacy_return()
        rows=self.clients[1].get('/api/review/?kind=returned').json()
        self.assertEqual([(row['change_id'],row['number']) for row in rows],[(self.change.pk,1)])
        self.assertEqual(self.clients[1].get('/api/review/?kind=handled').json(),[])
        self.assertEqual(self.clients[2].get('/api/review/?kind=returned').json(),[])
        data=self.metadata(self.clients[1]).json()
        self.assertFalse(data['can_feedback']);self.assertFalse(data['can_view_form']);self.assertIsNone(data['form'])
        self.assertEqual(self.action(1,'feedback').status_code,409)
        self.submit(people=[self.reviewers[2].pk])
        self.assertEqual(self.clients[1].get('/api/review/?kind=returned').json(),[])
        self.assertEqual(self.metadata(self.clients[1],2).status_code,404)

    def test_returned_public_discussion_is_discoverable_without_a_personal_vote(self):
        self.submit('public',[]);self.legacy_return()
        rows=self.clients[2].get('/api/review/?kind=returned').json()
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['state'],'returned')
        self.assertFalse(self.metadata(self.clients[2]).json()['can_feedback'])
        self.assertEqual(self.clients[2].get(self.base).status_code,404)
        self.submit('public',[])
        self.assertEqual(self.clients[2].get('/api/review/?kind=returned').json(),[])

    def test_legacy_feedback_is_readonly_and_survives_resubmission(self):
        self.submit();self.legacy_return()
        note=ReviewFeedback.objects.create(round=self.change.review_rounds.get(number=1),author=self.reviewers[0],text='Old feedback',request_id=uuid.uuid4())
        self.assertEqual(self.action(0,'feedback').status_code,409)
        self.assertEqual(self.metadata().json()['feedback'][0]['text'],note.text)
        self.assertEqual(self.submit()[0].status_code,200)
        self.assertEqual(self.metadata(number=2).json()['feedback'][0]['text'],note.text)
        self.assertEqual(ReviewFeedback.objects.count(),1)

    def test_strict_actions_permissions_csrf_and_atomic_rollback(self):
        self.submit()
        self.assertEqual(self.action(0,'return',text=' ').status_code,400)
        self.assertEqual(self.action(0,'return',text='x'*10001).status_code,400)
        self.assertEqual(self.owner_client.post(self.base+'review-rounds/1/approve/',{'request_id':str(uuid.uuid4())},format='json').status_code,403)
        csrf_client=APIClient(enforce_csrf_checks=True);csrf_client.force_login(self.reviewers[0])
        self.assertEqual(csrf_client.post(self.base+'review-rounds/1/approve/',{'request_id':str(uuid.uuid4())},format='json').status_code,403)
        with patch('changes.review_views.ChangeRequest.save',side_effect=RuntimeError('rollback')):
            with self.assertRaises(RuntimeError):self.action(0,'approve')
        self.assertFalse(ReviewRecord.objects.filter(approved_at__isnull=False).exists())
        self.change.refresh_from_db();self.assertEqual(self.change.status,'pending')
        self.assertEqual(self.clients[0].get(self.base+'review-rounds/1/approve/').status_code,405)
        self.assertEqual(self.clients[0].get('/api/review/?kind=invalid').status_code,400)


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ReviewTransactionTests(TransactionTestCase):
    def setUp(self):
        self.owner=get_user_model().objects.create_user('review-tx-owner')
        group,_=Group.objects.get_or_create(name=REVIEWER_GROUP)
        self.people=[get_user_model().objects.create_user('review-tx-'+str(i)) for i in [1,2]]
        for user in self.people:user.groups.add(group)
        self.change=ChangeRequest.objects.create(applicant=self.owner,title='Original',ecr_no='REVIEW-TX')
        client=APIClient();client.force_authenticate(self.owner)
        self.assertEqual(client.post(f'/api/changes/{self.change.pk}/submission/',{'review_mode':'public','reviewer_ids':[]},format='json').status_code,200)

    def request(self,user,action,barrier):
        try:
            client=APIClient();client.force_authenticate(user);barrier.wait(timeout=5)
            payload={'request_id':str(uuid.uuid4())}
            if action=='return':payload['issues']=[{'tab':'overview','text':'Return'}]
            return client.post(f'/api/changes/{self.change.pk}/review-rounds/1/{action}/',payload,format='json').status_code
        finally:connections['default'].close()

    def test_parallel_public_approvals_finish_once(self):
        barrier=Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as pool:
            tasks=[pool.submit(self.request,user,'approve',barrier) for user in self.people]
            self.assertEqual([task.result(timeout=10) for task in tasks],[200,200])
        self.change.refresh_from_db();self.assertEqual(self.change.status,'approved');self.assertEqual(ReviewRecord.objects.filter(approved_at__isnull=False).count(),2)

    def test_final_approval_and_return_first_committed_transition_wins(self):
        client=APIClient();client.force_authenticate(self.people[0]);client.post(f'/api/changes/{self.change.pk}/review-rounds/1/approve/',{'request_id':str(uuid.uuid4())},format='json')
        barrier=Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as pool:
            tasks=[pool.submit(self.request,self.people[1],'approve',barrier),pool.submit(self.request,self.people[0],'return',barrier)]
            self.assertEqual(sorted(task.result(timeout=10) for task in tasks),[200,409])
        self.change.refresh_from_db();self.assertIn(self.change.status,['approved','returned'])

    @tag('migration')
    def test_migration_seeds_only_actual_submissions_and_reverse_stops_before_ddl_for_history(self):
        latest=MigrationExecutor(connection).loader.graph.leaf_nodes('changes')
        try:
            MigrationExecutor(connection).migrate([('changes','0012_submission')])
            executor=MigrationExecutor(connection);old=executor.loader.project_state([('changes','0012_submission')]).apps
            OldChange=old.get_model('changes','ChangeRequest');OldRecord=old.get_model('changes','ReviewRecord')
            original=OldChange.objects.get(pk=self.change.pk);before={key:getattr(original,key) for key in ['status','title','ecr_no','review_mode','submitted_at','updated_at']}
            legacy=OldChange.objects.create(applicant_id=self.owner.pk,status='pending')
            OldRecord.objects.create(change_id=self.change.pk,reviewer_id=self.people[0].pk)
            MigrationExecutor(connection).migrate(latest)
            restored=ChangeRequest.objects.get(pk=self.change.pk)
            self.assertEqual({key:getattr(restored,key) for key in before},before)
            self.assertEqual(restored.current_review_round,1);self.assertEqual(ChangeRequest.objects.get(pk=legacy.pk).current_review_round,0)
            self.assertTrue(ReviewRecord.objects.get(change=restored).round_id)
            round=restored.review_rounds.get(number=1);round.state='returned';round.return_reason='History';round.save()
            with self.assertRaisesRegex(RuntimeError,'不能直接回退'):
                MigrationExecutor(connection).migrate([('changes','0012_submission')])
            self.assertIn('review_round',connection.introspection.table_names())
            round.state='pending';round.save()
        finally:MigrationExecutor(connection).migrate(latest)
