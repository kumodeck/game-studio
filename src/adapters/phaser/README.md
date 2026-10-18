# phaser

Created: 2026-10-15
Purpose: example 2D adapter for Phaser 3.60+ / Phaser 4 (tested with 4.2.1 and 3.80.1; 2026-10-17 the Phaser 3 camera matrix was added, see `worldToScreen()`).

- `adapter.js` — copy to `.studio/adapter.js` in the game folder. Finds the game by watching `window.Phaser` and patching `Game.prototype.boot`; keys `studioKey` -> `name` -> tree path; edit view = main camera scroll/zoom (restored afterwards). See `../2d-adapter-guide.md`.

Examples: `examples/phaser-garden`, `examples/phaser-runner` (Phaser 4), `examples/phaser-v3-hop` (Phaser 3.80.1).
