// Checkpoints in the game page (pause-edit stage 3, 2026-10-28; CONTRACT.md §1.14 "Checkpoints").
//
// The request (2026-10-28): "pause in the middle of a scene and give instructions, by hand or to the AI" —
// and the plan's need 5: to try a fix of the boss, a person played 40 s to get back to the boss every time. Now ⚑ in the
// paused moment's top bar keeps the moment, and ▶ Play ⌄ "⚑ Play from Before the boss" opens the game there. The editor
// cannot know what a moment of a game is (the score, each enemy, the random seed live in the game's JS), so the AI
// writes save() / load() once in the game's code (the loader's codeMoment, SKILL.md "Checkpoints") and this file is
// the hands in the game page:
//   - keep: `studio:moment/save` (only while paused) → save() → checked as JSON data (a cycle, a function, a BigInt, a
//     moment of more than CHECKPOINT_MAX_CHARS is said, never kept half) → `studio:moment/saved`;
//   - open: a page with ?studioMoment=1 (the editor's ▶ Play from a checkpoint) holds the game's frames from the very
//     start (core time freeze(), the same hold Edit uses — time.ts itself is not changed), waits for the moment
//     (`studio:moment/load`, the editor's answer to play/hello) AND for the game to ask for its first frame (it has
//     built its world and called codeMoment by then), then load(m), then lets the frames go: the game's FIRST picture
//     is the checkpoint's (decision 14: "before the game draws its first frame"). The game's clock stops from that
//     first ask until load ran, so the wait is not a long first frame.
// What does not open, and what is said (decision 14 / the brief's 4): load() throws (or its promise fails) → `threw`
// with the error and the console's lines while it ran; the page stays held (half a moment is not a game) and the
// editor opens the game again from the start, with one line "The game changed, so this checkpoint can't open" and ✦.
// No load() any more (the AI took it out, a game rewritten) → `none`: nothing was loaded, the page simply plays from
// its start. Placed things are not in a checkpoint: the scene's layout comes from placement.json as on every Play page
// (the loader before the first frame, play-arrange after it), so a gate moved since the checkpoint stands where the
// scene has it now.
import type { BridgeToShell, PlayLog, ShellToBridge } from '../contract.ts';
import { CHECKPOINT_MAX_CHARS, LOCAL_PATHS, isStudioMessage } from '../contract.ts';
import { nativeClearTimeout, nativeNow, nativeSetTimeout } from '../core/native.ts';

type Win = Window & typeof globalThis;

/** The game's save() / load() as the loader keeps them (codeMoment), or null when either is missing. */
export function momentHooks(win: Win): { save: () => unknown; load: (m: unknown) => unknown } | null {
  const g = (win as unknown as Record<symbol, unknown>)[Symbol.for('game-studio.moment')] as { save?: unknown; load?: unknown } | undefined;
  if (!g || typeof g.save !== 'function' || typeof g.load !== 'function') return null;
  return { save: g.save as () => unknown, load: g.load as (m: unknown) => unknown };
}

/** "Error: x is undefined" → "x is undefined", one line. */
const why = (err: unknown) => String((err as Error)?.message ?? err).split('\n')[0]!.slice(0, 200);

/**
 * What save() returned, as JSON data (pure; test/checkpoint.test.ts). The file keeps JSON, so the moment is checked
 * here, where the AI's line can say what to fix: a function or undefined at the top (nothing to keep), a cycle or a
 * BigInt (JSON.stringify throws), more than `max` characters. Inside, JSON's own rules hold (a function in an object is
 * left out, a Map becomes {}): SKILL.md "Checkpoints" asks for plain data, and load() reads what the file has.
 */
export function momentData(v: unknown, max = CHECKPOINT_MAX_CHARS): { ok: true; moment: unknown; chars: number } | { ok: false; error: string } {
  let s: string | undefined;
  try {
    s = JSON.stringify(v);
  } catch (err) {
    return { ok: false, error: `save() returned something that is not plain data (${why(err)})` };
  }
  if (s === undefined) return { ok: false, error: `save() returned ${typeof v === 'function' ? 'a function' : 'nothing'}: return this moment as plain data` };
  if (s.length > max) return { ok: false, error: `save() returned ${s.length} characters of data (at most ${max}): keep what the next frame needs, not the assets` };
  return { ok: true, moment: JSON.parse(s), chars: s.length };
}

/** save() now, checked (the answer of `moment/save`). */
export function saveMoment(win: Win): { ok: true; moment: unknown } | { ok: false; error: string; none?: boolean } {
  const h = momentHooks(win);
  if (!h) return { ok: false, none: true, error: 'the game has no codeMoment() save() and load() (SKILL.md "Checkpoints")' };
  let v: unknown;
  try {
    v = h.save();
  } catch (err) {
    return { ok: false, error: `save() failed (${why(err)})` };
  }
  const d = momentData(v);
  return d.ok ? { ok: true, moment: d.moment } : d;
}

export interface MomentSaveOptions {
  win: Win;
  parentOrigin: string;
  /** A paused moment now (play-ask.ts): a checkpoint is kept only from one. */
  paused(): boolean;
}

/** Answer the editor page's `moment/save` (⚑) in this game page. */
export function startMomentSave(o: MomentSaveOptions): void {
  const { win } = o;
  win.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== win.parent || ev.origin !== o.parentOrigin || !isStudioMessage(ev.data)) return;
    const m = ev.data as ShellToBridge;
    if (m.type !== 'studio:moment/save') return;
    const r: BridgeToShell = !o.paused()
      ? { type: 'studio:moment/saved', n: m.n, ok: false, error: 'the game is not paused' }
      : { type: 'studio:moment/saved', n: m.n, ...saveMoment(win) };
    try {
      win.parent.postMessage(r, o.parentOrigin);
    } catch {
      /* parent gone */
    }
  });
}

/** Is this page opened from a checkpoint? (?studioMoment=1, the editor's ▶ Play from a checkpoint) */
export function fromCheckpoint(href: string): boolean {
  try {
    return new URL(href).searchParams.get(LOCAL_PATHS.momentParam) === '1';
  } catch {
    return false;
  }
}

/**
 * When to load (pure; test/checkpoint.test.ts), checked every TICK_MS from the page's start:
 *   'wait'  — not yet;
 *   'load'  — the moment is here and the game asked for its first frame at least SETTLE_MS ago (a codeMoment written
 *             after the loop's start in the same script is in by then), or it never asks (a game with no frames of its
 *             own) and NO_FRAME_MS passed since the page loaded;
 *   'late'  — no moment from the editor after MOMENT_WAIT_MS (an editor page that went away): play from the start.
 */
export function holdStep(s: { now: number; start: number; moment: boolean; askedAt: number | null; loadedAt: number | null }): 'wait' | 'load' | 'late' {
  if (!s.moment) return s.now - s.start >= MOMENT_WAIT_MS ? 'late' : 'wait';
  if (s.askedAt !== null) return s.now - s.askedAt >= SETTLE_MS ? 'load' : 'wait';
  return s.loadedAt !== null && s.now - s.loadedAt >= NO_FRAME_MS ? 'load' : 'wait';
}
export const TICK_MS = 20;
export const SETTLE_MS = 40;
export const NO_FRAME_MS = 3000;
export const MOMENT_WAIT_MS = 8000;
/** A load(m) that returns a promise (a game that loads a level's files first) gets this long. */
export const LOAD_PROMISE_MS = 10_000;

export interface CheckpointHoldOptions {
  win: Win;
  parentOrigin: string;
  /** core time (time.ts): held from the start, let go after load(m). */
  time: { freeze(): void; thaw(): void };
  /** The game's clock (play-clock.ts): stopped from the game's first frame ask until load(m) ran. */
  clock: { stop(): void; go(): void } | null;
  /**
   * Right before load(m) (play-ask.ts startFrom): the top bar's clock goes on from the checkpoint's `seconds`, and the
   * kinds of a later pause count anything not in `scene` as made by the game.
   */
  before(seconds: number, scene: string[]): void;
}

export interface CheckpointHold {
  /** Holding the game for a checkpoint now (play-ask.ts: no pause until it opened). */
  readonly holding: boolean;
}

/** A page opened from a checkpoint: hold, load(m) before the first frame, let go (see the top of this file). */
export function startCheckpointHold(o: CheckpointHoldOptions): CheckpointHold {
  const { win } = o;
  const post = (msg: BridgeToShell) => {
    try {
      win.parent.postMessage(msg, o.parentOrigin);
    } catch {
      /* parent gone */
    }
  };
  let holding = true;
  let got: Extract<ShellToBridge, { type: 'studio:moment/load' }> | null = null;
  let askedAt: number | null = null;
  let loadedAt: number | null = null;
  const start = nativeNow();
  o.time.freeze();

  // The game's first ask for a frame: its world is built and its loop starts (three's setAnimationLoop, Pixi's Ticker,
  // a hand-made loop all go through requestAnimationFrame, looked up at call time). Wrapped only on this page, only
  // until load ran; the call goes on to core time's own wrapper, which keeps it until thaw().
  const raf = win.requestAnimationFrame;
  const asking = function requestAnimationFrame(this: unknown, cb: FrameRequestCallback): number {
    if (askedAt === null) {
      askedAt = nativeNow();
      // From here the game's time waits for load: its first frame steps one frame, not the wait.
      o.clock?.stop();
    }
    return raf.call(win, cb);
  };
  win.requestAnimationFrame = asking as typeof win.requestAnimationFrame;
  if (win.document.readyState === 'complete') loadedAt = nativeNow();
  else win.addEventListener('load', () => (loadedAt = nativeNow()), { once: true });

  win.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== win.parent || ev.origin !== o.parentOrigin || !isStudioMessage(ev.data)) return;
    const m = ev.data as ShellToBridge;
    if (m.type === 'studio:moment/load' && holding && !got) got = m;
  });

  let timer = 0;
  const done = (thaw: boolean) => {
    holding = false;
    nativeClearTimeout(timer);
    if (win.requestAnimationFrame === asking) win.requestAnimationFrame = raf;
    if (!thaw) return;
    o.clock?.go();
    o.time.thaw();
  };

  async function open() {
    const h = momentHooks(win);
    if (!h) {
      // Nothing loaded: the game as its code starts it, which is "Play from the start" already.
      done(true);
      post({ type: 'studio:moment/loaded', ok: false, why: 'none' });
      return;
    }
    const m = got!;
    const scene = Array.isArray(m.scene) ? m.scene.filter((k): k is string => typeof k === 'string') : [];
    o.before(typeof m.time === 'number' && Number.isFinite(m.time) && m.time >= 0 ? m.time : 0, scene);
    // The console while load runs: what goes with ✦ when it fails (the game's own warnings say what it missed).
    const logs: PlayLog[] = [];
    const con = win.console as unknown as Record<'error' | 'warn', (...a: unknown[]) => void>;
    const keep = { error: con.error, warn: con.warn };
    for (const level of ['error', 'warn'] as const) {
      con[level] = function (...a: unknown[]) {
        if (logs.length < 20) logs.push({ level, text: a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : safeJson(x))).join(' ').slice(0, 300), ago: 0 });
        return keep[level].apply(this, a);
      };
    }
    let error: string | null = null;
    try {
      const r = h.load(m.moment) as { then?: unknown } | undefined;
      if (r && typeof r.then === 'function') {
        let late = 0;
        try {
          await Promise.race([r, new Promise((_, no) => (late = nativeSetTimeout(() => no(new Error(`load(m) did not finish in ${LOAD_PROMISE_MS / 1000} s`)), LOAD_PROMISE_MS)))]);
        } finally {
          nativeClearTimeout(late);
        }
      }
    } catch (err) {
      error = why(err);
      const stack = String((err as Error)?.stack ?? '').split('\n').slice(1, 4).map((l) => l.trim()).filter(Boolean);
      logs.push({ level: 'error', text: `load(m) failed: ${error}${stack.length ? ` (${stack.join(' ← ')})` : ''}`.slice(0, 300), ago: 0 });
    } finally {
      con.error = keep.error;
      con.warn = keep.warn;
    }
    if (error !== null) {
      // Held: half a moment is not a game. The editor opens the game again from its start.
      done(false);
      post({ type: 'studio:moment/loaded', ok: false, why: 'threw', error, logs });
      return;
    }
    done(true);
    post({ type: 'studio:moment/loaded', ok: true });
  }

  const tick = () => {
    if (!holding) return;
    const s = holdStep({ now: nativeNow(), start, moment: !!got, askedAt, loadedAt });
    if (s === 'wait') {
      timer = nativeSetTimeout(tick, TICK_MS);
      return;
    }
    if (s === 'late') {
      done(true);
      post({ type: 'studio:moment/loaded', ok: false, why: 'late' });
      return;
    }
    void open();
  };
  timer = nativeSetTimeout(tick, TICK_MS);

  return {
    get holding() {
      return holding;
    },
  };
}

function safeJson(x: unknown): string {
  try {
    return JSON.stringify(x) ?? String(x);
  } catch {
    return String(x);
  }
}
