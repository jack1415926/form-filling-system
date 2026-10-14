import uuid
from copy import deepcopy

from django.test import TestCase, override_settings
from .models import (ActionTask, ReviewRound, MaterialChange, MaterialDisposition, ExecutionPlanResponse,
                     SignificantAssessment, SignificantChartResponse, SignificantQuestionResponse)
from .test_publication import PublicationFixture
from .test_eco_stage import EcoFixture


class SnapshotChecks:
    def check_new_participant_old_snapshot_access(self, record, stage):
        self.assertEqual(self.client.patch(self.path, {'change_reason': 'Old-round private detail'}, format='json').status_code, 200)
        record.refresh_from_db()
        url, _, _ = self.submit_snapshot(record, stage)
        self.assertEqual(self.return_round(record).status_code, 200)
        self.client.force_authenticate(self.a)
        issue = record.review_issues.get()
        self.assertEqual(self.client.post(self.path + 'review-rounds/1/respond/', {'request_id': str(uuid.uuid4()), 'issue_id': issue.pk, 'version': issue.version, 'text': 'Corrected'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(self.path, {'change_reason': 'New-round detail'}, format='json').status_code, 200)
        record.stage_approvers.set([self.d])
        self.assertEqual(self.client.patch(self.path + f'{stage}-actions/{stage}_001/', {'owner_user_ids': [self.d.pk]}, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.path + 'stage-submission/', {'request_id': str(uuid.uuid4()), 'expected_round': 1}, format='json').status_code, 200)
        self.client.force_authenticate(self.d)
        self.assertFalse(record.review_rounds.get(number=1).records.filter(reviewer=self.d).exists())
        old = self.client.get(self.path + 'review-rounds/1/')
        self.assertEqual(old.status_code, 200)
        self.assertFalse(old.data['can_view_form'])
        self.assertEqual(self.client.get(url).status_code, 404)
        current = self.client.get(self.path + 'review-rounds/2/form-snapshot/')
        self.assertEqual(current.status_code, 200)
        self.assertEqual(current.data['snapshot']['overview']['change_reason'], 'New-round detail')
        for actor in [self.a, self.b]:
            self.client.force_authenticate(actor)
            self.assertEqual(self.client.get(url).status_code, 200)

    def submit_snapshot(self, record, stage):
        record.stage_approvers.set([self.b])
        self.assertEqual(self.client.patch(self.path + f'{stage}-actions/{stage}_001/', {'owner_user_ids': [self.b.pk], 'extra_required': True}, format='json').status_code, 200)
        payload = {'request_id': str(uuid.uuid4()), 'expected_round': record.current_review_round}
        self.assertEqual(self.client.post(self.path + 'stage-submission/', payload, format='json').status_code, 200)
        record.refresh_from_db()
        url = self.path + f'review-rounds/{record.current_review_round}/form-snapshot/'
        self.client.force_authenticate(self.b)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200, response.data)
        return url, response.data, payload

    def return_round(self, record):
        return self.client.post(self.path + f'review-rounds/{record.current_review_round}/return/', {'request_id': str(uuid.uuid4()), 'issues': [{'tab': 'overview', 'text': 'Please correct original content'}]}, format='json')


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class EcrSnapshotTests(SnapshotChecks, PublicationFixture, TestCase):
    def test_new_ecr_participant_cannot_read_unassigned_old_snapshot(self):
        self.check_new_participant_old_snapshot_access(self.source, 'ecr')

    def test_snapshot_covers_nonempty_base_sheets_and_frozen_definitions(self):
        from .emc_views import matrix_data, persist
        from .dispositions import LOCATIONS
        from .execution_plan import PLAN_ACTIVITY_IDS
        from .significant_change import QUESTION_IDS, F_VALUES
        from unittest.mock import patch
        material = MaterialChange.objects.create(change=self.source, category='addition', material_no='SOURCE', description='original material')
        location, group = next(iter(LOCATIONS.items()))
        MaterialDisposition.objects.create(material=material, location_group=group, location_item=location, remark='original disposition')
        ExecutionPlanResponse.objects.create(change=self.source, activity_key=PLAN_ACTIVITY_IDS[0], owner='Initial', remark='original plan')
        SignificantAssessment.objects.create(change=self.source, f_assessment=F_VALUES[1])
        SignificantChartResponse.objects.create(change=self.source, chart_key='A', reason='original chart')
        SignificantQuestionResponse.objects.create(change=self.source, question_key=QUESTION_IDS[0], reason='original subquestion')
        matrix = matrix_data(self.source)
        key = f"{matrix['rows'][0]['id']}/{matrix['tests'][0]['id']}"
        matrix['cells'][key] = {'mark': 'X', 'remark': 'original EMC'}
        persist(self.source, matrix)
        url, result, _ = self.submit_snapshot(self.source, 'ecr')
        sheets = result['snapshot']['sheets']
        self.assertEqual(sheets['materials'][0]['description'], 'original material')
        self.assertEqual(sheets['materials'][0]['dispositions'][location]['remark'], 'original disposition')
        self.assertEqual(sheets['execution_plan']['rows'][0]['remark'], 'original plan')
        self.assertEqual(sheets['emc']['cells'][key]['remark'], 'original EMC')
        self.assertEqual(next(row for row in sheets['significant_change']['charts'] if row['id'] == 'A')['reason'], 'original chart')
        self.assertEqual(next(row for row in sheets['significant_change']['questions'] if row['id'] == QUESTION_IDS[0])['reason'], 'original subquestion')
        with patch('changes.questions.QUESTIONS', []), patch('changes.emc_views.REFERENCE', {'title': 'New definition'}):
            self.assertEqual(self.client.get(url).data['snapshot'], result['snapshot'])
        task = ActionTask.objects.get(round__change=self.source)
        task_path = self.path + f'action-tasks/{task.pk}/'
        self.assertEqual(self.client.patch(task_path, {'request_id': str(uuid.uuid4()), 'version': 1, 'result': 'B reviewed original material', 'status': 'completed', 'date': '2026-10-14'}, format='json').status_code, 200)
        self.assertEqual(self.client.post(task_path, {'request_id': str(uuid.uuid4()), 'version': 2}, format='json').status_code, 200)
        self.assertEqual(self.return_round(self.source).status_code, 200)
        historical = self.client.get(url).data
        self.assertEqual(historical['snapshot'], result['snapshot'])
        # Store only synthetic test data for the isolated browser preview.
        import json
        import os
        from pathlib import Path
        if os.environ.get('SNAPSHOT_PREVIEW_OUT'):
            preview = Path(os.environ['SNAPSHOT_PREVIEW_OUT'])
            preview.parent.mkdir(parents=True, exist_ok=True)
            preview.write_text(json.dumps(historical, ensure_ascii=False), encoding='utf-8')

    def test_returned_snapshot_survives_private_revision_and_repeat_submission(self):
        url, original, payload = self.submit_snapshot(self.source, 'ecr')
        self.assertEqual(set(original['snapshot']['sheets']), {'materials', 'questions', 'ecr', 'eco', 'emc', 'execution_plan', 'significant_change'})
        self.assertEqual(self.return_round(self.source).status_code, 200)
        self.assertIsNone(self.client.get(self.path + 'review-rounds/1/').data['form'])
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.patch(self.path, {'title': 'Private new title'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(self.path + 'questions/', {'responses': {'1': {'answer': 'Y', 'remark': 'Private new answer'}}}, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.path + 'stage-submission/', payload, format='json').status_code, 200)
        self.client.force_authenticate(self.b)
        historical = self.client.get(url).data
        self.assertEqual(historical['snapshot'], original['snapshot'])
        self.assertEqual(historical['snapshot']['overview']['title'], 'Baseline')
        self.assertEqual(historical['snapshot']['sheets']['questions']['questions'][0]['remark'], 'original')
        self.client.force_authenticate(self.a)
        issue = self.source.review_issues.get()
        responded = self.client.post(self.path + 'review-rounds/1/respond/', {'request_id': str(uuid.uuid4()), 'issue_id': issue.pk, 'version': issue.version, 'text': 'Corrected'}, format='json')
        self.assertEqual(responded.status_code, 200, responded.data)
        self.assertEqual(self.client.post(self.path + 'stage-submission/', {'request_id': str(uuid.uuid4()), 'expected_round': 1}, format='json').status_code, 200)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(url).data['snapshot'], original['snapshot'])
        self.assertEqual(self.client.get(self.path + 'review-rounds/2/form-snapshot/').data['snapshot']['overview']['title'], 'Private new title')
        self.client.force_authenticate(self.d)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.patch(url, {'snapshot': {}}, format='json').status_code, 405)

    def test_approved_snapshot_includes_round_task_results_and_freezes_base(self):
        url, original, _ = self.submit_snapshot(self.source, 'ecr')
        task = ActionTask.objects.get(round__change=self.source)
        path = self.path + f'action-tasks/{task.pk}/'
        self.assertEqual(self.client.patch(path, {'request_id': str(uuid.uuid4()), 'version': 1, 'result': 'Reviewed material', 'status': 'completed', 'date': '2026-10-14'}, format='json').status_code, 200)
        self.assertEqual(self.client.post(path, {'request_id': str(uuid.uuid4()), 'version': 2}, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.path + 'review-rounds/1/approve/', {'request_id': str(uuid.uuid4())}, format='json').status_code, 200)
        result = self.client.get(url).data
        self.assertEqual(result['snapshot'], original['snapshot'])
        self.assertEqual(result['tasks'][0]['result'], 'Reviewed material')
        self.assertFalse(result['tasks'][0]['can_edit'])
        self.client.force_authenticate(self.c)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.client.force_authenticate(self.b)
        self.b.is_active = False
        self.b.save(update_fields=['is_active'])
        self.assertEqual(self.client.get(url).status_code, 404)
        self.b.is_active = True
        self.b.save(update_fields=['is_active'])
        self.assertEqual(self.client.patch(path, {'request_id': str(uuid.uuid4()), 'version': 3, 'result': 'rewrite'}, format='json').status_code, 409)

    def test_old_round_missing_snapshot_is_explicit(self):
        url, _, _ = self.submit_snapshot(self.source, 'ecr')
        ReviewRound.objects.filter(change=self.source).update(form_snapshot=None)
        self.assertIsNone(self.client.get(url).data['snapshot'])


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class EcoSnapshotTests(SnapshotChecks, EcoFixture, TestCase):
    def test_new_eco_participant_cannot_read_unassigned_old_snapshot(self):
        self.check_new_participant_old_snapshot_access(self.eco, 'eco')
        self.client.force_authenticate(self.c)
        self.assertEqual(self.client.get(self.path + 'review-rounds/1/form-snapshot/').status_code, 200)

    def test_eco_snapshot_has_only_authorized_source_and_preserves_ecr(self):
        source = deepcopy(self.source_before)
        url, original, _ = self.submit_snapshot(self.eco, 'eco')
        self.assertEqual(original['snapshot']['sheets']['ecr']['source_ecr_id'], self.source.pk)
        self.assertEqual(original['snapshot']['source_overview']['title'], self.source.title)
        self.assertNotIn('materials', original['snapshot']['source_overview'])
        self.assertEqual(self.return_round(self.eco).status_code, 200)
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.patch(self.path, {'title': 'Revised ECO'}, format='json').status_code, 200)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(url).data['snapshot'], original['snapshot'])
        self.assertEqual(self.client.get(self.ecr_path).status_code, 404)
        from .serializers import ChangeRequestSerializer
        self.source.refresh_from_db()
        self.assertEqual(ChangeRequestSerializer(self.source).data, source)
        import json
        import os
        from pathlib import Path
        if os.environ.get('SNAPSHOT_ECO_PREVIEW_OUT'):
            preview = Path(os.environ['SNAPSHOT_ECO_PREVIEW_OUT'])
            preview.parent.mkdir(parents=True, exist_ok=True)
            preview.write_text(json.dumps(self.client.get(url).data, ensure_ascii=False), encoding='utf-8')
