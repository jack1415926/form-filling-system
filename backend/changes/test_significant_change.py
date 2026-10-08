from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Barrier, Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest, SignificantAssessment, SignificantChartResponse, SignificantQuestionResponse
from .significant_change import DEFINITION, QUESTION_IDS


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class SignificantFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user('significant-owner', password='test-password')
        cls.other = get_user_model().objects.create_user('significant-other', password='test-password')

    def setUp(self):
        self.change = ChangeRequest.objects.create(applicant=self.owner)
        self.path = f'/api/changes/{self.change.pk}/significant-change/'
        self.client = APIClient(enforce_csrf_checks=True)
        token = self.client.get('/api/auth/csrf/').json()['csrfToken']
        result = self.client.post('/api/auth/login/', {'username': self.owner.username, 'password': 'test-password'}, format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(result.status_code, 200)
        self.client.credentials(HTTP_X_CSRFTOKEN=result.json()['csrfToken'], HTTP_X_EXPECTED_USER=str(self.owner.pk))

    def write(self, payload):
        return self.client.patch(self.path, payload, format='json')

    def test_definitions_empty_read_noop_and_manual_result_separation(self):
        self.assertEqual(connection.vendor, 'mysql')
        result = self.client.get(self.path).json()
        self.assertEqual([row['id'] for row in result['charts']], ['0', 'A', 'B', 'C', 'D', 'E'])
        self.assertEqual(len(result['questions']), 37)
        self.assertEqual(len(set(QUESTION_IDS)), 37)
        for chart, count in [('A', 4), ('B', 10), ('C', 8), ('D', 6), ('E', 9)]:
            self.assertEqual(sum(row['chart'] == chart for row in result['questions']), count)
        self.assertTrue(all(row['answer'] == row['reason'] == '' for row in result['questions']))
        self.assertTrue(all(row['applicability'] == row['reason'] == row['result'] == '' for row in result['charts']))
        for row in DEFINITION['questions']:
            self.assertTrue(row['yes_result']); self.assertTrue(row['no_result']); self.assertNotIn('.', row['id'])
        before = self.change.updated_at
        for payload in [{}, {'assessment': {}}, {'charts': {}, 'questions': {}}, {'questions': {'sub_b_1_1': {'answer': '', 'reason': ''}}}]:
            self.assertEqual(self.write(payload).status_code, 200)
        self.assertFalse(SignificantAssessment.objects.exists())
        self.assertFalse(SignificantChartResponse.objects.exists())
        self.assertFalse(SignificantQuestionResponse.objects.exists())
        self.change.refresh_from_db(); self.assertEqual(self.change.updated_at, before)
        response = self.write({'questions': {'sub_a_1': {'answer': 'Y'}}}).json()
        self.assertEqual(response['charts'][1]['result'], '')
        self.assertEqual(response['assessment']['final_conclusion'], '')

    def test_restore_sparse_clear_and_keep_answers_when_applicability_changes(self):
        payload = {'assessment': {'f_assessment': 'ra_non_significant', 'final_conclusion': 'significant'},
                   'charts': {'A': {'applicability': 'Y', 'reason': ' 原因\n', 'result': 'continue'}},
                   'questions': {'sub_b_1_1': {'answer': 'Y', 'reason': '依据'}, 'sub_a_1': {'answer': 'N'}}}
        self.assertEqual(self.write(payload).status_code, 200)
        self.assertEqual(self.client.get(self.path).json()['assessment'], payload['assessment'])
        self.assertEqual(SignificantChartResponse.objects.get(chart_key='A').reason, ' 原因\n')
        self.assertEqual(self.write({'charts': {'A': {'applicability': 'N'}}}).status_code, 200)
        self.assertEqual(SignificantChartResponse.objects.get(chart_key='A').result, 'continue')
        self.assertTrue(SignificantQuestionResponse.objects.filter(question_key='sub_a_1').exists())
        self.assertEqual(self.write({'questions': {'sub_b_1_1': {'answer': ''}}}).status_code, 200)
        self.assertEqual(SignificantQuestionResponse.objects.get(question_key='sub_b_1_1').reason, '依据')
        before = ChangeRequest.objects.get(pk=self.change.pk).updated_at
        self.assertEqual(self.write({'questions': {'sub_b_1_1': {'reason': '依据'}}}).status_code, 200)
        self.assertEqual(ChangeRequest.objects.get(pk=self.change.pk).updated_at, before)
        self.assertEqual(self.write({'questions': {'sub_b_1_1': {'reason': ''}}, 'charts': {'A': {'applicability': '', 'reason': '', 'result': ''}}, 'assessment': {'f_assessment': '', 'final_conclusion': ''}}).status_code, 200)
        self.assertFalse(SignificantAssessment.objects.exists()); self.assertFalse(SignificantChartResponse.objects.exists())
        self.assertFalse(SignificantQuestionResponse.objects.filter(question_key='sub_b_1_1').exists())
        self.assertTrue(SignificantQuestionResponse.objects.filter(question_key='sub_a_1').exists())

    def test_strict_validation_and_whole_request_rollback(self):
        for payload in [[], {'charts': []}, {'assessment': None}, {'questions': {'sub_b_1_1': []}}, {'unknown': {}},
                        {'charts': {'a': {}}}, {'questions': {'B-1.1': {}}}, {'questions': {'sub_b_1_1': {'answer': 'y'}}},
                        {'questions': {'sub_a_1': {'reason': None}}}, {'questions': {'sub_a_1': {'reason': 1}}},
                        {'assessment': {'final_conclusion': 'N'}}, {'assessment': {'f_assessment': None}},
                        {'charts': {'0': {'result': ''}}}, {'charts': {'A': {'result': 'non_significant'}}},
                        {'charts': {'E': {'result': 'continue'}}}, {'charts': {'A': {'applicability': 'yes'}}},
                        {'questions': {'sub_a_1': {'text': 'change definition'}}}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.write(payload).status_code, 400)
        self.assertEqual(self.write({'assessment': {'final_conclusion': 'significant'}, 'questions': {'sub_a_1': {'answer': 'X'}}}).status_code, 400)
        self.assertFalse(SignificantAssessment.objects.exists())
        with patch('changes.significant_change_views.ChangeRequest.save', side_effect=RuntimeError('controlled failure')):
            with self.assertRaises(RuntimeError):
                self.write({'assessment': {'final_conclusion': 'significant'}, 'charts': {'A': {'reason': 'rollback'}}, 'questions': {'sub_a_1': {'answer': 'N'}}})
        self.assertFalse(SignificantAssessment.objects.exists()); self.assertFalse(SignificantChartResponse.objects.exists()); self.assertFalse(SignificantQuestionResponse.objects.exists())

    def test_permissions_csrf_expected_account_readonly_and_cascade(self):
        self.assertEqual(APIClient().get(self.path).status_code, 403)
        self.client.credentials(HTTP_X_EXPECTED_USER=str(self.owner.pk))
        self.assertEqual(self.write({'assessment': {'final_conclusion': 'significant'}}).status_code, 403)
        token = self.client.get('/api/auth/csrf/').json()['csrfToken']
        self.client.credentials(HTTP_X_CSRFTOKEN=token, HTTP_X_EXPECTED_USER=str(self.other.pk))
        self.assertEqual(self.write({}).status_code, 409)
        self.client.credentials(HTTP_X_CSRFTOKEN=token, HTTP_X_EXPECTED_USER=str(self.owner.pk))
        other = ChangeRequest.objects.create(applicant=self.other)
        path = f'/api/changes/{other.pk}/significant-change/'
        self.assertEqual(self.client.get(path).status_code, 404); self.assertEqual(self.client.patch(path, {}, format='json').status_code, 404)
        self.assertEqual(self.write({'assessment': {'final_conclusion': 'significant'}, 'charts': {'A': {'result': 'continue'}}, 'questions': {'sub_a_1': {'answer': 'N'}}}).status_code, 200)
        for status in ['pending', 'approved']:
            ChangeRequest.objects.filter(pk=self.change.pk).update(status=status)
            self.assertEqual(self.client.get(self.path).status_code, 200); self.assertEqual(self.write({}).status_code, 409)
        self.change.delete()
        self.assertFalse(SignificantAssessment.objects.exists()); self.assertFalse(SignificantChartResponse.objects.exists()); self.assertFalse(SignificantQuestionResponse.objects.exists())

    def test_database_constraints(self):
        for model, fields in [(SignificantAssessment, {'f_assessment': 'bad'}), (SignificantAssessment, {'final_conclusion': 'SIGNIFICANT'}),
                              (SignificantChartResponse, {'chart_key': 'a'}), (SignificantChartResponse, {'chart_key': '0', 'result': 'significant'}),
                              (SignificantChartResponse, {'chart_key': 'A', 'result': 'non_significant'}), (SignificantChartResponse, {'chart_key': 'E', 'result': 'continue'}),
                              (SignificantChartResponse, {'chart_key': 'A', 'applicability': 'y'}), (SignificantQuestionResponse, {'question_key': 'SUB_A_1'}),
                              (SignificantQuestionResponse, {'question_key': 'sub_a_1', 'answer': 'y'})]:
            with self.subTest(fields=fields), self.assertRaises(IntegrityError), transaction.atomic():
                model.objects.create(change=self.change, **fields)
        for model, fields in [(SignificantAssessment, {'final_conclusion': 'significant'}), (SignificantChartResponse, {'chart_key': 'A'}), (SignificantQuestionResponse, {'question_key': 'sub_a_1'})]:
            model.objects.create(change=self.change, **fields)
            with self.assertRaises(IntegrityError), transaction.atomic():
                model.objects.create(change=self.change, **fields)


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class SignificantTransactionTests(TransactionTestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('significant-concurrent')
        self.change = ChangeRequest.objects.create(applicant=self.owner)
        self.path = f'/api/changes/{self.change.pk}/significant-change/'

    def writer(self, values, barrier=None, started=None):
        try:
            client = APIClient(); client.force_authenticate(self.owner)
            if barrier: barrier.wait(timeout=5)
            def mark_parent(execute, sql, params, many, context):
                if started and sql.lstrip().upper().startswith('SELECT') and 'change_request' in sql:
                    started.set()
                return execute(sql, params, many, context)
            with connection.execute_wrapper(mark_parent):
                return client.patch(self.path, {'questions': {'sub_b_1_1': values}}, format='json').status_code
        finally:
            connections['default'].close()

    def test_concurrent_fields_merge_in_same_question(self):
        barrier = Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as pool:
            tasks = [pool.submit(self.writer, {'answer': 'Y'}, barrier), pool.submit(self.writer, {'reason': 'evidence'}, barrier)]
            self.assertEqual([task.result(timeout=10) for task in tasks], [200, 200])
        row = SignificantQuestionResponse.objects.get(change=self.change, question_key='sub_b_1_1')
        self.assertEqual((row.answer, row.reason), ('Y', 'evidence'))

    def test_waiting_write_rechecks_status_or_deleted_request(self):
        for deleted in [False, True]:
            if deleted:
                self.change = ChangeRequest.objects.create(applicant=self.owner); self.path = f'/api/changes/{self.change.pk}/significant-change/'
            started = Event()
            with ThreadPoolExecutor(max_workers=1) as pool:
                with transaction.atomic():
                    held = ChangeRequest.objects.select_for_update().get(pk=self.change.pk)
                    task = pool.submit(self.writer, {'answer': 'Y'}, None, started)
                    self.assertTrue(started.wait(timeout=5))
                    with self.assertRaises(TimeoutError):
                        task.result(timeout=0.15)
                    if deleted: held.delete()
                    else: held.status = 'pending'; held.save(update_fields=['status'])
                self.assertEqual(task.result(timeout=10), 404 if deleted else 409)
        self.assertFalse(SignificantQuestionResponse.objects.exists())
