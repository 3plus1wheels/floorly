from rest_framework.exceptions import APIException, PermissionDenied
from .models import Organization


class OrganizationRequired(APIException):
    status_code = 400
    default_detail = {'code': 'organization_required', 'detail': 'Organization header is required.'}
    default_code = 'organization_required'


def organization_for_request(request):
    profile = getattr(request.user, 'profile', None)
    if profile and profile.must_change_password:
        raise PermissionDenied('Password change required.')
    raw_id = request.headers.get('X-Organization-ID')
    if not raw_id:
        raise OrganizationRequired()
    try:
        organization = Organization.objects.get(pk=int(raw_id), is_active=True)
    except (TypeError, ValueError, Organization.DoesNotExist) as exc:
        raise PermissionDenied('Organization is unavailable.') from exc
    if not request.user.is_staff and not organization.memberships.filter(user=request.user).exists():
        raise PermissionDenied('You do not belong to this organization.')
    return organization
