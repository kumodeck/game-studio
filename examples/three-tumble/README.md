# three-tumble

Created: 2026-10-15
Purpose: sample three.js (r186) game for KUMODeck Game Studio — throw balls to knock blocks off a table. Every block
is a physics body whose mesh follows the body each frame, so placement must be applied BEFORE the bodies are built
(the order is spelled out in `game.js`). The physics is a few lines of our own; the same order applies to any engine.

- `index.html`, `game.js`, `studio-placement.js`, `style.css`
