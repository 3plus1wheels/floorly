from django.contrib import admin
from .models import Employee, Shift


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ['name', 'organization', 'primary_job', 'role_override']
    list_filter = ['organization']
    search_fields = ['name']


@admin.register(Shift)
class ShiftAdmin(admin.ModelAdmin):
    list_display = ['employee', 'organization', 'date', 'day_label', 'start_time', 'end_time', 'role']
    list_filter = ['date', 'day_label', 'role']
    search_fields = ['employee__name', 'role']

    @admin.display(ordering='employee__organization')
    def organization(self, obj):
        return obj.employee.organization
