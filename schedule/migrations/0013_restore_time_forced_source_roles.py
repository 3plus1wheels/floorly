from django.db import migrations
from django.db.models import Q


def restore_source_roles(apps, schema_editor):
    Shift = apps.get_model('schedule', 'Shift')
    formerly_forced_times = (
        Q(start_time='16:30:00', end_time='21:15:00')
        | Q(start_time='08:00:00', end_time='12:45:00')
        | Q(start_time='09:00:00', end_time='13:45:00')
        | Q(start_time='10:00:00', end_time='14:45:00', date__week_day=1)
    )
    shifts = Shift.objects.select_related('employee').filter(
        formerly_forced_times, role='BOH',
    )
    for shift in shifts.iterator():
        source = (shift.employee.primary_job or '').lower()
        if any(keyword in source for keyword in ('shipment', 'stock', 'inventory', 'boh')):
            role = 'BOH'
        elif any(keyword in source for keyword in ('cel', 'manager', 'management', 'supervisor')):
            role = 'CEL'
        else:
            role = 'Stylist'
        Shift.objects.filter(pk=shift.pk).update(role=role)


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0006_organization_floor_map_rules'),
        ('schedule', '0012_workbookzoneoverride'),
    ]

    operations = [migrations.RunPython(restore_source_roles, migrations.RunPython.noop)]
