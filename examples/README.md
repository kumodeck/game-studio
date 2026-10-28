# examples

Created: 2026-10-15
Purpose: small sample games to try KUMODeck Game Studio on (and to test it). No build step; engines load from a CDN.

| Folder | Engine | What it exercises |
|---|---|---|
| `three-orb-garden/` | three.js r186 | nothing has a name (every key is a path key) |
| `three-sky-duel/` | three.js r170 | named groups, repeated names (`ring#2`), a follow camera in `scene.onBeforeRender` |
| `three-crates/` | three.js r186 | .glb models + clones, author marks (`studioKey`, `studioAsset`), an external texture, `studio.ready()` |
| `three-tumble/` | three.js r186 | physics: placement applied before the bodies are built |
| `phaser-v3-hop/` | Phaser 3.80.1 | the Phaser an AI writes first; the adapter's Phaser 3 camera path (added 2026-10-17) |
| `three-isles/` | three.js r186 | three levels, three landforms (Meadow: hills and a stream; Canyon: a walled valley and a chasm; Summit: a snow mountain with a switchback path): `studio.levels()` and `applyPlacement(…, { level })`, the editor's level switch (added 2026-10-22) |
| `three-hud/` | three.js r186 | an HTML title card, Start button and score over the world, marked `data-studio-key`: the editor's UI layer (UI stage 1, added 2026-10-19) |
| `three-canvas-hud/` | three.js r186 | a runner whose score, health bar, JUMP button and minimap are drawn in a 2D canvas over the world, kept as before the AI's `codeUi()` rewrite: the UI drawn in the canvas (studio-canvas-ui, added 2026-10-24) |
| `three-neon-boss/` | three.js r186 | a runner where the game makes a boss, drones and shots a few seconds in (plain code): the paused moment — placed things, things the game moves, things it made (pause-edit, added 2026-10-28) |

Each game folder has `studio-placement.js`, the placement loader as the AI adds it to a game.
