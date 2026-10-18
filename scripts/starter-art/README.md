# scripts/starter-art

Created: 2026-10-17
Purpose: the code that makes the starters' asset files (`starters/<id>/assets/`). Run through
`node scripts/make-starter-assets.mjs`; the games never load anything from here.

WHY: both starters used to draw everything in code, so the editor's Assets panel had nothing to list, show or
swap. Each starter now loads a handful of real files. They are made here rather than downloaded, so there is no
third-party licence to track (MIT like the rest of the package) and a change is a code change.

- `lantern-cove.js` — in the browser (three.js 0.186.1): `sail.jpg`, `sail-tanbark.jpg` (a spare sail to try
  Replace with), `planks.jpg` (Canvas 2D), `barrel.glb` (three.js shapes → GLTFExporter, vertex colours, no texture)
- `firefly-ruins.js` — in the browser (Canvas 2D, painted at 3× world size): `bell.png`, `lantern.png`, `boat.png`,
  `boat-lacquer.png` (the spare), `banner.png` (the cloth's picture)
- `sounds.mjs` — in Node: additive bells and a looping sea, encoded to MP3 by ffmpeg (`bell.mp3` for each starter,
  `waves.mp3` for Lantern Cove)

All randomness is seeded: running the script again writes byte-identical files (`--check` verifies that).
