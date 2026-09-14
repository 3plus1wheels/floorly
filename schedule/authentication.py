from datetime import timedelta

from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import Token


class ScheduleSyncToken(Token):
    token_type = 'schedule_sync'
    lifetime = timedelta(minutes=5)


class ScheduleSyncAuthentication(JWTAuthentication):
    """Accept only short-lived, schedule-scoped extension tickets."""

    def authenticate(self, request):
        header = request.META.get('HTTP_AUTHORIZATION', '')
        parts = header.split()
        if not parts or parts[0].lower() != 'schedulesync':
            return None
        if len(parts) != 2:
            raise AuthenticationFailed(_('Invalid schedule sync authorization header.'))
        try:
            token = ScheduleSyncToken(parts[1])
        except TokenError as exc:
            raise AuthenticationFailed(_('Schedule sync ticket is invalid or expired.')) from exc
        return self.get_user(token), token

    def authenticate_header(self, request):
        return 'ScheduleSync realm="api"'
