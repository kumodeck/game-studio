# src/core

Shared services inside the game page, independent of any engine.

- `time.ts` — holds back the game's requestAnimationFrame while editing (and while paused in ▶ Play)
- `play-clock.ts` — ▶ Play only: takes the time spent paused out of `performance.now()` and the frame timestamps, so a game steps one frame after Resume, not the whole pause (2026-10-22)
- `loads.ts` — records which files the game loaded (for the library)
- `port2d.ts` — builds a full adapter from a small Port2D
- `rules.ts` — game rules (`.studio/studio.json`, `tools.js` constrain) as one more adapter layer
- `edits.ts` — copy and delete for every adapter: real (clone/remove/putBack) or stand-ins
- `index.ts` — installCore()
