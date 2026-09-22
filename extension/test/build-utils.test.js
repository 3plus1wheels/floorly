import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBuildConfig, contentMatch, extensionVersionFromEnv } from '../build-utils.mjs';

test('reads extension version only from .env contents', () => {
  assert.equal(extensionVersionFromEnv('BUILD_MODE=production\nEXTENSION_VERSION=1.0.5\n'), '1.0.5');
  assert.equal(extensionVersionFromEnv('EXTENSION_VERSION="1.0.5"\r\n'), '1.0.5');
  assert.throws(() => extensionVersionFromEnv('BUILD_MODE=production\n'), /Missing EXTENSION_VERSION/);
});

test('production build requires exact Floorly HTTPS origin and valid semver', () => {
  const kronosScheduleUrl = 'https://kronos.example/ess#/';
  assert.doesNotThrow(() => assertBuildConfig({ mode: 'production', version: '1.0.1', webOrigins: ['https://floorly.vovanguyen.com'], apiOrigins: ['https://floorly.vovanguyen.com'], kronosOrigins: ['https://kronos.example'], kronosScheduleUrl }));
  assert.throws(() => assertBuildConfig({ mode: 'production', version: '1.0.1', webOrigins: ['http://localhost:3000'], apiOrigins: ['http://localhost:8000'], kronosOrigins: ['https://kronos.example'], kronosScheduleUrl }), /Production build/);
  assert.throws(() => assertBuildConfig({ mode: 'production', version: 'bad', webOrigins: ['https://floorly.vovanguyen.com'], apiOrigins: ['https://floorly.vovanguyen.com'], kronosOrigins: ['https://kronos.example'], kronosScheduleUrl }), /Invalid EXTENSION_VERSION/);
  assert.throws(() => assertBuildConfig({ mode: 'production', version: '1.0.1', webOrigins: ['https://floorly.vovanguyen.com'], apiOrigins: ['https://floorly.vovanguyen.com'], kronosOrigins: ['https://kronos.example'], kronosScheduleUrl: 'https://kronos.example/ess#/3009002/location-schedule' }), /HTTPS \/ess#\/ entry URL/);
});

test('content script match is limited to schedule path', () => {
  assert.equal(contentMatch('https://kronos.example', '/ess'), 'https://kronos.example/ess*');
});
