# src/adapters/three/test

Created: 2026-10-15
Purpose: tests of the three.js adapter.

- `keys.test.mjs` — candidates and keys on plain objects, math helpers (Node only)
- `browser.test.mjs` — the four three.js samples in headless Chrome with real mouse / touch / keys, desktop and phone
- `lib/` — test-only helpers: `cdp.mjs` (DevTools protocol client), `server.mjs` (static server that injects the
  editor scripts), `cdn-mirror.mjs` (serve CDN three.js from local copies for offline runs)
