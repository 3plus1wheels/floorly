from django.contrib import admin
from .models import Organization, OrganizationMembership, ThemePreference, UserProfile


@admin.register(ThemePreference)
class ThemePreferenceAdmin(admin.ModelAdmin):
	list_display = ('user', 'preset', 'updated_at')
	search_fields = ('user__username',)


admin.site.register(Organization)
admin.site.register(OrganizationMembership)
admin.site.register(UserProfile)
