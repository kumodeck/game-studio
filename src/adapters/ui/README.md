# ui

Created: 2026-10-19
Purpose: the built-in DOM UI adapter — the game's HTML UI (title card, score, buttons) as the editor's second layer
("World | UI", UI stage 1). Not an example to copy: the bridge uses it by itself (CONTRACT.md §1.1, the UI seat).

- `adapter.js` — a `Port2D` over the elements marked `data-studio-key` (left out: `data-studio="false"`, not drawn,
  moved by the game itself). Moves and sizes them with the CSS `translate` / `scale` properties through the loader's
  `placeUi()` (`src/loader/studio-placement.js`), so the editor and the game place them the same way; pauses CSS
  animations while editing. Each element listed with its screen (`screen`: its container's `data-studio-screen`,
  UI stage 2); the rest of stages 2–3 (screens shown, text, colours, states, theme) is the bridge's `ui-extras.ts`.
- `index.ts` — `findDomUi()` / `findDomUiPort()` (null when nothing is marked: then nothing changes for the game; the
  port is merged with the UI drawn in the canvas, `src/bridge/code-ui.ts`, into one list since 2026-10-24) and
  `uiAdapterFromPort()` (any UI port through `adapterFromPort2D`; also used for `studio.registerUI()` ports).

Tests: `test/ui-layer.test.ts`, `test/studio-ui-layer.browser.mjs`. Sample: `examples/three-hud`.
