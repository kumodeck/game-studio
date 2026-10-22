# three-isles

Created: 2026-10-22
Purpose: sample three.js (r186) game with **three levels** (Meadow, Cave, Summit) for KUMODeck Game Studio's level
switch (`CONTRACT.md` §1.10). Roll the ball, pick up the gems, reach the flag: the next level is built
in place.

What it exercises:
- `window.studio?.levels?.(LEVELS)`: tells the editor which levels the code has, and builds the one the editor asks
  for (`pick.build`: an editor-made level is built from the level it was copied from)
- `applyPlacement(scene, './placement.json', { level })`: only that level's saved layout is applied
- every object has a name (`tree-1`, `gem-2`, `flag`…), the same names in every level, so a level copied in the editor
  keeps its keys

Files: `index.html`, `game.js`, `studio-placement.js` (the loader, as the AI adds it), `style.css`.
