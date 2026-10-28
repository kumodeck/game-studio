// The game's timers and wall clock, held with the game's clock (polish-1022, 2026-10-22; play-clock.ts).
//
// WHY: a pause (bridge/play-pause.ts) and Edit hold the game's frames (time.ts) and take the held time out of
// performance.now() (play-clock.ts). A game that steps from a timer — `setInterval(spawnEnemy, 2000)`, a countdown with
// `setTimeout(tick, 1000)`, a `Date.now() - startedAt` clock — still ran on: enemies piled up behind the chat, the
// countdown ran out while the person was moving a tree. Here every timer the game sets waits while the clock is stopped
// and goes on with the time it had left (a 2 s interval stopped 0.5 s after its last tick fires 1.5 s after Resume),
// and Date.now() leaves out the stopped time like performance.now() does.
//
// The studio's own timers in the game page never come here: they use core/native.ts (nativeSetTimeout, nativeDateNow),
// captured before this wraps the window's. Otherwise a paused game would also pause the line's fade, the long press,
// the self-check's waits — and Edit, which holds the game, would hold the editor.
//
// Not held (CONTRACT.md §3.5.1): `new Date()` (an object, its time is wall time: saves, "today"), promises and
// queueMicrotask (they run when what they wait for is done), requestIdleCallback, a Worker's own timers, an audio
// clock (the pause suspends the AudioContext itself).

/** What the hold needs from the browser: its own setTimeout / clearTimeout and clock (injected for test/pause.test.ts). */
export interface TimerNatives {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** Real ms (performance.now's timeline is fine: only differences are used). */
  now(): number;
}

type Handler = ((...a: unknown[]) => void) | string;

interface Timer {
  run: () => void;
  /** null = setTimeout (once); a number = setInterval's period in ms. */
  every: number | null;
  /** When it is due, in real ms (while going). */
  due: number;
  /** While stopped: ms it still had to wait. */
  left: number;
  real: unknown;
}

export interface TimerHold {
  setTimeout(handler: Handler, ms?: number, ...args: unknown[]): number;
  setInterval(handler: Handler, ms?: number, ...args: unknown[]): number;
  /** clearTimeout and clearInterval are the same in browsers (one id pool), so one function for both. */
  clear(id: unknown): void;
  stop(): void;
  go(): void;
  readonly stopped: boolean;
  /**
   * Speed (pause-edit, 2026-10-28; play-clock.ts setRate): each timer waits 1 / r as long in real time (a 2 s interval
   * at ¼× fires every 8 real seconds), from the time it had left.
   */
  setRate(r: number): void;
  /**
   * "Next frame" while stopped (pause-edit): `ms` of the game's time go by — what falls due in it runs, in time order
   * (an interval as often as it fits), and the rest wait that much less.
   */
  advance(ms: number): void;
  /** Timers set and not done (tests). */
  readonly count: number;
}

/**
 * The pure part: the game's timers over the browser's own. Ids are the hold's own (a held timer has no browser id, and
 * the game keeps the id it got across a pause). `compile` turns a string handler (`setTimeout("tick()", 100)`, old
 * code) into a function; absent = string handlers are ignored, as a page with a strict CSP does.
 */
export function makeTimerHold(n: TimerNatives, compile?: (code: string) => () => void): TimerHold {
  const timers = new Map<number, Timer>();
  let nextId = 1;
  let stopped = false;
  // The speed (setRate): the timers count the game's time; a real wait is the game's wait / rate.
  let rate = 1;

  const arm = (id: number, t: Timer, wait: number) => {
    t.due = n.now() + wait / rate;
    t.real = n.setTimeout(() => fire(id), wait / rate);
  };
  function fire(id: number) {
    const t = timers.get(id);
    if (!t || stopped) return;
    t.real = null;
    if (t.every === null) timers.delete(id);
    else {
      // The next tick from when this one was due, not from now: no drift. Far behind (a background tab the browser
      // throttled): from now, so it does not fire a burst to catch up (the browser's own setInterval never does).
      // In the game's ms (× rate): `due` is real.
      const wait = (t.due - n.now()) * rate + t.every;
      arm(id, t, wait >= -t.every ? Math.max(0, wait) : t.every);
    }
    t.run();
  }
  function add(handler: Handler, ms: unknown, args: unknown[], every: boolean): number {
    const fn = typeof handler === 'function' ? handler : compile && typeof handler === 'string' ? compile(handler) : null;
    const id = nextId++;
    if (!fn) return id;
    // As the browser reads it: not a number or below 0 = 0; an interval of 0 still waits a little (Chrome: 4 ms after
    // a few; here 1, so a 0 interval cannot freeze the page in a loop of its own).
    const wait = Math.max(0, Number(ms) || 0);
    const t: Timer = { run: () => fn(...args), every: every ? Math.max(1, wait) : null, due: 0, left: wait, real: null };
    timers.set(id, t);
    if (stopped) t.left = wait;
    else arm(id, t, wait);
    return id;
  }
  /** Each going timer's game ms left, its browser timer cleared (stop, a new speed). */
  const holdAll = () => {
    const now = n.now();
    for (const t of timers.values()) {
      if (t.real != null) n.clearTimeout(t.real);
      t.real = null;
      t.left = Math.max(0, (t.due - now) * rate);
    }
  };

  return {
    setTimeout: (h, ms, ...args) => add(h, ms, args, false),
    setInterval: (h, ms, ...args) => add(h, ms, args, true),
    clear(id) {
      const t = timers.get(id as number);
      if (!t) return;
      if (t.real != null) n.clearTimeout(t.real);
      timers.delete(id as number);
    },
    stop() {
      if (stopped) return;
      holdAll();
      stopped = true;
    },
    go() {
      if (!stopped) return;
      stopped = false;
      // In the order they were set (a Map keeps it): two timers with the same time left fire in the game's order.
      for (const [id, t] of timers) arm(id, t, t.left);
    },
    setRate(r) {
      const next = Number.isFinite(r) && r > 0 ? r : 1;
      if (next === rate) return;
      if (stopped) {
        rate = next;
        return;
      }
      holdAll();
      rate = next;
      for (const [id, t] of timers) arm(id, t, t.left);
    },
    advance(ms) {
      if (!stopped || !(ms > 0)) return;
      // Due within the step, soonest first; an interval that fires goes back in with its next wait. A timer set by
      // one that fires waits from the end of the step (its whole wait is still ahead).
      let left = ms;
      for (;;) {
        let id = -1;
        let t: Timer | null = null;
        for (const [k, x] of timers) if (x.left <= left && (!t || x.left < t.left)) (id = k), (t = x);
        if (!t) break;
        const spent = t.left;
        left -= spent;
        for (const x of timers.values()) x.left = Math.max(0, x.left - spent);
        if (t.every === null) timers.delete(id);
        else t.left = t.every;
        try {
          t.run();
        } catch (e) {
          // The game's own error: reported by the page as a timer's would be; the step goes on.
          console.warn('[studio] a game timer failed during a step:', e);
        }
      }
      for (const x of timers.values()) x.left = Math.max(0, x.left - left);
    },
    get stopped() {
      return stopped;
    },
    get count() {
      return timers.size;
    },
  };
}

/**
 * Put the hold on the page: the window's setTimeout / setInterval / clearTimeout / clearInterval and Date.now become
 * the game's. `gameNow` is the game's performance.now (play-clock.ts), so Date.now leaves out exactly the time it does.
 * Returns null when the page will not let the globals be replaced (nothing is held then, as before).
 */
export function installTimerHold(win: Window & typeof globalThis, real: { setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void; now: () => number; dateNow: () => number },
  gameNow: () => number): TimerHold | null {
  const hold = makeTimerHold(
    { setTimeout: (fn, ms) => real.setTimeout(fn, ms), clearTimeout: (id) => real.clearTimeout(id as number), now: real.now },
    (code) => {
      try {
        return new win.Function(code) as () => void;
      } catch {
        return () => {}; // a CSP without unsafe-eval: the browser would refuse it too
      }
    },
  );
  // Date.now = the wall clock minus the time the game's clock has been stopped (real perf − game perf), in whole ms.
  // WHY whole, frozen and never back (first run of the screen test, 2026-10-22): the two clocks are read a moment
  // apart, so the plain difference wobbled by a fraction of a ms while paused, and was not the integer games expect.
  let frozen: number | null = null;
  let last = -Infinity;
  const dateNow = () => (frozen !== null ? frozen : (last = Math.max(last, Math.floor(real.dateNow() - (real.now() - gameNow())))));
  const g = win as unknown as Record<string, unknown>;
  // Named like the browser's: engines and polyfills that check `setTimeout.name` or call through `window.setTimeout`
  // see the usual shape.
  const named = <F extends (...a: never[]) => unknown>(name: string, f: F): F => (Object.defineProperty(f, 'name', { value: name }), f);
  try {
    g.setTimeout = named('setTimeout', (h: Handler, ms?: number, ...a: unknown[]) => hold.setTimeout(h, ms, ...a));
    g.setInterval = named('setInterval', (h: Handler, ms?: number, ...a: unknown[]) => hold.setInterval(h, ms, ...a));
    g.clearTimeout = named('clearTimeout', (id: unknown) => hold.clear(id));
    g.clearInterval = named('clearInterval', (id: unknown) => hold.clear(id));
    win.Date.now = named('now', dateNow);
  } catch {
    return null;
  }
  // Stopped: one value, taken when it stopped. Going: whole ms like the browser's, never going back.
  const { stop, go, advance } = hold;
  hold.stop = () => {
    if (!hold.stopped) frozen = dateNow();
    stop();
  };
  // "Next frame" (pause-edit): the clock moved on first (play-clock.ts advance), so Date.now reads the step too —
  // the stopped value moves on by it, never back.
  hold.advance = (ms) => {
    if (hold.stopped && frozen !== null) frozen = Math.max(frozen, Math.floor(real.dateNow() - (real.now() - gameNow())));
    advance(ms);
  };
  hold.go = () => {
    go();
    frozen = null;
  };
  return hold;
}
