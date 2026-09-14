from django.db import migrations, models
import django.db.models.deletion


def assign_default_organization(apps, schema_editor):
    Organization = apps.get_model('api', 'Organization')
    Employee = apps.get_model('schedule', 'Employee')
    organization = Organization.objects.get(name='Default Organization')
    Employee.objects.filter(organization__isnull=True).update(organization_id=organization.id)


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0004_organizations'),
        ('schedule', '0006_employee_role_override'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='organization',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='employees', to='api.organization'),
        ),
        migrations.RunPython(assign_default_organization, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='employee',
            name='organization',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='employees', to='api.organization'),
        ),
        migrations.AlterField(
            model_name='employee',
            name='name',
            field=models.CharField(max_length=255),
        ),
        migrations.AddConstraint(
            model_name='employee',
            constraint=models.UniqueConstraint(fields=('organization', 'name'), name='unique_employee_name_per_organization'),
        ),
    ]
