// Move things where the game stopped (pause stage 2, 2026-10-22: "stop in the middle of the game and move things").
//
// The person paused ▶ Play (play-pause.ts) and pressed "Move" in the pause panel (or M). The editor's own editor
// (editor.ts, the one Edit uses) wakes up INSIDE the paused game page: the same pick, the same orange outline, the same
// strip under the object (move · height · turn · size), the same snap onto surfaces. Everything stays where it was at
// the pause — the camera too: the view is the player's, not the edit camera (EditorDeps.paused).
//
// What happens after (design.md §5):
//   - Resume: the game goes on from where things now stand (the objects themselves were moved; nothing to apply).
//   - "Put in layout": that object's place goes to the editor as a move made in Edit would (studio:placement/moved,
//     with `end` and `from`) — an unsaved change like any other: Save · N counts it, the draft carries it, ▶ Play asks
//     "Save and play / Try without saving" about it next time, and Edit shows it. Nothing else does that: a place not
//     put in the layout lives only in this play ("Only in this play") and is gone when the game opens again.
//   - What the game moves itself — an enemy, a bullet, a boat the game sails, a motion given in Edit — says "Just for
//     this moment" and has no "Put in layout": its place now is a point in the middle of a run, and kept, the next
//     start would put it there (and the game would move it away again at once). Found by comparing where each object
//     is at the pause with where it was when Play started (or where the person last left it): anything that moved by
//     itself in between, anything the game made since (not there at the start), and anything the draft's motions move.
//   - "Put back": where it was at the pause.
//
// WHY not the editor page's own Edit mode (send the shell to Edit): Edit opens a new game page — the moment (the enemy
// mid-jump, the ball in the air) would be gone, which is the whole point of pausing. And the game can be full screen,
// where only its own page shows: so the card lives in the pause panel, in the game page, like the chat.
//
// WHY nothing of the editor's chatter reaches the editor page: its messages are Edit's (core/ready says "editing",
// view-state would replace the edit camera kept for Edit, core/key would run the editor's shortcuts — P there is ▶
// Play). Only "Put in layout" goes out, as the one message Edit itself sends for a move.
import type { BridgeToShell, GameConfig, Inset, Item, Lang, Pose, ShellToBridge, StudioAdapter } from '../contract.ts';
import { UI } from '../contract.ts';
import type { Core } from '../core/index.ts';
import type { RulesHolder } from '../core/rules.ts';
import { createEditor, type Editor } from './editor.ts';
import { drivenBetween } from './observe.ts';

/** One pose as observe.ts compares them (it reads only key and pose). */
const one = (key: string, pose: Pose) => [{ key, pose } as unknown as Item];

/** Why an object can only be moved for this moment (null = it can go in the layout). */
export type MomentWhy = 'game' | 'new' | 'motion' | null;

/**
 * The pure part (test/pause.test.ts): can this object's place go in the layout? `start` = the poses when Play started
 * (after the editor's draft was shown), `mine` = where the person left objects in an earlier pause of this play (the
 * game did not move those: the person did), `moving` = the keys the draft's motions move, `now` = its pose at the pause.
 */
export function momentWhy(key: string, now: Pose, start: Map<string, Pose>, mine: Map<string, Pose>, moving: Set<string>, dim: '2d' | '3d'): MomentWhy {
  if (moving.has(key)) return 'motion';
  const was = mine.get(key) ?? start.get(key);
  if (!was) return 'new';
  return drivenBetween(one(key, was), one(key, now), dim).size ? 'game' : null;
}

/** Two poses the same, as the editor counts it (observe.ts' smallest change). */
export function samePose(a: Pose | undefined, b: Pose | undefined, dim: '2d' | '3d'): boolean {
  if (!a || !b) return a === b;
  return !drivenBetween(one('k', a), one('k', b), dim).size;
}

/** "X 8.5 · Y 0.0 · Z 9.6" (3D, metres) / "X 120 · Y 40" (2D, px): the card's numbers, as Edit's card rounds them. */
export function poseWords(p: Pose, dim: '2d' | '3d'): string {
  // `+ 0` after rounding: no "-0.0" for a height a hair under the ground.
  const n = (v: number | undefined) => (dim === '3d' ? (Math.round((v ?? 0) * 10) / 10 + 0).toFixed(1) : String(Math.round(v ?? 0) + 0));
  return dim === '3d' ? `X ${n(p.p[0])} · Y ${n(p.p[1])} · Z ${n(p.p[2])}` : `X ${n(p.p[0])} · Y ${n(p.p[1])}`;
}

export const MOVE_CSS = `
.chat .card { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 8px; }
.chat .card .name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat .card .nums { color: rgba(255,255,255,.55); font: 500 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
.chat .card .why { color: rgba(255,255,255,.7); line-height: 1.45; }
.chat .card .why b { font-weight: 600; color: #f4f4f6; }
.chat .card .acts { display: flex; gap: 6px; flex-wrap: wrap; }
.chat .card .hint { color: rgba(255,255,255,.55); font-size: 12px; line-height: 1.45; }
/* "Put in layout" is the person's own hand (orange, as Edit's outline and Save), not the AI's violet. */
.chat .card button.b.keep { background: #ff6b1a; color: #fff; }
.chat .card button.b.keep:hover { background: #ff7d36; }
button.b.on { background: rgba(255,255,255,.22); }
button.b .ic { display: inline-grid; vertical-align: -2px; margin-right: 6px; }
button.b .ic svg { width: 14px; height: 14px; }
`;

export interface PlayMoveOptions {
  win: Window & typeof globalThis;
  core: Core;
  rules: RulesHolder;
  /** The world's adapter (play-ask's findAdapter: the game's own probes first). */
  adapter: () => StudioAdapter | null;
  /** The draft shown at Play (bridge showFileEditsInPlay): settles with the keys its motions move. */
  arranged: Promise<string[]>;
  /** To the editor page. Only "Put in layout" goes there. */
  post: (m: BridgeToShell) => void;
  el: <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => HTMLElementTagNameMap[K];
  w: (k: string) => string;
  lang: () => Lang;
  config: () => GameConfig | null;
  handlePx: () => number;
  /** The pause panel (the strip keeps clear of it: core/ui inset). */
  panel: () => HTMLElement | null;
  /** A press on the overlay (the panel): not a press in the game. */
  ignore: (e: Event) => boolean;
  /** The card changed: draw the panel again. */
  changed: () => void;
}

export interface PlayMove {
  /** The editor is up (the panel shows the card). */
  readonly on: boolean;
  /** The card, for the panel. */
  readonly card: HTMLElement;
  /** Something is picked (Escape then goes to the editor: it drops the tool, then the pick). */
  picked(): boolean;
  /** Wake the editor over the paused game. false = nothing to move with (no adapter found). */
  start(): boolean;
  /** Put the editor away (the moved objects stay where they are). */
  stop(): void;
  /** The pause ends (Resume): what the person moved is theirs from now on, not the game's. */
  resumed(): void;
  /** The words again (play/on). */
  render(): void;
}

export function createPlayMove(o: PlayMoveOptions): PlayMove {
  const { win, el, w } = o;
  let editor: Editor | null = null;
  let editorOf: StudioAdapter | null = null;
  let on = false;
  // Play's start, the person's own places, and the motions (see momentWhy).
  let start: Map<string, Pose> | null = null;
  const mine = new Map<string, Pose>();
  let moving = new Set<string>();
  // This pause: each object's pose at the pause and why it is "this moment only" (computed once per pause, before any
  // drag), the objects moved since, and what went in the layout (its pose then).
  let atPause: Map<string, Pose> | null = null;
  let why = new Map<string, MomentWhy>();
  const kept = new Map<string, Pose>();
  let pick: string | null = null;
  const items = new Map<string, Item>();
  let insetSig = '';

  const list = (a: StudioAdapter): Item[] => {
    try {
      return a.list();
    } catch {
      return [];
    }
  };
  // Where everything was when Play started: once the draft is shown and the game lists its objects (looked for every
  // 150 ms for up to ~30 s after the first frame: a big scene on a slow machine lists late — Lantern Cove in the
  // headless test's software GL took more than the 5 s showFileEditsInPlay waits). A pause before that takes the
  // pause's own list.
  void o.arranged.then(async (keys) => {
    moving = new Set(keys);
    await o.core.time.firstFrame();
    for (let i = 0; i < 200 && !start && !atPause; i++) {
      const a = o.adapter();
      const l = a ? list(a) : [];
      if (l.length) {
        if (!atPause) start = new Map(l.map((it) => [it.key, it.pose] as const));
        return;
      }
      await new Promise((r) => win.setTimeout(r, 150));
    }
  }).catch(() => {});

  const card = el('div', 'card');
  card.dataset.part = 'pause-move-card';

  const dimOf = () => editorOf?.dim ?? '3d';
  const poseNow = (key: string): Pose | undefined => {
    const a = editor?.driven;
    if (!a) return undefined;
    return list(a).find((i) => i.key === key)?.pose;
  };

  /** The editor's messages: the card follows the pick and the moves; nothing goes to the editor page. */
  const fromEditor = (m: BridgeToShell) => {
    if (m.type === 'studio:placement/selected') {
      pick = m.key;
      if (m.item) items.set(m.item.key, m.item);
      draw();
    } else if (m.type === 'studio:placement/items') {
      for (const it of m.items) items.set(it.key, it);
    } else if (m.type === 'studio:placement/moved') {
      if (m.key === pick) draw();
    } else if (m.type === 'studio:placement/moved-group') {
      if (m.poses.some((p) => p.key === pick)) draw();
    }
  };

  const tell = (m: ShellToBridge) => editor?.handle(m);

  /** What the panel covers, so the strip and the camera-height buttons stay clear of it (Edit's core/ui inset). */
  const sendInset = () => {
    const p = o.panel();
    if (!p || !on) return;
    const r = p.getBoundingClientRect();
    const W = win.innerWidth, H = win.innerHeight;
    // A sheet across the foot (narrow screens) covers the bottom; the card at the top right covers the right.
    const inset: Inset = r.width > W * 0.7 ? { top: 0, right: 0, bottom: Math.max(0, Math.round(H - r.top)), left: 0 } : { top: 0, right: Math.max(0, Math.round(W - r.left)), bottom: 0, left: 0 };
    const sig = JSON.stringify(inset);
    if (sig === insetSig) return;
    insetSig = sig;
    tell({ type: 'studio:core/ui', handlePx: o.handlePx(), theme: 'dark', inset });
  };

  function button(cls: string, text: string, tip: string, action: string, fn: () => void) {
    const b = el('button', `b ${cls}`.trim(), text) as HTMLButtonElement;
    b.type = 'button';
    b.title = tip;
    b.dataset.action = action;
    b.addEventListener('click', (e) => {
      fn();
      // Pressed with the mouse or a finger: the keys go back to the game page (the editor's M / T / arrows), not to the
      // panel. From the keyboard (Enter on it: detail 0) the focus stays.
      if (e.detail > 0) b.blur();
    });
    return b;
  }

  function putInLayout(key: string) {
    const pose = poseNow(key);
    if (!pose) return;
    // `from`: where the editor page has it now (what Undo in Edit goes back to) — the last place put in the layout in
    // this play, else Play's start (the draft and the code, as the game opened).
    const from = kept.get(key) ?? start?.get(key) ?? atPause?.get(key);
    o.post({ type: 'studio:placement/moved', key, pose, end: true, ...(from ? { from } : {}) });
    kept.set(key, pose);
    draw();
  }
  function putBack(key: string) {
    const to = atPause?.get(key);
    if (!to) return;
    tell({ type: 'studio:placement/pose', key, pose: to });
    // Put in the layout during this pause: the layout goes back with it (to the editor page, one more move — its Undo
    // in Edit steps through both).
    const k = kept.get(key);
    if (k && !samePose(k, to, dimOf())) {
      o.post({ type: 'studio:placement/moved', key, pose: to, end: true, from: k });
      kept.delete(key);
    }
    draw();
  }

  function draw() {
    card.replaceChildren();
    if (!on) return;
    const key = pick;
    if (!key) {
      card.append(el('div', 'hint', w('moveHow')));
      done();
      return;
    }
    const it = items.get(key);
    const pose = poseNow(key) ?? it?.pose;
    const dim = dimOf();
    card.append(el('div', 'name', it?.label || key));
    if (pose) card.append(el('div', 'nums', poseWords(pose, dim)));
    const moved = !!pose && !samePose(pose, atPause?.get(key), dim);
    const acts = el('div', 'acts');
    const reason = why.get(key) ?? null;
    if (reason) {
      const p = el('div', 'why');
      p.dataset.part = 'pause-move-moment';
      p.append(el('b', '', w('moveMoment')), o.win.document.createTextNode(' · ' + w('moveMomentWhy')));
      card.append(p);
    } else {
      const inLayout = !!pose && kept.has(key) && samePose(kept.get(key), pose, dim);
      if (inLayout) {
        const p = el('div', 'why', w('moveIn'));
        p.dataset.part = 'pause-move-in';
        card.append(p);
      } else if (moved) {
        const p = el('div', 'why', w('moveOnly'));
        p.dataset.part = 'pause-move-only';
        card.append(p);
        acts.append(button('keep', w('toLayout'), w('toLayoutTip'), 'pause-to-layout', () => putInLayout(key)));
      } else card.append(el('div', 'hint', w('moveHow')));
    }
    if (moved) acts.append(button('', w('putBack'), w('putBackTip'), 'pause-put-back', () => putBack(key)));
    if (acts.childNodes.length) card.append(acts);
    done();
  }
  /** The panel drawn with the new card, then what it covers now (a phone's sheet grows with the card: the strip under
   * the pick must stay above it — measured before the card was drawn, the strip sat under the sheet's top). */
  function done() {
    o.changed();
    sendInset();
  }

  return {
    get on() {
      return on;
    },
    card,
    picked: () => !!pick,
    start() {
      if (on) return true;
      const a = o.adapter();
      if (!a) return false;
      if (!editor || editorOf !== a) {
        editorOf = a;
        // The world only: the game's HTML UI is not moved from a pause (it is laid out by the page, not by a moment).
        editor = createEditor({ adapter: a, ui: null, core: o.core, win, post: fromEditor, rules: o.rules, tools: [], paused: true, ignore: o.ignore });
        // For tests (test/studio-pause.browser.mjs), like `_debug` in Edit and `_play`: where an object is on screen,
        // what is right under a point, and why it is "this moment only". Not enumerable, nothing else uses it.
        const api = (win as unknown as { __gameStudio?: object }).__gameStudio;
        const ed = editor;
        if (api && !Object.prototype.hasOwnProperty.call(api, '_move')) {
          Object.defineProperty(api, '_move', {
            value: Object.freeze({
              anchor: (k: string) => ed.driven.anchor(k),
              // `r`: the pick's own slack (UI.pickRadiusMouse / Touch) to ask what a press there picks; 0 = right under it.
              under: (x: number, y: number, r = 0) => { try { return ed.driven.pickNear(x, y, r)[0] ?? null; } catch { return null; } },
              list: () => list(ed.driven),
              why: (k: string) => why.get(k) ?? null,
            }),
            enumerable: false,
          });
        }
      }
      // Once per pause, before any drag: each object's pose now, and which ones the game moves itself.
      if (!atPause) {
        const now = list(a);
        atPause = new Map(now.map((i) => [i.key, i.pose] as const));
        if (!start) start = new Map(atPause);
        why = new Map(now.map((i) => [i.key, momentWhy(i.key, i.pose, start!, mine, moving, a.dim)] as const));
      }
      on = true;
      insetSig = '';
      tell({ type: 'studio:core/lang', lang: o.lang() });
      tell({ type: 'studio:core/config', config: o.config() });
      tell({ type: 'studio:core/edit', on: true });
      sendInset();
      draw();
      return true;
    },
    stop() {
      if (!on) return;
      tell({ type: 'studio:placement/select', key: null });
      tell({ type: 'studio:core/edit', on: false });
      on = false;
      pick = null;
      draw();
    },
    resumed() {
      // What the person moved stays theirs: the next pause does not take it for the game's own motion.
      if (atPause && editorOf) {
        for (const it of list(editorOf)) {
          const was = atPause.get(it.key);
          if (why.get(it.key) || !was || samePose(was, it.pose, editorOf.dim)) continue;
          mine.set(it.key, it.pose);
        }
      }
      atPause = null;
      why = new Map();
    },
    render: () => draw(),
  };
}

/** The strip's button size when the editor page did not say (play/on handlePx): Edit's, bigger for a finger. */
export function defaultHandlePx(win: Window): number {
  return win.matchMedia && win.matchMedia('(pointer: coarse)').matches ? UI.handlePxPhone : UI.handlePx;
}
