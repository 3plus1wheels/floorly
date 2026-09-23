from django.urls import path
from .views import CurrentEmployeeView, EmployeeListView, KpiDayStateView, ScheduleSyncTicketView, ScheduleSyncView, ShiftDetailView, ShiftListView, StaffZoneView, WorkbookView, WorkbookZoneOverrideView, WorkbookPromoRowsView

urlpatterns = [
    path('shifts/', ShiftListView.as_view(), name='shift_list'),
    path('shifts/<int:shift_id>/', ShiftDetailView.as_view(), name='shift_detail'),
    path('employees/', EmployeeListView.as_view(), name='employee_list'),
    path('kronos-sync/', ScheduleSyncView.as_view(), name='schedule_sync'),
    path('sync-ticket/', ScheduleSyncTicketView.as_view(), name='schedule_sync_ticket'),
    path('me/employee/', CurrentEmployeeView.as_view(), name='current_employee'),
    path('workbook/', WorkbookView.as_view(), name='workbook'),
    path('workbook-zones/<str:business_date>/', WorkbookZoneOverrideView.as_view(), name='workbook_zone_overrides'),
    path('workbook-promos/<str:business_date>/', WorkbookPromoRowsView.as_view(), name='workbook_promo_rows'),
    path('kpi-days/<str:business_date>/', KpiDayStateView.as_view(), name='kpi_day_state'),
    path('staff/', StaffZoneView.as_view(), name='staff_zones'),
    path('staff/<int:employee_id>/', StaffZoneView.as_view(), name='staff_zone_update'),
]
