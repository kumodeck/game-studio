---
title: FAQ and troubleshooting
nav: FAQ
order: 9
written-for: 0.1.18
description: The editor's link, opening it in your browser, Node.js, Codex, and what to do when something's off.
---

# FAQ and troubleshooting

Quick answers, and what to do when something doesn’t work.

## The editor’s link

**Why does the link have a pass in it?** The editor can read and write your game folder, so only you should open it. The pass (the part after `?t=`) makes sure of that. It changes every time the editor starts.

**It says “Missing pass.”** You opened the editor without the whole link. After the editor opens, the pass drops out of the address bar, so copying the address from the tab doesn’t work. Ask your AI for the link.

**It says “This link is not valid.”** The editor was started again, and the pass changed. Ask your AI for the link.

**Can I share the link?** No. It only works on your computer.

## Opening it in your browser

The editor opens in your usual browser by itself, in the Claude app too. Prefer the pane next to the chat? Tell your AI “open it in the app.” It remembers that for this game. Say “open it in my browser” to switch back. If nothing opened, the link is on the first line of your AI’s reply.

In the pane, **Open large** (↗) opens the same editor in a big window. You can close the small one.

## Node.js

**It says “Game Studio needs Node.js 22.13 or later.”** Get the latest LTS from [nodejs.org](https://nodejs.org), then ask your AI again. Nothing was changed before the check.

## Codex

Game Studio works the same in Codex, with a few differences:

| | Claude Code | Codex |
|---|---|---|
| Open the editor | `/arrange` | `$arrange`, or ask in plain words |
| Updates | Can update by itself | Update with `codex plugin marketplace upgrade game-studio` |
| The AI’s line in the editor | “More in Claude” | “More in Codex” |

## My game isn’t three.js

three.js works right away. For Phaser, PixiJS, plain canvas, HTML games or a Godot web export, ask your AI to “write the Game Studio adapter for this game.” It writes one from the examples that come with Game Studio, and the editor checks that it works.

## Something’s off

**“This game isn’t connected to Game Studio yet.”** three.js games connect on their own. For other engines, ask your AI to write the adapter (above).

**“Moves may not stick in this game yet.”** The editor’s self-check found something. Your AI has the details: ask it to fix the adapter, then reload.

**“The game stopped on an error.”** Ask your AI to fix it, then press **Reload**. The editor still works.

**My change didn’t show up in the game.** Did you press **Save**? Moves before Save are only a draft. After Save, your AI puts them in the game; check its window for what it did.

**I don’t see my levels, or the UI switch.** Your game has to tell the editor about them. See [Levels](levels.md#no-levels-showing) and [UI editing](ui.md#no-world--ui-switch).

## The demo

The demo on this site runs the editor in your browser on two sample games. It isn’t connected to an AI, so there’s no box to ask in. What you change stays in your browser.

## Still stuck?

Write to [support@kumodeck.com](mailto:support@kumodeck.com).
