# lantern-cove

Created: 2026-10-16
Purpose: 3D starter (three.js). A quiet harbour at dusk: clear water, a lighthouse, boats that float. Tap the water
(or use WASD / arrow keys) to sail the sailboat.

- `index.html`: page, title, the one-line hint, import map (three 0.186.1 from jsDelivr)
- `starter.json`, `thumb.png`: what the starter picker shows
- `studio-placement.js`: applies a saved `placement.json` at start (copy of the skill's loader)
- `js/main.js`: renderer, light, post-processing (clamp → bloom → ACES → vignette/grain), camera, input, loop, auto quality
- `js/sky.js`: the dusk sky (one GLSL function, baked once into a cube map; also the "air" colour of the far sea)
- `js/terrain.js`: one height field for the land, the sea floor, the water shader's depth texture and the physics
- `js/water.js`: waves (shared with the physics), the water shader, the planar reflection
- `js/props.js`: the 15 objects you can arrange (each a Group with `userData.studioKey`)
- `js/sim.js`: floating on the waves, sailing, wake, bumps, wind on the pines, the lighthouse beam
- `js/decor.js`: boulders and gulls (not editable)

Objects: lighthouse, sea-arch, sea-stack, sea-stack-small, cottage, pier, lamp-post, pine-1, pine-2, pine-3,
sailboat, rowboat, buoy, barrel, crate.
