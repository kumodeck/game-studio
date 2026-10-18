# firefly-ruins

Created: 2026-10-16
Purpose: 2D starter (PixiJS v8). An old stone gate by a still pond at sunset. Fireflies come out; tap to send a
breeze through the scene, tap the bell to ring it.

- `index.html`: page, title, hint, import map (pixi.js 8.21.0 from jsDelivr)
- `starter.json`, `thumb.png`: what the starter picker shows
- `studio-placement.js`: applies a saved `placement.json` at start (copy of the skill's loader)
- `assets/`: the files the game loads — `bell.png` + `bell.mp3` (the bell), `lantern.png`, `boat.png`, `banner.png`
  (the cloth's picture), `boat-lacquer.png` (a spare boat for trying Replace). Made by
  `scripts/make-starter-assets.mjs`; each is optional (a missing one is painted by `js/paint.js` instead)
- `.studio/adapter.js`: the editor's PixiJS adapter. Copy of `src/adapters/pixi/adapter.js` with one change
  ("ADAPTED" in `draw()`): it asks the game to redraw the pond's reflection before each editor frame
- `js/main.js`: app, draw order, fitting the 1280×800 world to any screen, input, loop
- `js/paint.js`: the pictures painted with Canvas 2D at load (one low sun on the right for all of them), and the
  fallbacks for the four in `assets/`
- `js/backdrop.js`: sky, sun, hills in haze, light shafts, mist, the bank (not editable)
- `js/objects.js`: the files in `assets/` (`FILES`, `loadPictures()`), the 14 objects you can arrange (each a
  Container with `studioKey`), the banner's cloth
- `js/pond.js`: the reflection (the scene drawn into a texture, shown upside down in rippling strips), glitter, ripples
- `js/life.js`: fireflies, dust, leaves, wind, the bell (pendulum; plays `assets/bell.mp3`, a Web Audio tone without it)

Objects: bell, giant-head, stone-1, arch, stairs, banner, urn, pillar-1, pillar-2, lantern, tree, stone-2, boat, reeds.
