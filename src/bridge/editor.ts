// Edit session inside the game page: applies shell messages to the adapter,
// runs the studio's own draw loop while the game is frozen, and reports
// changes back. Pointer gestures and handles are attached by input.ts.
import { UI, type BridgeToShell, type EditLayer, type GameTool, type GroupScaleMode, type Inset, type Item, type Lang, type Pose, type ShellToBridge, type StudioAdapter, type TurnAxis } from '../contract.ts';
import type { Core } from '../core/index.ts';
import { withRules, type RulesHolder } from '../core/rules.ts';
import { withEdits } from '../core/edits.ts';
import { beginGroup, groupAnchor, groupLift, groupMove, groupPoses, groupRotate, groupScale, groupShift, type GroupSession } from './group.ts';
import { createToolHost } from './game-tools.ts';
import { attachInput, tappableAt, type InputHandle } from './input.ts';
import type { EarlyTaps } from './early-press.ts';
import { firstToTouch, stepDetent } from './snap.ts';
import { createHoldState, withHold } from './hold.ts';
import { drivenBetween, WATCH_MS } from './observe.ts';
import { runSelfCheck } from './selfcheck.ts';

export interface EditorDeps {
  /** The world's adapter as found (self-check runs on it, before game rules); null = an HTML-only game (UI only). */
  adapter: StudioAdapter | null;
  /**
   * UI stage 1: the UI layer's adapter (bridge findUi), or null/absent — then the editor is exactly what it was:
   * one adapter, no core/ready `layers`, no core/layer.
   */
  ui?: StudioAdapter | null;
  /** Game rules (.studio/studio.json via the shell) and .studio/tools.js extensions. */
  rules: RulesHolder;
  /** Game tools registered so far (more may arrive later through register()). */
  tools: GameTool[];
  core: Core;
  win: Window & typeof globalThis;
  post: (msg: BridgeToShell) => void;
  /** Taps made in the game before the editor was ready (early-press.ts): the first begin picks what the last one was on. */
  earlyTaps?: EarlyTaps;
}

export interface Editor {
  handle(msg: ShellToBridge): void;
  /** Tools registered after the editor started (late studio.extend calls). */
  addTools(tools: GameTool[]): void;
  /** The adapter as the editor drives it now (copies/deletions and game rules applied; the current layer's), for the debug peek. */
  readonly driven: StudioAdapter;
  /** The layer being edited (UI stage 1). */
  layer(): EditLayer;
  /** Tell the shell which adapter it is talking to (core/ready), as the bridge does once when the editor is made. */
  announce(): void;
}

/** Shared state between the editor and the input layer. */
export interface EditState {
  editing: boolean;
  /** The object the card shows (and, alone, the one the handles move). */
  selected: string | null;
  /** The whole selection, `selected` included; more than one = the handles move them together. */
  group: string[];
  /** "Select several" mode from the shell: a press adds/removes instead of replacing. */
  multi: boolean;
  items: Item[];
  /** 3D, one object: the axis the turn button uses (y turn, x tip forward, z tip sideways). */
  axis: TurnAxis;
  /** Several objects: how the size button resizes them (the gaps grow too, or each in place). */
  scaleMode: GroupScaleMode;
  /** Several objects: how the turn button turns them (together round the middle, or each in place; 2026-10-18). */
  turnMode: GroupScaleMode;
}

export function createEditor(deps: EditorDeps): Editor {
  const { core, win } = deps;
  // Every edit goes through the copy/delete layer, the game rules layer and what the editor holds still (the ground,
  // what the game moves itself: hold.ts); the adapter itself is unaware of all three.
  // UI stage 1 (2026-10-19): one such stack per layer — the world's, and the UI's (no game rules: .studio/studio.json
  // speaks of world objects; no hold either: grounds and the game's own motion are world things) — and `raw` /
  // `edits` / `adapter` are the current layer's. Everything below reads those three names when it runs, so switching
  // layers (setLayer) is: input off, swap the three, input on. One layer at a time keeps input.ts / handles.ts as they
  // are (the design's "switch, don't merge" for stages 1–3).
  // merge of 2026-10-19: the hold layer (fb-safe) sits on top of the world's stack only; the watch of the game
  // (watchGame) reads and puts back the world's `ruled`, whichever layer is being edited.
  type Stack = { raw: StudioAdapter; edits: ReturnType<typeof withEdits>; ruled: StudioAdapter; driven: StudioAdapter };
  const hold = createHoldState();
  const stackOf = (a: StudioAdapter, rules: RulesHolder, held: boolean): Stack => {
    const e = withEdits(a);
    const ruled = withRules(e, rules);
    return { raw: a, edits: e, ruled, driven: held ? withHold(ruled, hold) : ruled };
  };
  const world: Stack | null = deps.adapter ? stackOf(deps.adapter, deps.rules, true) : null;
  const uiStack: Stack | null = deps.ui ? stackOf(deps.ui, { config: null, ext: [] }, false) : null;
  let layer: EditLayer = world ? 'world' : 'ui';
  const first = (world || uiStack)!;
  let raw = first.raw;
  let edits = first.edits;
  let adapter = first.driven;
  // The world's edit camera while the UI is edited (the UI has no camera: the world shows the player's view then).
  let worldView: unknown = undefined;
  // While the game is watched (watchGame): the last pose the editor itself gave each world object (a saved placement
  // re-applied, a drag), so those are neither taken for the game's motion nor undone when the watch ends.
  let watchBase: Map<string, Pose> | null = null;
  const watchSet = new Set<string>(); // the keys the editor posed during the watch: put back after watch(false)
  const post = (msg: BridgeToShell) => {
    // Only the world's moves: a UI key posed meanwhile is not a world object to put back (merge of 2026-10-19).
    if (watchBase && layer === 'world') {
      if (msg.type === 'studio:placement/moved') (watchBase.set(msg.key, msg.pose), watchSet.add(msg.key));
      else if (msg.type === 'studio:placement/moved-group') for (const m of msg.poses) (watchBase.set(m.key, m.pose), watchSet.add(m.key));
    }
    deps.post(msg);
  };
  const state: EditState = { editing: false, selected: null, group: [], multi: false, items: [], axis: 'y', scaleMode: 'spread', turnMode: 'spread' };
  let lang: Lang = 'en';
  let loopId = 0;
  let dirtyFrame = true;
  let input: InputHandle | null = null;
  let checked = false;
  let pendingHandlePx = 0;
  // Viewport px the shell's floating panels cover (core/ui inset), and the AI's last marks.
  let inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
  let theme: 'dark' | 'light' = 'dark';
  let aiMarks: { keys: string[]; label: string | null } = { keys: [], label: null };
  // The game's UI shown (faded) while the world is edited: the shell's eye button (core/ui-peek). Off = hidden, the
  // default every time the editor opens (paintLayers).
  let uiPeek = false;
  // Step runs (keyboard/button repeats) fold into one undo step: remember the
  // pose before the run and close it when a non-hold step arrives or after a
  // quiet gap.
  let stepRun: { key: string; from: Pose; op: string; timer: number; group?: GroupSession; total: number; dx: number; dy: number } | null = null;

  const refreshItems = () => {
    try {
      state.items = adapter.list();
    } catch (e) {
      post({ type: 'studio:core/error', message: `list() failed: ${(e as Error).message}` });
      state.items = [];
    }
    post({ type: 'studio:placement/items', items: state.items, ...itemsLayer() });
  };
  /** placement/items' `layer`, only for a game that has a UI (otherwise the message is what it always was). */
  const itemsLayer = (): { layer?: EditLayer } => (uiStack ? { layer } : {});
  /** The view state goes to the shell (kept for the next reload) only for the world: the UI has no camera. */
  const postView = () => {
    if (layer === 'world') post({ type: 'studio:core/view-state', state: adapter.view.state() });
  };
  const ready = () => {
    post({ type: 'studio:core/ready', kind: adapter.kind, dim: adapter.dim, version: adapter.version, editing: state.editing, rise: adapter.dim === '3d' && !!adapter.view.rise, fly: adapter.dim === '3d' && !!adapter.view.fly,
      drop: adapter.dim === '3d' && !!adapter.drop,
      ...(uiStack ? { layers: (world ? ['world', 'ui'] : ['ui']) as EditLayer[], layer } : {}) });
  };
  /**
   * Which layer can be touched, by brightness alone (design §2.3 ③): editing the UI dims the world 15 %; editing the
   * world HIDES the UI (a try of the editor, 2026-10-20, "the UI is always there, in the way": the title, the Start button and the
   * score sat over the trees and lanterns, faded to half, hard to see past and to click past). The shell's eye button
   * (⇧U, core/ui-peek) shows it again faded to half, as before. Hidden or faded, the UI takes no pointer then
   * (`pointer-events: none` on it and inside it), so a click on a title selects the tree behind it and the game's
   * buttons show no hover. A style sheet in the game page while editing, gone at the end (Play shows the game as it
   * is). `filter`, not `opacity` / `visibility`: it multiplies with the game's own opacity (a hidden overlay at 0
   * stays hidden) and a child's own `visibility: visible` cannot bring it back. Only when the game has both layers.
   */
  const paintLayers = () => {
    if (!uiStack || !world) return;
    const doc = win.document;
    let el = doc.getElementById('studio-edit-layer') as HTMLStyleElement | null;
    if (!state.editing) {
      el?.remove();
      return;
    }
    if (!el) {
      el = doc.createElement('style');
      el.id = 'studio-edit-layer';
      (doc.head || doc.documentElement).appendChild(el);
    }
    const top = '[data-studio-key]:not([data-studio-key] [data-studio-key])';
    el.textContent = layer === 'ui'
      ? 'canvas:not([data-studio-key]){filter:brightness(.85)}'
      : `${top}{filter:opacity(${uiPeek ? '.5' : '0'})}[data-studio-key],[data-studio-key] *{pointer-events:none!important}`;
  };

  const frame = () => {
    loopId = core.time.raf(frame);
    if (!state.editing) return;
    // Redraw every frame while editing: cheap for edit scenes, and it keeps
    // the picture correct when an engine re-uploads textures lazily.
    try {
      adapter.render();
      // On the UI layer the world still needs drawing (a 2D world draws only when asked while time is frozen).
      if (world && adapter !== world.driven) world.driven.render();
    } catch {
      /* keep the loop alive; the error was reported when it first happened */
    }
    input?.frame();
    toolHost.frame();
    dirtyFrame = false;
  };

  // eslint-disable-next-line prefer-const -- assigned once below, used by closures declared first
  let toolHost: ReturnType<typeof createToolHost>;
  const postSelected = () => {
    const item = state.items.find((i) => i.key === state.selected);
    post({ type: 'studio:placement/selected', key: state.selected, item, keys: state.group.slice() });
  };
  /**
   * Picked from the list: bring the object into view ONLY if it is not
   * already there (design pass "apple", reviews 2026-10-16). Before, every
   * list pick centred the object, so a 2D game that fits the frame slid
   * sideways and lost its edges, the first pick in "Select" mode pushed the
   * rest of the group out of view, and nothing put the view back. Picking
   * in the game never moved the view; now the list behaves the same while
   * the object is on screen. "On screen" = the object's box (and the row of
   * handles under it) inside the game frame with a small margin; on a phone
   * the frame is what is above the sheet (the sheet resizes the frame, it is
   * not drawn over it). While "Select" (several) is on, the view never moves:
   * picking several is done while looking at the whole scene.
   */
  const FOCUS_MARGIN = 12;
  const HANDLE_ROW = 64; // the handles sit under the object (bridge/handles.ts)
  const inView = (key: string) => {
    const a = adapter.anchor(key);
    if (!a || !a.visible) return false;
    // The free part of the frame: the shell's floating panels (inspector card, ask bar) cover the rest.
    const r = a.rect ?? { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
    const x0 = inset.left, y0 = inset.top;
    // The card covers the top right corner only (rightTo): an object below it is not hidden by it.
    const right = inset.rightTo === undefined || r.y < inset.rightTo ? inset.right : 0;
    const w = window.innerWidth - right, h = window.innerHeight - inset.bottom;
    // Bigger than the frame (a ground, a sky): in view when its middle is.
    if (r.w > w - x0 - 2 * FOCUS_MARGIN || r.h > h - y0 - 2 * FOCUS_MARGIN) return a.center[0] > x0 && a.center[0] < w && a.center[1] > y0 && a.center[1] < h;
    return r.x >= x0 + FOCUS_MARGIN && r.y >= y0 + FOCUS_MARGIN && r.x + r.w <= w - FOCUS_MARGIN && r.y + r.h + Math.min(HANDLE_ROW, (h - y0) / 4) <= h;
  };
  /**
   * The free part of the frame (what no floating panel covers) for an object
   * whose box top is at `y`.
   */
  const freeArea = (y: number) => {
    const right = inset.rightTo === undefined || y < inset.rightTo ? inset.right : 0;
    return { x0: inset.left, y0: inset.top, x1: window.innerWidth - right, y1: window.innerHeight - inset.bottom };
  };
  /**
   * Slide the view (pan only, no zoom or turn) by the least that puts the
   * object's box and its strip inside the free part of the frame (2026-10-16,
   * tool modes pass). WHY: the adapters' view.focus centres in the WHOLE
   * frame; on a phone with the list sheet open (and the card over it) the
   * centre is under the sheet, so the picked object and its strip stayed
   * hidden (ive-finish.md §7, studio-fit on the phone). pan() is exact for
   * 2D and close for 3D (it moves the ground under the finger), so a few
   * measured steps converge.
   */
  const slideIntoFree = (key: string) => {
    for (let i = 0; i < 6; i++) {
      const a = adapter.anchor(key);
      if (!a || !a.visible) return false;
      const r = a.rect ?? { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
      const f = freeArea(r.y);
      const room = f.y1 - f.y0;
      const strip = Math.min(HANDLE_ROW, room / 4);
      const fit = (lo: number, hi: number, a0: number, a1: number) => {
        // Too big for the room: its middle to the room's middle. Otherwise the least move that fits it.
        if (a1 - a0 > hi - lo) return (lo + hi) / 2 - (a0 + a1) / 2;
        if (a0 < lo) return lo - a0;
        if (a1 > hi) return hi - a1;
        return 0;
      };
      const dx = fit(f.x0 + FOCUS_MARGIN, f.x1 - FOCUS_MARGIN, r.x, r.x + r.w);
      const dy = fit(f.y0 + FOCUS_MARGIN, f.y1 - FOCUS_MARGIN, r.y, r.y + r.h + strip);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return true;
      adapter.view.pan(dx, dy);
    }
    return inView(key);
  };
  /**
   * Picking never moves the camera (design review wave 1, W1-1 / M3 / U5, 2026-10-17): "the view belongs to whoever made the
   * game; the tool doesn't move it by itself". Before, the first pick glided the 3D camera up to a 30° editing angle
   * (the lighthouse became a 30 px dot under the sky), the phone's sheet and ⌘K list slid or pulled the view each time
   * they opened, and a list pick re-framed with a zoom. Now the ONE case that moves it: a pick from the list (`focus`)
   * of an object that is not in the seen part of the frame — then, in 0.35 s, the least sideways slide (pan only: no
   * turn, no zoom) that puts it (and its strip) inside the middle 60 % of that part.
   */
  const CENTRE = 0.6; // 0.6 = the middle 60 % of the seen part (the review's number); 1.0 = just inside the edges
  const GLIDE_MS = 350;
  let panGlide = 0;
  // The last pick from the list and when (see core/ui below): the card that the pick brings can make a phone's sheet
  // taller a moment later and cover the object the person just asked to see.
  let listPick: { key: string; at: number } | null = null; // the running slide's generation (0 = none); a new pick stops the old one where it is
  /**
   * The least pan that brings `key` into the middle part, measured step by step: sideways first, then up / down.
   * WHY measured, one axis at a time (found while writing W1-1, Lantern Cove's opening view, 2° down): pan() moves the
   * ground at the point the camera turns round, so an object nearer than that point moves more (a pine moved ~1.8 px
   * per px and overshot to the far side), and "up the screen" from a near-level view carries the ground tens of metres
   * while things near the horizon hardly rise — and slide sideways as they come closer. So each axis takes steps of
   * (what is still needed ÷ how far the last step moved it per px); an up / down step that does not help, or that pushes
   * the object back out sideways, is taken back and the slide stops there (sideways is the part that always works).
   */
  const panIntoMiddle = (key: string): [number, number] | null => {
    const need = () => {
      const a = adapter.anchor(key);
      if (!a || !a.visible) return null;
      const r = a.rect ?? { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
      const f = freeArea(r.y);
      const mx = ((f.x1 - f.x0) * (1 - CENTRE)) / 2, my = ((f.y1 - f.y0) * (1 - CENTRE)) / 2;
      const strip = Math.min(HANDLE_ROW, (f.y1 - f.y0) / 4);
      const fit = (lo: number, hi: number, a0: number, a1: number) => {
        if (a1 - a0 > hi - lo) return (lo + hi) / 2 - (a0 + a1) / 2;
        if (a0 < lo) return lo - a0;
        if (a1 > hi) return hi - a1;
        return 0;
      };
      return [fit(f.x0 + mx, f.x1 - mx, r.x, r.x + r.w), fit(f.y0 + my, f.y1 - my, r.y, r.y + r.h + strip)] as [number, number];
    };
    if (!need()) return null;
    const total: [number, number] = [0, 0];
    for (const ax of [0, 1, 0] as const) {
      let gain = 1; // screen px the object moved per px of pan, measured (may be negative, see below)
      let scale = 0.5; // the share of the measured need a step asks for: half at first (gain unknown), then all
      for (let i = 0; i < 8; i++) {
        const d = need();
        if (!d || Math.abs(d[ax]) < 1) break;
        const step = (d[ax] / gain) * scale;
        const before = adapter.anchor(key)?.center;
        adapter.view.pan(ax ? 0 : step, ax ? step : 0);
        const after = need();
        const now = adapter.anchor(key)?.center;
        const g = before && now ? (now[ax] - before[ax]) / step : NaN;
        const usable = Math.abs(g) > 0.05 && Math.abs(g) < 5;
        // Up / down may push it a little sideways (it comes nearer off the middle): up to 15 % of the width, put right by
        // the last sideways pass below.
        const worse = !after || Math.abs(after[ax]) > Math.abs(d[ax]) * 0.95 || (ax === 1 && Math.abs(after[0]) > Math.abs(d[0]) + win.innerWidth * 0.15);
        if (worse) {
          adapter.view.pan(ax ? 0 : -step, ax ? -step : 0); // linear in both adapters: exactly back
          // It went the other way (3D, up / down: an object between the camera and the point it turns round moves
          // against the ground, Lantern Cove's lighthouse on a phone): the measured sign, half steps. Too far (out of
          // sight, or past the place): a smaller step. Neither helps after a few tries: stop where it is.
          if (usable && g * gain < 0) gain = g;
          scale /= 2;
          if (scale < 0.05) break;
          continue;
        }
        total[ax] += step;
        if (usable) gain = g;
        scale = Math.min(1, scale * 2);
      }
    }
    return total;
  };
  const focusIfHidden = (key: string) => {
    if (state.multi || inView(key)) return;
    const gen = ++panGlide;
    const from = adapter.view.state();
    const total = panIntoMiddle(key);
    if (!total) {
      // Not drawn at all from here (behind the camera, hidden): the adapter's focus is the only way to show it.
      // Rare (a list pick of something behind you); it frames the object like before.
      adapter.view.focus(key);
      slideIntoFree(key);
      postView();
      return;
    }
    if (!adapter.view.restore) {
      postView();
      return; // no way back to the start: the slide happens at once
    }
    // Back to where it was, then the same slide over 0.35 s (ease out), as pan() steps that add up to `total`.
    adapter.view.restore(from);
    const t0 = win.performance.now();
    let done = 0;
    const tick = () => {
      if (gen !== panGlide || !state.editing) return;
      const t = Math.min(1, (win.performance.now() - t0) / GLIDE_MS);
      const e = 1 - (1 - t) ** 3;
      adapter.view.pan(total[0] * (e - done), total[1] * (e - done));
      done = e;
      dirtyFrame = true;
      if (t < 1) core.time.raf(tick);
      else {
        panGlide = 0;
        postView();
      }
    };
    core.time.raf(tick);
  };
  // List thumbnails waiting to be drawn (placement/thumbs), newest request first.
  let thumbQueue: Array<{ key: string; size: number }> = [];
  let thumbRunning = false;
  // One picture per turn of the page's event loop, each after the next painted frame (speed pass, 2026-10-17).
  // WHY: capture() is synchronous and `await` alone only yields a microtask, so the whole queue used to run as ONE
  // task. The game, the bridge and the shell share a thread, so nothing painted until every picture was drawn:
  // on a slow GPU (SwiftShader in the play test) the list of Lantern Cove appeared 4.8 s after it was ready, and
  // the shell's second request (the rows in view) arrived after the queue had emptied, so all 15 were drawn twice.
  // Now the list and the editor's first frame paint first, the pictures fill in one by one, and a request that
  // arrives meanwhile is merged with what is still queued.
  const nextTurn = () => new Promise<void>((r) => core.time.raf(() => win.setTimeout(r, 0)));
  const drawThumbs = async () => {
    thumbRunning = true;
    try {
      for (let q = (await nextTurn(), thumbQueue.shift()); q; q = (await nextTurn(), thumbQueue.shift())) {
        let src: string | null = null;
        try {
          const r = await adapter.capture(q.key, { size: q.size });
          if (r.ok && r.dataUrl && r.dataUrl.startsWith('data:image/png;base64,')) src = r.dataUrl;
        } catch {
          /* no thumbnail: the shell shows a placeholder */
        }
        post({ type: 'studio:placement/thumb', key: q.key, src, size: q.size });
      }
    } finally {
      thumbRunning = false;
    }
  };
  // (W1-1: the frame changing size — the phone's sheet, the caption line — no longer slides the view to keep the pick
  // in sight. It did, and every sheet / ⌘K list opening moved the camera; the person's view stays theirs.)
  // (W1-1: the first pick's glide from the opening view up to a 30° editing angle — adapter view.settle, polish pass
  // 2026-10-16 — is gone. It was the "camera flies into the sky" of review photo 02 / 12. The adapters keep settle();
  // the editor no longer calls it. ⌘K "Back to the opening view" still glides home.)
  const select = (key: string | null, focus = false) => {
    state.selected = key && state.items.some((i) => i.key === key) ? key : null;
    state.group = state.selected ? [state.selected] : [];
    if (state.selected && focus) {
      focusIfHidden(state.selected);
      listPick = { key: state.selected, at: win.performance.now() };
    } else {
      panGlide = 0;
      listPick = null;
    }
    input?.selectionChanged();
    postSelected();
  };
  const selectMany = (keys: string[], primary: string | null, focus = false) => {
    const known = new Set(state.items.map((i) => i.key));
    state.group = [...new Set(keys)].filter((k) => known.has(k));
    state.selected = primary && state.group.includes(primary) ? primary : (state.group[state.group.length - 1] ?? null);
    if (state.selected && focus && state.group.length === 1) focusIfHidden(state.selected);
    input?.selectionChanged();
    postSelected();
  };

  const poseOf = (key: string): Pose | null => {
    const it = adapter.list().find((i) => i.key === key);
    return it ? it.pose : null;
  };

  const closeStepRun = () => {
    if (!stepRun) return;
    win.clearTimeout(stepRun.timer);
    const { key, from, op, group } = stepRun;
    stepRun = null;
    if (group) {
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, group, true), end: true, press: pressOf(op), hold: true });
      return;
    }
    const pose = poseOf(key);
    if (pose) post({ type: 'studio:placement/moved', key, pose, end: true, from, press: pressOf(op), hold: true });
  };

  /**
   * A keyboard / button step on a whole selection. Steps add up from the
   * start of a held run (`total`), so the run is one absolute group move.
   */
  const groupStep = (m: Extract<ShellToBridge, { type: 'studio:placement/step' }>, keys: string[]) => {
    let run = stepRun && stepRun.group && stepRun.op === m.op && m.hold ? stepRun : null;
    if (!run) {
      const g = beginGroup(adapter, keys, m.key);
      if (!g) return;
      run = { key: m.key, from: g.from.get(g.primary)!, op: m.op, timer: 0, group: g, total: m.op === 'scale' ? 1 : 0, dx: 0, dy: 0 };
    }
    const g = run.group!;
    if (m.op === 'move') {
      // Arrow keys move by screen px: the same as dragging the move handle by that much (on surfaces too, snap.ts).
      run.dx += m.dx || 0;
      run.dy += m.dy || 0;
      adapter.setSnap?.({ on: true, skip: keys });
      groupMove(adapter, adapter.dim, g, run.dx, run.dy);
      adapter.setSnap?.({ on: false });
    } else if (m.op === 'drop') {
      // End with several picked: each onto the surface under it, as Unreal's End does (the others are not floors).
      for (const k of g.keys) adapter.drop?.(k, keys);
    } else if (m.op === 'rotate') {
      run.total += m.d || 0;
      // Q / E: upright, as for one object (the axis is the turn tool's), together or each in place as chosen.
      groupRotate(adapter, adapter.dim, g, run.total, { mode: state.turnMode });
    } else if (m.op === 'scale') {
      run.total *= m.d || 1;
      groupScale(adapter, adapter.dim, g, run.total, state.scaleMode);
    } else if (m.op === 'lift') {
      // PgDn: the step ends on the surface the first member meets (snap.ts stepDetent).
      const d = adapter.rest ? stepDetent(firstToTouch(g.keys.map((k) => adapter.rest!(k, keys))), m.d || 0) : m.d || 0;
      groupLift(adapter, g, d);
    }
    dirtyFrame = true;
    if (m.hold) {
      stepRun = run;
      win.clearTimeout(run.timer);
      run.timer = win.setTimeout(closeStepRun, 400);
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, g, false), press: pressOf(m.op), hold: true });
    } else {
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, g, true), end: true, press: pressOf(m.op) });
    }
  };

  /** The handle a step counts as for the shell (Drop to floor changes the height: the Height handle's). */
  const pressOf = (op: string) => (op === 'drop' ? 'lift' : op) as 'move' | 'rotate' | 'lift' | 'scale';

  const step = (m: Extract<ShellToBridge, { type: 'studio:placement/step' }>) => {
    const keys = m.keys && m.keys.length > 1 ? m.keys : null;
    if (stepRun && (stepRun.key !== m.key || stepRun.op !== m.op || !m.hold || !!stepRun.group !== !!keys)) closeStepRun();
    if (keys) {
      groupStep(m, keys);
      return;
    }
    const from = poseOf(m.key);
    if (!from) return;
    let pose: Pose = from;
    if (m.op === 'move') {
      const a = adapter.anchor(m.key);
      if (!a) return;
      const [x, y] = a.center;
      adapter.setSnap?.({ on: true, skip: [m.key] });
      if (adapter.grab(m.key, x, y)) pose = adapter.drag(m.key, x + (m.dx || 0), y + (m.dy || 0));
      adapter.setSnap?.({ on: false });
    } else if (m.op === 'rotate') pose = adapter.rotate(m.key, m.d || 0);
    else if (m.op === 'scale') pose = adapter.scale(m.key, m.d || 1);
    else if (m.op === 'lift' && adapter.nudgeY) {
      // PgDn: a step that would cross the surface below ends on it; the next goes through (snap.ts stepDetent).
      const d = adapter.rest ? stepDetent(adapter.rest(m.key, [m.key]), m.d || 0) : m.d || 0;
      pose = adapter.nudgeY(m.key, d);
    } else if (m.op === 'drop' && adapter.drop) pose = adapter.drop(m.key, [m.key]);
    dirtyFrame = true;
    if (m.hold) {
      if (!stepRun) stepRun = { key: m.key, from, op: m.op, timer: 0, total: 0, dx: 0, dy: 0 };
      win.clearTimeout(stepRun.timer);
      stepRun.timer = win.setTimeout(closeStepRun, 400);
      post({ type: 'studio:placement/moved', key: m.key, pose, press: pressOf(m.op), hold: true });
    } else {
      post({ type: 'studio:placement/moved', key: m.key, pose, end: true, from, press: pressOf(m.op) });
    }
  };

  /**
   * Make copies and put each one a little to the side, so it is visible at
   * once and can be moved right away. Where:
   * - a copy of a copy made in this session: at the same spacing again
   *   (copy, move the copy, copy again = a row with even gaps);
   * - otherwise: just to the right of the original(s) on screen (a group
   *   keeps its shape: everyone moves the same way).
   * With a `pose` (redo, reopening) the copy goes exactly there.
   * `at: 'view'` (the Library's "Add to scene", 2026-10-18): the copies go to the middle of the free part of the
   * frame instead (what the card and the ask bar leave), keeping the group's shape — on the original's ground in
   * 3D (a drag of the screen box, as the move tool does), so "add a pine" lands where the person is looking.
   */
  const copy = (reqs: Array<{ key: string; from: string; pose?: Pose }>, at?: 'view') => {
    const done: Array<{ key: string; from: string; pose: Pose; ghost?: boolean }> = [];
    const failed: string[] = [];
    const before = new Map(adapter.list().map((i) => [i.key, i]));
    const fresh: Array<{ key: string; from: string }> = [];
    for (const r of reqs) {
      const made = edits.make(r.key, r.from);
      if (!made) {
        failed.push(r.key);
        continue;
      }
      if (r.pose) adapter.setPose(r.key, r.pose);
      else fresh.push({ key: r.key, from: r.from });
      done.push({ key: r.key, from: r.from, pose: r.pose!, ghost: made.ghost || undefined });
    }
    // Spacing of copies of copies, in parent space.
    const rest: Array<{ key: string; from: string }> = [];
    if (at === 'view' && fresh.length && toView(fresh)) fresh.length = 0;
    for (const f of fresh) {
      const src = before.get(f.from);
      const orig = src?.copyOf ? before.get(src.copyOf) : undefined;
      const gap = src && orig ? src.pose.p.map((v, i) => v - (orig.pose.p[i] ?? 0)) : null;
      if (src && gap && gap.some((v) => Math.abs(v) > 1e-6)) {
        const next: Pose = { ...structuredClone(src.pose), p: src.pose.p.map((v, i) => v + (gap[i] ?? 0)) };
        delete next.z; // a copy keeps its own place in the draw order (right after the original)
        adapter.setPose(f.key, next);
      } else rest.push(f);
    }
    if (rest.length) {
      // One screen offset for all: the width of what was copied, plus a gap.
      const sources = rest.map((f) => f.from);
      const ga = groupAnchor(adapter, sources, sources[0]!);
      const dx = ga && ga.rect ? Math.max(24, Math.min(400, ga.rect.w + 12)) : 40;
      // A copy of what the game moves is held like its original (hold.ts), but this first step beside it is the
      // editor's own: let it through, then hold it.
      for (const f of rest) hold.placing.add(f.key);
      try {
        const g = beginGroup(adapter, rest.map((f) => f.key), rest[0]!.key);
        // 3D: groupMove moves the first copy on the ground and the others by the same metres.
        if (g) groupMove(adapter, adapter.dim, g, dx, 0);
      } finally {
        hold.placing.clear();
      }
    }
    for (const d of done) d.pose = adapter.anchor(d.key)?.pose ?? d.pose;
    dirtyFrame = true;
    refreshItems();
    post({ type: 'studio:placement/added', items: done.filter((d) => d.pose), failed });
    // The copies become the selection, so they can be moved (or copied again) at once.
    if (done.length) selectMany(done.map((d) => d.key), done[done.length - 1]!.key);
  };

  /**
   * Place the Library's "Add to scene" copies (copy with `at: 'view'`) where they can be seen whole. True when done.
   * The rule (design review 2, 2026-10-19, item ①): the copy keeps the original's size and must show inside the middle
   * 60 % of the frame, no taller than 35 % of it — never "in front of the camera, covering the view".
   * 1. Beside the original, one of its widths over (toward the middle of the frame, else the other side), when the
   *    original is on screen: the person sees the new one next to the one they know.
   * 2. Otherwise (the original off screen, or both sides fail the rule): the middle of what the camera sees, at about
   *    the original's distance. 3D: points on the original's ground down the middle line of the free area (toGround);
   *    of the ones that pass the rule, the one whose screen height is nearest the original's (= the same distance).
   *    2D: the middle of the free area (a 2D copy's size does not depend on where it stands).
   * 3. Nothing passes (a giant object, no ground under the middle): the candidate that shows smallest.
   * WHY: the first version (2026-10-18) always went to "the ground below the middle"; in Lantern Cove that ground is
   * right under a low camera, and the sea-stack copy stood in front of it, covering ~45 % of the view and the
   * lighthouse, with its strip off screen (review 2, photo 11).
   */
  const toView = (fresh: Array<{ key: string; from: string }>): boolean => {
    const keys = fresh.map((f) => f.key);
    const g = beginGroup(adapter, keys, keys[0]!);
    if (!g) return false;
    // The copies stand exactly where the originals are (made this frame): the originals' box is theirs.
    const ga = groupAnchor(adapter, fresh.map((f) => f.from), fresh[0]!.from);
    const W = win.innerWidth, H = win.innerHeight;
    const shown = () => {
      const a = groupAnchor(adapter, keys, g.primary);
      return a && a.visible && a.rect ? a.rect : null;
    };
    // The rule above: height ≤ 35 % of the frame, middle inside the middle 60 % (20 %–80 % both ways).
    const passes = (r: { x: number; y: number; w: number; h: number } | null) => !!r && r.h <= H * 0.35 + 0.5
      && r.x + r.w / 2 >= W * 0.2 && r.x + r.w / 2 <= W * 0.8 && r.y + r.h / 2 >= H * 0.2 && r.y + r.h / 2 <= H * 0.8;
    const h0 = ga?.rect?.h ?? 0;
    // Tried placements: how to put the group there again, and its screen box there.
    const tried: Array<{ put: () => void; r: { x: number; y: number; w: number; h: number } | null }> = [];
    const attempt = (put: () => void) => {
      put();
      const r = shown();
      tried.push({ put, r });
      return passes(r);
    };
    // 1. Beside the original.
    const W0 = ga?.rect?.w ?? 0;
    if (ga && ga.visible && ga.rect && W0 > 0) {
      const toMiddle = ga.center[0] <= W / 2 ? 1 : -1;
      const gap = Math.max(8, W0 * 0.1);
      for (const dir of [toMiddle, -toMiddle]) {
        if (attempt(() => groupMove(adapter, adapter.dim, g, dir * (W0 + gap), 0))) return true;
      }
    }
    // 2. The middle of the view at about the original's distance.
    const area = freeArea(inset.top);
    const tx = (area.x0 + area.x1) / 2, ty = (area.y0 + area.y1) / 2;
    const lead = g.from.get(g.primary);
    const good: Array<{ put: () => void; r: { x: number; y: number; w: number; h: number } }> = [];
    if (adapter.dim === '3d' && lead && adapter.toGround) {
      for (let f = 0.3; f <= 0.901; f += 0.05) {
        const y = area.y0 + (area.y1 - area.y0) * f;
        const hit = adapter.toGround(tx, y, lead.p[1] ?? 0);
        if (!hit) continue;
        const put = () => {
          groupShift(adapter, g, [hit[0]! - (lead.p[0] ?? 0), 0, hit[2]! - (lead.p[2] ?? 0)]);
          // Now in front of the camera: its pivot onto the screen point, so a long thing is placed by its middle.
          const a = adapter.anchor(g.primary);
          const g2 = a && a.visible ? beginGroup(adapter, keys, g.primary) : null;
          if (g2 && a) groupMove(adapter, '3d', g2, tx - a.center[0], y - a.center[1]);
        };
        if (attempt(put)) good.push({ put, r: tried[tried.length - 1]!.r! });
      }
    } else if (ga) {
      const put = () => groupMove(adapter, adapter.dim, g, tx - ga.center[0], ty - ga.center[1]);
      if (attempt(put)) good.push({ put, r: tried[tried.length - 1]!.r! });
    }
    if (good.length) {
      good.sort((a, b) => Math.abs(a.r.h - h0) - Math.abs(b.r.h - h0));
      good[0]!.put();
      return true;
    }
    // 3. Nothing passed: the smallest one seen (a visible one first).
    const seen = tried.filter((x) => x.r).sort((a, b) => a.r!.h - b.r!.h);
    if (!seen.length) return false;
    seen[0]!.put();
    return true;
  };

  /**
   * Once, right after the edit view is up: let the game's own frames run for WATCH_MS, find what it moved by itself
   * (observe.ts), put those back where the first frame had them, and hold them (hold.ts: "the game moves this").
   * Not skipped when core.time counted no game frame: a three.js game's frames are held by the adapter's own boot.js
   * (raw.watch), not by core.time, so that count stays 0 there (found on the runner of that try, 2026-10-19).
   */
  let watched = false;
  const watchGame = async () => {
    if (watched) return;
    watched = true;
    // The world's objects only (UI stage 1 merged in, 2026-10-19): a game with only a UI has nothing to watch.
    if (!world) return;
    const { raw, ruled } = world;
    let before: Item[];
    try {
      before = ruled.list();
    } catch {
      return;
    }
    watchBase = new Map(before.map((i) => [i.key, i.pose] as const));
    core.time.thaw();
    raw.watch?.(true);
    await new Promise((r) => win.setTimeout(r, WATCH_MS));
    const base = watchBase;
    watchBase = null;
    // Left editing meanwhile (Play): the game runs on as it should; nothing to put back.
    if (!state.editing) {
      raw.watch?.(false);
      return;
    }
    core.time.freeze();
    // Read what moved BEFORE watch(false): an adapter may put its whole scene back then (three.js does).
    let after: Item[] = [];
    try {
      after = ruled.list();
    } catch {
      /* nothing found: the scene is put back below all the same */
    }
    raw.watch?.(false);
    const was = after.map((i) => ({ ...i, pose: base.get(i.key) ?? i.pose }));
    hold.driven = drivenBetween(was, after, world.driven.dim);
    // What the game moved, and what the editor posed meanwhile (a saved layout re-applied, an early drag), which an
    // adapter's watch(false) may have put back to the first frame with the rest of the scene.
    for (const k of new Set([...hold.driven.keys(), ...watchSet])) {
      const p = base.get(k);
      if (p) ruled.setPose(k, p);
    }
    watchSet.clear();
    if (!hold.driven.size) return;
    dirtyFrame = true;
    // The UI being edited by then (a reload that asked for it): the world's list, now with `held`, goes out marked as
    // the world's, the way setEditing sends the other layer's list.
    if (layer !== 'world') {
      try {
        post({ type: 'studio:placement/items', items: world.driven.list(), layer: 'world' });
      } catch {
        /* listed when switched to */
      }
      return;
    }
    refreshItems();
    postSelected();
    input?.selectionChanged();
  };

  const setEditing = (on: boolean, viewState?: unknown) => {
    if (on === state.editing) return;
    if (on) {
      core.time.freeze();
      try {
        state.items = adapter.begin();
      } catch (e) {
        post({ type: 'studio:core/error', message: `begin() failed: ${(e as Error).message}` });
      }
      // A tap made while the editor was getting ready (early-press.ts): read HERE, on the picture it was made on (begin()
      // opens on the game's own camera), before a saved view or "everything in frame" below moves the view. Picked once
      // input is attached (below).
      const early = deps.earlyTaps?.take() ?? null;
      const earlyKey = early ? (tappableAt(adapter, state.items, win, early.x, early.y, early.type === 'mouse' ? UI.pickRadiusMouse : UI.pickRadiusTouch)[0] ?? null) : null;
      if (viewState !== undefined && adapter.view.restore) adapter.view.restore(viewState);
      else {
        // The opening view: the game's own camera when the adapter has one (three.js, polish pass 2026-10-16),
        // else everything in frame. Told to the shell at once, so a reload opens on it too (the three.js state
        // carries `home`, so the first pick after a reload still glides).
        if (adapter.view.home) adapter.view.home();
        else adapter.view.frameAll();
        // Tell the shell the first view too (not only after the person moves the camera): a reload
        // after the AI's change then opens on the same view, even when the AI's new objects would
        // make "frame all" choose another one (AI feel, 2026-10-16).
        postView();
      }
      // The other layer starts too (UI: its CSS animations pause), but stays out of reach until switched to.
      for (const o of others()) {
        try {
          o.driven.begin();
        } catch (e) {
          post({ type: 'studio:core/error', message: `begin() failed: ${(e as Error).message}` });
        }
      }
      state.editing = true;
      post({ type: 'studio:placement/items', items: state.items, ...itemsLayer() });
      // The other layer's list too, once (UI stage 1): the shell keeps the UI's saved places in the file and shows them
      // even when the person never switches to the UI.
      for (const o of others()) {
        try {
          post({ type: 'studio:placement/items', items: o.driven.list(), layer: o === uiStack ? 'ui' : 'world' });
        } catch {
          /* listed when switched to */
        }
      }
      attach();
      if (earlyKey) select(earlyKey);
      toolHost.announce();
      paintLayers();
      if (!loopId) loopId = core.time.raf(frame);
      const watching = watchGame();
      if (!checked) {
        // Self-check once, in edit mode (3D adapters only know screen
        // positions once their edit camera exists).
        checked = true;
        // After the list and the first picture have painted (speed pass, 2026-10-17): the check draws twice and reads
        // the canvas back, which waits for the GPU to finish. Run at once, on a slow GPU it held the first paint of
        // the list by about a second (Lantern Cove in the play test's software GL).
        // After the watch too (watchGame): the check moves an object and reads it back, which the game's own motion
        // would spoil while it runs.
        // The adapter of the layer edited first (the world's; a reload asking for the UI switches a moment later).
        const checkOn = raw;
        void watching
          .then(nextTurn)
          .then(nextTurn)
          .then(() => runSelfCheck(checkOn, core, win))
          .then((result) => post({ type: 'studio:core/check', result }));
      }
    } else {
      closeStepRun();
      toolHost.activate(null);
      input?.detach();
      input = null;
      state.editing = false;
      for (const a of [adapter, ...others().map((o) => o.driven)]) {
        try {
          a.end();
        } catch {
          /* the page is usually reloaded after editing anyway */
        }
      }
      paintLayers();
    }
    ready();
  };
  /** The layers other than the current one (UI stage 1; none for a game without a UI). */
  const others = () => [world, uiStack].filter((x): x is Stack => !!x && x.driven !== adapter);
  /** Input on the current layer's adapter, with the shell's settings. */
  const attach = () => {
    // The input posts view-state itself (wheel, look-around): on the UI layer that is the 2D base's unused view, which
    // must not replace the world camera the shell keeps for the next reload.
    const inPost = (m: BridgeToShell) => {
      if (m.type !== 'studio:core/view-state' || layer === 'world') post(m);
    };
    input = attachInput({ adapter, edits, core, win, post: inPost, state, select, selectMany, step, tools: toolHost, markDirty: () => (dirtyFrame = true) });
    if (pendingHandlePx) input.setHandleSize(pendingHandlePx);
    input.setInset(inset);
    input.setTheme(theme);
    if (aiMarks.keys.length) input.setAiMarks(aiMarks.keys, aiMarks.label);
    input.setLang(lang);
  };
  // A core/layer that came before editing started (the shell sends it right after core/edit on a reload).
  let wantLayer: EditLayer | null = null;
  /**
   * Switch what is edited (core/layer, UI stage 1; design §2.2): 1. drop the pick and the input, 2. swap the adapter
   * stack, 3. input again, 4. tell the shell (core/ready with `layer`, then that layer's list). The world's edit
   * camera goes to the game's own view while the UI is edited (the UI sits on the player's picture) and comes back
   * after.
   */
  const setLayer = (to: EditLayer) => {
    const next = to === 'ui' ? uiStack : world;
    if (!next) return;
    if (!state.editing) {
      wantLayer = to;
      return;
    }
    if (next.driven === adapter) {
      ready();
      refreshItems();
      return;
    }
    closeStepRun();
    toolHost.activate(null);
    panGlide = 0;
    listPick = null;
    state.selected = null;
    state.group = [];
    input?.detach();
    input = null;
    if (world) {
      if (to === 'ui') {
        worldView = world.driven.view.state();
        if (world.driven.view.home) world.driven.view.home();
      } else if (worldView !== undefined && world.driven.view.restore) world.driven.view.restore(worldView);
    }
    layer = to;
    raw = next.raw;
    edits = next.edits;
    adapter = next.driven;
    try {
      state.items = adapter.list();
    } catch {
      state.items = [];
    }
    attach();
    paintLayers();
    dirtyFrame = true;
    ready();
    post({ type: 'studio:placement/items', items: state.items, ...itemsLayer() });
    postSelected();
  };

  toolHost = createToolHost({ win, adapter, state, post, select: (k) => select(k), lang: () => lang, markDirty: () => (dirtyFrame = true) });
  toolHost.register(deps.tools);

  return {
    get driven() {
      return adapter;
    },
    layer: () => layer,
    announce: ready,
    addTools(list) {
      toolHost.register(list);
      if (state.editing) toolHost.announce();
    },
    handle(msg) {
      switch (msg.type) {
        case 'studio:core/config':
          deps.rules.config = msg.config && typeof msg.config === 'object' ? msg.config : null;
          if (state.editing) refreshItems();
          break;
        case 'studio:core/ui':
          input?.setHandleSize(msg.handlePx);
          pendingHandlePx = msg.handlePx;
          if (msg.theme === 'dark' || msg.theme === 'light') {
            theme = msg.theme;
            input?.setTheme(theme);
          }
          if (msg.inset) {
            // What the panels cover (the strip and "is it in view" read it). W1-1: a sheet rising or going away no
            // longer slides the view to keep the pick clear of it (it moved the camera every time); see focusIfHidden.
            const grew = msg.inset.bottom > inset.bottom + 40;
            inset = { ...msg.inset };
            input?.setInset(inset);
            // The one exception: a list pick's own card made the sheet rise within 1 s of the pick. That is still
            // "show me what I picked from the list" (the same slide-if-hidden), not the sheet moving the camera.
            const lp = listPick;
            if (grew && lp && lp.key === state.selected && win.performance.now() - lp.at < 1000) {
              listPick = null;
              win.setTimeout(() => {
                if (state.selected === lp.key) focusIfHidden(lp.key);
              }, 60);
            }
          }
          break;
        case 'studio:placement/axis':
          input?.setAxis(msg.axis);
          break;
        case 'studio:placement/tool':
          input?.setTool(msg.tool === 'move' || msg.tool === 'rotate' || msg.tool === 'lift' || msg.tool === 'scale' ? msg.tool : null);
          dirtyFrame = true;
          break;
        case 'studio:placement/look':
          input?.setLook(!!msg.on);
          break;
        case 'studio:core/fly':
          input?.setFly(Array.isArray(msg.keys) ? msg.keys : [], !!msg.fast);
          break;
        case 'studio:placement/menu':
          input?.closeMenu();
          break;
        case 'studio:placement/marks':
          aiMarks = { keys: Array.isArray(msg.keys) ? msg.keys.filter((k) => typeof k === 'string').slice(0, 500) : [], label: typeof msg.label === 'string' ? msg.label.slice(0, 80) : null };
          input?.setAiMarks(aiMarks.keys, aiMarks.label);
          dirtyFrame = true;
          break;
        case 'studio:placement/hover':
          input?.setHover(Array.isArray(msg.keys) ? msg.keys.filter((k) => typeof k === 'string').slice(0, 500) : []);
          dirtyFrame = true;
          break;
        case 'studio:tool/activate':
          toolHost.activate(msg.id);
          dirtyFrame = true;
          break;
        case 'studio:tool/restore':
          toolHost.restore(msg.id, msg.data);
          break;
        case 'studio:tool/collect':
          toolHost.collect();
          break;
        case 'studio:tool/saved':
          toolHost.saved(msg.ids);
          break;
        case 'studio:core/edit':
          setEditing(msg.on, msg.viewState);
          if (msg.on && wantLayer) {
            const w = wantLayer;
            wantLayer = null;
            setLayer(w);
          }
          break;
        case 'studio:core/layer':
          if (msg.layer === 'world' || msg.layer === 'ui') setLayer(msg.layer);
          break;
        case 'studio:core/ui-peek':
          uiPeek = !!msg.on;
          paintLayers();
          dirtyFrame = true;
          break;
        case 'studio:core/view': {
          const v = msg.view;
          if (v.action === 'frameAll') adapter.view.frameAll();
          // The opening view again: the game camera's (three.js) or, without home(), "everything", which is what a
          // 2D editor opened on (setEditing).
          else if (v.action === 'home') {
            if (adapter.view.home) adapter.view.home({ glide: true });
            else adapter.view.frameAll();
          } else if (v.action === 'focus') adapter.view.focus(v.key);
          else if (v.action === 'zoom') adapter.view.zoom(v.factor);
          else if (v.action === 'orbit') adapter.view.orbit?.(v.dx, v.dy);
          else if (v.action === 'pan') adapter.view.pan(v.dx, v.dy);
          // Camera up / down from the editor page (⌘K, E / Q there): `by` is a share of the game's height.
          else if (v.action === 'rise') adapter.view.rise?.(v.by * win.innerHeight);
          else if (v.action === 'restore') adapter.view.restore?.(v.state);
          dirtyFrame = true;
          postView();
          break;
        }
        case 'studio:core/lang':
          lang = msg.lang;
          input?.setLang(msg.lang);
          break;
        case 'studio:placement/list':
          refreshItems();
          break;
        case 'studio:placement/select':
          if (Array.isArray(msg.keys) && msg.keys.length > 1) selectMany(msg.keys, msg.key, msg.focus);
          else select(msg.key, msg.focus);
          break;
        case 'studio:placement/multi':
          state.multi = !!msg.on;
          break;
        case 'studio:placement/copy':
          closeStepRun();
          copy(msg.items, msg.at);
          break;
        case 'studio:placement/remove': {
          closeStepRun();
          const gone = edits.removeKeys(msg.keys);
          if (gone.length) {
            state.group = state.group.filter((k) => !gone.includes(k));
            if (state.selected && gone.includes(state.selected)) state.selected = state.group[state.group.length - 1] ?? null;
            dirtyFrame = true;
          }
          refreshItems();
          input?.selectionChanged();
          postSelected();
          break;
        }
        case 'studio:placement/restore':
          closeStepRun();
          if (edits.restoreKeys(msg.keys).length) dirtyFrame = true;
          refreshItems();
          break;
        case 'studio:placement/pose': {
          // Meant for the layer not being edited (the UI's saved places pushed while the world is edited): set there,
          // quietly — the shell already knows the pose, and its `moved` handler speaks for the current layer.
          const other = msg.layer && msg.layer !== layer ? (msg.layer === 'ui' ? uiStack : world) : null;
          if (other) {
            other.driven.setPose(msg.key, msg.pose);
            dirtyFrame = true;
            break;
          }
          closeStepRun();
          const zBefore = msg.pose.z !== undefined ? poseOf(msg.key)?.z : undefined;
          const pose = adapter.setPose(msg.key, msg.pose);
          dirtyFrame = true;
          // No `end`: the shell already recorded this as undo/redo.
          if (pose) post({ type: 'studio:placement/moved', key: msg.key, pose });
          // A new draw order (2D layers) also shifts the z of the siblings:
          // send the whole list so the shell's order and file stay right.
          if (pose && pose.z !== undefined && pose.z !== zBefore) refreshItems();
          break;
        }
        case 'studio:placement/step':
          if (state.editing) step(msg);
          break;
        case 'studio:placement/unhold':
          // "Make movable" on a held ground (hold.ts): the tools work on it again, for this session.
          for (const k of msg.keys) hold.freed.add(k);
          refreshItems();
          postSelected();
          input?.selectionChanged();
          break;
        case 'studio:placement/thumbs': {
          // One queue, drawn one at a time; the newest request goes FIRST (tool-modes pass, 10/16). The shell
          // asks for the rows you can see whenever the list scrolls, so with hundreds of objects the rows in
          // view are drawn next instead of after every earlier request (before: each request ran on its own,
          // 200 at most, in list order — rows further down stayed empty boxes).
          // Up to 384: the Library's tiles ask for twice their size on screen (Ive review 3 ⑧, 2026-10-20; the list's
          // rows ask for 96). A key asked for at another size is a different picture, so it stays queued.
          const size = Math.min(384, Math.max(16, msg.size | 0));
          const fresh = msg.keys.filter((k) => typeof k === 'string').slice(0, 500);
          const ahead = new Set(fresh);
          thumbQueue = [...fresh.map((key) => ({ key, size })), ...thumbQueue.filter((q) => !(ahead.has(q.key) && q.size === size))].slice(0, 2000);
          if (!thumbRunning) void drawThumbs();
          break;
        }
        case 'studio:library/assets': {
          const uses: Record<string, ReturnType<StudioAdapter['assetsOf']>> = {};
          for (const it of state.items.length ? state.items : adapter.list()) {
            try {
              const a = adapter.assetsOf(it.key);
              if (a.length) uses[it.key] = a;
            } catch {
              /* skip objects the adapter cannot explain */
            }
          }
          post({ type: 'studio:library/assets', loads: core.loads.entries(), uses });
          break;
        }
        case 'studio:library/preview':
          // Image swap preview is a library-tool feature implemented through
          // the adapter later; acknowledge so the shell does not wait forever.
          post({ type: 'studio:library/previewed', url: msg.url, ok: false });
          break;
      }
    },
  };
}
