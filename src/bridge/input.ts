// Pointer, wheel and key input in the game page while editing, plus the
// handles drawn next to the selected object.
//
// Rules (CONTRACT.md §2), and why:
// - Pressing an object only SELECTS it, on release, if the pointer did not
//   travel. Dragging anywhere else — including over objects that are not
//   picked — looks around (3D) or pans (2D). When ANY drag on an object moved
//   it (before 2026-10-16), fingers meant to select or look around nudged
//   things and a large ground mesh was easy to grab by accident.
// - Dragging the object that is ALREADY picked moves it (rebrand 2026-10-16:
//   the tool strip under it replaced the four round handles, and "drag the
//   thing itself" is what every other editor does). It needs a pick first, so
//   a stray drag never moves anything; very large objects (ground, sky: their
//   on-screen part 60 % of the window or more) and locked ones still look
//   around when dragged, which keeps the accident above impossible.
// - Tool modes (play test 2026-10-16): a press on a strip button (or
//   M / H / T / S) CHOOSES that tool and it stays pressed; then a drag
//   ANYWHERE on the game does it to what is picked — move follows the drag,
//   height goes with the vertical drag, turn with the horizontal drag (on the
//   chosen axis), size grows dragging right / up and shrinks left / down.
//   Before, only "drag the object" moved without holding a button; turn,
//   height and size needed the mouse held ON the small button while moving,
//   which felt unnatural in the play test. A drag started on a button still
//   works the old way. With a tool chosen, looking around is Option-drag
//   (orbit), right / middle drag (pan), Space held, two fingers on touch,
//   the wheel / trackpad; with nothing picked a drag always looks around
//   (there is nothing to act on). Escape: closes the choices, then drops the
//   tool, then the pick. A tap still picks (the tool stays chosen).
// - Pressing the same spot again picks the next object under it (the one
//   behind), so small objects hidden by large ones stay reachable.
// - A tap on "nothing" drops the pick (a web demo try 2026-10-18: "I want to click
//   an empty spot to deselect, and I can't"). Nothing = no object there, OR
//   only the background: a ground / background (Item.backdrop) or an object
//   whose on-screen part covers 60 % of the window or more (HUGE_ON_SCREEN,
//   the same rule that makes a drag on it look around). People call the sky,
//   the sea and the grass "nothing"; a tap there used to pick the ground. Such
//   objects are picked from the list. A press that travels past the tap slop
//   is a look-around and keeps the pick (as in other 3D editors: turning the
//   view never changes what is picked). The 3D side of "no object there" is in
//   adapters/three/pick.js (a box near the press is not enough: the lighthouse's
//   light beam made its box cover half the sky).

// - One gesture = one undo step: every `moved` of a gesture is sent, the last
//   one carries `end: true` and `from` (the pose before the gesture).
// - Listeners sit on window in the capture phase and are installed before any
//   game code, so they run first and can stop the game from also reacting.
// - A blur (the shell taking focus after a selection) must NOT forget an
//   active pointer: the next pointermove would otherwise be dropped and the
//   drag would stop half-way. Stale pointers are cleaned up by reliable
//   signals instead (a mouse move with no buttons pressed, a new press with
//   the same id).
// - Several objects (CONTRACT.md §1.8): Shift+click (or a press in "select
//   several" mode) adds or removes one; Shift+drag from an empty spot (or a
//   mouse drag from an empty spot in that mode) draws a box. The handles then
//   sit under the whole group and move / turn / resize all of it (group.ts).
//   WHY not a plain drag for the box: a plain drag has always looked around,
//   on objects and next to them, and that must keep working the same.
// - Camera up / down (3D, play test 2026-10-18; rise.ts says why and how it is
//   found): the ↑↓ buttons (a click = a step, held = keeps going, dragged =
//   follows the drag) and E / Q when nothing is picked or while looking
//   around. A press on the buttons is never a tap on "nothing": the pick stays.
// - Fly (3D, camera-wasd pass 2026-10-18 — "anyone who has used a 3D game engine moves the camera with WASD too"):
//   W / S forward / back along the line of sight, A / D left / right, E / Q straight up / down, Shift ×3 — smooth
//   while held, stopped on release (each frame, core.time.raf), at a speed the adapter takes from the scene's size
//   (adapters/three/camera.js fly). When: with nothing picked always (W A S D have no other job then: the tool keys
//   need a pick); with something picked only while the right button is held (Unity / Unreal / Godot's fly mode),
//   because then S is the Size tool and E / Q turn the pick — those keep their meaning without the right button.
//   E / Q also fly while looking around in the other ways (Space held, a middle / ⌥ drag), as before. Holding the
//   right button and pressing a fly key turns that drag into a fly-through look (view.look: the view turns where
//   the camera stands, as in the engines) instead of a pan, and its release opens no menu. Keys pressed in the
//   editor page come as studio:core/fly (shell/main.ts decides there). Never by itself: no key, no move.
// - The place's menu (context menu, 2026-10-18; a request after a try of the editor: "right-click in each place should bring up the menu for it —
//   in the scene, duplicate, delete, that kind of thing"): a right-click that did not travel (Mac: also Control-click),
//   or a touch held still for LONG_PRESS_MS away from the strip's buttons, sends placement/context; the editor page
//   draws the menu (shell/context-menu.ts). An object under it that is not picked yet is picked first (select(),
//   never focus: the camera stays where it is), as other 3D / 2D tools do; one already in the selection keeps the
//   whole selection. Nothing under it (or only the ground) keeps the pick: the menu then has Deselect. A right DRAG
//   still pans (the menu waits for the release, as in Blender / Unity), so the press never moves the view by itself.
import { UI, type BridgeToShell, type FlyKey, type Inset, type Lang, type Pose, type ShellToBridge, type StudioAdapter, type TurnAxis } from '../contract.ts';
import type { Core } from '../core/index.ts';
import { keyStep } from '../core/keys.ts';
import type { EditState } from './editor.ts';
import type { ToolHost } from './game-tools.ts';
import { HANDLE_LABELS, MANY_LABEL, READOUT_WORDS, TILT_HINT, TOOL_HINT, choiceFromEvent, createHandles, handleFromEvent, moreFromEvent, toolFromKey, type HandleKind, type Handles, type Outline } from './handles.ts';
import type { EditsAdapter } from '../core/edits.ts';
import { createRiseButtons, type RiseDir } from './rise.ts';
import { beginGroup, groupAnchor, groupLift, groupMove, groupPoses, groupRotate, groupScale, type GroupSession } from './group.ts';

export interface InputDeps {
  adapter: StudioAdapter;
  core: Core;
  win: Window & typeof globalThis;
  post: (msg: BridgeToShell) => void;
  state: EditState;
  select: (key: string | null, focus?: boolean) => void;
  /** Replace the selection with several objects (`primary` = the one the card shows). */
  selectMany: (keys: string[], primary: string | null) => void;
  /** The copy/delete layer, for drawing stand-in copies. */
  edits: EditsAdapter;
  step: (m: Extract<ShellToBridge, { type: 'studio:placement/step' }>) => void;
  /** Game tools (.studio/tools.js): get pointer presses first while one is on. */
  tools: ToolHost;
  markDirty: () => void;
}

export interface InputHandle {
  frame(): void;
  selectionChanged(): void;
  setLang(lang: Lang): void;
  setHandleSize(px: number): void;
  /** Viewport px the shell covers with floating panels (the strip stays clear of them). */
  setInset(inset: Inset): void;
  /** 3D: the turn axis (the R key / the shell's 'next' cycles y → x → z). */
  setAxis(axis: TurnAxis | 'next'): void;
  /** Choose the strip's tool from the shell (its keys, ⌘K), or none. */
  setTool(tool: HandleKind | null): void;
  /** Close the strip's choices (a press or Escape in the editor page). */
  closeMenu(): void;
  /** Space held in the shell: a drag looks around even with a tool chosen. */
  setLook(on: boolean): void;
  /** The fly keys held in the shell (studio:core/fly): the camera flies while any is held, [] stops. */
  setFly(keys: FlyKey[], fast: boolean): void;
  setTheme(theme: 'dark' | 'light'): void;
  /** Outline what the AI's last change touched, in its colour, with one tag. */
  setAiMarks(keys: string[], label: string | null): void;
  detach(): void;
}

interface Ptr {
  id: number;
  type: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  button: number;
  shift: boolean;
  /** Option / Alt at the press: look around instead of using the tool. */
  alt: boolean;
  /** A right-click (or the Mac's Control-click): its release without travel opens the place's menu, not a tap. */
  menu?: boolean;
  /** A fly key was used while this (right) button was held: its drag looks where the camera stands, its release opens no menu. */
  flew?: boolean;
}

/** What the current single-pointer gesture does. */
type Mode =
  | { kind: 'pending' } // pressed, not moved beyond the tap slop yet
  | { kind: 'look'; pan: boolean }
  // `anywhere`: the chosen tool, dragged from anywhere (measured from the drag's own travel, not round the object).
  | { kind: 'handle'; handle: HandleKind; key: string; from: Pose; last: Pose; data: Record<string, number>; anywhere?: boolean }
  | { kind: 'group'; handle: HandleKind; session: GroupSession; x0: number; y0: number; data: Record<string, number>; anywhere?: boolean }
  | { kind: 'box' }
  | { kind: 'pinch'; dist: number; cx: number; cy: number }
  // The camera up / down buttons: `dir` pressed at `t0`; `follow` once the press travelled (it then follows the drag).
  | { kind: 'rise'; dir: RiseDir; t0: number; follow: boolean }
  | { kind: 'tool' }
  | { kind: 'none' };

const SNAP = (15 * Math.PI) / 180;
const SNAP_WINDOW = (3 * Math.PI) / 180;
/** Tool dragged anywhere: radians of turn per px of horizontal drag (0.01 ≈ 0.57°/px: a full turn in ~630 px, 15° in ~26 px). */
const TURN_PER_PX = 0.01;
/** Size per px of drag (right / up = bigger): ×2 after ~140 px of travel, ×0.5 after the same the other way. */
const SIZE_PER_PX = 0.005;
/** localStorage flag: the "how to look around" line was seen (it shows once, on this computer). */
const HINT_SEEN = 'gameStudio.toolHint.v1';
/** An object whose on-screen part covers this share of the window or more is "huge" (a ground): a drag on it looks around, and a tap on it is a tap on nothing (deselect, 2026-10-18). 0.6 (W1 merge); 0.4 of the whole projected box before. */
const HUGE_ON_SCREEN = 0.6;
/**
 * A press held this long on the turn / size button (without moving) opens its choices, like the ▾ (tool options,
 * play test 2026-10-18). 450 ms: past a tap (~100-200 ms) and a hesitant press-then-drag, short of iOS's 500 ms callout.
 * The same length opens the place's menu on a touch held anywhere else on the game (context menu, 2026-10-18): one
 * long press, one feel; the two never meet (the strip's is on its buttons only, the menu's never starts on them).
 */
const LONG_PRESS_MS = UI.longPressMs;
/** Control-click is the Mac's right-click (one-button mice, trackpads without two-finger click set up). */
const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');
/**
 * Camera up / down (rise.ts), as shares of the game's height: a click on ↑ / ↓ moves a tenth (big enough to see,
 * small enough to aim: ~10 clicks lift the view by a whole screen); E / Q a twentieth per press — key repeat
 * (~30 / s) then gives ~1.5 screens a second; Shift = a fifth of that (as Shift = fine for the other keys).
 */
const RISE_STEP = 0.1;
const RISE_KEY_STEP = 0.05;
/** Held this long on ↑ / ↓ without moving, the camera keeps going at RISE_HOLD_PER_S screens a second until let go. */
const RISE_HOLD_MS = 350;
const RISE_HOLD_PER_S = 0.6;
/**
 * Fly keys (see the header) by KeyboardEvent.code, the key's PLACE: WASD stays under the left hand on AZERTY / QWERTZ
 * as in the engines. (E / Q were read by e.key before; on QWERTY that is the same.) `[right, up, forward]`.
 */
const FLY_DIRS: Record<FlyKey, [number, number, number]> = { w: [0, 0, 1], s: [0, 0, -1], a: [-1, 0, 0], d: [1, 0, 0], e: [0, 1, 0], q: [0, -1, 0] };
const FLY_CODES: Record<string, FlyKey> = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyE: 'e', KeyQ: 'q' };
/** Shift while flying: ×3 (engines' "fast"; Shift = fine for the step keys, but flying slower than this is never wanted). */
const FLY_FAST = 3;
/**
 * A fresh press moves this many seconds' worth at once, then the hold goes on smoothly: a tap still moves visibly.
 * 0.06 s ≈ the E / Q step before flying (RISE_KEY_STEP, a twentieth of the view), so a tap of E feels as it did.
 */
const FLY_KICK_S = 0.06;

/** A field of the page's own (the game's inputs, a contenteditable): its keys are typing, never flying. */
function typingIn(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.isContentEditable;
}

function wrap(a: number): number {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}
const samePose = (a: Pose, b: Pose) => JSON.stringify(a) === JSON.stringify(b);
/** One number for a pose's size (the first of three when they differ), never 0. */
const sizeOf = (p: Pose) => Math.abs((Array.isArray(p.s) ? p.s[0] : p.s) ?? 1) || 1;

export function attachInput(deps: InputDeps): InputHandle {
  const { adapter, win, post, state, select, selectMany, step, markDirty, tools, edits, core } = deps;
  const toolEvent = (type: 'down' | 'move' | 'up', p: Ptr) => ({ type, x: p.x, y: p.y, pointerType: p.type, shift: p.shift });
  const doc = win.document;
  const ptrs = new Map<number, Ptr>();
  let mode: Mode = { kind: 'none' };
  let lastTap: { x: number; y: number; key: string | null } | null = null;
  let lang: Lang = 'en';
  const handles: Handles = createHandles(doc, adapter.dim === '3d' && !!adapter.nudgeY);
  // Camera up / down: 3D adapters with view.rise only (2D has no height to go up: its view only pans and zooms).
  const riseUi = adapter.dim === '3d' && adapter.view.rise ? createRiseButtons(doc) : null;
  const riseLabels = () => riseUi?.setLabels(lang, !!state.selected);
  riseLabels();
  /** Camera up (dy > 0) / down by dy px; the view state goes to the shell when the gesture or key ends. */
  const riseBy = (dy: number) => {
    if (!adapter.view.rise || !dy) return;
    adapter.view.rise(dy);
    markDirty();
  };
  // Held ↑ / ↓: keeps going every frame after RISE_HOLD_MS (stops by itself once the gesture is no longer 'rise').
  // core.time.raf, not win.requestAnimationFrame: while editing the game's frames are frozen, and the page's rAF is
  // the game's (core/time.ts) — the first try used it and a held ↑ moved one step only (2026-10-18).
  let riseFrame = 0;
  let riseLast = 0;
  const riseHold = (now: number) => {
    riseFrame = 0;
    if (mode.kind !== 'rise' || mode.follow) return;
    if (now - mode.t0 >= RISE_HOLD_MS) {
      const dt = Math.min(0.1, (now - Math.max(riseLast, mode.t0 + RISE_HOLD_MS)) / 1000);
      riseBy((mode.dir === 'up' ? 1 : -1) * RISE_HOLD_PER_S * dt * win.innerHeight);
      riseLast = now;
    }
    riseFrame = core.time.raf(riseHold);
  };
  const riseEnd = () => {
    if (riseFrame) core.time.cancelRaf(riseFrame);
    riseFrame = 0;
    riseUi?.setActive(null);
    post({ type: 'studio:core/view-state', state: adapter.view.state() });
  };
  // Fly (see the header): keys held in the game page / in the shell, Shift for each, and the frame that moves.
  const flyHeld = new Set<FlyKey>();
  let flyFast = false;
  let shellFly: FlyKey[] = [];
  let shellFast = false;
  let flyFrame = 0;
  let flyLast = 0;
  let flyMoved = false;
  const canFly = () => adapter.dim === '3d' && !!adapter.view.fly;
  const rightHeld = () => [...ptrs.values()].some((p) => p.type === 'mouse' && p.button === 2);
  /** May this key fly now? W A S D: nothing picked, or the right button held. E / Q: also while looking around (as before). */
  const flyOk = (k: FlyKey) =>
    !state.selected || rightHeld() || ((k === 'e' || k === 'q') && (spaceHeld || mode.kind === 'look' || [...ptrs.values()].some(looksAround)));
  /** Move by `dt` seconds of every key that may fly now; true when something moved. */
  const flyBy = (keys: Iterable<FlyKey>, dt: number, fast: boolean, all = false) => {
    let r = 0, u = 0, f = 0;
    for (const k of keys) {
      if (!all && !flyOk(k)) continue;
      const d = FLY_DIRS[k];
      r += d[0];
      u += d[1];
      f += d[2];
    }
    if (!r && !u && !f) return false;
    const m = dt * (fast ? FLY_FAST : 1);
    adapter.view.fly!(r * m, u * m, f * m);
    // The right-drag under way turns where the camera stands from now on (onMove) and opens no menu (onUp).
    for (const p of ptrs.values()) if (p.type === 'mouse' && p.button === 2) p.flew = true;
    flyMoved = true;
    markDirty();
    return true;
  };
  const flyStep = (now: number) => {
    flyFrame = 0;
    if (!flyHeld.size && !shellFly.length) {
      flyStop();
      return;
    }
    const dt = Math.min(0.1, (now - flyLast) / 1000);
    flyLast = now;
    if (dt > 0) {
      flyBy(flyHeld, dt, flyFast);
      flyBy(shellFly, dt, shellFast, true);
    }
    flyFrame = core.time.raf(flyStep);
  };
  const flyStart = () => {
    if (flyFrame) return;
    flyLast = win.performance.now();
    flyFrame = core.time.raf(flyStep);
  };
  /** Every key let go (or the page lost them): stop, and tell the shell where the view ended (kept across reloads). */
  const flyStop = () => {
    if (flyFrame) core.time.cancelRaf(flyFrame);
    flyFrame = 0;
    if (flyMoved) post({ type: 'studio:core/view-state', state: adapter.view.state() });
    flyMoved = false;
  };
  const flyKeyOf = (e: KeyboardEvent): FlyKey | null => FLY_CODES[e.code] ?? (e.code ? null : (FLY_CODES[`Key${e.key.toUpperCase()}`] ?? null));
  // A press on the picked object: a drag from it moves it (see the header).
  let grabStart = false;
  // The chosen strip tool (stays until another is chosen or Escape), and a press that will use it.
  let tool: HandleKind | null = null;
  let toolStart = false;
  // Space held (in the game page, or in the shell via placement/look): drags look around.
  let spaceHeld = false;
  let hintShown = false;
  let hintTimer = 0;
  const hintSeen = () => {
    try {
      return win.localStorage.getItem(HINT_SEEN) === '1';
    } catch {
      return false;
    }
  };
  const touchFirst = () => win.matchMedia?.('(pointer: coarse)').matches ?? false;
  const showHint = () => {
    if (!tool || hintShown || hintSeen()) return;
    hintShown = true;
    const words = TOOL_HINT[lang] || TOOL_HINT.en;
    const name = (READOUT_WORDS[lang] || READOUT_WORDS.en)[tool];
    const more = tool === 'rotate' && canTurn() ? (TILT_HINT[lang] || TILT_HINT.en) : '';
    handles.hint((touchFirst() ? words.touch(name) : words.mouse(name)) + more);
    // Gone after the first drag with the tool (it was read and used), or after 8 s.
    win.clearTimeout(hintTimer);
    hintTimer = win.setTimeout(() => handles.hint(null), 8000);
  };
  const hintUsed = () => {
    if (!hintShown) return;
    handles.hint(null);
    try {
      win.localStorage.setItem(HINT_SEEN, '1');
    } catch {
      /* private window: shows again next time, which is fine */
    }
  };
  /** Can the chosen tool act on what is picked (its button is shown)? */
  const toolApplies = (k: HandleKind) => {
    const picked = state.items.filter((i) => (state.group.length > 1 ? state.group.includes(i.key) : i.key === state.selected));
    if (!picked.length) return false;
    if (k === 'move') return picked.some((i) => i.movable !== false);
    if (k === 'lift') return adapter.dim === '3d' && !!adapter.nudgeY && picked.some((i) => i.liftable !== false && i.movable !== false);
    if (k === 'rotate') return picked.some((i) => i.rotatable);
    return picked.some((i) => i.scalable);
  };
  /**
   * Does the turn / size button have choices right now (its ▾ shows)? Turn: 3D (the axes, canTurn), or several picked
   * (together / each in place, 2D too: multi rotate, play test 2026-10-18 — before, several turned "together" upright
   * only and a 2D turn button had no ▾). Size: several picked (tool options, 2026-10-18).
   */
  const hasChoices = (kind: 'axis' | 'scale') =>
    kind === 'axis' ? (canTurn() || state.group.length > 1) && toolApplies('rotate') : state.group.length > 1 && toolApplies('scale');
  /** Open (`kind`) or close (null) the strip's choices, and tell the editor page so a press or Escape there closes them. */
  const menu = (kind: 'axis' | 'scale' | null) => {
    const was = handles.menuOpen();
    // The turn button's choices: the axes (3D) and, with several picked, together / each in place under them.
    const turnRows = { axes: canTurn(), way: state.group.length > 1 ? state.turnMode : null };
    handles.menu(kind, kind === 'axis' ? state.axis : kind === 'scale' ? state.scaleMode : '', lang, turnRows);
    const now = handles.menuOpen();
    if (!!was !== !!now) post({ type: 'studio:placement/menu', open: !!now });
  };
  const chooseTool = (k: HandleKind | null, from: 'strip' | 'key' | 'shell' | 'menu') => {
    if (k === 'lift' && !(adapter.dim === '3d' && adapter.nudgeY)) return;
    const changed = k !== tool;
    tool = k;
    handles.setTool(k);
    if (changed) post({ type: 'studio:placement/tool', tool: k });
    // A tap on a button only chooses its tool, with the way last used (turn: upright at first; size: together).
    // The choices open from the ▾ in the button's corner or a long press (tool options, play test 2026-10-18: "nobody
    // presses a button twice"). History: the turn choices opened on the first tap until the polish pass 2026-10-16
    // (a newcomer had to answer "Turn / Tilt forward / Tilt sideways" first), then on a second tap, which nobody
    // found; the size choices (several picked) opened on the first tap until 2026-10-18.
    if (handles.menuOpen()) menu(null);
    if (k) showHint();
    else handles.hint(null);
  };
  /** The press looks around even with a tool chosen: Option, a right / middle button, or Space held. */
  const looksAround = (p: Ptr) => p.type === 'mouse' && (p.button !== 0 || p.alt || spaceHeld);
  // 3D turns around three axes (adapter.turn). Groups too since 2026-10-18 (multi rotate; upright only before).
  const canTurn = () => adapter.dim === '3d' && !!adapter.turn;
  /** How the group turns now (the turn button's choices). */
  const turnWay = () => ({ axis: canTurn() ? state.axis : ('y' as TurnAxis), mode: state.turnMode });
  let axisShown: TurnAxis | null = null;
  const showAxis = () => {
    const ax: TurnAxis = canTurn() ? state.axis : 'y';
    if (ax === axisShown) return;
    axisShown = ax;
    handles.setAxis(ax, lang);
  };
  const setAxis = (ax: TurnAxis | 'next') => {
    const order: TurnAxis[] = ['y', 'x', 'z'];
    state.axis = ax === 'next' ? order[(order.indexOf(state.axis) + 1) % 3]! : ax;
    showAxis();
    if (handles.menuOpen() === 'axis') menu('axis');
  };
  const toggleMenu = (kind: 'axis' | 'scale') => menu(handles.menuOpen() === kind ? null : kind);
  // The long press on the turn / size button (LONG_PRESS_MS): armed at the press, checked when it fires.
  let pressTimer = 0;
  const armLongPress = (id: number, kind: 'axis' | 'scale') => {
    win.clearTimeout(pressTimer);
    pressTimer = win.setTimeout(() => {
      const p = ptrs.get(id);
      if (!p || ptrs.size !== 1 || (mode.kind !== 'handle' && mode.kind !== 'group') || mode.anywhere) return;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) return;
      // Held still: nothing changed yet, so ending the gesture records no undo step. Forget the pointer so its
      // release is not read as a tap (which would choose the tool, or close the choices again).
      endGesture();
      ptrs.delete(id);
      menu(kind);
    }, LONG_PRESS_MS);
  };

  // Stop page scrolling/zooming by touch while editing; restored on detach.
  const prevTouchAction = doc.documentElement.style.touchAction;
  doc.documentElement.style.touchAction = 'none';

  const opts = { capture: true, passive: false } as AddEventListenerOptions;
  const block = (e: Event) => {
    // Keep the game from seeing input while it is being edited. Our own
    // handlers below run first because they were added before the game's.
    e.stopImmediatePropagation();
    if (e.cancelable && e.type !== 'keyup') e.preventDefault();
  };
  const blocked = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'contextmenu', 'keyup', 'keypress', 'gesturestart', 'gesturechange'];

  const emitMoved = (key: string, pose: Pose, extra: Partial<Extract<BridgeToShell, { type: 'studio:placement/moved' }>> = {}) => {
    markDirty();
    post({ type: 'studio:placement/moved', key, pose, ...extra });
  };

  const startGroup = (handle: HandleKind, p: Ptr, anywhere = false): Mode => {
    const session = beginGroup(adapter, state.group, state.selected!);
    if (!session) return { kind: 'none' };
    const ga = groupAnchor(adapter, session.keys, session.primary);
    const data: Record<string, number> = { d: 0, f: 1 };
    if (ga) {
      data.angle = Math.atan2(p.y - ga.center[1], p.x - ga.center[0]);
      data.dist = Math.max(8, Math.hypot(p.x - ga.center[0], p.y - ga.center[1]));
    }
    if (handle === 'lift') {
      // Same probe as one object, on the first member: world units per px.
      const a = adapter.anchor(session.primary);
      if (a && adapter.nudgeY) {
        data.gap = p.y - a.center[1];
        adapter.nudgeY(session.primary, 0.1);
        const b = adapter.anchor(session.primary);
        adapter.nudgeY(session.primary, -0.1);
        const px = b ? a.center[1] - b.center[1] : 0;
        data.k = Math.abs(px) > 0.5 ? 0.1 / px : 0.01;
      }
    }
    if (!anywhere) handles.setActive(handle);
    return { kind: 'group', handle, session, x0: p.x, y0: p.y, data, anywhere };
  };

  const moveGroup = (m: Extract<Mode, { kind: 'group' }>, p: Ptr) => {
    const { session: s, data } = m;
    const ga = groupAnchor(adapter, s.keys, s.primary);
    if (m.anywhere && (m.handle === 'rotate' || m.handle === 'scale')) {
      // The chosen tool dragged anywhere: the drag's own travel, from the press.
      if (m.handle === 'rotate') {
        let d = (p.x - m.x0) * TURN_PER_PX;
        const t = Math.round(d / SNAP) * SNAP;
        if (!p.shift && Math.abs(t - d) <= SNAP_WINDOW) d = t;
        groupRotate(adapter, adapter.dim, s, d, turnWay());
      } else groupScale(adapter, adapter.dim, s, Math.exp((p.x - m.x0 - (p.y - m.y0)) * SIZE_PER_PX), state.scaleMode);
    } else if (m.handle === 'move') groupMove(adapter, adapter.dim, s, p.x - m.x0, p.y - m.y0);
    else if (m.handle === 'rotate' && ga) {
      // The turn centre stays where the group started (s.center): measuring
      // around the moving middle would wobble.
      const ang = Math.atan2(p.y - s.center[1], p.x - s.center[0]);
      data.d = data.d! + wrap(ang - data.angle!);
      data.angle = ang;
      let d = data.d!;
      // 15° steps within ±3° unless Shift, like one object.
      const t = Math.round(d / SNAP) * SNAP;
      if (!p.shift && Math.abs(t - d) <= SNAP_WINDOW) d = t;
      groupRotate(adapter, adapter.dim, s, d, turnWay());
    } else if (m.handle === 'scale') {
      const dist = Math.max(8, Math.hypot(p.x - s.center[0], p.y - s.center[1]));
      groupScale(adapter, adapter.dim, s, dist / data.dist!, state.scaleMode);
    } else if (m.handle === 'lift') {
      const a = adapter.anchor(s.primary);
      if (!a) return;
      const err = a.center[1] - (p.y - data.gap!);
      const dy = Math.max(-5, Math.min(5, err * data.k!));
      if (Math.abs(dy) > 1e-6) groupLift(adapter, s, dy);
    }
    markDirty();
    post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, s, false), press: m.handle });
    const from = s.from.get(s.primary), now = adapter.anchor(s.primary)?.pose;
    if (from && now) handles.readout(readout(m.handle, from, now, canTurn() ? state.axis : 'y'));
  };

  const startHandle = (handle: HandleKind, p: Ptr, anywhere = false): Mode => {
    if (state.group.length > 1) return startGroup(handle, p, anywhere);
    const key = state.selected!;
    const a = adapter.anchor(key);
    if (!a) return { kind: 'none' };
    const from = a.pose;
    const data: Record<string, number> = {};
    if (handle === 'move') {
      if (!adapter.grab(key, p.x, p.y)) return { kind: 'none' };
    } else if (handle === 'rotate') {
      // 3D turns go around the middle of the object's box (adapter.turn): measure the finger around that.
      const r = a.rect;
      data.cx = canTurn() && r ? r.x + r.w / 2 : a.center[0];
      data.cy = canTurn() && r ? r.y + r.h / 2 : a.center[1];
      data.angle = Math.atan2(p.y - data.cy, p.x - data.cx);
      data.sign = 0; // learnt from the first response: +1 if pose.r grows with d
    } else if (handle === 'scale') {
      data.dist = Math.max(8, Math.hypot(p.x - a.center[0], p.y - a.center[1]));
    } else if (handle === 'lift') {
      // Keep the vertical gap between finger and pivot constant. World units
      // per screen px are measured once with a tiny probe move (undone at
      // once), because they depend on distance and camera angle.
      data.gap = p.y - a.center[1];
      const h = 0.1;
      adapter.nudgeY!(key, h);
      const b = adapter.anchor(key);
      adapter.nudgeY!(key, -h);
      const px = b ? a.center[1] - b.center[1] : 0;
      data.k = Math.abs(px) > 0.5 ? h / px : 0.01;
    }
    if (anywhere) {
      data.x0 = p.x;
      data.y0 = p.y;
      data.applied = 0; // turn: the screen angle given so far (the drag sets the total; the adapter takes steps)
    } else handles.setActive(handle);
    return { kind: 'handle', handle, key, from, last: from, data, anywhere };
  };

  const moveHandle = (m: Extract<Mode, { kind: 'handle' }>, p: Ptr) => {
    const { key, data } = m;
    let pose: Pose = m.last;
    if (m.anywhere && m.handle === 'rotate') {
      // Turn by the horizontal travel; 15° steps within ±3° of the gesture's total unless Shift.
      let want = (p.x - data.x0!) * TURN_PER_PX;
      const t = Math.round(want / SNAP) * SNAP;
      if (!p.shift && Math.abs(t - want) <= SNAP_WINDOW) want = t;
      const dd = want - data.applied!;
      if (Math.abs(dd) > 1e-6) {
        pose = canTurn() ? adapter.turn!(key, dd, state.axis) : adapter.rotate(key, dd);
        data.applied = want;
      }
    } else if (m.anywhere && m.handle === 'scale') {
      // Size by the travel right / up (left / down = smaller), as one factor from the start.
      const want = Math.exp((p.x - data.x0! - (p.y - data.y0!)) * SIZE_PER_PX);
      const now = adapter.anchor(key)?.pose;
      const f = now ? want / (sizeOf(now) / sizeOf(m.from)) : 1;
      if (Math.abs(f - 1) > 1e-4) pose = adapter.scale(key, f);
    } else if (m.handle === 'move') {
      pose = adapter.drag(key, p.x, p.y);
    } else if (m.handle === 'rotate') {
      const a = adapter.anchor(key);
      if (!a) return;
      const cx = data.cx ?? a.center[0], cy = data.cy ?? a.center[1];
      const ang = Math.atan2(p.y - cy, p.x - cx);
      const d = wrap(ang - data.angle!);
      data.angle = ang;
      const before = adapter.anchor(key)!.pose.r ?? 0;
      // 3D: around the chosen axis through the box middle; 2D (and adapters without turn): the old way.
      const turnBy = (dd: number) => (canTurn() ? adapter.turn!(key, dd, state.axis) : adapter.rotate(key, dd));
      pose = turnBy(d);
      if (!data.sign && Math.abs(d) > 1e-4) data.sign = Math.sign(wrap((pose.r ?? 0) - before)) * Math.sign(d) || 1;
      // Snap to 15° steps within ±3° unless Shift is held (the vertical turn only: a tip has no "straight"
      // the editor knows of). The snap is applied to the object's own angle; `sign` maps it back to a screen delta.
      if (!p.shift && data.sign && (!canTurn() || state.axis === 'y')) {
        const r = pose.r ?? 0;
        const target = Math.round(r / SNAP) * SNAP;
        const off = target - r;
        if (Math.abs(off) <= SNAP_WINDOW && Math.abs(off) > 1e-6) pose = turnBy(off * data.sign);
      }
    } else if (m.handle === 'scale') {
      const a = adapter.anchor(key);
      if (!a) return;
      const dist = Math.max(8, Math.hypot(p.x - a.center[0], p.y - a.center[1]));
      const f = dist / data.dist!;
      data.dist = dist;
      if (Math.abs(f - 1) > 1e-4) pose = adapter.scale(key, f);
    } else if (m.handle === 'lift') {
      const a = adapter.anchor(key);
      if (!a) return;
      const target = p.y - data.gap!;
      const err = a.center[1] - target; // > 0: object is below where it should be
      const dy = Math.max(-5, Math.min(5, err * data.k!));
      if (Math.abs(dy) > 1e-6) pose = adapter.nudgeY!(key, dy);
    }
    m.last = pose;
    emitMoved(key, pose, { press: m.handle });
    handles.readout(readout(m.handle, m.from, pose, canTurn() ? state.axis : 'y'));
  };

  /** The readout's text: what this drag changed, from the pose before it. */
  const readout = (k: HandleKind, from: Pose, now: Pose, axis: TurnAxis): string => {
    const w = READOUT_WORDS[lang] || READOUT_WORDS.en;
    const sgn = (v: number, dp: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(dp)}`;
    const p0 = from.p, p1 = now.p;
    if (k === 'move') {
      // 3D: on the ground (X, Z, metres); 2D: the game's own x / y.
      const [a, b] = adapter.dim === '3d' ? [0, 2] : [0, 1];
      const dp = adapter.dim === '3d' ? 2 : 0;
      return `${w.move}  ${adapter.dim === '3d' ? 'X' : 'x'} ${sgn((p1[a] ?? 0) - (p0[a] ?? 0), dp)}  ${adapter.dim === '3d' ? 'Z' : 'y'} ${sgn((p1[b] ?? 0) - (p0[b] ?? 0), dp)}`;
    }
    if (k === 'lift') return `${w.lift}  ${sgn((p1[1] ?? 0) - (p0[1] ?? 0), 2)}`;
    if (k === 'rotate') {
      let d: number;
      if (axis === 'y') d = wrap((now.r ?? 0) - (from.r ?? 0));
      else {
        const i = axis === 'x' ? 0 : 1;
        d = wrap((now.t?.[i] ?? 0) - (from.t?.[i] ?? 0));
      }
      const deg = Math.round((d * 180) / Math.PI);
      return `${axis === 'x' ? w.tipX : axis === 'z' ? w.tipZ : w.rotate}  ${deg < 0 ? '−' : ''}${Math.abs(deg)}°`;
    }
    return `${w.scale}  ×${(sizeOf(now) / sizeOf(from)).toFixed(2)}`;
  };

  const endGesture = () => {
    if (mode.kind === 'handle' || mode.kind === 'group') {
      handles.readout(null);
      if (mode.anywhere) hintUsed();
    }
    if (mode.kind === 'group') {
      handles.setActive(null);
      const poses = groupPoses(adapter, mode.session, true);
      if (poses.some((e) => !samePose(e.pose, e.from!))) {
        markDirty();
        post({ type: 'studio:placement/moved-group', poses, end: true, press: mode.handle });
      }
    }
    if (mode.kind === 'handle') {
      const m = mode;
      const pose = adapter.anchor(m.key)?.pose ?? m.last;
      handles.setActive(null);
      if (!samePose(pose, m.from)) emitMoved(m.key, pose, { end: true, from: m.from, press: m.handle });
    }
    mode = { kind: 'none' };
  };

  /** Share of the window (0–1) covered by the object's on-screen part (its box, clipped to the window). */
  const screenShare = (k: string) => {
    // 3D: the adapter's own measure (a ground running on under the camera; see StudioAdapter.coverage).
    try {
      const c = adapter.coverage?.(k);
      if (typeof c === 'number' && Number.isFinite(c)) return c;
    } catch {
      /* fall back to the box */
    }
    const r = adapter.anchor(k)?.rect;
    if (!r) return 0;
    // Clipped: the rect is the projected box, so it runs past the window's edges (see grabbable below).
    const vw = win.innerWidth, vh = win.innerHeight;
    const cw = Math.max(0, Math.min(vw, r.x + r.w) - Math.max(0, r.x));
    const ch = Math.max(0, Math.min(vh, r.y + r.h) - Math.max(0, r.y));
    return vw * vh > 0 ? (cw * ch) / (vw * vh) : 0;
  };
  /** The ground / background (or a huge object): what a person calls "nothing" when tapping (see the header). */
  const background = (k: string) => !!state.items.find((i) => i.key === k)?.backdrop || screenShare(k) >= HUGE_ON_SCREEN;
  /** What a tap at the point may pick, best first: pickNear without the background. */
  const tappable = (p: Ptr, radius: number) => {
    try {
      return adapter.pickNear(p.x, p.y, radius).filter((k) => !background(k));
    } catch {
      return [];
    }
  };

  const tap = (p: Ptr) => {
    const radius = p.type === 'mouse' ? UI.pickRadiusMouse : UI.pickRadiusTouch;
    const keys = tappable(p, radius);
    let key: string | null = keys[0] ?? null;
    // Same spot again: walk to the next candidate (the object behind).
    if (lastTap && Math.hypot(lastTap.x - p.x, lastTap.y - p.y) <= radius && state.selected && keys.includes(state.selected)) {
      key = keys[(keys.indexOf(state.selected) + 1) % keys.length]!;
    }
    lastTap = { x: p.x, y: p.y, key };
    // Shift, or "select several" mode: add or take out one object.
    if (p.shift || state.multi) {
      if (!key) return;
      const has = state.group.includes(key);
      const keys = has ? state.group.filter((k) => k !== key) : [...state.group, key];
      selectMany(keys, has ? (keys[keys.length - 1] ?? null) : key);
      return;
    }
    select(key);
  };

  /**
   * The place's menu at the pointer (see the header): pick what is under it if it is not picked yet (no camera move),
   * then ask the editor page to draw the menu. The strip's own choices close first (one menu at a time).
   */
  const contextAt = (p: Ptr) => {
    if (handles.menuOpen()) menu(null);
    const key = tappable(p, p.type === 'mouse' ? UI.pickRadiusMouse : UI.pickRadiusTouch)[0] ?? null;
    const picked = state.group.length > 1 ? state.group : state.selected ? [state.selected] : [];
    if (key && !picked.includes(key)) select(key);
    // The next plain tap on the same spot should not walk to the object behind (that is for a second LEFT press).
    lastTap = null;
    post({ type: 'studio:placement/context', key, x: p.x, y: p.y, touch: p.type !== 'mouse' });
  };
  // The touch held still for the menu (LONG_PRESS_MS): armed when a plain press starts, checked when it fires.
  let menuTimer = 0;
  const armMenuPress = (id: number) => {
    win.clearTimeout(menuTimer);
    menuTimer = win.setTimeout(() => {
      const p = ptrs.get(id);
      if (!p || ptrs.size !== 1 || mode.kind !== 'pending') return;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) return;
      // Forget the pointer: its release must not also be read as a tap (which would pick or drop the pick again).
      ptrs.delete(id);
      mode = { kind: 'none' };
      contextAt(p);
    }, LONG_PRESS_MS);
  };

  /** Box selection: every listed object whose pivot is inside the band joins the selection. */
  let band: { x: number; y: number; w: number; h: number } | null = null;
  const finishBox = () => {
    const r = band;
    band = null;
    handles.box(null);
    if (!r) return;
    const inBox: string[] = [];
    for (const it of state.items) {
      const a = adapter.anchor(it.key);
      if (!a || !a.visible) continue;
      const [x, y] = a.center;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) inBox.push(it.key);
    }
    if (!inBox.length) return;
    const keys = [...state.group, ...inBox.filter((k) => !state.group.includes(k))];
    selectMany(keys, state.selected && keys.includes(state.selected) ? state.selected : inBox[0]!);
  };
  /** A mouse press that may become a box: Shift or "select several", and nothing (or only the ground) under the pointer. */
  const boxable = (p: Ptr) => {
    if (p.type !== 'mouse' || p.button !== 0 || !(p.shift || state.multi)) return false;
    return tappable(p, UI.pickRadiusMouse).length === 0;
  };
  let boxStart = false;
  /** Tool dragged anywhere: the offset from the pointer to the object's point at the start. */
  let off = { x: 0, y: 0 };

  /** A plain press (no Shift, not picking several) on the picked object, which can be moved and is not huge. */
  const grabbable = (p: Ptr) => {
    if (!state.selected || p.shift || state.multi || (p.type === 'mouse' && p.button !== 0)) return false;
    const picked = state.group.length > 1 ? state.group : [state.selected];
    let under: string[] = [];
    try {
      under = adapter.pickNear(p.x, p.y, p.type === 'mouse' ? 2 : 10);
    } catch {
      return false;
    }
    const k = under.find((u) => picked.includes(u));
    if (!k) return false;
    const it = state.items.find((i) => i.key === k);
    if (!it || it.movable === false || it.backdrop) return false;
    // "Huge" = the part ON SCREEN covers 60 % or more of the window (a ground seen from above the horizon).
    // WHY clipped, and 60 not 40 (W1 merge, 2026-10-17): the rect is the projected box, so it runs past the
    // window's edges. Until W1-1 a pick glided the camera back and the barn of test/studio-unnamed shrank; with the
    // camera kept still, on a phone 390×844 its box is 483 px wide (x −77) = 56 % of the window, 45 % on screen,
    // and a drag on the barn turned the view instead of moving it. A ground plane covers ~75 %+ on screen.
    return screenShare(k) < HUGE_ON_SCREEN;
  };

  const twoFingers = () => {
    const [a, b] = [...ptrs.values()];
    return { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 };
  };

  const onDown = (e: PointerEvent) => {
    const h = handleFromEvent(e);
    block(e);
    // A press with an id we still hold means we missed its release.
    ptrs.delete(e.pointerId);
    // A new touch while nothing is down: clear leftovers from lost releases.
    if (e.pointerType !== 'mouse' && e.isPrimary) ptrs.clear();
    const p: Ptr = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, shift: e.shiftKey, alt: e.altKey,
      menu: e.pointerType === 'mouse' && (e.button === 2 || (MAC && e.button === 0 && e.ctrlKey && !e.metaKey)) };
    ptrs.set(e.pointerId, p);
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* element may not accept capture (e.g. document) */
    }
    if (ptrs.size === 2) {
      win.clearTimeout(menuTimer);
      // Second finger: whatever the first was doing turns into pinch/pan.
      if (mode.kind === 'handle' || mode.kind === 'group') endGesture();
      if (mode.kind === 'rise') riseEnd();
      mode = { kind: 'pinch', ...twoFingers() };
      return;
    }
    if (ptrs.size > 2) return;
    // Camera up / down: one step now, more while held (riseHold), or the drag's travel (onMove). Before the strip and
    // the tool: these buttons belong to the view, whatever is picked or chosen.
    const rd = riseUi?.fromEvent(e);
    if (rd) {
      if (handles.menuOpen()) menu(null);
      const t0 = win.performance.now();
      mode = { kind: 'rise', dir: rd, t0, follow: false };
      riseLast = 0;
      riseUi!.setActive(rd);
      riseBy((rd === 'up' ? 1 : -1) * RISE_STEP * win.innerHeight);
      if (!riseFrame) riseFrame = core.time.raf(riseHold);
      return;
    }
    // The ▾ in the turn / size button's corner: open (or close) its choices; the tool stays as it was.
    const more = moreFromEvent(e);
    if (more && state.selected && hasChoices(more)) {
      toggleMenu(more);
      ptrs.delete(e.pointerId);
      mode = { kind: 'none' };
      return;
    }
    // A choice in the strip's menu (turn axis / resize mode): it is used at once — its tool is chosen and the
    // button wears the choice's picture, so the strip says which way a drag works now.
    const choice = choiceFromEvent(e);
    if (choice) {
      if (choice.kind === 'axis') setAxis(choice.id as TurnAxis);
      else if (choice.kind === 'turn') {
        state.turnMode = choice.id === 'inplace' ? 'inplace' : 'spread';
        handles.setTurnMode(state.turnMode);
      } else {
        state.scaleMode = choice.id === 'inplace' ? 'inplace' : 'spread';
        handles.setScaleMode(state.scaleMode);
      }
      menu(null);
      const k: HandleKind = choice.kind === 'scale' ? 'scale' : 'rotate';
      if (tool !== k) chooseTool(k, 'menu');
      ptrs.delete(e.pointerId);
      mode = { kind: 'none' };
      return;
    }
    if (h && state.selected) {
      mode = startHandle(h, p);
      if (mode.kind === 'none') {
        // The gesture could not start (Move: adapter.grab found no ground under the BUTTON — on Lantern Cove the
        // strip under the lighthouse is over the sea's far edge). The press still chooses the tool, as a tap would;
        // the drag-anywhere start (toolStart) grabs at the object's own point, which works (tool options, 2026-10-18).
        ptrs.delete(e.pointerId);
        chooseTool(h === tool ? null : h, 'strip');
        return;
      }
      const kind = h === 'rotate' ? 'axis' : h === 'scale' ? 'scale' : null;
      if (kind && hasChoices(kind)) armLongPress(e.pointerId, kind);
      return;
    }
    if (handles.menuOpen()) menu(null);
    if (tools.active() && tools.pointer(toolEvent('down', p))) {
      mode = { kind: 'tool' };
      markDirty();
      return;
    }
    // The Mac's Control-click is a right-click here: never a box, a tool drag or a grab (a drag from it looks around).
    boxStart = !p.menu && boxable(p);
    // A chosen tool that can act on the pick: a drag from here uses it (Shift at the press still draws a box from an empty spot).
    toolStart = !p.menu && !boxStart && !!tool && !!state.selected && !looksAround(p) && toolApplies(tool);
    grabStart = !p.menu && !boxStart && !toolStart && grabbable(p);
    mode = { kind: 'pending' };
    // A finger (or pen) held still here opens the place's menu. Not with a game tool (it took the press above).
    if (p.type !== 'mouse' && ptrs.size === 1) armMenuPress(p.id);
  };

  const onMove = (e: PointerEvent) => {
    block(e);
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    // Mouse moving with no button pressed = we missed the release.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      onUp(e);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.shift = e.shiftKey;
    if (mode.kind === 'pinch' && ptrs.size >= 2) {
      const t = twoFingers();
      if (mode.dist > 0 && t.dist > 0) adapter.view.zoom(t.dist / mode.dist, t.cx, t.cy);
      adapter.view.pan(t.cx - mode.cx, t.cy - mode.cy);
      mode = { kind: 'pinch', ...t };
      markDirty();
      return;
    }
    if (mode.kind === 'rise') {
      // Dragged on ↑ / ↓: from the slop on, the camera follows the drag (up = up, the whole travel), held-repeat stops.
      if (!mode.follow && Math.abs(p.y - p.sy) > UI.tapSlopPx) mode.follow = true;
      if (mode.follow) riseBy(-dy);
      return;
    }
    // A tool dragged anywhere reads the pointer shifted onto the object's point (see the start above).
    const v = mode.kind === 'handle' || mode.kind === 'group' ? (mode.anywhere ? { ...p, x: p.x + off.x, y: p.y + off.y } : p) : p;
    if (mode.kind === 'handle') {
      moveHandle(mode, v);
      return;
    }
    if (mode.kind === 'group') {
      moveGroup(mode, v);
      return;
    }
    if (mode.kind === 'pending' && boxStart && Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) mode = { kind: 'box' };
    if (mode.kind === 'box') {
      band = { x: Math.min(p.sx, p.x), y: Math.min(p.sy, p.y), w: Math.abs(p.x - p.sx), h: Math.abs(p.y - p.sy) };
      handles.box(band);
      return;
    }
    if (mode.kind === 'tool') {
      tools.pointer(toolEvent('move', p));
      markDirty();
      return;
    }
    if (mode.kind === 'pending' && toolStart && tool && Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) {
      // The chosen tool, from anywhere: start it at the object's own point on screen so move / height follow
      // the drag's travel (not the pointer's place: the press may be far from the object, even on the sky).
      toolStart = false;
      const k = state.selected!;
      const ga = state.group.length > 1 ? groupAnchor(adapter, state.group, k) : adapter.anchor(k);
      const c = ga ? { x: ga.center[0], y: ga.center[1] } : { x: p.sx, y: p.sy };
      const at: Ptr = { ...p, x: c.x, y: c.y };
      mode = startHandle(tool, at, true);
      if (mode.kind === 'handle' || mode.kind === 'group') {
        handles.setTool(tool);
        // From now on the pointer is read relative to the press, offset onto the object's point.
        off = { x: c.x - p.sx, y: c.y - p.sy };
        if (mode.kind === 'handle') {
          mode.data.x0 = c.x;
          mode.data.y0 = c.y;
        }
        const v = { ...p, x: p.x + off.x, y: p.y + off.y };
        if (mode.kind === 'handle') moveHandle(mode, v);
        else moveGroup(mode, v);
      }
      return;
    }
    if (mode.kind === 'pending' && grabStart && Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) {
      // Dragging the picked object: the move handle's gesture, started where the press was.
      grabStart = false;
      mode = startHandle('move', { ...p, x: p.sx, y: p.sy });
      if (mode.kind === 'handle') moveHandle(mode, p);
      else if (mode.kind === 'group') moveGroup(mode, p);
      return;
    }
    if (mode.kind === 'pending' && Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) {
      // Pan: middle or right button, Shift, or (2D) any drag. 3D left drag orbits.
      // (3D right drag used to orbit too; it pans now, like most 3D editors,
      // since Shift+drag from an empty spot became the box selection.)
      const pan = adapter.dim === '2d' || p.button === 1 || p.button === 2 || p.menu || p.shift || !adapter.view.orbit;
      mode = { kind: 'look', pan };
    }
    if (mode.kind === 'look') {
      // A right-drag while flying looks where the camera stands (the engines' fly mode; see the header).
      if (p.flew && adapter.view.look) adapter.view.look(dx, dy);
      else if (mode.pan) adapter.view.pan(dx, dy);
      else adapter.view.orbit!(dx, dy);
      markDirty();
    }
  };

  const onUp = (e: PointerEvent) => {
    block(e);
    win.clearTimeout(pressTimer);
    win.clearTimeout(menuTimer);
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    if (mode.kind === 'rise') {
      riseEnd();
      mode = { kind: 'none' };
      return;
    }
    // A right-click (no travel): the place's menu instead of a tap (it picks only what is not picked yet).
    if (mode.kind === 'pending' && e.type === 'pointerup') {
      // A right press that flew (WASD held with it) was the engines' fly mode, not a click: no menu.
      if (p.menu) {
        if (!p.flew) contextAt(p);
      } else tap(p);
    }
    if (mode.kind === 'look' || mode.kind === 'pending') {
      post({ type: 'studio:core/view-state', state: adapter.view.state() });
      mode = { kind: 'none' };
    } else if (mode.kind === 'pinch') {
      // Lifting one of two fingers ends the pinch; the remaining finger
      // must not turn into a tap or a look-around.
      if (ptrs.size === 0) {
        post({ type: 'studio:core/view-state', state: adapter.view.state() });
        mode = { kind: 'none' };
      }
    } else if (mode.kind === 'handle' || mode.kind === 'group') {
      // A tap (no drag) on a strip button CHOOSES its tool (tool modes, see the header). On the chosen one
      // again: the others put the tool down; the turn button (3D, or several) and the size button (several)
      // open / close their choices — an unadvertised shortcut only since 2026-10-18 (the ▾ and the long press
      // are the way in; a second press is not something people try, play test 2026-10-18).
      const tap = !mode.anywhere && Math.hypot(p.x - p.sx, p.y - p.sy) <= UI.tapSlopPx;
      const which = mode.handle;
      const single = mode.kind === 'handle';
      endGesture();
      if (tap) {
        const choices = (which === 'rotate' && hasChoices('axis')) || (which === 'scale' && !single && hasChoices('scale'));
        if (which !== tool) chooseTool(which, 'strip');
        else if (choices) toggleMenu(which === 'rotate' ? 'axis' : 'scale');
        else chooseTool(null, 'strip');
      }
    } else if (mode.kind === 'box') {
      finishBox();
      mode = { kind: 'none' };
    } else if (mode.kind === 'tool') {
      tools.pointer(toolEvent('up', p));
      mode = { kind: 'none' };
    }
  };

  const onWheel = (e: WheelEvent) => {
    block(e);
    const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (!e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0.5) {
      // Two-finger trackpad scroll: pan.
      adapter.view.pan(-e.deltaX, -e.deltaY);
    } else {
      // Mouse wheel, or trackpad pinch (reported as ctrl+wheel).
      const k = e.ctrlKey ? 0.01 : 0.0015;
      adapter.view.zoom(Math.exp(-e.deltaY * px * k), e.clientX, e.clientY);
    }
    markDirty();
    post({ type: 'studio:core/view-state', state: adapter.view.state() });
  };

  const onKey = (e: KeyboardEvent) => {
    block(e);
    // Shortcuts that belong to the shell (undo, redo, save, escape...) are
    // forwarded so they work wherever focus is.
    post({ type: 'studio:core/key', key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey });
    flyFast = e.shiftKey;
    // ⌘ / Ctrl / ⌥ with a fly key is a shortcut, not flying; and a Mac sends no keyup for keys let go while ⌘ is
    // down, so whatever was held stops here rather than flying on by itself.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      flyHeld.clear();
      return;
    }
    const key = state.selected;
    // Fly (see the header): before the tool keys (S = Size with a pick) and the turn keys (E / Q), which keep their
    // meaning unless flying is allowed now. Not while typing in one of the game's own fields, nor composing (IME).
    const fk = canFly() && !e.isComposing && !typingIn(e.target) ? flyKeyOf(e) : null;
    if (fk && (flyHeld.has(fk) || flyOk(fk))) {
      if (!flyHeld.has(fk)) {
        flyHeld.add(fk);
        if (!e.repeat) flyBy([fk], FLY_KICK_S, e.shiftKey);
      }
      flyStart();
      return;
    }
    if (e.key === ' ') {
      spaceHeld = true;
      return;
    }
    if (e.key === 'Escape') {
      if (handles.menuOpen()) menu(null);
      else if (tool) chooseTool(null, 'key');
      else select(null);
      return;
    }
    // M / H / T / S: choose the strip's tool (with something picked, as the R key).
    const tk = e.shiftKey ? null : toolFromKey(e.key);
    if (tk && key) {
      chooseTool(tk, 'key');
      return;
    }
    // R: the next turn axis (3D, one or several picked), with the choices shown for a moment of feedback.
    if ((e.key === 'r' || e.key === 'R') && key && canTurn()) {
      setAxis('next');
      if (!handles.menuOpen()) menu('axis');
      return;
    }
    // E / Q: camera up / down with nothing picked (they have no other job then) or while looking around (Space held,
    // a right / middle / ⌥ drag) — the 3D tools' habit. With something picked otherwise they still turn it (keyStep).
    const kl = e.key.toLowerCase();
    // Adapters without fly (rise only) keep the steps.
    if ((kl === 'e' || kl === 'q') && !canFly() && adapter.view.rise && (!key || spaceHeld || mode.kind === 'look' || [...ptrs.values()].some(looksAround))) {
      riseBy((kl === 'e' ? 1 : -1) * (e.shiftKey ? RISE_KEY_STEP / 5 : RISE_KEY_STEP) * win.innerHeight);
      post({ type: 'studio:core/view-state', state: adapter.view.state() });
      return;
    }
    if (!key) return;
    const s = keyStep(e.key, e.shiftKey, adapter.dim);
    if (s) step({ type: 'studio:placement/step', key, ...s, hold: e.repeat, keys: state.group.length > 1 ? state.group.slice() : undefined });
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') spaceHeld = false;
    flyFast = e.shiftKey;
    const fk = flyKeyOf(e);
    if (fk) flyHeld.delete(fk);
  };

  const onBlur = () => {
    spaceHeld = false;
    // The keyups go elsewhere now: stop flying (the next frame sees no key).
    flyHeld.clear();
    // Do NOT clear pointers here (see the header comment). Only stop showing
    // a pressed handle; the gesture itself continues if the finger is down.
    handles.setActive(mode.kind === 'handle' || mode.kind === 'group' ? mode.handle : null);
  };

  // The name tag over the picked object shows only while the mouse is over it (design review wave 1, W1-2 / N3, 2026-10-17).
  // WHY: picking put the same name on screen four times (the tag on the object, the list row, the card, the ask box's
  // chip); the card is what names it. On touch there is no hover, so no tag at all. `hover` = the mouse over the game
  // with no button down (null = gone / touch).
  // `armed`: the mouse has been off the picked object since it was picked. The click that picks leaves the mouse on
  // the object; without this the tag came back the same instant, which is "a tag when picked" again.
  let hover: { x: number; y: number } | null = null;
  let hoverIn = false;
  let armed = false;
  const inRects = (rs: Array<{ x: number; y: number; w: number; h: number }>) =>
    armed && !!hover && rs.some((r) => hover!.x >= r.x && hover!.x <= r.x + r.w && hover!.y >= r.y && hover!.y <= r.y + r.h);
  const selectionRects = () => rectsOf(state.group.length > 1 ? state.group : state.selected ? [state.selected] : []);
  const onHover = (e: PointerEvent) => {
    hover = e.pointerType === 'mouse' && e.buttons === 0 ? { x: e.clientX, y: e.clientY } : null;
    if (hover && !armed) {
      armed = true;
      if (inRects(selectionRects())) armed = false; // still on it: wait until it leaves
    }
    const now = inRects(selectionRects());
    if (now !== hoverIn) {
      hoverIn = now;
      markDirty();
    }
  };
  const onLeave = (e: PointerEvent) => {
    if (e.relatedTarget) return;
    hover = null;
    if (hoverIn) {
      hoverIn = false;
      markDirty();
    }
  };
  win.addEventListener('pointerdown', onDown, opts);
  // Before onMove: its block() stops the other listeners on window.
  win.addEventListener('pointermove', onHover, opts);
  win.addEventListener('pointermove', onMove, opts);
  win.addEventListener('pointerout', onLeave, opts);
  win.addEventListener('pointerup', onUp, opts);
  win.addEventListener('pointercancel', onUp, opts);
  win.addEventListener('wheel', onWheel, opts);
  win.addEventListener('keydown', onKey, opts);
  win.addEventListener('blur', onBlur, opts);
  // Before the blocking listener for keyup (it stops the others on window): Space let go ends "Space held".
  win.addEventListener('keyup', onKeyUp, opts);
  for (const t of blocked) win.addEventListener(t, block, opts);

  // Pictures of the originals for stand-in copies, one capture per original.
  const ghostPics = new Map<string, { src: string | null; w: number; h: number; r: number; s: number } | 'wait'>();
  const drawGhosts = () => {
    const list = edits.ghosts();
    if (!list.length) {
      handles.ghosts([]);
      return;
    }
    const out: Parameters<Handles['ghosts']>[0] = [];
    for (const g of list) {
      let pic = ghostPics.get(g.src);
      if (!pic) {
        ghostPics.set(g.src, 'wait');
        const a = adapter.anchor(g.src);
        const r = a?.rect;
        const s0 = Array.isArray(a?.pose.s) ? a!.pose.s[0] ?? 1 : (a?.pose.s as number | undefined) ?? 1;
        void edits.capture(g.src, { size: 256 }).then((c) => {
          ghostPics.set(g.src, { src: c.ok && c.dataUrl ? c.dataUrl : null, w: r?.w ?? 40, h: r?.h ?? 40, r: a?.pose.r ?? 0, s: s0 });
          markDirty();
        }, () => ghostPics.set(g.src, { src: null, w: r?.w ?? 40, h: r?.h ?? 40, r: 0, s: 1 }));
        continue;
      }
      if (pic === 'wait') continue;
      const a = adapter.anchor(g.key);
      if (!a || !a.visible) continue;
      const s1 = Array.isArray(g.pose.s) ? g.pose.s[0] ?? 1 : g.pose.s ?? 1;
      const k = pic.s ? s1 / pic.s : 1;
      if (adapter.dim === '2d') {
        // The picture of the original, turned and sized by the copy's own change.
        const cx = a.rect ? a.rect.x + a.rect.w / 2 : a.center[0];
        const cy = a.rect ? a.rect.y + a.rect.h / 2 : a.center[1];
        out.push({ key: g.key, cx, cy, w: pic.w * k, h: pic.h * k, rot: (g.pose.r ?? 0) - pic.r, src: pic.src });
      } else if (a.rect) {
        out.push({ key: g.key, cx: a.rect.x + a.rect.w / 2, cy: a.rect.y + a.rect.h / 2, w: a.rect.w, h: a.rect.h, rot: 0, src: pic.src });
      }
    }
    handles.ghosts(out);
  };

  // The outlines: the shape from adapter.silhouette when it has one (three),
  // drawn again only when something it depends on changed and at most every
  // 40 ms (it costs extra renders); a rounded box per object otherwise.
  const shapes = { you: { sig: '', at: 0, shape: null as Outline | null }, ai: { sig: '', at: 0, shape: null as Outline | null } };
  let aiKeys: string[] = [];
  let aiLabel: string | null = null;
  const shapeOf = (which: 'you' | 'ai', keys: string[], rects: Array<{ x: number; y: number; w: number; h: number }>) => {
    const c = shapes[which];
    if (!adapter.silhouette || !keys.length) {
      c.sig = '';
      c.shape = null;
      return null;
    }
    const sig = keys.join('\n') + '|' + rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`).join(';') + '|' + JSON.stringify(adapter.view.state());
    const now = win.performance.now();
    if (sig !== c.sig && now - c.at > 40) {
      try {
        c.shape = adapter.silhouette(keys);
      } catch {
        c.shape = null;
      }
      c.sig = sig;
      c.at = now;
    } else if (sig !== c.sig) markDirty(); // come back next frame for the late update
    return c.shape;
  };
  const rectsOf = (keys: string[]) => {
    const out: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const k of keys) {
      const a = adapter.anchor(k);
      if (a && a.visible && a.rect) out.push(a.rect);
    }
    return out;
  };

  const place = () => {
    drawGhosts();
    showAxis();
    // The ▾ on the turn / size buttons: only while they have choices (it sits inside the button: the strip never moves).
    handles.setOptions({ axis: hasChoices('axis'), scale: hasChoices('scale'), axes: canTurn(), several: state.group.length > 1 }, lang);
    const key = state.selected;
    // The AI's marks first (under your own): what is picked is drawn in your colour only.
    const aiShown = aiKeys.filter((k) => !(key && (state.group.includes(k) || k === key)) && state.items.some((i) => i.key === k));
    const aiRects = rectsOf(aiShown);
    handles.ai(shapeOf('ai', aiShown, aiRects), aiRects, aiShown.length ? aiLabel : null);
    if (key && state.group.length > 1) {
      const items = state.items.filter((i) => state.group.includes(i.key));
      const keys = items.map((i) => i.key);
      const rects = rectsOf(keys);
      handles.selection(shapeOf('you', keys, rects), rects, inRects(rects) ? (MANY_LABEL[lang] || MANY_LABEL.en)(items.length) : null);
      const ga = groupAnchor(adapter, state.group, key);
      handles.place(ga, items.length ? {
        rotatable: items.some((i) => i.rotatable), scalable: items.some((i) => i.scalable),
        movable: items.some((i) => i.movable !== false), liftable: items.some((i) => i.liftable !== false && i.movable !== false),
      } : null, adapter.dim);
      return;
    }
    const a = key ? adapter.anchor(key) : null;
    const item = key ? state.items.find((i) => i.key === key) : undefined;
    const rects = a && a.visible && a.rect ? [a.rect] : [];
    // No tag for an object without a name: its label is its key (`path:3/0`), an inner handle a person must never see
    // (dogfood 2026-10-17, U4). The card names it ("Unnamed shape"). inRects: the tag shows only on hover (Ive wave 1, W1-2).
    handles.selection(item ? shapeOf('you', [key!], rects) : null, item ? rects : [], item && a?.visible && inRects(rects) && !item.unstable ? item.label : null);
    handles.place(a, item ? { rotatable: item.rotatable, scalable: item.scalable, movable: item.movable !== false, liftable: item.liftable !== false } : null, adapter.dim);
  };

  return {
    frame: place,
    selectionChanged() {
      riseLabels();
      if (handles.menuOpen()) menu(null);
      armed = false;
      hoverIn = false;
      place();
    },
    setAxis(ax) {
      if (!state.selected || !canTurn()) return;
      setAxis(ax);
      // The R key from the editor page: show the choices too, as the R key in the game does.
      if (!handles.menuOpen()) menu('axis');
    },
    setTool(k) {
      chooseTool(k, 'shell');
    },
    closeMenu() {
      if (handles.menuOpen()) menu(null);
    },
    setLook(on) {
      spaceHeld = !!on;
    },
    setFly(keys, fast) {
      if (!canFly()) return;
      const next = keys.filter((k): k is FlyKey => k in FLY_DIRS);
      // A key just pressed in the shell moves at once, as in the game page (FLY_KICK_S).
      const fresh = next.filter((k) => !shellFly.includes(k));
      shellFly = next;
      shellFast = !!fast;
      if (fresh.length) flyBy(fresh, FLY_KICK_S, shellFast, true);
      if (next.length) flyStart();
    },
    setHandleSize(px) {
      handles.setSize(px);
      riseUi?.setSize(px);
      place();
    },
    setTheme(theme) {
      handles.setTheme(theme);
      riseUi?.setTheme(theme);
    },
    setInset(inset) {
      handles.setInset(inset);
      riseUi?.setInset(inset);
      place();
    },
    setAiMarks(keys, label) {
      aiKeys = keys.slice();
      aiLabel = label;
      shapes.ai.sig = '';
      place();
    },
    setLang(l) {
      lang = l;
      handles.setLabels(HANDLE_LABELS[lang] || HANDLE_LABELS.en);
      riseLabels();
      axisShown = null;
      showAxis();
    },
    detach() {
      endGesture();
      win.clearTimeout(pressTimer);
      win.clearTimeout(menuTimer);
      win.removeEventListener('pointerdown', onDown, opts);
      win.removeEventListener('pointermove', onMove, opts);
      win.removeEventListener('pointermove', onHover, opts);
      win.removeEventListener('pointerout', onLeave, opts);
      win.removeEventListener('pointerup', onUp, opts);
      win.removeEventListener('pointercancel', onUp, opts);
      win.removeEventListener('wheel', onWheel, opts);
      win.removeEventListener('keydown', onKey, opts);
      win.removeEventListener('blur', onBlur, opts);
      win.removeEventListener('keyup', onKeyUp, opts);
      win.clearTimeout(hintTimer);
      for (const t of blocked) win.removeEventListener(t, block, opts);
      handles.destroy();
      if (riseFrame) core.time.cancelRaf(riseFrame);
      if (flyFrame) core.time.cancelRaf(flyFrame);
      riseUi?.destroy();
      doc.documentElement.style.touchAction = prevTouchAction;
    },
  };
}
