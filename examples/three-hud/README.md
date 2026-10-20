# three-hud

Created: 2026-10-19
Purpose: sample three.js (r186) toy with an HTML UI over the 3D world — for the editor's UI layer (UI stage 1).
A garden at night: press Start, tap the five lanterns. The title card, the Start button and the score are HTML.

- `index.html` — the UI, marked `data-studio-key="title-card" | "start-button" | "score"`. The title is centred
  with `transform: translate(-50%, -50%)`, the button with the `translate` property, and the button glows with a
  CSS animation: the UI layer must keep all three as they are.
- `game.js` — the world (four trees, five lanterns, each with `userData.studioKey`, on a lawn that runs on into the fog: a
  10 m disc made the editor's camera leave the ground and its rim look like a slanted horizon, 2026-10-20) and
  `applyPlacement(scene, './placement.json')`, which applies both `objects` and `ui`.
- `studio-placement.js` — the placement loader, as the AI adds it to a game.

- `starter.json`, `thumb.png` — its line and picture for a try-out build (`scripts/build-web-demo.mjs --also examples/three-hud`).

Try: `node skills/arrange/bin/studio.mjs examples/three-hud` (from `oss/game-studio`), press **U** (or **World | UI** in the top bar), drag the title, press Save. Open the game
without the editor: the title is where you put it.
