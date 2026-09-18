import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('schedule', '0011_schedule_sync_token_use'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='WorkbookZoneOverride',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('hour', models.PositiveSmallIntegerField()),
                ('zone', models.CharField(choices=[('WOMENS', 'WOMENS'), ('MENS', 'MENS'), ('FITS', 'FITS'), ('CASH', 'CASH'), ('GREET', 'GREET'), ('FLEX', 'FLEX'), ('OFFICE', 'OFFICE'), ('TASK', 'TASK'), ('STYLIST', 'STYLIST'), ('CEL', 'CEL'), ('BOH', 'BOH')], max_length=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('last_edited_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='edited_workbook_zones', to=settings.AUTH_USER_MODEL)),
                ('shift', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='workbook_zone_overrides', to='schedule.shift')),
            ],
            options={'ordering': ['shift_id', 'hour']},
        ),
        migrations.AddConstraint(
            model_name='workbookzoneoverride',
            constraint=models.UniqueConstraint(fields=('shift', 'hour'), name='unique_workbook_zone_shift_hour'),
        ),
        migrations.AddConstraint(
            model_name='workbookzoneoverride',
            constraint=models.CheckConstraint(condition=models.Q(('hour__gte', 8), ('hour__lte', 20)), name='workbook_zone_hour_range'),
        ),
    ]
