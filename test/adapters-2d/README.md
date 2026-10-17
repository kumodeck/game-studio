# adapters-2d

Created: 2026-10-15
Purpose: helpers for `test/adapters-2d.browser.mjs`, the headless-browser check of the example 2D adapters. No dependencies.

- `cdp.mjs` — tiny Chrome DevTools Protocol client (launch headless Chrome, pages, mouse/touch input, screenshots, CDN cache)
- `server.mjs` — static server that injects the edit script and `.studio/adapter.js` like the local host, and serves a scratch `placement.json`
- `studio-stub.js` — stand-in for the studio's edit script (time freeze, Port2D maths, handles, undo/redo, save) until `src/bridge` lands
