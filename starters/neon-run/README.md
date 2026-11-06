# neon-run

Created: 2026-11-06
Purpose: puts Neon Run (`examples/three-neon-boss`) on the editor's shelf of samples without a second copy of the game.

- `starter.json` - `"from": "examples/three-neon-boss"` (the game, its `thumb.png` and its own `starter.json` are read
  from there) and `"order"` (its place on the shelf). Opening it copies the files of `examples/three-neon-boss` into the
  folder (`src/server/starters.mjs`). Its `try` and its words in other languages are the example's too
  (`examples/three-neon-boss/starter.json` and `strings.json`): one place for them, not two.
