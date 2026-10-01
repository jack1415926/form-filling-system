from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class NumberMigrationTests(TransactionTestCase):
    before = [('changes', '0001_initial')]
    after = [('changes', '0002_unique_numbers')]

    def setUp(self):
        self.assertEqual(connection.vendor, 'mysql')
        self.owner = get_user_model().objects.create_user('migration-owner')
        executor = MigrationExecutor(connection)
        executor.migrate(self.before)
        self.old_model = executor.loader.project_state(self.before).apps.get_model('changes', 'ChangeRequest')

    def tearDown(self):
        # Restore the latest schema even when the assertion fails.
        self.old_model.objects.all().delete()
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_existing_data_forward_and_backward_migration(self):
        original = self.old_model.objects.create(applicant_id=self.owner.pk, title='原始数据', ecr_no='000001', eco_no='ECO-OLD')
        blanks = [self.old_model.objects.create(applicant_id=self.owner.pk) for _ in range(2)]
        executor = MigrationExecutor(connection)
        executor.migrate(self.after)
        current = executor.loader.project_state(self.after).apps.get_model('changes', 'ChangeRequest')
        restored = current.objects.get(pk=original.pk)
        self.assertEqual((restored.title, restored.ecr_no, restored.eco_no), ('原始数据', '000001', 'ECO-OLD'))
        self.assertEqual(restored.ecr_no_unique, '000001')
        for blank in blanks:
            self.assertIsNone(current.objects.get(pk=blank.pk).ecr_no_unique)
        with self.assertRaises(IntegrityError), transaction.atomic():
            current.objects.create(applicant_id=self.owner.pk, ecr_no='000001')
        MigrationExecutor(connection).migrate(self.before)
        restored = self.old_model.objects.get(pk=original.pk)
        self.assertEqual((restored.title, restored.ecr_no, restored.eco_no), ('原始数据', '000001', 'ECO-OLD'))
        self.assertEqual(self.old_model.objects.count(), 3)
        with connection.cursor() as cursor:
            columns = {column.name for column in connection.introspection.get_table_description(cursor, 'change_request')}
        self.assertNotIn('ecr_no_unique', columns)
        self.assertNotIn('eco_no_unique', columns)

    def test_duplicate_check_stops_before_ddl_and_preserves_records(self):
        for field in ('ecr_no', 'eco_no'):
            with self.subTest(field=field):
                self.old_model.objects.all().delete()
                first = self.old_model.objects.create(applicant_id=self.owner.pk, **{field: 'DUPLICATE'})
                second = self.old_model.objects.create(applicant_id=self.owner.pk, **{field: 'DUPLICATE'})
                with self.assertRaisesRegex(RuntimeError, 'Duplicate non-empty numbers') as raised:
                    MigrationExecutor(connection).migrate(self.after)
                self.assertIn(str(first.pk), str(raised.exception))
                self.assertIn(str(second.pk), str(raised.exception))
                self.assertEqual(self.old_model.objects.filter(**{field: 'DUPLICATE'}).count(), 2)
                with connection.cursor() as cursor:
                    columns = {column.name for column in connection.introspection.get_table_description(cursor, 'change_request')}
                    cursor.execute("SELECT COUNT(*) FROM django_migrations WHERE app='changes' AND name='0002_unique_numbers'")
                    self.assertEqual(cursor.fetchone()[0], 0)
                self.assertNotIn('ecr_no_unique', columns)
                self.assertNotIn('eco_no_unique', columns)
