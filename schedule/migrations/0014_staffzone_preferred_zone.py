from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('schedule', '0013_restore_time_forced_source_roles'),
    ]

    operations = [
        migrations.AddField(
            model_name='staffzone',
            name='preferred_zone',
            field=models.CharField(
                blank=True,
                choices=[
                    ('', 'Auto'),
                    ('mens', 'MENS'),
                    ('womens', 'WOMENS'),
                    ('cash', 'CASH'),
                    ('fits', 'FITS'),
                    ('greet', 'GREET'),
                    ('boh', 'BOH'),
                ],
                default='',
                max_length=8,
            ),
        ),
    ]
