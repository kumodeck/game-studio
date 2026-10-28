// ▶ Play and back in the same page (fast switch, 2026-10-22; a try of the editor: "every time I play and go back to edit it loads
// again — tedious"). CONTRACT.md §3.5.3, contract.ts `studio:core/play`.
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
//   Paused      (pause-edit, 2026-10-28) the paused moment is this page's own editor, woken over the game where it
//   (moment)    stopped (momentHost: core/edit `moment` — the player's view, nothing put back, the game not let run).
//               Resume puts it away and the game goes on from there; Edit (back) ends the moment first.
//   Edit (back) 1. play-ask sleeps (the paused moment, the field put away), the motions stop
//               2. the game is held as a pause holds it (frames, clock, sound, the mouse let go)
//               3. everything goes back to where Play found it: what the game moved while playing (the hero, an enemy,
//                  the camera) is not kept. "Put in layout" from a pause is the shell's: it sends those after this.
//                  Where the adapter can (three.js, watch(false, true); studio-edit-restore, 2026-10-23: "after playing,
//                  Edit came back in the middle of the game"), the scene too: what the game added while playing (a
//                  bullet, an obstacle it spawned) is held out of it and what it took away (a coin) is back, so Edit
//                  shows the scene the person was editing. The next Play hands those back to the game first (go 2.):
//                  its code still holds them, and Play goes on from the game's own state (below).
//               4. the editor is up again on the edit camera it had (core/edit on with the shell's view state)
//
// WHY "Play starts from the layout, Edit goes back to it" (the call made for this change, as recommended): Edit is where the
// layout is made, so what Edit shows must be the layout, never "wherever the game left things" (a person would save a
// moment of play as their layout without knowing). And Play from the same picture the person just arranged is what
// they asked to see. What does NOT go back: the game's own state that is not an object's pose — the score, a timer, an
// enemy's health, things the game made or took away while playing. For those, "Play from the start" (⌘K, Play's ▾)
// opens a new page as Play always did.
//
// The motions (studio-no-reload, 2026-10-22: "when I go back to edit after playing, don't load"): the game's own copy of
// the loader (studio-placement.js) runs them from the draft, every `when` included (a click, an area, a cue, the game's
// playMotion()) — its play hook (loaderPlay below). Before, a page opened for Edit never started the loader's motions,
// so a draft with a clip that waits for something opened a new Play page (= loading) every time. What the loader does
// not move (a game without it, an older copy, a copy the editor made that the loader cannot find) moveInPlay moves, as
// it did. Back in Edit both stop before everything goes back.
//
// Not here (the shell decides, main.ts canPlayHere): a page whose editor is not up (still loading, no adapter), and a
// draft whose motions wait for something only the game's loader runs when this page's loader is an older copy without
// the hook (core/ready `motionHere` false): those open a new Play page as before.
import type { Pose, StudioAdapter } from '../contract.ts';
import type { Core } from '../core/index.ts';
import type { Editor } from './editor.ts';
import { moveInPlay } from './play-arrange.ts';
import type { PlayAskHandle } from './play-ask.ts';
import type { MomentHost } from './play-move.ts';

export interface PlaySwitchDeps {
  win: Window & typeof globalThis;
  core: Core;
  editor: Editor;
  playAsk: PlayAskHandle;
}

export interface PlaySwitch {
  /** studio:core/play from the shell. Runs in the order sent (Play waits for the first moments; Edit waits for Play). */
  handle(m: { on: boolean; motion?: Record<string, unknown>; motions?: unknown[]; viewState?: unknown }): void;
  /** Is the page playing now (tests, through _play). */
  readonly playing: boolean;
}

/** The loader's play hook (studio-placement.js `hook`): one per copy of the loader on the page. */
interface LoaderPlay {
  has(): boolean;
  start(d: { motion?: Record<string, unknown>; motions?: unknown[] }): string[];
  stop(): void;
}
/** The copies of the loader on the page that can play here: those that placed a world (the game's, not the editor's). */
export function loaderPlay(win: Window & typeof globalThis): LoaderPlay[] {
  const set = (win as unknown as Record<symbol, Set<LoaderPlay> | undefined>)[Symbol.for('game-studio.play')];
  return set ? [...set].filter((h) => {
    try {
      return h.has();
    } catch {
      return false;
    }
  }) : [];
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

  // The loader copies that run this Play's motions (stopped in back()).
  let loaders: LoaderPlay[] = [];

  async function go(motion: Record<string, unknown> | undefined, motions: unknown[] | undefined) {
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
        l.raw.watch?.(true, true);
      } catch {
        /* the listed poses above still go back */
      }
    }
    editor.handle({ type: 'studio:core/edit', on: false });
    let moving: string[] = [];
    if (motion && typeof motion === 'object') {
      // The game's loader first: it runs every `when`, on the objects the game itself holds. The keys it moves go into
      // its global set, which moveInPlay leaves alone.
      loaders = loaderPlay(win);
      for (const h of loaders) {
        try {
          moving.push(...h.start({ motion, motions }));
        } catch (e) {
          console.warn('[studio] Play: the loader could not start the motions:', e);
        }
      }
      // The rest through the editor's copies layer (a copy that moves is the editor's object). Its first listed layer
      // is the world's when the game has one (editor.ts playLayers).
      const world = layers[0]?.edits;
      if (world) {
        try {
          moving.push(...moveInPlay(world, { motion, motions }, win, () => run === mine && playing));
        } catch (e) {
          console.warn('[studio] Play: the motions could not start:', e);
        }
      }
    }
    playAsk.wake(Promise.resolve(moving));
    // Every ▶ Play at 1× (pause-edit decision 10: a slow speed kept would read as "the game is slow").
    playAsk.hold?.speed(1);
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
    // The loader's motions stop where they are; everything goes back just below.
    for (const h of loaders) {
      try {
        h.stop();
      } catch {
        /* the poses below */
      }
    }
    loaders = [];
    for (const l of kept) {
      try {
        l.raw.watch?.(false, true);
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

  // The paused moment (pause-edit): this page's own editor over the paused game (play-ask.ts pauseNow wakes it).
  let momentOn = false;
  const momentHost: MomentHost = {
    wake() {
      if (!playing) return false;
      editor.handle({ type: 'studio:core/edit', on: true, moment: true });
      momentOn = true;
      return true;
    },
    sleep() {
      if (!momentOn) return;
      momentOn = false;
      editor.handle({ type: 'studio:placement/select', key: null });
      editor.handle({ type: 'studio:core/edit', on: false });
    },
    driven: () => editor.driven,
  };
  playAsk.useHost(momentHost);

  return {
    get playing() {
      return playing;
    },
    handle(m) {
      chain = chain.then(() => (m.on ? go(m.motion, m.motions) : back(m.viewState))).catch((e) => console.warn('[studio] Play / Edit switch failed:', e));
    },
  };
}
