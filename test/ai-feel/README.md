# test/ai-feel

Created: 2026-10-16
Purpose: what the editor needs to test "asking the AI" without an AI: a stand-in agent that follows the arrange skill.

- `fake-agent.mjs` - runs `studio.mjs <folder> --watch`; on each `ask` it writes `--status received`, `working`
  (with a note), changes the game's code in two writes, then `done` with a one-line note; on `undone` it leaves the
  code alone and marks it handled. Lantern Cove gets three more lighthouses, three-crates three more crates.
  `node test/ai-feel/fake-agent.mjs <game folder> [--slow]`, or `startFakeAgent()` from a test.
  On a `play` request from the chat over a paused game (`paused, chat …` in the line, 2026-10-22) it answers in its
  `done` note and changes nothing (`chatReplyFor()`: names what was nearest the player, and the earlier turns).
- `real-ai.mjs` - a real AI (the claude CLI with this package's arrange skill) on the AI's hands (studio-ai-hands,
  2026-10-24): "make the blue pillar spiral", then "take the old motion off, only the spiral" (also in a new
  conversation with the old motion back on). Checks it uses `--do` (an editor motion, on the timeline), leaves the
  game's code alone, puts the editor's link first and hands no steps, Reload or Save back to the person. The editor
  runs with its own HOME (no KUMODeck sign-in read) in a headless Chrome. `node test/ai-feel/real-ai.mjs [--model m]
  [--keep] [--out <dir>]`; exit 3 without the claude CLI or Chrome. Costs real AI usage.
- `pillars/` - the game it uses (Pillar Plaza: a blue pillar that already sways, three grey ones)
