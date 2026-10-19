// Edit session inside the game page: applies shell messages to the adapter,
// runs the studio's own draw loop while the game is frozen, and reports
// changes back. Pointer gestures and handles are attached by input.ts.
import type { BridgeToShell, GameTool, GroupScaleMode, Inset, Item, Lang, Pose, ShellToBridge, StudioAdapter, TurnAxis } from '../contract.ts';
import type { Core } from '../core/index.ts';
import { withRules, type RulesHolder } from '../core/rules.ts';
import { withEdits } from '../core/edits.ts';
import { beginGroup, groupAnchor, groupLift, groupMove, groupPoses, groupRotate, groupScale, groupShift, type GroupSession } from './group.ts';
import { createToolHost } from './game-tools.ts';
import { attachInput, type InputHandle } from './input.ts';
import { runSelfCheck } from './selfcheck.ts';

export interface EditorDeps {
  /** The adapter as found (self-check runs on it, before game rules). */
  adapter: StudioAdapter;
  /** Game rules (.studio/studio.json via the shell) and .studio/tools.js extensions. */
  rules: RulesHolder;
  /** Game tools registered so far (more may arrive later through register()). */
  tools: GameTool[];
  core: Core;
  win: Window & typeof globalThis;
  post: (msg: BridgeToShell) => void;
}

export interface Editor {
  handle(msg: ShellToBridge): void;
  /** Tools registered after the editor started (late studio.extend calls). */
  addTools(tools: GameTool[]): void;
  /** The adapter as the editor drives it (copies/deletions and game rules applied), for the debug peek. */
  driven: StudioAdapter;
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
  const { core, win, post } = deps;
  const raw = deps.adapter;
  // Every edit goes through the copy/delete layer and the game rules layer;
  // the adapter itself is unaware of both.
  const edits = withEdits(raw);
  const adapter = withRules(edits, deps.rules);
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
    post({ type: 'studio:placement/items', items: state.items });
  };

  const frame = () => {
    loopId = core.time.raf(frame);
    if (!state.editing) return;
    // Redraw every frame while editing: cheap for edit scenes, and it keeps
    // the picture correct when an engine re-uploads textures lazily.
    try {
      adapter.render();
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
      post({ type: 'studio:core/view-state', state: adapter.view.state() });
      return;
    }
    if (!adapter.view.restore) {
      post({ type: 'studio:core/view-state', state: adapter.view.state() });
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
        post({ type: 'studio:core/view-state', state: adapter.view.state() });
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
        post({ type: 'studio:placement/thumb', key: q.key, src });
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
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, group, true), end: true, press: op as 'move', hold: true });
      return;
    }
    const pose = poseOf(key);
    if (pose) post({ type: 'studio:placement/moved', key, pose, end: true, from, press: op as 'move', hold: true });
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
      // Arrow keys move by screen px: the same as dragging the move handle by that much.
      run.dx += m.dx || 0;
      run.dy += m.dy || 0;
      groupMove(adapter, adapter.dim, g, run.dx, run.dy);
    } else if (m.op === 'rotate') {
      run.total += m.d || 0;
      // Q / E: upright, as for one object (the axis is the turn tool's), together or each in place as chosen.
      groupRotate(adapter, adapter.dim, g, run.total, { mode: state.turnMode });
    } else if (m.op === 'scale') {
      run.total *= m.d || 1;
      groupScale(adapter, adapter.dim, g, run.total, state.scaleMode);
    } else if (m.op === 'lift') groupLift(adapter, g, m.d || 0);
    dirtyFrame = true;
    if (m.hold) {
      stepRun = run;
      win.clearTimeout(run.timer);
      run.timer = win.setTimeout(closeStepRun, 400);
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, g, false), press: m.op, hold: true });
    } else {
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, g, true), end: true, press: m.op });
    }
  };

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
      if (adapter.grab(m.key, x, y)) pose = adapter.drag(m.key, x + (m.dx || 0), y + (m.dy || 0));
    } else if (m.op === 'rotate') pose = adapter.rotate(m.key, m.d || 0);
    else if (m.op === 'scale') pose = adapter.scale(m.key, m.d || 1);
    else if (m.op === 'lift' && adapter.nudgeY) pose = adapter.nudgeY(m.key, m.d || 0);
    dirtyFrame = true;
    if (m.hold) {
      if (!stepRun) stepRun = { key: m.key, from, op: m.op, timer: 0, total: 0, dx: 0, dy: 0 };
      win.clearTimeout(stepRun.timer);
      stepRun.timer = win.setTimeout(closeStepRun, 400);
      post({ type: 'studio:placement/moved', key: m.key, pose, press: m.op, hold: true });
    } else {
      post({ type: 'studio:placement/moved', key: m.key, pose, end: true, from, press: m.op });
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
      const g = beginGroup(adapter, rest.map((f) => f.key), rest[0]!.key);
      // 3D: groupMove moves the first copy on the ground and the others by the same metres.
      if (g) groupMove(adapter, adapter.dim, g, dx, 0);
    }
    for (const d of done) d.pose = adapter.anchor(d.key)?.pose ?? d.pose;
    dirtyFrame = true;
    refreshItems();
    post({ type: 'studio:placement/added', items: done.filter((d) => d.pose), failed });
    // The copies become the selection, so they can be moved (or copied again) at once.
    if (done.length) selectMany(done.map((d) => d.key), done[done.length - 1]!.key);
  };

  /**
   * Put new copies in the middle of the free part of the frame (copy with `at: 'view'`). True when done.
   * 2D: a screen drag of the group from where the originals' box is drawn to the middle (stage space).
   * 3D: "on the ground where the camera looks". The middle of the view is often sky or far hills (Lantern Cove opens
   * on the player's camera, its horizon a little under the middle), so the spot is the first point straight down
   * from the middle whose ray meets the original's ground (toGround at its height): the lead copy's origin goes
   * there (the others by the same metres), then — now in front of the camera — a drag of its pivot onto that screen
   * point, so a long thing (the pier) is placed by its middle, not its origin. WHY: the first try (2026-10-18) only
   * dragged from the original's screen point to the middle; that ray hit the sky, the drag kept the object where it
   * was, and the pier copy stayed at the frame's right edge (off screen on a phone). Without toGround, or with no
   * ground anywhere under the middle: the drag from the originals' box, as in 2D.
   */
  const toView = (fresh: Array<{ key: string; from: string }>): boolean => {
    const keys = fresh.map((f) => f.key);
    const area = freeArea(inset.top);
    const tx = (area.x0 + area.x1) / 2, ty = (area.y0 + area.y1) / 2;
    const g = beginGroup(adapter, keys, keys[0]!);
    if (!g) return false;
    const lead = g.from.get(g.primary);
    if (adapter.dim === '3d' && lead && adapter.toGround) {
      // From the middle down to 85 % of the free height: 0.5 = the middle itself (a camera looking down at the ground).
      for (const f of [0.5, 0.58, 0.66, 0.75, 0.85]) {
        const y = area.y0 + (area.y1 - area.y0) * f;
        const hit = adapter.toGround(tx, y, lead.p[1] ?? 0);
        if (!hit) continue;
        groupShift(adapter, g, [hit[0]! - (lead.p[0] ?? 0), 0, hit[2]! - (lead.p[2] ?? 0)]);
        const a = adapter.anchor(g.primary);
        const g2 = a && a.visible ? beginGroup(adapter, keys, g.primary) : null;
        if (g2 && a) groupMove(adapter, '3d', g2, tx - a.center[0], y - a.center[1]);
        return true;
      }
    }
    // The originals' box: the copies stand exactly there, but were made this frame (not drawn yet).
    const ga = groupAnchor(adapter, fresh.map((f) => f.from), fresh[0]!.from);
    if (!ga || !ga.visible) return false;
    groupMove(adapter, adapter.dim, g, tx - ga.center[0], ty - ga.center[1]);
    return true;
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
        post({ type: 'studio:core/view-state', state: adapter.view.state() });
      }
      state.editing = true;
      post({ type: 'studio:placement/items', items: state.items });
      input = attachInput({ adapter, edits, core, win, post, state, select, selectMany, step, tools: toolHost, markDirty: () => (dirtyFrame = true) });
      toolHost.announce();
      if (pendingHandlePx) input.setHandleSize(pendingHandlePx);
      input.setInset(inset);
      input.setTheme(theme);
      if (aiMarks.keys.length) input.setAiMarks(aiMarks.keys, aiMarks.label);
      input.setLang(lang);
      if (!loopId) loopId = core.time.raf(frame);
      if (!checked) {
        // Self-check once, in edit mode (3D adapters only know screen
        // positions once their edit camera exists).
        checked = true;
        // After the list and the first picture have painted (speed pass, 2026-10-17): the check draws twice and reads
        // the canvas back, which waits for the GPU to finish. Run at once, on a slow GPU it held the first paint of
        // the list by about a second (Lantern Cove in the play test's software GL).
        void nextTurn()
          .then(nextTurn)
          .then(() => runSelfCheck(raw, core, win))
          .then((result) => post({ type: 'studio:core/check', result }));
      }
    } else {
      closeStepRun();
      toolHost.activate(null);
      input?.detach();
      input = null;
      state.editing = false;
      try {
        adapter.end();
      } catch {
        /* the page is usually reloaded after editing anyway */
      }
    }
    post({ type: 'studio:core/ready', kind: adapter.kind, dim: adapter.dim, version: adapter.version, editing: state.editing, rise: adapter.dim === '3d' && !!adapter.view.rise, fly: adapter.dim === '3d' && !!adapter.view.fly });
  };

  toolHost = createToolHost({ win, adapter, state, post, select: (k) => select(k), lang: () => lang, markDirty: () => (dirtyFrame = true) });
  toolHost.register(deps.tools);

  return {
    driven: adapter,
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
          post({ type: 'studio:core/view-state', state: adapter.view.state() });
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
        case 'studio:placement/thumbs': {
          // One queue, drawn one at a time; the newest request goes FIRST (tool-modes pass, 10/16). The shell
          // asks for the rows you can see whenever the list scrolls, so with hundreds of objects the rows in
          // view are drawn next instead of after every earlier request (before: each request ran on its own,
          // 200 at most, in list order — rows further down stayed empty boxes).
          const size = Math.min(256, Math.max(16, msg.size | 0));
          const fresh = msg.keys.filter((k) => typeof k === 'string').slice(0, 500);
          const ahead = new Set(fresh);
          thumbQueue = [...fresh.map((key) => ({ key, size })), ...thumbQueue.filter((q) => !ahead.has(q.key))].slice(0, 2000);
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
