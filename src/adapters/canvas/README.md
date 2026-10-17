# canvas

Created: 2026-10-15
Purpose: example 2D adapter for a plain-JavaScript game that draws its own objects on a `<canvas>`.

- `adapter.js` — copy to `.studio/adapter.js`. Needs one line in the game handing over its objects and `draw()` (`globalThis.studioGame = { things, draw }`). Reads the world-to-canvas mapping from `ctx.getTransform()`. No `setView`: the studio's CSS fallback moves the picture. Draw order (layers): `order`/`setOrder` on the game's array. See `../2d-adapter-guide.md`.

Example: `examples/canvas-stars`.
