/* App Dashboard - background.js
 * Opens the dashboard from the toolbar button, and rebuilds the embedding
 * rules after an update (rules.js does the work; the page uses it too).
 */
importScripts('rules.js', 'dev-reload.js');

// The toolbar button always shows the dashboard, even when new tabs open an app.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: 'newtab.html?dash=1' }));

// Asked for on November 18, 2026: the Essay Editor (with its deadline
// countdown) opens on every new tab. Added once; after that the choice is
// changed in ⚙ like any other.
const ESSAY = { name: 'Essay Editor', url: 'https://claude.ai/artifact/PJ1526xfjS82pnse34NgoB' };
async function addEssayEditor() {
  const { apps = [], layout = {}, seeded = false } = await chrome.storage.sync.get({ apps: [], layout: {}, seeded: false });
  if (seeded) return;
  let app = apps.find((a) => a.url === ESSAY.url);
  if (!app) {
    // claude.ai refuses to be shown inside other pages, so it's a link, and opens as the whole new tab
    app = { id: 'essay-editor', name: ESSAY.name, url: ESSAY.url, mode: 'link', w: 1, h: 1, check: { status: 'blocked', why: 'claude.ai does not allow embedding', at: Date.now() } };
    apps.unshift(app);
  }
  const next = { ...layout };
  if (!next.launch) next.launch = app.id;
  await chrome.storage.sync.set({ apps, layout: next, seeded: true });
}

chrome.runtime.onInstalled.addListener(async () => {
  await addEssayEditor().catch((e) => console.warn('Dashboard setup:', e));
  syncRules();
});
chrome.permissions.onAdded.addListener(() => syncRules());
chrome.permissions.onRemoved.addListener(() => syncRules());
