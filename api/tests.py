from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import (
    DEFAULT_BOH_SHIFT_TIMES, DEFAULT_ZONE_PRIORITY, Organization,
    OrganizationMembership, UserProfile,
)

User = get_user_model()


class AuthContractTests(APITestCase):
    def test_public_registration_endpoint_is_removed(self):
        response = self.client.post('/api/auth/register/', {
            'username': 'self-service', 'password': 'Long-Random-Password-427!',
        }, format='json')
        self.assertEqual(response.status_code, 404)
        self.assertFalse(User.objects.filter(username='self-service').exists())

    def test_user_detail_exposes_active_memberships_and_password_change_flag(self):
        user = User.objects.create_user(username='member', password='Old-Password-427!')
        UserProfile.objects.create(user=user, full_name='Store Member', must_change_password=True)
        active = Organization.objects.create(name='Active Store')
        inactive = Organization.objects.create(name='Closed Store', is_active=False)
        OrganizationMembership.objects.create(user=user, organization=active)
        OrganizationMembership.objects.create(user=user, organization=inactive)
        self.client.force_authenticate(user)
        response = self.client.get('/api/auth/user/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['must_change_password'])
        self.assertEqual([org['id'] for org in response.data['organizations']], [active.id])

    def test_required_password_change_clears_flag_and_changes_password(self):
        user = User.objects.create_user(username='member', password='Old-Password-427!')
        UserProfile.objects.create(user=user, full_name='Store Member', must_change_password=True)
        self.client.force_authenticate(user)
        response = self.client.post('/api/auth/change-password/', {
            'current_password': 'Old-Password-427!',
            'new_password': 'New-Password-852!', 'new_password2': 'New-Password-852!',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password('New-Password-852!'))
        self.assertFalse(user.profile.must_change_password)


class AdminApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', password='Admin-Password-427!', is_staff=True)
        UserProfile.objects.create(user=self.admin, full_name='Administrator')
        self.member = User.objects.create_user(username='member', password='Member-Password-427!')
        UserProfile.objects.create(user=self.member, full_name='Member')
        self.client.force_authenticate(self.admin)

    def test_admin_endpoints_reject_non_admins(self):
        self.client.force_authenticate(self.member)
        for url in ['/api/admin/organizations/', '/api/admin/users/']:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 403)

    def test_admin_can_create_list_and_deactivate_organization(self):
        created = self.client.post('/api/admin/organizations/', {'name': 'North Store'}, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['boh_shift_times'], DEFAULT_BOH_SHIFT_TIMES)
        self.assertEqual(created.data['zone_priority'], DEFAULT_ZONE_PRIORITY)
        self.assertEqual(created.data['zone_priority'].count('CASH'), 2)
        self.assertEqual(created.data['zone_priority'].count('FITS'), 3)
        listed = self.client.get('/api/admin/organizations/')
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.data[0]['member_count'], 0)
        deactivated = self.client.patch(
            f"/api/admin/organizations/{created.data['id']}/", {'is_active': False}, format='json')
        self.assertEqual(deactivated.status_code, 200)
        self.assertFalse(Organization.objects.get(pk=created.data['id']).is_active)

    def test_admin_can_update_floor_map_rules(self):
        organization = Organization.objects.create(name='Rules Store')
        priority = ['CASH', 'GREET', 'CASH']

        response = self.client.patch(f'/api/admin/organizations/{organization.id}/', {
            'boh_shift_times': [{'start': '13:30', 'end': '18:00'}],
            'zone_priority': priority,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        organization.refresh_from_db()
        self.assertEqual(organization.boh_shift_times, [{'start': '13:30', 'end': '18:00'}])
        self.assertEqual(organization.zone_priority, priority)

    def test_floor_map_rule_validation_rejects_bad_times_and_zone_slots(self):
        organization = Organization.objects.create(name='Rules Store')
        invalid_payloads = [
            {'boh_shift_times': [{'start': '2:00', 'end': '18:45'}]},
            {'boh_shift_times': [{'start': '18:45', 'end': '14:00'}]},
            {'boh_shift_times': [
                {'start': '14:00', 'end': '18:45'},
                {'start': '14:00', 'end': '18:45'},
            ]},
            {'zone_priority': []},
            {'zone_priority': ['WOMENS'] * 21},
            {'zone_priority': [{}, *DEFAULT_ZONE_PRIORITY[1:]]},
            {'zone_priority': ['BOH']},
            {'zone_priority': ['womens']},
        ]

        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self.client.patch(
                    f'/api/admin/organizations/{organization.id}/', payload, format='json')
                self.assertEqual(response.status_code, 400)

        organization.refresh_from_db()
        self.assertEqual(organization.boh_shift_times, DEFAULT_BOH_SHIFT_TIMES)
        self.assertEqual(organization.zone_priority, DEFAULT_ZONE_PRIORITY)

    def test_zone_priority_accepts_one_to_twenty_supported_slots(self):
        organization = Organization.objects.create(name='Flexible Rules Store')

        for priority in (['GREET'], ['CASH'] * 20):
            with self.subTest(slot_count=len(priority)):
                response = self.client.patch(
                    f'/api/admin/organizations/{organization.id}/',
                    {'zone_priority': priority},
                    format='json',
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data['zone_priority'], priority)

    def test_admin_provisions_user_with_memberships_and_forced_password_change(self):
        first = Organization.objects.create(name='First Store')
        second = Organization.objects.create(name='Second Store')
        response = self.client.post('/api/admin/users/', {
            'username': 'new-user', 'email': 'new@example.com', 'full_name': 'New User',
            'temporary_password': 'Temporary-Password-427!',
            'organization_ids': [first.id, second.id],
        }, format='json')
        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username='new-user')
        self.assertTrue(user.profile.must_change_password)
        self.assertEqual(user.profile.full_name, 'New User')
        self.assertEqual(set(user.organization_memberships.values_list('organization_id', flat=True)), {first.id, second.id})

    def test_admin_can_grant_admin_permission_when_provisioning_user(self):
        organization = Organization.objects.create(name='Admin Store')
        response = self.client.post('/api/admin/users/', {
            'username': 'new-admin', 'full_name': 'New Administrator',
            'temporary_password': 'Temporary-Password-427!',
            'organization_ids': [organization.id], 'is_admin': True,
        }, format='json')
        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username='new-admin')
        self.assertTrue(user.is_staff)
        self.assertTrue(response.data['is_admin'])

    def test_admin_can_update_another_users_admin_permission(self):
        response = self.client.patch(
            f'/api/admin/users/{self.member.id}/', {'is_admin': True}, format='json')
        self.assertEqual(response.status_code, 200)
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_staff)

    def test_admin_cannot_remove_own_admin_permission(self):
        response = self.client.patch(
            f'/api/admin/users/{self.admin.id}/', {'is_admin': False}, format='json')
        self.assertEqual(response.status_code, 400)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_staff)

    def test_admin_user_list_can_filter_by_organization_id(self):
        first = Organization.objects.create(name='First Store')
        second = Organization.objects.create(name='Second Store')
        OrganizationMembership.objects.create(user=self.member, organization=first)

        second_user = User.objects.create_user(username='second-member', password='Second-Password-427!')
        UserProfile.objects.create(user=second_user, full_name='Second Member')
        OrganizationMembership.objects.create(user=second_user, organization=second)

        both_user = User.objects.create_user(username='both-member', password='Both-Password-427!')
        UserProfile.objects.create(user=both_user, full_name='Both Member')
        OrganizationMembership.objects.create(user=both_user, organization=first)
        OrganizationMembership.objects.create(user=both_user, organization=second)

        first_response = self.client.get('/api/admin/users/', {'organization_id': first.id})
        self.assertEqual(first_response.status_code, 200)
        self.assertEqual({row['username'] for row in first_response.data}, {'member', 'both-member'})

        second_response = self.client.get('/api/admin/users/', {'organization_id': second.id})
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual({row['username'] for row in second_response.data}, {'second-member', 'both-member'})

    def test_admin_can_change_memberships_and_deactivate_user(self):
        first = Organization.objects.create(name='First Store')
        second = Organization.objects.create(name='Second Store')
        OrganizationMembership.objects.create(user=self.member, organization=first)
        response = self.client.patch(f'/api/admin/users/{self.member.id}/', {
            'is_active': False, 'organization_ids': [second.id],
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.member.refresh_from_db()
        self.assertFalse(self.member.is_active)
        self.assertEqual(list(self.member.organization_memberships.values_list('organization_id', flat=True)), [second.id])

    def test_admin_cannot_deactivate_self(self):
        response = self.client.patch(f'/api/admin/users/{self.admin.id}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 400)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_admin_reset_password_forces_change(self):
        response = self.client.post(f'/api/admin/users/{self.member.id}/reset-password/', {
            'temporary_password': 'Reset-Password-852!',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.member.refresh_from_db()
        self.assertTrue(self.member.check_password('Reset-Password-852!'))
        self.assertTrue(self.member.profile.must_change_password)

    def test_membership_crud_is_idempotent(self):
        organization = Organization.objects.create(name='First Store')
        url = f'/api/admin/organizations/{organization.id}/members/'
        self.assertEqual(self.client.post(url, {'user_id': self.member.id}, format='json').status_code, 201)
        self.assertEqual(self.client.post(url, {'user_id': self.member.id}, format='json').status_code, 200)
        self.assertEqual(OrganizationMembership.objects.count(), 1)
        self.assertEqual(self.client.delete(f'{url}{self.member.id}/').status_code, 204)
        self.assertFalse(OrganizationMembership.objects.exists())

    def test_admin_can_correct_employee_link_and_cross_org_is_rejected(self):
        from schedule.models import Employee
        organization = Organization.objects.create(name='First Store')
        other = Organization.objects.create(name='Second Store')
        membership = OrganizationMembership.objects.create(user=self.member, organization=organization)
        employee = Employee.objects.create(organization=organization, name='Correct Employee')
        foreign = Employee.objects.create(organization=other, name='Wrong Store Employee')
        url = f'/api/admin/organizations/{organization.id}/members/{self.member.id}/'
        self.assertEqual(self.client.patch(url, {'employee_id': foreign.id}, format='json').status_code, 400)
        linked = self.client.patch(url, {'employee_id': employee.id}, format='json')
        self.assertEqual(linked.status_code, 200)
        membership.refresh_from_db()
        self.assertEqual(membership.employee_id, employee.id)
        listed = self.client.get('/api/admin/users/')
        member_data = next(row for row in listed.data if row['id'] == self.member.id)
        self.assertEqual(member_data['organizations'][0]['employee_id'], employee.id)
        candidates = self.client.get(f'/api/admin/organizations/{organization.id}/members/')
        self.assertEqual(candidates.data['employees'][0]['id'], employee.id)
        self.assertEqual(self.client.patch(url, {'employee_id': None}, format='json').status_code, 200)

    def test_membership_updates_preserve_existing_employee_link(self):
        from schedule.models import Employee
        first = Organization.objects.create(name='First Store')
        second = Organization.objects.create(name='Second Store')
        employee = Employee.objects.create(organization=first, name='Linked Employee')
        membership = OrganizationMembership.objects.create(user=self.member, organization=first, employee=employee)
        response = self.client.patch(f'/api/admin/users/{self.member.id}/', {
            'organization_ids': [first.id, second.id],
        }, format='json')
        self.assertEqual(response.status_code, 200)
        membership.refresh_from_db()
        self.assertEqual(membership.employee_id, employee.id)
