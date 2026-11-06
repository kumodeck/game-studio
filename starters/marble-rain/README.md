# marble-rain

Created: 2026-11-06
Purpose: 2D starter (Phaser 3.80.1 with Matter physics, from the CDN). Hundreds of glowing marbles pour from a spout,
bounce down through a triangle of pins and pile up in thirteen bins (a Galton board). When the bins are full the floor
opens, they fall out and the rain goes on. Tap to pour a handful.

What to try in the editor: drag a pin (the top one, `pin-1-2`, changes the most) and press ▶ Play — the marbles fall
another way. Press P while they pour, mark a spot with ◎ and ask "Add a spinning paddle here."

- `index.html`: page, title, marble count, Phaser 3.80.1 from jsDelivr (the full build: Matter is in it)
- `game.js`: the whole game. The numbers to change are at the top: `PADDLES` (spinning paddles, empty at first),
  `MARBLES` (most on the board at once: 380, 220 on a phone), `DROP_EVERY`, `SEED`
- `placement.js`: applies a saved `placement.json` at start (the Phaser loader, same as `examples/phaser-v3-hop`)
- `.studio/adapter.js`: the editor's Phaser adapter, an unchanged copy of `src/adapters/phaser/adapter.js`
- `starter.json`, `thumb.png`, `strings.json` (the Japanese blurb and ask): what the starter picker shows (`try`: the pin to move, the second to pause at, the words
  to ask, `mark`: point at the spot with ◎ first)

Objects you can arrange: `spout` (where the rain comes from), the 75 pins `pin-<row>-<n>` (row 1 at the top, n from the
left) and each paddle `paddle-<n>`.

How it stays the same every run (decided 2026-11-06, so Try in the editor replays the same moment): the rain is
seeded, and Matter steps at a fixed 1/60 s counted from the game's clock (`autoUpdate: false`, `stepOnce()`). When a
pin, the spout or a paddle was moved, the rain is worked out again from step 0 with the new layout up to the step it was
at (`replay()`), so ▶ Play shows the new layout's fall, and the editor's Try (a fresh page played to the same second)
shows the same moment.

Why the marbles are never in `placement.json`: they are Matter bodies with no game object. Each is drawn by an image
marked `studio = false`, which the adapter leaves out, so the editor never lists them and a Save after playing writes
only what you moved. The pins and paddles are static bodies (they never move by themselves). The screen test
`test/studio-marble-rain.browser.mjs` checks it.

On a phone held upright (outside the editor), the board is laid out tall, 720 × 1360 (decided 2026-11-06): the wide
board fitted to 390 × 844 was a thin strip. The pins sit closer side by side and further apart top to bottom; every
placed thing is mapped from the board's own 1280 × 800 pixels (`bx()` / `by()` in `game.js`), so `PADDLES` and
`placement.json` stay in those pixels and a layout made in the editor shows the same on the phone. The tall board is
its own fall, seeded and stepped the same way. Inside the editor the board is always the wide one.

No files are loaded: every picture (marbles, glows, pins, the backdrop) is drawn on a canvas at start.

Measured 2026-11-06 headless on an Apple M5 Max GPU: 60 fps at 1280×800 and at 390×844 (phone, 220 marbles); two
loads give the same marble positions at every second of the first 14.
