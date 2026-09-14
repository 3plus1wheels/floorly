import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const parseOrigins = (name, fallback) => (process.env[name] || fallback).split(',').map(value => new URL(value.trim()).origin);
const webOrigins = parseOrigins('FLOORLY_WEB_ORIGINS', 'http://localhost:3000');
const apiOrigins = parseOrigins('FLOORLY_API_ORIGINS', 'http://localhost:3000,http://127.0.0.1:8000');
const kronosScheduleUrl = process.env.KRONOS_SCHEDULE_URL || 'https://levistrauss-sso.prd.mykronos.com/ess#/3009002/location-schedule';
// Chrome match patterns do not encode ports. Runtime CONFIG checks retain exact
// origins (including ports), so localhost builds still reject unexpected senders.
const match = origin => {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
};
const manifest = {
  manifest_version: 3,
  name: 'Floorly Kronos Import',
  version: process.env.EXTENSION_VERSION || '1.0.0',
  description: 'Imports the visible Kronos location schedule into Floorly.',
  permissions: ['tabs'],
  host_permissions: [...new Set([...apiOrigins.map(match), match(new URL(kronosScheduleUrl).origin)])],
  background: { service_worker: 'service-worker.js', type: 'module' },
  content_scripts: [{ matches: [match(new URL(kronosScheduleUrl).origin)], js: ['content-script.js'], run_at: 'document_idle' }],
  externally_connectable: { matches: webOrigins.map(match) },
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of ['content-script.js', 'extractor.js', 'importer.js', 'service-worker.js']) await cp(resolve(root, 'src', file), resolve(dist, file));
await writeFile(resolve(dist, 'config.js'), `export const CONFIG = ${JSON.stringify({ webOrigins, apiOrigins, kronosScheduleUrl }, null, 2)};\n`);
await writeFile(resolve(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const zipPath = resolve(root, `floorly-kronos-${manifest.version}.zip`);
await rm(zipPath, { force: true });
const zipped = spawnSync('zip', ['-qr', zipPath, '.'], { cwd: dist, stdio: 'inherit' });
if (zipped.status !== 0) throw new Error('zip command failed');
console.log(`Extension built: ${dist}`);
console.log(`Web Store ZIP: ${zipPath}`);
