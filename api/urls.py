from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ItemViewSet
from .auth_views import AdminMembershipView, AdminOrganizationDetailView, AdminOrganizationListCreateView, AdminResetPasswordView, AdminUserDetailView, AdminUserListCreateView
from .kpi_views import AdminKpiImportView

router = DefaultRouter()
router.register(r'items', ItemViewSet, basename='item')

urlpatterns = [
    path('', include(router.urls)),
    path('admin/organizations/', AdminOrganizationListCreateView.as_view()),
    path('admin/organizations/<int:pk>/', AdminOrganizationDetailView.as_view()),
    path('admin/organizations/<int:organization_id>/members/', AdminMembershipView.as_view()),
    path('admin/organizations/<int:organization_id>/members/<int:user_id>/', AdminMembershipView.as_view()),
    path('admin/organizations/<int:organization_id>/kpi-imports/', AdminKpiImportView.as_view()),
    path('admin/users/', AdminUserListCreateView.as_view()),
    path('admin/users/<int:pk>/', AdminUserDetailView.as_view()),
    path('admin/users/<int:pk>/reset-password/', AdminResetPasswordView.as_view()),
]
