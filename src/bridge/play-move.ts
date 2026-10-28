// The paused moment's objects (pause-edit, 2026-10-28; before: "Move things where the game stopped", pause stage 2,
// 2026-10-22). A request of 2026-10-28: "pause in the middle of a scene and give instructions, by hand or to the AI" —
// answered as "the paused moment becomes the editor". CONTRACT.md §3.5.1.
//
// The person pressed P (or ❚❚ Pause to edit) in ▶ Play. The game is held where it was (play-pause.ts) and the
// editor's own editor (editor.ts, the one Edit uses) wakes over it: the same pick, outline, strip, card, list — the
// editor page's whole Edit set, not a panel of its own (stage 2 had a card in a chat panel, "✥ Move / Talk" and M;
// gone). Nothing goes back to where Play started: the view is the player's, the enemy is mid-jump, the score is the
// score. Two ways the editor wakes:
//   - an edit page that became Play (fast switch, play-switch.ts): its own editor, told `core/edit {moment: true}`;
//   - a page opened for Play (Play from the start, the AI's Reload): createMomentEditor below, as stage 2 did, but its
//     messages now go to the editor page (the list, the card, Save · N, ⌘Z all are the editor page's).
// Either way the editor is EditorDeps.paused: the player's camera kept (no saved edit camera, no "everything in frame"),
// the game never let run (no watch), no self-check, key releases reach the game.
//
// What each object is (decision 5; the call made 2026-10-28: a placed thing moved in a moment goes in the scene, as in
// Edit) — momentWhy, sent with play/paused `why`:
//   - placed (null): moving it is the same as in Edit — it goes in the scene (Save · N, ⌘Z, the list's dot), stays
//     after Resume, and is still there back in Edit.
//   - the game moves it ('game'), a motion moves it ('motion'), the game made it since Play ('new'): just for this
//     moment. Resume and the game goes on from where it was put; Edit shows the scene before Play (it is not in it).
//     What the game made gets "✦ Have Claude make it appear here" on its card (the AI changes the game's code).
// Found by comparing where each object is at the pause with where it was when Play started (or where the person last
// left it in an earlier pause of this play): anything that moved by itself in between, anything the game made since
// (not there at the start), and anything the draft's motions move.
import type { BridgeToShell, GameConfig, Item, Lang, MomentKind, Pose, ShellToBridge, StudioAdapter } from '../contract.ts';
import { UI } from '../contract.ts';
import type { Core } from '../core/index.ts';
import type { RulesHolder } from '../core/rules.ts';
import { createEditor, type Editor } from './editor.ts';
import { drivenBetween } from './observe.ts';
import { nativeSetTimeout } from '../core/native.ts';

/** One pose as observe.ts compares them (it reads only key and pose). */
const one = (key: string, pose: Pose) => [{ key, pose } as unknown as Item];

/** Why an object can only be moved for this moment (null = placed: moved as in Edit). */
export type MomentWhy = MomentKind | null;

/**
 * The pure part (test/pause.test.ts): is this object placed, or the game's for this moment? `start` = the poses when
 * Play started (after the editor's draft was shown), `mine` = where the person left objects in an earlier pause of this
 * play (the game did not move those: the person did), `moving` = the keys the draft's motions move, `now` = its pose
 * at the pause.
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

/** "X 8.5 · Y 0.0 · Z 9.6" (3D, metres) / "X 120 · Y 40" (2D, px), as Edit's card rounds them. */
export function poseWords(p: Pose, dim: '2d' | '3d'): string {
  // `+ 0` after rounding: no "-0.0" for a height a hair under the ground.
  const n = (v: number | undefined) => (dim === '3d' ? (Math.round((v ?? 0) * 10) / 10 + 0).toFixed(1) : String(Math.round(v ?? 0) + 0));
  return dim === '3d' ? `X ${n(p.p[0])} · Y ${n(p.p[1])} · Z ${n(p.p[2])}` : `X ${n(p.p[0])} · Y ${n(p.p[1])}`;
}

/**
 * Who wakes the editor over the paused game (play-ask.ts pauseNow): an edit page's own editor (play-switch.ts
 * momentHost) or the one a Play page makes (createMomentEditor).
 */
export interface MomentHost {
  /** Wake the editor over the paused game; everything stays where it is. false = nothing to edit with (no adapter). */
  wake(): boolean;
  /** Put it away (what was moved stays where it is now). */
  sleep(): void;
  /** The world as the editor drives it (copies and rules applied): the list the editor page sees, and the kinds. */
  driven(): StudioAdapter | null;
  /** A Play page only: the editor page's messages while the editor is up (an edit page's bridge routes its own). */
  handle?(m: ShellToBridge): void;
}

/** Where things were when Play started, what the person moved, what the motions move: the kinds of each pause. */
export interface MomentKinds {
  /** A new Play of the same page (fast switch): `arranged` settles with the keys the draft's motions move. */
  restart(arranged: Promise<string[]>): void;
  /** Each object's kind at a pause, before any drag (only the game's ones are listed). */
  pause(list: Item[], dim: '2d' | '3d'): Record<string, MomentKind>;
  /** Resume: what the person moved is theirs from now on (the next pause does not take it for the game's motion). */
  resumed(list: Item[], dim: '2d' | '3d'): void;
  why(key: string): MomentWhy;
  /**
   * A page opened from a checkpoint (pause-edit stage 3): `scene` = the keys of the scene's objects (the editor's Edit
   * list). The page starts with the checkpoint's boss, drones and shots already there, so "not there when Play started"
   * no longer finds them: anything not in the scene is made by the game. Empty = not known (as a Play from the start).
   */
  madeBefore(scene: string[]): void;
}

/**
 * `startList` = the objects as Play started them (an edit page: what its editor drives; a Play page: the adapter
 * found). Looked for once the draft is shown and the game lists its objects (every 150 ms for up to ~30 s after the
 * first frame: a big scene on a slow machine lists late — Lantern Cove in the headless test's software GL took more than
 * the 5 s showFileEditsInPlay waits). A pause before that takes the pause's own list.
 */
export function createMomentKinds(startList: () => Item[], firstFrame: () => Promise<void>, arranged: Promise<string[]>): MomentKinds {
  let start: Map<string, Pose> | null = null;
  const mine = new Map<string, Pose>();
  let moving = new Set<string>();
  let atPause: Map<string, Pose> | null = null;
  let why = new Map<string, MomentKind>();
  // madeBefore(): the scene's keys on a page opened from a checkpoint (null = a Play from the start: not needed).
  let scene: Set<string> | null = null;
  // Which Play this is (▶ Play in the same page starts these again, restart()); a look still going from an earlier one stops.
  let run = 0;
  const findStart = (a: Promise<string[]>) => {
    const mine0 = ++run;
    void a.then(async (keys) => {
      if (mine0 !== run) return;
      moving = new Set(keys);
      await firstFrame();
      for (let i = 0; i < 200 && !start && !atPause && mine0 === run; i++) {
        let l: Item[] = [];
        try {
          l = startList();
        } catch {
          l = [];
        }
        if (l.length) {
          if (!atPause) start = new Map(l.map((it) => [it.key, it.pose] as const));
          return;
        }
        await new Promise((r) => nativeSetTimeout(r, 150));
      }
    }).catch(() => {});
  };
  findStart(arranged);
  return {
    restart(a) {
      start = null;
      mine.clear();
      moving = new Set();
      atPause = null;
      why = new Map();
      scene = null;
      findStart(a);
    },
    pause(list, dim) {
      atPause = new Map(list.map((i) => [i.key, i.pose] as const));
      if (!start) start = new Map(atPause);
      why = new Map();
      for (const i of list) {
        let w = momentWhy(i.key, i.pose, start, mine, moving, dim);
        // Opened from a checkpoint: the game made what the scene does not have, wherever it stood at this page's start.
        if (scene && w !== 'motion' && !scene.has(i.key) && !mine.has(i.key)) w = 'new';
        if (w) why.set(i.key, w);
      }
      return Object.fromEntries(why);
    },
    madeBefore(keys) {
      scene = keys.length ? new Set(keys) : null;
    },
    resumed(list, dim) {
      if (atPause) {
        for (const it of list) {
          const was = atPause.get(it.key);
          if (why.get(it.key) || !was || samePose(was, it.pose, dim)) continue;
          mine.set(it.key, it.pose);
        }
      }
      atPause = null;
      why = new Map();
    },
    why: (key) => why.get(key) ?? null,
  };
}

export interface MomentEditorOptions {
  win: Window & typeof globalThis;
  core: Core;
  rules: RulesHolder;
  /** The world's adapter (play-ask's findAdapter: the game's own probes first). */
  adapter: () => StudioAdapter | null;
  /** To the editor page: everything the editor says, as an edit page's editor would (but its edit camera). */
  post: (m: BridgeToShell) => void;
  lang: () => Lang;
  config: () => GameConfig | null;
  handlePx: () => number;
  /** A press on the overlay (the corner, the ✦ field): not a press in the game. */
  ignore: (e: Event) => boolean;
}

/**
 * The editor of a page opened for Play (a MomentHost). Its messages go to the editor page like an edit page's — but
 * not core/view-state: that is the edit camera the editor page keeps for its next edit page, and the moment's camera is
 * the player's.
 */
export function createMomentEditor(o: MomentEditorOptions): MomentHost & { readonly editor: Editor | null } {
  const { win } = o;
  let editor: Editor | null = null;
  let editorOf: StudioAdapter | null = null;
  let on = false;
  const toShell = (m: BridgeToShell) => {
    if (m.type === 'studio:core/view-state') return;
    o.post(m);
  };
  return {
    get editor() {
      return editor;
    },
    wake() {
      if (on) return true;
      const a = o.adapter();
      if (!a) return false;
      if (!editor || editorOf !== a) {
        editorOf = a;
        // The world only: the game's HTML UI is not moved from a pause (it is laid out by the page, not by a moment).
        editor = createEditor({ adapter: a, ui: null, core: o.core, win, post: toShell, rules: o.rules, tools: [], paused: true, ignore: o.ignore });
      }
      on = true;
      editor.handle({ type: 'studio:core/lang', lang: o.lang() });
      editor.handle({ type: 'studio:core/config', config: o.config() });
      editor.handle({ type: 'studio:core/ui', handlePx: o.handlePx(), theme: 'dark' });
      editor.handle({ type: 'studio:core/edit', on: true });
      return true;
    },
    sleep() {
      if (!on || !editor) return;
      editor.handle({ type: 'studio:placement/select', key: null });
      editor.handle({ type: 'studio:core/edit', on: false });
      on = false;
    },
    driven: () => (editor && on ? editor.driven : null),
    handle(m) {
      if (on && editor) editor.handle(m);
    },
  };
}

/** The strip's button size when the editor page did not say (play/on handlePx): Edit's, bigger for a finger. */
export function defaultHandlePx(win: Window): number {
  return win.matchMedia && win.matchMedia('(pointer: coarse)').matches ? UI.handlePxPhone : UI.handlePx;
}
