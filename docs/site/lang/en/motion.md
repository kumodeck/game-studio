---
title: Motion
nav: Motion
order: 4
written-for: 0.1.23
description: Make things move with the timeline, choose when a motion starts and stops, and reuse motions from the Library.
---

# Motion

Make a boat sail, a door open, a coin spin. You set where a thing is at a few moments in time, and the editor fills in the movement between them. Motion works in 3D games.

## Start from the tool strip

The quickest way: select something in the game, then press **Motion** at the right end of the tool strip under it (or press <kbd>A</kbd>).

![The Motion button in the tool strip, with its menu: New motion and From the Library](media/motion-strip.webp)

- **New motion**: choose **Back and forth**, **Round**, **Once** or **Spin**. It moves right away.
- **From the Library**: choose a motion you already made.

The timeline opens on it and asks **When does it move?** (see [When it starts](#when-it-starts)). Once something has a motion, the button shows a small dot, and pressing it opens that motion on the timeline.

## The timeline

Select something, then press **◆ Timeline** on its card (or find **Timeline** in <kbd>⌘</kbd><kbd>K</kbd>). The timeline opens at the bottom of the game (above the card on a phone).

![The timeline under the game, with the boat’s keys and its path](media/timeline.webp)

Its top is one line, with what you use every time: **▶** (or <kbd>Space</kbd>), the time and the motion’s **length**, **● Auto key**, the **motion** menu, **Starts**, then **⋯**, **✦ Ask AI** and **⌄** to fold it.

- The **ruler** is time. Drag on it to see that moment. <kbd>←</kbd> <kbd>→</kbd> move 0.1 s (<kbd>Shift</kbd> for 1 s).
- Click the length after the time to type a new one, in seconds.
- The rows are the **selected object** (with several selected, each of them), and the objects you [link](#linking-several-things-in-one-motion) to it. Open a row to see **Position**, **Angle** and **Size** on their own rows.
- **⋯** has the rest: **Repeat**, **Stops**, other ways to start, **Try**, and **Show every motion in the scene** (every moving object’s row; **Show only the selected one** goes back).

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

## Linking: several things in one motion

The timeline shows the selected object only. When a motion should move other things too, like a short cutscene (the crate hops, the buoy dips, the barrel rolls off the pier), link them to it.

![+ Link an object: the scene’s objects in a list, or click one in the game](media/motion-link.webp)

1. Under the rows, press **+ Link an object**.
2. Choose one from the list (type to find it by name), or click it in the game while the list is open. The selected object stays selected.
3. It gets a row of its own on the same time line. Move it with **Auto key** on to set its keys. The top says **Linked · 2**.

![The crate with the buoy and the barrel linked: one motion, one time line](media/motion-scene.webp)

**Starts** and **Stops** are shared: all of them start together. Selecting a linked object shows the same rows, with it on top. **×** on a linked row unlinks it (its own motions stay). Unlink the last one and the motion is the selected object’s alone again.

You can also start from **New: Scene — several objects** in the motion menu, or drop a linked motion from the Library onto an object to link it.

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
