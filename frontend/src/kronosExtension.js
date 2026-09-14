import API_BASE from './config';

export const EXTENSION_ID = process.env.REACT_APP_FLOORLY_EXTENSION_ID || '';
export const EXTENSION_STORE_URL = process.env.REACT_APP_FLOORLY_EXTENSION_STORE_URL || '';

export const KRONOS_ERRORS = {
  EXTENSION_NOT_CONFIGURED: 'Kronos extension is not configured for this Floorly build.',
  EXTENSION_MISSING: 'Floorly Kronos extension is not installed or enabled.',
  KRONOS_TAB_OPENED: 'Kronos opened. Log in, open My Location Schedule, then click Import again.',
  KRONOS_RELOAD_REQUIRED: 'Reload Kronos after installing the extension, then click Import again.',
  LOGIN_REQUIRED: 'Log in to Kronos, open My Location Schedule, then click Import again.',
  GRID_UNAVAILABLE: 'Open My Location Schedule, wait for schedule rows, then click Import again.',
  SCHEDULE_NOT_READY: 'Open My Location Schedule, wait for schedule rows, then click Import again.',
  TICKET_EXPIRED: 'Import ticket expired. Click Import again.',
  ORGANIZATION_DENIED: 'You no longer have access to this organization.',
  MEMBERSHIP_DENIED: 'You no longer have access to this organization.',
  EXTRACTION_FAILED: 'Could not read Kronos schedule. Confirm current week is visible, then retry.',
  employee_link_required: 'Choose your employee identity before importing My Schedule.',
};

function parseResponse(response) {
  return response.json().catch(() => ({}));
}

export function sendExtensionMessage(extensionId, message, chromeApi = window.chrome) {
  return new Promise((resolve, reject) => {
    if (!extensionId) {
      reject(Object.assign(new Error(KRONOS_ERRORS.EXTENSION_NOT_CONFIGURED), { code: 'EXTENSION_NOT_CONFIGURED' }));
      return;
    }
    if (!chromeApi?.runtime?.sendMessage) {
      reject(Object.assign(new Error(KRONOS_ERRORS.EXTENSION_MISSING), { code: 'EXTENSION_MISSING' }));
      return;
    }
    try {
      chromeApi.runtime.sendMessage(extensionId, message, (result) => {
        const runtimeError = chromeApi.runtime.lastError;
        if (runtimeError) {
          reject(Object.assign(new Error(KRONOS_ERRORS.EXTENSION_MISSING), { code: 'EXTENSION_MISSING' }));
          return;
        }
        if (!result?.ok) {
          const code = result?.code || 'EXTENSION_ERROR';
          reject(Object.assign(new Error(KRONOS_ERRORS[code] || result?.error || 'Kronos import failed.'), { code }));
          return;
        }
        resolve(result);
      });
    } catch (error) {
      reject(Object.assign(new Error(KRONOS_ERRORS.EXTENSION_MISSING), { code: 'EXTENSION_MISSING', cause: error }));
    }
  });
}

export async function getCurrentEmployeeMapping({ organizationId, accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`${API_BASE.replace(/\/$/, '')}/api/schedule/me/employee/`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Organization-ID': String(organizationId) },
  });
  const result = await parseResponse(response);
  if (!response.ok) throw Object.assign(new Error(result.detail || `Could not load employee identity (${response.status}).`), { code: result.code });
  return result;
}

export async function setCurrentEmployeeMapping({ organizationId, accessToken, employeeId, createFromProfile = false, fetchImpl = fetch }) {
  const response = await fetchImpl(`${API_BASE.replace(/\/$/, '')}/api/schedule/me/employee/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, 'X-Organization-ID': String(organizationId) },
    body: JSON.stringify(createFromProfile ? { create_from_profile: true } : { employee_id: Number(employeeId) }),
  });
  const result = await parseResponse(response);
  if (!response.ok) throw Object.assign(new Error(result.detail || `Could not save employee identity (${response.status}).`), { code: result.code });
  return result;
}

export async function importFromKronos({ organizationId, weekStart, accessToken, extensionId = EXTENSION_ID, fetchImpl = fetch, chromeApi = window.chrome, onState = () => {} }) {
  if (!organizationId) throw new Error('Select an organization before importing.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart || '')) throw new Error('Select a valid Floorly week before importing.');
  const apiBase = API_BASE.replace(/\/$/, '');
  onState('checking');
  const ticketResponse = await fetchImpl(`${apiBase}/api/schedule/sync-ticket/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Organization-ID': String(organizationId),
    },
  });
  const ticketResult = await parseResponse(ticketResponse);
  if (!ticketResponse.ok) {
    const code = ticketResult.code || (ticketResponse.status === 403 ? 'MEMBERSHIP_DENIED' : 'TICKET_FAILED');
    throw Object.assign(new Error(KRONOS_ERRORS[code] || ticketResult.detail || `Could not start import (${ticketResponse.status}).`), { code });
  }

  const syncUrl = new URL(`${apiBase}/api/schedule/kronos-sync/`, window.location.origin).href;
  onState('scraping');
  return sendExtensionMessage(extensionId, {
    type: 'IMPORT_KRONOS_SCHEDULE',
    organization_id: Number(organizationId),
    week_start: weekStart,
    ticket: ticketResult.ticket,
    sync_url: syncUrl,
  }, chromeApi);
}
