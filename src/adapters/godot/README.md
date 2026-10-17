# godot

Created: 2026-10-15
Purpose: example 2D adapter for a Godot 4 Web export. **Not yet run against a real export** (written from the Godot 4 documentation).

- `studio_bridge.gd` — goes into the Godot project as the Autoload `StudioBridge`. Exposes `window.godotStudio` through `JavaScriptBridge`: object list, pose read/write, screen transforms, pause (SceneTree.paused), edit view (root viewport canvas transform).
- `adapter.js` — copy to `.studio/adapter.js` next to the exported `index.html`. Converts window pixels to CSS pixels and gives Godot the real `requestAnimationFrame` (Godot must keep drawing while the game is paused).

Example: `examples/godot-garden`.
