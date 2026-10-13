import uuid
from importlib import import_module
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.apps import apps
from django.test import TestCase, override_settings, tag
from rest_framework.test import APIClient

from .models import ChangeRequest, ReviewIssue, ReviewIssueEvent, QuestionResponse


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ReviewIssueTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user('issues-owner', password='test')
        cls.other = get_user_model().objects.create_user('issues-other', password='test')
        cls.people = [get_user_model().objects.create_user('issues-reviewer-'+str(i), password='test') for i in range(3)]

    def setUp(self):
        self.change = ChangeRequest.objects.create(applicant=self.owner, title='Issues', ecr_no='ISSUES')
        self.change.publisher = self.owner
        self.change.save()
        self.change.stage_approvers.set(self.people[:2])
        QuestionResponse.objects.bulk_create([QuestionResponse(change=self.change, number=i, answer='N') for i in range(1, 28)])
        self.base = f'/api/changes/{self.change.pk}/'
        self.owner_client = self.client_for(self.owner)
        self.clients = [self.client_for(person) for person in self.people]

    def client_for(self, user):
        client = APIClient(); client.force_authenticate(user)
        return client

    def submit(self, mode='designated', people=None):
        self.change.refresh_from_db()
        if people is not None:
            self.change.stage_approvers.set(people)
        return self.owner_client.post(self.base+'stage-submission/', {
            'expected_round': self.change.current_review_round, 'request_id': str(uuid.uuid4()), 'acknowledge_no_tasks': True}, format='json')

    def act(self, client, kind, values=None, number=None):
        self.change.refresh_from_db()
        return client.post(self.base+f'review-rounds/{number or self.change.current_review_round}/{kind}/',
            values or {'request_id': str(uuid.uuid4())}, format='json')

    def return_two(self, mode='designated'):
        self.assertEqual(self.submit(mode, [] if mode == 'public' else None).status_code, 200)
        values = {'request_id': str(uuid.uuid4()), 'issues': [
            {'tab': 'questions', 'location': '5', 'text': 'Explain question 5'},
            {'tab': 'materials', 'location': 'Part 001', 'text': 'Check disposition'}]}
        response = self.act(self.clients[0], 'return', values)
        self.assertEqual(response.status_code, 200, response.data)
        return values, list(ReviewIssue.objects.order_by('id'))

    def reply(self, issue):
        issue.refresh_from_db()
        return self.act(self.owner_client, 'respond', {'request_id': str(uuid.uuid4()),
            'issue_id': issue.pk, 'version': issue.version, 'text': 'Changed or explained'})

    def resolve(self, issue, client=None):
        issue.refresh_from_db()
        return self.act(client or self.clients[0], 'resolve', {'request_id': str(uuid.uuid4()),
            'issue_id': issue.pk, 'version': issue.version, 'text': 'Verified against submitted form'})

    def test_batch_return_replay_content_conflict_and_atomic_validation(self):
        values, issues = self.return_two()
        self.assertEqual(self.act(self.clients[0], 'return', values).status_code, 200)
        self.assertEqual(ReviewIssue.objects.count(), 2)
        self.assertEqual(ReviewIssueEvent.objects.count(), 2)
        altered = {**values, 'issues': [{'tab': 'overview', 'text': 'Different'}]}
        self.assertEqual(self.act(self.clients[0], 'return', altered).status_code, 409)
        for issue in issues: self.assertEqual(self.reply(issue).status_code, 200)
        self.assertEqual(self.submit().status_code, 200)
        broken = {'request_id': str(uuid.uuid4()), 'issues': [{'tab': 'overview', 'text': 'New'},
            {'issue_id': issues[0].pk, 'version': 999, 'text': 'Stale'}]}
        self.assertEqual(self.act(self.clients[0], 'return', broken).status_code, 409)
        self.assertEqual(ReviewIssue.objects.count(), 2)
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'pending')


    def test_assigned_original_author_closes_but_does_not_vote_automatically(self):
        _, issues = self.return_two()
        for issue in issues: self.assertEqual(self.reply(issue).status_code, 200)
        self.assertEqual(self.submit().status_code, 200)
        self.assertEqual(self.resolve(issues[0], self.clients[1]).status_code, 409)
        for issue in issues: self.assertEqual(self.resolve(issue).status_code, 200)
        self.assertEqual(self.change.review_records.filter(approved_at__isnull=False).count(), 0)
        self.assertEqual(self.act(self.clients[1], 'approve').status_code, 200)
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'pending')
        self.assertEqual(self.act(self.clients[0], 'approve').status_code, 200)
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'approved')

    def test_rejection_retains_history_and_requires_new_reply(self):
        _, issues = self.return_two()
        for issue in issues: self.reply(issue)
        self.submit(); self.resolve(issues[1]); issues[0].refresh_from_db()
        values = {'request_id': str(uuid.uuid4()), 'issues': [{'issue_id': issues[0].pk,
            'version': issues[0].version, 'text': 'Still missing evidence'}]}
        self.assertEqual(self.act(self.clients[0], 'return', values).status_code, 200)
        self.assertEqual(self.submit().status_code, 400)
        self.assertEqual(self.reply(issues[0]).status_code, 200)
        self.assertEqual(self.submit().status_code, 200)
        self.assertEqual(self.resolve(issues[0]).status_code, 200)
        self.assertEqual(list(issues[0].events.values_list('kind', flat=True)), ['return', 'respond', 'return', 'respond', 'resolve'])
        issues[1].refresh_from_db(); self.assertEqual(issues[1].state, 'resolved')
        self.assertEqual(self.resolve(issues[1]).status_code, 409)

    def test_reply_and_resolve_replay_version_and_old_round_guards(self):
        _, issues = self.return_two()
        issue = issues[0]
        values = {'request_id': str(uuid.uuid4()), 'issue_id': issue.pk, 'version': 1, 'text': 'Reply'}
        self.assertEqual(self.act(self.owner_client, 'respond', values).status_code, 200)
        self.assertEqual(self.act(self.owner_client, 'respond', values).status_code, 200)
        self.assertEqual(self.act(self.owner_client, 'respond', {**values, 'text': 'Other'}).status_code, 409)
        self.assertEqual(self.act(self.owner_client, 'respond', {**values, 'request_id': str(uuid.uuid4())}).status_code, 409)
        self.assertEqual(self.resolve(issue).status_code, 409)
        self.reply(issues[1]); self.submit()
        self.assertEqual(self.act(self.owner_client, 'respond', values, number=1).status_code, 409)
        issue.refresh_from_db(); values = {'request_id': str(uuid.uuid4()), 'issue_id': issue.pk, 'version': issue.version, 'text': 'OK'}
        self.assertEqual(self.act(self.clients[0], 'resolve', values).status_code, 200)
        self.assertEqual(self.act(self.clients[0], 'resolve', values).status_code, 200)
        self.assertEqual(self.act(self.clients[0], 'resolve', {**values, 'text': 'Different'}).status_code, 409)
        self.assertEqual(issue.events.filter(kind='resolve').count(), 1)

    def test_disabled_author_blocks_resubmission_and_never_allows_delegation(self):
        _, issues = self.return_two()
        for issue in issues: self.reply(issue)
        person = self.people[0]; person.is_active = False; person.save()
        self.assertEqual(self.submit().status_code, 400)
        person.is_active = True; person.save(); person.groups.clear()
        self.assertEqual(self.submit().status_code, 200)


    def test_strict_payload_no_empty_return_and_atomic_rollback(self):
        self.submit()
        for values in [{'request_id': str(uuid.uuid4()), 'issues': []},
                       {'request_id': str(uuid.uuid4()), 'issues': [{'tab': 'missing', 'text': 'Bad'}]},
                       {'request_id': str(uuid.uuid4()), 'issues': [{'tab': 'overview', 'text': ' '}]},
                       {'request_id': str(uuid.uuid4()), 'issues': [{'tab': 'overview', 'text': 3}]},
                       {'text': 'Legacy reason'}]:
            self.assertEqual(self.act(self.clients[0], 'return', values).status_code, 400)
        values = {'request_id': str(uuid.uuid4()), 'issues': [{'tab': 'overview', 'text': 'First'}, {'tab': 'ecr', 'text': 'Second'}]}
        with patch('changes.review_views.ChangeRequest.save', side_effect=RuntimeError('rollback')):
            with self.assertRaises(RuntimeError): self.act(self.clients[0], 'return', values)
        self.assertFalse(ReviewIssue.objects.exists()); self.assertFalse(ReviewIssueEvent.objects.exists())
        self.change.refresh_from_db(); self.assertEqual(self.change.status, 'pending')

    @tag('migration')
    def test_reverse_migration_refuses_to_discard_opinion_history(self):
        guard = import_module('changes.migrations.0014_review_issues').prevent_history_loss
        guard(apps, None)
        self.return_two()
        with self.assertRaisesRegex(RuntimeError, '不能直接回退0014'):
            guard(apps, None)

    def test_other_application_issue_and_other_author_cannot_be_used_in_return_batch(self):
        _, issues = self.return_two()
        for issue in issues: self.reply(issue)
        self.submit()
        values = {'request_id': str(uuid.uuid4()), 'issues': [{'tab': 'overview', 'text': 'New item'},
            {'issue_id': issues[0].pk, 'version': 2, 'text': 'Not my opinion'}]}
        self.assertEqual(self.act(self.clients[1], 'return', values).status_code, 409)
        self.assertEqual(ReviewIssue.objects.count(), 2)
        other = ChangeRequest.objects.create(applicant=self.other, title='Other')
        alien = ReviewIssue.objects.create(change=other, source_round=self.change.review_rounds.first(),
            author=self.people[0], tab='overview', text='Other application')
        values['issues'][1] = {'issue_id': alien.pk, 'version': 1, 'text': 'Wrong application'}
        self.assertEqual(self.act(self.clients[0], 'return', values).status_code, 409)
        self.assertEqual(ReviewIssue.objects.filter(change=self.change).count(), 2)
