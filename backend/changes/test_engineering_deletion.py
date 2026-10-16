import uuid
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .management.commands.seed_workflow import Command, STATES
from .models import (ChangeRequest, MaterialChange, MaterialDisposition, QuestionResponse,
                     EcrActionResponse, EcoActionResponse, ExecutionPlanResponse,
                     SignificantAssessment, SignificantChartResponse, SignificantQuestionResponse,
                     EmcReference, EmcReferenceRow, EmcReferenceTest, EmcReferenceCell,
                     ReviewRound, ReviewRecord, ActionTask, TaskOperation,
                     ReviewIssue, ReviewIssueEvent, ReviewInboxRead, EcoFillerEvent, EcoFillerInboxRead,
                     SystemFeedback)


@override_settings(DEBUG=True)
class EngineeringDeletionTests(TestCase):
    def setUp(self):
        self.owner, self.worker, self.approver, self.other = [get_user_model().objects.create_user('delete-' + role)
                                                            for role in ['owner', 'worker', 'approver', 'other']]
        self.people = {'applicant': self.owner, 'reviewers': [self.worker],
                       'approvers': [self.approver], 'publisher': self.approver}
        self.command = Command()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def make(self, stage, state):
        return self.command.create_scenario(stage, state, self.people, uuid.uuid4().hex)

    def delete(self, record, **extra):
        return self.client.delete(f'/api/changes/{record.pk}/',
                                  {'confirm_delete': True, 'expected_eco_id': None, **extra}, format='json')

    def test_delete_unlinked_ecr_at_every_state_and_returned(self):
        for state in STATES:
            with self.subTest(state=state):
                record = self.make('ecr', state)
                listing = self.client.get('/api/engineering-changes/').data['items']
                self.assertTrue(next(row for row in listing if row['id'] == record.pk)['can_delete_ecr'])
                self.assertEqual(self.delete(record).status_code, 204)
                self.assertFalse(ChangeRequest.objects.filter(pk=record.pk).exists())
        record = self.make('ecr', 'reviewing')
        self.command.request(self.worker, 'post', record, 'review-rounds/1/return/',
                             request_id=uuid.uuid4().hex, issues=[{'tab': 'ecr', 'text': 'Test revision'}])
        record.refresh_from_db()
        self.assertEqual(record.status, 'returned')
        self.assertEqual(self.delete(record).status_code, 204)

    def test_linked_eco_all_states_need_explicit_confirmation_and_matching_scope(self):
        untouched = ChangeRequest.objects.create(applicant=self.other, title='Keep')
        material = MaterialChange.objects.create(change=untouched, category='addition')
        feedback = SystemFeedback.objects.create(submitter=self.owner, category='other', content='Keep feedback', request_id=uuid.uuid4())
        for state in STATES:
            with self.subTest(eco_state=state):
                eco = self.make('eco', state)
                source = eco.source_ecr
                self.assertEqual(self.delete(source).status_code, 409)  # ECO created after an old no-ECO preview
                self.assertEqual(self.delete(source, expected_eco_id=eco.pk).status_code, 409)
                self.assertEqual(self.delete(source, expected_eco_id=eco.pk + 1000, delete_eco=True).status_code, 409)
                self.assertTrue(ChangeRequest.objects.filter(pk=source.pk).exists())
                self.assertTrue(ChangeRequest.objects.filter(pk=eco.pk).exists())
                self.assertEqual(self.delete(source, expected_eco_id=eco.pk, delete_eco=True).status_code, 204)
                self.assertFalse(ChangeRequest.objects.filter(pk__in=[source.pk, eco.pk]).exists())
                self.assertEqual(self.delete(source, expected_eco_id=eco.pk, delete_eco=True).status_code, 404)
        self.assertTrue(MaterialChange.objects.filter(pk=material.pk).exists())
        self.assertTrue(SystemFeedback.objects.filter(pk=feedback.pk).exists())

    def test_complete_related_graph_removed_and_numbers_released(self):
        eco = self.make('eco', 'published')
        source = eco.source_ecr
        numbers = (source.ecr_no, eco.eco_no)
        for record in [source, eco]:
            round = record.review_rounds.get()
            ReviewInboxRead.objects.create(round=round, user=self.worker, signature='history')
            issue = ReviewIssue.objects.create(change=record, source_round=round, author=self.worker, tab='ecr', text='Resolved', state='resolved')
            ReviewIssueEvent.objects.create(change=record, round=round, issue=issue, author=self.worker,
                                            kind='resolve', state='resolved', request_id=uuid.uuid4(), payload={})
            reference = record.emc_reference
            EmcReferenceCell.objects.create(reference=reference, row=reference.rows.first(), test=reference.tests.first(), mark='X')
            SignificantQuestionResponse.objects.create(change=record, question_key='sub_a_1', answer='N')
        EcoFillerInboxRead.objects.create(user=self.owner, event=eco.filler_events.get(kind='create'))
        self.assertEqual(self.delete(source, expected_eco_id=eco.pk, delete_eco=True).status_code, 204)
        for model in [ChangeRequest, MaterialChange, MaterialDisposition, QuestionResponse, EcrActionResponse,
                      EcoActionResponse, ExecutionPlanResponse, SignificantAssessment, SignificantChartResponse,
                      SignificantQuestionResponse, EmcReference, EmcReferenceRow, EmcReferenceTest, EmcReferenceCell,
                      ReviewRound, ReviewRecord, ActionTask, TaskOperation, ReviewIssue,
                      ReviewIssueEvent, ReviewInboxRead, EcoFillerEvent, EcoFillerInboxRead]:
            self.assertFalse(model.objects.exists(), model.__name__)
        for model in [EcrActionResponse, EcoActionResponse, ChangeRequest]:
            self.assertFalse(model.owners.through.objects.exists() if hasattr(model, 'owners') else model.stage_approvers.through.objects.exists())
        self.assertEqual(get_user_model().objects.count(), 4)
        replacement = ChangeRequest.objects.create(applicant=self.owner, ecr_no=numbers[0], eco_no=numbers[1])
        self.assertIsNotNone(replacement.pk)
        self.assertEqual(self.client.get('/api/engineering-changes/').status_code, 200)
        self.assertEqual(self.client.get('/api/eco-filler/inbox/').data['items'], [])
        self.assertEqual(self.client.get('/api/review/inbox/').data['items'], [])

    def test_only_active_ecr_owner_can_delete_and_payload_is_strict(self):
        source = self.make('ecr', 'published')
        result = self.command.request(self.owner, 'post', source, 'eco/', filler_id=self.worker.pk, request_id=uuid.uuid4().hex)
        eco = ChangeRequest.objects.get(pk=result['change']['id'])
        for actor in [self.worker, self.approver, self.other]:
            self.client.force_authenticate(actor)
            self.assertEqual(self.delete(source, expected_eco_id=eco.pk, delete_eco=True).status_code, 404)
            listing = self.client.get('/api/engineering-changes/').data['items']
            self.assertTrue(all(not row['can_delete_ecr'] for row in listing))
        self.other.is_staff = self.other.is_superuser = True
        self.other.save()
        self.assertEqual(self.delete(source, expected_eco_id=eco.pk, delete_eco=True).status_code, 404)
        self.client.force_authenticate(self.worker)
        self.assertEqual(self.delete(eco).status_code, 409)
        self.client.force_authenticate(self.owner)
        for invalid in [{'delete_eco': 'true'}, {'confirm_delete': 'true'}, {'unknown': True}, {'expected_eco_id': '1'}, {'expected_eco_id': True}]:
            self.assertEqual(self.delete(source, **invalid).status_code, 400)
        self.assertEqual(self.client.delete(f'/api/changes/{source.pk}/', {}, format='json', HTTP_X_EXPECTED_USER=str(self.worker.pk)).status_code, 409)
        self.owner.is_active = False; self.owner.save()
        self.assertEqual(self.delete(source, expected_eco_id=eco.pk, delete_eco=True).status_code, 404)
        self.assertEqual(ChangeRequest.objects.count(), 2)

    def test_parent_delete_failure_rolls_back_eco_and_all_children(self):
        eco = self.make('eco', 'published')
        source = eco.source_ecr
        original_delete = ChangeRequest.delete

        def fail_source(record, *args, **kwargs):
            if record.pk == source.pk:
                raise RuntimeError('Simulated parent deletion failure')
            return original_delete(record, *args, **kwargs)

        tasks_before = set(ActionTask.objects.values_list('pk', flat=True))
        with self.assertLogs('django.request', level='ERROR'), patch.object(ChangeRequest, 'delete', fail_source), self.assertRaises(RuntimeError):
            self.delete(source, expected_eco_id=eco.pk, delete_eco=True)
        self.assertEqual(ChangeRequest.objects.count(), 2)
        self.assertEqual(set(ActionTask.objects.values_list('pk', flat=True)), tasks_before)
        self.assertEqual(EcoFillerEvent.objects.filter(eco=eco).count(), 1)
