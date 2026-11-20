# App Dashboard

A new tab page that shows the apps you choose: live, embedded on the page where possible, or as link buttons along the top.

## Using it

- **+ Add app**: enter the app's address and pick how to show it:
  - **Auto** embeds it if the site allows that, otherwise makes it a link.
  - **Embed** always embeds it.
  - **Link** always shows a button.
- The first time you add a site, the browser asks to let the dashboard read that site. It needs this to check whether the site can be embedded, and to embed a site that normally refuses.
- **Edit** shows edit and remove buttons on every app. Drag tiles or link buttons to reorder them. Press **Done** or Esc when finished.
- **⚙** sets the number of columns, the row height and the clock, and exports or imports your list.
- **↻** reloads a tile; **↗** opens the app in its own tab.
- **⚙ → When I open a new tab** can open one app full size on every new tab instead of the dashboard. When one is chosen, the toolbar button opens the dashboard.
- Version 1.1 adds your Essay Editor (claude.ai) once and sets it to open on new tabs. claude.ai can't be shown inside other pages, so it opens full size. Change this in ⚙.

## How Embed works

Many sites send `X-Frame-Options` or `Content-Security-Policy: frame-ancestors`, which stop other pages from showing them in a frame. For apps set to Embed, `rules.js` removes those two headers with a `declarativeNetRequest` rule. The rule is limited in three ways:

- It only covers that app's site.
- It only covers frames.
- It only covers frames opened by this extension's own pages.

On every other page, the site keeps its protection.

Some apps still won't work embedded:

- **Sign-in:** some apps refuse to sign in inside a frame (Google and Microsoft accounts often do). If a tile keeps showing a sign-in page, set the app to Link.
- **Script checks:** a few apps check from their own scripts whether they're framed and stop working. Set those to Link too.

## Files

| File | What it is |
| --- | --- |
| `newtab.html` / `newtab.css` / `newtab.js` | The page. Apps are saved in `chrome.storage.sync` under `apps`, the layout under `layout`. |
| `rules.js` | The embedding rules (shared with the background worker). |
| `launch.js` | Runs first on a new tab and opens the chosen app. |
| `background.js` | Opens the dashboard from the toolbar button and rebuilds the rules after updates or permission changes. |
