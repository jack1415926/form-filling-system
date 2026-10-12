import uuid

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import connection
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest
from .roles import REVIEWER_GROUP


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class UserWorkspaceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user('dual-owner', password='test')
        cls.reviewer = get_user_model().objects.create_user('dual-reviewer', password='test')
        cls.group, _ = Group.objects.get_or_create(name=REVIEWER_GROUP)
        cls.owner.groups.add(cls.group)

    def setUp(self):
        self.client = APIClient(); self.client.force_authenticate(self.owner)
        self.client.force_login(self.owner)

    def test_user_with_legacy_group_can_fill_all_forms_without_gaining_self_review(self):
        self.assertEqual(connection.vendor, 'mysql')
        self.assertTrue(self.client.get('/api/auth/me/').json()['can_review'])
        created = self.client.post('/api/changes/', {'title': 'Own request', 'ecr_no': 'DUAL-001'}, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['stage'], 'ecr')
        pk = created.json()['id']; base = f'/api/changes/{pk}/'
        # Eight-form result filling below is the legacy compatibility contract.
        # New ECR creation is still asserted above; task ownership is tested separately.
        ChangeRequest.objects.filter(pk=pk).update(stage='legacy')
        material = self.client.post(base+'materials/', {'category': 'addition', 'description': 'Own material', 'request_id': str(uuid.uuid4())}, format='json')
        self.assertEqual(material.status_code, 201, material.data)
        writes = [('', {'change_reason': 'Own reason'}), ('questions/', {'responses': {'3': {'answer': 'Y'}}}),
                  ('ecr-actions/ecr_001/', {'result': 'ECR result'}), ('eco-actions/eco_001/', {'result': 'ECO result'}),
                  ('emc/', {'cells': {'emc_change_001/emc_test_001': {'mark': 'X', 'remark': 'Own EMC'}}}),
                  ('execution-plan/', {'responses': {'plan_001': {'remark': 'Own plan'}}}),
                  ('significant-change/', {'questions': {'sub_a_1': {'answer': 'Y', 'reason': 'Own assessment'}}})]
        for endpoint, payload in writes:
            response = self.client.patch(base+endpoint, payload, format='json')
            self.assertEqual(response.status_code, 200, response.data)
        for endpoint in ['', 'materials/', 'questions/', 'ecr-actions/', 'eco-actions/', 'emc/', 'execution-plan/', 'significant-change/']:
            self.assertEqual(self.client.get(base+endpoint).status_code, 200)
        self.assertEqual(self.client.get(base).json()['change_reason'], 'Own reason')
        change = ChangeRequest.objects.get(pk=pk)
        self.assertEqual(change.ecr_responses.get().result, 'ECR result')
        self.assertEqual(change.eco_responses.get().result, 'ECO result')
        response = self.client.post(base+'submission/', {'review_mode': 'designated', 'reviewer_ids': [self.reviewer.pk], 'expected_round': 0, 'request_id': str(uuid.uuid4())}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        for endpoint, payload in writes:
            self.assertEqual(self.client.patch(base+endpoint, payload, format='json').status_code, 409)
        self.assertEqual(self.client.delete(base).status_code, 409)
        self.assertEqual(self.client.post(base+'review-rounds/1/approve/', {'request_id': str(uuid.uuid4())}, format='json').status_code, 403)
        self.assertEqual(self.client.get('/api/review/').json(), [])

