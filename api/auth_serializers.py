from collections import Counter
import re

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

from .models import DEFAULT_ZONE_PRIORITY, Organization, OrganizationMembership, ThemePreference, UserProfile

User = get_user_model()


class ThemePreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ThemePreference
        fields = ('preset', 'color_primary', 'color_accent', 'color_background', 'color_surface', 'color_card', 'color_text', 'color_muted', 'updated_at')
        read_only_fields = ('updated_at',)

    def validate(self, attrs):
        for field_name in ('color_primary', 'color_accent', 'color_background', 'color_surface', 'color_card', 'color_text', 'color_muted'):
            if field_name not in attrs:
                continue
            value = attrs[field_name]
            if not isinstance(value, str) or len(value) != 7 or not value.startswith('#'):
                raise serializers.ValidationError({field_name: 'Must be a hex color in #RRGGBB format.'})
            try:
                int(value[1:], 16)
            except ValueError as exc:
                raise serializers.ValidationError({field_name: 'Must be a valid hex color.'}) from exc
            attrs[field_name] = value.lower()
        return attrs


class OrganizationSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Organization
        fields = ('id', 'name', 'is_active', 'member_count', 'boh_shift_times', 'zone_priority', 'created_at', 'updated_at')
        read_only_fields = ('created_at', 'updated_at')

    def validate_boh_shift_times(self, value):
        if not isinstance(value, list) or len(value) > 20:
            raise serializers.ValidationError('Must be a list of no more than 20 shift times.')
        clean = []
        seen = set()
        for item in value:
            if not isinstance(item, dict) or set(item) != {'start', 'end'}:
                raise serializers.ValidationError('Each BOH rule needs only start and end values.')
            start, end = item.get('start'), item.get('end')
            if not all(isinstance(part, str) and re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', part) for part in (start, end)):
                raise serializers.ValidationError('BOH times must use 24-hour HH:MM format.')
            if start >= end:
                raise serializers.ValidationError('BOH shift end must be after its start.')
            pair = (start, end)
            if pair in seen:
                raise serializers.ValidationError('BOH shift times must be unique.')
            seen.add(pair)
            clean.append({'start': start, 'end': end})
        return clean

    def validate_zone_priority(self, value):
        if (
            not isinstance(value, list)
            or any(not isinstance(zone, str) for zone in value)
            or Counter(value) != Counter(DEFAULT_ZONE_PRIORITY)
        ):
            raise serializers.ValidationError('Zone priority must reorder the eleven existing zone slots.')
        return value


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    must_change_password = serializers.SerializerMethodField()
    is_admin = serializers.BooleanField(source='is_staff', read_only=True)
    organizations = serializers.SerializerMethodField()
    theme_preference = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'full_name', 'is_admin', 'must_change_password', 'organizations', 'theme_preference')

    def _profile(self, obj):
        profile, _ = UserProfile.objects.get_or_create(user=obj, defaults={'full_name': obj.get_full_name().strip() or obj.username})
        return profile

    def get_full_name(self, obj):
        return self._profile(obj).full_name.strip() or obj.get_full_name().strip() or obj.username

    def get_must_change_password(self, obj):
        return self._profile(obj).must_change_password

    def get_organizations(self, obj):
        queryset = Organization.objects.filter(is_active=True)
        if not obj.is_staff:
            queryset = queryset.filter(memberships__user=obj)
        return OrganizationSerializer(queryset.distinct(), many=True).data

    def get_theme_preference(self, obj):
        pref, _ = ThemePreference.objects.get_or_create(user=obj)
        return ThemePreferenceSerializer(pref).data


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)
    new_password2 = serializers.CharField(write_only=True)

    def validate(self, attrs):
        user = self.context['request'].user
        if not user.check_password(attrs['current_password']):
            raise serializers.ValidationError({'current_password': 'Current password is incorrect.'})
        if attrs['new_password'] != attrs['new_password2']:
            raise serializers.ValidationError({'new_password': "Password fields didn't match."})
        validate_password(attrs['new_password'], user=user)
        return attrs

    def save(self):
        user = self.context['request'].user
        user.set_password(self.validated_data['new_password'])
        user.save(update_fields=['password'])
        profile, _ = UserProfile.objects.get_or_create(user=user, defaults={'full_name': user.username})
        profile.must_change_password = False
        profile.save(update_fields=['must_change_password'])
        return user


class AdminUserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(write_only=True, required=False)
    temporary_password = serializers.CharField(write_only=True, required=False)
    organization_ids = serializers.PrimaryKeyRelatedField(source='organizations_input', queryset=Organization.objects.all(), many=True, write_only=True, required=False)
    organizations = serializers.SerializerMethodField(read_only=True)
    must_change_password = serializers.SerializerMethodField()
    is_admin = serializers.BooleanField(source='is_staff', required=False)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'full_name', 'is_active', 'is_admin', 'must_change_password', 'organizations', 'organization_ids', 'temporary_password', 'date_joined')
        read_only_fields = ('date_joined',)

    def get_organizations(self, obj):
        memberships = obj.organization_memberships.select_related('organization', 'employee').all()
        return [
            {
                **OrganizationSerializer(membership.organization).data,
                'employee_id': membership.employee_id,
                'employee_name': membership.employee.name if membership.employee else None,
            }
            for membership in memberships
        ]

    def get_must_change_password(self, obj):
        profile, _ = UserProfile.objects.get_or_create(user=obj, defaults={'full_name': obj.username})
        return profile.must_change_password

    def to_representation(self, instance):
        data = super().to_representation(instance)
        profile, _ = UserProfile.objects.get_or_create(user=instance, defaults={'full_name': instance.username})
        data['full_name'] = profile.full_name
        return data

    def validate(self, attrs):
        password = attrs.get('temporary_password')
        if self.instance is None:
            if not attrs.get('full_name', '').strip():
                raise serializers.ValidationError({'full_name': 'Full name is required.'})
            if not password:
                raise serializers.ValidationError({'temporary_password': 'Temporary password is required.'})
        if password:
            candidate = self.instance or User(username=attrs.get('username', ''), email=attrs.get('email', ''))
            validate_password(password, user=candidate)
        request = self.context.get('request')
        if self.instance and request and self.instance == request.user and attrs.get('is_active') is False:
            raise serializers.ValidationError({'is_active': 'You cannot deactivate your own account.'})
        if self.instance and request and self.instance == request.user and attrs.get('is_staff') is False:
            raise serializers.ValidationError({'is_admin': 'You cannot remove your own admin permission.'})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        full_name = validated_data.pop('full_name').strip()
        password = validated_data.pop('temporary_password')
        organizations = validated_data.pop('organizations_input', [])
        user = User.objects.create_user(password=password, **validated_data)
        UserProfile.objects.create(user=user, full_name=full_name, must_change_password=True)
        OrganizationMembership.objects.bulk_create([OrganizationMembership(user=user, organization=org) for org in organizations])
        return user

    @transaction.atomic
    def update(self, instance, validated_data):
        full_name = validated_data.pop('full_name', None)
        validated_data.pop('temporary_password', None)
        organizations = validated_data.pop('organizations_input', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if full_name is not None:
            profile, _ = UserProfile.objects.get_or_create(user=instance, defaults={'full_name': full_name.strip()})
            profile.full_name = full_name.strip()
            profile.save(update_fields=['full_name'])
        if organizations is not None:
            wanted_ids = {organization.id for organization in organizations}
            existing_ids = set(OrganizationMembership.objects.filter(user=instance).values_list('organization_id', flat=True))
            OrganizationMembership.objects.filter(user=instance).exclude(organization_id__in=wanted_ids).delete()
            OrganizationMembership.objects.bulk_create([
                OrganizationMembership(user=instance, organization=organization)
                for organization in organizations if organization.id not in existing_ids
            ])
        return instance


class ResetPasswordSerializer(serializers.Serializer):
    temporary_password = serializers.CharField(write_only=True)

    def validate_temporary_password(self, value):
        validate_password(value, user=self.context['user'])
        return value
