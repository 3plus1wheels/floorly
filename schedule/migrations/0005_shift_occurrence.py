from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('schedule', '0004_remove_staffzone_flex_office'),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name='shift',
            unique_together=set(),
        ),
        migrations.AddField(
            model_name='shift',
            name='occurrence',
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AlterUniqueTogether(
            name='shift',
            unique_together={('employee', 'date', 'start_time', 'occurrence')},
        ),
    ]
