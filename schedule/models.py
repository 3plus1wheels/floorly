from django.conf import settings
from django.db import models
from api.models import Organization


class Employee(models.Model):
    ROLE_OVERRIDE_CHOICES = [
        ('', 'Use scraped role'),
        ('associate', 'Associate'),
        ('management', 'Management'),
        ('non_active', 'Non-active'),
    ]

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='employees')
    name = models.CharField(max_length=255)
    primary_job = models.CharField(max_length=255, blank=True)
    role_override = models.CharField(max_length=16, choices=ROLE_OVERRIDE_CHOICES, blank=True, default='')
    workbook_name = models.CharField(max_length=64, blank=True, default='')

    def __str__(self):
        return self.name

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['organization', 'name'], name='unique_employee_name_per_organization'),
        ]


ZONE_FIELDS = ['mens', 'womens', 'cash', 'fits', 'greet', 'boh']
PREFERRED_ZONE_CHOICES = [('', 'Auto')] + [(zone, zone.upper()) for zone in ZONE_FIELDS]
WORKBOOK_ZONE_CHOICES = [
    (zone, zone)
    for zone in ('WOMENS', 'MENS', 'FITS', 'CASH', 'GREET', 'FLEX', 'OFFICE', 'TASK', 'STYLIST', 'CEL', 'BOH')
]


class StaffZone(models.Model):
    """Skill/knowledge level for each store zone per employee. 0=none 1=basic 2=competent 3=expert"""
    employee = models.OneToOneField(Employee, on_delete=models.CASCADE, related_name='zones')
    mens    = models.SmallIntegerField(default=0)
    womens  = models.SmallIntegerField(default=0)
    cash    = models.SmallIntegerField(default=0)
    fits    = models.SmallIntegerField(default=0)
    greet   = models.SmallIntegerField(default=0)
    boh     = models.SmallIntegerField(default=0)
    preferred_zone = models.CharField(
        max_length=8,
        choices=PREFERRED_ZONE_CHOICES,
        blank=True,
        default='',
    )

    def __str__(self):
        return f"Zones({self.employee.name})"


class Shift(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='shifts')
    date = models.DateField()
    day_label = models.CharField(max_length=3, blank=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    role = models.CharField(max_length=255, blank=True)
    occurrence = models.PositiveSmallIntegerField(default=0)

    class Meta:
        unique_together = ('employee', 'date', 'start_time', 'occurrence')
        ordering = ['date', 'start_time']

    def __str__(self):
        return f"{self.employee.name} | {self.date} | {self.start_time}-{self.end_time}"


class WorkbookZoneOverride(models.Model):
    """A manager-selected hourly zone layered over the generated workbook map."""
    shift = models.ForeignKey(Shift, on_delete=models.CASCADE, related_name='workbook_zone_overrides')
    hour = models.PositiveSmallIntegerField()
    zone = models.CharField(max_length=16, choices=WORKBOOK_ZONE_CHOICES)
    last_edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='edited_workbook_zones',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['shift', 'hour'], name='unique_workbook_zone_shift_hour'),
            models.CheckConstraint(
                condition=models.Q(hour__gte=8, hour__lte=20),
                name='workbook_zone_hour_range',
            ),
        ]
        ordering = ['shift_id', 'hour']


class KronosImportConsent(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='kronos_import_consents',
    )
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name='kronos_import_consents',
    )
    policy_version = models.CharField(max_length=32)
    accepted_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'organization'],
                name='unique_kronos_consent_per_membership',
            ),
        ]

    def __str__(self):
        return f'{self.user_id} @ {self.organization_id} ({self.policy_version})'


class ScheduleSyncTokenUse(models.Model):
    jti = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='schedule_sync_token_uses',
    )
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name='schedule_sync_token_uses',
    )
    consumed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.jti} ({self.organization_id})'


class KpiImportBatch(models.Model):
    STATUS_COMPLETED = 'completed'
    STATUS_WARNINGS = 'warnings'
    STATUS_CHOICES = [
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_WARNINGS, 'Completed with warnings'),
    ]

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='kpi_import_batches')
    current_fiscal_year = models.PositiveSmallIntegerField(null=True, blank=True)
    prior_fiscal_year = models.PositiveSmallIntegerField(null=True, blank=True)
    current_filename = models.CharField(max_length=255, blank=True, default='')
    prior_filename = models.CharField(max_length=255, blank=True, default='')
    current_size = models.PositiveBigIntegerField(null=True, blank=True)
    prior_size = models.PositiveBigIntegerField(null=True, blank=True)
    current_sha256 = models.CharField(max_length=64, blank=True, default='')
    prior_sha256 = models.CharField(max_length=64, blank=True, default='')
    daily_records_imported = models.PositiveIntegerField(default=0)
    period_records_imported = models.PositiveIntegerField(default=0)
    warnings = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_COMPLETED)
    imported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='kpi_import_batches',
    )
    imported_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-imported_at', '-id']


class KpiDailyRecord(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='kpi_daily_records')
    import_batch = models.ForeignKey(
        KpiImportBatch, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='daily_records',
    )
    fiscal_year = models.PositiveSmallIntegerField()
    fiscal_period = models.PositiveSmallIntegerField()
    fiscal_week = models.PositiveSmallIntegerField()
    weekday = models.PositiveSmallIntegerField()
    business_date = models.DateField()
    day_target = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    sales = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    traffic = models.IntegerField(null=True, blank=True)
    conversion = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True)
    atv = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    upt = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)

    class Meta:
        ordering = ['business_date']
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'business_date'], name='unique_kpi_date_per_organization',
            ),
            models.UniqueConstraint(
                fields=['organization', 'fiscal_year', 'fiscal_period', 'fiscal_week', 'weekday'],
                name='unique_kpi_fiscal_slot_per_organization',
            ),
        ]
        indexes = [
            models.Index(fields=['organization', 'fiscal_year', 'fiscal_period']),
        ]


class KpiPeriodRecord(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='kpi_period_records')
    import_batch = models.ForeignKey(
        KpiImportBatch, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='period_records',
    )
    fiscal_year = models.PositiveSmallIntegerField()
    fiscal_period = models.PositiveSmallIntegerField()
    sheet_name = models.CharField(max_length=64)
    sales_plan = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    mtd_sales = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    mtd_as_of = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['fiscal_year', 'fiscal_period']
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'fiscal_year', 'fiscal_period'],
                name='unique_kpi_period_per_organization',
            ),
        ]


class KpiDayState(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='kpi_day_states')
    business_date = models.DateField()
    goal_overrides = models.JSONField(default=dict, blank=True)
    hourly_values = models.JSONField(default=dict, blank=True)
    revision = models.PositiveIntegerField(default=0)
    last_edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='edited_kpi_days',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'business_date'], name='unique_kpi_state_per_organization_date',
            ),
        ]
