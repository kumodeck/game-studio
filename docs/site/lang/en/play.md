---
title: Play
nav: Play
order: 3
written-for: 0.1.18
description: Play your game in the editor, pause it, talk to your AI about what you see, and move things where it stopped.
---

# Play

Press **▶ Play** to play your game right where you’re editing it. Press **Edit** to go back. It’s the same page, so nothing reloads.

## Play and Edit

- **▶ Play** (or <kbd>P</kbd>) plays the game as you arranged it, saved or not. The top bar says **Playing**.
- **Edit** (or <kbd>P</kbd>) takes you back. Everything is where it was before you pressed Play: your layout, your camera, what you selected. Anything the game moved while you played (the hero, an enemy) goes back too.
- The game’s own state, like the score or a timer, isn’t part of your layout. To start that over, use **Play from the start** in Play’s ▾ menu (or <kbd>⌘</kbd><kbd>K</kbd>). It opens the game fresh.

### Changes you haven’t saved

If you press Play with changes that aren’t saved, the editor asks first:

![The window at Play: You have 3 unsaved changes, with Cancel, Try without saving, and Save and play](media/play-unsaved.webp)

- **Save and play** (<kbd>Enter</kbd>) saves, so your AI puts the changes in the game’s code, then plays.
- **Try without saving** plays with your changes. They’re still there when you come back to Edit, and **Save · 3** stays.
- **Cancel** (or <kbd>Esc</kbd>) stays in Edit.

Going back from Play to Edit never asks.

## Pause and talk to your AI

Something odd happens? Press <kbd>P</kbd> while the game has the focus, or the **❚❚** button. The game stops right there: its clock, its sound, everything. A chat opens beside it.

![The game paused, with the chat open and the AI’s reply](media/pause-chat.webp)

Ask about what you see: why it happened, how it works, what to change. Your AI sees the moment you paused: a picture of the game, where your camera was, what was near you, and any errors. Send as many messages as you like.

To go on, press <kbd>P</kbd>, <kbd>Esc</kbd> or **Resume**. The game goes on from the exact frame it stopped on.

On a phone or in a narrow window, **❚❚** is in the top bar and the chat opens at the bottom.

## Move things where you paused

While paused, press **Move** (or <kbd>M</kbd>). Now you can select and drag things at that moment, with the same tools as in Edit. The camera stays the player’s. Resume, and the game goes on from there.

A thing you move this way is **Only in this play**: it’s gone the next time the game opens. To keep it:

- **Put in layout** makes it part of your layout, just like a move in Edit. It counts on **Save · N**.
- **Put back** returns it to where it was at the pause.

Some things can’t stay: if the game moves something itself, the move is **Just for this moment**.

Press **Chat** (or <kbd>Esc</kbd> with nothing selected) to go back to the chat.

> **Edit vs Move.** Pressing **Edit** while paused takes you back to your layout, not to the paused moment. To change things at that moment, use **Move**.

## Ask while you play

You don’t have to stop. Press <kbd>`</kbd> (the key left of 1; <kbd>Shift</kbd><kbd>@</kbd> on a Japanese keyboard) or the small ✦ mark in the corner, type what’s wrong, and press <kbd>Enter</kbd>. The game keeps running, even full screen.

Your AI gets your words with that moment. A small line at the top says what it’s doing: **Your AI is looking**, **Fixing it**, then its reply. The game never reloads under you. When you want the fix, press **Reload** (or <kbd>`</kbd> then <kbd>Enter</kbd>). Or keep playing.

If your AI asks you something, the answers show up as buttons right there. For the whole story, the line says **More in Claude** (or Codex): the full reply is in your AI’s window.

Next: [Motion](motion.md).
