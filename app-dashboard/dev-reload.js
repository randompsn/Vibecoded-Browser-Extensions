/* App Dashboard - dev-reload.js: reloads the extension by itself when its
 * files change on disk (Claude writing an update into your folder, or you
 * unzipping one over it). Only for "Load unpacked"; checks every 30 seconds
 * and whenever a new tab opens.
 */
'use strict';

const DEV_UNPACKED = !('update_url' in chrome.runtime.getManifest());
const DEV_FILES = ['manifest.json', 'background.js', 'rules.js', 'dev-reload.js', 'launch.js', 'newtab.html', 'newtab.js', 'newtab.css'];

async function devFingerprint() {
  let h = 2166136261;
  for (const f of DEV_FILES) {
    let text = '';
    try { text = await (await fetch(chrome.runtime.getURL(f), { cache: 'no-store' })).text(); } catch (e) { text = '\u0000missing'; }
    const s = f + '\u0001' + text + '\u0002';
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  }
  return h.toString(16);
}

let devChecking = false;
async function devCheck() {
  if (!DEV_UNPACKED || devChecking) return;
  devChecking = true;
  try {
    const now = await devFingerprint();
    const { devReloadFingerprint: stored } = await chrome.storage.local.get('devReloadFingerprint');
    if (!stored) await chrome.storage.local.set({ devReloadFingerprint: now });
    else if (stored !== now) { await chrome.storage.local.set({ devReloadFingerprint: now }); chrome.runtime.reload(); }
  } finally { devChecking = false; }
}

if (DEV_UNPACKED) {
  devCheck();
  chrome.alarms.create('dev-reload', { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'dev-reload') devCheck(); });
  chrome.tabs.onCreated.addListener(() => devCheck());
}
