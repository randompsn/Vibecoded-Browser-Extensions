/* App Dashboard - newtab.js
 *
 * Apps live in chrome.storage.sync under "apps":
 *   { id, name, url, mode: 'auto' | 'embed' | 'link', w, h, check }
 *   check: { status: 'ok' | 'blocked' | 'unknown', why, at } — whether the
 *   site allows other pages to frame it, read from its response headers
 *   (possible only with the site's permission, asked for when it's added).
 * Layout lives under "layout": { cols, rowH, clock }.
 *
 * How an app is shown:
 *   link                   -> a button in the top bar
 *   embed                  -> a tile; rules.js lifts the site's frame block
 *   auto + check 'blocked' -> a button in the top bar
 *   auto otherwise         -> a tile (with a ⚠ when it couldn't be checked)
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');
const links = $('#links');

let apps = [];
let layout = { cols: 3, rowH: 320, clock: true, launch: '' };
let editing = false;

/* ---------------- storage ---------------- */

async function load() {
  const got = await chrome.storage.sync.get({ apps: [], layout });
  apps = got.apps;
  layout = { ...layout, ...got.layout };
}
async function saveApps() {
  await chrome.storage.sync.set({ apps });
  await syncRules().catch((e) => console.warn('Dashboard rules:', e));
}

/* ---------------- helpers ---------------- */

const uid = () => Math.random().toString(36).slice(2, 10);
const favicon = (url) => chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32');

function normalizeUrl(raw) {
  let s = (raw || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.href;
  } catch (e) { return ''; }
}
function defaultName(url) {
  const h = hostOf(url).replace(/^www\./, '');
  const first = h.split('.')[0] || h;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
function shownAs(app) {
  if (app.mode === 'link') return 'link';
  if (app.mode === 'embed') return 'tile';
  return app.check && app.check.status === 'blocked' ? 'link' : 'tile';
}
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}

/* ---------------- can the site be framed? ---------------- */

// Reads the headers that stop framing. Works without CORS because the
// extension has the site's permission; without it, says "unknown".
async function checkFraming(url) {
  const allowed = await chrome.permissions.contains({ origins: [originPattern(url)] }).catch(() => false);
  if (!allowed) return { status: 'unknown', why: 'No permission to look at this site', at: Date.now() };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(url, { credentials: 'include', redirect: 'follow', signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    const xfo = (res.headers.get('x-frame-options') || '').toLowerCase();
    const csp = (res.headers.get('content-security-policy') || '').toLowerCase();
    const fa = /(?:^|;)\s*frame-ancestors\s+([^;]*)/.exec(csp);
    if (/deny|sameorigin/.test(xfo)) return { status: 'blocked', why: 'X-Frame-Options: ' + xfo, at: Date.now() };
    if (fa && !/(^|\s)\*(\s|$)/.test(fa[1]) && !/chrome-extension:/.test(fa[1])) {
      return { status: 'blocked', why: 'frame-ancestors ' + fa[1].trim(), at: Date.now() };
    }
    return { status: 'ok', why: '', at: Date.now() };
  } catch (e) {
    return { status: 'unknown', why: 'The site could not be reached (' + (e.name === 'AbortError' ? 'timed out' : e.message) + ')', at: Date.now() };
  }
}

/* ---------------- drawing ---------------- */

function applyLayout() {
  const r = document.documentElement.style;
  r.setProperty('--cols', String(layout.cols));
  r.setProperty('--row-h', layout.rowH + 'px');
  $('.when').hidden = !layout.clock;
}

function linkChip(app) {
  return el('a', {
    class: 'chip', href: app.url, 'data-id': app.id, title: app.url,
    draggable: editing ? 'true' : null,
    onclick: (ev) => { if (editing) { ev.preventDefault(); openAppDialog(app); } }
  },
  el('img', { src: favicon(app.url), alt: '' }),
  el('span', { text: app.name }),
  el('button', { class: 'chip-x edit-only', type: 'button', title: 'Remove', 'aria-label': 'Remove ' + app.name, text: '✕',
    onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); removeApp(app.id); } }));
}

const frames = new Map(); // id -> iframe, kept across redraws so pages don't reload
function frameFor(app) {
  let f = frames.get(app.id);
  if (!f || f.dataset.url !== app.url) {
    f = el('iframe', {
      src: app.url,
      title: app.name,
      loading: 'lazy',
      allow: 'clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture; microphone; camera; geolocation',
      referrerpolicy: 'strict-origin-when-cross-origin'
    });
    f.dataset.url = app.url;
    frames.set(app.id, f);
  }
  return f;
}

function tile(app) {
  const warn = app.mode === 'auto' && app.check && app.check.status === 'unknown'
    ? el('span', { class: 'tile-warn', text: '⚠', title: 'Not checked: ' + (app.check.why || '') + '. If this stays blank, the site blocks embedding — edit it and choose Link or Embed.' })
    : null;
  const t = el('section', { class: 'tile', 'data-id': app.id, draggable: editing ? 'true' : null, 'aria-label': app.name },
    el('div', { class: 'tile-head' },
      el('img', { src: favicon(app.url), alt: '' }),
      el('span', { class: 'tile-name', text: app.name, title: app.url }),
      warn,
      el('button', { type: 'button', title: 'Reload', 'aria-label': 'Reload ' + app.name, text: '↻',
        onclick: () => { const f = frames.get(app.id); if (f) f.src = app.url; } }),
      el('a', { href: app.url, target: '_blank', rel: 'noopener', title: 'Open in a new tab', 'aria-label': 'Open ' + app.name + ' in a new tab', text: '↗' }),
      el('button', { class: 'edit-only', type: 'button', title: 'Edit', 'aria-label': 'Edit ' + app.name, text: '✎', onclick: () => openAppDialog(app) }),
      el('button', { class: 'edit-only', type: 'button', title: 'Remove', 'aria-label': 'Remove ' + app.name, text: '✕', onclick: () => removeApp(app.id) })));
  t.style.setProperty('--w', String(app.w || 1));
  t.style.setProperty('--h', String(app.h || 1));
  t.append(frameFor(app));
  return t;
}

// Moving or re-adding an iframe reloads its page, so the tiles are only
// redrawn when the list of tiles or their order, size or address changed.
let lastTiles = '';
function render() {
  applyLayout();
  setEditing(editing);

  links.replaceChildren(...apps.filter((a) => shownAs(a) === 'link').map(linkChip));

  const tiles = apps.filter((a) => shownAs(a) === 'tile');
  const sig = JSON.stringify(tiles.map((a) => [a.id, a.url, a.name, a.w, a.h, a.mode, a.check && a.check.status]));
  if (sig !== lastTiles) {
    lastTiles = sig;
    grid.replaceChildren(...tiles.map(tile));
    for (const id of [...frames.keys()]) if (!tiles.some((a) => a.id === id)) frames.delete(id);
  }
  setEditing(editing);

  $('#empty').hidden = apps.length > 0;
  grid.hidden = tiles.length === 0;
}

/* ---------------- add / edit ---------------- */

const dlg = $('#appDlg');
const form = $('#appForm');
let editingId = null;

function openAppDialog(app) {
  editingId = app ? app.id : null;
  $('#appDlgTitle').textContent = app ? 'Edit ' + app.name : 'Add app';
  form.url.value = app ? app.url : '';
  form.name.value = app ? app.name : '';
  form.mode.value = app ? app.mode : 'auto';
  form.w.value = String(app ? app.w || 1 : 1);
  form.h.value = String(app ? app.h || 1 : 1);
  $('#removeBtn').hidden = !app;
  setStatus(app && app.check ? describeCheck(app) : '', app && app.check && app.check.status === 'blocked' ? 'warn' : '');
  dlg.showModal();
  (app ? form.name : form.url).focus();
}

function describeCheck(app) {
  const c = app.check;
  if (!c) return '';
  if (c.status === 'ok') return 'This site allows embedding.';
  if (c.status === 'blocked') {
    return app.mode === 'embed'
      ? 'This site blocks embedding; the dashboard lifts the block for this page.'
      : 'This site blocks embedding, so Auto shows it as a link. Choose Embed to show it here anyway.';
  }
  return 'Not checked: ' + (c.why || 'unknown') + '.';
}
function setStatus(msg, kind = '') {
  const s = $('#appStatus');
  s.textContent = msg;
  s.className = 'status' + (kind ? ' ' + kind : '');
}

// Ask for the site's permission inside the click (browsers only allow the
// prompt during a click). Needed to check the headers and for Embed.
function askPermission(url) {
  const pattern = originPattern(url);
  return chrome.permissions.request({ origins: [pattern] }).catch(() => false);
}

form.addEventListener('submit', (ev) => {
  if (ev.submitter && ev.submitter.value === 'cancel') return; // closes the dialog
  ev.preventDefault();
  const url = normalizeUrl(form.url.value);
  if (!url) { setStatus('Enter a web address, like calendar.example.com', 'bad'); form.url.focus(); return; }
  const mode = form.mode.value;
  const perm = mode === 'link' ? Promise.resolve(false) : askPermission(url); // must start before any await
  saveFromForm(url, mode, perm);
});

async function saveFromForm(url, mode, perm) {
  const granted = await perm;
  const old = apps.find((a) => a.id === editingId);
  const app = {
    id: old ? old.id : uid(),
    url,
    name: form.name.value.trim() || defaultName(url),
    mode,
    w: +form.w.value || 1,
    h: +form.h.value || 1,
    check: old && old.url === url ? old.check : null
  };
  if (mode !== 'link') {
    setStatus('Checking whether ' + hostOf(url) + ' allows embedding…');
    app.check = await checkFraming(url);
    if (mode === 'embed' && !granted && !(await chrome.permissions.contains({ origins: [originPattern(url)] }).catch(() => false))) {
      app.check = { ...app.check, why: 'Permission declined, so a block can’t be lifted' };
    }
  }
  if (old) apps[apps.indexOf(old)] = app; else apps.push(app);
  await saveApps();
  mirrorLaunch();
  dlg.close();
  render();
}

$('#removeBtn').addEventListener('click', () => { if (editingId) removeApp(editingId); dlg.close(); });

async function removeApp(id) {
  apps = apps.filter((a) => a.id !== id);
  if (layout.launch === id) { layout.launch = ''; await chrome.storage.sync.set({ layout }); mirrorLaunch(); }
  await saveApps();
  render();
}

/* ---------------- edit mode: reorder by dragging ---------------- */

let dragId = null;
function onDragStart(ev) {
  const item = ev.target.closest('[data-id]');
  if (!editing || !item) return;
  dragId = item.dataset.id;
  item.classList.add('dragging');
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', dragId);
}
function onDragOver(ev) {
  if (!dragId) return;
  ev.preventDefault();
  for (const x of document.querySelectorAll('.drop-before')) x.classList.remove('drop-before');
  const over = ev.target.closest('[data-id]');
  if (over && over.dataset.id !== dragId) over.classList.add('drop-before');
}
async function onDrop(ev) {
  if (!dragId) return;
  ev.preventDefault();
  const over = ev.target.closest('[data-id]');
  const from = apps.findIndex((a) => a.id === dragId);
  const moving = apps.splice(from, 1)[0];
  let to = over ? apps.findIndex((a) => a.id === over.dataset.id) : apps.length;
  if (to < 0) to = apps.length;
  apps.splice(to, 0, moving);
  dragId = null;
  await saveApps();
  render();
}
function onDragEnd() {
  dragId = null;
  for (const x of document.querySelectorAll('.dragging, .drop-before')) x.classList.remove('dragging', 'drop-before');
}
for (const zone of [grid, links]) {
  zone.addEventListener('dragstart', onDragStart);
  zone.addEventListener('dragover', onDragOver);
  zone.addEventListener('drop', onDrop);
  zone.addEventListener('dragend', onDragEnd);
}

/* ---------------- settings, export, import ---------------- */

const setDlg = $('#setDlg');
const setForm = $('#setForm');
$('#settingsBtn').addEventListener('click', () => {
  setForm.cols.value = String(layout.cols);
  setForm.rowH.value = String(layout.rowH);
  setForm.clock.checked = !!layout.clock;
  const sel = $('#launchSel');
  sel.replaceChildren(el('option', { value: '', text: 'Show this dashboard' }),
    ...apps.map((a) => el('option', { value: a.id, text: 'Open ' + a.name })));
  sel.value = apps.some((a) => a.id === layout.launch) ? layout.launch : '';
  $('#setStatus').textContent = '';
  setDlg.showModal();
});
setDlg.addEventListener('close', async () => {
  if (setDlg.returnValue !== 'save') return;
  layout = { cols: +setForm.cols.value, rowH: +setForm.rowH.value, clock: setForm.clock.checked, launch: setForm.launch.value };
  await chrome.storage.sync.set({ layout });
  mirrorLaunch();
  render();
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'App Dashboard', version: 1, apps, layout }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'dashboard-apps.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const out = $('#setStatus');
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.apps;
    if (!Array.isArray(list)) throw new Error('no apps in the file');
    const clean = list.map((a) => ({
      id: uid(),
      url: normalizeUrl(a.url),
      name: String(a.name || '').slice(0, 60),
      mode: ['auto', 'embed', 'link'].includes(a.mode) ? a.mode : 'auto',
      w: Math.min(6, Math.max(1, +a.w || 1)),
      h: Math.min(3, Math.max(1, +a.h || 1)),
      check: a.check && ['ok', 'blocked', 'unknown'].includes(a.check.status) ? { status: a.check.status, why: String(a.check.why || ''), at: +a.check.at || 0 } : null
    })).filter((a) => a.url).map((a) => ({ ...a, name: a.name || defaultName(a.url) }));
    apps = clean;
    if (data.layout) layout = { ...layout, ...data.layout };
    await chrome.storage.sync.set({ layout });
    await saveApps();
    render();
    out.textContent = 'Imported ' + clean.length + ' apps. Sites set to Embed need their permission again: edit each one and press Save.';
    out.className = 'status';
  } catch (e) {
    out.textContent = 'Couldn’t import that file: ' + e.message;
    out.className = 'status bad';
  }
});

/* ---------------- open an app on every new tab ---------------- */

// launch.js reads this copy before the page draws.
function launchUrl() {
  const a = apps.find((x) => x.id === layout.launch);
  return a ? a.url : '';
}
function mirrorLaunch() {
  try {
    const u = launchUrl();
    if (u) localStorage.setItem('launch-url', u); else localStorage.removeItem('launch-url');
  } catch (e) { /* ignore */ }
}

/* ---------------- clock ---------------- */

function tick() {
  const now = new Date();
  $('#time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

/* ---------------- start ---------------- */

$('#addBtn').addEventListener('click', () => openAppDialog(null));
$('#emptyAdd').addEventListener('click', () => openAppDialog(null));
// Switching edit mode doesn't redraw, so the embedded pages don't reload.
function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', editing);
  $('#editBtn').setAttribute('aria-pressed', String(editing));
  $('#editBtn').textContent = editing ? 'Done' : 'Edit';
  for (const item of document.querySelectorAll('.tile[data-id], .chip[data-id]')) {
    if (editing) item.setAttribute('draggable', 'true'); else item.removeAttribute('draggable');
  }
}
$('#editBtn').addEventListener('click', () => setEditing(!editing));
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && editing && !dlg.open && !setDlg.open) setEditing(false); });

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || dlg.open) return;
  // another open dashboard (or another computer) changed the apps
  if (changes.apps && JSON.stringify(changes.apps.newValue || []) !== JSON.stringify(apps)) apps = changes.apps.newValue || [];
  if (changes.layout) layout = { ...layout, ...changes.layout.newValue };
  mirrorLaunch();
  render();
});

(async () => {
  await load();
  // The copy in localStorage may be missing (new computer) or out of date.
  const want = launchUrl();
  let had = null;
  try { had = localStorage.getItem('launch-url'); } catch (e) { /* ignore */ }
  mirrorLaunch();
  if (want && had !== want && !/[?&]dash=1\b/.test(location.search)) { location.replace(want); return; }
  render();
  tick();
  setInterval(tick, 15000);
  // Re-check apps in Auto mode once a week (sites change their headers)
  const WEEK = 7 * 24 * 3600 * 1000;
  let changed = false;
  for (const a of apps) {
    if (a.mode === 'auto' && (!a.check || Date.now() - (a.check.at || 0) > WEEK)) {
      const c = await checkFraming(a.url);
      if (c.status === 'unknown' && a.check && a.check.status === 'unknown') continue; // no permission: nothing new
      a.check = c;
      changed = true;
    }
  }
  if (changed) { await saveApps(); render(); }
})();
