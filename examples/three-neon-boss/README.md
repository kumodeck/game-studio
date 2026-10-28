# three-neon-boss

Created: 2026-10-28 (pause-edit, stage 1)
Purpose: sample three.js (r186) runner for the **paused moment** (pause anytime, the moment becomes the editor;
CONTRACT.md §3.5.1). A few seconds in, the game **makes** a boss in the middle lane,
two drones beside it and shots it fires — in plain code (`spawnBoss()` writes the position), as an AI usually writes it
first.

- `index.html` — the canvas, the HTML HUD (score, time left) and the "⚠ BOSS" banner.
- `game.js` — the world and the run. Things **placed** (the road, `gate`, `ring`, `orb`, the pillars), things the
  game **moves** (`ship` weaves by itself, the `hex`agons come down the road) and things the game **makes** (`boss` at 4 s,
  `drone` ×2 at 5 s, `shot`s). Everything moves by the time between frames and is seeded.
- `studio-placement.js` — the placement loader (kept up to date by the build).
- `starter.json`, `thumb.png` — its place in the web demo (pause-edit fix 1, 2026-10-28): `scripts/build-web-demo.mjs
  --also examples/three-neon-boss` lists it among the 3D samples ("Neon Run"), so the demo, which has no AI, shows
  "Made by the game" and "Just for this moment" too (Lantern Cove, Firefly Ruins and Glow Garden have nothing the game
  makes). The thumb is the game's frame as the boss comes in (headless Chrome, 1264×790 → 640×400).

Try: `node skills/arrange/bin/studio.mjs examples/three-neon-boss` (from `oss/game-studio`), ▶ Play, set ¼× in the top
bar, press P when the boss comes in: the gate moves as in Edit (Save · 1), the boss "just for this moment"; drag it to
the left lane and press ✦ "Have Claude make it appear here".

Tests: `test/studio-pause.browser.mjs --only moment` (the paused moment), `test/ai-feel/real-ai.mjs` (the real AI
changes where the boss appears).
