// How long the bridge waits for the game to have something to edit before it opens the editor or says "this game isn't
// connected to Game Studio yet" (bridge.ts, the look-again loop after the first frame). Pure: bridge.ts feeds it what
// it sees each look, test/connect-wait.test.ts runs it with made-up looks.
//
// WHY (decided 2026-11-05): the loop used to look 55 times 150 ms apart (~8 s of wall time) and then report "no
// adapter". On a slow or busy computer three.js had not drawn its first scene by then — the game's scripts were still
// being read, or it drew a few frames a second — and a newcomer saw "not connected" for a game that connects on its own
// (found by the screen tests on a machine under heavy load). Now:
//   1. the clock starts at the page's load event, not at the first look (loading the game's files is not the game
//      failing to connect);
//   2. "not connected" also needs the game to have RUN: FRAMES_TO_KNOW frames drawn with no scene for the editor — a
//      computer that draws 3 frames a second gets the time it needs, a fast one is told as quickly as before (~8 s);
//   3. while the engine itself is on the page (three.js loaded, a renderer made) nothing is reported before
//      SURE_MS — it is coming, only slowly;
//   4. after the report the bridge keeps looking (LATE_MS in all), so a game that connects late still opens the editor
//      (bridge.ts `late`); the shell says "Connecting…" while it waits long (main.ts status.connecting).
// A game that never draws (no requestAnimationFrame, or stopped on an error) is still reported, at SURE_MS.

/** What one look saw. Times are ms of the browser's own clock (native.ts), not the game's. */
export interface ConnectSeen {
  /** Since the wait began (the game's first frame, or the first-frame timeout). */
  ms: number;
  /** Since the page's load event; null = the page is still loading its files. */
  sinceLoad: number | null;
  /** Game frames run since the wait began (core time.gameFrames). */
  frames: number;
  /** An adapter answered (found() returned one). */
  adapter: boolean;
  /** …and it lists at least one object. */
  objects: boolean;
  /** The game called studio.ready(): it knows best, no more waiting. */
  ready: boolean;
  /** The engine is on the page but showed no scene yet (three.js: window.__THREE__ or a renderer made). */
  engine: boolean;
}

/** Quiet time after load before "not connected" may be said (the old ~8 s, now counted from load). */
export const QUIET_MS = 8000;
/** Frames the game must have drawn with nothing to edit before that (at 60 fps: under a second; at 3 fps: ~13 s). */
export const FRAMES_TO_KNOW = 40;
/** Said anyway by now: a game that never draws, or an engine that never shows a scene. */
export const SURE_MS = 30_000;
/** Looking goes on this long in all (after the report too, slower): a late game still connects. */
export const LATE_MS = 120_000;
/** The look-again pause before the report (as before) and after it (a late look: the page is not busy for it). */
export const LOOK_MS = 150;
export const LATE_LOOK_MS = 500;

/** The game ran long enough, after loading, to be sure nothing will come by itself. */
const ranLongEnough = (s: ConnectSeen) => s.sinceLoad !== null && s.sinceLoad >= QUIET_MS && s.frames >= FRAMES_TO_KNOW;

/**
 * One look's decision.
 * - 'go': open the editor now (with what the adapter lists — possibly nothing, as before, for a game that lists
 *   nothing after running a while).
 * - 'wait': look again in LOOK_MS (the game keeps running).
 * - 'report': no adapter, and long enough: say "not connected" (the self-check), then keep looking late.
 * - 'stop': looked for LATE_MS: freeze the game and stop looking.
 */
export function connectStep(s: ConnectSeen): 'go' | 'wait' | 'report' | 'stop' {
  if (s.ready || s.objects) return 'go';
  if (s.adapter) return ranLongEnough(s) || s.ms >= SURE_MS ? 'go' : 'wait';
  if (s.ms >= LATE_MS) return 'stop';
  if (s.ms >= SURE_MS) return 'report';
  if (!s.engine && ranLongEnough(s)) return 'report';
  return 'wait';
}

/**
 * No world adapter but a UI: an HTML-only game opens with its UI alone (UI stage 1). Only after load, and not while an
 * engine is on the page — a three.js game with an HTML HUD would otherwise open as "UI only" on a slow computer and
 * never get its world (the old rule was "after ~0.9 s", which a slow machine reached before three.js drew).
 */
export function uiOnlyMayOpen(s: ConnectSeen): boolean {
  if (s.adapter) return false;
  if (s.ms >= SURE_MS) return true;
  return s.ms >= 900 && s.sinceLoad !== null && !s.engine;
}

/** Why the bridge is waiting (studio:core/wait reason). */
export function waitReason(s: ConnectSeen): 'no-adapter' | 'no-objects' | 'no-frame' {
  if (s.adapter) return 'no-objects';
  return s.frames > 0 ? 'no-adapter' : 'no-frame';
}
