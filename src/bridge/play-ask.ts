// Ask your AI while you play (CONTRACT.md §3.5, 2026-10-20: "develop while you play, full screen").
//
// The person is in ▶ Play, something goes wrong ("the character vanished when I stopped here"), and they press ` (or
// the small mark in the corner), type it and press Enter. The game does not stop: the field sits over it, takes the
// keys only while it has focus, and closes on Enter. What came with the words is the MOMENT, gathered here in the
// game page because only the page has it: a picture of the game, where the player's camera was, what was near it,
// and the console (errors, warnings, the last lines). The editor page keeps it as a "play" request and the AI's
// progress comes back as one small line at the top ("Your AI is looking" → "Fixing it" → "Fixed · Reload").
//
// WHY in the game page and not the editor page: full screen. A game that goes full screen (its own button, F11 does
// not count) shows only its own page, so anything drawn by the editor around the frame is gone. The overlay is a
// popover (the browser's top layer), shown again whenever full screen changes, so it draws over a full-screen canvas
// too. It lives in a shadow root so the game's CSS cannot reach it and its CSS cannot reach the game.
//
// WHY ` (the backquote): it is the "console" key of PC games — the key players already press to talk to the game's
// makers — and almost no game uses it for play (WASD, arrows, Space, Enter, Shift, E, R, Q, Tab, Esc and the numbers
// all are; "/" opens chat in many). Enter, R or a letter would fight the game. On a Japanese keyboard ` is Shift+@;
// the corner mark is there for every keyboard and for touch.
//
// Nothing here runs until the editor says so (play/on). Pause-edit (2026-10-28): the offline web demo says so too — the
// pause, the paused moment, Next frame and Speed need no AI (decision 12) — but with `ai: false`, so the ✦ field and
// its line stay away there, as the demo's Edit has no AI either.
//
// The pause (play-pause.ts holds the game) is the way into the paused MOMENT (pause-edit, a request of 2026-10-28:
// "pause in the middle of a scene and give instructions, by hand or to the AI"): P, the editor's top-bar ❚❚ Pause to edit, or
// in full screen the corner's ❚❚. Here: the game held, the moment's picture taken (it goes with the first request of
// the pause), full screen left (the editor's tools are outside it), the editor woken over the moment (play-move.ts
// MomentHost) and the editor page told which objects are the game's for this moment only. Everything else of the
// moment — the list, the card, the field, Save, ⌘Z — is the editor page's. Stage 1–2's chat panel over the paused
// game, "✥ Move / Talk" and M are gone (decision 2).
import type { AdapterProbe, BridgeToShell, GameConfig, Item, PlayLine, PlayLog, PlayNear, ShellToBridge, StudioAdapter } from '../contract.ts';
import { isStudioMessage } from '../contract.ts';
import { LINE_FADE_MS, LINE_GRACE_MS, lineStayMs } from '../shell/line-fade.ts';
import { icon } from '../shell/icons.ts';
import { shootPage } from './play-shot.ts';
import { createPauseHold, isPauseKey, STEP_MS, type PauseHold, type PauseParts } from './play-pause.ts';
import { createMomentEditor, createMomentKinds, defaultHandlePx, type MomentHost, type MomentKinds } from './play-move.ts';
import type { Core } from '../core/index.ts';
import type { RulesHolder } from '../core/rules.ts';
import { nativeSetTimeout, nativeClearTimeout } from '../core/native.ts';

export interface PlayAskOptions {
  win: Window & typeof globalThis;
  parentOrigin: string;
  /** The adapters to ask for the player's camera and what is near (game's first, then the built-ins). */
  probes: () => AdapterProbe[];
  /** Pause while playing (play-pause.ts, 2026-10-22): the frames and the clock to hold. Absent = no pause. */
  pause?: PauseParts;
  /**
   * The paused moment (pause-edit, play-move.ts): what a Play page's editor needs, and `arranged` (the draft shown at
   * Play: settles with the keys its motions move). An edit page gives its own editor instead (PlayAskHandle.useHost).
   */
  move?: { core: Core; rules: RulesHolder; arranged: Promise<string[]> };
  /**
   * ▶ Play in the same page (fast switch, 2026-10-22; play-switch.ts): installed in an EDIT page, asleep — no hello, no
   * overlay, no key taken — until the page becomes Play (wake()). Absent = a Play page: awake from the start, as before.
   */
  standby?: boolean;
}

/** What play-switch.ts needs of this module in an edit page. */
export interface PlayAskHandle {
  /** The pause's hold (frames, clock, sound): Edit holds the game with it too. null = no pause (outside the editor's frame clock). */
  readonly hold: PauseHold | null;
  /** The page became Play: say hello (the editor answers play/on), and a Move in a pause starts from `arranged`. */
  wake(arranged: Promise<string[]>): void;
  /** Back in Edit: the paused moment ended, the field and the line put away, the overlay hidden; nothing taken until wake(). */
  sleep(): void;
  /** An edit page's own editor wakes over its paused moments (play-switch.ts momentHost), not a new one. */
  useHost(host: MomentHost): void;
}

// ---------------------------------------------------------------------------
// The console, kept from the first line (pure parts exported for test/play-ask.test.ts)
// ---------------------------------------------------------------------------

export interface LogEntry {
  level: PlayLog['level'];
  text: string;
  /** ms, performance.now() */
  t: number;
}

/** How many lines of each kind go with a request: every error / warning there is room for, plus the last few lines. */
export const LOG_ERRORS = 20;
export const LOG_TAIL = 10;
const LOG_KEEP = 200;

/**
 * Below this width the field says it short ("Tell your AI what’s wrong"): the full sentence ("What went wrong? Your AI
 * sees this moment.") was cut to "…sees this momen" on a 390 px phone (Ive review 3, ④, 2026-10-20). The same width as
 * the CSS below that hides the field's hint.
 */
export const NARROW_PX = 520;

/** One console call as one line: strings as they are, errors by their message (first line of the stack), objects as JSON. */
export function logText(args: unknown[]): string {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack ? a.stack.split('\n').slice(0, 2).join(' ') : `${a.name}: ${a.message}`;
    try {
      const s = JSON.stringify(a);
      return s === undefined ? String(a) : s;
    } catch {
      return String(a);
    }
  }).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * What of the console goes with a request: the last LOG_ERRORS errors and warnings and the last LOG_TAIL lines of any
 * kind, oldest first, each with how long before the request it was written. A game that logs every frame would
 * otherwise push the one error that matters out of the picture.
 */
export function pickLogs(all: LogEntry[], now: number): PlayLog[] {
  const keep = new Set<LogEntry>();
  const bad = all.filter((e) => e.level !== 'log');
  for (const e of bad.slice(-LOG_ERRORS)) keep.add(e);
  for (const e of all.slice(-LOG_TAIL)) keep.add(e);
  return all.filter((e) => keep.has(e)).map((e) => ({ level: e.level, text: e.text, ago: Math.max(0, Math.round((now - e.t) / 100) / 10) }));
}

/**
 * Is this key press "ask my AI"? The backquote with no modifier (Shift allowed: it IS the backquote on a Japanese
 * keyboard), never while the game's own text field has focus (a chat box, a name entry).
 */
export function isAskKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean }, typing: boolean): boolean {
  if (typing || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
  // By the character, not the physical key: on a US keyboard that is the key left of 1, on a Japanese one Shift+@
  // (whose physical "Backquote" key is the half-width / full-width key there, and Shift+` on a US keyboard is ~).
  return e.key === '`';
}

/**
 * 2D: what is on screen, nearest the middle first (`screen` 0–1 in the page). The player is usually there in a game
 * that follows them; in one that does not, these are still the things in the picture.
 */
export function near2D(items: Array<{ key: string; label?: string; pose?: PlayNear['pose'] }>, centerOf: (key: string) => [number, number] | null, w: number, h: number, max = 12): PlayNear[] {
  const out: Array<PlayNear & { m: number }> = [];
  for (const it of items) {
    const c = centerOf(it.key);
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || c[0] < 0 || c[1] < 0 || c[0] > w || c[1] > h) continue;
    const e: PlayNear & { m: number } = { key: it.key, screen: [c[0] / w, c[1] / h], m: Math.hypot(c[0] - w / 2, c[1] - h / 2) };
    if (it.label) e.label = it.label;
    if (it.pose) e.pose = it.pose;
    out.push(e);
  }
  out.sort((a, b) => a.m - b.m);
  return out.slice(0, max).map(({ m: _m, ...e }) => e);
}

// ---------------------------------------------------------------------------
// The picture (play-shot.ts: a screenshot — the canvases and the HTML UI over them)
// ---------------------------------------------------------------------------

/**
 * A WebGL canvas forgets its picture right after each frame is shown, so reading it later (when Enter is pressed)
 * gives black. Asking for `preserveDrawingBuffer` keeps the last frame readable. Only in ▶ Play inside the editor
 * (this module never runs elsewhere), where a picture is worth the small cost (the first try left the engine's own
 * `false` alone and every three.js picture came out black, 2026-10-20).
 */
function keepWebGLPictures(win: Window & typeof globalThis) {
  const proto = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
  if (!proto || (proto.getContext as { __studioPlay?: boolean }).__studioPlay) return;
  const orig = proto.getContext;
  const wrapped = function (this: HTMLCanvasElement, type: string, attrs?: Record<string, unknown>) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      // Always on: three.js (and most engines) pass `preserveDrawingBuffer: false` explicitly, as their default.
      attrs = { ...(attrs || {}), preserveDrawingBuffer: true };
    }
    return (orig as (t: string, a?: unknown) => RenderingContext | null).call(this, type, attrs);
  } as typeof proto.getContext & { __studioPlay?: boolean };
  wrapped.__studioPlay = true;
  proto.getContext = wrapped;
}

// ---------------------------------------------------------------------------
// The overlay
// ---------------------------------------------------------------------------

// Violet is the AI's colour everywhere in the editor (#8b7cff, CONTRACT.md §2); nothing else here is coloured.
const CSS = `
:host { all: initial; }
.wrap { position: fixed; inset: 0; pointer-events: none; font: 500 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #f4f4f6; -webkit-font-smoothing: antialiased; }
.glass { background: rgba(18, 18, 24, .84); -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2);
  border: 1px solid rgba(255,255,255,.10); box-shadow: 0 8px 30px rgba(0,0,0,.35); }
.mark { position: absolute; right: 14px; bottom: 14px; pointer-events: auto; display: flex; align-items: center; gap: 8px;
  height: 32px; padding: 0 12px 0 10px; border-radius: 16px; cursor: pointer; color: inherit; font: inherit;
  transition: opacity .3s, padding .3s; opacity: .92; }
.mark:hover { opacity: 1; }
.mark .word { white-space: nowrap; }
.mark.small .word { display: none; }
.mark.small { padding: 0 10px; }
/* After its first 5 s the mark is only ✦ and \`; the pointer on it says what it is again: "Ask your AI \`" (Ive review
   3, ④: the bare mark said nothing until pressed). No title tooltip on top of it (the words ARE the tooltip). */
.mark.small:hover .word, .mark.small:focus-visible .word { display: inline; }
.mark.small:hover, .mark.small:focus-visible { padding: 0 12px 0 10px; }
kbd { font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 6px; border-radius: 5px;
  background: rgba(255,255,255,.12); color: #f4f4f6; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #8b7cff; flex: none; box-shadow: 0 0 0 3px rgba(139,124,255,.22); }
.busy .dot { animation: pulse 1.1s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(139,124,255,.0); opacity: .55; } }
/* The way in (the corner mark and the field) carries the editor's ask mark, ✦ (shell/icons.ts 'spark', the same as the
   editor's "Ask your AI…" field: one sign for "ask your AI" everywhere — Ive review 3, ④). The violet glow the dot had
   stays, as a soft light round the spark. The line at the top keeps the dot: it is the AI's state, as "● AI" is. */
.spark { width: 14px; height: 14px; flex: none; color: #8b7cff; display: grid; filter: drop-shadow(0 0 3px rgba(139,124,255,.55)); }
.spark svg { width: 14px; height: 14px; stroke-width: 1.5px; }
.busy .spark { animation: glow 1.1s ease-in-out infinite; }
@keyframes glow { 50% { filter: drop-shadow(0 0 0 rgba(139,124,255,0)); opacity: .55; } }
.bar { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(560px, calc(100% - 32px));
  pointer-events: auto; border-radius: 14px; padding: 8px 8px 8px 14px; display: flex; align-items: center; gap: 10px;
  border-color: rgba(139,124,255,.55); box-shadow: 0 0 0 3px rgba(139,124,255,.18), 0 10px 34px rgba(0,0,0,.4); }
.bar input { all: unset; flex: 1; min-width: 0; font: 500 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; padding: 6px 0; }
.bar input::placeholder { color: rgba(255,255,255,.5); }
.bar .hint { color: rgba(255,255,255,.55); font-size: 12px; white-space: nowrap; }
button.b { all: unset; cursor: pointer; pointer-events: auto; padding: 6px 11px; border-radius: 9px; font-weight: 600; white-space: nowrap;
  background: rgba(255,255,255,.10); color: #f4f4f6; }
button.b:hover { background: rgba(255,255,255,.18); }
button.b.primary { background: #8b7cff; color: #fff; }
button.b.primary:hover { background: #9a8dff; }
button.b:focus-visible, .mark:focus-visible { outline: 2px solid #8b7cff; outline-offset: 2px; }
.line { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); max-width: calc(100% - 32px); pointer-events: auto;
  border-radius: 14px; padding: 8px 10px 8px 14px; display: flex; align-items: center; gap: 10px; }
.line .say { display: flex; flex-direction: column; min-width: 0; }
.line .head { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.line .sub { color: rgba(255,255,255,.55); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* "More in Claude" at the end of the small row (2026-10-21, as the editor's line, shell.css .has-more): it never shrinks;
   what was asked is the part cut with "…", so the row stays one line on a phone and in the side window too. */
.line .sub.has-more { display: flex; gap: 6px; min-width: 0; }
.line .sub.has-more > .said { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.line .sub.has-more > .sep, .line .sub.has-more > .more { flex: none; }
.line .acts { display: flex; gap: 6px; flex: none; }
.x { all: unset; cursor: pointer; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; color: rgba(255,255,255,.6); font-size: 15px; }
.x:hover { background: rgba(255,255,255,.12); color: #fff; }
.choices { display: flex; gap: 6px; flex-wrap: wrap; }
/* "Fixed" goes by itself after it was read (line-fade.ts, 2026-10-20); the corner mark's dot keeps a stronger ring while
   the fix waits for Reload (\` or the mark, then Enter). */
.line { transition: opacity .4s cubic-bezier(.2,.8,.2,1), transform .4s cubic-bezier(.2,.8,.2,1); }
.line.fading { opacity: 0; transform: translateX(-50%) translateY(-4px); }
.mark.ready .spark { filter: drop-shadow(0 0 2px #8b7cff) drop-shadow(0 0 6px rgba(139,124,255,.8)); }
[hidden] { display: none !important; }
@media (max-width: 520px) {
  .line { top: 10px; padding: 7px 8px 7px 12px; }
  .bar { bottom: 12px; }
  .bar .hint { display: none; }
}
/* Touch: no key to show, and a mark a finger can hit (44 px, UI.handlePxPhone). */
@media (pointer: coarse) {
  kbd { display: none; }
  .mark { height: 44px; border-radius: 22px; padding: 0 16px 0 14px; }
  .mark.small { padding: 0 17px; }
}
@media (prefers-reduced-motion: reduce) { .busy .dot, .busy .spark { animation: none; } .line { transition: none; } }
/* The corner's ❚❚ Pause to edit P (pause-edit, 2026-10-28): in full screen only — the editor's top bar, where it sits
   next to Edit on every screen (02-find.md), is not seen there. The mark's glass, height and key cap. */
.corner { position: absolute; right: 14px; bottom: 14px; display: flex; align-items: center; gap: 8px; pointer-events: none; }
.corner .mark { position: static; }
.pause { pointer-events: auto; height: 32px; padding: 0 10px 0 11px; border-radius: 16px; display: flex; align-items: center; gap: 8px;
  cursor: pointer; color: inherit; font: inherit; white-space: nowrap; transition: opacity .3s; opacity: .92; }
.pause:hover { opacity: 1; }
.pause .ic { display: grid; place-items: center; }
.pause svg { width: 14px; height: 14px; }
.pause:focus-visible { outline: 2px solid #8b7cff; outline-offset: 2px; }
@media (pointer: coarse) { .pause { height: 44px; border-radius: 22px; padding: 0 16px 0 14px; } }
`;

type Words = Record<string, string>;

/** Is this key "Next frame" (pause-edit; the . key while paused)? By the character, or the key when a layout gives another. */
export function isStepKey(e: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean }, typing: boolean): boolean {
  if (typing || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key === '.' || e.code === 'Period';
}

/** Held down, Next frame steps on at the speed after this long (a press shorter than it is one frame). */
const STEP_HOLD_MS = 300;

export function startPlayAsk(o: PlayAskOptions): PlayAskHandle {
  const { win, parentOrigin } = o;
  // Play in the same page (fast switch): false while the edit page is in Edit (see PlayAskOptions.standby).
  let awake = !o.standby;
  const doc = win.document;
  keepWebGLPictures(win);
  // Made now, before the game's code: it keeps the AudioContexts the game makes so a pause can quiet them.
  const hold: PauseHold | null = o.pause ? createPauseHold(win, o.pause) : null;

  // ----- the console, from the first line the game writes -----
  const logs: LogEntry[] = [];
  const keepLog = (level: LogEntry['level'], args: unknown[]) => {
    const text = logText(args);
    if (!text || text.startsWith('[studio]')) return; // the editor's own lines are not the game's
    logs.push({ level, text, t: win.performance.now() });
    if (logs.length > LOG_KEEP) logs.splice(0, logs.length - LOG_KEEP);
  };
  const con = win.console as unknown as Record<string, (...a: unknown[]) => void>;
  for (const [name, level] of [['error', 'error'], ['warn', 'warn'], ['log', 'log'], ['info', 'log']] as const) {
    const orig = con[name];
    if (typeof orig !== 'function') continue;
    con[name] = function (...args: unknown[]) {
      try {
        keepLog(level, args);
      } catch {
        /* never break the game's logging */
      }
      return orig.apply(this, args);
    };
  }
  win.addEventListener('error', (e: ErrorEvent) => {
    if (!e.message) return;
    const file = e.filename ? e.filename.split(/[?#]/)[0]!.split('/').pop() : '';
    keepLog('error', [`${e.message}${file ? ` (${file}${e.lineno ? ':' + e.lineno : ''})` : ''}`]);
  });
  win.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string } | undefined;
    keepLog('error', ['Unhandled rejection: ' + (r && typeof r.message === 'string' ? r.message : String(e.reason))]);
  });

  const post = (m: BridgeToShell) => {
    try {
      win.parent.postMessage(m, parentOrigin);
    } catch {
      /* parent gone */
    }
  };

  // ----- the overlay, built when the editor says so (play/on) -----
  let words: Words | null = null;
  // An AI can get a request (play/on `ai`, false in the offline web demo): the ✦ field and its line.
  let aiOn = true;
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let mark: HTMLButtonElement, bar: HTMLElement, input: HTMLInputElement, hint: HTMLElement, line: HTMLElement;
  // The full-screen corner's ❚❚ Pause to edit P.
  let pauseBtn: HTMLButtonElement | null = null;
  // The paused moment (play-move.ts): who wakes the editor, whether it is up, and the kinds of the objects.
  let moveConfig: GameConfig | null = null;
  let moveHandlePx = 0;
  let lang: 'en' | 'ja' = 'en';
  let momentHost: MomentHost | null = null;
  let momentUp = false;
  // The picture taken at the last pause (tests: the paused frame against what the editor then shows, _move.shot).
  let momentShot = '';
  let state: PlayLine | null = null;
  let barOpen = false;
  let sending = false;
  let sendFailed = false;
  let dismissed = '';
  // Does this page draw the corner mark? The editor says (play/on `mark`): on a phone the way in is its ✦ in the top bar,
  // left of Edit, because the corner sat on the game's own words at the foot ("WASD works too", Ive review 3, ④). In
  // full screen the editor's bar is gone, so the mark comes back here whatever the editor said.
  let markOn = true;
  // "Fixed" fades by itself like the editor's finished line (line-fade.ts): `fadeSig` is the line whose timer runs; when
  // it is due the line goes the way × goes (`dismissed`). Not "failed" / "asking" / "kept": those need the person.
  let fadeSig = '';
  let fadeTimer = 0;
  let leftAt = 0;
  // The corner mark's words shrink after 5 s (build, and again after each reshow).
  let smallTimer = 0;
  const w = (k: string) => (words && words[k]) || '';
  const spark = () => {
    const s = el('span', 'spark');
    s.append(icon('spark'));
    return s;
  };

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  let adapter: StudioAdapter | null = null;
  function findAdapter(): StudioAdapter | null {
    if (adapter) return adapter;
    for (const p of o.probes()) {
      try {
        const a = p.found();
        if (a) return (adapter = a);
      } catch {
        /* the next one */
      }
    }
    return null;
  }
  const listOf = (a: StudioAdapter | null): Item[] => {
    try {
      return a ? a.list() : [];
    } catch {
      return [];
    }
  };
  /** The world as the editor drives it while the moment is up (an edit page: always its editor's), else the game's. */
  const world = () => momentHost?.driven() ?? findAdapter();

  // The kinds of each pause (play-move.ts): Play's start, the person's own places, the motions.
  const firstFrame = () => o.move?.core.time.firstFrame() ?? Promise.resolve();
  const kinds: MomentKinds | null = hold ? createMomentKinds(() => listOf(world()), firstFrame, o.move?.arranged ?? Promise.resolve([] as string[])) : null;
  // A page opened for Play makes its own editor for the moment (an edit page hands its own over, useHost).
  if (hold && o.move && !o.standby) {
    const mv = o.move;
    momentHost = createMomentEditor({ win, core: mv.core, rules: mv.rules, adapter: () => findAdapter(), post,
      lang: () => lang, config: () => moveConfig, handlePx: () => moveHandlePx || defaultHandlePx(win), ignore: (e) => isOurs(e) });
  }

  // ----- the game's time since ▶ Play, for the top bar's 0:41.8 (play/time) -----
  // `t0` = the game's time when this Play began: a Play page's first frame, an edit page's wake().
  // `before` = the seconds of this page's earlier Plays (fix 1 ✕10 of walk 1, 2026-10-28): ▶ Play from Edit in the same
  // page goes on with the same game (the boss already there, SCORE 13,507, the game's TIME going on), so the top bar's
  // clock goes on too — it started at 0:00 and read as "from the start". Only a new page (Play from the start, a
  // Reload) starts at 0:00.
  let t0 = 0;
  let before = 0;
  if (hold && !o.standby) void firstFrame().then(() => {
    t0 = hold.now();
    tellTime();
  });
  const playSeconds = () => (hold ? Math.max(0, (hold.now() - t0) / 1000) : 0);
  function tellTime() {
    if (!hold || !awake) return;
    post({ type: 'studio:play/time', t: Math.round(playSeconds() * 1000) / 1000, rate: hold.rate, running: !hold.paused });
  }

  /** Over everything, full screen too: the top layer. Shown again after each full-screen change so it is on top. */
  const lift = () => {
    if (!host || !awake) return;
    const p = host as HTMLElement & { showPopover?: () => void; hidePopover?: () => void };
    if (typeof p.showPopover === 'function') {
      try {
        if (host.matches(':popover-open')) p.hidePopover!();
        p.showPopover();
        return;
      } catch {
        /* not in the document yet, or popovers off */
      }
    }
    // No popover support: inside the full-screen element when it can hold children (a canvas cannot).
    const fs = doc.fullscreenElement;
    const into = fs && fs.tagName !== 'CANVAS' && fs.tagName !== 'VIDEO' ? fs : doc.body || doc.documentElement;
    if (host.parentNode !== into) into.appendChild(host);
  };

  function build() {
    if (host) return;
    host = doc.createElement('game-studio-play');
    host.setAttribute('popover', 'manual');
    // Kept when an adapter hides the game's own HUD for editing (three.js hideOverlays, data-studio-keep): the paused
    // moment wakes the editor (play-move.ts), and this overlay holds the full-screen ❚❚ and the ✦ field.
    host.setAttribute('data-studio-keep', '');
    // The popover's own box: invisible and click-through; only the parts inside take the pointer.
    host.style.cssText = 'all:initial;position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    const style = el('style', '');
    style.textContent = CSS;
    const wrap = el('div', 'wrap');
    mark = el('button', 'mark glass') as HTMLButtonElement;
    mark.type = 'button';
    mark.dataset.part = 'play-ask-mark';
    mark.append(spark(), el('span', 'word', w('ask')), el('kbd', '', '`'));
    mark.setAttribute('aria-label', w('askTip'));
    mark.addEventListener('click', () => openBar());
    bar = el('div', 'bar glass');
    bar.dataset.part = 'play-ask-bar';
    bar.hidden = true;
    input = el('input', '') as HTMLInputElement;
    input.type = 'text';
    input.maxLength = 500;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('enterkeyhint', 'send');
    hint = el('span', 'hint');
    const close = el('button', 'x', '×') as HTMLButtonElement;
    close.type = 'button';
    close.title = w('close');
    close.setAttribute('aria-label', w('close'));
    close.addEventListener('click', () => closeBar());
    bar.append(spark(), input, hint, close);
    line = el('div', 'line glass');
    line.dataset.part = 'play-ask-line';
    line.hidden = true;
    line.setAttribute('role', 'status');
    line.setAttribute('aria-live', 'polite');
    // In the line = it stays (and coming back during the fade stops it).
    line.addEventListener('pointerenter', () => holdLine());
    line.addEventListener('focusin', () => holdLine());
    line.addEventListener('pointerleave', () => (leftAt = win.performance.now()));
    line.addEventListener('focusout', () => (leftAt = win.performance.now()));
    const corner = el('div', 'corner');
    if (hold) {
      pauseBtn = el('button', 'pause glass') as HTMLButtonElement;
      pauseBtn.type = 'button';
      pauseBtn.dataset.part = 'pause-button';
      // "❚❚ Pause to edit P" (pause-edit, 2026-10-28; it was "❚❚ Pause and talk P", the corner's one way in while
      // playing). Now the editor's top bar has it, next to Edit, on every screen; this one is for full screen only.
      const ic = el('span', 'ic');
      ic.append(icon('pause'));
      pauseBtn.append(ic, el('span', 'word', w('pauseEdit')), el('kbd', '', 'P'));
      pauseBtn.addEventListener('click', () => void pauseNow());
      corner.append(pauseBtn);
    }
    // With a pause the ✦ mark is not in the corner (below); it is still built: the ` field and its line use its state.
    corner.append(mark);
    wrap.append(corner, line, bar);
    root.append(style, wrap);
    // A press on the overlay is not a press in the game (a game that shoots on click must not shoot). Stopped where
    // it leaves the overlay, so the overlay's own buttons still get it; a game listening in the capture phase on the
    // window would still see it (rare).
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'wheel', 'contextmenu'] as const) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    (doc.body || doc.documentElement).appendChild(host);
    lift();
    // The short or the long placeholder (NARROW_PX) follows the window.
    win.addEventListener('resize', () => render());
    // "Ask your AI `" for a few seconds when Play starts, then only the dot and the key: seen once, then out of the way.
    smallTimer = nativeSetTimeout(() => mark.classList.add('small'), 5000);
    render();
  }

  const isOurs = (e: Event) => !!host && e.composedPath().includes(host);
  const gameTyping = () => {
    const a = doc.activeElement as HTMLElement | null;
    return !!a && a !== host && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  };

  // Registered now, before any game code: the first listener on the window in the capture phase, so the game never
  // sees a key meant for the field (its own listeners on window / document come after this one).
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    win.addEventListener(type, (e: KeyboardEvent) => {
      if (!words) return;
      if (hold?.paused) {
        // The paused moment: P resumes, . steps (held: on at the speed), everything else is the editor's (its input.ts
        // keeps them from the game; key RELEASES still reach the game — play-pause.ts). Escape is the editor's too
        // (it drops the tool, then the pick): it does not resume, as in Edit (02-find.md).
        if (isOurs(e)) {
          e.stopImmediatePropagation();
          return;
        }
        if (type === 'keydown' && isPauseKey(e, gameTyping())) {
          e.preventDefault();
          e.stopImmediatePropagation();
          resumeNow();
        } else if (isStepKey(e, gameTyping())) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (type === 'keydown' && !e.repeat) stepOn();
          else if (type === 'keyup') stepOff();
        } else if (!momentUp && type !== 'keyup') {
          // No editor over the moment (nothing to edit with): the game gets no key press while paused.
          e.stopImmediatePropagation();
        }
        return;
      }
      if (isOurs(e)) {
        // The field's keys are handled here and go no further: stopping them at the window in the capture phase is
        // the only way to keep them from a game's own listeners, and it also keeps them from the field's, so Enter
        // and Escape are read here. Letters still type (nothing prevents their default).
        e.stopImmediatePropagation();
        if (type === 'keydown') fieldKey(e);
        return;
      }
      if (type === 'keydown' && !barOpen && hold && isPauseKey(e, gameTyping())) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void pauseNow();
      } else if (type !== 'keydown' && hold && !barOpen && (e.key === 'p' || e.key === 'P' || e.code === 'KeyP') && !gameTyping()) {
        // The release (and keypress) of the P that paused: not the game's either.
        e.stopImmediatePropagation();
      } else if (type === 'keydown' && !barOpen && aiOn && isAskKey(e, gameTyping())) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openBar();
      } else if (type !== 'keydown' && aiOn && e.key === '`' && !gameTyping()) {
        e.stopImmediatePropagation();
      }
    }, true);
  }
  function fieldKey(e: KeyboardEvent) {
    if (e.target !== host || !root || root.activeElement !== input) return;
    sendFailed = false;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBar();
    } else if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      void submit();
    }
  }
  // Full screen changes whether the mark is drawn here (markOn), so draw again too. Left while paused (pauseNow): the
  // game's picture changed size — one frame drawn again with time stopped (decision 15: a game that moves by frame
  // steps one frame; said nowhere, it is small).
  const onFullscreen = () => {
    lift();
    render();
    if (hold?.paused) nativeSetTimeout(() => o.pause?.time.step(), 60);
  };
  doc.addEventListener('fullscreenchange', onFullscreen);
  doc.addEventListener('webkitfullscreenchange', onFullscreen);

  function openBar() {
    if (!host || !aiOn || hold?.paused) return;
    barOpen = true;
    // The field open again = the person looks for what happened: a "fixed" line that faded comes back (and goes again).
    if (state && state.state === 'fixed' && dismissed === JSON.stringify(state) && dismissed === fadeSig) {
      dismissed = '';
      fadeSig = '';
    }
    // Pointer-locked games (first person) hold the mouse; let go so the person can type and click.
    try {
      if (doc.pointerLockElement) doc.exitPointerLock();
    } catch {
      /* nothing locked */
    }
    render();
    input.focus({ preventScroll: true });
  }
  function closeBar() {
    barOpen = false;
    input.value = '';
    input.blur();
    render();
    // Back to the game: its canvas takes the keys again.
    try {
      win.focus();
    } catch {
      /* fine */
    }
  }

  // ----- the paused moment (play-pause.ts holds the game; play-move.ts wakes the editor over it) -----
  let pausing = false;
  async function pauseNow() {
    if (!hold || hold.paused || pausing) return;
    pausing = true;
    try {
      // Words already typed in the ✦ field go to the editor page's field (the person was about to ask; now they can).
      const draft = barOpen ? input.value.trim() : '';
      if (barOpen) closeBar();
      stepOff();
      hold.pause();
      // The moment, taken at once: the picture is of the game as it stopped (the overlay is never in it), the console
      // as it was. The first request of this pause carries it (the editor page sends it, from its field).
      const ask = await moment('');
      if (!hold.paused) return; // resumed while the picture was taken
      momentShot = ask.type === 'studio:play/ask' ? ask.shot ?? '' : '';
      // Out of full screen: the editor's tools are outside the game's page (decision 15).
      try {
        if (doc.fullscreenElement) await doc.exitFullscreen();
      } catch {
        /* the browser said no: the moment is still up, behind the full screen */
      }
      if (!hold.paused) return;
      // Which objects are the game's for this moment, before the editor or the person moves anything.
      const w0 = world();
      const why = kinds && w0 ? kinds.pause(listOf(w0), w0.dim) : {};
      momentUp = !!momentHost?.wake();
      const { type: _t, text: _x, ...rest } = ask as Extract<BridgeToShell, { type: 'studio:play/ask' }>;
      post({ type: 'studio:play/paused', on: true, edit: momentUp, why, ask: rest, ...(draft ? { draft } : {}) });
      tellTime();
      render();
    } finally {
      pausing = false;
    }
  }
  function resumeNow() {
    if (!hold || !hold.paused) return;
    stepOff();
    // The editor goes first (its own frame loop and the adapter's edit view end), then the game runs on from where the
    // objects now are. What the person moved is theirs from now on (kinds.resumed).
    const w0 = world();
    if (momentUp) momentHost?.sleep();
    momentUp = false;
    if (kinds && w0) kinds.resumed(listOf(w0), w0.dim);
    hold.resume();
    post({ type: 'studio:play/paused', on: false });
    tellTime();
    render();
    try {
      win.focus();
    } catch {
      /* fine */
    }
  }

  // ----- Next frame and Speed (play-pause.ts; the top bar's ▶| and 1× ⌄, the . key) -----
  let stepTimer = 0;
  let stepping = false;
  function stepOn() {
    if (!hold?.paused) return;
    stepOff();
    stepping = true;
    hold.step();
    tellTime();
    // Held: on at the chosen speed (1/60 s of game time each 1/60 / r s), until let go.
    stepTimer = nativeSetTimeout(function again() {
      if (!stepping || !hold.paused) return;
      hold.step();
      tellTime();
      stepTimer = nativeSetTimeout(again, STEP_MS / Math.max(0.05, hold.rate));
    }, STEP_HOLD_MS);
  }
  function stepOff() {
    stepping = false;
    nativeClearTimeout(stepTimer);
  }

  /** The state's line in reply to Enter on an empty field: a fix to load (Reload), or nothing to do. */
  async function submit() {
    const text = input.value.trim();
    if (!text) {
      if (state && state.state === 'fixed' && state.reload) {
        closeBar();
        post({ type: 'studio:play/reload' });
      }
      return;
    }
    if (sending) return;
    if (state && state.state === 'asking') {
      sending = true;
      post({ type: 'studio:play/answer', text });
      return;
    }
    sending = true;
    render();
    post(await moment(text));
  }

  /** The words and the moment: picture, player's camera, what is near, the console. Each part is optional. */
  async function moment(text: string): Promise<BridgeToShell> {
    const now = win.performance.now();
    // The picture with the game's HTML UI, without the editor's own parts (this overlay, the editor's tools).
    const notOurs = (e: Element) => e === host || e.tagName === 'GAME-STUDIO-PLAY' || e.hasAttribute('data-studio-ui');
    const shot = shootPage(win, notOurs) || undefined;
    let view: { eye: [number, number, number]; target: [number, number, number] } | undefined;
    let near: PlayNear[] | undefined;
    const a = findAdapter();
    if (a) {
      try {
        const items = a.list();
        const byKey = new Map(items.map((i) => [i.key, i]));
        const p = a.dim === '3d' && a.player ? a.player() : null;
        if (p) {
          view = { eye: p.eye, target: p.target };
          if (p.near) {
            near = p.near.map((n) => {
              const it = byKey.get(n.key);
              const e: PlayNear = { key: n.key, d: n.d };
              const label = n.label || it?.label;
              if (label) e.label = label;
              if (it?.pose) e.pose = it.pose;
              if (n.screen) e.screen = n.screen;
              return e;
            });
          }
        } else if (a.dim === '2d') {
          near = near2D(items, (k) => {
            const an = a.anchor(k);
            return an ? an.center : null;
          }, win.innerWidth, win.innerHeight);
        }
      } catch (e) {
        keepLog('warn', ['[game-studio] could not read the scene for the request: ' + String((e as Error)?.message || e)]);
      }
    }
    const out: BridgeToShell = { type: 'studio:play/ask', text, size: [win.innerWidth, win.innerHeight] };
    if (shot) out.shot = shot;
    if (view) out.view = view;
    if (near && near.length) out.near = near;
    const l = pickLogs(logs, now);
    if (l.length) out.logs = l;
    if (doc.fullscreenElement) out.fullscreen = true;
    return out;
  }

  // ----- the "fixed" line's own clock -----
  function fadeFor(s: PlayLine | null, sig: string) {
    if (!s || s.state !== 'fixed' || sig === dismissed) {
      if (fadeSig !== sig) {
        nativeClearTimeout(fadeTimer);
        fadeSig = '';
      }
      return;
    }
    if (fadeSig === sig) return;
    fadeSig = sig;
    line.classList.remove('fading');
    nativeClearTimeout(fadeTimer);
    fadeTimer = nativeSetTimeout(lineDue, lineStayMs(s.text + (s.asked || '')));
  }
  function lineDue() {
    // Held: the pointer or the keyboard is in it, it just left, or the field is open (the line is what they reply to).
    if (line.matches(':hover') || line.matches(':focus-within') || barOpen || win.performance.now() - leftAt < LINE_GRACE_MS) {
      fadeTimer = nativeSetTimeout(lineDue, 500);
      return;
    }
    line.classList.add('fading');
    const reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    fadeTimer = nativeSetTimeout(() => {
      line.classList.remove('fading');
      dismissed = fadeSig;
      render();
    }, reduce ? 0 : LINE_FADE_MS);
  }
  function holdLine() {
    if (!line.classList.contains('fading')) return;
    line.classList.remove('fading');
    nativeClearTimeout(fadeTimer);
    fadeTimer = nativeSetTimeout(lineDue, LINE_GRACE_MS);
  }

  // ----- drawing: the corner, the field, the line -----
  function render() {
    if (!host) return;
    const s = state;
    const busy = !!s && (s.state === 'looking' || s.state === 'fixing');
    mark.classList.toggle('busy', busy);
    const paused = !!hold?.paused;
    const full = !!doc.fullscreenElement;
    // The corner: in full screen only ❚❚ Pause to edit (the editor's top bar has it otherwise); a page that cannot pause
    // keeps the ✦ mark as before.
    mark.hidden = barOpen || paused || !!pauseBtn || !aiOn || !(markOn || full);
    if (pauseBtn) {
      pauseBtn.hidden = barOpen || paused || !full;
      pauseBtn.title = w('pauseTip');
      pauseBtn.setAttribute('aria-label', w('pauseTip'));
      const word = pauseBtn.querySelector('.word');
      if (word) word.textContent = w('pauseEdit');
    }
    bar.hidden = !barOpen;
    bar.classList.toggle('busy', sending);
    input.disabled = sending;
    const asking = !!s && s.state === 'asking';
    const narrow = win.innerWidth < NARROW_PX;
    input.placeholder = sending ? w('sending') : sendFailed ? w('sendFail') : asking ? w('answerPlaceholder') : w(narrow ? 'placeholderShort' : 'placeholder');
    hint.textContent = s && s.state === 'fixed' && s.reload ? w('enterReloads') : '';
    hint.hidden = !hint.textContent;

    line.replaceChildren();
    const sig = s ? JSON.stringify(s) : '';
    // Paused: the editor page's own line over its field says what the AI does (the moment is its editor), so this waits.
    line.hidden = !s || sig === dismissed || paused || !aiOn;
    fadeFor(s, sig);
    // A fix that waits for Reload after its line went: the corner dot says so (` or the mark, then Enter reloads).
    const waiting = !!s && s.state === 'fixed' && !!s.reload && line.hidden;
    mark.classList.toggle('ready', waiting);
    // The reload waiting is the one thing the mark's words do not say: only then a tooltip.
    mark.title = waiting ? w('reloadTip') : '';
    mark.setAttribute('aria-label', waiting ? w('reloadTip') : w('askTip'));
    if (!s || line.hidden) return;
    line.classList.toggle('busy', busy);
    const say = el('div', 'say');
    say.append(el('span', 'head', s.text));
    if (s.more) {
      // Words only, not a button (as the editor's line): a web page cannot bring the AI's own window to the front.
      const sub = el('span', 'sub has-more');
      if (s.asked) {
        const sep = el('span', 'sep', '·');
        sep.setAttribute('aria-hidden', 'true');
        sub.append(el('span', 'said', s.asked), sep);
      }
      const more = el('span', 'more', s.more);
      more.dataset.part = 'play-ask-more';
      sub.append(more);
      say.append(sub);
    } else if (s.asked) say.append(el('span', 'sub', s.asked));
    line.append(el('span', 'dot'), say);
    line.title = [s.asked ? `${s.text} — ${s.asked}` : s.text, s.more].filter(Boolean).join(' · ');
    const acts = el('div', 'acts');
    if (s.state === 'asking' && s.choices && s.choices.length) {
      const row = el('div', 'choices');
      s.choices.forEach((c, i) => {
        const b = el('button', i === 0 ? 'b primary' : 'b', c) as HTMLButtonElement;
        b.type = 'button';
        b.addEventListener('click', () => {
          sending = true;
          render();
          post({ type: 'studio:play/answer', text: c });
        });
        row.append(b);
      });
      acts.append(row);
    }
    if (s.state === 'fixed' && s.reload) {
      const b = el('button', 'b primary', w('reload')) as HTMLButtonElement;
      b.type = 'button';
      b.dataset.action = 'play-reload';
      b.title = w('reloadTip');
      b.addEventListener('click', () => post({ type: 'studio:play/reload' }));
      acts.append(b);
    }
    if (s.state === 'fixed' || s.state === 'failed' || s.state === 'kept') {
      // "Keep playing": the line goes; the fix waits for Reload (or for the next time the game opens).
      const x = el('button', 'x', '×') as HTMLButtonElement;
      x.type = 'button';
      x.title = w('keep');
      x.setAttribute('aria-label', w('keep'));
      x.addEventListener('click', () => {
        dismissed = sig;
        render();
      });
      acts.append(x);
    }
    if (acts.childNodes.length) line.append(acts);
  }

  win.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== win.parent || ev.origin !== parentOrigin || !isStudioMessage(ev.data)) return;
    // An edit page in Edit: Play's messages are not for it (a late play/state after the switch back, say).
    if (!awake) return;
    const m = ev.data as ShellToBridge;
    if (m.type === 'studio:play/on') {
      words = m.words;
      lang = m.lang === 'ja' ? 'ja' : 'en';
      aiOn = m.ai !== false;
      if (m.config !== undefined) moveConfig = m.config ?? null;
      if (typeof m.handlePx === 'number' && m.handlePx > 0) moveHandlePx = m.handlePx;
      markOn = m.mark !== false;
      // Sent again when the editor's layout changes (a phone turned, a window made narrow): only the mark changes.
      // An overlay put away by sleep() (Play in the same page, again): shown, its words in full for a few seconds again.
      if (host && host.style.display === 'none') reshow();
      else if (host) render();
      else if (doc.body) build();
      else doc.addEventListener('DOMContentLoaded', build, { once: true });
      tellTime();
    } else if (m.type === 'studio:play/open') {
      // The editor's ✦ (phone): the same as ` or the corner mark. Paused: the editor page's own field is the way.
      if (host && !barOpen && !hold?.paused) openBar();
    } else if (m.type === 'studio:play/pause') {
      // The editor's ❚❚ Pause to edit / ▶ Resume (and P while its page has the keys): the same as P here.
      const want = m.on ?? !hold?.paused;
      if (!want) resumeNow();
      else void pauseNow();
    } else if (m.type === 'studio:play/speed') {
      hold?.speed(m.rate);
      tellTime();
    } else if (m.type === 'studio:play/step') {
      if (m.on) stepOn();
      else stepOff();
    } else if (m.type === 'studio:play/state') {
      state = m.state;
      render();
    } else if (m.type === 'studio:play/sent') {
      sending = false;
      sendFailed = !m.ok;
      if (m.ok) closeBar();
      else {
        render();
        input.focus({ preventScroll: true });
      }
    } else if (hold?.paused && momentUp && momentHost?.handle) {
      // A page opened for Play: the editor page's messages while the moment is up are its editor's (an edit page's
      // bridge routes them itself).
      momentHost.handle(m);
    }
  });
  /** The overlay again after sleep(): as build() shows it the first time. */
  function reshow() {
    if (!host) return;
    host.style.removeProperty('display');
    lift();
    mark.classList.remove('small');
    nativeClearTimeout(smallTimer);
    smallTimer = nativeSetTimeout(() => mark.classList.add('small'), 5000);
    render();
  }

  // For tests (test/studio-pause.browser.mjs), like `_debug` in Edit and `_play`: where an object of the moment is on
  // screen, what is right under a point, its kind, the game's time. Not enumerable, nothing else uses it.
  const api = (win as unknown as { __gameStudio?: object }).__gameStudio;
  if (hold && api && !Object.prototype.hasOwnProperty.call(api, '_move')) {
    Object.defineProperty(api, '_move', {
      value: Object.freeze({
        up: () => momentUp,
        anchor: (k: string) => world()?.anchor(k) ?? null,
        // `r`: the pick's own slack (UI.pickRadiusMouse / Touch) to ask what a press there picks; 0 = right under it.
        under: (x: number, y: number, r = 0) => { try { return world()?.pickNear(x, y, r)[0] ?? null; } catch { return null; } },
        list: () => listOf(world()),
        why: (k: string) => kinds?.why(k) ?? null,
        seconds: () => playSeconds(),
        rate: () => hold.rate,
        shot: () => momentShot,
      }),
      enumerable: false,
    });
  }

  if (awake) post({ type: 'studio:play/hello' });
  return {
    hold,
    wake(next) {
      if (awake) return;
      awake = true;
      kinds?.restart(next);
      // The game's time from this Play (the edit page's clock went on through earlier Plays), on from the last Play's.
      if (hold) t0 = hold.now() - before * 1000;
      post({ type: 'studio:play/hello' });
    },
    sleep() {
      if (!awake) return;
      stepOff();
      // Where this Play's clock got to: the next ▶ Play in this page goes on from it (wake()).
      before = playSeconds();
      // The paused moment ends: its editor goes first (the edit page's own editor comes up right after, play-switch.ts).
      if (hold?.paused) {
        if (momentUp) momentHost?.sleep();
        momentUp = false;
        post({ type: 'studio:play/paused', on: false });
      }
      if (barOpen) closeBar();
      awake = false;
      words = null;
      state = null;
      dismissed = '';
      sending = false;
      sendFailed = false;
      nativeClearTimeout(fadeTimer);
      fadeSig = '';
      if (host) {
        // Not `hidden`: the host's inline `all: initial` would win over it. Out of the top layer too.
        host.style.setProperty('display', 'none');
        try {
          if (host.matches(':popover-open')) (host as HTMLElement & { hidePopover(): void }).hidePopover();
        } catch {
          /* no popovers */
        }
      }
    },
    useHost(h) {
      momentHost = h;
    },
  };
}
