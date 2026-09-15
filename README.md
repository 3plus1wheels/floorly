# Floorly

React schedule workbook with Django/PostgreSQL backend. Kronos import runs from minimal Chrome extension against user’s already-authenticated Kronos tab. XLSX remains CLI recovery path.

## First start

Requirement: Docker Desktop.

```bash
cp .env.example .env
docker compose up --build
```

Open <http://localhost:3000>. Backend health: <http://localhost:8000/health/>.

Create first platform admin:

```bash
docker compose exec backend python manage.py createsuperuser
```

Sign in, open **Admin**, create organization, then create users with temporary passwords. Users must change temporary password at first login. Database persists in `postgres-data` volume.

```bash
docker compose down
```

`docker compose down --volumes` also erases local database.

## Kronos Chrome extension

Extension stores no credentials, cookies, browser profiles, or Floorly access tokens. User completes Kronos SSO/MFA in normal Chrome. Each import uses five-minute, organization-scoped ticket.

### Local development

Requirements: Chrome desktop, Node.js 20+, `zip` command.

```bash
npm install
npm run extension:build
```

Then:

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `extension/dist`.
2. Copy extension ID shown by Chrome into `.env` as `REACT_APP_FLOORLY_EXTENSION_ID`.
3. Rebuild app: `docker compose up --build`.
4. Log into Kronos in normal Chrome and open **My Location Schedule**.
5. Open same week in Floorly and Kronos, then click **Import from Kronos**.

Import is not tied to current week. Floorly sends selected week, extension verifies Kronos date headers match, then replaces only that week. If weeks differ, nothing uploads. If no Kronos tab exists, first click opens fixed schedule URL; log in, choose week, wait for rows, then retry.

Changing extension code requires `npm run extension:build`, then **Reload** on `chrome://extensions`. Changing extension ID requires frontend rebuild.

### Production / unlisted Chrome Web Store

Production web origin is `https://floorly.vovanguyen.com`. Keep `DJANGO_ENV=production`, `DEBUG=False`, a random 50+ character `SECRET_KEY`, exact host/origin values, and HTTPS proxy settings in the deployment secret manager. Start from [.env.production.example](.env.production.example); never commit its replacements. Public liveness is `/health/`; `/ready/` checks database connectivity and returns 503 until database is usable.

Build with exact deployed domains and bumped version:

```bash
BUILD_MODE=production \
FLOORLY_WEB_ORIGINS=https://floorly.vovanguyen.com \
FLOORLY_API_ORIGINS=https://floorly.vovanguyen.com \
KRONOS_ALLOWED_ORIGINS=https://levistrauss-sso.prd.mykronos.com \
KRONOS_SCHEDULE_URL='https://levistrauss-sso.prd.mykronos.com/ess#/3009002/location-schedule' \
EXTENSION_VERSION=1.0.1 \
npm run extension:build
```

Upload generated `extension/floorly-kronos-1.0.1.zip` as unlisted Chrome Web Store release. Manifest grants only exact Floorly, backend, and Kronos origins; no cookies, history, `<all_urls>`, or broad `tabs` permission.

After Web Store assigns stable ID, set these Vercel build variables and redeploy frontend:

```env
REACT_APP_FLOORLY_EXTENSION_ID=assigned_extension_id
REACT_APP_FLOORLY_EXTENSION_STORE_URL=https://chromewebstore.google.com/detail/assigned_extension_id
REACT_APP_API_BASE_URL=
```

Domain changes require new extension build/review because allowed origins are compiled into manifest. Full config examples: [.env.example](.env.example).

Run `python manage.py purge_schedule_data` once per day from the production scheduler. Use `--dry-run` to verify the cutoff and `--organization-id` to scope an operational check. Shift records older than 12 months are deleted; encrypted database backups must expire within 30 days.

If Compose warns that part of a secret “variable is not set,” single-quote that `.env` value; unquoted `$NAME` is Compose interpolation.

## Tests

```bash
npm test
npm --prefix frontend test -- --watchAll=false
npm --prefix frontend run build
docker compose exec backend python manage.py test
```

Extension package smoke test:

```bash
npm run extension:build
```

## XLSX recovery import

Web upload remains disabled.

```bash
docker compose exec backend python manage.py import_schedule /path/in/container/schedule.xlsx --organization-id 1
```

Use `--clear` only when selected organization’s shifts should be removed first.

## Containers

- `frontend`: React build served by Nginx on port 3000; proxies `/api/` to Django.
- `backend`: Django/Gunicorn on port 8000; applies migrations and collects static files on startup.
- `db`: PostgreSQL 17 with persistent volume.
