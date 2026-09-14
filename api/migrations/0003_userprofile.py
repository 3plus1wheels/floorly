from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def backfill_profiles(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    UserProfile = apps.get_model('api', 'UserProfile')
    profiles = []
    for user in User.objects.all().iterator():
        full_name = f'{user.first_name} {user.last_name}'.strip() or user.username
        profiles.append(UserProfile(user_id=user.id, full_name=full_name))
    UserProfile.objects.bulk_create(profiles)


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0002_themepreference'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='UserProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('full_name', models.CharField(max_length=255)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='profile', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.RunPython(backfill_profiles, migrations.RunPython.noop),
    ]
