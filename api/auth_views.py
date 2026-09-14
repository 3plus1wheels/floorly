from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import ValidationError

from .auth_serializers import AdminUserSerializer, ChangePasswordSerializer, OrganizationSerializer, ResetPasswordSerializer, ThemePreferenceSerializer, UserSerializer
from .models import Organization, OrganizationMembership, ThemePreference, UserProfile

User = get_user_model()


class UserDetailView(APIView):
    permission_classes = (IsAuthenticated,)
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    permission_classes = (IsAuthenticated,)
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({'ok': True})


class ThemePreferenceView(APIView):
    permission_classes = (IsAuthenticated,)
    def get(self, request):
        preference, _ = ThemePreference.objects.get_or_create(user=request.user)
        return Response(ThemePreferenceSerializer(preference).data)
    def put(self, request):
        preference, _ = ThemePreference.objects.get_or_create(user=request.user)
        serializer = ThemePreferenceSerializer(preference, data=request.data, partial=request.method == 'PATCH')
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
    patch = put


class AdminOrganizationListCreateView(generics.ListCreateAPIView):
    permission_classes = (IsAdminUser,)
    serializer_class = OrganizationSerializer
    pagination_class = None
    def get_queryset(self):
        return Organization.objects.annotate(member_count=Count('memberships')).order_by('name')


class AdminOrganizationDetailView(generics.RetrieveUpdateAPIView):
    permission_classes = (IsAdminUser,)
    serializer_class = OrganizationSerializer
    queryset = Organization.objects.annotate(member_count=Count('memberships'))
    http_method_names = ['get', 'patch', 'head', 'options']


class AdminMembershipView(APIView):
    permission_classes = (IsAdminUser,)
    def get(self, request, organization_id):
        from schedule.models import Employee
        organization = get_object_or_404(Organization, pk=organization_id)
        employees = Employee.objects.filter(organization=organization).order_by('name')
        return Response({'employees': [
            {'id': employee.id, 'name': employee.name, 'primary_job': employee.primary_job}
            for employee in employees
        ]})
    def post(self, request, organization_id):
        organization = get_object_or_404(Organization, pk=organization_id)
        user = get_object_or_404(User, pk=request.data.get('user_id'))
        _, created = OrganizationMembership.objects.get_or_create(user=user, organization=organization)
        return Response({'ok': True}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
    def delete(self, request, organization_id, user_id):
        membership = get_object_or_404(OrganizationMembership, organization_id=organization_id, user_id=user_id)
        membership.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    def patch(self, request, organization_id, user_id):
        membership = get_object_or_404(
            OrganizationMembership.objects.select_related('employee'),
            organization_id=organization_id, user_id=user_id,
        )
        if 'employee_id' not in request.data:
            return Response({'detail': 'employee_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        employee_id = request.data.get('employee_id')
        if employee_id is None:
            membership.employee = None
            membership.save(update_fields=['employee'])
            return Response({'employee_id': None, 'employee_name': None})
        try:
            employee_id = int(employee_id)
        except (TypeError, ValueError):
            return Response({'detail': 'employee_id must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)
        from schedule.models import Employee
        employee = Employee.objects.filter(pk=employee_id, organization_id=organization_id).first()
        if employee is None:
            return Response({'detail': 'Employee does not belong to this organization.'}, status=status.HTTP_400_BAD_REQUEST)
        if OrganizationMembership.objects.filter(employee=employee).exclude(pk=membership.pk).exists():
            return Response({'code': 'employee_already_linked', 'detail': 'Employee is already linked to another account.'}, status=status.HTTP_409_CONFLICT)
        try:
            with transaction.atomic():
                membership.employee = employee
                membership.save(update_fields=['employee'])
        except IntegrityError:
            return Response({'code': 'employee_already_linked', 'detail': 'Employee is already linked to another account.'}, status=status.HTTP_409_CONFLICT)
        return Response({'employee_id': employee.id, 'employee_name': employee.name})


class AdminUserListCreateView(generics.ListCreateAPIView):
    permission_classes = (IsAdminUser,)
    serializer_class = AdminUserSerializer
    pagination_class = None
    def get_queryset(self):
        queryset = User.objects.prefetch_related('organization_memberships__organization', 'organization_memberships__employee').order_by('username')
        organization_id = self.request.query_params.get('organization_id')
        if organization_id is not None:
            try:
                organization_id = int(organization_id)
            except (TypeError, ValueError) as exc:
                raise ValidationError({'organization_id': 'Must be a positive integer.'}) from exc
            if organization_id <= 0:
                raise ValidationError({'organization_id': 'Must be a positive integer.'})
            queryset = queryset.filter(organization_memberships__organization_id=organization_id).distinct()
        query = self.request.query_params.get('search', '').strip()
        return queryset.filter(Q(username__icontains=query) | Q(email__icontains=query) | Q(profile__full_name__icontains=query)) if query else queryset


class AdminUserDetailView(generics.RetrieveUpdateAPIView):
    permission_classes = (IsAdminUser,)
    serializer_class = AdminUserSerializer
    queryset = User.objects.all()
    http_method_names = ['get', 'patch', 'head', 'options']


class AdminResetPasswordView(APIView):
    permission_classes = (IsAdminUser,)
    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        serializer = ResetPasswordSerializer(data=request.data, context={'user': user})
        serializer.is_valid(raise_exception=True)
        user.set_password(serializer.validated_data['temporary_password'])
        user.save(update_fields=['password'])
        profile, _ = UserProfile.objects.get_or_create(user=user, defaults={'full_name': user.username})
        profile.must_change_password = True
        profile.save(update_fields=['must_change_password'])
        return Response({'ok': True})
