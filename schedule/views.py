import hashlib
import json
import threading
import unicodedata
from collections import Counter
from datetime import date, datetime, time, timedelta
from itertools import combinations

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.conf import settings
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from .models import (
    Employee, KronosImportConsent, ScheduleSyncTokenUse, Shift, StaffZone,
    WorkbookZoneOverride, WORKBOOK_ZONE_CHOICES, ZONE_FIELDS,
)
from .serializers import ShiftSerializer, EmployeeSerializer, StaffZoneSerializer
from .authentication import ScheduleSyncAuthentication, ScheduleSyncToken
from .identity import canonical_employee_name, default_workbook_name, workbook_name_parts, employee_summary, find_employee_by_name
from api.organization_context import organization_for_request
from api.models import OrganizationMembership, UserProfile

WORKBOOK_HOURS = list(range(8, 21))  # 8 am … 8-9 pm slot
WORKBOOK_INTERVAL_MINUTES = 15
WORKBOOK_INTERVAL_STARTS = tuple(range(
    WORKBOOK_HOURS[0] * 60,
    (WORKBOOK_HOURS[-1] + 1) * 60,
    WORKBOOK_INTERVAL_MINUTES,
))
CEL_BLOCK_INTERVALS = 120 // WORKBOOK_INTERVAL_MINUTES
KRONOS_PRIVACY_POLICY_VERSION = '2026-09-16'

WORKBOOK_COL_HEADERS = [
    '8am-9am','9am-10am','10am-11am','11am-12pm',
    '12pm-1pm','1pm-2pm','2pm-3pm','3pm-4pm',
    '4pm-5pm','5pm-6pm','6pm-7pm','7pm-8pm','8pm-9pm',
]

# Zone assignment order for Stylists in each interval.
# Slots are filled left-to-right; each Stylist is used at most once per interval.
SLOT_SEQUENCE = ['womens', 'mens', 'fits', 'cash', 'fits', 'mens', 'womens', 'greet', 'mens', 'womens']

# Main zones that managers can plug when stylists don't fill them
MAIN_ZONE_SLOTS = ['womens', 'mens', 'fits', 'cash']


def _time_minutes(value):
    return value.hour * 60 + value.minute


def _shift_covers_interval(shift, interval_start):
    """Return True only when the shift covers the complete 15-minute interval."""
    return (
        _time_minutes(shift.start_time) <= interval_start
        and _time_minutes(shift.end_time) >= interval_start + WORKBOOK_INTERVAL_MINUTES
    )


def _ensure_slot_counts(base_slots, required_counts):
    """Return the least-disruptive slot list satisfying each required count."""
    slots = list(base_slots)
    if sum(required_counts.values()) > len(slots):
        return None

    counts = Counter(slots)
    zone_order = {zone: index for index, zone in enumerate(ZONE_FIELDS)}
    ordered_required = sorted(
        required_counts,
        key=lambda zone: (
            base_slots.index(zone) if zone in base_slots else len(base_slots) + zone_order.get(zone, 99),
            zone,
        ),
    )
    for zone in ordered_required:
        while counts[zone] < required_counts[zone]:
            replace_index = next((
                index
                for index in range(len(slots) - 1, -1, -1)
                if counts[slots[index]] > required_counts.get(slots[index], 0)
            ), None)
            if replace_index is None:
                return None
            counts[slots[replace_index]] -= 1
            slots[replace_index] = zone
            counts[zone] += 1
    return slots


def _build_interval_assignments(shifts, staff_skill, store_open_minute, slot_sequence=None):
    """Build internal quarter-hour assignments without changing the hourly API."""
    interval_assignments = {}
    shift_anchor_zones = {}
    previous_active_stylist_ids = None

    def skill(employee_id, zone):
        return getattr(staff_skill.get(employee_id), zone, 0) or 0

    def skill_sum(employee_id):
        staff_zone = staff_skill.get(employee_id)
        if not staff_zone:
            return 0
        return sum(getattr(staff_zone, field, 0) or 0 for field in ZONE_FIELDS)

    def preferred_zone(employee_id):
        value = getattr(staff_skill.get(employee_id), 'preferred_zone', '') or ''
        return value if value in ZONE_FIELDS else ''

    def add_scores(left, right):
        return tuple(a + b for a, b in zip(left, right))

    def match_slots(stylists, slots, previous):
        """Globally match employees to at most ten slots using bounded bitmask DP."""
        ordered_staff = sorted(stylists, key=lambda shift: shift.employee_id)
        slot_count = len(slots)
        score_size = 3 + (slot_count * 3)
        empty_score = (0,) * score_size
        # mask -> (score, picks); picks are slot indexes in ordered_staff order.
        states = {0: (empty_score, ())}

        def is_better(candidate, current):
            if current is None:
                return True
            candidate_score, candidate_picks = candidate
            current_score, current_picks = current
            if candidate_score != current_score:
                return candidate_score > current_score
            candidate_key = tuple(
                slot_count - pick if pick >= 0 else 0 for pick in candidate_picks
            )
            current_key = tuple(
                slot_count - pick if pick >= 0 else 0 for pick in current_picks
            )
            return candidate_key > current_key

        for shift in ordered_staff:
            employee_id = shift.employee_id
            next_states = {}
            for mask, (current_score, current_picks) in states.items():
                skipped = (current_score, current_picks + (-1,))
                if is_better(skipped, next_states.get(mask)):
                    next_states[mask] = skipped

                total_skill = skill_sum(employee_id)
                preference = preferred_zone(employee_id)
                for slot_index, zone in enumerate(slots):
                    bit = 1 << slot_index
                    if mask & bit:
                        continue
                    zone_skill = skill(employee_id, zone)
                    contribution = [0] * score_size
                    contribution[0] = int(
                        zone_skill > 0 and previous.get(employee_id) == zone.upper()
                    )
                    contribution[1] = int(zone_skill > 0)
                    contribution[2] = int(preference == zone)
                    contribution[3 + slot_index] = zone_skill
                    contribution[3 + slot_count + slot_index] = int(
                        shift_anchor_zones.get(employee_id) == zone.upper()
                    )
                    contribution[3 + (slot_count * 2) + slot_index] = -(
                        total_skill - zone_skill
                    )
                    candidate = (
                        add_scores(current_score, tuple(contribution)),
                        current_picks + (slot_index,),
                    )
                    next_mask = mask | bit
                    if is_better(candidate, next_states.get(next_mask)):
                        next_states[next_mask] = candidate
            states = next_states

        full_mask = (1 << slot_count) - 1
        score, picks = states[full_mask]
        assignments = {
            shift.employee_id: slots[pick]
            for shift, pick in zip(ordered_staff, picks)
            if pick >= 0
        }
        tie_key = tuple(slot_count - pick if pick >= 0 else 0 for pick in picks)
        return score, tie_key, assignments

    # Assign Stylists chronologically. Slot configurations preserve valid
    # continuity and exact-time handoffs, then a global matcher chooses the
    # safest preference-aware team arrangement without employee-order bias.
    for interval_start in WORKBOOK_INTERVAL_STARTS:
        stylists = [
            shift for shift in shifts
            if shift.effective_role == 'Stylist'
            and _shift_covers_interval(shift, interval_start)
        ]
        active_ids = {shift.employee_id for shift in stylists}
        for employee_id in list(shift_anchor_zones):
            if employee_id not in active_ids:
                del shift_anchor_zones[employee_id]

        previous = interval_assignments.get(interval_start - WORKBOOK_INTERVAL_MINUTES, {})
        if previous_active_stylist_ids == active_ids:
            interval_assignments[interval_start] = dict(previous)
            continue
        previous_active_stylist_ids = active_ids
        ordered_slots = slot_sequence or SLOT_SEQUENCE
        base_slots = list(ordered_slots[:min(len(stylists), len(ordered_slots))])
        base_counts = Counter(base_slots)

        continuing_counts = Counter()
        for shift in stylists:
            prior_zone = previous.get(shift.employee_id, '').lower()
            if prior_zone in ZONE_FIELDS and skill(shift.employee_id, prior_zone) > 0:
                continuing_counts[prior_zone] += 1

        departed_counts = Counter(
            zone.lower()
            for employee_id, zone in previous.items()
            if employee_id not in active_ids and zone.lower() in ZONE_FIELDS
        )
        # A zone is protected only while the current staffing plan still calls
        # for it. This keeps a 4:45 handoff covered without retaining a zone
        # that legitimately disappears when headcount falls.
        mandatory_counts = Counter()
        for zone, capacity in base_counts.items():
            protected = min(
                capacity,
                continuing_counts[zone] + departed_counts[zone],
            )
            if protected:
                mandatory_counts[zone] = protected

        active_preferences = sorted({
            preferred_zone(shift.employee_id)
            for shift in stylists
            if preferred_zone(shift.employee_id)
        }, key=lambda zone: ZONE_FIELDS.index(zone))
        for zone in active_preferences:
            if departed_counts[zone] and not base_counts[zone]:
                mandatory_counts[zone] = max(mandatory_counts[zone], 1)
        baseline_slots = _ensure_slot_counts(base_slots, mandatory_counts) or base_slots
        missing_preferences = [
            zone for zone in active_preferences if zone not in baseline_slots
        ]

        best = None
        for count in range(len(missing_preferences) + 1):
            for preference_subset in combinations(missing_preferences, count):
                required_counts = Counter(mandatory_counts)
                for zone in preference_subset:
                    required_counts[zone] = max(required_counts[zone], 1)
                slots = _ensure_slot_counts(base_slots, required_counts)
                if slots is None:
                    continue
                score, tie_key, matched = match_slots(stylists, slots, previous)
                replacements = sum((Counter(slots) - base_counts).values())
                base_match = tuple(
                    int(index < len(base_slots) and zone == base_slots[index])
                    for index, zone in enumerate(slots)
                )
                candidate_key = (score, -replacements, base_match, tie_key)
                if best is None or candidate_key > best[0]:
                    best = (candidate_key, matched)

        matched = best[1] if best else {}
        assigned = {}
        for shift in stylists:
            zone = matched.get(shift.employee_id)
            if zone is None:
                assigned[shift.employee_id] = 'STYLIST'
                continue
            assigned[shift.employee_id] = zone.upper()
            shift_anchor_zones.setdefault(shift.employee_id, zone.upper())
        interval_assignments[interval_start] = assigned

    # Schedule managers right-to-left as before, but measure both contiguous
    # CEL blocks and total workload in quarter-hours/minutes.
    cel_consecutive = {}
    cel_total_minutes = {}
    all_manager_ids = {shift.employee_id for shift in shifts if shift.effective_role == 'CEL'}

    for interval_start in reversed(WORKBOOK_INTERVAL_STARTS):
        managers = [
            shift for shift in shifts
            if shift.effective_role == 'CEL'
            and _shift_covers_interval(shift, interval_start)
        ]
        working_manager_ids = {manager.employee_id for manager in managers}
        for employee_id in all_manager_ids:
            if employee_id not in working_manager_ids:
                cel_consecutive[employee_id] = 0

        if not managers:
            continue

        if interval_start < store_open_minute:
            for manager in managers:
                interval_assignments[interval_start][manager.employee_id] = 'TASK'
            continue

        for manager in managers:
            cel_consecutive.setdefault(manager.employee_id, 0)
            cel_total_minutes.setdefault(manager.employee_id, 0)

        def cel_priority(manager):
            employee_id = manager.employee_id
            consecutive = cel_consecutive.get(employee_id, 0)
            total_minutes = cel_total_minutes.get(employee_id, 0)
            in_block = 1 if 0 < consecutive < CEL_BLOCK_INTERVALS else 0
            under_limit = 1 if (consecutive < CEL_BLOCK_INTERVALS or len(managers) == 1) else 0
            return (
                in_block,
                under_limit,
                -total_minutes,
                _time_minutes(manager.end_time),
                -employee_id,
            )

        cel_pick = max(managers, key=cel_priority)
        cel_employee_id = cel_pick.employee_id
        interval_assignments[interval_start][cel_employee_id] = 'CEL'
        cel_consecutive[cel_employee_id] = cel_consecutive.get(cel_employee_id, 0) + 1
        cel_total_minutes[cel_employee_id] = (
            cel_total_minutes.get(cel_employee_id, 0) + WORKBOOK_INTERVAL_MINUTES
        )

        for manager in managers:
            employee_id = manager.employee_id
            if employee_id == cel_employee_id:
                continue
            interval_assignments[interval_start][employee_id] = 'FLEX'
            cel_consecutive[employee_id] = 0

    return interval_assignments


def _is_forced_boh_shift(shift, organization):
    start = shift.start_time.strftime('%H:%M')
    end = shift.end_time.strftime('%H:%M')
    return any(
        isinstance(rule, dict) and rule.get('start') == start and rule.get('end') == end
        for rule in (organization.boh_shift_times or [])
    )


class ShiftListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        organization = organization_for_request(request)
        date_filter = request.query_params.get('date')
        week_start = request.query_params.get('week_start')

        shifts = Shift.objects.select_related('employee').filter(employee__organization=organization)

        if date_filter:
            shifts = shifts.filter(date=date_filter)
        elif week_start:
            from datetime import datetime, timedelta
            try:
                start = datetime.strptime(week_start, '%Y-%m-%d').date()
                end = start + timedelta(days=6)
                shifts = shifts.filter(date__range=[start, end])
            except ValueError:
                pass

        serializer = ShiftSerializer(shifts, many=True)
        return Response(serializer.data)


class EmployeeListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        organization = organization_for_request(request)
        employees = Employee.objects.prefetch_related('shifts').filter(organization=organization)
        serializer = EmployeeSerializer(employees, many=True)
        return Response(serializer.data)


_sqlite_sync_lock = threading.Lock()


class PayloadError(ValueError):
    pass


def _clean_text(value, field, *, max_length=255, required=True):
    if not isinstance(value, str):
        raise PayloadError(f'{field} must be a string')
    value = value.strip()
    if required and not value:
        raise PayloadError(f'{field} must not be empty')
    if any(ord(character) < 32 for character in value):
        raise PayloadError(f'{field} contains control characters')
    if len(value) > max_length:
        raise PayloadError(f'{field} is too long')
    return value


def _parse_iso_date(value, field):
    value = _clean_text(value, field, max_length=10)
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise PayloadError(f'{field} must be YYYY-MM-DD') from exc
    if parsed.isoformat() != value:
        raise PayloadError(f'{field} must be YYYY-MM-DD')
    return parsed


def _parse_hhmm(value, field):
    value = _clean_text(value, field, max_length=5)
    try:
        parsed = datetime.strptime(value, '%H:%M').time()
    except ValueError as exc:
        raise PayloadError(f'{field} must be HH:MM') from exc
    return parsed


def _validate_sync_payload(payload):
    top_fields = {'source', 'timezone', 'synced_at', 'weeks'}
    if not isinstance(payload, dict) or set(payload) != top_fields:
        raise PayloadError('payload must contain source, timezone, synced_at, and weeks')
    if payload['source'] != 'kronos':
        raise PayloadError('source must be kronos')
    if payload['timezone'] != 'America/Edmonton':
        raise PayloadError('timezone must be America/Edmonton')
    synced_at = _clean_text(payload['synced_at'], 'synced_at', max_length=64)
    try:
        if datetime.fromisoformat(synced_at.replace('Z', '+00:00')).tzinfo is None:
            raise ValueError
    except ValueError as exc:
        raise PayloadError('synced_at must be an ISO 8601 timestamp with timezone') from exc
    weeks = payload['weeks']
    if not isinstance(weeks, list) or not 1 <= len(weeks) <= 2:
        raise PayloadError('weeks must contain one or two weeks')

    records = []
    starts = []
    occurrences = {}
    total_shifts = 0
    for week_index, week in enumerate(weeks):
        if not isinstance(week, dict) or set(week) != {'week_start', 'week_end', 'shifts'}:
            raise PayloadError(f'weeks[{week_index}] must contain week_start, week_end, and shifts')
        week_start = _parse_iso_date(week['week_start'], f'weeks[{week_index}].week_start')
        if week_start.weekday() != 0:
            raise PayloadError('week_start must be a Monday')
        week_end = _parse_iso_date(week['week_end'], f'weeks[{week_index}].week_end')
        if week_end != week_start + timedelta(days=6):
            raise PayloadError('week_end must be Sunday following week_start')
        starts.append(week_start)
        shifts = week['shifts']
        if not isinstance(shifts, list) or not shifts:
            raise PayloadError('each week must contain at least one shift')
        total_shifts += len(shifts)
        if total_shifts > 5000:
            raise PayloadError('payload contains too many shifts')
        for shift_index, item in enumerate(shifts):
            if not isinstance(item, dict):
                raise PayloadError('each shift must be an object')
            allowed = {'employee_name', 'primary_job', 'date', 'start_time', 'end_time', 'role'}
            required = {'employee_name', 'date', 'start_time', 'end_time', 'role'}
            if set(item) - allowed or not required <= set(item):
                raise PayloadError('shift has missing or unknown fields')
            name = _clean_text(item['employee_name'], 'employee_name')
            role = _clean_text(item['role'], 'role')
            primary_job = (
                _clean_text(item['primary_job'], 'primary_job', required=False)
                if 'primary_job' in item else None
            )
            shift_date = _parse_iso_date(item['date'], f'weeks[{week_index}].shifts[{shift_index}].date')
            if not week_start <= shift_date <= week_end:
                raise PayloadError('shift date must fall within its week')
            start_time = _parse_hhmm(item['start_time'], 'start_time')
            end_time = _parse_hhmm(item['end_time'], 'end_time')
            if end_time <= start_time:
                raise PayloadError('end_time must be after start_time')
            key = (name.casefold(), shift_date, start_time)
            occurrence = occurrences.get(key, 0)
            occurrences[key] = occurrence + 1
            records.append({
                'name': name, 'primary_job': primary_job, 'date': shift_date,
                'start_time': start_time, 'end_time': end_time, 'role': role,
                'day_label': shift_date.strftime('%a'), 'occurrence': occurrence,
            })
    if len(starts) == 2 and starts[1] != starts[0] + timedelta(days=7):
        raise PayloadError('weeks must be consecutive and ordered')
    return records, starts[0], starts[-1] + timedelta(days=6)


def _canonical_hash(records):
    canonical = [
        {key: value.isoformat() if hasattr(value, 'isoformat') else value for key, value in record.items()}
        for record in records
    ]
    canonical.sort(key=lambda item: (item['date'], item['name'].casefold(), item['start_time'], item['occurrence']))
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class CurrentEmployeeView(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _membership(request, organization):
        membership = OrganizationMembership.objects.filter(user=request.user, organization=organization).select_related('employee').first()
        if membership is None and request.user.is_staff:
            membership = OrganizationMembership.objects.create(user=request.user, organization=organization)
        return membership

    @staticmethod
    def _profile_name(user):
        profile, _ = UserProfile.objects.get_or_create(
            user=user, defaults={'full_name': user.get_full_name().strip() or user.username})
        return profile.full_name.strip() or user.get_full_name().strip() or user.username

    @staticmethod
    def _available_employees(organization):
        return list(
            Employee.objects.filter(organization=organization)
            .exclude(role_override='non_active')
            .filter(account_memberships__isnull=True)
            .order_by('name')
        )

    def _response(self, membership, profile_name, candidates, *, auto_matched=False, can_create=None):
        return Response({
            'linked_employee': employee_summary(membership.employee),
            'auto_matched': auto_matched,
            'candidates': [employee_summary(employee) for employee in candidates],
            'profile_full_name': profile_name,
            'can_create_from_profile': membership.employee_id is None if can_create is None else can_create,
        })

    def get(self, request):
        organization = organization_for_request(request)
        membership = self._membership(request, organization)
        if membership is None:
            return Response({'code': 'membership_denied', 'detail': 'You do not belong to this organization.'}, status=status.HTTP_403_FORBIDDEN)
        profile_name = self._profile_name(request.user)
        candidates = self._available_employees(organization)
        if membership.employee_id is None:
            key = canonical_employee_name(profile_name)
            matches = [employee for employee in candidates if canonical_employee_name(employee.name) == key]
            if len(matches) == 1:
                try:
                    membership.employee = matches[0]
                    membership.save(update_fields=['employee'])
                except IntegrityError:
                    membership.refresh_from_db()
                else:
                    candidates = self._available_employees(organization)
                    return self._response(membership, profile_name, candidates, auto_matched=True)
            if len(matches) > 1:
                return self._response(membership, profile_name, candidates, can_create=False)
        return self._response(membership, profile_name, candidates)

    def put(self, request):
        organization = organization_for_request(request)
        membership = self._membership(request, organization)
        if membership is None:
            return Response({'code': 'membership_denied', 'detail': 'You do not belong to this organization.'}, status=status.HTTP_403_FORBIDDEN)
        if membership.employee_id is not None:
            return Response({'code': 'employee_link_locked', 'detail': 'Employee identity is already linked. Ask an administrator to change it.'}, status=status.HTTP_409_CONFLICT)
        employee_id = request.data.get('employee_id')
        create_from_profile = request.data.get('create_from_profile') is True
        if (employee_id is None) == (not create_from_profile):
            return Response({'detail': 'Provide either employee_id or create_from_profile.'}, status=status.HTTP_400_BAD_REQUEST)
        if employee_id is not None:
            try:
                employee_id = int(employee_id)
            except (TypeError, ValueError):
                return Response({'detail': 'employee_id must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)
        profile_name = self._profile_name(request.user)
        try:
            with transaction.atomic():
                membership = OrganizationMembership.objects.select_for_update().get(pk=membership.pk)
                if membership.employee_id is not None:
                    return Response({'code': 'employee_link_locked', 'detail': 'Employee identity is already linked. Ask an administrator to change it.'}, status=status.HTTP_409_CONFLICT)
                if create_from_profile:
                    try:
                        employee = find_employee_by_name(organization, profile_name)
                    except ValueError as exc:
                        return Response({'code': 'employee_match_ambiguous', 'detail': str(exc)}, status=status.HTTP_409_CONFLICT)
                    if employee is None:
                        employee = Employee.objects.create(organization=organization, name=profile_name)
                    elif employee.role_override == 'non_active':
                        return Response({'detail': 'Inactive employee cannot be linked by a user.'}, status=status.HTTP_400_BAD_REQUEST)
                else:
                    employee = Employee.objects.filter(pk=employee_id, organization=organization).exclude(role_override='non_active').first()
                    if employee is None:
                        return Response({'detail': 'Employee is not available in this organization.'}, status=status.HTTP_400_BAD_REQUEST)
                if OrganizationMembership.objects.filter(employee=employee).exclude(pk=membership.pk).exists():
                    return Response({'code': 'employee_already_linked', 'detail': 'Employee is already linked to another account.'}, status=status.HTTP_409_CONFLICT)
                membership.employee = employee
                membership.save(update_fields=['employee'])
        except (IntegrityError, ValueError):
            return Response({'code': 'employee_already_linked', 'detail': 'Employee is already linked to another account.'}, status=status.HTTP_409_CONFLICT)
        return Response({'linked_employee': employee_summary(employee)})


class ScheduleSyncView(APIView):
    """Atomically replace shifts in one or two complete weeks for an authenticated user."""
    permission_classes = [IsAuthenticated]
    authentication_classes = [ScheduleSyncAuthentication]

    def post(self, request):
        organization = organization_for_request(request)
        try:
            ticket_organization_id = int(request.auth.get('organization_id'))
        except (TypeError, ValueError):
            return Response({'error': 'Schedule sync ticket has no valid organization.'}, status=status.HTTP_403_FORBIDDEN)
        if ticket_organization_id != organization.id:
            return Response({'error': 'Schedule sync ticket belongs to another organization.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            records, range_start, range_end = _validate_sync_payload(request.data)
        except PayloadError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        membership = OrganizationMembership.objects.filter(
            user=request.user, organization=organization).select_related('employee').first()
        has_current_user_row = any(canonical_employee_name(record['name']) == 'my schedule' for record in records)
        if has_current_user_row and (membership is None or membership.employee_id is None):
            return Response({
                'code': 'employee_link_required',
                'detail': 'Choose your employee identity before importing My Schedule.',
            }, status=status.HTTP_409_CONFLICT)

        token_jti = str(request.auth.get('jti') or '')
        if not token_jti or len(token_jti) > 64:
            return Response({'error': 'Schedule sync ticket has no valid identifier.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            ScheduleSyncTokenUse.objects.create(
                jti=token_jti,
                user=request.user,
                organization=organization,
            )
        except IntegrityError:
            return Response({
                'code': 'TICKET_REPLAYED',
                'detail': 'This schedule import ticket has already been used. Start the import again.',
            }, status=status.HTTP_409_CONFLICT)

        lock = _sqlite_sync_lock if connection.vendor == 'sqlite' else None
        if lock:
            lock.acquire()
        try:
            with transaction.atomic():
                if connection.vendor == 'postgresql':
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT pg_try_advisory_xact_lock(hashtext(%s))", [f'schedule-sync-{organization.id}'])
                        if not cursor.fetchone()[0]:
                            return Response({'ok': True, 'skipped': 'sync_in_progress'})

                counts = {'employees_created': 0, 'employees_updated': 0, 'shifts_created': 0, 'shifts_updated': 0, 'shifts_deleted': 0}
                occurrences = {}
                for record in records:
                    if canonical_employee_name(record['name']) == 'my schedule':
                        employee = membership.employee
                    else:
                        try:
                            employee = find_employee_by_name(organization, record['name'])
                        except ValueError as exc:
                            raise PayloadError(str(exc)) from exc
                    if employee is None:
                        employee = Employee.objects.create(
                            organization=organization, name=record['name'], primary_job=record['primary_job'] or '')
                        counts['employees_created'] += 1
                    elif record['primary_job'] is not None and employee.primary_job != record['primary_job']:
                        employee.primary_job = record['primary_job']
                        employee.save(update_fields=['primary_job'])
                        counts['employees_updated'] += 1
                    occurrence_key = (employee.id, record['date'], record['start_time'])
                    record['occurrence'] = occurrences.get(occurrence_key, 0)
                    occurrences[occurrence_key] = record['occurrence'] + 1
                    record['employee'] = employee
                    record['name'] = employee.name

                existing = {
                    (shift.employee_id, shift.date, shift.start_time, shift.occurrence): shift
                    for shift in Shift.objects.filter(employee__organization=organization, date__range=(range_start, range_end))
                }
                wanted = {(r['employee'].id, r['date'], r['start_time'], r['occurrence']) for r in records}
                stale_ids = [shift.id for key, shift in existing.items() if key not in wanted]
                deleted, _ = Shift.objects.filter(id__in=stale_ids).delete()
                counts['shifts_deleted'] = deleted
                for record in records:
                    shift, shift_created = Shift.objects.get_or_create(
                        employee=record['employee'], date=record['date'], start_time=record['start_time'], occurrence=record['occurrence'],
                        defaults={key: record[key] for key in ('end_time', 'day_label', 'role')},
                    )
                    if shift_created:
                        counts['shifts_created'] += 1
                    else:
                        changed = []
                        for field in ('end_time', 'day_label', 'role'):
                            if getattr(shift, field) != record[field]:
                                setattr(shift, field, record[field])
                                changed.append(field)
                        if changed:
                            shift.save(update_fields=changed)
                            counts['shifts_updated'] += 1
        except PayloadError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        finally:
            if lock:
                lock.release()

        digest = _canonical_hash([{key: value for key, value in record.items() if key != 'employee'} for record in records])
        completed_at = timezone.now().isoformat()
        return Response({
            'ok': True,
            **counts,
            'counts': counts,
            'shifts_received': len(records),
            'range_start': range_start.isoformat(),
            'range_end': range_end.isoformat(),
            'hash': digest,
            'payload_hash': digest,
            'timestamp': completed_at,
            'synced_at': completed_at,
        })


class ScheduleSyncTicketView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        organization = organization_for_request(request)
        if not isinstance(request.data, dict):
            return Response({
                'code': 'INVALID_REQUEST',
                'detail': 'Request body must be a JSON object.',
            }, status=status.HTTP_400_BAD_REQUEST)
        consent = KronosImportConsent.objects.filter(
            user=request.user,
            organization=organization,
            policy_version=KRONOS_PRIVACY_POLICY_VERSION,
        ).first()
        if consent is None:
            if request.data.get('consent') is not True or request.data.get('privacy_policy_version') != KRONOS_PRIVACY_POLICY_VERSION:
                return Response({
                    'code': 'CONSENT_REQUIRED',
                    'detail': 'Accept the current Kronos import privacy notice before importing.',
                    'privacy_policy_version': KRONOS_PRIVACY_POLICY_VERSION,
                    'privacy_policy_url': getattr(
                        settings,
                        'PRIVACY_POLICY_URL',
                        'https://floorly.vovanguyen.com/privacy',
                    ),
                }, status=status.HTTP_403_FORBIDDEN)
            consent, _ = KronosImportConsent.objects.update_or_create(
                user=request.user,
                organization=organization,
                defaults={'policy_version': KRONOS_PRIVACY_POLICY_VERSION},
            )
        token = ScheduleSyncToken.for_user(request.user)
        token['organization_id'] = organization.id
        token['privacy_policy_version'] = consent.policy_version
        return Response({
            'ticket': str(token),
            'token_type': 'ScheduleSync',
            'expires_in': int(ScheduleSyncToken.lifetime.total_seconds()),
            'privacy_policy_version': consent.policy_version,
        })


class WorkbookView(APIView):
    """GET /api/schedule/workbook/?week_start=YYYY-MM-DD&day=Mon
    Returns zone-chart rows sorted by start_time for one day."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        organization = organization_for_request(request)
        from datetime import datetime, timedelta
        week_start = request.query_params.get('week_start')
        day = request.query_params.get('day', 'Mon')

        DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        if not week_start:
            return Response({'error': 'week_start required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            start = datetime.strptime(week_start, '%Y-%m-%d').date()
        except ValueError:
            return Response({'error': 'Invalid week_start'}, status=status.HTTP_400_BAD_REQUEST)

        day_offset = DAY_ORDER.index(day) if day in DAY_ORDER else 0
        target_date = start + timedelta(days=day_offset)

        shifts = (
            Shift.objects.select_related('employee')
            .filter(employee__organization=organization, date=target_date)
            .exclude(employee__role_override='non_active')
            .order_by('start_time')
        )

        def _fmt(h, m):
            ah = h % 12 or 12
            return f"{ah}:{m:02d}" if m else str(ah)

        # Determine which first names are shared so we can disambiguate
        shifts = list(shifts)  # evaluate queryset once
        saved_overrides = {
            (override.shift_id, override.hour): override.zone
            for override in WorkbookZoneOverride.objects.filter(
                shift__employee__organization=organization,
                shift__date=target_date,
            )
        }
        role_overrides = {'associate': 'Stylist', 'management': 'CEL'}
        for shift in shifts:
            if _is_forced_boh_shift(shift, organization):
                shift.effective_role = 'BOH'
            else:
                shift.effective_role = role_overrides.get(shift.employee.role_override, shift.role)
        # Sort: non-BOH by start_time first, BOH shifts always last
        shifts.sort(key=lambda s: (1 if s.effective_role == 'BOH' else 0, s.start_time))
        distinct_employees = {shift.employee_id: shift.employee for shift in shifts}
        default_name_counts = Counter(
            default_workbook_name(employee.name)
            for employee in distinct_employees.values()
            if not employee.workbook_name
        )

        # Build precise quarter-hour assignments internally. The response is
        # collapsed back to its existing hourly shape below.
        emp_ids = [s.employee_id for s in shifts]
        staff_skill = {
            sz.employee_id: sz
            for sz in StaffZone.objects.filter(employee_id__in=emp_ids)
        }
        store_open_minute = (11 if day == 'Sun' else 10) * 60
        interval_assignments = _build_interval_assignments(
            shifts,
            staff_skill,
            store_open_minute,
            [zone.lower() for zone in organization.zone_priority],
        )

        rows = []
        for shift in shifts:
            sh, sm = shift.start_time.hour, shift.start_time.minute
            eh, em = shift.end_time.hour, shift.end_time.minute
            shift_label = f"{_fmt(sh, sm)}-{_fmt(eh, em)}"

            zones = {}
            for h in WORKBOOK_HOURS:
                # Preserve the existing hourly response by using the first
                # complete quarter of this shift within the hour.
                for interval_start in range(h * 60, (h + 1) * 60, WORKBOOK_INTERVAL_MINUTES):
                    if not _shift_covers_interval(shift, interval_start):
                        continue
                    if shift.effective_role == 'BOH':
                        zones[str(h)] = 'BOH'
                    else:
                        zones[str(h)] = interval_assignments.get(interval_start, {}).get(
                            shift.employee_id,
                            shift.effective_role.upper(),
                        )
                    break

            raw = shift.employee.name
            employee = shift.employee
            if employee.workbook_name:
                display = employee.workbook_name.upper()
            else:
                first, last_initial = workbook_name_parts(raw)
                display = (
                    f"{first} {last_initial}"
                    if default_name_counts[first] > 1 and last_initial else first
                )

            rows.append({
                'shift_id': shift.id,
                'name': display,
                'full_name': raw,
                'shift': shift_label,
                'role': shift.effective_role,
                'zones': zones,
                'zone_overrides': {
                    str(hour): saved_overrides[(shift.id, hour)]
                    for hour in WORKBOOK_HOURS
                    if (shift.id, hour) in saved_overrides and str(hour) in zones
                },
            })

        from .kpi_service import build_kpi_payload
        return Response({
            'day': day,
            'date': str(target_date),
            'hours': WORKBOOK_HOURS,
            'col_headers': WORKBOOK_COL_HEADERS,
            'rows': rows,
            'kpi': build_kpi_payload(organization, target_date),
        })


class WorkbookZoneOverrideView(APIView):
    """Atomically set or clear saved hourly zone overrides for one workbook day."""
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _payload(organization, target_date):
        overrides = WorkbookZoneOverride.objects.filter(
            shift__employee__organization=organization,
            shift__date=target_date,
        ).order_by('shift_id', 'hour')
        values = [
            {'shift_id': item.shift_id, 'hour': item.hour, 'zone': item.zone}
            for item in overrides
        ]
        latest = overrides.order_by('-updated_at').values_list('updated_at', flat=True).first()
        return {
            'overrides': values,
            'updatedAt': latest.isoformat() if latest else timezone.now().isoformat(),
        }

    def patch(self, request, business_date):
        organization = organization_for_request(request)
        try:
            target_date = datetime.strptime(business_date, '%Y-%m-%d').date()
        except ValueError:
            return Response({'error': 'Invalid date.'}, status=status.HTTP_400_BAD_REQUEST)

        operations = [key for key in ('set', 'clear', 'reset_all') if key in request.data]
        if len(operations) != 1:
            return Response({'error': 'Provide exactly one zone operation.'}, status=status.HTTP_400_BAD_REQUEST)

        operation = operations[0]
        if operation == 'reset_all':
            if request.data[operation] is not True:
                return Response({'error': 'reset_all must be true.'}, status=status.HTTP_400_BAD_REQUEST)
            with transaction.atomic():
                WorkbookZoneOverride.objects.filter(
                    shift__employee__organization=organization,
                    shift__date=target_date,
                ).delete()
            return Response(self._payload(organization, target_date))

        body = request.data[operation]
        if not isinstance(body, dict) or not isinstance(body.get('cells'), list) or not body['cells']:
            return Response({'error': f'{operation}.cells must be a non-empty list.'}, status=status.HTTP_400_BAD_REQUEST)
        valid_zones = {choice[0] for choice in WORKBOOK_ZONE_CHOICES}
        zone = body.get('zone') if operation == 'set' else None
        if operation == 'set' and zone not in valid_zones:
            return Response({'error': 'Unknown zone.'}, status=status.HTTP_400_BAD_REQUEST)

        clean_cells = []
        try:
            for cell in body['cells']:
                if not isinstance(cell, dict) or isinstance(cell.get('shift_id'), bool) or isinstance(cell.get('hour'), bool):
                    raise ValueError
                clean_cells.append((int(cell['shift_id']), int(cell['hour'])))
        except (KeyError, TypeError, ValueError):
            return Response({'error': 'Each cell needs integer shift_id and hour values.'}, status=status.HTTP_400_BAD_REQUEST)
        clean_cells = list(dict.fromkeys(clean_cells))
        if any(hour not in WORKBOOK_HOURS for _, hour in clean_cells):
            return Response({'error': 'Cell hour is outside the workbook range.'}, status=status.HTTP_400_BAD_REQUEST)

        shifts = {
            shift.id: shift
            for shift in Shift.objects.select_related('employee').filter(
                id__in={shift_id for shift_id, _ in clean_cells},
                employee__organization=organization,
                date=target_date,
            )
        }
        if len(shifts) != len({shift_id for shift_id, _ in clean_cells}):
            return Response({'error': 'A cell does not belong to this organization and date.'}, status=status.HTTP_400_BAD_REQUEST)
        if any(not any(
            _shift_covers_interval(shifts[shift_id], minute)
            for minute in range(hour * 60, (hour + 1) * 60, WORKBOOK_INTERVAL_MINUTES)
        ) for shift_id, hour in clean_cells):
            return Response({'error': 'Cannot edit a blank workbook cell.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            if operation == 'clear':
                for shift_id, hour in clean_cells:
                    WorkbookZoneOverride.objects.filter(shift_id=shift_id, hour=hour).delete()
            else:
                for shift_id, hour in clean_cells:
                    WorkbookZoneOverride.objects.update_or_create(
                        shift_id=shift_id,
                        hour=hour,
                        defaults={'zone': zone, 'last_edited_by': request.user},
                    )
        return Response(self._payload(organization, target_date))


class KpiDayStateView(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _number(value, field):
        from decimal import Decimal, InvalidOperation
        if isinstance(value, bool) or value in (None, ''):
            raise ValueError(f'{field} must be a number.')
        try:
            number = Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ValueError(f'{field} must be a number.') from exc
        if not number.is_finite() or abs(number) > Decimal('1000000000000'):
            raise ValueError(f'{field} is outside the supported range.')
        return int(number) if number == number.to_integral_value() else float(number)

    def patch(self, request, business_date):
        from datetime import datetime
        from django.db import transaction
        from .kpi_service import GOAL_FIELDS, HOURLY_FIELDS, SEGMENT_HOURS, build_kpi_payload
        from .models import KpiDayState

        organization = organization_for_request(request)
        try:
            target_date = datetime.strptime(business_date, '%Y-%m-%d').date()
        except ValueError:
            return Response({'error': 'Invalid date.'}, status=status.HTTP_400_BAD_REQUEST)

        goal_updates = request.data.get('goal_updates', {})
        goal_resets = request.data.get('goal_resets', [])
        hourly_updates = request.data.get('hourly_updates', {})
        if not isinstance(goal_updates, dict) or not isinstance(goal_resets, list) or not isinstance(hourly_updates, dict):
            return Response({'error': 'Invalid KPI update payload.'}, status=status.HTTP_400_BAD_REQUEST)
        if any(key not in GOAL_FIELDS for key in goal_updates) or any(key not in GOAL_FIELDS for key in goal_resets):
            return Response({'error': 'Unknown goal field.'}, status=status.HTTP_400_BAD_REQUEST)

        clean_goals = {}
        clean_hourly = {}
        try:
            for key, value in goal_updates.items():
                clean_goals[key] = self._number(value, key)
            for hour, values in hourly_updates.items():
                if hour not in SEGMENT_HOURS or not isinstance(values, dict):
                    raise ValueError('Unknown hourly segment.')
                clean_hourly[hour] = {}
                for key, value in values.items():
                    if key not in HOURLY_FIELDS:
                        raise ValueError('Unknown hourly KPI field.')
                    if key == 'cel':
                        if value is None or value == '':
                            clean_hourly[hour][key] = None
                            continue
                        if not isinstance(value, str) or len(value.strip()) > 16 or any(ord(char) < 32 for char in value):
                            raise ValueError('cel must be text up to 16 characters.')
                        clean_hourly[hour][key] = value.strip()
                    elif value is None or value == '':
                        clean_hourly[hour][key] = None
                    else:
                        number = self._number(value, key)
                        if key == 'pct' and not 0 <= number <= 100:
                            raise ValueError('pct must be between 0 and 100.')
                        if key in {'traffic', 'transactions'} and number < 0:
                            raise ValueError(f'{key} cannot be negative.')
                        clean_hourly[hour][key] = number
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            KpiDayState.objects.get_or_create(organization=organization, business_date=target_date)
            state = KpiDayState.objects.select_for_update().get(
                organization=organization, business_date=target_date,
            )
            goals = dict(state.goal_overrides or {})
            hourly = dict(state.hourly_values or {})
            for key in goal_resets:
                goals.pop(key, None)
            goals.update(clean_goals)
            for hour, values in clean_hourly.items():
                segment = dict(hourly.get(hour, {}))
                for key, value in values.items():
                    if value is None:
                        segment.pop(key, None)
                    else:
                        segment[key] = value
                if segment:
                    hourly[hour] = segment
                else:
                    hourly.pop(hour, None)
            state.goal_overrides = goals
            state.hourly_values = hourly
            state.revision += 1
            state.last_edited_by = request.user
            state.save(update_fields=['goal_overrides', 'hourly_values', 'revision', 'last_edited_by', 'updated_at'])
        return Response(build_kpi_payload(organization, target_date))


class StaffZoneView(APIView):
    """GET /api/schedule/staff/ — list all employees with zone levels.
    PATCH /api/schedule/staff/<employee_id>/ — update zone fields."""
    permission_classes = [IsAuthenticated]

    def get(self, request, employee_id=None):
        organization = organization_for_request(request)
        # Auto-create StaffZone rows for any Employee that lacks one
        employees = Employee.objects.filter(organization=organization).order_by('name')
        for emp in employees:
            StaffZone.objects.get_or_create(employee=emp)
        zones = StaffZone.objects.select_related('employee').filter(employee__organization=organization).order_by('employee__name')
        return Response(StaffZoneSerializer(zones, many=True).data)

    def patch(self, request, employee_id):
        organization = organization_for_request(request)
        try:
            zone = StaffZone.objects.get(employee_id=employee_id, employee__organization=organization)
        except StaffZone.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        if isinstance(request.data, dict) and 'workbook_name' in request.data and not request.user.is_staff:
            return Response(
                {'error': 'Only administrators may change workbook_name'},
                status=status.HTTP_403_FORBIDDEN,
            )
        allowed_fields = set(ZONE_FIELDS) | {'role_override', 'preferred_zone'}
        if isinstance(request.data, dict) and 'workbook_name' in request.data and request.user.is_staff:
            allowed_fields.add('workbook_name')
        if not isinstance(request.data, dict) or not request.data or set(request.data) - allowed_fields:
            return Response({
                'error': 'Only zone levels, preferred_zone, role_override, and staff-only workbook_name may be changed',
            }, status=status.HTTP_400_BAD_REQUEST)

        zone_updates = {}
        for field in ZONE_FIELDS:
            if field not in request.data:
                continue
            try:
                value = int(request.data[field])
            except (TypeError, ValueError):
                return Response({'error': f'{field} must be an integer from 0 to 3'}, status=status.HTTP_400_BAD_REQUEST)
            if value not in range(4):
                return Response({'error': f'{field} must be from 0 to 3'}, status=status.HTTP_400_BAD_REQUEST)
            zone_updates[field] = value

        if 'preferred_zone' in request.data:
            preferred_zone = request.data['preferred_zone']
            valid_preferences = {choice[0] for choice in StaffZone._meta.get_field('preferred_zone').choices}
            if preferred_zone not in valid_preferences:
                return Response(
                    {'error': 'preferred_zone must be auto, mens, womens, cash, fits, greet, or boh'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            zone_updates['preferred_zone'] = preferred_zone

        workbook_name = None
        if 'workbook_name' in request.data:
            workbook_name = request.data['workbook_name']
            if not isinstance(workbook_name, str):
                return Response({'error': 'workbook_name must be a string'}, status=status.HTTP_400_BAD_REQUEST)
            if any(unicodedata.category(character) == 'Cc' for character in workbook_name):
                return Response({'error': 'workbook_name cannot contain control characters'}, status=status.HTTP_400_BAD_REQUEST)
            workbook_name = ' '.join(workbook_name.split())
            if len(workbook_name) > 64:
                return Response({'error': 'workbook_name must be at most 64 characters'}, status=status.HTTP_400_BAD_REQUEST)

        if 'role_override' in request.data:
            role_override = request.data['role_override']
            valid_roles = {choice[0] for choice in Employee.ROLE_OVERRIDE_CHOICES}
            if role_override not in valid_roles:
                return Response({'error': 'role_override must be auto, associate, management, or non_active'}, status=status.HTTP_400_BAD_REQUEST)
            zone.employee.role_override = role_override
            zone.employee.save(update_fields=['role_override'])

        if workbook_name is not None:
            zone.employee.workbook_name = workbook_name
            zone.employee.save(update_fields=['workbook_name'])

        for field, value in zone_updates.items():
            setattr(zone, field, value)
        if zone_updates:
            zone.save(update_fields=list(zone_updates))
        return Response(StaffZoneSerializer(zone).data)

    def delete(self, request, employee_id):
        if not request.user.is_staff:
            return Response({'error': 'Only administrators may remove employees'}, status=status.HTTP_403_FORBIDDEN)
        organization = organization_for_request(request)
        employee = Employee.objects.filter(pk=employee_id, organization=organization).first()
        if employee is None:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        employee.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
