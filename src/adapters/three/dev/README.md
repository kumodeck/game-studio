# src/adapters/three/dev

Created: 2026-10-15
Purpose: development-only helpers for the three.js adapter. Not shipped to users.

- `harness.js` — a minimal stand-in for the input bridge (select / handles / orbit / pinch / wheel / undo-redo / save),
  so the adapter can be driven with real mouse and touch events in a headless browser. The real bridge (src/bridge/)
  replaces it.
