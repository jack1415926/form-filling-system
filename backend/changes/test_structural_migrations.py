from datetime import date

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, tag


@tag('migration')
class StructuralMigrationTests(TransactionTestCase):
    def migrate(self, name):
        target = [('changes', name)]
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        return executor.loader.project_state(target).apps

    def snapshot(self, apps, names=None):
        models = ([apps.get_model('changes', name) for name in names] if names is not None
                  else apps.get_app_config('changes').get_models())
        saved = {}
        for model in models:
            fields = [field.attname for field in model._meta.concrete_fields]
            rows = list(model.objects.order_by('pk').values(*fields))
            self.assertTrue(rows, f'{model.__name__}: old-data fixture must be nonempty')
            saved[model.__name__] = (fields, rows)
        return saved

    def assert_preserved(self, apps, saved):
        for name, (fields, rows) in saved.items():
            self.assertEqual(list(apps.get_model('changes', name).objects.order_by('pk').values(*fields)), rows, name)

    def seed(self, apps, name, owner, change, material):
        def model(key):
            return apps.get_model('changes', key)
        if name == '0003_materialchange':
            return model('MaterialChange').objects.create(change_id=change, category='revision', material_no='00003151', old_revision='A', new_revision='B', description='旧物料🧪').pk
        if name == '0004_materialchange_request_id_and_more':
            self.assertIsNone(model('MaterialChange').objects.get(pk=material).request_id)
        elif name == '0005_materialdisposition':
            model('MaterialDisposition').objects.create(material_id=material, location_group='company', location_item='company_finished', disposition='NA', remark='旧处置')
        elif name == '0006_questionresponse':
            model('QuestionResponse').objects.create(change_id=change, number=6, answer='Y', remark='旧回答')
        elif name == '0007_ecractionresponse':
            model('EcrActionResponse').objects.create(change_id=change, action_key='ecr_001', owner='旧负责人', result='旧ECR')
        elif name == '0008_ecoactionresponse':
            model('EcoActionResponse').objects.create(change_id=change, action_key='eco_001', result='旧ECO')
        elif name == '0009_emc_reference':
            reference = model('EmcReference').objects.create(change_id=change, title='旧EMC')
            row = model('EmcReferenceRow').objects.create(reference_id=reference.pk, key='old_row', label='旧行', sort_order=1)
            test = model('EmcReferenceTest').objects.create(reference_id=reference.pk, key='old_test', label='旧列', sort_order=1)
            model('EmcReferenceCell').objects.create(reference_id=reference.pk, row_id=row.pk, test_id=test.pk, mark='X', remark='旧交叉格')
        elif name == '0010_executionplanresponse':
            model('ExecutionPlanResponse').objects.create(change_id=change, activity_key='plan_001', owner='旧计划负责人', start_date=date(2026, 10, 3), end_date=date(2026, 10, 4), remark='旧计划')
        elif name == '0011_significant_change':
            model('SignificantAssessment').objects.create(change_id=change, final_conclusion='significant')
            model('SignificantChartResponse').objects.create(change_id=change, chart_key='A', applicability='Y', reason='旧组原因', result='continue')
            model('SignificantQuestionResponse').objects.create(change_id=change, question_key='sub_b_1_1', answer='Y', reason='旧题原因')
        elif name == '0012_submission':
            record = model('ChangeRequest').objects.get(pk=change)
            self.assertEqual(record.review_mode, '')
            self.assertIsNone(record.submitted_at)
            self.assertTrue(apps.get_model('auth', 'Group').objects.filter(name='审核员').exists())
            self.assertFalse(apps.get_model('auth', 'User').objects.get(pk=owner).groups.exists())
        return material

    def test_upgrade_checkpoints_preserve_nonempty_old_tables_and_reverse(self):
        self.assertEqual(connection.vendor, 'mysql')
        owner = get_user_model().objects.create_user('structural-migration')
        steps = [
            ('0003_materialchange', ['MaterialChange']),
            ('0004_materialchange_request_id_and_more', []),
            ('0005_materialdisposition', ['MaterialDisposition']),
            ('0006_questionresponse', ['QuestionResponse']),
            ('0007_ecractionresponse', ['EcrActionResponse']),
            ('0008_ecoactionresponse', ['EcoActionResponse']),
            ('0009_emc_reference', ['EmcReference', 'EmcReferenceRow', 'EmcReferenceTest', 'EmcReferenceCell']),
            ('0010_executionplanresponse', ['ExecutionPlanResponse']),
            ('0011_significant_change', ['SignificantAssessment', 'SignificantChartResponse', 'SignificantQuestionResponse']),
            ('0012_submission', ['ReviewRecord']),
        ]
        try:
            apps = self.migrate('0002_unique_numbers')
            change = apps.get_model('changes', 'ChangeRequest').objects.create(applicant_id=owner.pk, title='旧申请', ecr_no='CHAIN-ECR', eco_no='CHAIN-ECO').pk
            material = None
            for name, new_models in steps:
                with self.subTest(migration=name):
                    saved = self.snapshot(apps)
                    if name == '0012_submission':
                        apps.get_model('auth', 'Group').objects.filter(name='审核员').delete()
                    apps = self.migrate(name)
                    self.assert_preserved(apps, saved)
                    for key in new_models:
                        self.assertFalse(apps.get_model('changes', key).objects.exists(), key)
                    material = self.seed(apps, name, owner.pk, change, material)
                    if name in ['0009_emc_reference', '0010_executionplanresponse']:
                        previous = '0008_ecoactionresponse' if name == '0009_emc_reference' else '0009_emc_reference'
                        preserved = self.snapshot(apps, list(saved))
                        tables = [apps.get_model('changes', key)._meta.db_table for key in new_models]
                        apps = self.migrate(previous)
                        self.assert_preserved(apps, preserved)
                        for table in tables:
                            self.assertNotIn(table, connection.introspection.table_names())
                        apps = self.migrate(name)
                        for key in new_models:
                            self.assertFalse(apps.get_model('changes', key).objects.exists(), key)
                        material = self.seed(apps, name, owner.pk, change, material)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
