import { getCurrentEmployeeMapping, importFromKronos, sendExtensionMessage, setCurrentEmployeeMapping } from './kronosExtension';

test('reports missing extension', async () => {
  await expect(sendExtensionMessage('extension-id', {}, {})).rejects.toMatchObject({
    code: 'EXTENSION_MISSING',
  });
});

test('gets scoped ticket then asks extension to import', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ticket: 'five-minute-ticket' }),
  });
  const chromeApi = {
    runtime: {
      lastError: null,
      sendMessage: jest.fn((_id, _message, callback) => callback({ ok: true, code: 'IMPORT_COMPLETE' })),
    },
  };
  const states = [];

  await expect(importFromKronos({
    organizationId: '17',
    weekStart: '2026-09-07',
    accessToken: 'floorly-access-token',
    extensionId: 'extension-id',
    fetchImpl,
    chromeApi,
    onState: state => states.push(state),
  })).resolves.toMatchObject({ code: 'IMPORT_COMPLETE' });

  expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/api/schedule/sync-ticket/'), expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({
      Authorization: 'Bearer floorly-access-token',
      'X-Organization-ID': '17',
    }),
  }));
  expect(fetchImpl.mock.calls[0][1].body).toBe(JSON.stringify({ consent: false, privacy_policy_version: '' }));
  expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith('extension-id', expect.objectContaining({
    type: 'IMPORT_KRONOS_SCHEDULE',
    organization_id: 17,
    week_start: '2026-09-07',
    ticket: 'five-minute-ticket',
    sync_url: expect.stringContaining('/api/schedule/kronos-sync/'),
  }), expect.any(Function));
  expect(states).toEqual(['checking', 'scraping']);
});

test('does not contact extension when ticket is denied', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => ({ detail: 'membership removed' }),
  });
  const chromeApi = { runtime: { sendMessage: jest.fn() } };

  await expect(importFromKronos({
    organizationId: '17', weekStart: '2026-09-07', accessToken: 'token', extensionId: 'extension-id', fetchImpl, chromeApi,
  })).rejects.toMatchObject({ code: 'MEMBERSHIP_DENIED' });
  expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalled();
});

test('loads and saves organization-scoped employee identity', async () => {
  const fetchImpl = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ linked_employee: null, candidates: [] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ linked_employee: { id: 12, name: 'Vova Nguyen' } }) });
  await getCurrentEmployeeMapping({ organizationId: 17, accessToken: 'token', fetchImpl });
  await setCurrentEmployeeMapping({ organizationId: 17, accessToken: 'token', createFromProfile: true, fetchImpl });
  expect(fetchImpl.mock.calls[0][1].headers['X-Organization-ID']).toBe('17');
  expect(fetchImpl.mock.calls[1][1]).toEqual(expect.objectContaining({
    method: 'PUT',
    body: JSON.stringify({ create_from_profile: true }),
  }));
});
