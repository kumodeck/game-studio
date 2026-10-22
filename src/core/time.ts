// Time control for the game page: hold back the game's frame callbacks while
// the editor is open.
//
// WHY requestAnimationFrame: nearly every web game engine (three.js
// setAnimationLoop, Pixi's Ticker, Phaser's loop, hand-written loops) drives
// its frames through window.requestAnimationFrame and looks the function up at
// call time. Wrapping it before any game code runs freezes all of them with
// one mechanism and needs no knowledge of the engine. Engines that tick from
// setTimeout/setInterval or audio clocks are not frozen here; adapters can add
// their own pause()/resume() for those.
//
// WHY "after the first frame": edit mode should show the scene as the game
// first draws it. Freezing before any frame shows an empty canvas; freezing
// later lets objects move away from their start positions. A game can call
// studio.ready() to pick the moment itself (e.g. after async loading).
//
// The studio's own drawing uses raf(), which always reaches the real browser
// function, so the editor keeps animating handles while the game is frozen.
import type { TimeControl } from '../contract.ts';
import { nativeCancelRaf, nativeRaf } from './native.ts';

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
    const start = () => win.setTimeout(() => {
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
    ready() {
      readyCalled = true;
      markFirst();
    },
  };
}
