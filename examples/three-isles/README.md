# three-isles

Created: 2026-10-22
Purpose: sample three.js (r186) game with **three levels, three landforms** for KUMODeck Game Studio's level switch
(`CONTRACT.md` §1.10). Roll the ball, pick up the gems, reach the flag: the next level is built in place.

| Level | Landform | How it plays |
|---|---|---|
| **Meadow** | rolling hills, a stream across the middle, a wooden bridge, a grove on the west hill | gentle: every slope can be rolled up; the water slows you |
| **Canyon** | a narrow valley winding north between dark walls; stone pillars, glowing crystals, a chasm with a rope bridge | tight: the walls stop you; miss the bridge and you start again |
| **Summit** | a steep snow mountain, a switchback path up its face to the flag on top, a frozen pond and ice blocks below | tall: the face is too steep, take the path (long traverses joined by short turns, a snow bank on the open side); the pond is slippery |

(Version 1, same day, had three flat floors in three colours; a review: levels should differ in their design —
different terrain reads at a glance.)

What it exercises:
- `window.studio?.levels?.(LEVELS)`: tells the editor which levels the code has, and builds the one the editor asks
  for (`pick.build`: an editor-made level is built from the level it was copied from)
- `applyPlacement(scene, './placement.json', { level })`: only that level's saved layout is applied
- every object has a name (`tree-1`, `gem-2`, `flag`…), the same names in every level, so a level copied in the editor
  keeps its keys. The landform is one object, `ground` (its water, bridges and ice are its children)

How the terrain works: each level is a height function `(x, z) → y` (`levels.js`). The same function builds the
ground's mesh (a 150 × 150 grid, coloured by height and slope, flat-shaded, with straight cliff sides) and is the
ball's floor (`game.js`: the slope pulls it, a step too high is a wall). No textures or models are loaded.

Files: `index.html`, `game.js` (scene, ball, input, loop), `levels.js` (the three landforms and the things on them),
`studio-placement.js` (the loader, as the AI adds it), `style.css`.
