import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0004_organizations'),
        ('schedule', '0008_employee_workbook_name'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='KpiImportBatch',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('current_fiscal_year', models.PositiveSmallIntegerField()),
                ('prior_fiscal_year', models.PositiveSmallIntegerField()),
                ('current_filename', models.CharField(max_length=255)),
                ('prior_filename', models.CharField(max_length=255)),
                ('current_size', models.PositiveBigIntegerField()),
                ('prior_size', models.PositiveBigIntegerField()),
                ('current_sha256', models.CharField(max_length=64)),
                ('prior_sha256', models.CharField(max_length=64)),
                ('daily_records_imported', models.PositiveIntegerField(default=0)),
                ('period_records_imported', models.PositiveIntegerField(default=0)),
                ('warnings', models.JSONField(blank=True, default=list)),
                ('status', models.CharField(choices=[('completed', 'Completed'), ('warnings', 'Completed with warnings')], default='completed', max_length=16)),
                ('imported_at', models.DateTimeField(auto_now_add=True)),
                ('imported_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='kpi_import_batches', to=settings.AUTH_USER_MODEL)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='kpi_import_batches', to='api.organization')),
            ],
            options={'ordering': ['-imported_at', '-id']},
        ),
        migrations.CreateModel(
            name='KpiDailyRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fiscal_year', models.PositiveSmallIntegerField()),
                ('fiscal_period', models.PositiveSmallIntegerField()),
                ('fiscal_week', models.PositiveSmallIntegerField()),
                ('weekday', models.PositiveSmallIntegerField()),
                ('business_date', models.DateField()),
                ('day_target', models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ('sales', models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ('traffic', models.IntegerField(blank=True, null=True)),
                ('conversion', models.DecimalField(blank=True, decimal_places=6, max_digits=10, null=True)),
                ('atv', models.DecimalField(blank=True, decimal_places=4, max_digits=12, null=True)),
                ('upt', models.DecimalField(blank=True, decimal_places=4, max_digits=10, null=True)),
                ('import_batch', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='daily_records', to='schedule.kpiimportbatch')),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='kpi_daily_records', to='api.organization')),
            ],
            options={'ordering': ['business_date']},
        ),
        migrations.CreateModel(
            name='KpiPeriodRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fiscal_year', models.PositiveSmallIntegerField()),
                ('fiscal_period', models.PositiveSmallIntegerField()),
                ('sheet_name', models.CharField(max_length=64)),
                ('sales_plan', models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ('mtd_sales', models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ('mtd_as_of', models.DateField(blank=True, null=True)),
                ('import_batch', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='period_records', to='schedule.kpiimportbatch')),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='kpi_period_records', to='api.organization')),
            ],
            options={'ordering': ['fiscal_year', 'fiscal_period']},
        ),
        migrations.CreateModel(
            name='KpiDayState',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('business_date', models.DateField()),
                ('goal_overrides', models.JSONField(blank=True, default=dict)),
                ('hourly_values', models.JSONField(blank=True, default=dict)),
                ('revision', models.PositiveIntegerField(default=0)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('last_edited_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='edited_kpi_days', to=settings.AUTH_USER_MODEL)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='kpi_day_states', to='api.organization')),
            ],
        ),
        migrations.AddConstraint(
            model_name='kpidailyrecord',
            constraint=models.UniqueConstraint(fields=('organization', 'business_date'), name='unique_kpi_date_per_organization'),
        ),
        migrations.AddConstraint(
            model_name='kpidailyrecord',
            constraint=models.UniqueConstraint(fields=('organization', 'fiscal_year', 'fiscal_period', 'fiscal_week', 'weekday'), name='unique_kpi_fiscal_slot_per_organization'),
        ),
        migrations.AddIndex(
            model_name='kpidailyrecord',
            index=models.Index(fields=['organization', 'fiscal_year', 'fiscal_period'], name='schedule_kp_organiz_e103f9_idx'),
        ),
        migrations.AddConstraint(
            model_name='kpiperiodrecord',
            constraint=models.UniqueConstraint(fields=('organization', 'fiscal_year', 'fiscal_period'), name='unique_kpi_period_per_organization'),
        ),
        migrations.AddConstraint(
            model_name='kpidaystate',
            constraint=models.UniqueConstraint(fields=('organization', 'business_date'), name='unique_kpi_state_per_organization_date'),
        ),
    ]
