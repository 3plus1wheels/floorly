#!/bin/sh
set -eu

python manage.py migrate --noinput
python manage.py collectstatic --noinput

if [ "${1:-}" = "gunicorn" ]; then
    exec "$@" \
        --bind "0.0.0.0:${PORT:-8000}" \
        --workers "${GUNICORN_WORKERS:-3}" \
        --timeout "${GUNICORN_TIMEOUT:-60}" \
        --access-logfile - \
        --error-logfile -
fi

exec "$@"
