from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('changes', '0023_eco_filler_handoff')]
    operations = [migrations.AlterField(
        model_name='changerequest', name='stage',
        field=models.CharField(max_length=8, default='ecr', choices=[('legacy', '停用的旧流程标记'), ('ecr', 'ECR'), ('eco', 'ECO')]),
    )]
