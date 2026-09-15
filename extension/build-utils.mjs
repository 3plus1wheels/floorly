export const PRODUCTION_WEB_ORIGIN = 'https://floorly.vovanguyen.com';

export function isSemver(value) {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

export function assertBuildConfig({ mode, version, webOrigins, apiOrigins, kronosOrigins, kronosScheduleUrl }) {
  if (!isSemver(version)) throw new Error(`Invalid EXTENSION_VERSION: ${version || '(missing)'}`);
  if (mode !== 'production') return;
  if (webOrigins.length !== 1 || webOrigins[0] !== PRODUCTION_WEB_ORIGIN) {
    throw new Error(`Production build requires FLOORLY_WEB_ORIGINS=${PRODUCTION_WEB_ORIGIN}`);
  }
  for (const [name, origins] of [['FLOORLY_API_ORIGINS', apiOrigins], ['KRONOS_ALLOWED_ORIGINS', kronosOrigins]]) {
    if (!origins.length || origins.some(origin => !origin.startsWith('https://'))) throw new Error(`Production build requires HTTPS ${name}`);
  }
  if (webOrigins.some(origin => /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin))) throw new Error('Production build cannot use localhost origins');
  const scheduleUrl = new URL(kronosScheduleUrl);
  if (scheduleUrl.protocol !== 'https:' || scheduleUrl.pathname !== '/ess' || !scheduleUrl.hash.includes('location-schedule')) {
    throw new Error('Production KRONOS_SCHEDULE_URL must be the full HTTPS location-schedule URL');
  }
}

export function contentMatch(origin, pathname) {
  const url = new URL(origin);
  const path = `${pathname.replace(/\*+$/, '')}*`;
  return `${url.protocol}//${url.hostname}${path}`;
}
