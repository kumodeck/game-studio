# phaser-v3-hop

Created: 2026-10-17
Purpose: a Phaser **3.80.1** game (CDN) for the Phaser adapter — the version an AI writes first when asked for "a small Phaser game". Before 2026-10-17 the bundled adapter only worked with Phaser 4 (no `camera.matrixCombined` in Phaser 3), and `/arrange` on such a game took about ten minutes.

- `index.html`, `game.js` — the game (art baked from Graphics, Arcade Physics, objects named with `setName`, a repeated name `coin`, a HUD fixed to the screen, a drifting cloud)
- `placement.js` — loader that applies `placement.json` (same as phaser-runner)
- `.studio/adapter.js` — copy of `src/adapters/phaser/adapter.js`
