# src/hosts/browser

Created: 2026-10-16
Purpose: the browser-only web demo of Game Studio. The same editor (src/shell)
on the two starters (`starters/`, since 2026-10-17), served as plain static files (KUMODeck hosting, or
`python3 -m http.server`). No server API, no pass, no AI: everything the
person does is kept in their browser.

Build: `node scripts/build-web-demo.mjs --out <dir>` (see that script).

## Contents

- `main.ts` — entry of the editor page (`studio/?game=<id>`): the demo line
  at the top, the AI texts replaced, then `start()` of the shell with the
  browser host.
- `host.ts` — `createBrowserHost()`: StudioHost with `offline: true`.
  Results, game-tool data, look prefs, added files and kept requests in
  IndexedDB; the asset list from `studio/games.json` (made at build time).
- `store.ts` — the IndexedDB key–value store (memory fallback when the
  browser blocks storage).
- `text.ts` — the demo's words (English, Japanese).
- `demo.css` — the one line at the top; the shell gets the rest of the height.
- `game-placement.js` — injected in each sample page: the game's own
  `fetch('./placement.json')` gets the save kept in this browser, so the game
  starts (and plays) with it, like placement.json on disk with the local studio.
  It reads the save as the page starts, so the answer is ready at once (a game that
  sizes its stage after `await applyPlacement()` must not be frozen half-way).
- `index.html`, `strings.js` — the sample list (the demo's first page, with each
  starter's thumb.png) and its words (English blurbs from starter.json, Japanese here).

The local studio (src/server + src/shell/host-local.ts) is unchanged by this
folder: its Host check, pass and API stay as they are.
