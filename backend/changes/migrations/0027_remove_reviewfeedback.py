from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('changes', '0026_review_round_form_snapshot')]

    operations = [migrations.DeleteModel(name='ReviewFeedback')]
