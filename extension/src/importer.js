import { detectVisibleWeekStart, parseGridSnapshots, validateWeek } from './extractor.js';

export function createImporter({ chromeApi, fetchImpl, config, now = () => new Date() }) {
  return async function importSchedule(message, sender) {
    const senderOrigin = (() => { try { return new URL(sender?.url || '').origin; } catch { return ''; } })();
    if (!config.webOrigins.includes(senderOrigin)) return { ok: false, code: 'ORIGIN_DENIED', error: 'Website is not allowed to use this extension.' };
    const organizationId = Number(message?.organization_id);
    const expectedMonday = String(message?.week_start || '');
    const validMonday = /^\d{4}-\d{2}-\d{2}$/.test(expectedMonday) && new Date(`${expectedMonday}T12:00:00Z`).getUTCDay() === 1;
    if (message?.type !== 'IMPORT_KRONOS_SCHEDULE' || !Number.isInteger(organizationId) || organizationId <= 0 || typeof message.ticket !== 'string' || !message.ticket.trim() || !validMonday) return { ok: false, code: 'INVALID_REQUEST', error: 'Invalid import request.' };
    let syncUrl;
    try { syncUrl = new URL(message.sync_url); } catch { return { ok: false, code: 'INVALID_SYNC_URL', error: 'Invalid backend sync URL.' }; }
    if (syncUrl.username || syncUrl.password || !config.apiOrigins.includes(syncUrl.origin) || syncUrl.pathname !== '/api/schedule/kronos-sync/') return { ok: false, code: 'INVALID_SYNC_URL', error: 'Backend sync URL is not allowed.' };

    const tabs = await chromeApi.tabs.query({ url: `${new URL(config.kronosScheduleUrl).origin}/*` });
    if (!tabs.length) {
      await chromeApi.tabs.create({ url: config.kronosScheduleUrl, active: true });
      return { ok: false, code: 'KRONOS_TAB_OPENED', error: 'Kronos opened. Log in, open My Location Schedule, then import again.' };
    }
    const tab = tabs.find(item => item.active) || tabs[0];
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
    let week;
    try {
      const visibleMonday = detectVisibleWeekStart(capture.snapshots, expectedMonday);
      if (visibleMonday !== expectedMonday) {
        return { ok: false, code: 'WEEK_MISMATCH', error: `Kronos shows week ${visibleMonday}; Floorly shows week ${expectedMonday}. Open same week in both, then retry.` };
      }
      week = validateWeek(parseGridSnapshots(capture.snapshots, expectedMonday), expectedMonday);
    } catch (error) { return { ok: false, code: 'EXTRACTION_FAILED', error: error.message }; }
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
