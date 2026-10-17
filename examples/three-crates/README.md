# three-crates

Created: 2026-10-15
Purpose: sample three.js (r186) toy for KUMODeck Game Studio — crates, barrels and a lamp loaded from .glb files.
Exercises GLTFLoader + clones, author marks (`userData.studioKey`, `userData.studioAsset`), an anonymous loaded model,
an external texture and `studio.waitForReady()` / `studio.ready({ camera })`.

- `index.html`, `game.js`, `studio-placement.js`, `style.css`
- `assets/` — crate.glb (embedded texture), barrel.glb, lamp.glb (two named nodes), grass.png
- `tools/make-assets.mjs` — generates `assets/` with no dependencies (no third-party art)
