# godot-garden

Example for the Godot adapter (`src/adapters/godot/`). Status: written from
the Godot 4 documentation; **not yet run in a real Godot Web export**.

- `project/` — Godot 4 project (open it in Godot 4.3+). `studio_bridge.gd` is
  registered as the Autoload `StudioBridge` in `project.godot`.
- `web/` — where the Web export goes (Project > Export > Web, export path
  `../web/index.html`). `web/.studio/adapter.js` is already there; the studio
  loads it before the exported game.

Keys are node paths in `main.tscn` (`House`, `Tree`, `Tree2`); `Rock` uses the
`studio_key` metadata (`big-rock`); `Background` is hidden with
`metadata/studio = false`.

Applying a saved `placement.json`: for Godot the natural route is that the AI
agent writes the numbers back into `main.tscn` (`position`, `rotation`,
`scale` of the node named by the key) and then deletes the entry from
`placement.json`. There is no runtime loader in this example.
