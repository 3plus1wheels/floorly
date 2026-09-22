import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/content-script.js', import.meta.url), 'utf8');

test('content script refuses capture after leaving the location schedule', async () => {
  let listener;
  const location = { hash: '#/8472911/location-schedule' };
  const document = { querySelector: () => null };
  runInNewContext(source, {
    location,
    document,
    chrome: { runtime: { onMessage: { addListener: value => { listener = value; } } } },
  });
  location.hash = '#/8472911/home';
  const result = await new Promise(resolve => listener({ type: 'CAPTURE_KRONOS_GRID' }, {}, resolve));
  assert.equal(result.code, 'KRONOS_SCHEDULE_REQUIRED');
});
