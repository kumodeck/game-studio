# three-hud

Created: 2026-10-19
Purpose: sample three.js (r186) toy with an HTML UI over the 3D world — for the editor's UI layer (UI stage 1).
A garden at night: press Start, tap the five lanterns. The title card, the Start button and the score are HTML.

- `index.html` — the UI, marked `data-studio-key="title-card" | "start-button" | "score"` (and, since UI stages 2–3,
  2026-10-22, `play-hint`, `pause-button`, `pause-card`, `resume-button`, `result-card`, `again-button`). Four screens
  marked `data-studio-screen="title" | "play" | "pause" | "over"` (hidden with the `hidden` attribute, the editor shows
  each one), the score's number marked `data-studio-value` (sample values go there) and its word `data-studio-text`,
  the colours and fonts as CSS variables on `:root` (the editor's Theme), and buttons with `:hover`, `:active` and
  `:disabled` looks (the card's State). The title is centred
  with `transform: translate(-50%, -50%)`, the button with the `translate` property, and the button glows with a
  CSS animation: the UI layer must keep all three as they are.
- `game.js` — the world (four trees, five lanterns, each with `userData.studioKey`, on a lawn that runs on into the fog: a
  10 m disc made the editor's camera leave the ground and its rim look like a slanted horizon, 2026-10-20) and
  `applyPlacement(scene, './placement.json')`, which applies both `objects` and `ui`.
- `studio-placement.js` — the placement loader, as the AI adds it to a game.

- `starter.json`, `thumb.png` — its line and picture for a try-out build (`scripts/build-web-demo.mjs --also examples/three-hud`).

Try: `node skills/arrange/bin/studio.mjs examples/three-hud` (from `oss/game-studio`), press **U** (or **World | UI** in the top bar), drag the title, press Save. Open the game
without the editor: the title is where you put it. Then the list's head **Title ⌄** shows another screen (Playing,
Paused, Game over); pick the Start button for its State, Text, Color and Fill; pick the score for a Sample (999,999);
open **Theme** under the list for the colours and fonts.
