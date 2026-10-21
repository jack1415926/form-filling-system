from django.core.exceptions import FieldDoesNotExist
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, tag
from django.utils import timezone


@tag('migration')
class CompatibilityMigrationTests(TransactionTestCase):
    before = [('changes', '0028_change_creation_request')]
    after = [('changes', '0029_remove_legacy_compat')]

    def migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        return executor.loader.project_state(target).apps

    def test_old_records_removed_while_multi_owner_assignment_and_history_survive(self):
        apps = self.migrate(self.before)
        try:
            User = apps.get_model('auth', 'User')
            Change = apps.get_model('changes', 'ChangeRequest')
            Round = apps.get_model('changes', 'ReviewRound')
            Record = apps.get_model('changes', 'ReviewRecord')
            Action = apps.get_model('changes', 'EcrActionResponse')
            owner = User.objects.create(username='compat-owner')
            other = User.objects.create(username='compat-other')
            old = Change.objects.create(applicant_id=owner.pk, stage='legacy', title='Retired')
            old_round = Round.objects.create(change_id=old.pk, number=1, review_mode='public', submitted_at=timezone.now())
            Record.objects.create(change_id=old.pk, round_id=old_round.pk, reviewer_id=owner.pk)
            current = Change.objects.create(applicant_id=owner.pk, stage='ecr', title='Keep', current_review_round=1, status='pending', review_mode='designated')
            snapshot = {'version': 1, 'original_owner': 'immutable historical text'}
            round = Round.objects.create(change_id=current.pk, number=1, review_mode='designated', submitted_at=timezone.now(), form_snapshot=snapshot)
            kept = Record.objects.create(change_id=current.pk, round_id=round.pk, reviewer_id=owner.pk, approval_required=True)
            Record.objects.create(change_id=current.pk, round_id=round.pk, reviewer_id=other.pk, assigned=False)
            Record.objects.create(change_id=current.pk, reviewer_id=other.pk)
            action = Action.objects.create(change_id=current.pk, action_key='ecr_001', owner='old label', owner_user_id=owner.pk, result='Keep result')
            multi = Action.objects.create(change_id=current.pk, action_key='ecr_002', owner_user_id=other.pk)
            multi.owners.add(owner, other)
            apps = self.migrate(self.after)
            Current = apps.get_model('changes', 'ChangeRequest')
            CurrentAction = apps.get_model('changes', 'EcrActionResponse')
            self.assertFalse(Current.objects.filter(pk=old.pk).exists())
            self.assertEqual(Current.objects.get(pk=current.pk).title, 'Keep')
            self.assertEqual(apps.get_model('changes', 'ReviewRound').objects.get(pk=round.pk).form_snapshot, snapshot)
            self.assertEqual(list(apps.get_model('changes', 'ReviewRecord').objects.values_list('pk', flat=True)), [kept.pk])
            self.assertEqual(list(CurrentAction.objects.get(pk=action.pk).owners.values_list('pk', flat=True)), [owner.pk])
            self.assertEqual(CurrentAction.objects.get(pk=action.pk).result, 'Keep result')
            self.assertEqual(set(CurrentAction.objects.get(pk=multi.pk).owners.values_list('pk', flat=True)), {owner.pk, other.pk})
            with self.assertRaises(FieldDoesNotExist): CurrentAction._meta.get_field('owner_user')
            with self.assertRaisesRegex(RuntimeError, '不能直接逆迁移'):
                MigrationExecutor(connection).migrate(self.before)
        finally:
            self.migrate(self.after)

    def test_mixed_public_and_designated_history_is_not_automatically_deleted(self):
        apps = self.migrate(self.before)
        public = None
        try:
            owner = apps.get_model('auth', 'User').objects.create(username='mixed-compat-owner')
            change = apps.get_model('changes', 'ChangeRequest').objects.create(applicant_id=owner.pk, stage='ecr', current_review_round=2, review_mode='designated')
            Round = apps.get_model('changes', 'ReviewRound')
            public = Round.objects.create(change_id=change.pk, number=1, review_mode='public', submitted_at=timezone.now())
            Round.objects.create(change_id=change.pk, number=2, review_mode='designated', submitted_at=timezone.now())
            with self.assertRaisesRegex(RuntimeError, '指定审核历史'):
                self.migrate(self.after)
            self.assertEqual(Round.objects.filter(change_id=change.pk).count(), 2)
        finally:
            if public is not None: public.delete()
            self.migrate(self.after)
