# firefly-ruins

Created: 2026-10-16
Purpose: 2D starter (PixiJS v8). An old stone gate by a still pond at sunset. Fireflies come out; tap to send a
breeze through the scene, tap the bell to ring it.

- `index.html`: page, title, hint, import map (pixi.js 8.21.0 from jsDelivr)
- `starter.json`, `thumb.png`: what the starter picker shows
- `studio-placement.js`: applies a saved `placement.json` at start (copy of the skill's loader)
- `.studio/adapter.js`: the editor's PixiJS adapter. Copy of `src/adapters/pixi/adapter.js` with one change
  ("ADAPTED" in `draw()`): it asks the game to redraw the pond's reflection before each editor frame
- `js/main.js`: app, draw order, fitting the 1280×800 world to any screen, input, loop
- `js/paint.js`: every picture, painted with Canvas 2D at load (one low sun on the right for all of them)
- `js/backdrop.js`: sky, sun, hills in haze, light shafts, mist, the bank (not editable)
- `js/objects.js`: the 14 objects you can arrange (each a Container with `studioKey`), the banner's cloth
- `js/pond.js`: the reflection (the scene drawn into a texture, shown upside down in rippling strips), glitter, ripples
- `js/life.js`: fireflies, dust, leaves, wind, the bell (pendulum and a Web Audio tone)

Objects: bell, giant-head, stone-1, arch, stairs, banner, urn, pillar-1, pillar-2, lantern, tree, stone-2, boat, reeds.
