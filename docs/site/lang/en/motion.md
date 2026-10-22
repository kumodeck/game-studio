---
title: Motion
nav: Motion
order: 4
written-for: 0.1.18
description: Make things move with the timeline, choose when a motion starts and stops, and reuse motions from the Library.
---

# Motion

Make a boat sail, a door open, a coin spin. You set where a thing is at a few moments in time, and the editor fills in the movement between them. Motion works in 3D games.

## The timeline

Select something, then press **◆ Timeline** on its card (or find **Timeline** in <kbd>⌘</kbd><kbd>K</kbd>). The timeline opens at the bottom of the game (above the card on a phone).

![The timeline under the game, with the boat’s keys and its path](media/timeline.webp)

Its top is one line, with what you use every time: **▶** (or <kbd>Space</kbd>), the time and the motion’s **length**, **● Auto key**, the **motion** menu, **Starts**, then **⋯**, **✦ Ask AI** and **⌄** to fold it.

- The **ruler** is time. Drag on it to see that moment. <kbd>←</kbd> <kbd>→</kbd> move 0.1 s (<kbd>Shift</kbd> for 1 s).
- Click the length after the time to type a new one, in seconds.
- Each object has a row. Open it to see **Position**, **Angle** and **Size** on their own rows.
- **⋯** has the rest: **Repeat**, **Stops**, other ways to start, and **Try**.

## Keys

A **key** says “at this time, be here.”

1. Move the time line to a moment, like 2 s.
2. Move, turn or resize the object.

With **Auto key** on (it is, to start), that sets a key at the time line. The first one also sets a key at 0 s, where the object started. Press <kbd>K</kbd> to set a key without moving anything.

To change keys, click them (<kbd>Shift</kbd> or <kbd>⌘</kbd> adds more, or drag a box):

- Drag them along the ruler to change their time.
- <kbd>Delete</kbd> removes them. <kbd>⌘</kbd><kbd>C</kbd> and <kbd>⌘</kbd><kbd>V</kbd> copy them to the time line.
- Every change is one undo step.

**Auto key off**, or the timeline folded: moving the object moves its whole motion with it.

## The path

In 3D, the object’s way through its position keys is drawn in the scene, with a dot for each key and a dashed line down to the ground. Drag a dot to move that key across the ground. <kbd>Shift</kbd>-drag moves it up and down.

![A picked point of the boat’s path with its two handles, and the + on the line](media/motion-path.webp)

- **Bend the path.** Select a key (on the timeline or its dot) and two **handles** show. Drag one to bend the path there; the other one follows. <kbd>Alt</kbd>-drag moves only one, for a sharp turn.
- **Make a corner.** Double-click a dot (or choose **Point → Corner** at the top of the timeline). The path comes straight in and goes straight out. Double-click again for a smooth point.
- **Add a key on the path.** Point at the line: a **+** follows it with the time. Click to set a key at that moment, without changing the path’s shape.

## How keys flow into each other

Select keys and a **Keys** menu shows on the timeline’s top line. Choose how they go on to the next one:

- **Ease in-out**: starts slow, ends slow. The default.
- **Steady**: the same speed all the way.
- **Jump**: stays put, then jumps to the next key.

**Repeat** (in **⋯**) sets what happens at the end: **Once**, **Loop**, or **Back and forth**.

To start quickly, a new motion can begin from a template: **Back and forth**, **Round**, **Once** or **Spin**. Its keys are plain keys you can change.

## When it starts

**Starts**, on the timeline’s top line, chooses when a motion begins. The **▶** next to it tries that moment.

![The timeline’s one line with Starts: the rowboat starts when the player enters its area](media/motion-when.webp)

These play by themselves:

- **The game starts**
- **After some seconds**
- **A key is pressed**
- **This is clicked / tapped**
- **Another motion ends**
- **The player enters an area**: a box shows in the scene. Drag its white point to place it (<kbd>Shift</kbd>-drag for up and down). Drag a corner to resize it from the opposite corner (<kbd>Shift</kbd>-drag for its height).

These your AI connects in the game’s code:

- **The player touches this**
- **A cue**: a name your game sends, like “door-open”
- **In the chat, to your AI…**: the chat box at the bottom opens with this motion in it. Say when, like “when the player walks up,” and your AI makes it happen.

In **⋯**, **+ or** adds another way to start, like “a key is pressed **or** this is clicked.” Any one of them starts it. **×** removes one. The top line then says **+1 more**.

![Starts: a key is pressed, or the player enters an area — the area with its corners](media/motion-or.webp)

**Stops** (in **⋯**) chooses when it ends: **Never**, **After some rounds**, or **A cue**. Then it **Stays there** or **Goes back**.

## Try it

The **▶** next to **Starts** runs the scene as if this motion’s start just happened. Press it again to stop.

**Try** in **⋯** shows one ▶ for each way a motion can start in this scene, like “Game starts” or “Click boat.” Press one to run the scene as if that just happened. **Stop** ends it.

## Scenes: several things in one motion

A **scene** moves several objects together, like a short cutscene: the boat rows in, the buoy dips, the barrel rolls off the pier.

![A scene with three objects on one timeline, and the crate’s + Add row](media/motion-scene.webp)

1. In the motion menu at the top of the timeline, choose **New: Scene — several objects**. It starts with the selected object.
2. Select another object. Its row says **+ Add crate to “Arrival”**. Press it, or just move the object with **Auto key** on.
3. Each object has its own row of keys, on one time line. **Starts** and **Stops** are the scene’s: all of them start together.

**×** on a row takes that object out of the scene. Dropping a scene from the Library onto an object adds that object to it.

## The motion Library

Every motion is in the Library, under **Motion**. Each tile draws the path and plays it when you point at it.

![Motions in the Library](media/motion-library.webp)

- **Attach to…** puts the same motion on another object. Change its keys once and every object that uses it changes.
- **Duplicate** makes a copy to change on its own.
- **Ask your AI…** puts the motion in the box at the bottom, so you can ask for something like “make it bob more.”

## Ask your AI for a motion

You don’t have to set keys yourself. Two ways to use your AI:

- **Use a motion you made.** Press **✦ Ask AI** on the timeline (or **Ask your AI about…** in the card’s motion menu, a right-click on the object, or the motion in the Library). The chat box at the bottom gets a chip with both names, like **crate · Hop**, and the cursor. Say what you want: “start it when the player walks up,” then “a bit slower.” Your AI connects that moment in the game’s code.

![The chat box with the chip “crate · Hop” and the words “Start it when the player walks up”](media/motion-ask.webp)
- **Describe it.** Select something and ask in the box at the bottom: “make the boat rock gently.” Your AI writes the movement into the game’s code. It plays in **▶ Play** and in the game, but it isn’t on the timeline.

## In the game

Motions are saved in `placement.json` with the rest of your layout. When the game starts, the line that reads your layout plays them too. In **▶ Play**, you see them as they’ll be in the game.

Next: [Levels](levels.md).
