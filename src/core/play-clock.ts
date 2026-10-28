// The game's clock while playing inside the editor, so a pause takes no time (pause, 2026-10-22).
//
// WHY: freezing the frames (time.ts) is not enough. Engines measure the time between frames from performance.now()
// (three.js Timer / Clock) or from the timestamp requestAnimationFrame hands them (Pixi's Ticker, Phaser, a hand-made
// `t / 600`). After a one-minute pause the first frame would see a 60 s step: the boat jumps across the cove, a timer
// runs out, a physics step explodes. Here the time spent paused is taken out of both, so the game's next frame sees
// one ordinary frame's step.
//
// Only in ▶ Play inside the editor (bridge.ts installs it before any game code, so the game's first look at
// performance.now already goes through it).
//
// The game's timers and Date.now() stop with it too (polish-1022, 2026-10-22; play-timers.ts). Until then Date.now was
// left alone as wall time ("saves, last played") and setTimeout / setInterval were not held: a countdown or an enemy
// spawner on a timer ran on through a pause and through Edit. Date.now now leaves out the stopped time as well (a save's
// time is off by the minutes paused, which no game we know minds; `new Date()` stays the wall clock). CONTRACT.md §3.5.1
// lists what a pause still does not stop.

import { nativeClearTimeout, nativeDateNow, nativeSetTimeout } from './native.ts';
import { installTimerHold, type TimerHold } from './play-timers.ts';

export interface PlayClock {
  /** Stop the clock: performance.now() stays where it is until go(). */
  stop(): void;
  go(): void;
  readonly stopped: boolean;
  /**
   * Speed (pause-edit, 2026-10-28; "1× · ½× · ¼×" in the top bar): the game's time runs `r` times as fast as the real
   * one (½ = half as fast). The timers and Date.now follow (they read this clock). 1 = as before.
   */
  setRate(r: number): void;
  readonly rate: number;
  /** "Next frame" while stopped (pause-edit): the stopped clock moves on by `ms` (1000 / 60), its timers too. */
  advance(ms: number): void;
  /** A real timestamp (rAF, performance.now's timeline) as the game sees it: the paused time taken out. */
  at(t: number): number;
  /** The browser's own performance.now(), for the studio's own timers (a line's fade must not wait for the game). */
  realNow(): number;
  /** ms taken out so far (tests). */
  readonly skipped: number;
  /** The game's timers (null: the page would not let them be replaced, they run as before). */
  readonly timers: TimerHold | null;
}

/**
 * The pure part (test/pause.test.ts): real time in, game time out.
 *
 * Game time = where it was at the last change (`g0`) + the real time since then (`r0`) × the speed. Every change —
 * stop, go, a new speed, a step — starts a new piece from where the game's time is now, so the game's time never
 * jumps: a pause takes nothing out of it, ¼× makes each real second a quarter of one, and "Next frame" moves the
 * stopped time on by one frame. (Before pause-edit, 2026-10-28, it was `t − skipped` with no speed; the same numbers
 * at 1×.)
 */
export function makeClock(real: () => number) {
  const start = real();
  let g0 = start;
  let r0 = start;
  let rate = 1;
  // While stopped: the game's time it stopped at (moved on by advance()); null = going.
  let held: number | null = null;
  const going = (t: number) => g0 + (t - r0) * rate;
  return {
    stop() {
      if (held === null) held = going(real());
    },
    go() {
      if (held === null) return;
      g0 = held;
      r0 = real();
      held = null;
    },
    get stopped() {
      return held !== null;
    },
    /** Real ms minus game ms: how much of the real time the game has not seen (pauses, slow time). */
    get skipped() {
      const now = real();
      return now - (held !== null ? Math.min(going(now), held) : going(now));
    },
    get rate() {
      return rate;
    },
    setRate(r: number) {
      const next = Number.isFinite(r) && r > 0 ? r : 1;
      if (next === rate) return;
      // A new piece from now (stopped: from when it goes again, go() above).
      if (held === null) {
        g0 = going(real());
        r0 = real();
      }
      rate = next;
    },
    advance(ms: number) {
      if (held === null || !(ms > 0)) return;
      held += ms;
    },
    /** While stopped every time reads as the moment it stopped; never earlier than that. */
    at(t: number) {
      if (held !== null) return Math.min(going(t), held);
      return going(t);
    },
  };
}

export function installPlayClock(win: Window & typeof globalThis): PlayClock {
  const perf = win.performance;
  const realNow = perf.now.bind(perf);
  const c = makeClock(realNow);
  try {
    // An own property on the instance: Performance.prototype.now stays the browser's (other frames, workers).
    Object.defineProperty(perf, 'now', { value: function now() { return c.at(realNow()); }, configurable: true, writable: true });
  } catch {
    /* a locked-down page: the rAF timestamps are still shifted (time.ts) */
  }
  // The browser's own timers: captured by core/native.ts before anything wrapped them (the edit script's first import);
  // another window (tests) uses its own.
  const own = typeof window !== 'undefined' && win === window;
  const timers = installTimerHold(win, {
    setTimeout: own ? nativeSetTimeout : win.setTimeout.bind(win),
    clearTimeout: own ? nativeClearTimeout : win.clearTimeout.bind(win),
    now: realNow,
    dateNow: own ? nativeDateNow : win.Date.now.bind(win.Date),
  }, () => c.at(realNow()));
  return {
    // The timers stop and go with the clock: in a pause (play-pause.ts) and, in the edit page, with every hold of the
    // game (time.ts `clock`), so Edit holds a timer-driven game as it holds a frame-driven one.
    stop() {
      c.stop();
      timers?.stop();
    },
    go() {
      c.go();
      timers?.go();
    },
    setRate(r: number) {
      c.setRate(r);
      timers?.setRate(c.rate);
    },
    get rate() {
      return c.rate;
    },
    advance(ms: number) {
      if (!c.stopped) return;
      c.advance(ms);
      timers?.advance(ms);
    },
    timers,
    get stopped() {
      return c.stopped;
    },
    get skipped() {
      return c.skipped;
    },
    at: c.at,
    realNow,
  };
}
