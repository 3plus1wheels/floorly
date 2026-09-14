from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('schedule', '0007_employee_organization'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='workbook_name',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
    ]
