# dom

Created: 2026-10-15
Purpose: example 2D adapter for a plain-JavaScript game that moves HTML elements with CSS.

- `adapter.js` — copy to `.studio/adapter.js`. Needs one line in the game handing over its state, `render()`, the board element and a wrapper element for the edit view. Edits the game's state (not the styles) and lets `render()` write them. See `../2d-adapter-guide.md`.

Example: `examples/dom-board`.
