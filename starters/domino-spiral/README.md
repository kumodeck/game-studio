# domino-spiral

Created: 2026-11-06
Purpose: 3D starter (three.js). About 400 glowing dominoes wound into a spiral on a dark mirror floor. A steel ball rolls
down a ramp and knocks the first one over; the fall runs to the middle, lighting each domino as it lands. Then they
stand up again from the middle out and the ball rolls again.

What to try in the editor:

1. **Move**: select `head` and drag it. The whole line follows, like pulling a rope. `bend` changes how the line
   curves on its way in, `center` moves the spiral. Press ▶ Play: the dominoes fall along the path you made.
2. **Pause and ask**: press P when about half the spiral is down (around 0:09) and ask “Make the dominoes twice as
   tall.” Your AI changes `DOMINO_HEIGHT` in `game.js`.
3. **● Clip**: Before / After shows the same second with dominoes twice as tall.

Files:

- `index.html`: page, title, hint, import map (three 0.187.0 and its add-ons from jsDelivr)
- `starter.json`, `thumb.png`: what the starter picker shows (`try`: what to move, when to pause, what to ask)
- `studio-placement.js`: applies a saved `placement.json` at start (copy of the skill's loader)
- `game.js`: the numbers to change (top), renderer, light, the mirror floor, the three points, the dominoes (one
  instanced mesh, each with its own color and glow), the ramp and the ball, the loop, bloom, camera, auto quality
- `js/path.js`: the line from the three points (a curve from `head` through `bend` onto the spiral's outer ring, then
  the spiral), and the dominoes laid along it one `GAP` apart
- `js/topple.js`: the fall. Each domino is one tilt, turning about its front bottom edge; a domino can't pass through
  the next one, so it pushes it and then leans on it

Objects: head, bend, center. The dominoes, the ramp and the ball are made by the game from those three points, so
`placement.json` never holds a domino.

No asset files: every shape, color and light is code, and three.js comes from the CDN. Everything moves in fixed
steps of time and nothing is random, so every run is the same run (the editor's Try replays to the same second).

Speed (2026-11-06, headless, Apple M5 Max GPU): 60 fps at 1280×720, and at 390×844 with the phone settings (the
same GPU: a real phone was not measured). Phones and small
screens draw at pixel ratio 1 with half-size reflections; elsewhere the game checks its speed over its first 2 seconds
and does the same below ~45 fps (`setQuality`). The fall itself (432 dominoes) steps in well under a millisecond.
