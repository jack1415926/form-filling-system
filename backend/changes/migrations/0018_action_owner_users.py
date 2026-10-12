import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def prevent_owner_loss(apps, schema_editor):
    for name in ['EcrActionResponse', 'EcoActionResponse']:
        if apps.get_model('changes', name).objects.using(schema_editor.connection.alias).filter(owner_user_id__isnull=False).exists():
            raise RuntimeError('已有行动负责人账号关联，不能直接回退；请先规划保留责任记录的数据方案。')


class Migration(migrations.Migration):
    dependencies = [('changes', '0017_feedback_followup_notifications'), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.AddField(model_name='ecractionresponse', name='owner_user', field=models.ForeignKey(null=True, blank=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL)),
        migrations.AddField(model_name='ecoactionresponse', name='owner_user', field=models.ForeignKey(null=True, blank=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL)),
        migrations.RunPython(migrations.RunPython.noop, prevent_owner_loss),
    ]
