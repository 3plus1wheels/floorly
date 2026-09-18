from collections import Counter

from django.db import migrations


PREVIOUS_ZONE_PRIORITY = [
    'WOMENS', 'MENS', 'FITS', 'CASH', 'FITS',
    'MENS', 'WOMENS', 'GREET', 'MENS', 'WOMENS', 'CASH',
]


def add_third_fits_slot(apps, schema_editor):
    Organization = apps.get_model('api', 'Organization')
    expected = Counter(PREVIOUS_ZONE_PRIORITY)
    for organization in Organization.objects.all().iterator():
        priority = organization.zone_priority
        if isinstance(priority, list) and Counter(priority) == expected:
            organization.zone_priority = [*priority, 'FITS']
            organization.save(update_fields=['zone_priority'])


def remove_third_fits_slot(apps, schema_editor):
    Organization = apps.get_model('api', 'Organization')
    for organization in Organization.objects.all().iterator():
        priority = organization.zone_priority
        if not isinstance(priority, list) or Counter(priority)['FITS'] != 3:
            continue
        updated = list(priority)
        updated.pop(len(updated) - 1 - updated[::-1].index('FITS'))
        organization.zone_priority = updated
        organization.save(update_fields=['zone_priority'])


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0007_add_second_cash_priority_slot'),
    ]

    operations = [
        migrations.RunPython(add_third_fits_slot, remove_third_fits_slot),
    ]
