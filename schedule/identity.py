import re
import unicodedata

from .models import Employee


def workbook_name_parts(value):
    """Return an uppercase first name and last initial from a familiar full name.

    Supports Kronos ``Last, First`` names and ordinary ``First Last`` names.
    A single token is treated as a first name; unfamiliar punctuation is left
    alone rather than guessed at.
    """
    cleaned = re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(value or ''))).strip()
    if not cleaned:
        return '', ''

    if cleaned.count(',') == 1:
        last, first = (part.strip() for part in cleaned.split(',', 1))
        if first and last:
            first_name = first.split(' ', 1)[0]
            return first_name.upper(), last[0].upper()

    parts = cleaned.split(' ')
    first_name = parts[0]
    last_initial = parts[-1][0].upper() if len(parts) > 1 else ''
    return first_name.upper(), last_initial


def default_workbook_name(value):
    """Return the default uppercase first name for a workbook row."""
    first_name, _ = workbook_name_parts(value)
    return first_name


def canonical_employee_name(value):
    """Conservative identity key; supports Kronos `Last, First` display names."""
    cleaned = re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(value or ''))).strip()
    if cleaned.count(',') == 1:
        last, first = (part.strip() for part in cleaned.split(',', 1))
        if first and last:
            cleaned = f'{first} {last}'
    return cleaned.casefold()


def employee_summary(employee):
    if employee is None:
        return None
    return {'id': employee.id, 'name': employee.name, 'primary_job': employee.primary_job}


def find_employee_by_name(organization, name):
    exact = Employee.objects.filter(organization=organization, name=name).first()
    if exact:
        return exact
    key = canonical_employee_name(name)
    matches = [
        employee for employee in Employee.objects.filter(organization=organization)
        if canonical_employee_name(employee.name) == key
    ]
    if len(matches) > 1:
        raise ValueError(f'Employee name {name!r} matches multiple employees.')
    return matches[0] if matches else None
