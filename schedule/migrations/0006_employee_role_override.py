from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('schedule', '0005_shift_occurrence'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='role_override',
            field=models.CharField(
                blank=True,
                choices=[
                    ('', 'Use scraped role'),
                    ('associate', 'Associate'),
                    ('management', 'Management'),
                    ('non_active', 'Non-active'),
                ],
                default='',
                max_length=16,
            ),
        ),
    ]
