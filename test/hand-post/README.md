# test/hand-post

Created: 2026-10-28
Purpose: a three.js game whose look comes from a post-processing made by hand (no EffectComposer: the scene drawn into a
render target, then a full-screen picture of it, tinted warm red), with the paused picture's draw the AI writes once —
`codeMoment({ draw })` (pause-light, SKILL.md "This moment"). For `test/studio-pause.browser.mjs --only lightcode`: the
paused moment keeps the tint after a move and after the view moved, the game's update never runs for it, and the game's
camera is given back exactly.

## Contents

- index.html - the game (three.js from the CDN). The test copies the built loader in as `studio-placement.js` when it runs (not kept here, so no old copy is left behind)
