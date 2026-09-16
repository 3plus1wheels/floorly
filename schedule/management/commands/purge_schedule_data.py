from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from schedule.models import ScheduleSyncTokenUse, Shift


def retention_cutoff(today):
    try:
        return today.replace(year=today.year - 1)
    except ValueError:
        return today.replace(year=today.year - 1, day=28)


class Command(BaseCommand):
    help = 'Delete shift records older than the 12-month retention window.'

    def add_arguments(self, parser):
        parser.add_argument('--before', help='Override cutoff date (YYYY-MM-DD).')
        parser.add_argument('--organization-id', type=int, help='Limit purge to one organization.')
        parser.add_argument('--dry-run', action='store_true', help='Report count without deleting records.')

    def handle(self, *args, **options):
        if options['before']:
            try:
                cutoff = date.fromisoformat(options['before'])
            except ValueError as exc:
                raise CommandError('--before must be YYYY-MM-DD.') from exc
        else:
            cutoff = retention_cutoff(timezone.localdate())

        shifts = Shift.objects.filter(date__lt=cutoff)
        if options['organization_id'] is not None:
            shifts = shifts.filter(employee__organization_id=options['organization_id'])
        count = shifts.count()
        expired_token_uses = ScheduleSyncTokenUse.objects.filter(
            consumed_at__lt=timezone.now() - timedelta(days=1),
        )
        token_count = expired_token_uses.count()

        if options['dry_run']:
            self.stdout.write(
                f'Would delete {count} shift record(s) before {cutoff.isoformat()} '
                f'and {token_count} expired token-use record(s).'
            )
            return

        with transaction.atomic():
            deleted, _ = shifts.delete()
            deleted_token_uses, _ = expired_token_uses.delete()
        self.stdout.write(self.style.SUCCESS(
            f'Deleted {deleted} shift record(s) before {cutoff.isoformat()} '
            f'and {deleted_token_uses} expired token-use record(s).'
        ))
