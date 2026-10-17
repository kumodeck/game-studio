# pixi

Created: 2026-10-15
Purpose: example 2D adapter for PixiJS v8 (tested with 8.21.0).

- `adapter.js` — copy to `.studio/adapter.js` in the game folder. Finds the app through `globalThis.__PIXI_APP_INIT__` (no change to the game); keys `studioKey` -> `label` (Pixi's default class-name labels ignored) -> tree path; edit view = `renderer.render({ container, transform })`, so `app.stage` is never changed; draw order (layers) = the parent's children order (`setChildIndex`, `zIndex` kept in step under `sortableChildren`), keys kept per object for the session. See `../2d-adapter-guide.md`.

Examples: `examples/pixi-garden`, `examples/pixi-bubbles`.
