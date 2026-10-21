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
- `index.html`, `lp.js`, `strings.js` — the front page (2026-10-19, it replaced the sample list): what Game
  Studio is, the install line (INSTALL.md's, via games.json), the editor itself in a frame
  (`studio/?game=<id>&embed=1`, loaded when seen, "Click to use" before it takes the wheel and keys, no frame on
  phones narrower than 768 px: the samples are cards that open the editor), three things it does, KUMODeck as an option.
  Checked by `test/web-demo-lp.browser.mjs`.
- `embed.ts` — the editor in that frame: no "← Samples", arrows / Space / Page Down / End pressed in it (or in
  the game inside it) don't scroll the front page, and until its first press the wheel over it scrolls the front
  page (that first press is a real one: it selects. 2026-10-20, it replaced a clear "Click to use" cover).

The local studio (src/server + src/shell/host-local.ts) is unchanged by this
folder: its Host check, pass and API stay as they are.
