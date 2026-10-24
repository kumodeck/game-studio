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
  `--steps to-rule` (studio-code-torule, 2026-10-24): the plaza gets six street lamps, a swaying ship and five crates,
  all put by hand, and the AI is asked (in Japanese) to turn the lamps, then the ship's motion, then the crates into a
  rule: a `--replace` of its own for the first two with the editor's measure in the reply, nothing replaced for the
  crates (no rule comes close), and never steps for the person.
  `--steps writeback` (studio-writeback, 2026-10-24 — "the code is the truth"): the plaza gets a road and street lamps on
  both sides as one codePlace; in two new conversations the person (through the editor) shifts every lamp 1 m from the
  road, then puts lamp 5 by hand, presses Save each time and says "saved" — the AI writes each into the code and sends
  `place.code --fold`: the file no longer has it, every lamp stands where it stood (1 cm), nothing is left to save, and
  the editor's measure ("the look is the same") is what the AI got back.
- `pillars/` - the game it uses (Pillar Plaza: a blue pillar that already sways, three grey ones)
