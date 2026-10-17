# Loader fixtures

Two tiny games used to check the placement loader and the local server end to end in a real
(headless) browser: open the folder with `node skills/arrange/bin/studio.mjs <folder>`, save a
placement.json, reload, and the objects move.

- `three-game/` - three.js scene with named objects: two groups named `tree` (each holding a
  `trunk` mesh), a `rock`, and one object marked with `userData.studioKey = 'hero'`.
- `pixi-game/` - PixiJS stage with `player`, two `coin` sprites, and one marked `boss`.

Both load their library from a CDN through an import map (no install step) and import
`./studio-placement.js`, which the check copies in from `skills/arrange/bin/` first, the same way
the plugin adds it to a user's game. After applying, each game stores the loader's report and the
resulting positions in `window.__placementCheck` for the check to read.
