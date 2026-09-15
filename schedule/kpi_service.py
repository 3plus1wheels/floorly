from decimal import Decimal

from .models import KpiDailyRecord, KpiDayState, KpiPeriodRecord


GOAL_FIELDS = {
    'daySalesTarget', 'stretchTarget', 'lastYearSales', 'lastYearTraffic',
    'trafficTrend', 'transactionGoal', 'conversionTarget', 'upt', 'atv',
    'monthSalesPlan', 'monthToDateSales',
}
HOURLY_FIELDS = {'pct', 'actual', 'traffic', 'transactions', 'upt', 'atv', 'other', 'cel'}
SEGMENT_HOURS = tuple(str(hour) for hour in range(10, 21))
DEFAULT_CONTRIBUTIONS = (3, 6, 8, 9, 12, 15, 12, 9, 9, 9, 8)


def _json_number(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return value


def _round_number(value):
    return int(Decimal(str(value)).quantize(Decimal('1')))


def build_kpi_payload(organization, business_date):
    current = (
        KpiDailyRecord.objects.select_related('import_batch')
        .filter(organization=organization, business_date=business_date)
        .first()
    )
    prior = None
    period = None
    if current:
        prior = KpiDailyRecord.objects.filter(
            organization=organization,
            fiscal_year=current.fiscal_year - 1,
            fiscal_period=current.fiscal_period,
            fiscal_week=current.fiscal_week,
            weekday=current.weekday,
        ).first()
        period = KpiPeriodRecord.objects.filter(
            organization=organization,
            fiscal_year=current.fiscal_year,
            fiscal_period=current.fiscal_period,
        ).first()

    base = {
        'daySalesTarget': _json_number(current.day_target) if current else None,
        'stretchTarget': None,
        'lastYearSales': _json_number(prior.sales) if prior else None,
        'lastYearTraffic': prior.traffic if prior else None,
        'trafficTrend': None,
        'transactionGoal': None,
        'conversionTarget': _json_number(prior.conversion * 100) if prior and prior.conversion is not None else None,
        'upt': _json_number(prior.upt) if prior else None,
        'atv': _json_number(prior.atv) if prior else None,
        'monthSalesPlan': _json_number(period.sales_plan) if period else None,
        'monthToDateSales': _json_number(period.mtd_sales) if period else None,
    }
    sources = {
        key: ('imported_prior' if key in {'lastYearSales', 'lastYearTraffic', 'conversionTarget', 'upt', 'atv'} else 'imported_current')
        if value is not None else 'missing'
        for key, value in base.items()
    }
    state = (
        KpiDayState.objects.select_related('last_edited_by__profile')
        .filter(organization=organization, business_date=business_date)
        .first()
    )
    overrides = dict(state.goal_overrides) if state else {}
    goals = dict(base)
    for key, value in overrides.items():
        if key in GOAL_FIELDS:
            goals[key] = value
            sources[key] = 'manual'

    last_year_traffic = goals.get('lastYearTraffic')
    traffic_trend = goals.get('trafficTrend')
    if last_year_traffic is not None and traffic_trend is not None:
        goals['projectedTraffic'] = _round_number(
            Decimal(str(last_year_traffic)) * (Decimal('1') + Decimal(str(traffic_trend)) / 100),
        )
        sources['projectedTraffic'] = 'calculated'
    else:
        goals['projectedTraffic'] = None
        sources['projectedTraffic'] = 'missing'

    if 'transactionGoal' not in overrides:
        projected = goals.get('projectedTraffic')
        conversion = goals.get('conversionTarget')
        if projected is not None and conversion is not None:
            goals['transactionGoal'] = _round_number(
                Decimal(str(projected)) * Decimal(str(conversion)) / 100,
            )
            sources['transactionGoal'] = 'calculated'

    plan = goals.get('monthSalesPlan')
    actual = goals.get('monthToDateSales')
    if plan not in (None, 0) and actual is not None:
        goals['percentToMonthSalesPlan'] = float(Decimal(str(actual)) / Decimal(str(plan)) * 100)
        goals['monthToGo'] = float(Decimal(str(plan)) - Decimal(str(actual)))
        sources['percentToMonthSalesPlan'] = 'calculated'
        sources['monthToGo'] = 'calculated'
    else:
        goals['percentToMonthSalesPlan'] = None
        goals['monthToGo'] = None
        sources['percentToMonthSalesPlan'] = 'missing'
        sources['monthToGo'] = 'missing'

    saved_hourly = dict(state.hourly_values) if state else {}
    hourly = {}
    for index, hour in enumerate(SEGMENT_HOURS):
        hourly[hour] = {
            'pct': DEFAULT_CONTRIBUTIONS[index],
            'actual': None, 'traffic': None, 'transactions': None,
            'upt': None, 'atv': None, 'other': None, 'cel': '',
            **saved_hourly.get(hour, {}),
        }

    batch = current.import_batch if current else None
    last_editor = None
    if state and state.last_edited_by:
        profile = getattr(state.last_edited_by, 'profile', None)
        last_editor = {
            'id': state.last_edited_by_id,
            'username': state.last_edited_by.username,
            'fullName': profile.full_name if profile else state.last_edited_by.get_full_name(),
        }

    return {
        'date': business_date.isoformat(),
        'comparisonDate': prior.business_date.isoformat() if prior else None,
        'goals': goals,
        'baseGoals': base,
        'sources': sources,
        'overrides': sorted(key for key in overrides if key in GOAL_FIELDS),
        'hourly': hourly,
        'revision': state.revision if state else 0,
        'lastEditor': last_editor,
        'updatedAt': state.updated_at.isoformat() if state else None,
        'import': {
            'id': batch.id,
            'fiscalYear': current.fiscal_year,
            'importedAt': batch.imported_at.isoformat(),
            'status': batch.status,
        } if batch else None,
    }
