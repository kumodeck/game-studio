# three-orb-garden

Created: 2026-10-15
Purpose: sample three.js (r186) game for KUMODeck Game Studio — roll a ball and collect orbs. Every object is anonymous,
so the editor lists them by their place in the scene ("no name"): the least friendly case on purpose.

- `index.html` — page + import map (three from jsDelivr)
- `game.js` — the game; calls `applyPlacement(scene)` once after building the world
- `studio-placement.js` — the placement loader
- `style.css`
