"""
management/commands/import_schedule.py
----------------------------------------
Django management command that parses an XLSX schedule file and upserts
Employee + Shift records into Postgres.

Usage:
    python manage.py import_schedule path/to/schedule.xlsx --organization-id ID [--clear]

Options:
    --clear   Delete selected organization's existing Shift records before importing.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.models import Organization
from schedule.models import Employee, Shift
from schedule.parsers import parse_schedule_xlsx


class Command(BaseCommand):
    help = "Import an employee schedule from an XLSX file into the database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--organization-id",
            type=int,
            required=True,
            help="Organization receiving imported schedule data.",
        )
        parser.add_argument(
            "xlsx_path",
            type=str,
            help="Path to the XLSX schedule file.",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            default=False,
            help="Delete all existing Shift records before importing.",
        )

    def handle(self, *args, **options):
        filepath = options["xlsx_path"]
        try:
            organization = Organization.objects.get(pk=options['organization_id'], is_active=True)
        except Organization.DoesNotExist as exc:
            raise CommandError('Active organization not found.') from exc

        try:
            records = parse_schedule_xlsx(filepath)
        except FileNotFoundError:
            raise CommandError(f"File not found: {filepath}")
        except Exception as exc:
            raise CommandError(f"Failed to parse XLSX: {exc}") from exc

        if not records:
            self.stdout.write(self.style.WARNING("No shifts found in file."))
            return

        with transaction.atomic():
            if options["clear"]:
                deleted, _ = Shift.objects.filter(employee__organization=organization).delete()
                self.stdout.write(f"Cleared {deleted} existing shift(s).")

            employees_created = 0
            shifts_created = 0
            shifts_updated = 0

            for record in records:
                if not record.get("date"):
                    continue

                employee, created = Employee.objects.update_or_create(
                    organization=organization,
                    name=record["employee_name"],
                    defaults={"primary_job": record["primary_job"]},
                )
                if created:
                    employees_created += 1

                _, shift_created = Shift.objects.update_or_create(
                    employee=employee,
                    date=record["date"],
                    start_time=record["start_time"],
                    defaults={
                        "end_time": record["end_time"],
                        "day_label": record["day_label"],
                        "role": record["role"],
                    },
                )
                if shift_created:
                    shifts_created += 1
                else:
                    shifts_updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Employees: {employees_created} new. "
                f"Shifts: {shifts_created} created, {shifts_updated} updated."
            )
        )
