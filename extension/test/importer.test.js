import test from 'node:test';
import assert from 'node:assert/strict';
import { createImporter } from '../src/importer.js';

const config = {
  webOrigins: ['https://floorly.example'],
  apiOrigins: ['https://api.floorly.example'],
  kronosScheduleUrl: 'https://kronos.example/ess#/location-schedule',
};
const message = { type: 'IMPORT_KRONOS_SCHEDULE', organization_id: 7, week_start: '2026-09-07', ticket: 'short-ticket', sync_url: 'https://api.floorly.example/api/schedule/kronos-sync/' };
const sender = { url: 'https://floorly.example/dashboard' };
const snapshots = [{
  headers: [{ colId: 'mon', label: 'Mon 09/07' }],
  rows: [{ rowIndex: '0', employee_name: 'Doe, Jane', primary_job: 'Stylist', cells: [{ colId: 'mon', titles: ['9:00 AM - 5:00 PM'] }] }],
}];

function harness({ tabs = [{ id: 4, active: true }], capture = { ok: true, snapshots }, response = { ok: true, status: 200, json: async () => ({ imported: 1 }) } } = {}) {
  const calls = { query: [], create: [], update: [], send: [], fetch: [] };
  const chromeApi = { tabs: {
    query: async value => (calls.query.push(value), tabs),
    create: async value => calls.create.push(value),
    update: async (...value) => calls.update.push(value),
    sendMessage: async (...value) => (calls.send.push(value), capture),
  } };
  const fetchImpl = async (...value) => (calls.fetch.push(value), response);
  const run = createImporter({ chromeApi, fetchImpl, config, now: () => new Date('2026-09-08T18:00:00Z') });
  return { calls, run };
}

test('rejects unauthorized website before browser or network access', async () => {
  const { calls, run } = harness();
  assert.equal((await run(message, { url: 'https://evil.example/' })).code, 'ORIGIN_DENIED');
  assert.equal(calls.query.length, 0);
});

test('opens Kronos when absent without uploading ticket', async () => {
  const { calls, run } = harness({ tabs: [] });
  assert.equal((await run(message, sender)).code, 'KRONOS_TAB_OPENED');
  assert.deepEqual(calls.create, [{ url: config.kronosScheduleUrl, active: true }]);
  assert.equal(calls.fetch.length, 0);
});

test('grid unavailable focuses Kronos and does not upload', async () => {
  const { calls, run } = harness({ capture: { ok: false, code: 'SCHEDULE_NOT_READY', error: 'wait' } });
  assert.equal((await run(message, sender)).code, 'SCHEDULE_NOT_READY');
  assert.deepEqual(calls.update, [[4, { active: true }]]);
  assert.equal(calls.fetch.length, 0);
});

test('uploads validated current week with scoped ticket and organization', async () => {
  const { calls, run } = harness();
  const result = await run(message, sender);
  assert.equal(result.code, 'IMPORT_COMPLETE');
  const [url, options] = calls.fetch[0];
  assert.equal(url, message.sync_url);
  assert.equal(options.headers.Authorization, 'ScheduleSync short-ticket');
  assert.equal(options.headers['X-Organization-ID'], '7');
  const body = JSON.parse(options.body);
  assert.equal(body.weeks[0].week_start, '2026-09-07');
  assert.equal(body.weeks[0].shifts[0].employee_name, 'Doe, Jane');
});

test('rejects when Kronos and Floorly show different weeks', async () => {
  const { calls, run } = harness();
  const result = await run({ ...message, week_start: '2026-09-14' }, sender);
  assert.equal(result.code, 'WEEK_MISMATCH');
  assert.match(result.error, /same week/i);
  assert.equal(calls.fetch.length, 0);
});

test('rejects unconfigured backend URL', async () => {
  const { calls, run } = harness();
  assert.equal((await run({ ...message, sync_url: 'https://evil.example/api/schedule/kronos-sync/' }, sender)).code, 'INVALID_SYNC_URL');
  assert.equal((await run({ ...message, sync_url: 'https://api.floorly.example/proxy/api/schedule/kronos-sync/' }, sender)).code, 'INVALID_SYNC_URL');
  assert.equal(calls.query.length, 0);
});

test('maps expired ticket response to actionable code', async () => {
  const { run } = harness({ response: { ok: false, status: 401, json: async () => ({ detail: 'expired' }) } });
  assert.equal((await run(message, sender)).code, 'TICKET_EXPIRED');
});

test('maps revoked membership response to actionable code', async () => {
  const { run } = harness({ response: { ok: false, status: 403, json: async () => ({ detail: 'membership removed' }) } });
  assert.equal((await run(message, sender)).code, 'MEMBERSHIP_DENIED');
});

test('preserves backend employee-link-required code', async () => {
  const { run } = harness({
    response: { ok: false, status: 409, json: async () => ({ code: 'employee_link_required', detail: 'Choose employee identity.' }) },
  });
  const result = await run(message, sender);
  assert.equal(result.code, 'employee_link_required');
  assert.equal(result.error, 'Choose employee identity.');
});
