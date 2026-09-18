from django.db import migrations, models
import api.models


class Migration(migrations.Migration):
    dependencies = [('api', '0005_organizationmembership_employee')]

    operations = [
        migrations.AddField(
            model_name='organization',
            name='boh_shift_times',
            field=models.JSONField(blank=True, default=api.models.default_boh_shift_times),
        ),
        migrations.AddField(
            model_name='organization',
            name='zone_priority',
            field=models.JSONField(default=api.models.default_zone_priority),
        ),
    ]
