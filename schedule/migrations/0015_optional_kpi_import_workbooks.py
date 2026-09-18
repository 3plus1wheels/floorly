from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('schedule', '0014_staffzone_preferred_zone'),
    ]

    operations = [
        migrations.AlterField(
            model_name='kpiimportbatch',
            name='current_filename',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AlterField(
            model_name='kpiimportbatch',
            name='current_fiscal_year',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='kpiimportbatch',
            name='current_sha256',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AlterField(
            model_name='kpiimportbatch',
            name='current_size',
            field=models.PositiveBigIntegerField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='kpiimportbatch',
            name='prior_filename',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AlterField(
            model_name='kpiimportbatch',
            name='prior_fiscal_year',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='kpiimportbatch',
            name='prior_sha256',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AlterField(
            model_name='kpiimportbatch',
            name='prior_size',
            field=models.PositiveBigIntegerField(blank=True, null=True),
        ),
    ]
