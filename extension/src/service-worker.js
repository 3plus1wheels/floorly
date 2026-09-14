import { CONFIG } from './config.js';
import { createImporter } from './importer.js';

const importSchedule = createImporter({ chromeApi: chrome, fetchImpl: fetch, config: CONFIG });

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type === 'FLOORLY_PING') {
    const origin = (() => { try { return new URL(sender.url).origin; } catch { return ''; } })();
    sendResponse({ ok: CONFIG.webOrigins.includes(origin), version: chrome.runtime.getManifest().version });
    return false;
  }
  importSchedule(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, code: 'EXTENSION_ERROR', error: error.message }));
  return true;
});
