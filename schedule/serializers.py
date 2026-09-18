from rest_framework import serializers
from .models import Employee, Shift, StaffZone, ZONE_FIELDS
from .identity import default_workbook_name


class ShiftSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    primary_job = serializers.CharField(source='employee.primary_job', read_only=True)

    class Meta:
        model = Shift
        fields = ['id', 'employee_name', 'primary_job', 'date', 'day_label', 'start_time', 'end_time', 'role', 'occurrence']


class EmployeeSerializer(serializers.ModelSerializer):
    shifts = ShiftSerializer(many=True, read_only=True)

    class Meta:
        model = Employee
        fields = ['id', 'name', 'primary_job', 'shifts']


class StaffZoneSerializer(serializers.ModelSerializer):
    employee_id = serializers.IntegerField(source='employee.id', read_only=True)
    name = serializers.CharField(source='employee.name', read_only=True)
    primary_job = serializers.CharField(source='employee.primary_job', read_only=True)
    role_override = serializers.CharField(source='employee.role_override', read_only=True)
    workbook_name = serializers.CharField(source='employee.workbook_name', read_only=True)
    default_workbook_name = serializers.SerializerMethodField()

    class Meta:
        model = StaffZone
        fields = [
            'employee_id', 'name', 'primary_job', 'role_override', 'workbook_name',
            'default_workbook_name', 'preferred_zone',
        ] + ZONE_FIELDS

    def get_default_workbook_name(self, obj):
        return default_workbook_name(obj.employee.name)
