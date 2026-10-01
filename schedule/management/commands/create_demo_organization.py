from datetime import date, timedelta
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from api.models import Organization, OrganizationMembership
from schedule.identity import canonical_employee_name
from schedule.models import Employee, Shift, StaffZone, WorkbookZoneOverride, ZONE_FIELDS


# These are deliberately fixed so recreating a demo from the same source produces
# a stable, reviewable roster. They are not derived from source employee names.
DEMO_EMPLOYEE_NAMES = (
    'Brooks, Avery',
    'Chen, Riley',
    'Diaz, Jordan',
    'Evans, Morgan',
    'Foster, Cameron',
    'Garcia, Taylor',
    'Hayes, Quinn',
    'Ivanov, Casey',
    'Johnson, Rowan',
    'Khan, Parker',
    'Lee, Skyler',
    'Martin, Reese',
    'Ng, Finley',
    'Owens, Dakota',
    'Patel, Emerson',
    'Reed, Hayden',
    'Singh, Jamie',
    'Turner, Kendall',
    'Usman, Robin',
    'Vega, Sidney',
    'Walker, Ari',
    'Xu, Marley',
    'Young, Devon',
    'Zimmer, Blair',
    'Allen, Drew',
    'Bennett, Jules',
    'Clarke, Remy',
    'Davis, Sage',
    'Ellis, Frankie',
    'Flores, Micah',
    'Green, Charlie',
    'Howard, River',
    'Ito, Lane',
    'Jones, Ellis',
    'Kim, Phoenix',
    'Lopez, Sam',
    'Murphy, Alex',
    'Nolan, Shiloh',
    'Ortiz, Jesse',
    'Price, Kai',
    'Ross, Bailey',
    'Shaw, Lennon',
    'Thomas, Kit',
    'Underwood, Noa',
    'Valdez, Ashton',
    'Williams, Corey',
    'Yates, Harley',
    'Zhao, Payton',
)


def _parse_monday(value, option_name):
    try:
        parsed = date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise CommandError(f'{option_name} must be YYYY-MM-DD.') from exc
    if parsed.weekday() != 0:
        raise CommandError(f'{option_name} must be a Monday.')
    return parsed


def _current_edmonton_monday():
    today = timezone.localtime(timezone.now(), ZoneInfo('America/Edmonton')).date()
    return today - timedelta(days=today.weekday())


def _demo_names(count, source_names):
    """Return stable fictional names that cannot match anyone in the source roster."""
    unavailable = {canonical_employee_name(name) for name in source_names}
    selected = []
    candidate_index = 0
    while len(selected) < count:
        if candidate_index < len(DEMO_EMPLOYEE_NAMES):
            candidate = DEMO_EMPLOYEE_NAMES[candidate_index]
        else:
            candidate = f'Teammate, Demo{candidate_index + 1:03d}'
        candidate_index += 1
        key = canonical_employee_name(candidate)
        if key in unavailable:
            continue
        unavailable.add(key)
        selected.append(candidate)
    return selected


class Command(BaseCommand):
    help = (
        'Create an isolated demo organization by copying one week of schedule '
        'coverage while replacing every employee name with a fictional name.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--source-organization-id',
            type=int,
            required=True,
            help='Organization whose staffing pattern will be copied.',
        )
        parser.add_argument(
            '--name',
            required=True,
            help='Unique name for the new demo organization.',
        )
        parser.add_argument(
            '--week-start',
            help='Source Monday to copy (YYYY-MM-DD). Defaults to the current Edmonton week.',
        )
        parser.add_argument(
            '--target-week-start',
            help='Optional Monday to place the copied pattern (YYYY-MM-DD).',
        )
        parser.add_argument(
            '--member-username',
            action='append',
            dest='member_usernames',
            default=[],
            help='Existing user to grant access to the demo org. May be repeated.',
        )

    def handle(self, *args, **options):
        source_week_start = (
            _parse_monday(options['week_start'], '--week-start')
            if options['week_start']
            else _current_edmonton_monday()
        )
        target_week_start = (
            _parse_monday(options['target_week_start'], '--target-week-start')
            if options['target_week_start']
            else source_week_start
        )
        source_week_end = source_week_start + timedelta(days=6)
        date_offset = target_week_start - source_week_start
        target_name = ' '.join(options['name'].split())
        if not target_name:
            raise CommandError('--name must not be empty.')
        if len(target_name) > Organization._meta.get_field('name').max_length:
            raise CommandError('--name must be at most 255 characters.')

        try:
            source = Organization.objects.get(pk=options['source_organization_id'])
        except Organization.DoesNotExist as exc:
            raise CommandError('Source organization not found.') from exc
        if Organization.objects.filter(name=target_name).exists():
            raise CommandError(f'Organization {target_name!r} already exists.')

        source_shifts = list(
            Shift.objects.select_related('employee')
            .prefetch_related('workbook_zone_overrides')
            .filter(
                employee__organization=source,
                date__range=(source_week_start, source_week_end),
            )
            .order_by('employee_id', 'date', 'start_time', 'occurrence')
        )
        if not source_shifts:
            raise CommandError(
                f'No source shifts found from {source_week_start} through {source_week_end}.'
            )

        source_employees = list(
            Employee.objects.filter(
                organization=source,
                shifts__date__range=(source_week_start, source_week_end),
            )
            .distinct()
            .order_by('id')
        )

        User = get_user_model()
        member_usernames = list(dict.fromkeys(options['member_usernames']))
        members = list(User.objects.filter(username__in=member_usernames))
        found_usernames = {user.username for user in members}
        missing_usernames = [name for name in member_usernames if name not in found_usernames]
        if missing_usernames:
            raise CommandError(
                'Unknown --member-username value(s): ' + ', '.join(missing_usernames)
            )

        with transaction.atomic():
            demo = Organization.objects.create(
                name=target_name,
                is_active=True,
                boh_shift_times=source.boh_shift_times,
                zone_priority=source.zone_priority,
            )
            employee_map = {}
            demo_names = _demo_names(
                len(source_employees),
                (employee.name for employee in source_employees),
            )
            for source_employee, demo_name in zip(source_employees, demo_names):
                demo_employee = Employee.objects.create(
                    organization=demo,
                    name=demo_name,
                    primary_job=source_employee.primary_job,
                    role_override=source_employee.role_override,
                    workbook_name='',
                )
                employee_map[source_employee.id] = demo_employee

            source_zones = StaffZone.objects.filter(employee__in=source_employees)
            StaffZone.objects.bulk_create([
                StaffZone(
                    employee=employee_map[source_zone.employee_id],
                    preferred_zone=source_zone.preferred_zone,
                    **{field: getattr(source_zone, field) for field in ZONE_FIELDS},
                )
                for source_zone in source_zones
            ])

            demo_shifts = []
            override_specs = []
            for source_shift in source_shifts:
                demo_shift = Shift.objects.create(
                    employee=employee_map[source_shift.employee_id],
                    date=source_shift.date + date_offset,
                    day_label=source_shift.day_label,
                    start_time=source_shift.start_time,
                    end_time=source_shift.end_time,
                    role=source_shift.role,
                    occurrence=source_shift.occurrence,
                    workbook_name_override='',
                )
                demo_shifts.append(demo_shift)
                override_specs.extend(
                    WorkbookZoneOverride(
                        shift=demo_shift,
                        hour=source_override.hour,
                        zone=source_override.zone,
                        last_edited_by=None,
                    )
                    for source_override in source_shift.workbook_zone_overrides.all()
                )
            WorkbookZoneOverride.objects.bulk_create(override_specs)

            OrganizationMembership.objects.bulk_create([
                OrganizationMembership(user=user, organization=demo)
                for user in members
            ])

        self.stdout.write(self.style.SUCCESS(
            f'Created demo organization {demo.name!r} (ID {demo.id}) with '
            f'{len(employee_map)} fictional employee(s) and {len(demo_shifts)} shift(s) '
            f'for {target_week_start} through {target_week_start + timedelta(days=6)}.'
        ))
