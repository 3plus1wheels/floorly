from datetime import date, time
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from api.models import Organization
from .models import Employee, Shift


class ScheduleRetentionCommandTests(TestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name='Retention Store')
        self.other_organization = Organization.objects.create(name='Other Retention Store')
        self.employee = Employee.objects.create(organization=self.organization, name='Employee One')
        self.other_employee = Employee.objects.create(organization=self.other_organization, name='Employee Two')

    @staticmethod
    def create_shift(employee, shift_date):
        return Shift.objects.create(
            employee=employee,
            date=shift_date,
            start_time=time(9),
            end_time=time(17),
            role='Stylist',
        )

    def test_dry_run_does_not_delete(self):
        shift = self.create_shift(self.employee, date(2025, 9, 14))
        output = StringIO()
        call_command('purge_schedule_data', before='2025-09-15', dry_run=True, stdout=output)
        self.assertTrue(Shift.objects.filter(pk=shift.pk).exists())
        self.assertIn('Would delete 1 shift record', output.getvalue())

    def test_purge_respects_cutoff_and_organization(self):
        expired = self.create_shift(self.employee, date(2025, 9, 14))
        current = self.create_shift(self.employee, date(2025, 9, 15))
        other = self.create_shift(self.other_employee, date(2025, 9, 14))
        call_command(
            'purge_schedule_data',
            before='2025-09-15',
            organization_id=self.organization.id,
            stdout=StringIO(),
        )
        self.assertFalse(Shift.objects.filter(pk=expired.pk).exists())
        self.assertTrue(Shift.objects.filter(pk=current.pk).exists())
        self.assertTrue(Shift.objects.filter(pk=other.pk).exists())
