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
// Nothing here runs unless the editor says an AI can get the request (play/on): the offline web demo shows nothing.
import type { AdapterProbe, BridgeToShell, PlayLine, PlayLog, PlayNear, ShellToBridge, StudioAdapter } from '../contract.ts';
import { isStudioMessage } from '../contract.ts';
import { LINE_FADE_MS, LINE_GRACE_MS, lineStayMs } from '../shell/line-fade.ts';
import { icon } from '../shell/icons.ts';
import { shootPage } from './play-shot.ts';

export interface PlayAskOptions {
  win: Window & typeof globalThis;
  parentOrigin: string;
  /** The adapters to ask for the player's camera and what is near (game's first, then the built-ins). */
  probes: () => AdapterProbe[];
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
`;

type Words = Record<string, string>;

export function startPlayAsk(o: PlayAskOptions): void {
  const { win, parentOrigin } = o;
  const doc = win.document;
  keepWebGLPictures(win);

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

  // ----- the overlay, built when the editor says an AI can get the request -----
  let words: Words | null = null;
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let mark: HTMLButtonElement, bar: HTMLElement, input: HTMLInputElement, hint: HTMLElement, line: HTMLElement;
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

  /** Over everything, full screen too: the top layer. Shown again after each full-screen change so it is on top. */
  const lift = () => {
    if (!host) return;
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
    wrap.append(mark, line, bar);
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
    win.setTimeout(() => mark.classList.add('small'), 5000);
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
      if (isOurs(e)) {
        // The field's keys are handled here and go no further: stopping them at the window in the capture phase is
        // the only way to keep them from a game's own listeners, and it also keeps them from the field's, so Enter
        // and Escape are read here. Letters still type (nothing prevents their default).
        e.stopImmediatePropagation();
        if (type === 'keydown') fieldKey(e);
        return;
      }
      if (type === 'keydown' && !barOpen && isAskKey(e, gameTyping())) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openBar();
      } else if (type !== 'keydown' && e.key === '`' && !gameTyping()) {
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
  // Full screen changes whether the mark is drawn here (markOn), so draw again too.
  doc.addEventListener('fullscreenchange', () => (lift(), render()));
  doc.addEventListener('webkitfullscreenchange', () => (lift(), render()));

  function openBar() {
    if (!host) return;
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

  // ----- the "fixed" line's own clock -----
  function fadeFor(s: PlayLine | null, sig: string) {
    if (!s || s.state !== 'fixed' || sig === dismissed) {
      if (fadeSig !== sig) {
        win.clearTimeout(fadeTimer);
        fadeSig = '';
      }
      return;
    }
    if (fadeSig === sig) return;
    fadeSig = sig;
    line.classList.remove('fading');
    win.clearTimeout(fadeTimer);
    fadeTimer = win.setTimeout(lineDue, lineStayMs(s.text + (s.asked || '')));
  }
  function lineDue() {
    // Held: the pointer or the keyboard is in it, it just left, or the field is open (the line is what they reply to).
    if (line.matches(':hover') || line.matches(':focus-within') || barOpen || win.performance.now() - leftAt < LINE_GRACE_MS) {
      fadeTimer = win.setTimeout(lineDue, 500);
      return;
    }
    line.classList.add('fading');
    const reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    fadeTimer = win.setTimeout(() => {
      line.classList.remove('fading');
      dismissed = fadeSig;
      render();
    }, reduce ? 0 : LINE_FADE_MS);
  }
  function holdLine() {
    if (!line.classList.contains('fading')) return;
    line.classList.remove('fading');
    win.clearTimeout(fadeTimer);
    fadeTimer = win.setTimeout(lineDue, LINE_GRACE_MS);
  }

  // ----- drawing: the corner mark, the field, the line -----
  function render() {
    if (!host) return;
    const s = state;
    const busy = !!s && (s.state === 'looking' || s.state === 'fixing');
    mark.classList.toggle('busy', busy);
    mark.hidden = barOpen || !(markOn || !!doc.fullscreenElement);
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
    line.hidden = !s || sig === dismissed;
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
    if (s.asked) say.append(el('span', 'sub', s.asked));
    line.append(el('span', 'dot'), say);
    line.title = s.asked ? `${s.text} — ${s.asked}` : s.text;
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
    const m = ev.data as ShellToBridge;
    if (m.type === 'studio:play/on') {
      words = m.words;
      markOn = m.mark !== false;
      // Sent again when the editor's layout changes (a phone turned, a window made narrow): only the mark changes.
      if (host) render();
      else if (doc.body) build();
      else doc.addEventListener('DOMContentLoaded', build, { once: true });
    } else if (m.type === 'studio:play/open') {
      // The editor's ✦ (phone): the same as ` or the corner mark.
      if (host && !barOpen) openBar();
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
    }
  });
  post({ type: 'studio:play/hello' });
}
