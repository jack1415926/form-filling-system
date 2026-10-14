from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, tag
from django.utils import timezone


@tag('migration')
class SnapshotMigrationTests(TransactionTestCase):
    def test_nonempty_old_round_preserved_without_fabricated_snapshot(self):
        self.assertEqual(connection.settings_dict['NAME'], 'test_form_system')
        executor = MigrationExecutor(connection)
        try:
            executor.migrate([('changes', '0025_eco_filler_inbox_read')])
            apps = executor.loader.project_state([('changes', '0025_eco_filler_inbox_read')]).apps
            owner = apps.get_model('auth', 'User').objects.create(username='snapshot-migration-owner')
            change = apps.get_model('changes', 'ChangeRequest').objects.create(applicant_id=owner.pk, title='Existing form', stage='ecr')
            old = apps.get_model('changes', 'ReviewRound').objects.create(change_id=change.pk, number=1, review_mode='designated', title='Original submission', ecr_no='MIGRATION-ECR', submitted_at=timezone.now(), state='returned', return_reason='Existing return evidence', submission_payload={'expected_round': 0})
            executor = MigrationExecutor(connection)
            executor.migrate([('changes', '0026_review_round_form_snapshot')])
            apps = executor.loader.project_state([('changes', '0026_review_round_form_snapshot')]).apps
            current = apps.get_model('changes', 'ReviewRound').objects.get(pk=old.pk)
            self.assertIsNone(current.form_snapshot)
            self.assertEqual((current.title, current.return_reason, current.submission_payload), ('Original submission', 'Existing return evidence', {'expected_round': 0}))
            current.form_snapshot = {'version': 1, 'historical_evidence': 'do not drop'}
            current.save(update_fields=['form_snapshot'])
            with self.assertRaisesRegex(RuntimeError, '快照'):
                MigrationExecutor(connection).migrate([('changes', '0025_eco_filler_inbox_read')])
            self.assertEqual(apps.get_model('changes', 'ReviewRound').objects.get(pk=old.pk).form_snapshot, current.form_snapshot)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
