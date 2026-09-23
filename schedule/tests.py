from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.models import Organization, OrganizationMembership, UserProfile
from .models import (
    Employee, KronosImportConsent, Shift, StaffZone, WorkbookZoneOverride,
    WorkbookPromoRows, WorkbookPromoDayOverride,
)
from .authentication import ScheduleSyncToken
from .parsers import _normalize_role
from .views import _build_interval_assignments


class ScheduleSyncTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(username='scraper-user', password='password')
        self.organization = Organization.objects.create(name='Store One')
        OrganizationMembership.objects.create(user=self.user, organization=self.organization)
        self.client.force_authenticate(self.user)
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(self.organization.id))
        self.url = reverse('schedule_sync')
        self.payload = {
            'source': 'kronos', 'timezone': 'America/Edmonton',
            'synced_at': '2026-09-07T12:00:00-06:00',
            'weeks': [
                {'week_start': '2026-09-07', 'week_end': '2026-09-13', 'shifts': [self.shift('Nguyen, Vova', '2026-09-07')]},
                {'week_start': '2026-09-14', 'week_end': '2026-09-20', 'shifts': [self.shift('Smith, Alex', '2026-09-20', role='CEL')]},
            ],
        }

    @staticmethod
    def shift(name, shift_date, role='Stylist'):
        return {'employee_name': name, 'primary_job': role, 'date': shift_date, 'start_time': '09:00', 'end_time': '17:00', 'role': role}

    def post(self, payload=None, *, authenticated=True):
        if authenticated:
            token = ScheduleSyncToken.for_user(self.user)
            token['organization_id'] = self.organization.id
            self.client.force_authenticate(self.user, token)
        else:
            self.client.force_authenticate(None)
        return self.client.post(self.url, self.payload if payload is None else payload, format='json')

    def authenticate_organization_admin(self):
        admin = get_user_model().objects.create_user(
            username='workbook-admin', password='password', is_staff=True)
        OrganizationMembership.objects.create(user=admin, organization=self.organization)
        self.client.force_authenticate(admin)
        return admin

    def test_requires_authenticated_user(self):
        self.assertEqual(self.post(authenticated=False).status_code, 401)

    def test_later_sync_replaces_a_manual_shift_time_edit(self):
        self.assertEqual(self.post().status_code, 200)
        shift = Shift.objects.get(employee__name='Nguyen, Vova')

        self.client.force_authenticate(self.user)
        edited = self.client.patch(
            reverse('shift_detail', args=[shift.id]),
            {'start_time': '09:15', 'end_time': '17:15'},
            format='json',
        )
        self.assertEqual(edited.status_code, 200, edited.data)
        shift.refresh_from_db()
        self.assertEqual(shift.start_time, time(9, 15))

        self.assertEqual(self.post().status_code, 200)
        replacement = Shift.objects.get(employee__name='Nguyen, Vova')
        self.assertEqual(replacement.start_time, time(9))
        self.assertEqual(replacement.end_time, time(17))

    def test_requires_organization_header(self):
        self.client.credentials()
        self.assertEqual(self.post().status_code, 400)

    def test_rejects_organization_without_membership(self):
        other = Organization.objects.create(name='Store Two')
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(other.id))
        self.assertEqual(self.post().status_code, 403)

    def test_rejects_user_access_jwt(self):
        self.client.force_authenticate(user=None)
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.user)}',
            HTTP_X_ORGANIZATION_ID=str(self.organization.id),
        )
        self.assertEqual(self.client.post(self.url, self.payload, format='json').status_code, 401)

    def test_accepts_single_current_week(self):
        self.payload['weeks'] = self.payload['weeks'][:1]
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['shifts_received'], 1)
        self.assertEqual(response.data['range_start'], '2026-09-07')
        self.assertEqual(response.data['range_end'], '2026-09-13')

    def test_import_preserves_source_role_for_configured_boh_time(self):
        self.payload['weeks'] = [{
            **self.payload['weeks'][0],
            'shifts': [{
                **self.shift('Closing Stylist', '2026-09-07', role='CEL'),
                'start_time': '16:30', 'end_time': '21:15',
            }],
        }]

        response = self.post()

        self.assertEqual(response.status_code, 200)
        imported = Shift.objects.get(employee__name='Closing Stylist')
        self.assertEqual(imported.role, 'CEL')

        workbook = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual(workbook.data['rows'][0]['role'], 'BOH')

    def test_parser_preserves_source_role_for_configured_boh_time(self):
        self.assertEqual(
            _normalize_role('CEL', time(16, 30), time(21, 15), primary_job='Management'),
            'CEL',
        )

    def test_rejects_malformed_incomplete_and_empty_payloads(self):
        bad_payloads = [
            {},
            {**self.payload, 'weeks': []},
            {**self.payload, 'weeks': [{**self.payload['weeks'][0], 'shifts': []}, self.payload['weeks'][1]]},
            {**self.payload, 'weeks': [{**self.payload['weeks'][0], 'week_start': '2026-09-08'}, self.payload['weeks'][1]]},
            {**self.payload, 'weeks': [{**self.payload['weeks'][0], 'week_end': '2026-09-12'}, self.payload['weeks'][1]]},
            {**self.payload, 'weeks': [{**self.payload['weeks'][0], 'shifts': [self.shift('', '2026-09-07')]}, self.payload['weeks'][1]]},
            {**self.payload, 'weeks': [{**self.payload['weeks'][0], 'shifts': [self.shift('A', '2026-09-14')]}, self.payload['weeks'][1]]},
        ]
        for payload in bad_payloads:
            with self.subTest(payload=payload):
                self.assertEqual(self.post(payload).status_code, 400)
        self.assertFalse(Shift.objects.exists())

    def test_rejects_more_than_5000_shifts(self):
        self.payload['weeks'] = [{
            **self.payload['weeks'][0],
            'shifts': [self.shift('Nguyen, Vova', '2026-09-07')] * 5001,
        }]
        response = self.post()
        self.assertEqual(response.status_code, 400)
        self.assertIn('too many shifts', response.data['error'])

    def test_preserves_duplicate_employee_date_and_start_as_occurrences(self):
        repeated = self.shift('Thompson, Sierra', '2026-09-13')
        self.payload['weeks'][0]['shifts'] = [repeated, repeated.copy()]
        first = self.post()
        self.assertEqual(first.status_code, 200)
        shifts = list(Shift.objects.filter(employee__name='Thompson, Sierra').order_by('occurrence'))
        self.assertEqual([shift.occurrence for shift in shifts], [0, 1])
        self.assertEqual(first.data['shifts_created'], 3)
        workbook = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Sun'})
        self.assertEqual([row['name'] for row in workbook.data['rows']], ['SIERRA', 'SIERRA'])

        second = self.post()
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data['shifts_created'], 0)
        self.assertEqual(Shift.objects.filter(employee__name='Thompson, Sierra').count(), 2)

    def test_workbook_names_default_from_both_kronos_name_orders_and_trim_whitespace(self):
        for name in ('Nguyen, Vova', '  Cher  '):
            employee = Employee.objects.create(organization=self.organization, name=name)
            Shift.objects.create(employee=employee, date=date(2026, 9, 7), start_time=time(9), end_time=time(17), role='Stylist')

        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual(response.status_code, 200)
        rows = {row['full_name'].strip(): row['name'] for row in response.data['rows']}
        self.assertEqual(rows['Nguyen, Vova'], 'VOVA')
        self.assertEqual(rows['Cher'], 'CHER')

        Employee.objects.filter(organization=self.organization).delete()
        employee = Employee.objects.create(organization=self.organization, name='Vova Nguyen')
        Shift.objects.create(employee=employee, date=date(2026, 9, 7), start_time=time(9), end_time=time(17), role='Stylist')
        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual(response.data['rows'][0]['name'], 'VOVA')

    def test_duplicate_default_workbook_names_are_disambiguated_by_last_initial(self):
        for name in ('Nguyen, Vova', 'Smith, Vova'):
            employee = Employee.objects.create(organization=self.organization, name=name)
            Shift.objects.create(employee=employee, date=date(2026, 9, 7), start_time=time(9), end_time=time(17), role='Stylist')

        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        rows = {row['full_name']: row['name'] for row in response.data['rows']}
        self.assertEqual(rows, {'Nguyen, Vova': 'VOVA N', 'Smith, Vova': 'VOVA S'})

    def test_stylist_zone_stays_stable_when_a_stronger_newcomer_arrives(self):
        alex = Employee.objects.create(organization=self.organization, name='Alex Nguyen')
        blair = Employee.objects.create(organization=self.organization, name='Blair Smith')
        Shift.objects.create(
            employee=alex, date=date(2026, 9, 7), start_time=time(9), end_time=time(11), role='Stylist')
        Shift.objects.create(
            employee=blair, date=date(2026, 9, 7), start_time=time(10), end_time=time(11), role='Stylist')
        StaffZone.objects.create(employee=alex, womens=2, mens=1, cash=3)
        blair_zones = StaffZone.objects.create(employee=blair, womens=2, mens=1)

        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        rows = {row['full_name']: row for row in response.data['rows']}
        self.assertEqual(rows['Alex Nguyen']['zones']['9'], 'WOMENS')
        self.assertEqual(rows['Alex Nguyen']['zones']['10'], 'WOMENS')
        self.assertEqual(rows['Blair Smith']['zones']['10'], 'MENS')

        # A stronger newcomer does not displace a valid continuing assignment.
        blair_zones.womens = 3
        blair_zones.save(update_fields=['womens'])
        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        rows = {row['full_name']: row for row in response.data['rows']}
        self.assertEqual(rows['Alex Nguyen']['zones']['10'], 'WOMENS')
        self.assertEqual(rows['Blair Smith']['zones']['10'], 'MENS')

    def test_preference_beats_skill_gap_when_coverage_remains_trained(self):
        alex = Employee.objects.create(organization=self.organization, name='Alex')
        blair = Employee.objects.create(organization=self.organization, name='Blair')
        shifts = [
            Shift.objects.create(
                employee=employee, date=date(2026, 9, 7), start_time=time(10),
                end_time=time(11), role='Stylist')
            for employee in (alex, blair)
        ]
        for shift in shifts:
            shift.effective_role = 'Stylist'
        alex_zones = StaffZone.objects.create(
            employee=alex, womens=1, mens=3, preferred_zone='womens')
        blair_zones = StaffZone.objects.create(employee=blair, womens=3, mens=1)

        assignments = _build_interval_assignments(
            shifts,
            {alex.id: alex_zones, blair.id: blair_zones},
            10 * 60,
        )

        self.assertEqual(assignments[10 * 60][alex.id], 'WOMENS')
        self.assertEqual(assignments[10 * 60][blair.id], 'MENS')

    def test_preference_yields_to_avoidable_zero_experience_coverage(self):
        alex = Employee.objects.create(organization=self.organization, name='Alex')
        blair = Employee.objects.create(organization=self.organization, name='Blair')
        shifts = [
            Shift.objects.create(
                employee=employee, date=date(2026, 9, 7), start_time=time(10),
                end_time=time(11), role='Stylist')
            for employee in (alex, blair)
        ]
        for shift in shifts:
            shift.effective_role = 'Stylist'
        alex_zones = StaffZone.objects.create(
            employee=alex, womens=1, mens=3, preferred_zone='womens')
        blair_zones = StaffZone.objects.create(employee=blair, womens=3, mens=0)

        assignments = _build_interval_assignments(
            shifts,
            {alex.id: alex_zones, blair.id: blair_zones},
            10 * 60,
        )

        self.assertEqual(assignments[10 * 60][alex.id], 'MENS')
        self.assertEqual(assignments[10 * 60][blair.id], 'WOMENS')

    def test_boh_preference_can_replace_lowest_priority_floor_slot(self):
        floor = Employee.objects.create(organization=self.organization, name='Floor')
        stock = Employee.objects.create(organization=self.organization, name='Stock')
        shifts = [
            Shift.objects.create(
                employee=employee, date=date(2026, 9, 7), start_time=time(10),
                end_time=time(11), role='Stylist')
            for employee in (floor, stock)
        ]
        for shift in shifts:
            shift.effective_role = 'Stylist'
        floor_zones = StaffZone.objects.create(employee=floor, womens=3, mens=3)
        stock_zones = StaffZone.objects.create(
            employee=stock, boh=2, preferred_zone='boh')

        assignments = _build_interval_assignments(
            shifts,
            {floor.id: floor_zones, stock.id: stock_zones},
            10 * 60,
        )

        self.assertEqual(assignments[10 * 60][floor.id], 'WOMENS')
        self.assertEqual(assignments[10 * 60][stock.id], 'BOH')

    def test_exact_quarter_hour_replacement_inherits_departing_zone(self):
        departing = Employee.objects.create(organization=self.organization, name='Departing')
        continuing = Employee.objects.create(organization=self.organization, name='Continuing')
        arriving = Employee.objects.create(organization=self.organization, name='Arriving')
        shifts = [
            Shift.objects.create(
                employee=departing, date=date(2026, 9, 7), start_time=time(16),
                end_time=time(16, 45), role='Stylist'),
            Shift.objects.create(
                employee=continuing, date=date(2026, 9, 7), start_time=time(16),
                end_time=time(17), role='Stylist'),
            Shift.objects.create(
                employee=arriving, date=date(2026, 9, 7), start_time=time(16, 45),
                end_time=time(17), role='Stylist'),
        ]
        for shift in shifts:
            shift.effective_role = 'Stylist'
        zones = {
            departing.id: StaffZone.objects.create(employee=departing, womens=3),
            continuing.id: StaffZone.objects.create(employee=continuing, mens=3),
            arriving.id: StaffZone.objects.create(employee=arriving, womens=1),
        }

        assignments = _build_interval_assignments(shifts, zones, 10 * 60)

        self.assertEqual(assignments[16 * 60 + 30][departing.id], 'WOMENS')
        self.assertEqual(assignments[16 * 60 + 30][continuing.id], 'MENS')
        self.assertNotIn(departing.id, assignments[16 * 60 + 45])
        self.assertEqual(assignments[16 * 60 + 45][arriving.id], 'WOMENS')
        self.assertEqual(assignments[16 * 60 + 45][continuing.id], 'MENS')

    def test_simultaneous_handoffs_keep_all_still_required_zones_covered(self):
        employees = {
            name: Employee.objects.create(organization=self.organization, name=name)
            for name in ('Womens Out', 'Mens Stay', 'Fits Out', 'Cash Stay', 'Womens In', 'Fits In')
        }
        shifts = []
        for name, start, end in (
            ('Womens Out', time(16), time(16, 45)),
            ('Mens Stay', time(16), time(17)),
            ('Fits Out', time(16), time(16, 45)),
            ('Cash Stay', time(16), time(17)),
            ('Womens In', time(16, 45), time(17)),
            ('Fits In', time(16, 45), time(17)),
        ):
            shift = Shift.objects.create(
                employee=employees[name], date=date(2026, 9, 7),
                start_time=start, end_time=end, role='Stylist')
            shift.effective_role = 'Stylist'
            shifts.append(shift)
        skills = {
            employees[name].id: StaffZone.objects.create(
                employee=employees[name], **{zone: 3})
            for name, zone in (
                ('Womens Out', 'womens'), ('Mens Stay', 'mens'),
                ('Fits Out', 'fits'), ('Cash Stay', 'cash'),
                ('Womens In', 'womens'), ('Fits In', 'fits'),
            )
        }

        assignments = _build_interval_assignments(shifts, skills, 10 * 60)
        handoff = assignments[16 * 60 + 45]

        self.assertEqual(handoff[employees['Womens In'].id], 'WOMENS')
        self.assertEqual(handoff[employees['Fits In'].id], 'FITS')
        self.assertEqual(handoff[employees['Mens Stay'].id], 'MENS')
        self.assertEqual(handoff[employees['Cash Stay'].id], 'CASH')

    def test_duplicate_preferences_create_only_one_extra_zone_slot_deterministically(self):
        first = Employee.objects.create(organization=self.organization, name='First')
        second = Employee.objects.create(organization=self.organization, name='Second')
        flexible = Employee.objects.create(organization=self.organization, name='Flexible')
        shifts = []
        for employee in (first, second, flexible):
            shift = Shift.objects.create(
                employee=employee, date=date(2026, 9, 7), start_time=time(10),
                end_time=time(11), role='Stylist')
            shift.effective_role = 'Stylist'
            shifts.append(shift)
        skills = {
            first.id: StaffZone.objects.create(
                employee=first, greet=3, preferred_zone='greet'),
            second.id: StaffZone.objects.create(
                employee=second, greet=3, preferred_zone='greet'),
            flexible.id: StaffZone.objects.create(
                employee=flexible, womens=3, mens=3, fits=3),
        }

        assignments = _build_interval_assignments(shifts, skills, 10 * 60)[10 * 60]

        self.assertEqual(list(assignments.values()).count('GREET'), 1)
        self.assertEqual(assignments[first.id], 'MENS')
        self.assertEqual(assignments[second.id], 'GREET')

    def test_short_priority_list_leaves_overflow_stylists_unzoned(self):
        shifts = []
        skills = {}
        for index in range(4):
            employee = Employee.objects.create(
                organization=self.organization, name=f'Short List {index}')
            shift = Shift.objects.create(
                employee=employee, date=date(2026, 9, 7), start_time=time(10),
                end_time=time(11), role='Stylist')
            shift.effective_role = 'Stylist'
            shifts.append(shift)
            skills[employee.id] = StaffZone.objects.create(
                employee=employee, womens=3, cash=3)

        assignments = _build_interval_assignments(
            shifts, skills, 10 * 60, ['womens', 'cash'])
        zones = list(assignments[10 * 60].values())

        self.assertEqual(sorted(zone for zone in zones if zone != 'STYLIST'), ['CASH', 'WOMENS'])
        self.assertEqual(zones.count('STYLIST'), 2)

    def test_twenty_priority_slots_match_twenty_active_stylists(self):
        slot_sequence = ['womens', 'mens', 'fits', 'cash', 'greet'] * 4
        shifts = []
        skills = {}
        for index, zone in enumerate(slot_sequence):
            employee = Employee.objects.create(
                organization=self.organization, name=f'Large Team {index:02d}')
            shift = Shift.objects.create(
                employee=employee, date=date(2026, 9, 7), start_time=time(10),
                end_time=time(11), role='Stylist')
            shift.effective_role = 'Stylist'
            shifts.append(shift)
            skills[employee.id] = StaffZone.objects.create(employee=employee, **{zone: 3})

        assignments = _build_interval_assignments(
            shifts, skills, 10 * 60, slot_sequence)[10 * 60]

        self.assertEqual(len(assignments), 20)
        self.assertNotIn('STYLIST', assignments.values())
        self.assertEqual(Counter(assignments.values()), Counter(zone.upper() for zone in slot_sequence))

    def test_quarter_hour_arrivals_fill_new_slots_without_changing_api_shape(self):
        starts = [time(10), time(10, 15), time(10, 30), time(10, 45)]
        names = ['Alex', 'Blair', 'Casey', 'Drew']
        skills = [
            {'womens': 3},
            {'mens': 3},
            {'fits': 3},
            {'cash': 3},
        ]
        for name, start_time, zone_skills in zip(names, starts, skills):
            employee = Employee.objects.create(organization=self.organization, name=name)
            Shift.objects.create(
                employee=employee,
                date=date(2026, 9, 7),
                start_time=start_time,
                end_time=time(11),
                role='Stylist',
            )
            StaffZone.objects.create(employee=employee, **zone_skills)

        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['hours'], list(range(8, 21)))
        self.assertEqual(len(response.data['col_headers']), 13)
        self.assertNotIn('intervals', response.data)
        rows = {row['full_name']: row for row in response.data['rows']}
        self.assertEqual(rows['Alex']['zones'], {'10': 'WOMENS'})
        self.assertEqual(rows['Blair']['zones'], {'10': 'MENS'})
        self.assertEqual(rows['Casey']['zones'], {'10': 'FITS'})
        self.assertEqual(rows['Drew']['zones'], {'10': 'CASH'})

        shifts = list(Shift.objects.filter(date=date(2026, 9, 7)).select_related('employee'))
        for shift in shifts:
            shift.effective_role = 'Stylist'
        staff_skill = {
            staff_zone.employee_id: staff_zone
            for staff_zone in StaffZone.objects.filter(employee__organization=self.organization)
        }
        assignments = _build_interval_assignments(shifts, staff_skill, 10 * 60)
        employee_ids = {shift.employee.name: shift.employee_id for shift in shifts}
        for interval_start in (10 * 60, 10 * 60 + 15, 10 * 60 + 30):
            self.assertEqual(assignments[interval_start][employee_ids['Alex']], 'WOMENS')
            self.assertNotIn(employee_ids['Drew'], assignments[interval_start])
        self.assertEqual(assignments[10 * 60 + 45][employee_ids['Drew']], 'CASH')

    def test_hourly_cell_uses_first_worked_quarter_when_zone_changes(self):
        employees = []
        for name, zone_skills, end_time in (
            ('Womens', {'womens': 3}, time(10, 15)),
            ('Mens', {'mens': 3}, time(11)),
            ('Fits', {'fits': 3}, time(11)),
            ('Cash', {'cash': 3}, time(11)),
        ):
            employee = Employee.objects.create(organization=self.organization, name=name)
            shift = Shift.objects.create(
                employee=employee,
                date=date(2026, 9, 7),
                start_time=time(10),
                end_time=end_time,
                role='Stylist',
            )
            shift.effective_role = 'Stylist'
            staff_zone = StaffZone.objects.create(employee=employee, **zone_skills)
            employees.append((shift, staff_zone))

        assignments = _build_interval_assignments(
            [shift for shift, _ in employees],
            {staff_zone.employee_id: staff_zone for _, staff_zone in employees},
            10 * 60,
        )
        cash_employee_id = next(
            shift.employee_id for shift, _ in employees if shift.employee.name == 'Cash'
        )
        self.assertEqual(assignments[10 * 60][cash_employee_id], 'CASH')
        self.assertEqual(assignments[10 * 60 + 15][cash_employee_id], 'WOMENS')

        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        rows = {row['full_name']: row for row in response.data['rows']}
        self.assertEqual(rows['Cash']['zones']['10'], 'CASH')

    def test_non_quarter_shift_uses_only_fully_covered_intervals(self):
        employee = Employee.objects.create(organization=self.organization, name='Partial Shift')
        shift = Shift.objects.create(
            employee=employee,
            date=date(2026, 9, 7),
            start_time=time(10, 10),
            end_time=time(10, 50),
            role='Stylist',
        )
        shift.effective_role = 'Stylist'
        staff_zone = StaffZone.objects.create(employee=employee, womens=3)

        assignments = _build_interval_assignments([shift], {employee.id: staff_zone}, 10 * 60)

        self.assertNotIn(employee.id, assignments[10 * 60])
        self.assertEqual(assignments[10 * 60 + 15][employee.id], 'WOMENS')
        self.assertEqual(assignments[10 * 60 + 30][employee.id], 'WOMENS')
        self.assertNotIn(employee.id, assignments[10 * 60 + 45])

    def test_cel_uses_eight_quarter_blocks_and_balances_minutes(self):
        shifts = []
        for name in ('Manager One', 'Manager Two'):
            employee = Employee.objects.create(organization=self.organization, name=name)
            shift = Shift.objects.create(
                employee=employee,
                date=date(2026, 9, 7),
                start_time=time(10),
                end_time=time(14),
                role='CEL',
            )
            shift.effective_role = 'CEL'
            shifts.append(shift)

        assignments = _build_interval_assignments(shifts, {}, 10 * 60)
        interval_starts = list(range(10 * 60, 14 * 60, 15))

        for interval_start in interval_starts:
            roles = [assignments[interval_start][shift.employee_id] for shift in shifts]
            self.assertEqual(sorted(roles), ['CEL', 'FLEX'])

        cel_sequences = [
            [assignments[interval_start][shift.employee_id] for interval_start in interval_starts]
            for shift in shifts
        ]
        self.assertEqual([sequence.count('CEL') for sequence in cel_sequences], [8, 8])
        self.assertTrue(all(
            sequence in (['CEL'] * 8 + ['FLEX'] * 8, ['FLEX'] * 8 + ['CEL'] * 8)
            for sequence in cel_sequences
        ))

    def test_manager_quarters_switch_from_task_to_cel_at_open(self):
        employee = Employee.objects.create(organization=self.organization, name='Opening Manager')
        shift = Shift.objects.create(
            employee=employee,
            date=date(2026, 9, 7),
            start_time=time(9, 15),
            end_time=time(10, 15),
            role='CEL',
        )
        shift.effective_role = 'CEL'

        assignments = _build_interval_assignments([shift], {}, 10 * 60)

        self.assertEqual(assignments[9 * 60 + 15][employee.id], 'TASK')
        self.assertEqual(assignments[9 * 60 + 30][employee.id], 'TASK')
        self.assertEqual(assignments[9 * 60 + 45][employee.id], 'TASK')
        self.assertEqual(assignments[10 * 60][employee.id], 'CEL')

    def test_exact_closing_shift_stays_boh_despite_associate_role_override(self):
        employee = Employee.objects.create(
            organization=self.organization, name='Closing Associate', role_override='associate')
        Shift.objects.create(
            employee=employee, date=date(2026, 9, 7), start_time=time(16, 30),
            end_time=time(21, 15), role='Stylist')

        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['rows'][0]['role'], 'BOH')
        self.assertEqual(set(response.data['rows'][0]['zones'].values()), {'BOH'})

    def test_two_to_six_forty_five_is_boh_by_default(self):
        employee = Employee.objects.create(organization=self.organization, name='Jessar')
        Shift.objects.create(
            employee=employee, date=date(2026, 9, 7), start_time=time(14),
            end_time=time(18, 45), role='Stylist')

        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})

        self.assertEqual(response.data['rows'][0]['role'], 'BOH')
        self.assertEqual(set(response.data['rows'][0]['zones'].values()), {'BOH'})

    def test_removing_boh_rule_restores_source_role_without_reimport(self):
        employee = Employee.objects.create(organization=self.organization, name='Jessar')
        Shift.objects.create(
            employee=employee, date=date(2026, 9, 7), start_time=time(14),
            end_time=time(18, 45), role='Stylist')
        StaffZone.objects.create(employee=employee, womens=3)
        self.organization.boh_shift_times = []
        self.organization.save(update_fields=['boh_shift_times'])

        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})

        self.assertEqual(response.data['rows'][0]['role'], 'Stylist')
        self.assertEqual(set(response.data['rows'][0]['zones'].values()), {'WOMENS'})

    def test_boh_rules_are_organization_specific(self):
        other = Organization.objects.create(name='Other Store', boh_shift_times=[])
        for organization, name in ((self.organization, 'Configured'), (other, 'Unconfigured')):
            employee = Employee.objects.create(organization=organization, name=name)
            Shift.objects.create(
                employee=employee, date=date(2026, 9, 7), start_time=time(14),
                end_time=time(18, 45), role='Stylist')
            StaffZone.objects.create(employee=employee, womens=3)

        configured = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual(configured.data['rows'][0]['role'], 'BOH')
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(other.id))
        OrganizationMembership.objects.create(user=self.user, organization=other)
        unconfigured = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual(unconfigured.data['rows'][0]['role'], 'Stylist')

    def test_custom_zone_priority_changes_first_stylist_slot(self):
        self.organization.zone_priority = [
            'CASH', 'MENS', 'FITS', 'WOMENS', 'FITS',
            'MENS', 'WOMENS', 'GREET', 'MENS', 'WOMENS', 'CASH', 'FITS',
        ]
        self.organization.save(update_fields=['zone_priority'])
        employee = Employee.objects.create(organization=self.organization, name='Cash First')
        Shift.objects.create(
            employee=employee, date=date(2026, 9, 7), start_time=time(10),
            end_time=time(11), role='Stylist')
        StaffZone.objects.create(employee=employee, cash=3)

        response = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})

        self.assertEqual(response.data['rows'][0]['zones']['10'], 'CASH')

    def test_explicit_workbook_name_is_uppercased_and_survives_schedule_sync(self):
        self.assertEqual(self.post().status_code, 200)
        employee = Employee.objects.get(name='Nguyen, Vova')
        StaffZone.objects.get_or_create(employee=employee)
        self.authenticate_organization_admin()

        patched = self.client.patch(
            reverse('staff_zone_update', args=[employee.id]),
            {'workbook_name': 'Vova V.'}, format='json')
        self.assertEqual(patched.status_code, 200)
        employee.refresh_from_db()
        self.assertEqual(employee.workbook_name, 'Vova V.')

        workbook = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual(workbook.data['rows'][0]['name'], 'VOVA V.')

        self.assertEqual(self.post().status_code, 200)
        employee.refresh_from_db()
        self.assertEqual(employee.workbook_name, 'Vova V.')

    def test_blank_workbook_name_resets_to_default(self):
        self.assertEqual(self.post().status_code, 200)
        employee = Employee.objects.get(name='Nguyen, Vova')
        StaffZone.objects.get_or_create(employee=employee)
        self.authenticate_organization_admin()
        url = reverse('staff_zone_update', args=[employee.id])
        self.assertEqual(self.client.patch(url, {'workbook_name': 'Vee'}, format='json').status_code, 200)
        reset = self.client.patch(url, {'workbook_name': '   '}, format='json')
        self.assertEqual(reset.status_code, 200)

        workbook = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual(workbook.data['rows'][0]['name'], 'VOVA')

    def test_workbook_name_patch_is_admin_only_and_organization_scoped(self):
        self.assertEqual(self.post().status_code, 200)
        employee = Employee.objects.get(name='Nguyen, Vova')
        StaffZone.objects.get_or_create(employee=employee)
        url = reverse('staff_zone_update', args=[employee.id])

        denied = self.client.patch(url, {'workbook_name': 'Vee'}, format='json')
        self.assertEqual(denied.status_code, 403)

        other = Organization.objects.create(name='Other Store')
        self.authenticate_organization_admin()
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(self.organization.id))
        self.assertEqual(self.client.patch(url, {'workbook_name': 'Vee'}, format='json').status_code, 200)

        foreign_employee = Employee.objects.create(organization=other, name='Other Employee')
        self.assertEqual(self.client.patch(
            reverse('staff_zone_update', args=[foreign_employee.id]),
            {'workbook_name': 'Foreign'}, format='json').status_code, 404)

    def test_employee_remove_is_admin_only_scoped_and_cascades_roster_data(self):
        employee = Employee.objects.create(organization=self.organization, name='Remove Me')
        StaffZone.objects.create(employee=employee)
        shift = Shift.objects.create(
            employee=employee, date=date(2026, 9, 8), start_time=time(8), end_time=time(9), role='Stylist')
        membership = OrganizationMembership.objects.get(user=self.user, organization=self.organization)
        membership.employee = employee
        membership.save(update_fields=['employee'])
        url = reverse('staff_zone_update', args=[employee.id])

        denied = self.client.delete(url)
        self.assertEqual(denied.status_code, 403)
        self.assertTrue(Employee.objects.filter(pk=employee.pk).exists())

        self.authenticate_organization_admin()
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(self.organization.id))
        removed = self.client.delete(url)
        self.assertEqual(removed.status_code, 204)
        self.assertFalse(Employee.objects.filter(pk=employee.pk).exists())
        self.assertFalse(StaffZone.objects.filter(employee_id=employee.pk).exists())
        self.assertFalse(Shift.objects.filter(pk=shift.pk).exists())
        membership.refresh_from_db()
        self.assertIsNone(membership.employee_id)

        other = Organization.objects.create(name='Other Organization')
        foreign_employee = Employee.objects.create(organization=other, name='Foreign Employee')
        not_found = self.client.delete(reverse('staff_zone_update', args=[foreign_employee.id]))
        self.assertEqual(not_found.status_code, 404)
        self.assertTrue(Employee.objects.filter(pk=foreign_employee.pk).exists())

    def test_replaces_only_covered_range(self):
        employee = Employee.objects.create(organization=self.organization, name='Old Person', primary_job='Old')
        stale = [
            Shift.objects.create(employee=employee, date=stale_date, start_time=time(8), end_time=time(9), role='Old')
            for stale_date in (date(2026, 9, 8), date(2026, 9, 13), date(2026, 9, 14), date(2026, 9, 20))
        ]
        outside = Shift.objects.create(employee=employee, date=date(2026, 9, 21), start_time=time(8), end_time=time(9), role='Keep')
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['ok'])
        self.assertEqual(response.data['shifts_created'], 2)
        self.assertEqual(response.data['shifts_deleted'], len(stale))
        self.assertFalse(Shift.objects.filter(pk__in=[shift.pk for shift in stale]).exists())
        self.assertTrue(Shift.objects.filter(pk=outside.pk).exists())
        self.assertEqual(
            set(Shift.objects.filter(date__range=(date(2026, 9, 7), date(2026, 9, 20)))
                .values_list('employee__name', 'date', 'start_time')),
            {('Nguyen, Vova', date(2026, 9, 7), time(9)), ('Smith, Alex', date(2026, 9, 20), time(9))},
        )
        self.assertEqual(response.data['range_start'], '2026-09-07')
        self.assertEqual(response.data['range_end'], '2026-09-20')
        self.assertEqual(len(response.data['payload_hash']), 64)
        self.assertIn('synced_at', response.data)

    def test_repeated_payload_is_idempotent(self):
        first = self.post()
        ids = list(Shift.objects.order_by('id').values_list('id', flat=True))
        override = WorkbookZoneOverride.objects.create(
            shift_id=ids[0], hour=9, zone='CASH', last_edited_by=self.user)
        second = self.post()
        self.assertEqual(first.data['payload_hash'], second.data['payload_hash'])
        self.assertEqual(second.data['shifts_created'], 0)
        self.assertEqual(second.data['shifts_updated'], 0)
        self.assertEqual(second.data['shifts_deleted'], 0)
        self.assertEqual(list(Shift.objects.order_by('id').values_list('id', flat=True)), ids)
        self.assertTrue(WorkbookZoneOverride.objects.filter(pk=override.pk, zone='CASH').exists())

    def test_write_failure_rolls_back_delete_and_creates(self):
        employee = Employee.objects.create(organization=self.organization, name='Existing')
        original = Shift.objects.create(employee=employee, date=date(2026, 9, 8), start_time=time(8), end_time=time(9), role='Old')
        real_get_or_create = Shift.objects.get_or_create
        calls = 0

        def fail_second(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError('simulated write failure')
            return real_get_or_create(*args, **kwargs)

        with patch.object(Shift.objects, 'get_or_create', side_effect=fail_second):
            with self.assertRaises(RuntimeError):
                self.post()
        self.assertEqual(Shift.objects.count(), 1)
        self.assertTrue(Shift.objects.filter(pk=original.pk, role='Old').exists())

    def test_manual_role_overrides_scrape_and_non_active_hides_shifts(self):
        self.payload['weeks'] = self.payload['weeks'][:1]
        self.assertEqual(self.post().status_code, 200)
        employee = Employee.objects.get(name='Nguyen, Vova')
        StaffZone.objects.get_or_create(employee=employee)
        staff_url = reverse('staff_zone_update', args=[employee.id])

        management = self.client.patch(staff_url, {'role_override': 'management'}, format='json')
        self.assertEqual(management.status_code, 200)
        self.assertEqual(management.data['role_override'], 'management')

        # A later scrape may update primary_job/shift role, but not manual choice.
        self.assertEqual(self.post().status_code, 200)
        workbook_url = reverse('workbook')
        workbook = self.client.get(workbook_url, {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual(workbook.data['rows'][0]['role'], 'CEL')

        inactive = self.client.patch(staff_url, {'role_override': 'non_active'}, format='json')
        self.assertEqual(inactive.status_code, 200)
        workbook = self.client.get(workbook_url, {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual(workbook.data['rows'], [])

        invalid = self.client.patch(staff_url, {'role_override': 'owner'}, format='json')
        self.assertEqual(invalid.status_code, 400)

    def test_preferred_zone_round_trips_and_rejects_unknown_values(self):
        employee = Employee.objects.create(organization=self.organization, name='Preference')
        StaffZone.objects.create(employee=employee)
        url = reverse('staff_zone_update', args=[employee.id])

        updated = self.client.patch(url, {'preferred_zone': 'boh'}, format='json')

        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data['preferred_zone'], 'boh')
        listed = self.client.get(reverse('staff_zones'))
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.data[0]['preferred_zone'], 'boh')
        self.assertEqual(
            self.client.patch(url, {'preferred_zone': 'office'}, format='json').status_code,
            400,
        )
        employee.zones.refresh_from_db()
        self.assertEqual(employee.zones.preferred_zone, 'boh')

    def test_preferred_zone_defaults_to_auto(self):
        employee = Employee.objects.create(organization=self.organization, name='Auto Preference')
        staff_zone = StaffZone.objects.create(employee=employee)
        self.assertEqual(staff_zone.preferred_zone, '')

    def test_same_employee_name_and_schedule_are_isolated_by_organization(self):
        other = Organization.objects.create(name='Store Two')
        OrganizationMembership.objects.create(user=self.user, organization=other)
        other_employee = Employee.objects.create(organization=other, name='Nguyen, Vova', primary_job='Other')
        Shift.objects.create(
            employee=other_employee, date=date(2026, 9, 7), start_time=time(8),
            end_time=time(10), role='BOH',
        )

        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(Employee.objects.filter(name='Nguyen, Vova').count(), 2)

        store_one = self.client.get(reverse('shift_list'))
        self.assertEqual(store_one.status_code, 200)
        self.assertEqual({row['role'] for row in store_one.data}, {'Stylist', 'CEL'})

        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(other.id))
        store_two = self.client.get(reverse('shift_list'))
        self.assertEqual(store_two.status_code, 200)
        self.assertEqual(len(store_two.data), 1)
        self.assertEqual(store_two.data[0]['employee_name'], 'Nguyen, Vova')
        self.assertEqual(store_two.data[0]['role'], 'BOH')

    def test_staff_patch_cannot_cross_organization_boundary(self):
        other = Organization.objects.create(name='Store Two')
        employee = Employee.objects.create(organization=other, name='Other Employee')
        StaffZone.objects.create(employee=employee)
        response = self.client.patch(
            reverse('staff_zone_update', args=[employee.id]), {'cash': 3}, format='json')
        self.assertEqual(response.status_code, 404)

    def test_my_schedule_requires_link_and_never_creates_sentinel_employee(self):
        self.payload['weeks'] = [{
            **self.payload['weeks'][0],
            'shifts': [self.shift('  MY SCHEDULE  ', '2026-09-07')],
        }]
        response = self.post()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'employee_link_required')
        self.assertFalse(Employee.objects.filter(name__iexact='my schedule').exists())

    def test_my_schedule_maps_to_linked_employee_and_keeps_old_history(self):
        membership = OrganizationMembership.objects.get(user=self.user, organization=self.organization)
        employee = Employee.objects.create(organization=self.organization, name='Vova Nguyen')
        membership.employee = employee
        membership.save(update_fields=['employee'])
        sentinel = Employee.objects.create(organization=self.organization, name='My Schedule')
        old_shift = Shift.objects.create(
            employee=sentinel, date=date(2026, 8, 31), start_time=time(9), end_time=time(17), role='Stylist')
        self.payload['weeks'] = [{
            **self.payload['weeks'][0],
            'shifts': [self.shift('My Schedule', '2026-09-07')],
        }]
        self.assertEqual(self.post().status_code, 200)
        self.assertTrue(Shift.objects.filter(employee=employee, date=date(2026, 9, 7)).exists())
        self.assertTrue(Shift.objects.filter(pk=old_shift.pk).exists())
        self.assertEqual(Employee.objects.filter(name__iexact='my schedule').count(), 1)

    def test_imports_from_two_users_keep_employee_identity_stable(self):
        user_two = get_user_model().objects.create_user(username='second-user', password='password')
        membership_one = OrganizationMembership.objects.get(user=self.user, organization=self.organization)
        membership_two = OrganizationMembership.objects.create(user=user_two, organization=self.organization)
        alice = Employee.objects.create(organization=self.organization, name='Alice Smith')
        bob = Employee.objects.create(organization=self.organization, name='Bob Jones')
        membership_one.employee = alice
        membership_one.save(update_fields=['employee'])
        membership_two.employee = bob
        membership_two.save(update_fields=['employee'])

        def payload(first_name, second_name):
            return {
                'source': 'kronos', 'timezone': 'America/Edmonton', 'synced_at': '2026-09-07T12:00:00-06:00',
                'weeks': [{
                    'week_start': '2026-09-07', 'week_end': '2026-09-13',
                    'shifts': [self.shift(first_name, '2026-09-07'), self.shift(second_name, '2026-09-08')],
                }],
            }

        self.assertEqual(self.post(payload('My Schedule', 'Jones, Bob')).status_code, 200)
        token = ScheduleSyncToken.for_user(user_two)
        token['organization_id'] = self.organization.id
        self.client.force_authenticate(user_two, token)
        response = self.client.post(self.url, payload('Smith, Alice', 'My Schedule'), format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(Employee.objects.filter(organization=self.organization).values_list('name', flat=True)), {'Alice Smith', 'Bob Jones'})
        self.assertEqual(Shift.objects.filter(employee=alice).count(), 1)
        self.assertEqual(Shift.objects.filter(employee=bob).count(), 1)


class CurrentEmployeeMappingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(username='vova', password='password')
        UserProfile.objects.create(user=self.user, full_name='Vova Nguyen')
        self.organization = Organization.objects.create(name='Identity Store')
        self.membership = OrganizationMembership.objects.create(user=self.user, organization=self.organization)
        self.client.force_authenticate(self.user)
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(self.organization.id))
        self.url = reverse('current_employee')

    def test_unique_normalized_name_auto_links_once(self):
        employee = Employee.objects.create(organization=self.organization, name='Nguyen, Vova')
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['auto_matched'])
        self.assertEqual(response.data['linked_employee']['id'], employee.id)
        self.user.profile.full_name = 'Completely Different Name'
        self.user.profile.save(update_fields=['full_name'])
        self.assertEqual(self.client.get(self.url).data['linked_employee']['id'], employee.id)

    def test_can_create_from_profile_then_user_link_is_locked(self):
        created = self.client.put(self.url, {'create_from_profile': True}, format='json')
        self.assertEqual(created.status_code, 200)
        employee = Employee.objects.get(pk=created.data['linked_employee']['id'])
        self.assertEqual(employee.name, 'Vova Nguyen')
        other = Employee.objects.create(organization=self.organization, name='Other Person')
        locked = self.client.put(self.url, {'employee_id': other.id}, format='json')
        self.assertEqual(locked.status_code, 409)
        self.assertEqual(locked.data['code'], 'employee_link_locked')

    def test_rejects_cross_organization_and_already_linked_employee(self):
        other_org = Organization.objects.create(name='Other Identity Store')
        foreign = Employee.objects.create(organization=other_org, name='Foreign Employee')
        self.assertEqual(self.client.put(self.url, {'employee_id': foreign.id}, format='json').status_code, 400)
        employee = Employee.objects.create(organization=self.organization, name='Taken Employee')
        other_user = get_user_model().objects.create_user(username='other')
        OrganizationMembership.objects.create(user=other_user, organization=self.organization, employee=employee)
        response = self.client.put(self.url, {'employee_id': employee.id}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'employee_already_linked')

    def test_ambiguous_normalized_names_do_not_auto_link(self):
        Employee.objects.create(organization=self.organization, name='Nguyen, Vova')
        Employee.objects.create(organization=self.organization, name='Vova Nguyen')
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data['linked_employee'])
        self.membership.refresh_from_db()
        self.assertIsNone(self.membership.employee_id)


class ScheduleSyncTicketSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(username='extension-user', password='password')
        self.organization = Organization.objects.create(name='Extension Store')
        self.membership = OrganizationMembership.objects.create(user=self.user, organization=self.organization)
        self.consent = KronosImportConsent.objects.create(
            user=self.user,
            organization=self.organization,
            policy_version='2026-09-16',
        )
        self.sync_url = reverse('schedule_sync')
        self.ticket_url = reverse('schedule_sync_ticket')
        self.payload = {
            'source': 'kronos',
            'timezone': 'America/Edmonton',
            'synced_at': '2026-09-10T09:00:00-06:00',
            'weeks': [{
                'week_start': '2026-09-07',
                'week_end': '2026-09-13',
                'shifts': [{
                    'employee_name': 'Thompson, Sierra',
                    'primary_job': 'Management',
                    'date': '2026-09-13',
                    'start_time': '09:00',
                    'end_time': '12:00',
                    'role': 'CEL',
                }],
            }],
        }

    def access_headers(self, organization=None):
        return {
            'HTTP_AUTHORIZATION': f'Bearer {AccessToken.for_user(self.user)}',
            'HTTP_X_ORGANIZATION_ID': str((organization or self.organization).id),
        }

    def sync_headers(self, token, organization=None):
        return {
            'HTTP_AUTHORIZATION': f'ScheduleSync {token}',
            'HTTP_X_ORGANIZATION_ID': str((organization or self.organization).id),
        }

    def issue_ticket(self):
        response = self.client.post(self.ticket_url, **self.access_headers())
        self.assertEqual(response.status_code, 200)
        return response.data['ticket']

    def test_ticket_is_five_minute_schedule_sync_token_scoped_to_organization(self):
        response = self.client.post(self.ticket_url, **self.access_headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['token_type'], 'ScheduleSync')
        self.assertEqual(response.data['expires_in'], 300)
        token = ScheduleSyncToken(response.data['ticket'])
        self.assertEqual(token['token_type'], 'schedule_sync')
        self.assertEqual(token['user_id'], str(self.user.id))
        self.assertEqual(token['organization_id'], self.organization.id)
        self.assertEqual(token['privacy_policy_version'], '2026-09-16')
        self.assertEqual(token['exp'] - token['iat'], 300)

    def test_current_privacy_consent_is_required_and_can_be_recorded(self):
        self.consent.delete()
        denied = self.client.post(self.ticket_url, {}, format='json', **self.access_headers())
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.data['code'], 'CONSENT_REQUIRED')
        accepted = self.client.post(self.ticket_url, {
            'consent': True,
            'privacy_policy_version': '2026-09-16',
        }, format='json', **self.access_headers())
        self.assertEqual(accepted.status_code, 200)
        self.assertTrue(KronosImportConsent.objects.filter(
            user=self.user,
            organization=self.organization,
            policy_version='2026-09-16',
        ).exists())

    def test_ticket_rejects_non_object_json(self):
        response = self.client.post(
            self.ticket_url, [], format='json', **self.access_headers())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'INVALID_REQUEST')

    def test_ticket_sync_succeeds(self):
        ticket = self.issue_ticket()
        response = self.client.post(
            self.sync_url, self.payload, format='json', **self.sync_headers(ticket))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['shifts_received'], 1)
        replay = self.client.post(
            self.sync_url, self.payload, format='json', **self.sync_headers(ticket))
        self.assertEqual(replay.status_code, 409)
        self.assertEqual(replay.data['code'], 'TICKET_REPLAYED')

    def test_access_token_cannot_call_sync_even_with_schedule_scheme(self):
        response = self.client.post(
            self.sync_url,
            self.payload,
            format='json',
            **self.sync_headers(AccessToken.for_user(self.user)),
        )
        self.assertEqual(response.status_code, 401)

    def test_schedule_ticket_cannot_call_normal_api(self):
        response = self.client.get(
            reverse('user_detail'),
            HTTP_AUTHORIZATION=f'ScheduleSync {self.issue_ticket()}',
        )
        self.assertEqual(response.status_code, 401)

    def test_expired_ticket_is_rejected(self):
        token = ScheduleSyncToken.for_user(self.user)
        token['organization_id'] = self.organization.id
        token.set_exp(from_time=datetime.now(timezone.utc) - timedelta(minutes=6))
        response = self.client.post(
            self.sync_url, self.payload, format='json', **self.sync_headers(token))
        self.assertEqual(response.status_code, 401)

    def test_wrong_organization_ticket_is_rejected(self):
        other = Organization.objects.create(name='Other Extension Store')
        OrganizationMembership.objects.create(user=self.user, organization=other)
        token = ScheduleSyncToken.for_user(self.user)
        token['organization_id'] = self.organization.id
        response = self.client.post(
            self.sync_url, self.payload, format='json', **self.sync_headers(token, other))
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Shift.objects.exists())

    def test_ticket_without_organization_claim_is_rejected(self):
        token = ScheduleSyncToken.for_user(self.user)
        response = self.client.post(
            self.sync_url, self.payload, format='json', **self.sync_headers(token))
        self.assertEqual(response.status_code, 403)

    def test_membership_is_rechecked_when_ticket_is_used(self):
        token = self.issue_ticket()
        self.membership.delete()
        response = self.client.post(
            self.sync_url, self.payload, format='json', **self.sync_headers(token))
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Shift.objects.exists())

    def test_inactive_user_ticket_is_rejected(self):
        token = self.issue_ticket()
        self.user.is_active = False
        self.user.save(update_fields=['is_active'])
        response = self.client.post(
            self.sync_url, self.payload, format='json', **self.sync_headers(token))
        self.assertEqual(response.status_code, 401)

    def test_ticket_issue_rejects_missing_membership_inactive_org_and_forced_password(self):
        self.membership.delete()
        self.assertEqual(self.client.post(self.ticket_url, **self.access_headers()).status_code, 403)

        self.membership = OrganizationMembership.objects.create(user=self.user, organization=self.organization)
        self.organization.is_active = False
        self.organization.save(update_fields=['is_active'])
        self.assertEqual(self.client.post(self.ticket_url, **self.access_headers()).status_code, 403)

        self.organization.is_active = True
        self.organization.save(update_fields=['is_active'])
        UserProfile.objects.create(user=self.user, full_name='Extension User', must_change_password=True)
        self.assertEqual(self.client.post(self.ticket_url, **self.access_headers()).status_code, 403)


class ShiftTimeUpdateTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='shift-editor', password='password')
        self.organization = Organization.objects.create(name='Shift Store')
        OrganizationMembership.objects.create(user=self.user, organization=self.organization)
        self.employee = Employee.objects.create(organization=self.organization, name='Alex Stylist')
        self.shift = Shift.objects.create(
            employee=self.employee,
            date=date(2026, 9, 7),
            start_time=time(9),
            end_time=time(12),
            role='Stylist',
        )
        StaffZone.objects.create(employee=self.employee, womens=3)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(self.organization.id))
        self.url = reverse('shift_detail', args=[self.shift.id])

    def test_updates_times_recalculates_workbook_and_removes_only_out_of_range_overrides(self):
        for hour in (9, 10, 11):
            WorkbookZoneOverride.objects.create(
                shift=self.shift, hour=hour, zone='CASH', last_edited_by=self.user)

        response = self.client.patch(
            self.url,
            {'start_time': '09:15', 'end_time': '10:30'},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.start_time, time(9, 15))
        self.assertEqual(self.shift.end_time, time(10, 30))
        self.assertEqual(
            set(self.shift.workbook_zone_overrides.values_list('hour', flat=True)),
            {9, 10},
        )
        workbook = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        row = workbook.data['rows'][0]
        self.assertEqual(row['shift'], '9:15-10:30')
        self.assertEqual(row['start_time'], '09:15')
        self.assertEqual(row['end_time'], '10:30')
        self.assertEqual(set(row['zones']), {'9', '10'})
        self.assertEqual(row['zone_overrides'], {'9': 'CASH', '10': 'CASH'})

    def test_rejects_invalid_payloads_without_changing_the_shift(self):
        payloads = [
            {'start_time': '09:15'},
            {'start_time': '09:15', 'end_time': '10:00', 'role': 'BOH'},
            {'start_time': 'nine', 'end_time': '10:00'},
            {'start_time': '09:07', 'end_time': '10:00'},
            {'start_time': '10:00', 'end_time': '10:00'},
            {'start_time': '11:00', 'end_time': '10:00'},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                response = self.client.patch(self.url, payload, format='json')
                self.assertEqual(response.status_code, 400)
                self.shift.refresh_from_db()
                self.assertEqual(self.shift.start_time, time(9))
                self.assertEqual(self.shift.end_time, time(12))

    def test_duplicate_start_time_is_rejected_atomically(self):
        Shift.objects.create(
            employee=self.employee,
            date=self.shift.date,
            start_time=time(11),
            end_time=time(13),
            role='Stylist',
        )
        override = WorkbookZoneOverride.objects.create(
            shift=self.shift, hour=9, zone='GREET', last_edited_by=self.user)

        response = self.client.patch(
            self.url,
            {'start_time': '11:00', 'end_time': '14:00'},
            format='json',
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'duplicate_shift')
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.start_time, time(9))
        self.assertEqual(self.shift.end_time, time(12))
        self.assertTrue(WorkbookZoneOverride.objects.filter(pk=override.pk).exists())

    def test_changing_start_time_reorders_workbook_rows(self):
        second_employee = Employee.objects.create(
            organization=self.organization, name='Blair Stylist')
        Shift.objects.create(
            employee=second_employee,
            date=self.shift.date,
            start_time=time(10),
            end_time=time(13),
            role='Stylist',
        )

        response = self.client.patch(
            self.url,
            {'start_time': '11:00', 'end_time': '14:00'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        workbook = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual([row['full_name'] for row in workbook.data['rows']], [
            'Blair Stylist', 'Alex Stylist',
        ])

    def test_requires_authentication_and_scopes_shift_to_the_selected_organization(self):
        other = Organization.objects.create(name='Other Shift Store')
        OrganizationMembership.objects.create(user=self.user, organization=other)
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(other.id))
        self.assertEqual(self.client.patch(
            self.url,
            {'start_time': '09:15', 'end_time': '12:15'},
            format='json',
        ).status_code, 404)

        self.client.force_authenticate(None)
        self.assertEqual(self.client.patch(
            self.url,
            {'start_time': '09:15', 'end_time': '12:15'},
            format='json',
        ).status_code, 401)

    def test_display_name_override_affects_only_that_shift_day_and_can_be_reset(self):
        self.employee.workbook_name = 'GLOBAL NAME'
        self.employee.save(update_fields=['workbook_name'])
        Shift.objects.create(
            employee=self.employee,
            date=date(2026, 9, 8),
            start_time=time(9),
            end_time=time(12),
            role='Stylist',
        )

        response = self.client.patch(
            self.url,
            {'display_name': '  day   name  '},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['workbook_name_override'], 'DAY NAME')
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.name, 'Alex Stylist')
        self.assertEqual(self.employee.workbook_name, 'GLOBAL NAME')

        monday = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        tuesday = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Tue'})
        self.assertEqual(monday.data['rows'][0]['name'], 'DAY NAME')
        self.assertEqual(monday.data['rows'][0]['name_override'], 'DAY NAME')
        self.assertEqual(tuesday.data['rows'][0]['name'], 'GLOBAL NAME')
        self.assertEqual(tuesday.data['rows'][0]['name_override'], '')

        reset = self.client.patch(self.url, {'display_name': ''}, format='json')
        self.assertEqual(reset.status_code, 200, reset.data)
        refreshed = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        self.assertEqual(refreshed.data['rows'][0]['name'], 'GLOBAL NAME')

    def test_rejects_invalid_display_name_values(self):
        for display_name in (None, 42, 'bad\nname', 'x' * 65):
            with self.subTest(display_name=display_name):
                response = self.client.patch(
                    self.url,
                    {'display_name': display_name},
                    format='json',
                )
                self.assertEqual(response.status_code, 400)
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.workbook_name_override, '')


class WorkbookZoneOverrideTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='zone-editor', password='password')
        self.organization = Organization.objects.create(name='Zone Store')
        OrganizationMembership.objects.create(user=self.user, organization=self.organization)
        self.employee = Employee.objects.create(organization=self.organization, name='Alex Stylist')
        self.shift = Shift.objects.create(
            employee=self.employee, date=date(2026, 9, 7), start_time=time(9), end_time=time(12), role='Stylist')
        StaffZone.objects.create(employee=self.employee, womens=3)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(self.organization.id))
        self.url = reverse('workbook_zone_overrides', args=['2026-09-07'])

    def test_bulk_set_is_deduplicated_audited_and_returned_by_workbook(self):
        response = self.client.patch(self.url, {
            'set': {
                'zone': 'CASH',
                'cells': [
                    {'shift_id': self.shift.id, 'hour': 9},
                    {'shift_id': self.shift.id, 'hour': 10},
                    {'shift_id': self.shift.id, 'hour': 10},
                ],
            },
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(WorkbookZoneOverride.objects.count(), 2)
        self.assertEqual(
            set(WorkbookZoneOverride.objects.values_list('hour', 'zone', 'last_edited_by_id')),
            {(9, 'CASH', self.user.id), (10, 'CASH', self.user.id)},
        )
        workbook = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})
        row = workbook.data['rows'][0]
        self.assertEqual(row['shift_id'], self.shift.id)
        self.assertEqual(row['zones']['9'], 'WOMENS')
        self.assertEqual(row['zone_overrides'], {'9': 'CASH', '10': 'CASH'})

    def test_manual_override_remains_visible_over_generated_boh(self):
        self.shift.start_time = time(14)
        self.shift.end_time = time(18, 45)
        self.shift.save(update_fields=['start_time', 'end_time'])
        WorkbookZoneOverride.objects.create(
            shift=self.shift, hour=14, zone='CASH', last_edited_by=self.user)

        workbook = self.client.get(reverse('workbook'), {'week_start': '2026-09-07', 'day': 'Mon'})

        row = workbook.data['rows'][0]
        self.assertEqual(row['zones']['14'], 'BOH')
        self.assertEqual(row['zone_overrides']['14'], 'CASH')

    def test_selected_clear_and_whole_day_reset_restore_generated_zones(self):
        for hour in (9, 10):
            WorkbookZoneOverride.objects.create(shift=self.shift, hour=hour, zone='MENS', last_edited_by=self.user)

        cleared = self.client.patch(self.url, {
            'clear': {'cells': [{'shift_id': self.shift.id, 'hour': 9}]},
        }, format='json')
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(cleared.data['overrides'], [
            {'shift_id': self.shift.id, 'hour': 10, 'zone': 'MENS'},
        ])

        reset = self.client.patch(self.url, {'reset_all': True}, format='json')
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.data['overrides'], [])
        self.assertFalse(WorkbookZoneOverride.objects.exists())


class WorkbookPromoRowsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='promo-editor', password='password')
        self.organization = Organization.objects.create(name='Promo Store')
        OrganizationMembership.objects.create(user=self.user, organization=self.organization)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(self.organization.id))
        self.url = reverse('workbook_promo_rows', args=['2026-09-23'])

    def test_reads_empty_list_and_saves_shared_rows_across_dates(self):
        initial = self.client.get(self.url)
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(initial.data['rows'], [])
        self.assertEqual(initial.data['source'], 'shared')

        saved = self.client.patch(self.url, {'scope': 'shared', 'rows': ['Promo A', 'Note B']}, format='json')
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data['rows'], ['Promo A', 'Note B'])
        next_date = self.client.get(reverse('workbook_promo_rows', args=['2026-09-30']))
        self.assertEqual(next_date.data['rows'], ['Promo A', 'Note B'])

    def test_day_override_wins_and_shared_edits_preserve_all_overrides(self):
        WorkbookPromoRows.objects.create(organization=self.organization, rows=['Shared old'])
        WorkbookPromoDayOverride.objects.create(
            organization=self.organization, business_date=date(2026, 9, 23), rows=['Today only'],
        )
        saved = self.client.patch(self.url, {'scope': 'shared', 'rows': ['Shared new']}, format='json')
        self.assertEqual(saved.data['rows'], ['Today only'])
        self.assertEqual(saved.data['shared_rows'], ['Shared new'])
        self.assertTrue(saved.data['has_override'])
        self.assertEqual(
            WorkbookPromoDayOverride.objects.get(organization=self.organization).rows,
            ['Today only'],
        )

        reset = self.client.delete(self.url)
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.data['rows'], ['Shared new'])
        self.assertFalse(reset.data['has_override'])

    def test_rejects_invalid_payload_without_partial_write(self):
        too_long = 'x' * 241
        response = self.client.patch(self.url, {'scope': 'shared', 'rows': ['Valid', too_long]}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(WorkbookPromoRows.objects.exists())
        self.assertEqual(self.client.patch(self.url, {'scope': 'week', 'rows': []}, format='json').status_code, 400)

    def test_requires_membership_in_selected_organization(self):
        other = Organization.objects.create(name='Other Promo Store')
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(other.id))
        self.assertEqual(self.client.get(self.url).status_code, 403)


class WorkbookZoneOverrideSecurityTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='zone-security-editor', password='password')
        self.organization = Organization.objects.create(name='Zone Security Store')
        OrganizationMembership.objects.create(user=self.user, organization=self.organization)
        self.employee = Employee.objects.create(organization=self.organization, name='Alex Stylist')
        self.shift = Shift.objects.create(
            employee=self.employee, date=date(2026, 9, 7), start_time=time(9), end_time=time(12), role='Stylist')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.client.credentials(HTTP_X_ORGANIZATION_ID=str(self.organization.id))
        self.url = reverse('workbook_zone_overrides', args=['2026-09-07'])

    def test_invalid_mixed_batch_is_atomic_and_organization_scoped(self):
        other = Organization.objects.create(name='Other Zone Store')
        foreign_employee = Employee.objects.create(organization=other, name='Foreign Stylist')
        foreign_shift = Shift.objects.create(
            employee=foreign_employee, date=date(2026, 9, 7), start_time=time(9), end_time=time(12), role='Stylist')
        response = self.client.patch(self.url, {
            'set': {
                'zone': 'CASH',
                'cells': [
                    {'shift_id': self.shift.id, 'hour': 9},
                    {'shift_id': foreign_shift.id, 'hour': 9},
                ],
            },
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(WorkbookZoneOverride.objects.exists())

    def test_rejects_invalid_zone_hour_blank_cell_and_multiple_operations(self):
        payloads = [
            {'set': {'zone': 'UNKNOWN', 'cells': [{'shift_id': self.shift.id, 'hour': 9}]}},
            {'set': {'zone': 'CASH', 'cells': [{'shift_id': self.shift.id, 'hour': 21}]}},
            {'set': {'zone': 'CASH', 'cells': [{'shift_id': self.shift.id, 'hour': 8}]}},
            {'set': {'zone': 'CASH', 'cells': [{'shift_id': self.shift.id, 'hour': 9}]}, 'reset_all': True},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                self.assertEqual(self.client.patch(self.url, payload, format='json').status_code, 400)
        self.assertFalse(WorkbookZoneOverride.objects.exists())

    def test_override_survives_same_shift_update_and_cascades_when_shift_removed(self):
        override = WorkbookZoneOverride.objects.create(
            shift=self.shift, hour=9, zone='GREET', last_edited_by=self.user)
        self.shift.end_time = time(13)
        self.shift.save(update_fields=['end_time'])
        self.assertTrue(WorkbookZoneOverride.objects.filter(pk=override.pk).exists())
        self.shift.delete()
        self.assertFalse(WorkbookZoneOverride.objects.filter(pk=override.pk).exists())
