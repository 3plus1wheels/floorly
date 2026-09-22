# Floorly

React schedule workbook with Django backend and Neon Postgres. Kronos import runs from minimal Chrome extension against user’s already-authenticated Kronos tab. XLSX remains CLI recovery path.

## First start

Requirements: Docker Desktop and a Neon project.

```bash
cp .env.example .env
# Add both connection strings from Neon's Connect dialog:
# DATABASE_URL uses the pooled (-pooler) hostname.
# DATABASE_URL_UNPOOLED uses the direct hostname.
docker compose up --build
```

Open <http://localhost:3000>. Backend health: <http://localhost:8000/health/>. Database readiness: <http://localhost:8000/ready/>.

The backend uses `DATABASE_URL` for normal request traffic. Its startup script uses `DATABASE_URL_UNPOOLED` only while applying Django migrations, then starts Gunicorn with the pooled URL. Startup fails immediately if either value is missing.

Optional: link the checkout to the same Neon project and pull branch-specific environment variables with the Neon CLI. `neon link` writes local project metadata to `.neon` and pulls the selected branch environment by default.

```bash
npx neon@latest link
```

Create first platform admin:

```bash
docker compose exec backend python manage.py createsuperuser
```

Sign in, open **Admin**, create organization, then create users with temporary passwords. Users must change temporary password at first login. All database state persists in Neon; stopping or rebuilding Compose does not remove it.

```bash
docker compose down
```

## Kronos Edge extension

Extension stores no credentials, cookies, browser profiles, or Floorly access tokens. User completes Kronos SSO/MFA in normal Edge. Each import uses a five-minute, organization-scoped ticket.

### Local development

Requirements: Microsoft Edge desktop, Node.js 20+, `zip` command.

```bash
npm install
npm run extension:build
```

Then:

1. Copy the built `extension/dist` folder to a stable location on the Edge computer. Keep the whole folder together, with `manifest.json` directly inside it. Do not select the ZIP or the parent `extension` folder.
2. Open `edge://extensions`, enable **Developer mode**, click **Load unpacked**, and select that exact folder.
3. Confirm Edge shows extension ID `picamnkkmfkicagkibpednpkjbdioodh`. Floorly uses this ID by default; set `REACT_APP_FLOORLY_EXTENSION_ID` to this value in any explicit frontend build configuration, then rebuild the frontend.
4. Log into Kronos in the same Edge profile and open **My Location Schedule**.
5. Open the same week in Floorly and Kronos, then click **Import from Kronos**.

Import is not tied to current week. Floorly sends the selected week, and the extension verifies Kronos date headers match, then replaces only that week. If weeks differ, nothing uploads. If no Kronos tab exists, the first click opens the generic Kronos entry page; log in, navigate to **My Location Schedule**, choose the week, wait for rows, then retry. The account context in the Kronos URL is discovered from the open tab.

Changing extension code requires `npm run extension:build`, copying the updated `dist` contents to the same Edge folder, then **Reload** on `edge://extensions`. If Edge says the manifest is missing or unreadable, check that the selected folder contains the generated `manifest.json`. If Edge reports an administrator restriction, use your company's approved extension distribution process. Changing the public key changes the extension ID and requires a frontend rebuild.

### Production / future store release

Production web origin is `https://floorly.vovanguyen.com`. Keep `DJANGO_ENV=production`, `DEBUG=False`, a random 50+ character `SECRET_KEY`, both Neon connection URLs, exact host/origin values, and HTTPS proxy settings in the deployment secret manager. Use the pooled Neon URL for `DATABASE_URL` and its matching direct URL for `DATABASE_URL_UNPOOLED`. Start from [.env.production.example](.env.production.example); never commit its replacements. Public liveness is `/health/`; `/ready/` checks Neon connectivity and returns 503 until the database is usable.

Build with exact deployed domains and bumped version:

```bash
BUILD_MODE=production \
FLOORLY_WEB_ORIGINS=https://floorly.vovanguyen.com \
FLOORLY_API_ORIGINS=https://floorly.vovanguyen.com \
KRONOS_ALLOWED_ORIGINS=https://levistrauss-sso.prd.mykronos.com \
KRONOS_SCHEDULE_URL='https://levistrauss-sso.prd.mykronos.com/ess#/' \
EXTENSION_VERSION=1.0.4 \
npm run extension:build
```

For Edge **Load unpacked**, distribute the generated `extension/dist` folder. The ZIP (`extension/floorly-kronos-1.0.4.zip`) is for a later store submission, not for **Load unpacked**. Manifest grants only configured Floorly, backend, and Kronos origins; no cookies, history, `<all_urls>`, or broad `tabs` permission. `extension/public-key.txt` is the public identity key; no private key is stored in this repository. A future store-assigned ID may differ, so verify it before changing the frontend configuration.

For the unpacked Edge build, set these frontend build variables and redeploy if they are managed outside this repository:

```env
REACT_APP_FLOORLY_EXTENSION_ID=picamnkkmfkicagkibpednpkjbdioodh
REACT_APP_FLOORLY_EXTENSION_STORE_URL=
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
docker compose exec -e DATABASE_URL=sqlite:////tmp/floorly-tests.sqlite3 backend python manage.py test
```

CI runs Django tests with SQLite so tests never modify Neon. To use the same database isolation locally:

```bash
DATABASE_URL=sqlite:////tmp/floorly-tests.sqlite3 .venv/bin/python manage.py test
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
- `backend`: Django/Gunicorn on port 8000; applies migrations through the direct Neon connection, then serves requests through the pooled Neon connection.
