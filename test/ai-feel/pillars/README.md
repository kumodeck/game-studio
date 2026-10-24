# test/ai-feel/pillars

Created: 2026-10-24
Purpose: a small game for trying a real AI (the claude CLI) on "make the blue pillar spiral" and "take the old motion
off, only the spiral" (studio-ai-hands). `../real-ai.mjs` copies it into a temporary folder.

## Contents

- `index.html`, `main.js` - a three.js plaza with one blue pillar (`blue-pillar`) and three grey ones; the loader
  (`studio-placement.js`) reads `placement.json` when the game starts
- `placement.json` - the blue pillar already has a motion, "Sway" (side to side), as a person's game would
- `studio-placement.js` - the game's copy of the loader (the editor serves its own in its place)
