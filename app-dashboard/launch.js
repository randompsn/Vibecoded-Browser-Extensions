/* App Dashboard - launch.js
 * Runs first on the new tab page. If you chose an app to open on every new
 * tab (⚙ → "When I open a new tab"), go straight to it. The choice is kept
 * in chrome.storage.sync; a copy in localStorage lets this run before the
 * page draws, so the dashboard doesn't flash first. newtab.html?dash=1 (the
 * toolbar button) always shows the dashboard.
 */
(function () {
  if (/[?&]dash=1\b/.test(location.search)) return;
  try {
    var url = localStorage.getItem('launch-url');
    if (url && /^https?:\/\//.test(url)) location.replace(url);
  } catch (e) { /* no localStorage: newtab.js redirects once settings load */ }
})();
