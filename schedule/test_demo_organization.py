from datetime import date, time
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from api.models import Organization, OrganizationMembership
from schedule.models import Employee, Shift, StaffZone, WorkbookZoneOverride


class CreateDemoOrganizationTests(TestCase):
    def setUp(self):
        self.source = Organization.objects.create(
            name='Source Store',
            boh_shift_times=[{'start': '15:00', 'end': '20:00'}],
            zone_priority=['GREET', 'CASH', 'WOMENS'],
        )
        self.viewer = get_user_model().objects.create_user(
            username='demo-viewer', password='Safe-Test-Password-427!'
        )
        self.manager = Employee.objects.create(
            organization=self.source,
            # This deliberately collides with the first built-in demo name.
            name='Brooks, Avery',
            primary_job='Management',
            role_override='management',
            workbook_name='REAL NAME',
        )
        self.stylist = Employee.objects.create(
            organization=self.source,
            name='Real Stylist',
            primary_job='Stylist',
        )
        StaffZone.objects.create(
            employee=self.manager,
            womens=3,
            mens=2,
            cash=3,
            preferred_zone='cash',
        )
        self.manager_shift = Shift.objects.create(
            employee=self.manager,
            date=date(2026, 9, 28),
            day_label='Mon',
            start_time=time(9),
            end_time=time(17),
            role='CEL',
            workbook_name_override='REAL MANAGER',
        )
        Shift.objects.create(
            employee=self.stylist,
            date=date(2026, 10, 4),
            day_label='Sun',
            start_time=time(12),
            end_time=time(18),
            role='Stylist',
        )
        WorkbookZoneOverride.objects.create(
            shift=self.manager_shift,
            hour=10,
            zone='CASH',
            last_edited_by=self.viewer,
        )

    def create_demo(self, **overrides):
        options = {
            'source_organization_id': self.source.id,
            'name': 'Floorly Demo',
            'week_start': '2026-09-28',
            'target_week_start': '2026-10-05',
            'member_usernames': ['demo-viewer'],
            'stdout': StringIO(),
        }
        options.update(overrides)
        call_command('create_demo_organization', **options)
        return Organization.objects.get(name=options['name'])

    def test_creates_isolated_anonymized_copy_of_schedule_shape(self):
        demo = self.create_demo()

        self.assertEqual(demo.boh_shift_times, self.source.boh_shift_times)
        self.assertEqual(demo.zone_priority, self.source.zone_priority)
        self.assertTrue(demo.is_active)

        demo_employees = list(demo.employees.order_by('id'))
        self.assertEqual(
            [employee.name for employee in demo_employees],
            ['Chen, Riley', 'Diaz, Jordan'],
        )
        self.assertFalse(
            demo.employees.filter(name__in=['Brooks, Avery', 'Real Stylist']).exists()
        )
        self.assertEqual(demo_employees[0].primary_job, 'Management')
        self.assertEqual(demo_employees[0].role_override, 'management')
        self.assertEqual(demo_employees[0].workbook_name, '')

        manager_zones = demo_employees[0].zones
        self.assertEqual(manager_zones.cash, 3)
        self.assertEqual(manager_zones.preferred_zone, 'cash')
        self.assertFalse(StaffZone.objects.filter(employee=demo_employees[1]).exists())

        shifts = list(Shift.objects.filter(employee__organization=demo).order_by('date'))
        self.assertEqual([shift.date for shift in shifts], [date(2026, 10, 5), date(2026, 10, 11)])
        self.assertEqual([shift.role for shift in shifts], ['CEL', 'Stylist'])
        self.assertEqual(shifts[0].workbook_name_override, '')
        copied_override = WorkbookZoneOverride.objects.get(shift=shifts[0])
        self.assertEqual((copied_override.hour, copied_override.zone), (10, 'CASH'))
        self.assertIsNone(copied_override.last_edited_by)

        membership = OrganizationMembership.objects.get(
            user=self.viewer, organization=demo
        )
        self.assertIsNone(membership.employee)

        self.manager.refresh_from_db()
        self.assertEqual(self.manager.name, 'Brooks, Avery')
        self.assertEqual(self.manager_shift.workbook_name_override, 'REAL MANAGER')

    def test_refuses_to_overwrite_an_existing_organization(self):
        Organization.objects.create(name='Floorly Demo')

        with self.assertRaisesMessage(CommandError, 'already exists'):
            self.create_demo()

        self.assertEqual(Organization.objects.filter(name='Floorly Demo').count(), 1)

    def test_validates_week_and_members_before_creating_anything(self):
        with self.assertRaisesMessage(CommandError, 'must be a Monday'):
            self.create_demo(week_start='2026-09-29')
        with self.assertRaisesMessage(CommandError, 'Unknown --member-username'):
            self.create_demo(member_usernames=['missing-user'])

        self.assertFalse(Organization.objects.filter(name='Floorly Demo').exists())

    def test_requires_at_least_one_shift_in_the_source_week(self):
        with self.assertRaisesMessage(CommandError, 'No source shifts found'):
            self.create_demo(week_start='2026-09-21')

        self.assertFalse(Organization.objects.filter(name='Floorly Demo').exists())
