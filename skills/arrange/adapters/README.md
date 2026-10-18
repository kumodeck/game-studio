# adapters

Created: 2026-10-17
Purpose: the example 2D adapters SKILL.md §2 tells your AI to copy to `.studio/adapter.js` in a game folder. Built copies of `src/adapters/` (`node scripts/build.mjs` writes them; edit `src/adapters/` instead). three.js needs none: it is built into the editor.

- `phaser.js` — Phaser 3 (3.60 and later) and Phaser 4
- `pixi.js` — PixiJS v8
- `canvas.js` — a plain `<canvas>` game that draws its own objects
- `dom.js` — objects that are HTML elements
- `godot/` — Godot 4 web export: `adapter.js` (the page) and `studio_bridge.gd` (the project)
