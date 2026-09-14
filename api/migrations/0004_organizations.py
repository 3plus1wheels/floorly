from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def create_default_organization(apps, schema_editor):
    Organization = apps.get_model('api', 'Organization')
    Membership = apps.get_model('api', 'OrganizationMembership')
    User = apps.get_model('auth', 'User')
    organization, _ = Organization.objects.get_or_create(name='Default Organization')
    Membership.objects.bulk_create(
        [Membership(user_id=user_id, organization_id=organization.id) for user_id in User.objects.values_list('id', flat=True)],
        ignore_conflicts=True,
    )


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0003_userprofile'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='must_change_password',
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name='Organization',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'ordering': ['name']},
        ),
        migrations.CreateModel(
            name='OrganizationMembership',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='memberships', to='api.organization')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='organization_memberships', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(
            model_name='organizationmembership',
            constraint=models.UniqueConstraint(fields=('user', 'organization'), name='unique_organization_membership'),
        ),
        migrations.RunPython(create_default_organization, migrations.RunPython.noop),
    ]
