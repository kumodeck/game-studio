# test/ai-feel

Created: 2026-10-16
Purpose: what the editor needs to test "asking the AI" without an AI: a stand-in agent that follows the arrange skill.

- `fake-agent.mjs` - runs `studio.mjs <folder> --watch`; on each `ask` it writes `--status received`, `working`
  (with a note), changes the game's code in two writes, then `done` with a one-line note; on `undone` it leaves the
  code alone and marks it handled. Lantern Cove gets three more lighthouses, three-crates three more crates.
  `node test/ai-feel/fake-agent.mjs <game folder> [--slow]`, or `startFakeAgent()` from a test.
  On a `play` request from the chat over a paused game (`paused, chat …` in the line, 2026-10-22) it answers in its
  `done` note and changes nothing (`chatReplyFor()`: names what was nearest the player, and the earlier turns).
