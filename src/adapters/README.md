# src/adapters

Adapters connect the editor's fixed port (CONTRACT.md §1) to an engine.

- `three/` — built-in three.js adapter (discovers scenes via `__THREE_DEVTOOLS__`)
- `ui/` — built-in DOM UI adapter: HTML marked `data-studio-key`, the editor's UI layer (UI stage 1, 2026-10-19)
- 2D engines: example Port2D adapters (PixiJS, Phaser) that the user's AI adapts per game
