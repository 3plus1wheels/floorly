from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .auth_views import ChangePasswordView, ThemePreferenceView, UserDetailView

urlpatterns = [
    path('login/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('user/', UserDetailView.as_view(), name='user_detail'),
    path('change-password/', ChangePasswordView.as_view(), name='change_password'),
    path('theme/', ThemePreferenceView.as_view(), name='theme_preference'),
]
