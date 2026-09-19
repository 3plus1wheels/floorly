from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('schedule', '0015_optional_kpi_import_workbooks'),
    ]

    operations = [
        migrations.AddField(
            model_name='shift',
            name='workbook_name_override',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
    ]
