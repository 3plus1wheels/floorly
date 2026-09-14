from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0004_organizations'),
        ('schedule', '0007_employee_organization'),
    ]

    operations = [
        migrations.AddField(
            model_name='organizationmembership',
            name='employee',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='account_memberships', to='schedule.employee',
            ),
        ),
        migrations.AddConstraint(
            model_name='organizationmembership',
            constraint=models.UniqueConstraint(
                condition=models.Q(employee__isnull=False), fields=('employee',),
                name='unique_employee_account_membership',
            ),
        ),
    ]
