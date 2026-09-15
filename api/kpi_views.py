from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from schedule.kpi_import import KpiImportError, import_kpi_pair, serialize_import_batch
from schedule.models import KpiImportBatch

from .models import Organization


class AdminKpiImportView(APIView):
    permission_classes = (IsAdminUser,)

    def get(self, request, organization_id):
        organization = get_object_or_404(Organization, pk=organization_id)
        batches = KpiImportBatch.objects.filter(organization=organization).select_related('imported_by__profile')[:20]
        return Response([serialize_import_batch(batch) for batch in batches])

    def post(self, request, organization_id):
        organization = get_object_or_404(Organization, pk=organization_id)
        current_file = request.FILES.get('current_year_file')
        prior_file = request.FILES.get('prior_year_file')
        if current_file is None or prior_file is None:
            return Response(
                {'error': 'Both current_year_file and prior_year_file are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            batch = import_kpi_pair(organization, current_file, prior_file, request.user)
        except KpiImportError as exc:
            return Response(
                {'code': 'invalid_kpi_workbooks', 'error': str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(serialize_import_batch(batch), status=status.HTTP_201_CREATED)
