import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBuildConfig, contentMatch, extensionVersionFromEnv, PRODUCTION_WEB_ORIGIN } from './build-utils.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const mode = process.env.BUILD_MODE || 'development';
const parseOrigins = (name, fallback) => (process.env[name] || fallback).split(',').map(value => new URL(value.trim()).origin);
const webOrigins = parseOrigins('FLOORLY_WEB_ORIGINS', mode === 'production' ? PRODUCTION_WEB_ORIGIN : 'http://localhost:3000');
const apiOrigins = parseOrigins('FLOORLY_API_ORIGINS', mode === 'production' ? PRODUCTION_WEB_ORIGIN : 'http://localhost:3000,http://127.0.0.1:8000');
const kronosScheduleUrl = process.env.KRONOS_SCHEDULE_URL || 'https://levistrauss-sso.prd.mykronos.com/ess#/';
const kronosOrigins = parseOrigins('KRONOS_ALLOWED_ORIGINS', new URL(kronosScheduleUrl).origin);
const version = extensionVersionFromEnv(await readFile(resolve(root, '../.env'), 'utf8'));
assertBuildConfig({ mode, version, webOrigins, apiOrigins, kronosOrigins, kronosScheduleUrl });
if (!kronosOrigins.includes(new URL(kronosScheduleUrl).origin)) throw new Error('KRONOS_SCHEDULE_URL origin must be listed in KRONOS_ALLOWED_ORIGINS');
const publicKey = (await readFile(resolve(root, 'public-key.txt'), 'utf8')).trim();
const publicKeyBytes = Buffer.from(publicKey, 'base64');
if (publicKeyBytes.toString('base64') !== publicKey || createPublicKey({ key: publicKeyBytes, format: 'der', type: 'spki' }).asymmetricKeyType !== 'rsa') {
  throw new Error('extension/public-key.txt must contain a base64 DER RSA public key');
}
const extensionId = [...createHash('sha256').update(publicKeyBytes).digest().subarray(0, 16)]
  .map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('');
// Chrome match patterns do not encode ports. Runtime CONFIG checks retain exact
// origins (including ports), so localhost builds still reject unexpected senders.
const match = origin => {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
};
const manifest = {
  manifest_version: 3,
  name: 'Floorly Schedule Import',
  version,
  key: publicKey,
  description: 'Imports a visible, authorized UKG/Kronos location schedule into Floorly.',
  permissions: [],
  host_permissions: [...new Set([...apiOrigins, ...kronosOrigins].map(match))],
  background: { service_worker: 'service-worker.js', type: 'module' },
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  content_scripts: [{ matches: kronosOrigins.map(origin => contentMatch(origin, new URL(kronosScheduleUrl).pathname)), js: ['content-script.js'], run_at: 'document_idle' }],
  externally_connectable: { matches: webOrigins.map(match) },
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of ['content-script.js', 'extractor.js', 'importer.js', 'service-worker.js']) await cp(resolve(root, 'src', file), resolve(dist, file));
await writeFile(resolve(dist, 'config.js'), `export const CONFIG = ${JSON.stringify({ webOrigins, apiOrigins, kronosScheduleUrl, kronosOrigins }, null, 2)};\n`);
await writeFile(resolve(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const size of [16, 32, 48, 128]) {
  const icon = resolve(root, 'assets', `icon${size}.png`);
  await access(icon);
  await mkdir(resolve(dist, 'icons'), { recursive: true });
  await cp(icon, resolve(dist, 'icons', `icon${size}.png`));
}
const zipPath = resolve(root, `floorly-kronos-${manifest.version}.zip`);
await rm(zipPath, { force: true });
const zipped = spawnSync('zip', ['-qr', zipPath, '.'], { cwd: dist, stdio: 'inherit' });
if (zipped.status !== 0) throw new Error('zip command failed');
const digest = createHash('sha256').update(await readFile(zipPath)).digest('hex');
const checksumPath = `${zipPath}.sha256`;
await writeFile(checksumPath, `${digest}  ${zipPath.split('/').pop()}\n`);
console.log(`Extension built: ${dist}`);
console.log(`Stable extension ID: ${extensionId}`);
console.log(`Web Store ZIP: ${zipPath}`);
console.log(`SHA-256: ${checksumPath}`);
