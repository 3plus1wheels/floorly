import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBuildConfig, contentMatch } from '../build-utils.mjs';

test('production build requires exact Floorly HTTPS origin and valid semver', () => {
  const kronosScheduleUrl = 'https://kronos.example/ess#/3009002/location-schedule';
  assert.doesNotThrow(() => assertBuildConfig({ mode: 'production', version: '1.0.1', webOrigins: ['https://floorly.vovanguyen.com'], apiOrigins: ['https://floorly.vovanguyen.com'], kronosOrigins: ['https://kronos.example'], kronosScheduleUrl }));
  assert.throws(() => assertBuildConfig({ mode: 'production', version: '1.0.1', webOrigins: ['http://localhost:3000'], apiOrigins: ['http://localhost:8000'], kronosOrigins: ['https://kronos.example'], kronosScheduleUrl }), /Production build/);
  assert.throws(() => assertBuildConfig({ mode: 'production', version: 'bad', webOrigins: ['https://floorly.vovanguyen.com'], apiOrigins: ['https://floorly.vovanguyen.com'], kronosOrigins: ['https://kronos.example'], kronosScheduleUrl }), /Invalid EXTENSION_VERSION/);
  assert.throws(() => assertBuildConfig({ mode: 'production', version: '1.0.1', webOrigins: ['https://floorly.vovanguyen.com'], apiOrigins: ['https://floorly.vovanguyen.com'], kronosOrigins: ['https://kronos.example'], kronosScheduleUrl: 'https://kronos.example/ess' }), /full HTTPS location-schedule URL/);
});

test('content script match is limited to schedule path', () => {
  assert.equal(contentMatch('https://kronos.example', '/ess'), 'https://kronos.example/ess*');
});
