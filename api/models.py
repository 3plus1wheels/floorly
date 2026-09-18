from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

# Create your models here.

DEFAULT_BOH_SHIFT_TIMES = [
    {'start': '14:00', 'end': '18:45'},
    {'start': '16:30', 'end': '21:15'},
]
DEFAULT_ZONE_PRIORITY = [
    'WOMENS', 'MENS', 'FITS', 'CASH', 'FITS',
    'MENS', 'WOMENS', 'GREET', 'MENS', 'WOMENS', 'CASH',
]


def default_boh_shift_times():
    return [dict(rule) for rule in DEFAULT_BOH_SHIFT_TIMES]


def default_zone_priority():
    return list(DEFAULT_ZONE_PRIORITY)


class Item(models.Model):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['-created_at']


class ThemePreference(models.Model):
    PRESET_CLASSIC = 'classic'
    PRESET_OCEAN = 'ocean'
    PRESET_FOREST = 'forest'
    PRESET_CUSTOM = 'custom'

    PRESET_CHOICES = [
        (PRESET_CLASSIC, 'Classic Ivory'),
        (PRESET_OCEAN, 'Ocean Slate'),
        (PRESET_FOREST, 'Forest Mint'),
        (PRESET_CUSTOM, 'Custom'),
    ]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='theme_preference')
    preset = models.CharField(max_length=16, choices=PRESET_CHOICES, default=PRESET_CLASSIC)

    color_primary = models.CharField(max_length=7, default='#0d0d12')
    color_accent = models.CharField(max_length=7, default='#c9a84c')
    color_background = models.CharField(max_length=7, default='#faf8f5')
    color_surface = models.CharField(max_length=7, default='#f2eee7')
    color_card = models.CharField(max_length=7, default='#fffcf7')
    color_text = models.CharField(max_length=7, default='#2a2a35')
    color_muted = models.CharField(max_length=7, default='#6c6c78')

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username} theme ({self.preset})"


class UserProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='profile')
    full_name = models.CharField(max_length=255)
    must_change_password = models.BooleanField(default=False)

    def __str__(self):
        return self.full_name


class Organization(models.Model):
    name = models.CharField(max_length=255, unique=True)
    is_active = models.BooleanField(default=True)
    boh_shift_times = models.JSONField(default=default_boh_shift_times, blank=True)
    zone_priority = models.JSONField(default=default_zone_priority)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class OrganizationMembership(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='organization_memberships')
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='memberships')
    employee = models.ForeignKey(
        'schedule.Employee', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='account_memberships',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'organization'], name='unique_organization_membership'),
            models.UniqueConstraint(
                fields=['employee'], condition=models.Q(employee__isnull=False),
                name='unique_employee_account_membership',
            ),
        ]

    def __str__(self):
        return f'{self.user.username} @ {self.organization.name}'

    def clean(self):
        super().clean()
        if self.employee_id and self.organization_id and self.employee.organization_id != self.organization_id:
            raise ValidationError({'employee': 'Employee must belong to the membership organization.'})
