# test/neon-run

Created: 2026-10-23
Purpose: a 3D runner for the tool strip / Motion button screen test (`test/studio-tool-clear.browser.mjs`): a game that moves most of its things by itself (the orange hexagons' place, the ring's angle, the orb's size, every frame), and for making a motion on what the game moves (`test/studio-motion-move.browser.mjs`: the blue `pillar` standing on the road, like NEON DASH's).

## Contents

- index.html - the game (three.js from the CDN). The test copies the built loader in as `studio-placement.js` when it runs (not kept here, so no old copy is left behind)
