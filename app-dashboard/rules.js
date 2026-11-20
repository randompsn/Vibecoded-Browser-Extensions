/* App Dashboard - rules.js
 *
 * Shared by the page and the background worker.
 *
 * Many sites send X-Frame-Options or a Content-Security-Policy with
 * frame-ancestors, which stops other pages from showing them in a frame.
 * For an app set to "Embed", the dashboard removes those two headers, but
 * only on that app's own site, only for frames, and only for frames this
 * extension's pages open (initiatorDomains = this extension). Everywhere
 * else the site keeps its protection. It needs the site's permission,
 * which the dashboard asks for when you add the app.
 */
'use strict';

const RULE_BASE = 1000;

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}
function originPattern(url) {
  try { const u = new URL(url); return u.protocol + '//' + u.hostname + '/*'; } catch (e) { return ''; }
}

async function loadApps() {
  const { apps = [] } = await chrome.storage.sync.get({ apps: [] });
  return apps;
}

async function syncRules() {
  const apps = await loadApps();
  const hosts = [];
  for (const a of apps) {
    if (a.mode !== 'embed') continue;
    const h = hostOf(a.url);
    if (!h || hosts.includes(h)) continue;
    const ok = await chrome.permissions.contains({ origins: [originPattern(a.url)] }).catch(() => false);
    if (ok) hosts.push(h);
  }
  const addRules = hosts.map((h, i) => ({
    id: RULE_BASE + i,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' }
      ]
    },
    condition: {
      requestDomains: [h],
      resourceTypes: ['sub_frame'],
      initiatorDomains: [chrome.runtime.id]
    }
  }));
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules });
  return hosts;
}
