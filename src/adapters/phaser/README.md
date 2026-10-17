# phaser

Created: 2026-10-15
Purpose: example 2D adapter for Phaser 3.60+ / Phaser 4 (tested with 4.2.1).

- `adapter.js` — copy to `.studio/adapter.js` in the game folder. Finds the game by watching `window.Phaser` and patching `Game.prototype.boot`; keys `studioKey` -> `name` -> tree path; edit view = main camera scroll/zoom (restored afterwards). See `../2d-adapter-guide.md`.

Examples: `examples/phaser-garden`, `examples/phaser-runner`.
