# examples

Created: 2026-10-15
Purpose: small sample games to try KUMODeck Game Studio on (and to test it). No build step; engines load from a CDN.

| Folder | Engine | What it exercises |
|---|---|---|
| `three-orb-garden/` | three.js r186 | nothing has a name (every key is a path key) |
| `three-sky-duel/` | three.js r170 | named groups, repeated names (`ring#2`), a follow camera in `scene.onBeforeRender` |
| `three-crates/` | three.js r186 | .glb models + clones, author marks (`studioKey`, `studioAsset`), an external texture, `studio.ready()` |
| `three-tumble/` | three.js r186 | physics: placement applied before the bodies are built |

Each game folder has `studio-placement.js`, the placement loader as the AI adds it to a game.
