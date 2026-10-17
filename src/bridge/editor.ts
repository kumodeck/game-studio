// Edit session inside the game page: applies shell messages to the adapter,
// runs the studio's own draw loop while the game is frozen, and reports
// changes back. Pointer gestures and handles are attached by input.ts.
import type { BridgeToShell, GameTool, GroupScaleMode, Inset, Item, Lang, Pose, ShellToBridge, StudioAdapter, TurnAxis } from '../contract.ts';
import type { Core } from '../core/index.ts';
import { withRules, type RulesHolder } from '../core/rules.ts';
import { withEdits } from '../core/edits.ts';
import { beginGroup, groupAnchor, groupLift, groupMove, groupPoses, groupRotate, groupScale, type GroupSession } from './group.ts';
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
}

export function createEditor(deps: EditorDeps): Editor {
  const { core, win, post } = deps;
  const raw = deps.adapter;
  // Every edit goes through the copy/delete layer and the game rules layer;
  // the adapter itself is unaware of both.
  const edits = withEdits(raw);
  const adapter = withRules(edits, deps.rules);
  const state: EditState = { editing: false, selected: null, group: [], multi: false, items: [], axis: 'y', scaleMode: 'spread' };
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
  const focusIfHidden = (key: string) => {
    if (state.multi || inView(key)) return;
    // On screen but under a panel: slide it out. Off screen (or behind the camera): the adapter's focus first.
    if (!slideIntoFree(key)) {
      adapter.view.focus(key);
      slideIntoFree(key);
    }
    post({ type: 'studio:core/view-state', state: adapter.view.state() });
  };
  // The frame changes size without the object moving (the phone sheet opens,
  // the caption line under the game appears): keep the picked object in view.
  let resizeTimer = 0;
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
  let insetTimer = 0;
  // The view before / after the last "slide the pick clear of a sheet that rose" (core/ui inset), to undo it.
  let insetSlide: { before: unknown; after: string } | null = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (state.editing && state.selected && state.group.length <= 1 && !gliding) {
        focusIfHidden(state.selected);
        dirtyFrame = true;
      }
    }, 120);
  });
  /**
   * The first pick from the opening view (3D: the game's own camera, often
   * almost level with the ground) glides to an editing angle around it
   * (adapter view.settle, polish pass 2026-10-16), then slides it clear of
   * the panels like any focus. Returns false when the adapter has no opening
   * view or the person already moved the view.
   */
  // While it glides, the "keep the pick clear of the panels" slides (a phone's card / sheet appearing, the frame
  // resizing) wait for its end: a pan in the middle stopped the glide after 50 ms (phone, polish pass).
  let gliding = false;
  const settleOn = (key: string) => {
    if (state.multi || !adapter.view.settle) return false;
    const sel = key;
    gliding = true;
    const started = adapter.view.settle(key, () => {
      gliding = false;
      if (state.selected === sel) slideIntoFree(sel);
      dirtyFrame = true;
      post({ type: 'studio:core/view-state', state: adapter.view.state() });
    });
    if (!started) gliding = false;
    return started;
  };
  const select = (key: string | null, focus = false) => {
    state.selected = key && state.items.some((i) => i.key === key) ? key : null;
    state.group = state.selected ? [state.selected] : [];
    if (state.selected && settleOn(state.selected)) {
      /* gliding; slid into the free part when it ends */
    } else if (state.selected && focus) focusIfHidden(state.selected);
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
      groupRotate(adapter, adapter.dim, g, run.total);
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
   */
  const copy = (reqs: Array<{ key: string; from: string; pose?: Pose }>) => {
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
    post({ type: 'studio:core/ready', kind: adapter.kind, dim: adapter.dim, version: adapter.version, editing: state.editing });
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
            // Only a sheet rising from the bottom (a phone's list / Assets: tens of px at once). Not the PC card's
            // width or height, which change with the numbers on it — also in the middle of a drag, where sliding
            // the view turned a strip drag into nothing (e2e three-orb-garden, 10/16).
            const grew = msg.inset.bottom > inset.bottom + 40;
            const shrank = msg.inset.bottom < inset.bottom - 40;
            inset = { ...msg.inset };
            input?.setInset(inset);
            // A panel now covers more (a phone's list sheet opened over the game): keep the picked object
            // in the part that is still seen. After the sheet's slide, measured on its final height.
            if (grew && state.editing && state.selected && state.group.length <= 1 && !gliding) {
              clearTimeout(insetTimer);
              const before = adapter.view.state();
              insetTimer = window.setTimeout(() => {
                if (state.selected) focusIfHidden(state.selected);
                const after = JSON.stringify(adapter.view.state());
                if (after !== JSON.stringify(before)) insetSlide = { before, after };
                dirtyFrame = true;
              }, 60);
            }
            // ...and when that panel goes away again, the view goes back where it was (polish pass 2026-10-16,
            // play test stumble 4: on a phone the ask box's list covered half the game, the picked crate slid up
            // to the top edge, and stayed there, half cut, after the list closed). Only if nobody moved the
            // view meanwhile: a look-around in between is the person's own, and stays.
            if (shrank && insetSlide) {
              clearTimeout(insetTimer);
              const s = insetSlide;
              insetSlide = null;
              if (JSON.stringify(adapter.view.state()) === s.after && adapter.view.restore) {
                adapter.view.restore(s.before);
                post({ type: 'studio:core/view-state', state: adapter.view.state() });
                dirtyFrame = true;
              }
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
          copy(msg.items);
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
