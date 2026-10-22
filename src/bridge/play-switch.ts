// ▶ Play and back in the same page (fast switch, 2026-10-22; a try of the editor: "every time I play and go back to edit it loads
// again — tedious"). CONTRACT.md §3.5.2, contract.ts `studio:core/play`.
//
// Before: Play and Edit each opened the game page again (`?studio=edit` or not). Going back to Edit took seconds: the
// game loads, the adapter is found, the list is made, every row's picture drawn again. Now the edit page itself becomes
// Play and comes back:
//
//   Play (go)   1. wait for the editor's first moments (its watch of what the game moves, the self-check: both move
//                  objects and put them back; a start in between would start from a moment of the watch)
//               2. keep where everything stands — the edit layout: each layer's listed poses (copies included) and,
//                  where the adapter can (three.js), the whole scene (watch(true), as the editor's own watch does)
//               3. the editor puts its tools away (core/edit off: the game's own camera and HUD, no handles, no input)
//               4. the draft's motions start (moveInPlay, as a Play page's loader would; see `live`)
//               5. the game goes on: frames, clock (core/time.ts `clock`: the time spent editing is not a frame step),
//                  sound (a pause's hold, when Edit held it); play-ask wakes (play/hello: ask, pause, move work as on a
//                  Play page)
//   Edit (back) 1. play-ask sleeps (Move, the chat, the field put away), the motions stop
//               2. the game is held as a pause holds it (frames, clock, sound, the mouse let go)
//               3. everything goes back to where Play found it: what the game moved while playing (the hero, an enemy,
//                  the camera) is not kept. "Put in layout" from a pause is the shell's: it sends those after this.
//               4. the editor is up again on the edit camera it had (core/edit on with the shell's view state)
//
// WHY "Play starts from the layout, Edit goes back to it" (the call made for this change, as recommended): Edit is where the
// layout is made, so what Edit shows must be the layout, never "wherever the game left things" (a person would save a
// moment of play as their layout without knowing). And Play from the same picture the person just arranged is what
// they asked to see. What does NOT go back: the game's own state that is not an object's pose — the score, a timer, an
// enemy's health, things the game made or took away while playing. For those, "Play from the start" (⌘K, Play's ▾)
// opens a new page as Play always did.
//
// Not here (the shell decides, main.ts canPlayHere): a page whose editor is not up (still loading, no adapter), and a
// draft with motions that wait for the game's cue (a page loaded for Edit never ran the loader's motions, so the
// game's playMotion() finds nothing): those open a new Play page as before.
import type { Pose, StudioAdapter } from '../contract.ts';
import type { Core } from '../core/index.ts';
import type { Editor } from './editor.ts';
import { moveInPlay } from './play-arrange.ts';
import type { PlayAskHandle } from './play-ask.ts';

export interface PlaySwitchDeps {
  win: Window & typeof globalThis;
  core: Core;
  editor: Editor;
  playAsk: PlayAskHandle;
}

export interface PlaySwitch {
  /** studio:core/play from the shell. Runs in the order sent (Play waits for the first moments; Edit waits for Play). */
  handle(m: { on: boolean; motion?: Record<string, unknown>; viewState?: unknown }): void;
  /** Is the page playing now (tests, through _play). */
  readonly playing: boolean;
}

export function createPlaySwitch(d: PlaySwitchDeps): PlaySwitch {
  const { win, core, editor, playAsk } = d;
  let playing = false;
  // Which Play this is: the motions of an earlier one stop (moveInPlay `live`).
  let run = 0;
  // Where Play found everything (go 2.), per layer.
  let kept: Array<{ raw: StudioAdapter; edits: StudioAdapter; poses: Array<[string, Pose]> }> = [];
  // The edit camera as it was at Play (the world's; the UI has none): exactly what Edit comes back to. The shell's kept
  // view state (core/view-state) can lag a glide's last step, and a camera a hair off reads as "it moved".
  let editView: unknown = undefined;
  let chain: Promise<void> = Promise.resolve();

  const listOf = (a: StudioAdapter) => {
    try {
      return a.list();
    } catch {
      return [];
    }
  };

  async function go(motion: Record<string, unknown> | undefined) {
    if (playing) return;
    await editor.settled();
    playing = true;
    const mine = ++run;
    const layers = editor.playLayers();
    try {
      editView = editor.layer() === 'world' ? editor.driven.view.state() : undefined;
    } catch {
      editView = undefined;
    }
    kept = layers.map((l) => ({ ...l, poses: listOf(l.edits).map((i) => [i.key, structuredClone(i.pose)] as [string, Pose]) }));
    for (const l of layers) {
      try {
        l.raw.watch?.(true);
      } catch {
        /* the listed poses above still go back */
      }
    }
    editor.handle({ type: 'studio:core/edit', on: false });
    // The world's motions, through the editor's copies layer (a copy that moves is the editor's object). Its first
    // listed layer is the world's when the game has one (editor.ts playLayers).
    const world = layers[0]?.edits;
    let moving: string[] = [];
    if (world && motion && typeof motion === 'object') {
      try {
        moving = moveInPlay(world, { motion }, win, () => run === mine && playing);
      } catch (e) {
        console.warn('[studio] Play: the motions could not start:', e);
      }
    }
    playAsk.wake(Promise.resolve(moving));
    // Held by a pause before (Edit holds the game with it, back below): its resume brings the sound back too.
    if (playAsk.hold?.paused) playAsk.hold.resume();
    else core.time.thaw();
  }

  function back(viewState: unknown) {
    if (!playing) return;
    playing = false;
    run++;
    playAsk.sleep();
    if (playAsk.hold) playAsk.hold.pause();
    else core.time.freeze();
    for (const l of kept) {
      try {
        l.raw.watch?.(false);
      } catch {
        /* the listed poses below */
      }
    }
    for (const l of kept) {
      for (const [key, pose] of l.poses) {
        try {
          l.edits.setPose(key, pose);
        } catch {
          /* the game took it away: the others go back */
        }
      }
    }
    kept = [];
    const view = editView !== undefined ? editView : viewState;
    editView = undefined;
    editor.handle({ type: 'studio:core/edit', on: true, viewState: view });
  }

  return {
    get playing() {
      return playing;
    },
    handle(m) {
      chain = chain.then(() => (m.on ? go(m.motion) : back(m.viewState))).catch((e) => console.warn('[studio] Play / Edit switch failed:', e));
    },
  };
}
