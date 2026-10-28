// Time control for the game page: hold back the game's frame callbacks while
// the editor is open.
//
// WHY requestAnimationFrame: nearly every web game engine (three.js
// setAnimationLoop, Pixi's Ticker, Phaser's loop, hand-written loops) drives
// its frames through window.requestAnimationFrame and looks the function up at
// call time. Wrapping it before any game code runs freezes all of them with
// one mechanism and needs no knowledge of the engine. Engines that tick from
// setTimeout/setInterval are held with the game's clock instead (inside the
// editor's frame: play-clock.ts → play-timers.ts, polish-1022); an audio clock
// is not frozen here (a pause suspends the AudioContext, play-pause.ts).
//
// WHY "after the first frame": edit mode should show the scene as the game
// first draws it. Freezing before any frame shows an empty canvas; freezing
// later lets objects move away from their start positions. A game can call
// studio.ready() to pick the moment itself (e.g. after async loading).
//
// The studio's own drawing uses raf(), which always reaches the real browser
// function, so the editor keeps animating handles while the game is frozen.
import type { TimeControl } from '../contract.ts';
import { nativeCancelRaf, nativeNow, nativeRaf, nativeSetTimeout } from './native.ts';

type FrameCb = (t: number) => void;

export interface TimeOptions {
  /** Freeze automatically after the game's first frame (edit-mode page loads). */
  freezeAfterFirstFrame: boolean;
  /** Give up waiting for a first frame after this many ms (static or non-rAF games). */
  firstFrameTimeoutMs?: number;
  win?: Window & typeof globalThis;
  /**
   * ▶ Play inside the editor: the timestamp a game's frame callback gets, with the time spent paused taken out
   * (core/play-clock.ts, pause 2026-10-22). Absent = the browser's own timestamp, as before.
   */
  stamp?: (t: number) => number;
  /**
   * ▶ Play in the same page (fast switch, 2026-10-22; bridge/play-switch.ts): the edit page's game clock, stopped with
   * every freeze and going again with every thaw. WHY: an edit page holds the game for minutes; when it becomes Play,
   * the game's first frame must step one frame, not the whole time spent editing (a 3-minute step: the boat across
   * the cove, a timer run out). The first seconds' watch (editor.ts watchGame) thaws too, so the game's motion is still
   * seen there. Absent (a Play page, outside the editor) = freezes leave the clock alone, as before.
   */
  clock?: { stop(): void; go(): void };
}

export interface TimeControlImpl extends TimeControl {
  /** Mark the scene as ready (studio.ready()). */
  ready(): void;
  /** How many game frames ran so far (for the self-check and debugging). */
  readonly gameFrames: number;
  /** true when firstFrame() resolved because of the timeout, not a real frame. */
  readonly timedOut: boolean;
  /** true once the game called studio.ready(). */
  readonly readyCalled: boolean;
  /**
   * While frozen: run the game's waiting frame callbacks ONCE, with time stopped (studio-canvas-ui, 2026-10-24). The UI
   * the game draws in its canvas (codeUi) is drawn by the game's own frame, so a change on the card must make the game
   * draw one frame — without time going on (the edit page's clock is stopped while frozen: the frame sees no time pass,
   * as at the switch between Play and Edit). Callbacks the frame asks for again wait as before. false = nothing waited.
   */
  step(): boolean;
  /**
   * Speed (pause-edit, 2026-10-28; "1× · ½× · ¼×"): the game's frames run on 1 of every 1 / r of the browser's frames
   * (¼× = every 4th). With the clock at r × (play-clock.ts setRate) a game that moves by the time between frames and
   * one that moves a fixed step each frame both run at r: Studio cannot tell which kind a game is, so it slows both
   * ways at once (the picture steps at 15 frames a second at ¼×). 1 = every frame, as before.
   */
  setRate(r: number): void;
  readonly rate: number;
}

/**
 * The pure part (test/pause.test.ts): does the browser's frame at timestamp `t` run the game's frames? One answer per
 * frame (every callback of a frame gets the same timestamp, so a game with two loops never runs one of them only).
 * Credit adds up by the rate; a frame runs when there is a whole one.
 */
export function frameGate() {
  let rate = 1;
  let credit = 0;
  let lastT = NaN;
  let last = true;
  return {
    get rate() {
      return rate;
    },
    setRate(r: number) {
      rate = Number.isFinite(r) && r > 0 ? Math.min(1, r) : 1;
      // The next frame runs (its own share makes the whole one): a new speed shows at once, then every 1 / r.
      credit = 1 - rate;
      lastT = NaN;
    },
    runs(t: number): boolean {
      if (rate >= 1) return true;
      if (t === lastT) return last;
      lastT = t;
      credit += rate;
      last = credit >= 1 - 1e-9;
      if (last) credit -= 1;
      return last;
    },
  };
}

export function installTime(opts: TimeOptions): TimeControlImpl {
  const win = opts.win || window;
  // Game callbacks go to whatever rAF the page has now (it may already be an
  // engine helper's wrapper, which then also sees them). The studio's own
  // loop uses the browser's rAF captured first (native.ts) so no wrapper can
  // hold it.
  const realRaf = win.requestAnimationFrame.bind(win);
  const realCancel = win.cancelAnimationFrame.bind(win);
  const isMainWindow = typeof window !== 'undefined' && win === window;
  const ownRaf = isMainWindow ? nativeRaf : realRaf;
  const ownCancel = isMainWindow ? nativeCancelRaf : realCancel;

  let frozen = false;
  let nextId = 1;
  let gameFrames = 0;
  let timedOut = false;
  let readyCalled = false;
  // Game callbacks waiting for a frame: our id -> { cb, real id (when scheduled) }.
  const pending = new Map<number, { cb: FrameCb; real: number | null }>();
  // Speed (setRate): which browser frames run the game's.
  const gate = frameGate();

  let resolveFirst!: () => void;
  const first = new Promise<void>((r) => (resolveFirst = r));
  let firstDone = false;
  const markFirst = () => {
    if (firstDone) return;
    firstDone = true;
    if (opts.freezeAfterFirstFrame) freeze();
    resolveFirst();
  };

  function schedule(id: number) {
    const entry = pending.get(id);
    if (!entry) return;
    entry.real = realRaf((t) => {
      const e = pending.get(id);
      if (!e) return;
      if (frozen) {
        // Frozen between scheduling and the frame: keep it for thaw().
        e.real = null;
        return;
      }
      // Slowed: not this frame — it waits for the next one (still pending, so a freeze or a cancel finds it).
      if (!gate.runs(t)) {
        e.real = null;
        schedule(id);
        return;
      }
      pending.delete(id);
      gameFrames++;
      try {
        e.cb(opts.stamp ? opts.stamp(t) : t);
      } finally {
        // The first game frame has run once its callback returned (it drew).
        // A microtask lets other callbacks of the same frame finish first.
        if (gameFrames === 1 && !readyCalled) queueMicrotask(markFirst);
      }
    });
  }

  function requestAnimationFrame(cb: FrameCb): number {
    const id = nextId++;
    pending.set(id, { cb, real: null });
    if (!frozen) schedule(id);
    return id;
  }
  function cancelAnimationFrame(id: number): void {
    const e = pending.get(id);
    if (!e) return;
    if (e.real != null) realCancel(e.real);
    pending.delete(id);
  }

  // Replace the globals the game will use. Keep the function names so
  // engines that sniff `.name` or `toString()` are not confused.
  win.requestAnimationFrame = requestAnimationFrame as typeof win.requestAnimationFrame;
  win.cancelAnimationFrame = cancelAnimationFrame;

  function freeze() {
    if (frozen) return;
    frozen = true;
    opts.clock?.stop();
    for (const e of pending.values()) {
      if (e.real != null) {
        realCancel(e.real);
        e.real = null;
      }
    }
  }
  function thaw() {
    if (!frozen) return;
    frozen = false;
    opts.clock?.go();
    for (const id of [...pending.keys()]) schedule(id);
  }

  if (opts.firstFrameTimeoutMs) {
    const ms = opts.firstFrameTimeoutMs;
    // The browser's own timer (native.ts): the window's waits with the game's clock (play-timers.ts), and this is the
    // studio's own wait for a game that may never draw.
    const later = isMainWindow ? nativeSetTimeout : (fn: () => void, t: number) => win.setTimeout(fn, t);
    const start = () => later(() => {
      if (!firstDone) {
        timedOut = true;
        markFirst();
      }
    }, ms);
    if (win.document.readyState === 'complete') start();
    else win.addEventListener('load', start, { once: true });
  }

  return {
    get frozen() {
      return frozen;
    },
    get gameFrames() {
      return gameFrames;
    },
    get timedOut() {
      return timedOut;
    },
    get readyCalled() {
      return readyCalled;
    },
    freeze,
    thaw,
    raf: (cb) => ownRaf(cb),
    cancelRaf: (id) => ownCancel(id),
    firstFrame: () => first,
    step() {
      if (!frozen || !pending.size) return false;
      const now = isMainWindow ? nativeNow() : win.performance.now();
      const t = opts.stamp ? opts.stamp(now) : now;
      const due = [...pending.entries()];
      for (const [id] of due) pending.delete(id);
      for (const [, e] of due) {
        try {
          e.cb(t);
        } catch (err) {
          // The game's own error, reported by the page as usual; the editor's frame goes on.
          console.warn('[studio] the game failed drawing one frame:', err);
        }
      }
      return true;
    },
    ready() {
      readyCalled = true;
      markFirst();
    },
    setRate(r) {
      gate.setRate(r);
    },
    get rate() {
      return gate.rate;
    },
  };
}
