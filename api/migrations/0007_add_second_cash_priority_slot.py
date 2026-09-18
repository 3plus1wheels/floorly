from collections import Counter

from django.db import migrations


OLD_ZONE_PRIORITY = [
    'WOMENS', 'MENS', 'FITS', 'CASH', 'FITS',
    'MENS', 'WOMENS', 'GREET', 'MENS', 'WOMENS',
]


def add_second_cash_slot(apps, schema_editor):
    Organization = apps.get_model('api', 'Organization')
    expected = Counter(OLD_ZONE_PRIORITY)
    for organization in Organization.objects.all().iterator():
        priority = organization.zone_priority
        if isinstance(priority, list) and Counter(priority) == expected:
            organization.zone_priority = [*priority, 'CASH']
            organization.save(update_fields=['zone_priority'])


def remove_second_cash_slot(apps, schema_editor):
    Organization = apps.get_model('api', 'Organization')
    for organization in Organization.objects.all().iterator():
        priority = organization.zone_priority
        if not isinstance(priority, list) or Counter(priority)['CASH'] != 2:
            continue
        updated = list(priority)
        updated.pop(len(updated) - 1 - updated[::-1].index('CASH'))
        organization.zone_priority = updated
        organization.save(update_fields=['zone_priority'])


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0006_organization_floor_map_rules'),
    ]

    operations = [
        migrations.RunPython(add_second_cash_slot, remove_second_cash_slot),
    ]
