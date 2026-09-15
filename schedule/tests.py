from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.models import Organization, OrganizationMembership, UserProfile
from .models import Employee, KronosImportConsent, Shift, StaffZone
from .authentication import ScheduleSyncToken


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

    def test_replaces_only_covered_range(self):
        employee = Employee.objects.create(organization=self.organization, name='Old Person', primary_job='Old')
        stale = Shift.objects.create(employee=employee, date=date(2026, 9, 8), start_time=time(8), end_time=time(9), role='Old')
        outside = Shift.objects.create(employee=employee, date=date(2026, 9, 21), start_time=time(8), end_time=time(9), role='Keep')
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['ok'])
        self.assertEqual(response.data['shifts_created'], 2)
        self.assertEqual(response.data['shifts_deleted'], 1)
        self.assertFalse(Shift.objects.filter(pk=stale.pk).exists())
        self.assertTrue(Shift.objects.filter(pk=outside.pk).exists())
        self.assertEqual(response.data['range_start'], '2026-09-07')
        self.assertEqual(response.data['range_end'], '2026-09-20')
        self.assertEqual(len(response.data['payload_hash']), 64)
        self.assertIn('synced_at', response.data)

    def test_repeated_payload_is_idempotent(self):
        first = self.post()
        ids = list(Shift.objects.order_by('id').values_list('id', flat=True))
        second = self.post()
        self.assertEqual(first.data['payload_hash'], second.data['payload_hash'])
        self.assertEqual(second.data['shifts_created'], 0)
        self.assertEqual(second.data['shifts_updated'], 0)
        self.assertEqual(second.data['shifts_deleted'], 0)
        self.assertEqual(list(Shift.objects.order_by('id').values_list('id', flat=True)), ids)

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
            policy_version='2026-09-15',
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
        self.assertEqual(token['privacy_policy_version'], '2026-09-15')
        self.assertEqual(token['exp'] - token['iat'], 300)

    def test_current_privacy_consent_is_required_and_can_be_recorded(self):
        self.consent.delete()
        denied = self.client.post(self.ticket_url, {}, format='json', **self.access_headers())
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.data['code'], 'CONSENT_REQUIRED')
        accepted = self.client.post(self.ticket_url, {
            'consent': True,
            'privacy_policy_version': '2026-09-15',
        }, format='json', **self.access_headers())
        self.assertEqual(accepted.status_code, 200)
        self.assertTrue(KronosImportConsent.objects.filter(
            user=self.user,
            organization=self.organization,
            policy_version='2026-09-15',
        ).exists())

    def test_ticket_sync_succeeds(self):
        response = self.client.post(
            self.sync_url, self.payload, format='json', **self.sync_headers(self.issue_ticket()))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['shifts_received'], 1)

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
