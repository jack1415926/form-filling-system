import importlib

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.models.deletion import ProtectedError
from django.test import TestCase, TransactionTestCase, override_settings, tag
from rest_framework.test import APIClient

from .models import ChangeRequest, EcrActionResponse, EcoActionResponse


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ActionOwnerTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.a = get_user_model().objects.create_user('action-owner-a')
        cls.b = get_user_model().objects.create_user('action-owner-b')

    def setUp(self):
        self.change = ChangeRequest.objects.create(applicant=self.a)
        self.client = APIClient(); self.client.force_authenticate(self.a)

    def test_both_actions_select_self_or_other_preserve_text_and_clear(self):
        self.assertEqual(connection.vendor, 'mysql')
        candidates = self.client.get('/api/action-owners/').data
        self.assertIn(self.a.pk, [row['id'] for row in candidates])
        for prefix, model, user in [('ecr', EcrActionResponse, self.a), ('eco', EcoActionResponse, self.b)]:
            path = f'/api/changes/{self.change.pk}/{prefix}-actions/{prefix}_001/'
            old = model.objects.create(change=self.change, action_key=f'{prefix}_001', owner='旧负责人文字', result='旧结果')
            self.assertEqual(self.client.patch(path, {'owner_user_id':user.pk}, format='json').status_code,200)
            old.refresh_from_db(); self.assertEqual((old.owner,old.result,old.owner_user_id),('旧负责人文字','旧结果',user.pk))
            result = self.client.get(f'/api/changes/{self.change.pk}/{prefix}-actions/').data['actions'][0]
            self.assertEqual(result['owner_user']['id'],user.pk)
            self.assertEqual(self.client.patch(path, {'owner_user_id':None}, format='json').status_code,200)
            old.refresh_from_db(); self.assertIsNone(old.owner_user_id); self.assertEqual(old.owner,'旧负责人文字')
            only = path.replace('_001/','_002/')
            self.assertEqual(self.client.patch(only, {'owner_user_id':user.pk}, format='json').status_code,200)
            self.assertTrue(model.objects.filter(action_key=f'{prefix}_002',owner_user=user).exists())
            self.assertEqual(self.client.patch(only, {'owner_user_id':None}, format='json').status_code,200)
            self.assertFalse(model.objects.filter(action_key=f'{prefix}_002').exists())

    def test_disabled_missing_ids_and_text_writes_are_rejected_without_granting_access(self):
        outsider = APIClient(); outsider.force_authenticate(self.b)
        for prefix,model in [('ecr',EcrActionResponse),('eco',EcoActionResponse)]:
            path=f'/api/changes/{self.change.pk}/{prefix}-actions/{prefix}_001/'
            self.assertEqual(self.client.patch(path, {'owner_user_id':self.b.pk}, format='json').status_code,200)
            self.assertEqual(outsider.get(f'/api/changes/{self.change.pk}/{prefix}-actions/').status_code,404)
            self.assertEqual(outsider.patch(path, {'result':'Forbidden'}, format='json').status_code,404)
            self.b.is_active=False; self.b.save(update_fields=['is_active'])
            self.assertEqual(self.client.patch(path, {'owner_user_id':self.b.pk,'result':'Other edit'}, format='json').status_code,200)
            self.assertFalse(self.client.get(f'/api/changes/{self.change.pk}/{prefix}-actions/').data['actions'][0]['owner_user']['is_active'])
            new=path.replace('_001/','_002/')
            for payload in [{'owner_user_id':self.b.pk},{'owner_user_id':999999},{'owner_user_id':True},{'owner_user_id':'1'},{'owner':'Overwrite'}]:
                self.assertEqual(self.client.patch(new,payload,format='json').status_code,400)
            with self.assertRaises(ProtectedError): self.b.delete()
            self.b.is_active=True; self.b.save(update_fields=['is_active'])
        self.assertEqual(APIClient().get('/api/action-owners/').status_code,403)
        ChangeRequest.objects.filter(pk=self.change.pk).update(status='pending')
        self.assertEqual(self.client.patch(path,{'owner_user_id':None},format='json').status_code,409)


@tag('migration')
class ActionOwnerMigrationTests(TransactionTestCase):
    def test_upgrade_keeps_old_rows_and_reverse_guard_precedes_field_removal(self):
        old_target=[('changes','0017_feedback_followup_notifications')]
        new_target=[('changes','0018_action_owner_users')]
        try:
            MigrationExecutor(connection).migrate(old_target)
            old_apps=MigrationExecutor(connection).loader.project_state(old_target).apps
            user=get_user_model().objects.create_user('migration-action-owner')
            change=old_apps.get_model('changes','ChangeRequest').objects.create(applicant_id=user.pk)
            for name,key in [('EcrActionResponse','ecr_001'),('EcoActionResponse','eco_001')]:
                old_apps.get_model('changes',name).objects.create(change_id=change.pk,action_key=key,owner='历史负责人',result='历史结果')
            MigrationExecutor(connection).migrate(new_target)
            for model in [EcrActionResponse,EcoActionResponse]:
                row=model.objects.get(change_id=change.pk)
                self.assertEqual((row.owner,row.result,row.owner_user_id),('历史负责人','历史结果',None))
            row=EcrActionResponse.objects.get(change_id=change.pk); row.owner_user_id=user.pk; row.save()
            with self.assertRaisesRegex(RuntimeError,'负责人账号关联'):
                MigrationExecutor(connection).migrate(old_target)
            self.assertEqual(EcrActionResponse.objects.get(pk=row.pk).owner_user_id,user.pk)
            EcrActionResponse.objects.update(owner_user_id=None)
        finally:
            MigrationExecutor(connection).migrate(new_target)
