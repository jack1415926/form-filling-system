import importlib

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.models.deletion import ProtectedError
from django.test import TestCase, TransactionTestCase, override_settings, tag
from rest_framework.test import APIClient

from .models import ChangeRequest, EcrActionResponse, EcoActionResponse


class ActionOwnerMigrationTests(TransactionTestCase):
    def test_upgrade_keeps_old_rows_and_reverse_guard_precedes_field_removal(self):
        old_target=[('changes','0017_feedback_followup_notifications')]
        new_target=[('changes','0018_action_owner_users')]
        latest=MigrationExecutor(connection).loader.graph.leaf_nodes()
        try:
            MigrationExecutor(connection).migrate(old_target)
            old_apps=MigrationExecutor(connection).loader.project_state(old_target).apps
            user=get_user_model().objects.create_user('migration-action-owner')
            change=old_apps.get_model('changes','ChangeRequest').objects.create(applicant_id=user.pk)
            for name,key in [('EcrActionResponse','ecr_001'),('EcoActionResponse','eco_001')]:
                old_apps.get_model('changes',name).objects.create(change_id=change.pk,action_key=key,owner='历史负责人',result='历史结果')
            MigrationExecutor(connection).migrate(new_target)
            new_apps=MigrationExecutor(connection).loader.project_state(new_target).apps
            for model in [new_apps.get_model('changes','EcrActionResponse'),new_apps.get_model('changes','EcoActionResponse')]:
                row=model.objects.get(change_id=change.pk)
                self.assertEqual((row.owner,row.result,row.owner_user_id),('历史负责人','历史结果',None))
            HistoricalEcr=new_apps.get_model('changes','EcrActionResponse')
            row=HistoricalEcr.objects.get(change_id=change.pk); row.owner_user_id=user.pk; row.save()
            with self.assertRaisesRegex(RuntimeError,'负责人账号关联'):
                MigrationExecutor(connection).migrate(old_target)
            self.assertEqual(HistoricalEcr.objects.get(pk=row.pk).owner_user_id,user.pk)
            HistoricalEcr.objects.update(owner_user_id=None)
        finally:
            MigrationExecutor(connection).migrate(latest)
