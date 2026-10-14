from django.db import migrations, models


def protect_snapshots(apps, schema_editor):
    if apps.get_model('changes', 'ReviewRound').objects.using(schema_editor.connection.alias).filter(form_snapshot__isnull=False).exists():
        raise RuntimeError('已有完整轮次历史表单，不能逆迁移删除快照。')


class Migration(migrations.Migration):
    dependencies = [('changes', '0025_eco_filler_inbox_read')]
    operations = [migrations.AddField(
        model_name='reviewround', name='form_snapshot',
        field=models.JSONField(blank=True, null=True),
    ), migrations.RunPython(migrations.RunPython.noop, protect_snapshots)]
