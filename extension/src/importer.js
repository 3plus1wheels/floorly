import { detectVisibleWeekStart, parseGridSnapshots, validateWeek } from './extractor.js';

export const LIMITS = Object.freeze({ maxTicketLength: 512, maxSnapshots: 200, maxRows: 5000, maxCells: 50000, maxTitles: 100000, maxPayloadBytes: 5 * 1024 * 1024, maxShifts: 5000 });
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
const isScheduleRoute = hash => /^#\/(?:[^/?#]+\/)*location-schedule\/?(?:\?.*)?$/.test(hash);
const withinLimits = capture => {
  if (!capture || !Array.isArray(capture.snapshots) || capture.snapshots.length > LIMITS.maxSnapshots) return false;
  let rows = 0; let cells = 0; let titles = 0;
  for (const snapshot of capture.snapshots) {
    rows += Array.isArray(snapshot?.rows) ? snapshot.rows.length : 0;
    for (const row of snapshot?.rows || []) for (const cell of row?.cells || []) { cells += 1; titles += Array.isArray(cell?.titles) ? cell.titles.length : 0; }
  }
  return rows <= LIMITS.maxRows && cells <= LIMITS.maxCells && titles <= LIMITS.maxTitles && JSON.stringify(capture).length <= LIMITS.maxPayloadBytes;
};

export function createImporter({ chromeApi, fetchImpl, config, now = () => new Date() }) {
  return async function importSchedule(message, sender) {
    const senderOrigin = (() => { try { return new URL(sender?.url || '').origin; } catch { return ''; } })();
    if (!config.webOrigins.includes(senderOrigin)) return { ok: false, code: 'ORIGIN_DENIED', error: 'Website is not allowed to use this extension.' };
    const organizationId = Number(message?.organization_id);
    const expectedMonday = String(message?.week_start || '');
    const validMonday = validDate(expectedMonday) && new Date(`${expectedMonday}T12:00:00Z`).getUTCDay() === 1;
    if (message?.type !== 'IMPORT_KRONOS_SCHEDULE' || !Number.isSafeInteger(organizationId) || organizationId <= 0 || typeof message.ticket !== 'string' || !message.ticket.trim() || message.ticket.length > LIMITS.maxTicketLength || !validMonday) return { ok: false, code: 'INVALID_REQUEST', error: 'Invalid import request.' };
    let syncUrl;
    try { syncUrl = new URL(message.sync_url); } catch { return { ok: false, code: 'INVALID_SYNC_URL', error: 'Invalid backend sync URL.' }; }
    const localDevelopmentUrl = syncUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(syncUrl.hostname);
    if (syncUrl.username || syncUrl.password || syncUrl.search || syncUrl.hash || (syncUrl.protocol !== 'https:' && !localDevelopmentUrl) || !config.apiOrigins.includes(syncUrl.origin) || syncUrl.pathname !== '/api/schedule/kronos-sync/') return { ok: false, code: 'INVALID_SYNC_URL', error: 'Backend sync URL is not allowed.' };

    const kronosUrl = new URL(config.kronosScheduleUrl);
    const kronosOrigins = config.kronosOrigins?.length ? config.kronosOrigins : [kronosUrl.origin];
    const tabs = await chromeApi.tabs.query({ url: kronosOrigins.map(origin => `${origin}/*`) });
    if (!tabs.length) {
      await chromeApi.tabs.create({ url: config.kronosScheduleUrl, active: true });
      return { ok: false, code: 'KRONOS_TAB_OPENED', error: 'Kronos opened. Log in, open My Location Schedule, then import again.' };
    }
    const authorizedTabs = tabs.filter(item => {
      try {
        const url = new URL(item.url || '');
        return kronosOrigins.includes(url.origin);
      } catch { return false; }
    });
    if (!authorizedTabs.length) return { ok: false, code: 'KRONOS_URL_DENIED', error: 'Open authorized Kronos schedule before importing.' };
    const scheduleTabs = authorizedTabs.filter(item => {
      const url = new URL(item.url);
      return url.pathname === kronosUrl.pathname && isScheduleRoute(url.hash);
    });
    if (!scheduleTabs.length) {
      const currentTab = authorizedTabs.find(item => item.active) || authorizedTabs[0];
      await chromeApi.tabs.update(currentTab.id, { active: true });
      return { ok: false, code: 'KRONOS_SCHEDULE_REQUIRED', error: 'Open My Location Schedule in Kronos, then import again.' };
    }
    const tab = scheduleTabs.find(item => item.active) || scheduleTabs[0];
    let capture;
    try { capture = await chromeApi.tabs.sendMessage(tab.id, { type: 'CAPTURE_KRONOS_GRID' }); }
    catch {
      await chromeApi.tabs.update(tab.id, { active: true });
      return { ok: false, code: 'KRONOS_RELOAD_REQUIRED', error: 'Reload Kronos after installing extension, then import again.' };
    }
    if (!capture?.ok) {
      await chromeApi.tabs.update(tab.id, { active: true });
      return capture || { ok: false, code: 'EXTRACTION_FAILED', error: 'Kronos extraction failed.' };
    }
    if (!withinLimits(capture)) return { ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Schedule is too large to import safely.' };
    let week;
    let visibleMonday;
    try { visibleMonday = detectVisibleWeekStart(capture.snapshots, expectedMonday); }
    catch { return { ok: false, code: 'WEEK_HEADERS_UNREADABLE', error: 'Could not identify dates in the visible Kronos schedule headers.' }; }
    if (visibleMonday !== expectedMonday) {
      return { ok: false, code: 'WEEK_MISMATCH', error: `Kronos shows week ${visibleMonday}; Floorly shows week ${expectedMonday}. Open same week in both, then retry.` };
    }
    try {
      const shifts = parseGridSnapshots(capture.snapshots, expectedMonday);
      if (!shifts.length) return { ok: false, code: 'NO_SHIFTS_EXTRACTED', error: 'Dates were found, but no readable shifts were found in the visible Kronos grid.' };
      week = validateWeek(shifts, expectedMonday);
      if (week.shifts.length > LIMITS.maxShifts) return { ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Schedule contains too many shifts.' };
    } catch { return { ok: false, code: 'SHIFT_DATA_UNREADABLE', error: 'A Kronos shift could not be parsed into a valid date, time, and job.' }; }
    const response = await fetchImpl(syncUrl.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `ScheduleSync ${message.ticket}`, 'X-Organization-ID': String(organizationId) },
      body: JSON.stringify({ source: 'kronos', timezone: 'America/Edmonton', synced_at: now().toISOString(), weeks: [week] }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = result.code || (response.status === 401 ? 'TICKET_EXPIRED' : response.status === 403 ? 'MEMBERSHIP_DENIED' : 'UPLOAD_FAILED');
      return { ok: false, code, error: result.detail || result.error || `Upload failed (${response.status}).` };
    }
    return { ok: true, code: 'IMPORT_COMPLETE', result };
  };
}
