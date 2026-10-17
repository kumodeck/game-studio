# src/core

Shared services inside the game page, independent of any engine.

- `time.ts` — holds back the game's requestAnimationFrame while editing
- `loads.ts` — records which files the game loaded (for the library)
- `port2d.ts` — builds a full adapter from a small Port2D
- `rules.ts` — game rules (`.studio/studio.json`, `tools.js` constrain) as one more adapter layer
- `edits.ts` — copy and delete for every adapter: real (clone/remove/putBack) or stand-ins
- `index.ts` — installCore()
