# src/adapters/three/test/lib

Created: 2026-10-15
Purpose: helpers for the headless browser test (no dependencies).

- `cdp.mjs` — launch headless Chrome, real mouse / touch / key input, screenshots
- `server.mjs` — serves oss/game-studio/, injects boot.js + the harness into example pages, stores placement.json
- `cdn-mirror.mjs` — STUDIO_THREE_DIRS: answer cdn.jsdelivr.net three requests from local copies
