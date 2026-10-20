# How Game Studio talks

One page for anyone who writes words for Game Studio: the editor's screens, the terminal lines, the AI's replies
(SKILL.md), the README and the samples. English first (North American game makers), Japanese after.

## Who we're talking to

Someone who makes web games with Claude Code or Codex. They may have never used a level editor. They want to move
things in their game and get back to it. They don't read instructions.

**The product in one line:** *Turn your Claude or Codex into a game studio.* Game Studio is free, runs on their
computer, and needs no account. Signing in with KUMODeck adds AI images and 3D models, paid with credits.

## Six rules

1. **Name the thing.** "Click Save and your AI updates the game," not "Seamlessly sync your vision."
   No poetry, no hype, no "magic," no "!" .
2. **Say what happened, then what to do.** "Couldn't save: the file is read-only. Check the folder's permissions."
   Never stop at the problem.
3. **The AI is theirs.** "Your AI adds it to the code," never "KUMODeck automatically adds…". Game Studio is the place;
   their AI does the work.
4. **Short and plain.** Contractions (isn't, can't, you're). Sentence case for buttons and titles ("Undo AI change",
   not "Undo AI Change"). One idea per line.
5. **US spelling and punctuation.** color, gray, center, behavior, harbor. Curly quotes “ ” and apostrophes ’ on
   screen (straight ones in code and terminal output). Commas and periods go inside quotes, except when the quoted
   text is something to type: type “look” in your AI’s window.
6. **No names but ours.** Only KUMODeck and support@kumodeck.com. No other companies or people (say "AI provider").
   Claude Code, Codex and engine names (three.js, PixiJS, Phaser, Godot) are fine: they are what people use.

## Words we use

| Use | Not | Why |
|---|---|---|
| select, selected, Multi-select | pick, picked, choose (for objects) | What every editor says. "Choose" is for options in a list. |
| Duplicate (⌘D), a duplicate | copy (for objects) | "Copy" means the clipboard: "Copy request". |
| Turn, Tilt forward, Tilt sideways | Rotate, Tip | The tool is Turn (key T). "Tip" and "upright axis" read oddly. |
| Size | Scale | |
| Delete | Remove | (Remove is fine inside a sentence: "Remove it from the game.") |
| send to your AI, sent | hand to, hand off | "Sent to your AI. Waiting for a reply…" |
| Your AI has it / Your AI hasn't seen this yet | picked it up | |
| type “look” | say "look" | They type it. |
| click (desktop) / tap (phone) / press (keys, or both) | "Presses add…" | Name the device only when the string is for one device. |
| Scene, Library (with Objects and Assets inside it), Play, Edit, Save | items, files (for the panel) | The names on the buttons. The left column has Scene and Library (a try of the editor, 2026-10-18). |
| Unnamed | No name, `path:8` | Never show internal keys. |
| credits | balance, funds | KUMODeck sign-in pays with credits. |
| image | picture | Matches "Images" in Assets. (Thumbnails in a list are "thumbnails".) |
| Layer, Bring forward, Send to back | Forward, To back | What drawing apps say. |
| Collapse / Expand | Hide each one / Show each one | |
| Editor view | Editor look | Matches the View button. |

## Counts

Never "(s)". Write both forms: `'{n:1 unsaved change|# unsaved changes}'` (`plural()` in `src/shell/i18n.ts`; the
Assets strings use the same rule). Japanese has no plural, so the ja table just uses `{n}`.

## Patterns, with examples

| Moment | English |
|---|---|
| First-time tip | Click an object to select it · ⌘K for all actions |
| Sent | “Put three lighthouses here” sent to your AI. Waiting for a reply… |
| Nobody there | Your request is in. It goes into the game the next time your AI runs. [Call your AI] (never a warning, an app name or a command) |
| AI asks | Is the second door a real door, or only for looks? [A real door] [Only for looks] (answered right here) |
| Done (AI's note) | Added 3 lighthouses around the island |
| Error | The game stopped on an error. Ask your AI to fix it, then reload. |
| Confirm | You have 2 unsaved changes. Play without saving? |
| Terminal | Game Studio needs Node.js 22.13 or later (you have 20.11.0). Get the latest LTS at https://nodejs.org, then try again. |

## Japanese

Write it as a Japanese person would say it, not as a translation. Short and polite (desu/masu form) in sentences,
plain verbs on buttons (Save, Play, Duplicate, Undo). Make the same word choices as the English: one word each for
select, Duplicate, send, type “look”, Unnamed and credits. The `ja` table in `src/shell/i18n.ts` is the reference for
those words.

## The terminal

Lines that start with `studio:` on standard output are read by the AI (SKILL.md lists them): keep their first words
exactly as they are. Lines for people (stderr: help, errors) follow the rules above, and every error says what to do.
