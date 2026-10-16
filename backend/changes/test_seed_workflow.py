from io import StringIO
import uuid
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .management.commands.seed_workflow import Command, STATES
from .models import ChangeRequest
from .ecr import ECR_ACTIONS
from .eco import ECO_ACTIONS
from .views import EcrActionList, EcoActionList


@override_settings(DEBUG=True)
class SeedWorkflowTests(TestCase):
    def setUp(self):
        self.users = {role: get_user_model().objects.create_user('seed-' + role)
                      for role in ['applicant', 'reviewer', 'approver', 'publisher']}
        self.options = {role: user.username for role, user in self.users.items()}

    def check_consistent_sample(self, record):
        self.assertEqual(dict(record.question_responses.values_list('number', 'answer')),
                         {n: 'Y' if n == 6 else 'N' for n in range(1, 28)})
        material = record.materials.get()
        self.assertEqual((material.category, material.old_revision, material.new_revision), ('revision', 'A', 'B'))
        self.assertEqual(set(record.execution_plan_responses.values_list('activity_key', flat=True)), {'plan_002'})
        self.assertFalse(record.emc_reference.cells.exists())
        self.assertFalse(record.significant_questions.exists())
        self.assertEqual(set(record.significant_charts.values_list('chart_key', flat=True)), {'0', 'A', 'B'})
        self.assertEqual(record.significant_assessment.final_conclusion, 'non_significant')
        definitions = ECO_ACTIONS if record.stage == 'eco' else ECR_ACTIONS
        expected = {row['id'] for row in definitions if row['number'] == 6}
        self.assertEqual(len(expected), 11)
        actions = record.eco_responses if record.stage == 'eco' else record.ecr_responses
        self.assertEqual(set(actions.values_list('action_key', flat=True)), expected)
        self.assertFalse(actions.filter(extra_required=True).exists())
        if record.stage == 'ecr':
            self.assertFalse(record.eco_responses.exists())
        else:
            self.check_consistent_sample(record.source_ecr)
        for view in [EcrActionList, EcoActionList]:
            target = record.source_ecr if record.stage == 'eco' and view is EcrActionList else record
            for row in view.data(target)['actions']:
                if row['question_answer'] == 'N':
                    self.assertEqual(row['owner_user_ids'], [])
                    self.assertEqual((row['result'], row['status'], row['date'], row['extra_required']), ('', '', None, False))
        if record.current_review_round:
            round = record.review_rounds.get(number=record.current_review_round)
            self.assertEqual(set(round.tasks.values_list('action_key', flat=True)), expected)
            snapshot = round.form_snapshot
            self.assertEqual({row['number'] for row in snapshot['sheets']['questions']['questions'] if row['answer'] == 'Y'}, {6})
            self.assertEqual({row['id'] for row in snapshot['actions'] if row['required']}, expected)

    def test_material_example_matches_question_six_and_its_actions(self):
        call_command('seed_workflow', stage='ecr', state='draft', stdout=StringIO(), **self.options)
        record = ChangeRequest.objects.get()
        self.assertTrue(record.materials.exists())
        self.assertEqual(record.question_responses.get(number=6).answer, 'Y')
        expected = {row['id'] for row in ECR_ACTIONS if row['number'] == 6}
        self.assertEqual(set(record.ecr_responses.values_list('action_key', flat=True)), expected)
        self.assertFalse(record.ecr_responses.filter(extra_required=True).exists())

    def test_all_ten_scenarios_are_filled_linked_and_can_continue(self):
        original = ChangeRequest.objects.create(applicant=self.users['applicant'], title='Keep original')
        call_command('seed_workflow', stage='all', state='all', stdout=StringIO(), **self.options)
        original.refresh_from_db()
        self.assertEqual((original.title, original.status), ('Keep original', 'draft'))
        self.assertEqual(ChangeRequest.objects.count(), 16)  # 10 targets + 5 ECO source ECRs + original
        for stage in ['ecr', 'eco']:
            for state, label in STATES.items():
                with self.subTest(stage=stage, state=state):
                    record = ChangeRequest.objects.get(stage=stage, title__startswith=f'[测试] {stage.upper()} {label} ')
                    self.assertEqual(record.status, 'pending' if state in ['reviewing', 'pending_approval'] else state)
                    self.assertEqual(record.question_responses.count(), 27)
                    self.assertEqual(record.materials.count(), 1)
                    self.assertEqual(record.materials.get().dispositions.count(), 10)
                    self.assertTrue(record.execution_plan_responses.exists())
                    self.assertTrue(record.significant_charts.exists())
                    self.check_consistent_sample(record)
                    if stage == 'eco':
                        self.assertEqual(record.source_ecr.status, 'published')
                        self.assertTrue(record.filler_events.filter(kind='create').exists())
                    if state == 'draft':
                        self.assertFalse(record.review_rounds.exists())
                    else:
                        round = record.review_rounds.get()
                        self.assertTrue(round.form_snapshot)
                        self.assertEqual(round.tasks.count(), 11)
                        self.assertEqual(round.tasks.filter(confirmed_at__isnull=True).count(), 11 if state == 'reviewing' else 0)
                        self.assertEqual(round.records.get(reviewer=self.users['approver']).approved_at is not None,
                                         state in ['approved', 'published'])
                    self.assertEqual(record.published_at is not None, state == 'published')
                    if state in ['reviewing', 'pending_approval', 'approved']:
                        # Continue through the same public endpoints a user operates in the UI.
                        command = Command()
                        if state == 'reviewing':
                            for task in record.review_rounds.get().tasks.all():
                                command.request(task.owner, 'post', record, f'action-tasks/{task.pk}/',
                                                request_id=uuid.uuid4().hex, version=task.version)
                        if state != 'approved':
                            command.request(self.users['approver'], 'post', record, 'review-rounds/1/approve/',
                                            request_id=uuid.uuid4().hex)
                        command.request(self.users['publisher'], 'post', record, 'publication/',
                                        request_id=uuid.uuid4().hex, expected_round=1)
                        record.refresh_from_db()
                        self.assertEqual(record.status, 'published')
        client = APIClient()
        client.force_authenticate(self.users['applicant'])
        self.assertEqual(client.get('/api/engineering-changes/').status_code, 200)

    def test_failure_rolls_back_sources_and_guards_environment_and_accounts(self):
        with override_settings(DEBUG=False), self.assertRaises(CommandError):
            call_command('seed_workflow', stage='ecr', state='draft', stdout=StringIO(), **self.options)
        with self.assertRaises(CommandError):
            call_command('seed_workflow', stage='ecr', state='draft', applicant='missing', stdout=StringIO())
        request = Command.request

        def fail_eco(command, actor, method, record, suffix, **payload):
            if suffix == 'eco/':
                raise CommandError('Simulated creation failure')
            return request(command, actor, method, record, suffix, **payload)

        with patch.object(Command, 'request', fail_eco), self.assertRaises(CommandError):
            call_command('seed_workflow', stage='all', state='all', stdout=StringIO(), **self.options)
        self.assertFalse(ChangeRequest.objects.exists())
        # One account may fill all roles, and repeated runs always create new rows.
        for _ in range(2):
            call_command('seed_workflow', stage='ecr', state='published', applicant=self.options['applicant'], stdout=StringIO())
        self.assertEqual(ChangeRequest.objects.filter(status='published').count(), 2)

    def test_web_creation_retries_and_authorization(self):
        client = APIClient()
        payload = {'request_id': str(uuid.uuid4()), 'stage': 'ecr', 'state': 'pending_approval',
                   'reviewer_ids': [self.users['reviewer'].pk], 'approver_ids': [self.users['approver'].pk],
                   'publisher_id': self.users['publisher'].pk}
        self.assertIn(client.post('/api/test-cases/', payload, format='json').status_code, [401, 403])
        client.force_authenticate(self.users['applicant'])
        client.force_login(self.users['applicant'])
        self.assertTrue(client.get('/api/auth/me/').json()['can_generate_test_data'])
        with override_settings(DEBUG=False):
            self.assertEqual(client.post('/api/test-cases/', payload, format='json').status_code, 404)
            self.assertFalse(client.get('/api/auth/me/').json()['can_generate_test_data'])
        self.assertEqual(client.post('/api/test-cases/', payload, format='json', HTTP_X_EXPECTED_USER=str(self.users['reviewer'].pk)).status_code, 409)
        self.assertEqual(client.post('/api/test-cases/', {**payload, 'applicant_id': self.users['reviewer'].pk}, format='json').status_code, 400)
        self.assertEqual(client.post('/api/test-cases/', {**payload, 'approver_ids': [999999]}, format='json').status_code, 400)
        self.assertFalse(ChangeRequest.objects.exists())
        result = client.post('/api/test-cases/', payload, format='json')
        self.assertEqual(result.status_code, 201, result.data)
        record = ChangeRequest.objects.get(pk=result.data['id'])
        self.assertEqual(record.applicant_id, self.users['applicant'].pk)
        self.assertEqual(record.status, 'pending')
        self.assertFalse(record.review_rounds.get().tasks.filter(confirmed_at__isnull=True).exists())
        self.assertEqual(client.post('/api/test-cases/', payload, format='json').data['id'], record.pk)
        self.assertEqual(ChangeRequest.objects.count(), 1)
        self.assertEqual(client.post('/api/test-cases/', {**payload, 'state': 'published'}, format='json').status_code, 409)
        payload.update(request_id=str(uuid.uuid4()), stage='eco', state='published')
        result = client.post('/api/test-cases/', payload, format='json')
        self.assertEqual(result.status_code, 201, result.data)
        eco = ChangeRequest.objects.get(pk=result.data['id'])
        self.assertEqual((eco.status, eco.source_ecr.status), ('published', 'published'))
        self.assertEqual(client.post('/api/test-cases/', payload, format='json').status_code, 200)
        self.assertEqual(ChangeRequest.objects.count(), 3)
        client.force_authenticate(self.users['reviewer'])
        self.assertEqual(client.post('/api/test-cases/', payload, format='json').status_code, 409)

    def test_web_multiple_owners_and_approvers_in_both_workflows(self):
        client = APIClient()
        client.force_authenticate(self.users['applicant'])
        owners = [self.users['reviewer'].pk, self.users['publisher'].pk]
        approvers = [self.users['applicant'].pk, self.users['approver'].pk]
        for stage in ['ecr', 'eco']:
            for state in STATES:
                with self.subTest(stage=stage, state=state):
                    payload = {'request_id': str(uuid.uuid4()), 'stage': stage, 'state': state,
                               'reviewer_ids': owners, 'approver_ids': approvers,
                               'publisher_id': self.users['publisher'].pk}
                    response = client.post('/api/test-cases/', payload, format='json')
                    self.assertEqual(response.status_code, 201, response.data)
                    record = ChangeRequest.objects.get(pk=response.data['id'])
                    self.assertEqual(set(record.stage_approvers.values_list('pk', flat=True)), set(approvers))
                    actions = record.ecr_responses if stage == 'ecr' else record.eco_responses
                    self.check_consistent_sample(record)
                    for action in actions.all():
                        self.assertEqual(set(action.owners.values_list('pk', flat=True)), set(owners))
                    count = ChangeRequest.objects.count()
                    replay = {**payload, 'reviewer_ids': owners[::-1] + owners[:1], 'approver_ids': approvers[::-1]}
                    self.assertEqual(client.post('/api/test-cases/', replay, format='json').status_code, 200)
                    self.assertEqual(ChangeRequest.objects.count(), count)
                    self.assertEqual(client.post('/api/test-cases/', {**payload, 'reviewer_ids': owners[:1]}, format='json').status_code, 409)
                    self.assertEqual(client.post('/api/test-cases/', {**payload, 'approver_ids': approvers[:1]}, format='json').status_code, 409)
                    if state == 'draft':
                        self.assertFalse(record.review_rounds.exists())
                        continue
                    round = record.review_rounds.get()
                    self.assertEqual(set(round.tasks.values_list('owner_id', flat=True)), set(owners))
                    self.assertEqual(round.tasks.count(), 22)
                    self.assertEqual(round.tasks.filter(confirmed_at__isnull=True).count(), 22 if state == 'reviewing' else 0)
                    approvals = round.records.filter(approval_required=True)
                    self.assertEqual(set(approvals.values_list('reviewer_id', flat=True)), set(approvers))
                    self.assertEqual(approvals.filter(approved_at__isnull=True).count(), 2 if state in ['reviewing', 'pending_approval'] else 0)
                    if state == 'pending_approval':
                        command = Command()
                        command.request(self.users['applicant'], 'post', record, 'review-rounds/1/approve/', request_id=uuid.uuid4().hex)
                        record.refresh_from_db()
                        self.assertEqual(record.status, 'pending')
                        command.request(self.users['approver'], 'post', record, 'review-rounds/1/approve/', request_id=uuid.uuid4().hex)
                        record.refresh_from_db()
                        self.assertEqual(record.status, 'approved')

        for field in ['reviewer_ids', 'approver_ids']:
            for invalid in [[], [999999], '1,2', [True]]:
                response = client.post('/api/test-cases/', {**payload, 'request_id': str(uuid.uuid4()), field: invalid}, format='json')
                self.assertEqual(response.status_code, 400, response.data)

    def test_all_no_answers_do_not_create_action_data(self):
        command = Command()
        users = {**self.users, 'reviewers': [self.users['reviewer']], 'approvers': [self.users['approver']]}
        source = command.create_scenario('ecr', 'published', users, uuid.uuid4().hex)
        result = command.request(self.users['applicant'], 'post', source, 'eco/',
                                 filler_id=self.users['applicant'].pk, request_id=uuid.uuid4().hex)
        eco = ChangeRequest.objects.get(pk=result['change']['id'])
        ecr = ChangeRequest.objects.create(applicant=self.users['applicant'], stage='ecr')
        from .models import QuestionResponse
        QuestionResponse.objects.bulk_create([QuestionResponse(change=ecr, number=n, answer='N') for n in range(1, 28)])
        eco.question_responses.update(answer='N')
        eco.materials.all().delete()
        for record in [ecr, eco]:
            command.fill_actions(record, users['reviewers'])
            self.assertFalse(record.ecr_responses.exists())
            self.assertFalse(record.eco_responses.exists())
            from .stage_workflow import stage_data
            self.assertFalse(any(row['required'] for row in stage_data(record, record.applicant)['actions']))
