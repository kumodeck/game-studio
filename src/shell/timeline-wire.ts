// The timeline's state and its ties to the rest of the shell (studio-timeline, 2026-10-22; CONTRACT.md §1.9). The plate (timeline-panel.ts) draws and reports presses; the maths is in
// timeline-model.ts and the loader; this file decides what a press, a drag in the game or a typed number does.
//
// The one rule people meet ("auto key"):
//   timeline open and ● on → moving / turning / resizing an object, or typing its numbers, sets a key at the time
//     line (an object with no motion yet, moved after 0 s, gets its first clip with a key at 0 s of how it stood);
//   ● off, or the timeline folded → it moves where the object stands (its place), and its motion comes along.
// WHY decided here and not in the game page: the bridge's drag code (input.ts, handles.ts, group.ts, snap.ts) stays
// exactly as it is — it moves the object and says where it is now (placement/moved); only what the shell does with
// that pose differs. The tools under the object, snapping, ↑↓ and the card all set keys without knowing it.
//
// The game page shows each moving object at its place + its clip at the time line (timeline/pose, worked out here
// with the loader's clipAt), through the copy/delete layer: not an edit, nothing comes back. Folding sends the places.
//
// WHY its own file: main.ts is 3,900 lines and other members change it the same week; main.ts only routes moves,
// the card's numbers, undo and the bridge's messages through here.
import type { BridgeToShell, CodeAt, CodeMotionInfo, Dim, LibraryMotion, Motion, MotionChannel, MotionClip, MotionEase, MotionKey, MotionRepeat, MotionUntil, MotionWhen, Pose, ShellToBridge } from '../contract.ts';
import { ruleKnobsAfter, ruleOf, ruleWords, type RuleInfo } from './rule-motion.ts';
import { handPath, type HandMotion } from './to-rule.ts';
import { motionRunner, whenOf, whensOf } from '../loader/studio-placement.js';
import { bend, insertAt, pointKind, setKind, toggleCorner, type PointKind } from './path-edit.ts';
import { asOrdinary, asScene, joinClip, likeScene, sceneMembers, trackOrder as sceneOrder, withOrder, withTrack, withoutTrack } from './scene-motion.ts';
import { libOf, type MotionLibrary } from './motion-library.ts';
import { motionCardRow, type MotionCardDeps } from './motion-card.ts';
import type { MotionStore } from './motion-model.ts';
import { sameMotion as sameFile } from './motion-model.ts';

/**
 * Same motion as the timeline sees it (resolved: the Library motion's keys in each clip). The file's own comparison
 * (motion-model sameMotion) would see only `use` + when for a clip that uses a Library motion, so a key moved would
 * not count as a change: compare the clips with their keys, and the Library names too.
 */
const sameMotion = (a: Motion | null | undefined, b: Motion | null | undefined) => {
  const inline = (m: Motion | null | undefined) => (m?.clips ? { clips: m.clips.map(({ use, ...c }) => ({ ...c, name: `${c.name}\u0000${use ?? ''}` })) } : m);
  return sameFile(inline(a), inline(b));
};
import { createTimelinePanel, type TimelineView } from './timeline-panel.ts';
import {
  blankClip, CHANNELS, changedChannels, compose, copyKeys, deleteKeys, easeKeys, keyTimes, MAX_CLIPS, MAX_LEN, MIN_LEN, moveKeys,
  keyName, offsetOf, offsetsAt, pasteKeys, refId, restOf, SAME_T, sameT, setKey, snapT, stretchClip, withClip, type Copied, type KeyRef, type Offsets,
} from './timeline-model.ts';
import type { Change, UndoStack } from './undo.ts';

export interface TimelineDeps {
  /** The world's motions (worldModel.motion; a getter: a game with levels has one model per level). */
  readonly store: MotionStore;
  /**
   * The Library's motions (studio-motion-triggers, 2026-10-22; motion-library.ts): the store's clips are attachments
   * (`use` + when / until); their len / repeat / keys live here. This file reads and writes the two together.
   */
  readonly lib: MotionLibrary;
  /** The other levels' motions (their world parts waiting in levels.ts): a rename or a delete in the Library reaches them. */
  others(): Array<Record<string, Motion>>;
  undo: UndoStack;
  send(m: ShellToBridge): void;
  dim(): Dim;
  /** The timeline can be shown now: editing the world of a 3D game, not playing, the Scene on screen. */
  usable(): boolean;
  /** The one picked object (null with none or several). */
  picked(): string | null;
  /**
   * studio-motion-focus: every picked object (Multi-select / a box), for the rows — the timeline shows the picked ones
   * only. Absent = the one of picked().
   */
  group?(): string[];
  /**
   * studio-motion-focus: give the pick back to `key` after a click in the game linked another object ("+ Link an
   * object" open: the click is a link, not a pick). Absent = no linking from the game (the list still links).
   */
  reselect?(key: string): void;
  /** Where an object stands (its place: the model's pose, saved or not). */
  place(key: string): Pose | undefined;
  /** The scene's objects in the list's order (rows follow it). */
  order(): string[];
  label(key: string): string;
  /** Pick an object (a row's name pressed). */
  select(key: string): void;
  /** Something changed that the card and the Save count show. */
  changed(): void;
  /** The plate opened, folded or changed height: the shell lays the bottom out again. */
  layout(): void;
  /** The card's numbers again (the time line moved: they show the object as it stands then). */
  numbers(): void;
  narrow(): boolean;
  t(key: string, vars?: Record<string, string | number>): string;
  /**
   * Things the person did once, kept (this browser or this game's ui prefs): studio-motion-line's "timeline-fine" — Fine-tune
   * was opened, so the plate opens with it open. (studio-motion-flow's "timeline-steps", the first-time three steps, is gone.)
   * Absent = nothing remembered.
   */
  seen?(id: string): boolean;
  markSeen?(id: string): void;
  /**
   * studio-motion-panel (a review of 2026-10-22): ✦ Ask AI on a motion — the shell puts the "object · motion" chip in the chat box
   * and the cursor there (`name` = the clip's name on screen, `use` = its Library motion). Absent = no AI here: no button.
   */
  ask?(key: string, motion: { name: string; use: string }): void;
  /**
   * The game page's rule motions (codeMotion; studio-code-knobs, 2026-10-24): their knobs with the code's numbers, their
   * round. [] / absent = not said yet (a page opening, a game without any). A rule motion's strip, line and ◇ read them.
   */
  codeMotions?(): CodeMotionInfo[];
  /** A one-line notice with the way back ("Made “Spiral” into editable points (16) · ⌘Z undoes it"). Absent = none. */
  told?(text: string): void;
  /**
   * ✦ Turn into a rule (studio-code-torule, 2026-10-24): the points Library motion `name` had before the AI made it a
   * rule, the editor's measure of the gap ("0.1 m (1.2 s)", null = not measured) and whether the comparison is on —
   * until Save (shell/to-rule.ts RuleCompare). null = nothing to compare (never replaced, ⌘Z'd, saved).
   */
  compare?(name: string): { hand: HandMotion; gap: string | null; at: string | null; on: boolean } | null;
  /**
   * ✦ Turn into a rule… on a motion of points (the card's Motion row menu): like `ask`, with the draft "Turn into a close
   * rule" in the chat box and the request marked `intent: 'to-code'`. Absent = no AI here: no row.
   */
  toRule?(key: string, motion: { name: string; use: string }): void;
  /** The line's "Compare with original" switched (one switch with the card's: the person wants the marks or not). */
  compareShow?(on: boolean): void;
  /** A knob of a compared rule turned: measure it again (the game page runs the rule; compare() then has the new gap). */
  remeasure?(name: string): void;
}

/**
 * `makePanel`: the plate (timeline-panel.ts). The unit tests give a stand-in with no DOM, so what a move, a typed number
 * or a key press does is tested without a browser (test/timeline.test.ts).
 */
/**
 * "Fine-tune" was opened once (studio-motion-line, 2026-10-23; TimelineDeps.seen): from then on the plate opens with it
 * open. WHY two places: `seen` is the game's ui prefs (.studio/ui/prefs.json — the studio opens on a free port, so the
 * browser's storage alone forgets it on the next run), but `seen` only ever adds; "closed again" is the browser's
 * (FINE_KEY below), so a person who closes it is not given it open again on this machine.
 */
const FINE_SEEN = 'timeline-fine';
/**
 * "Make editable points" (studio-code-knobs): points a round of a rule motion — the plan's 16 (its words table, "Make editable
 * points": "16 a turn"). Enough for a circle to read as one, few enough to drag by hand.
 */
const POINTS_PER_ROUND = 16;
const FINE_KEY = 'studio.tl.fine';
/** How long "✓ “Hop” attached" stays when nothing is chosen (then the row reads "Starts" again). */
const FRESH_MS = 6000;

export function createTimeline(d: TimelineDeps, makePanel: typeof createTimelinePanel = createTimelinePanel) {
  let open = false;
  let auto = true;
  let time = 0;
  // ▶: the time line runs from `from` at real time `t0` (performance.now).
  let playing: { t0: number; from: number } | null = null;
  let raf = 0;
  // Which of its clips each object shows (absent = its first, or the one that plays at the start).
  const chosen = new Map<string, string>();
  const openRows = new Set<string>();
  let focusKey: string | null = null;
  let sel: KeyRef[] = [];
  let clipboard: Copied | null = null;
  // The plate was the last thing pressed: Delete / ⌘C / ⌘V / K go to its keys, not to the scene's objects.
  let touched = false;
  // A drag in the game / of a number / of keys in progress: the motions before it (its one undo step starts there).
  let before: Map<string, Motion | null> | null = null;
  // …and what each object showed when it began (the channels a gesture changed are measured from here).
  const startPose = new Map<string, Pose>();
  /** The first message of a gesture on `key`: remember its motion and pose before it. */
  const begin = (key: string, was?: Pose) => {
    if (!before) before = new Map();
    if (before.has(key)) return;
    before.set(key, store().get(key));
    startPose.set(key, was ?? shownPose(key)!);
  };
  const gestureNames = new Map<string, string>();
  /**
   * A new motion's first name (studio-words-plan, 2026-10-23): "gate’s motion" (motion.firstName, both languages), free in the Library
   * ("gate’s motion 2"…). It was "Motion" in both languages — a hands-on look: the Japanese screen showed English, and
   * five objects' motions read the same. Only new ones: a name already saved is the person's (or the AI's) and stays.
   */
  const firstName = (key: string) => lib().free(d.t('motion.firstName', { name: d.label(key) }));
  /**
   * The Library motions this gesture made (a first clip: its name in gestureNames), as the first changes of its undo step
   * (studio-motion-line, 2026-10-23: one drag = one undo step and nothing left behind). Before, ⌘Z took the object's motion
   * off but the new "gate’s motion" stayed in the Library — and Save still said 1. Call before finish() (it clears them).
   */
  const madeInGesture = (): Change[] => [...gestureNames.values()].flatMap((n) => {
    const l = lib().get(n);
    return l ? [{ kind: 'motion-lib' as const, key: n, from: null, to: structuredClone(l) }] : [];
  });
  const finish = () => {
    gestureNames.clear();
    const from = before;
    before = null;
    startPose.clear();
    return from;
  };
  let keyDrag: { sel: KeyRef[]; from: Map<string, Motion | null> } | null = null;
  // studio-motion-flow: a motion just attached (a drop, the card, the Library) — the second row says "✓ “Hop” attached ·
  // When does it move?" with Starts ▾ open, until a "when" is chosen or 6 s pass (then it reads "Starts" again).
  let fresh: { key: string; name: string; timer: ReturnType<typeof setTimeout> | 0 } | null = null;
  /**
   * The object whose first motion was just made by moving it (studio-tool-clear, 2026-10-23): the line says what it
   * does now ("✓ moves from 0 s to 1 s · ▶ to watch") and asks "When does it move?" — the next step, on screen. Until a
   * "when" is chosen or another object is shown.
   */
  let madeKey: string | null = null;
  /**
   * "Make a motion" in progress (studio-no-presets, 2026-10-23: a review, on the kinds — "we don't need them": a
   * motion is made by showing it). `shown` false: the time line waits at 1 s, the line says "drag it where it should
   * move (Esc to cancel)", and the object shows as it stands (a thing that moves already: its other motions hidden,
   * the next move starts a new one). `shown` true: the first move made the motion and it played; each next move / turn
   * / resize adds a key one second after the last (`from` = that last key's time) and plays the new second.
   * Ends with Esc or "Done" (what was made stays: ⌘Z takes one key at a time), another object, the time line moved by
   * hand, or the timeline folded.
   * WHY one second each: the person shows poses, not times (Blender / Unity ask for the time first — the ruler — which
   * the hands-on tries never found); the length of a step is then dragged on the timeline (keys move), as there.
   * Its own one line says the next step, so the first-time three steps ("1 Pick a moment on the ruler…") stay away.
   */
  let making: { key: string; shown: boolean; from: number } | null = null;
  /**
   * "Fine-tune" open (the rows of the old ⋯, in the plate beside the timeline): set by hand this session, else null =
   * as remembered (FINE_KEY, then FINE_SEEN). WHY read each time and not once here: the game's ui prefs come from the
   * server after the shell starts, so a read at start would miss "opened before" on a fresh port.
   */
  let fine: boolean | null = null;
  /**
   * Folded to its one line (studio-fix-0143, ⑨ B of the first-run check, a review of 2026-10-24): an object picked from the
   * list was under the plate, and the camera may not pull back to show it. The line (▶, the sentence, Fine-tune, ⌄)
   * stays; the rows and the Fine-tune sheet come back with Fine-tune pressed (its ⌃), and closing the plate ends it.
   */
  let slim = false;
  const fineNow = (): boolean => {
    if (fine !== null) return fine;
    try {
      const v = globalThis.localStorage?.getItem(FINE_KEY);
      if (v === '0' || v === '1') return v === '1';
    } catch {
      /* private window: the prefs still say */
    }
    return !!d.seen?.(FINE_SEEN);
  };
  // Starts ▾ to focus at the next render (the one that draws the "attached" line).
  let focusStarts = false;
  // What the game page shows now, so a frame that changes nothing sends nothing.
  let sentPoses = '';
  let sentPath = '';
  // What the game page was last told about recording (studio:timeline/recording), null = nothing yet.
  let sentRec: boolean | null = null;

  const raw = () => d.store;
  const lib = () => d.lib;
  // ----- rule motions (studio-code-knobs, 2026-10-24; rule-motion.ts) -----
  /** The rule behind a clip (its Library motion's `code`), with the game page's knobs; null = a motion of points. */
  const ruleFor = (c: MotionClip | null | undefined): RuleInfo | null => {
    if (!c) return null;
    const list = d.codeMotions?.() ?? [];
    return ruleOf(lib().get(c.use ?? c.name), list.length ? list : null);
  };
  /** The rule motions of these objects at `t` (their knob values: the file's over the code's — the page merges them). */
  const rulesAt = (keys: string[], t: number): CodeAt[] => keys.flatMap((k) => {
    const c = clipOf(k);
    const l = c && !c.off ? lib().get(c.use ?? c.name) : undefined;
    return l?.code ? [{ key: k, code: l.code, t, knobs: Object.fromEntries(Object.entries(l.knobs ?? {}).map(([n, x]) => [n, x.v])) }] : [];
  });
  /** A rule's knob values now (code's, then the file's), for the page's path and its points. */
  const ruleValues = (r: RuleInfo) => Object.fromEntries(r.knobs.map((k) => [k.name, k.v]));
  /** ✦ Turn into a rule (studio-code-torule): the points a rule replaced, shown to compare (null: none, or switched off). */
  const comparing = (libName: string) => {
    const x = d.compare?.(libName);
    return x && x.on ? x : null;
  };
  /** The path message's `was`: the replaced points' path over one round of the rule (none: 4 s) and the points themselves. */
  const wasOf = (libName: string, round: number | null) => {
    const x = comparing(libName);
    return x ? { was: { pts: handPath(x.hand, round && round > 0 ? round : 4), keys: x.hand.keys.map((k) => k.v.slice()) } } : {};
  };
  // "Make editable points" waiting for the page's answer (timeline/code-points): its id, the Library motion, its length.
  let pointsAsk: { id: number; name: string; len: number; per: number } | null = null;
  let pointsId = 0;
  // A rule's knob being turned (the line's knob or the path's ◇): its Library motion before it (one undo step).
  let knobFrom: { name: string; lib: LibraryMotion } | null = null;
  /**
   * An object's motion as the timeline works on it: each attachment with its Library motion's len / repeat / keys filled
   * in (`use` kept), so every edit below — keys, length, repeat — is a clip edit as before. A clip whose motion is not
   * in the Library (deleted) is left out.
   */
  // A scene motion (studio-timeline-2: `tracks`) gives each object its own track as the clip's keys, marked `scene`.
  const resolve = (key: string, m: Motion | null): Motion | null => {
    if (!m?.clips) return m;
    const clips = m.clips.flatMap((c) => {
      if (!c.use) return [c];
      const l = lib().get(c.use);
      if (!l) return [];
      return [{ ...c, name: c.name || c.use, len: l.len, repeat: l.repeat, keys: l.tracks ? structuredClone(l.tracks[key] ?? {}) : l.keys, ...(l.tracks ? { scene: true } : {}) }];
    });
    return clips.length ? { clips } : null;
  };
  /**
   * The other way: each clip's len / repeat / keys go to its Library motion (named by `use`, or by its own name for a
   * clip made here), the object keeps { use, when, until }. A `start: true` from a template becomes when: start.
   */
  // A scene clip writes only this object's track of the scene (the others' tracks stay); an object no longer in a scene
  // loses its track there (taken out — and an undo of that puts it back through here).
  const put = (key: string, m: Motion | null) => {
    if (!m?.clips?.length) {
      raw().set(key, m && !m.clips ? m : null);
      return dropTracks(key, new Set());
    }
    const atts = m.clips.map((c) => {
      const use = c.use ?? c.name;
      const l = lib().get(use);
      // A code motion (studio-code-base, 2026-10-24): its shape is the game's codeMotion(), nothing of the clip goes back
      // (the clip's len is only the strip's width, its keys are none).
      if (l?.code) void 0;
      // A scene: this object's track set (a new one goes last in the rows' order — studio-ui-lead2, scene-motion.ts withTrack).
      else if (c.scene || l?.tracks) lib().set(use, withTrack(libOf({ ...c, name: use, tracks: l?.tracks ?? {}, order: l?.order }), key, c.keys));
      else lib().set(use, libOf({ ...c, name: use }));
      const a: MotionClip = { name: c.name, use, len: c.len, when: (c.when && typeof c.when === 'object' ? c.when : whenOf(c)) as MotionWhen, keys: {} };
      if (c.until) a.until = c.until;
      // Switched off (studio-code-base): kept on the object.
      if (c.off) a.off = true;
      return a;
    });
    raw().set(key, { clips: atts });
    dropTracks(key, new Set(atts.map((a) => a.use!)));
  };
  function dropTracks(key: string, keep: Set<string>) {
    for (const l of lib().list()) {
      if (!l.tracks || !(key in l.tracks) || keep.has(l.name)) continue;
      lib().set(l.name, withoutTrack(l, key));
    }
  }
  /** The store as the timeline sees it (resolved clips); every edit below goes through it. */
  const store = () => ({ get: (k: string) => resolve(k, raw().get(k)), set: put, keys: () => raw().keys() });
  const dim = () => d.dim();
  const clipsOf = (key: string): MotionClip[] => store().get(key)?.clips ?? [];
  const clipOf = (key: string): MotionClip | null => {
    // Making, before the first move: no motion shown (a thing that moves already gets a new one from that move).
    if (making && !making.shown && making.key === key) return null;
    const cs = clipsOf(key);
    const want = chosen.get(key);
    // An open scene (studio-timeline-2) is what each of its objects shows.
    return (scene && cs.find((c) => c.scene && c.use === scene)) || (cs.find((c) => c.name === want) ?? cs.find((c) => whenOf(c).on === 'start') ?? cs[0] ?? null);
  };
  const focus = () => d.picked() ?? (focusKey && d.place(focusKey) ? focusKey : null);
  // ----- scene motions (studio-timeline-2; scene-motion.ts): one motion, several objects' rows -----
  // The scene shown on the plate (its Library name), or null. While it is open the rows are its objects, the head acts
  // on it (whichever object is picked), and an object picked that has no motion of its own can join it.
  let scene: string | null = null;
  // studio-motion-focus: ⋯'s "Show every motion in the scene" (the rows as they were before: every moving object), and
  // "+ Link an object" open (its list on screen: a click on an object in the game links it — linkPick).
  let all = false;
  let linking = false;
  const members = (name = scene) => (name ? sceneMembers(store(), name).filter((k) => !!d.place(k)) : []);
  /**
   * Open / close the scene as the pick changes: a picked object showing a scene clip opens it; any other object picked
   * closes it (studio-motion-focus: the rows are the picked object's — before, an object with no motion of its own kept
   * the scene open to show "+ Add crate to “Arrival”"; "+ Link an object" is the one way in now).
   */
  function syncScene() {
    const p = d.picked();
    if (scene && !members().length) scene = null;
    if (scene && p && !members().includes(p)) scene = null;
    if (!scene && p) {
      const c = clipOf(p);
      if (c?.scene) openScene(c.use!);
    }
  }
  function openScene(name: string | null) {
    scene = name;
    if (name) for (const k of members(name)) chosen.set(k, name);
  }
  /** The object whose clip the head shows and edits: the focus, or with a scene open, a member (the picked one if it is). */
  const head = () => {
    const f = focus();
    if (!scene) return f;
    const ms = members();
    return f && ms.includes(f) ? f : ms[0] ?? f;
  };
  const shown = () => open && d.usable();
  /** The keys with a motion that are in the scene now. */
  const moving = () => store().keys().filter((k) => !!d.place(k));
  /**
   * An object's offsets at `at` — only for the timeline's rows (studio-preview-rows, 2026-10-24; a request, made while making
   * sea-stack's motion in Lantern Cove: "I'm making the motion of the object I picked, but when I play it other objects
   * start moving too — I want to play only the objects lined up on the timeline I'm on"). Every other object stays at
   * its place (where the editor puts it) through ▶, the time line and a cue's ▶; "Play" shows the whole game.
   * WHY here and not in each sender: refresh / ▶ / shownPose / placeFor all ask this, so what the game page shows, the
   * card's numbers and where a drag lands agree. `rs` = rowKeys() worked out once by a caller that loops.
   */
  const offsets = (key: string, at = time, rs: Set<string> = rowKeys()): Offsets | null => {
    const c = rs.has(key) ? clipOf(key) : null;
    return c ? offsetsAt(c, at) : null;
  };

  // ----- what the game page shows -----
  /** Every moving object at its place + its clip now (open), or at its place (folded). `force`: send even if unchanged. */
  function refresh(force = false) {
    const poses: Array<{ key: string; pose: Pose }> = [];
    const rs = rowKeys();
    for (const k of moving()) {
      const place = d.place(k)!;
      const at = shown() ? offsets(k, time, rs) : null;
      poses.push({ key: k, pose: at ? compose(place, at, dim()) : place });
    }
    // Rule motions (studio-code-knobs): their offsets come from the game page (it runs their at()).
    const code = shown() ? rulesAt(moving().filter((k) => rs.has(k)), time) : [];
    const sig = JSON.stringify([poses, code]);
    if (poses.length && (force || sig !== sentPoses)) {
      d.send({ type: 'studio:timeline/pose', poses, ...(code.length ? { code } : {}) });
      d.numbers();
    }
    sentPoses = sig;
    sendPath(force);
  }
  /**
   * Tell the game page whether a move is a motion's point now (studio-motion-move, 2026-10-23): there, a thing the game
   * moves takes every tool as a point, not as its start spot (bridge/hold.ts). The same test as records() for the picked
   * object (none picked: the timeline on screen, ● on, no Try running).
   */
  function sendRec(force = false) {
    // For the picked object (studio-fix-0142 ⑫): one with no motion and no making moves its start spot as when folded,
    // and the line under the strip says so ("Moving it here sets where it starts"), not "the game's motion adds up".
    const key = d.picked();
    const on = shown() && auto && !trying && (!key || records(key));
    if (!force && on === sentRec) return;
    sentRec = on;
    d.send({ type: 'studio:timeline/recording', on });
  }
  /** The picked object's path (its position keys), drawn in 3D in the game. */
  function sendPath(force = false) {
    sendRec(force);
    const key = shown() ? d.picked() : null;
    const c = key ? clipOf(key) : null;
    const place = key ? d.place(key) : undefined;
    const ks = c?.keys.p;
    // A rule motion (studio-code-knobs): its line comes from the game page's at(), with the ◇ of its `drag` knob.
    const rule = ruleFor(c);
    const dragKnob = rule?.drag ? rule.knobs.find((k) => k.name === rule.drag) : undefined;
    const msg: ShellToBridge = key && place && rule && !rule.missing && !rule.loading && !c!.off
      ? { type: 'studio:timeline/path', key, base: place.p.slice(), code: { code: rule.code, name: c!.use ?? c!.name, knobs: ruleValues(rule), round: rule.round,
        ...(dragKnob ? { drag: dragKnob.name, unit: dragKnob.unit, label: dragKnob.label } : {}), ...wasOf(c!.use ?? c!.name, rule.round) } }
      : key && place && ks?.length
      ? { type: 'studio:timeline/path', key, base: place.p.slice(), keys: structuredClone(ks), now: offsets(key)?.p ?? null,
        sel: ks.map((k, i) => (sel.some((r) => r.key === key && r.ch === 'p' && sameT(r.t, k.t)) ? i : -1)).filter((i) => i >= 0),
        // Making step by step: a press on the object where it stands is the next step, not a drag of that point.
        ...(making?.shown && making.key === key ? { making: true } : {}) }
      : { type: 'studio:timeline/path', key: null };
    const sig = JSON.stringify(msg);
    sendArea(force);
    if (!force && sig === sentPath) return;
    sentPath = sig;
    d.send(msg);
  }

  // ----- edits: one place for "store, undo, show" -----
  /** Put new motions in the store; `end` = also one undo step from `from` (the motions before the gesture). */
  // `pre`: Library changes that go first in the same undo step (studio-motion-focus: a motion turned into a scene by a
  // link, or back by an unlink — undo applies the step backwards, so the Library's own shape is put back last).
  function commit(next: Map<string, Motion | null>, from: Map<string, Motion | null> | null, end: boolean, pre: Change[] = []) {
    for (const [k, m] of next) store().set(k, m);
    if (end) {
      const changes: Change[] = [...pre];
      for (const [k, m] of next) {
        const was = from?.get(k) ?? null;
        if (!sameMotion(was, m)) changes.push({ kind: 'motion', key: k, from: was, to: m });
      }
      if (changes.length) d.undo.push({ changes });
      d.changed();
    }
    refresh();
    panel.render();
  }
  const one = (key: string, m: Motion | null) => commit(new Map([[key, m]]), new Map([[key, store().get(key)]]), true);
  /** The focused object's clip changed by `f` (the head's menus). */
  const editClip = (f: (c: MotionClip) => MotionClip) => {
    const key = head();
    const c = key ? clipOf(key) : null;
    if (key && c) editOf(key, c, f);
  };
  /**
   * `key`'s clip `c` changed by `f`, one undo step (the head's menus through editClip; the AI's `motion.set` through
   * handsClipSet, studio-ai-hands 2026-10-24 — the same edit, on the object the AI names instead of the one on the plate).
   */
  function editOf(key: string, c: MotionClip, f: (c: MotionClip) => MotionClip) {
    const nx = f(structuredClone(c));
    chosen.set(key, nx.name);
    const next = new Map<string, Motion | null>([[key, withClip(store().get(key), c.name, nx)]]);
    // A scene's length, repeat and "when" are the scene's: every object in it gets them (one undo step).
    if (c.scene) for (const k of members(c.use)) if (k !== key) {
      const x = clipsOf(k).find((y) => y.use === c.use);
      if (x) next.set(k, withClip(store().get(k), x.name, likeScene(x, nx)));
    }
    commit(next, new Map([...next.keys()].map((k) => [k, store().get(k)])), true);
  }

  /**
   * Record `pose` (what the object shows now) as keys at the time line, for the channels that differ from `was` (what
   * it showed before the gesture). The object's first clip is made here when it has none.
   */
  function keyed(key: string, pose: Pose, was: Pose): Motion | null {
    const place = d.place(key);
    if (!place) return store().get(key);
    let m = store().get(key);
    // (studio-timeline-2 also put an object moved with ● on into the open scene; studio-motion-focus took that out —
    // another object picked closes the scene, and "+ Link an object" is the one way in.)
    let c = clipOf(key);
    if (!c) {
      // One name for the whole gesture: a live drag remakes this first clip at every pose (from the motion before it),
      // and the Library already holds the name it took on the first pose.
      const name = gestureNames.get(key) ?? firstName(key);
      gestureNames.set(key, name);
      // The first motion of an object plays when the game starts; another waits (in the person's words, for now).
      const starts = clipsOf(key).some((x) => whenOf(x).on === 'start');
      c = { name, len: Math.max(1, snapT(time, MAX_LEN)), repeat: 'once', when: starts ? { on: 'say' } : { on: 'start' }, keys: {} };
      chosen.set(key, c.name);
      madeKey = key;
    }
    const name = c.name;
    for (const ch of changedChannels(was, pose, dim())) {
      // Making, a later step: a property whose last key is before the step's start holds still until then (a turn added
      // at 2 s after a move to 1 s turns from 1 s to 2 s, not all the way from 0 s).
      const hold = making?.shown && making.key === key ? making.from : 0;
      const last = c.keys[ch]?.at(-1)?.t ?? null;
      if (hold > 0 && time > hold && (last === null || last < hold - SAME_T)) {
        c = setKey(c, ch, 0, offsetsAt(c, 0)[ch] ?? restOf(ch, dim()));
        c = setKey(c, ch, hold, offsetsAt(c, hold)[ch] ?? restOf(ch, dim()));
      }
      // A property that had no key yet starts from how it stood at 0 s (else the motion would begin at the new pose).
      if (!c.keys[ch]?.length && time > 0) c = setKey(c, ch, 0, restOf(ch, dim()));
      c = setKey(c, ch, time, offsetOf(place, pose, ch, dim()));
    }
    m = withClip(m, name, c);
    return m;
  }
  /** Is a gesture on `key` a key now (● on, the timeline open), or a move of its place? */
  // While Try runs the scene, a move is never a key (the time line is the game's clock then, not a moment of the clip).
  // Only an object that has a motion already (its own, or a scene it is linked into — link() gives it a clip) or the
  // one "Make a motion" is on records (studio-fix-0142, 2026-10-24, first-run check ⑫). WHY: before, `time > 0` was
  // enough, so with the plate still open after a motion (the time line left at 1 s, ● on) a newcomer picked the orb,
  // nudged it with → twice to fix where it starts, and got a new "orb's motion" (0 s → 1 s, plays at the start) saved
  // as a change to the game. Moving something by hand is setting where it starts unless they asked for a motion; the
  // one way into a first motion is "Make a motion" (studio-no-presets). `making` is checked apart from clipOf() since
  // clipOf() hides the object's clips until the first move of a making (line ~263).
  // (A function, not a const: sendRec() above reads it, and may run before this line is reached.)
  function records(key: string): boolean {
    // A rule motion shown (studio-code-knobs): it has no points to add — a move moves where the object stands (its rule
    // goes round that place), as with the timeline folded.
    if (ruleFor(clipOf(key))) return false;
    return !trying && shown() && auto && (!!clipOf(key) || making?.key === key) && !!d.place(key);
  }
  /** What `key` shows now (its place + its clip at the time line). */
  const shownPose = (key: string): Pose | undefined => {
    const place = d.place(key);
    const at = shown() ? offsets(key) : null;
    return place && at ? compose(place, at, dim()) : place;
  };
  /** The place under a shown pose: the shown pose with this time's offsets taken out (● off, folded: a move of the place). */
  function placeFor(key: string, pose: Pose): Pose {
    const place = d.place(key);
    const at = shown() ? offsets(key) : null;
    if (!place || !at) return pose;
    const out: Pose = structuredClone(pose);
    if (at.p) out.p = pose.p.map((v, i) => v - (at.p![i] ?? 0));
    if (at.r) {
      if (dim() === '3d') {
        out.r = (pose.r ?? 0) - (at.r[1] ?? 0);
        if (pose.t || place.t) out.t = [(pose.t?.[0] ?? 0) - (at.r[0] ?? 0), (pose.t?.[1] ?? 0) - (at.r[2] ?? 0)];
      } else out.r = (pose.r ?? 0) - (at.r[0] ?? 0);
    }
    if (at.s) {
      const s = Array.isArray(pose.s) ? pose.s : null;
      if (s) out.s = s.map((v, i) => v / (at.s![i] || 1));
      else if (typeof pose.s === 'number' || pose.s === undefined) out.s = (pose.s ?? 1) / (at.s[0] || 1);
    }
    return out;
  }

  // ----- ▶ -----
  /** The time line's own clock: the picked clip's time (a loop wraps, a pingpong comes back, a once stops). */
  function tick() {
    if (!playing) return;
    const run = playing.from + (performance.now() - playing.t0) / 1000;
    const c = head() ? clipOf(head()!) : null;
    const len = c?.len ?? span();
    // A rule motion goes on as long as the game runs: ▶ shows it round and round (its strip is one round wide).
    const rep = ruleFor(c) ? 'loop' : c?.repeat ?? 'once';
    if (rep === 'loop') time = run % len;
    else if (rep === 'pingpong') time = run % (2 * len) > len ? 2 * len - (run % (2 * len)) : run % (2 * len);
    else time = Math.min(run, len);
    // Every object at the same running time (each with its own repeat).
    const poses: Array<{ key: string; pose: Pose }> = [];
    const rs = rowKeys();
    for (const k of moving()) {
      const at = offsets(k, rep === 'once' || !c ? time : run, rs);
      if (at) poses.push({ key: k, pose: compose(d.place(k)!, at, dim()) });
    }
    const code = rulesAt(moving().filter((k) => rs.has(k)), run);
    if (poses.length) (d.send({ type: 'studio:timeline/pose', poses, ...(code.length ? { code } : {}) }), d.numbers());
    sentPoses = '';
    panel.place();
    sendPath();
    // Ends when every row's clip is a `once` (studio-preview-rows: a loop elsewhere in the game no longer keeps ▶ going).
    if (rep === 'once' && run >= len && moving().filter((k) => rs.has(k)).every((k) => (clipOf(k)?.repeat ?? 'once') === 'once')) return void stop();
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (!shown()) return;
    stopTry();
    const c = head() ? clipOf(head()!) : null;
    // From the end of a `once`: back to the start (as any player does).
    if (c && (c.repeat ?? 'once') === 'once' && time >= c.len - 1e-3) time = 0;
    playing = { t0: performance.now(), from: time };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    panel.render();
  }
  function stop() {
    if (!playing) return;
    playing = null;
    cancelAnimationFrame(raf);
    time = snapT(time, MAX_LEN, true);
    refresh(true);
    panel.render();
  }
  /**
   * Seconds the ruler shows: the longest clip on screen (at least 1), or 4 when nothing on screen has a motion yet —
   * room to go to 2 s and move something (the first key's moment), the length of a door opening or a lift's ride.
   */
  const span = () => {
    const lens = [...rows().map((r) => r.clip?.len ?? 0), head() ? clipOf(head()!)?.len ?? 0 : 0].filter((x) => x > 0);
    return lens.length ? Math.max(1, ...lens) : 4;
  };

  /**
   * The rows (studio-motion-focus, 2026-10-23; a request: "every other object's motion shows up too — mostly I only
   * need the one I picked"): the open scene's objects in the scene's own order (trackOrder), then the other picked
   * ones in the list's order. ⋯'s "Show every motion" adds every moving object (the rows as they were before), in the
   * list's order.
   * WHY a pick never moves a row (studio-ui-lead2, 2026-10-23; the request: "while I put together several objects'
   * motions, the one I pick jumps to the top and the order changes every time — annoying; I want to set the order
   * myself"): studio-motion-focus put the picked one first, which reordered the rows on every click in the game. Now
   * the picked row is lit (orange) where it is, and the order is the person's: the scene's tracks (dragged by the grip,
   * reorderRow; saved with the motion), the list's for the rest.
   */
  function rows() {
    const p = d.picked();
    const ms = scene ? members() : [];
    return [...rowKeys()].map((k) => {
      const c = clipOf(k);
      const r = ruleFor(c);
      return { key: k, label: d.label(k), picked: k === p, open: openRows.has(k), clip: c, ...(scene ? { member: ms.includes(k) } : {}),
        // A rule motion's strip (studio-code-knobs): its words from its knobs, one round wide.
        ...(r && c ? { rule: { words: ruleWords(d.t, r), off: !!c.off, missing: r.missing, round: r.round, len: c.len, ...ruleWas(c.use ?? c.name) } } : {}) };
    });
  }
  /** A compared rule's strip: lit (the AI's change), and its replaced points' times on the lower edge when the switch is on. */
  function ruleWas(libName: string): { was?: number[]; lit?: boolean } {
    const x = d.compare?.(libName);
    if (!x) return {};
    return { lit: true, ...(x.on ? { was: x.hand.keys.map((k) => k.t) } : {}) };
  }
  /** The rows' objects in their order (rows() without what each row draws): also the objects ▶ moves (offsets). */
  function rowKeys(): Set<string> {
    const p = d.picked();
    const order = d.order();
    const at = (k: string) => {
      const i = order.indexOf(k);
      return i < 0 ? 1e9 : i;
    };
    const byList = (ks: string[]) => ks.slice().sort((a, b) => at(a) - at(b));
    const keys: string[] = [];
    const add = (k: string | null | undefined) => k && d.place(k) && !keys.includes(k) && keys.push(k);
    for (const k of trackOrder()) add(k);
    const picked = d.group?.() ?? (p ? [p] : []);
    for (const k of byList(all ? [...moving(), ...picked] : picked)) add(k);
    add(head());
    return new Set(keys);
  }
  /** The open scene's objects in the scene's order: its Library motion's `order` (scene-motion.ts trackOrder), members only. */
  function trackOrder(): string[] {
    if (!scene) return [];
    const ms = members();
    const ts = sceneOrder(lib().get(scene)).filter((k) => ms.includes(k));
    // A member whose track is not written yet (none in practice: joinClip writes an empty one) goes last.
    return [...ts, ...ms.filter((k) => !ts.includes(k))];
  }
  /**
   * A row dragged to a new place (its grip; studio-ui-lead2): `key` goes to index `to` among the scene's other rows.
   * The order lives in the scene motion's `order` (contract LibraryMotion.order: an array, since the file sorts object
   * keys), so it is saved with the motion and comes back with it — one undo step, a Library change (`motion-lib`).
   */
  function reorderRow(key: string, to: number) {
    const name = scene;
    const l = name ? lib().get(name) : null;
    if (!name || !l?.tracks || !(key in l.tracks)) return;
    const rest = trackOrder().filter((k) => k !== key);
    const next = [...rest.slice(0, to), key, ...rest.slice(to)];
    if (next.join('\n') === trackOrder().join('\n')) return;
    lib().set(name, withOrder(l, next));
    d.undo.push({ changes: [{ kind: 'motion-lib', key: name, from: l, to: lib().get(name) }] });
    d.changed();
    panel.render();
  }

  // ----- linking (studio-motion-focus; scene-motion.ts asScene / asOrdinary) -----
  /** The objects "+ Link an object" offers: the scene's, in the list's order, without the rows already on the plate. */
  function linkable(): Array<{ key: string; label: string; note: string }> {
    const shown = new Set(rows().map((r) => r.key));
    return d.order().filter((k) => !shown.has(k) && !!d.place(k) && clipsOf(k).length < MAX_CLIPS)
      .map((k) => ({ key: k, label: d.label(k), note: clipOf(k)?.name ?? '' }));
  }
  /**
   * Put `other` in the motion the head shows: a scene already → it joins; an ordinary motion → it becomes a scene of
   * the two (its keys the head's track); none yet → an empty one for both (moving either with ● sets its keys). A
   * motion other objects use too is copied first ("Hop 2"), so theirs stays as it is. One undo step.
   */
  function link(other: string): boolean {
    const key = head();
    if (!key || other === key || !d.place(key) || !d.place(other) || clipsOf(other).length >= MAX_CLIPS) return false;
    const from = new Map<string, Motion | null>([[key, store().get(key)], [other, store().get(other)]]);
    const next = new Map<string, Motion | null>();
    const pre: Change[] = [];
    let c = clipOf(key);
    if (c?.scene) {
      if (members(c.use).includes(other)) return false;
    } else {
      if (!c && clipsOf(key).length >= MAX_CLIPS) return false;
      const base: MotionClip = c ?? { name: firstName(key), len: Math.max(1, snapT(time, MAX_LEN)), repeat: 'once', when: { on: 'start' }, keys: {} };
      const was = base.use ?? base.name;
      const name = c && usage(was).length > 1 ? lib().free(was) : was;
      const before = lib().get(name) ?? null;
      lib().set(name, asScene(libOf({ ...base, name }), key));
      pre.push({ kind: 'motion-lib', key: name, from: before, to: lib().get(name) });
      c = { ...base, name: base.name === was ? name : base.name, use: name, scene: true };
      delete c.start;
      next.set(key, withClip(store().get(key), base.name, c));
    }
    const l = lib().get(c.use!)!;
    next.set(other, withClip(store().get(other), l.name, joinClip(l, c)));
    chosen.set(key, c.name);
    chosen.set(other, l.name);
    openScene(l.name);
    linking = false;
    commit(next, from, true, pre);
    return true;
  }
  /** Take `key` out of the open scene (its row's ×). The last one left makes it an ordinary motion again. One undo step. */
  function unlink(key: string) {
    const name = scene;
    const c = name ? clipsOf(key).find((x) => x.use === name) : null;
    const l = name ? lib().get(name) : null;
    if (!name || !c || !l) return;
    const pre: Change[] = [];
    const rest = Object.keys(l.tracks ?? {}).filter((k) => k !== key);
    if (rest.length === 1) {
      lib().set(name, asOrdinary(l, rest[0]!));
      pre.push({ kind: 'motion-lib', key: name, from: l, to: lib().get(name) });
    }
    sel = sel.filter((r) => r.key !== key);
    chosen.delete(key);
    commit(new Map([[key, withClip(store().get(key), c.name, null)]]), new Map([[key, store().get(key)]]), true, pre);
  }

  /** The picked position keys' point kind (the head's "Point ▾", studio-timeline-2): one kind, 'mixed', or null with none picked. */
  function pointOf(): PointKind | 'mixed' | null {
    const kinds = new Set<PointKind>();
    for (const r of sel) {
      if (r.ch !== 'p') continue;
      const k = clipOf(r.key)?.keys.p?.find((x) => sameT(x.t, r.t));
      if (k) kinds.add(pointKind(k));
    }
    return kinds.size ? (kinds.size === 1 ? [...kinds][0]! : 'mixed') : null;
  }
  /** The picked object's position keys changed by `f` (a handle, a corner, a key put on the path): one call, one undo step unless `live`. */
  function editPath(key: string, f: (ks: MotionKey[]) => MotionKey[] | null, live?: { end: boolean }) {
    const c = clipOf(key);
    if (!c?.keys.p?.length) return;
    if (live) begin(key);
    const ks = f(c.keys.p);
    if (!ks) return;
    const nc: MotionClip = { ...structuredClone(c), keys: { ...structuredClone(c.keys), p: ks } };
    const m = withClip(store().get(key), c.name, nc);
    if (!live) return one(key, m);
    const from = live.end ? finish() : before;
    commit(new Map([[key, m]]), from, live.end);
  }

  function view(): TimelineView {
    syncScene();
    const key = head();
    // Another object shown (picked, or a scene opened): making on the one before has ended.
    if (making && key !== making.key) making = null;
    const c = key ? clipOf(key) : null;
    const qs = cues();
    const eases = new Set<MotionEase>();
    for (const r of sel) {
      const k = clipOf(r.key)?.keys[r.ch]?.find((x) => sameT(x.t, r.t));
      if (k) eases.add(k.ease ?? 'ease');
    }
    return {
      time, span: span(), playing: !!playing, auto, focus: key, clips: key ? clipsOf(key).map((x) => x.name) : [], clip: c, rows: rows(),
      picked: (r) => sel.some((s) => s.key === r.key && s.ch === r.ch && sameT(s.t, r.t)),
      ease: sel.length ? (eases.size === 1 ? [...eases][0]! : 'mixed') : null,
      narrow: d.narrow(),
      when: c ? (whenOf(c) as MotionWhen) : null,
      whens: c ? (whensOf(c) as MotionWhen[]) : [],
      scene: scene && c?.scene ? { name: scene, n: members().length } : null,
      // studio-motion-focus: "+ Link an object" under the rows (not while every motion is shown), and ⋯'s "every motion".
      link: key && !all && d.place(key) ? { linking, items: linkable } : null,
      all,
      moving: moving().length,
      point: pointOf(),
      // The line's ▷ (studio-motion-panel): the cue that starts this clip (its first way; "the game starts" for start / time).
      tryId: key && c ? (qs.find((q) => q.hits.some(([k, n]) => k === key && n === c.name))?.id ?? null) : null,
      until: c?.until ?? null,
      uses: c ? usage(c.use ?? c.name).length : 0,
      cues: qs.map((q) => ({ id: q.id, label: q.label, ai: q.ai, on: !!trying && q.hits.some(([k, n]) => trying!.run.playing().get(k) === n) })),
      trying: !!trying,
      cueNames: cueNames(),
      afterOpts: moving().flatMap((k) => clipsOf(k).filter((x) => !(k === key && x.name === c?.name)).map((x) => ({ key: k, use: x.use ?? x.name, label: `${d.label(k)} · ${x.name}` }))),
      rowWhen: (k: string) => {
        const x = clipOf(k);
        return x ? { when: whenOf(x) as MotionWhen, whens: whensOf(x) as MotionWhen[], until: x.until ?? null, repeat: x.repeat ?? 'once' } : null;
      },
      defaultArea: () => {
        const place = key ? d.place(key) : undefined;
        return { p: (place?.p ?? [0, 0, 0]).map((v) => Math.round(v * 100) / 100), size: dim() === '3d' ? [3, 2, 3] : [200, 200] };
      },
      player: d.order().find((k) => /player|hero/i.test(k)) ?? null,
      attached: fresh && fresh.key === key && c && (c.use ?? c.name) === fresh.name ? fresh.name : null,
      making: making && making.key === key ? (making.shown ? 'more' : 'drag') : null,
      made: madeKey && madeKey === key && c ? Math.max(0, ...CHANNELS.flatMap((ch) => (c.keys[ch] ?? []).map((k) => k.t))) : null,
      // (studio-motion-line, 2026-10-23: the first-time three steps, `coach`, are gone — the line says the next step.)
      fine: fineNow(),
      slim,
      // A rule motion (studio-code-knobs): its knobs on the line, in place of Repeat.
      rule: (() => {
        const r = ruleFor(c);
        const x = r && c ? d.compare?.(c.use ?? c.name) : null;
        return r && c ? { knobs: r.knobs, off: !!c.off, missing: r.missing, loading: r.loading, pointsTip: d.t('rule.pointsTip', { n: POINTS_PER_ROUND }),
          ...(x ? { compare: { on: x.on, gap: x.gap, at: x.at } } : {}) } : null;
      })(),
    };
  }

  // ----- rule motions: their knobs, their switch, "Make editable points" (studio-code-knobs) -----
  /**
   * A rule's knob turned (the line's knob, or the ◇ of its path in the game): the Library motion's knobs, live, then ONE
   * undo step (`end`) — a knob is the Library motion's, so every object with that motion follows (as a point would).
   */
  function turnRule(libName: string, knob: string, v: number, end: boolean, fromPanel: boolean) {
    const l = lib().get(libName);
    const r = ruleOf(l, (d.codeMotions?.() ?? []).length ? d.codeMotions!() : null);
    if (!l || !r || r.loading || r.missing) return;
    if (!knobFrom || knobFrom.name !== libName) knobFrom = { name: libName, lib: structuredClone(l) };
    const ks = ruleKnobsAfter(r, knob, v);
    const next: LibraryMotion = { ...l };
    if (ks) next.knobs = ks;
    else delete next.knobs;
    lib().set(libName, next);
    if (end) {
      const from = knobFrom.lib;
      knobFrom = null;
      if (JSON.stringify(from) !== JSON.stringify(lib().get(libName))) d.undo.push({ changes: [{ kind: 'motion-lib', key: libName, from, to: structuredClone(lib().get(libName)!) }] });
      d.changed();
      // A rule being compared with the points it replaced: the gap is measured again for the new number.
      if (d.compare?.(libName)) d.remeasure?.(libName);
    }
    refresh();
    // The line's own knob keeps its drag (not drawn again under the pointer): only the strips' words follow, until `end`.
    if (fromPanel && !end) {
      const rr = ruleOf(lib().get(libName), d.codeMotions!());
      if (rr) for (const k of moving()) if ((clipOf(k)?.use ?? clipOf(k)?.name) === libName) panel.ruleWords?.(k, ruleWords(d.t, rr));
    } else panel.render();
  }
  /** "Make editable points": ask the game page for the rule's shape (timeline/code-points); the answer makes the points. */
  function rulePoints(key: string) {
    const c = clipOf(key);
    const r = ruleFor(c);
    if (!c || !r || r.missing || r.loading) return;
    const len = r.round && r.round > 0 ? r.round : 4;
    pointsAsk = { id: ++pointsId, name: c.use ?? c.name, len, per: POINTS_PER_ROUND };
    d.send({ type: 'studio:timeline/code-points', id: pointsAsk.id, code: r.code, knobs: ruleValues(r), len, per: POINTS_PER_ROUND });
  }

  // ----- keys -----
  /** Remove the picked keys (Delete). One undo step for every object touched. */
  function deletePicked() {
    if (!sel.length) return false;
    const next = new Map<string, Motion | null>();
    for (const key of new Set(sel.map((r) => r.key))) {
      const c = clipOf(key);
      if (c) next.set(key, withClip(store().get(key), c.name, deleteKeys(c, key, sel)));
    }
    sel = [];
    commit(next, new Map([...next.keys()].map((k) => [k, store().get(k)])), true);
    return true;
  }
  /** K: a key of every property the object's clip already moves (position when none) at the time line, as it shows now. */
  function keyNow() {
    const key = d.picked();
    const place = key ? d.place(key) : undefined;
    if (!key || !place || !shown()) return false;
    const pose = shownPose(key)!;
    let c = clipOf(key) ?? { name: firstName(key), len: Math.max(1, snapT(time, MAX_LEN)), repeat: 'once' as MotionRepeat, when: { on: 'start' } as MotionWhen, keys: {} };
    const name = c.name;
    const chs = CHANNELS.filter((ch) => c.keys[ch]?.length);
    for (const ch of chs.length ? chs : (['p'] as MotionChannel[])) {
      // A new position key on the path where it already is keeps the path's shape (studio-timeline-2: insertAt cuts a
      // bent span in two); a key already there, or the first one, is set from how the object shows now.
      const ks = c.keys.p;
      if (ch === 'p' && ks && ks.length > 1 && time <= c.len && !ks.some((k) => sameT(k.t, time))) c = { ...c, keys: { ...c.keys, p: insertAt(ks, time).keys } };
      else c = setKey(c, ch, time, offsetOf(place, pose, ch, dim()));
    }
    chosen.set(key, name);
    one(key, withClip(store().get(key), name, c));
    return true;
  }

  // ----- the Library's motions (studio-motion-triggers) -----
  /** Rename a Library motion and every clip that uses it (here, in the other levels, and a clip that waits for its end). */
  function renameLib(from: string, to: string, record = true): boolean {
    if (!lib().rename(from, to)) return false;
    const fix = (m: Motion | null): Motion | null => (m?.clips ? { clips: m.clips.map((c) => {
      // `when` may be a list (studio-timeline-2): an "after" in it that waits for the renamed motion follows the name.
      const one = (x: MotionWhen) => (x.on === 'after' && x.use === from ? { ...x, use: to } : x);
      const w = Array.isArray(c.when) ? c.when.map(one) : c.when && typeof c.when === 'object' ? one(c.when) : c.when;
      return c.use === from ? { ...c, use: to, name: c.name === from ? to : c.name, when: w } : { ...c, when: w };
    }) } : m);
    for (const k of raw().keys()) raw().set(k, fix(raw().get(k)));
    for (const w of d.others()) for (const k of Object.keys(w)) w[k] = fix(w[k]!) ?? w[k]!;
    for (const [k, v] of chosen) if (v === from) chosen.set(k, to);
    if (record) d.undo.push({ changes: [{ kind: 'motion-rename', key: to, from, to }] });
    refresh();
    return true;
  }
  /** The objects (in this level) a Library motion is on, with when each starts / stops. */
  function usage(name: string): Array<{ key: string; when: MotionWhen; until?: MotionUntil }> {
    const out: Array<{ key: string; when: MotionWhen; until?: MotionUntil }> = [];
    for (const k of raw().keys()) for (const c of raw().get(k)?.clips ?? []) if (c.use === name) out.push({ key: k, when: whenOf(c) as MotionWhen, ...(c.until ? { until: c.until } : {}) });
    return out;
  }
  /**
   * Put a Library motion on an object: it starts with the game if nothing on it does yet, else after its last motion. true
   * when it is on the object now (attached here, or it was already: a second drop of the same motion shows it again).
   */
  function attach(key: string, name: string): boolean {
    const l = lib().get(name);
    if (!l || !d.place(key)) return false;
    if (clipsOf(key).some((c) => (c.use ?? c.name) === name)) return true;
    if (clipsOf(key).length >= MAX_CLIPS) return false;
    chosen.set(key, name);
    // A scene motion dropped on an object: the object joins the scene (its own empty row, the scene's "when").
    if (l.tracks) {
      const ms = sceneMembers(store(), name);
      openScene(name);
      one(key, withClip(store().get(key), name, joinClip(l, ms[0] ? clipOf(ms[0]) : null)));
      return true;
    }
    // fix-0141 (H4 of the first-run check, 2026-10-24): a second motion plays after the one before it ("After last
    // motion"). It was { on: 'say' } — "Custom (ask your AI)" — so dropping Hop on a ship that already moved with the game
    // showed "✦ Ask Claude" nobody had asked for. The runner fires 'after' with the clip's use || name when it ends
    // (loader/studio-placement.js end()), the same name this gives; no key = this object.
    const before = clipsOf(key);
    const last = before[before.length - 1];
    const when: MotionWhen = before.some((c) => whenOf(c).on === 'start') && last ? { on: 'after', use: last.use ?? last.name } : { on: 'start' };
    one(key, withClip(store().get(key), name, { ...l, use: name, when }));
    return true;
  }
  function detach(key: string, name: string) {
    if (chosen.get(key) === name) chosen.delete(key);
    sel = sel.filter((r) => r.key !== key);
    one(key, withClip(store().get(key), name, null));
  }
  /** "Hop" → "Hop 2": the same keys, its own from now on. One undo step. Returns the new name. */
  function duplicateLib(name: string): string | null {
    const l = lib().get(name);
    if (!l) return null;
    const n = lib().free(name);
    lib().set(n, { ...l, name: n });
    d.undo.push({ changes: [{ kind: 'motion-lib', key: n, from: null, to: lib().get(n) }] });
    d.changed();
    return n;
  }
  /** Delete a Library motion: it comes off every object here (one undo step) and in the other levels. */
  function deleteLib(name: string) {
    const l = lib().get(name);
    if (!l) return;
    const changes: Change[] = [];
    for (const k of raw().keys()) {
      if (!(raw().get(k)?.clips ?? []).some((c) => c.use === name)) continue;
      const from = store().get(k);
      const to = withClip(from, (from?.clips ?? []).find((c) => c.use === name)!.name, null);
      changes.push({ kind: 'motion', key: k, from, to });
      put(k, to);
      if (chosen.get(k) === name) chosen.delete(k);
    }
    for (const w of d.others()) for (const k of Object.keys(w)) {
      const clips = (w[k]!.clips ?? []).filter((c) => c.use !== name);
      if (clips.length) w[k] = { clips };
      else delete w[k];
    }
    lib().set(name, null);
    changes.push({ kind: 'motion-lib', key: name, from: l, to: null });
    d.undo.push({ changes });
    refresh();
    if (shown()) panel.render();
    d.changed();
  }

  // ----- the AI's hands (studio-ai-hands, 2026-10-24; ai-hands.ts, schema/hands.mjs) -----
  // WHY here: an AI's `--do motion.make` must be the same thing as the person's "+ Make a motion" — a Library motion,
  // on the timeline, one ⌘Z — never code in the game (a request, 2026-10-24: the spiral Claude wrote into index.html was not on
  // the timeline and fought the editor's motion). These are the plate's own edits, on the object the AI names.
  /**
   * A Library motion the AI made (hands.mjs handsMotion: from its points or keys), put in the Library and — with `key` —
   * on that object, starting `when` (default: the editor's rule, as a drop). One undo step. `replace`: the same name
   * with new keys (every object that has it moves the new way); else a taken name becomes "Spiral 2".
   */
  function handsMake(key: string | null, m: LibraryMotion, o: { when?: MotionWhen | MotionWhen[]; until?: MotionUntil | null; replace?: boolean; whenOf?: (clips: MotionClip[]) => MotionWhen }): { name: string; when?: MotionClip['when'] } | { error: string } {
    if (key && !d.place(key)) return { error: `no object ${key} in the editor` };
    const was = lib().get(m.name);
    const name = was && !o.replace ? lib().free(m.name) : m.name;
    if (key && !clipsOf(key).some((c) => (c.use ?? c.name) === name) && clipsOf(key).length >= MAX_CLIPS) return { error: `${key} already has ${MAX_CLIPS} motions` };
    // The object's motion before anything changes (resolved with the Library as it was): its undo puts that back.
    const before = key ? store().get(key) : null;
    const raws = key ? raw().get(key)?.clips ?? [] : [];
    lib().set(name, { ...m, name });
    const pre: Change[] = [{ kind: 'motion-lib', key: name, from: was && o.replace ? was : null, to: lib().get(name) }];
    if (!key) {
      d.undo.push({ changes: pre });
      refresh();
      if (shown()) panel.render();
      d.changed();
      return { name };
    }
    const l = lib().get(name)!;
    const had = clipsOf(key).find((c) => (c.use ?? c.name) === name);
    const when = o.when ?? had?.when ?? (o.whenOf ? o.whenOf(raws) : { on: 'start' as const });
    const clip: MotionClip = { name: had?.name ?? name, use: name, len: l.len, ...(l.repeat ? { repeat: l.repeat } : {}), when, keys: structuredClone(l.keys) };
    const until = o.until === undefined ? had?.until : o.until;
    if (until) clip.until = until;
    chosen.set(key, clip.name);
    commit(new Map([[key, withClip(store().get(key), clip.name, clip)]]), new Map([[key, before]]), true, pre);
    return { name, when };
  }
  /** `key`'s motion `clipName`: when it starts / stops (the AI's motion.set). false = no such clip. */
  function handsClipSet(key: string, clipName: string, o: { when?: MotionWhen | MotionWhen[]; until?: MotionUntil | null; off?: boolean }): boolean {
    const c = clipsOf(key).find((x) => x.name === clipName);
    if (!c) return false;
    editOf(key, c, (x) => {
      const out: MotionClip = { ...x };
      if (o.when !== undefined) (out.when = o.when), delete out.start;
      if (o.until === null) delete out.until;
      else if (o.until) out.until = o.until;
      // Switched off (studio-code-base): it stays on the object and does not play.
      if (o.off === true) out.off = true;
      else if (o.off === false) delete out.off;
      return out;
    });
    return true;
  }
  /** A Library motion's repeat / length for every object that has it (the AI's motion.set; a new length stretches its keys). */
  function handsLibSet(name: string, o: { repeat?: MotionRepeat; len?: number; knobs?: LibraryMotion['knobs'] | null }): boolean {
    const l = lib().get(name);
    if (!l) return false;
    let n: LibraryMotion = { ...l };
    // A code motion's knobs (studio-code-base): what the person / the AI turned, { v, was } (null = all back to the code's).
    if (o.knobs !== undefined) {
      if (o.knobs && Object.keys(o.knobs).length) n.knobs = structuredClone(o.knobs);
      else delete n.knobs;
    }
    if (o.repeat) n.repeat = o.repeat;
    if (o.len) {
      const s = stretchClip({ name, len: l.len, keys: l.keys } as MotionClip, o.len);
      n = { ...n, len: s.len, keys: s.keys };
      if (l.tracks) n.tracks = Object.fromEntries(Object.entries(l.tracks).map(([k, ks]) => [k, stretchClip({ name, len: l.len, keys: ks } as MotionClip, o.len!).keys]));
    }
    lib().set(name, n);
    d.undo.push({ changes: [{ kind: 'motion-lib', key: name, from: l, to: lib().get(name) }] });
    refresh();
    if (shown()) panel.render();
    d.changed();
    return true;
  }

  // ----- making and attaching from outside the plate (studio-motion-flow): the card, the Library, a drop -----
  // (studio-ui-lead2, 2026-10-23: the clip menu's "New: Scene — several objects" is gone — the request: "Make a motion,
  // New — I can't tell what either does". One way in, "+ Make a motion"; several objects are "+ Link an object", which
  // turns the motion into a scene (link() below). A scene made before plays and opens as it did.)
  /**
   * "Make a motion" (the strip's Motion button, the card's "+ Make a motion", the Library's, the clip menu's): the plate
   * opens on `key` with the time line at 1 s, and where it stands now is 0 s — the next move is the second key
   * (`making` above). Nothing is made by a look: no empty "Motion" left in the Library if the person stops there.
   * (studio-tool-clear had this for the strip only; the card's way picked a time on the ruler first. studio-no-presets
   * made it the one way, the kinds gone.)
   */
  function make(key: string) {
    if (!d.place(key) || clipsOf(key).length >= MAX_CLIPS) return;
    if (playing) stop();
    stopTry();
    focusKey = key;
    scene = null;
    sel = [];
    // Making is moving: the auto key comes on (off, the drag would move the place and nothing would be made).
    auto = true;
    making = { key, shown: false, from: 0 };
    madeKey = null;
    if (fresh) (clearTimeout(fresh.timer), (fresh = null));
    time = 1;
    if (!open) setOpen(true);
    else {
      refresh();
      panel.render();
    }
  }
  /** Making: a gesture on `key` begins — a later step goes one second after the last key (stopping the playback). */
  function stepBegins(key: string) {
    if (!making?.shown || making.key !== key || before?.has(key)) return;
    if (playing) stop();
    const c = clipOf(key);
    const last = c ? Math.max(0, ...keyTimes(c)) : 0;
    making.from = last;
    time = snapT(last + 1, MAX_LEN);
  }
  /** Making: a gesture on `key` ended — the motion plays the part just made (from 0 s the first time, then the new second). */
  function stepEnds(key: string) {
    if (!making || making.key !== key) return;
    const first = !making.shown;
    making.shown = true;
    // A gesture that made no key (nothing changed): still waiting for the first move.
    if (!clipOf(key) || !keyTimes(clipOf(key)).length) return void (making.shown = !first);
    if (first) madeKey = key;
    time = first ? 0 : making.from;
    play();
  }
  /** Esc / "Done": making ends (before the first move: nothing was made, the time line goes back to 0 s). */
  function endMaking(): boolean {
    if (!making) return false;
    if (!making.shown) time = 0;
    making = null;
    refresh();
    panel.render();
    return true;
  }
  /** The plate open on `key`'s motion `name`; `attached`: say so, with "When does it move?" open. */
  function show(key: string, name: string, attached = false) {
    focusKey = key;
    chosen.set(key, name);
    scene = null;
    if (lib().get(name)?.tracks) openScene(name);
    if (fresh) clearTimeout(fresh.timer);
    fresh = null;
    if (attached) {
      const f = { key, name, timer: 0 };
      f.timer = setTimeout(() => {
        if (fresh !== f) return;
        fresh = null;
        if (shown()) panel.render();
      }, FRESH_MS);
      fresh = f;
      focusStarts = true;
    }
    if (!open) setOpen(true);
    else {
      refresh();
      render();
    }
    if (focusStarts && shown()) (panel.focusStarts(), (focusStarts = false));
  }
  /** Attach from the card's menu (already in the Scene): attach, then show it with its "when" open. */
  function attachShow(key: string, name: string) {
    if (attach(key, name)) show(key, name, true);
  }

  // ----- Try: the scene's cues, played by the loader's own rules (motionRunner) -----
  type Cue = { id: string; label: string; ai: boolean; ev: Record<string, unknown>; hits: Array<[string, string]> };
  let trying: { run: ReturnType<typeof motionRunner>; t0: number; raf: number } | null = null;
  /** One ▶ per thing that can happen in this scene (deduplicated): the game starting, each key, each object's click… */
  function cues(): Cue[] {
    const out = new Map<string, Cue>();
    const addCue = (id: string, label: string, ai: boolean, ev: Record<string, unknown>, hit?: [string, string]) => {
      const c = out.get(id) ?? { id, label, ai, ev, hits: [] };
      if (hit) c.hits.push(hit);
      out.set(id, c);
    };
    addCue('start', d.t('tl.try.start'), false, { on: 'start' });
    for (const key of moving()) {
      const name = d.label(key);
      for (const c of clipsOf(key)) for (const w of whensOf(c) as MotionWhen[]) {
        const hit: [string, string] = [key, c.name];
        if (w.on === 'start' || w.on === 'time') out.get('start')!.hits.push(hit);
        else if (w.on === 'key') addCue(`key:${w.key}`, keyName(w.key), false, { on: 'key', key: w.key }, hit);
        else if (w.on === 'click') addCue(`click:${key}`, d.t('tl.try.click', { name }), false, { on: 'click', key }, hit);
        else if (w.on === 'enter') addCue(`enter:${key}`, d.t('tl.try.enter', { name }), false, { on: 'enter', key }, hit);
        else if (w.on === 'touch') addCue(`touch:${key}`, d.t('tl.try.touch', { name }), true, { on: 'touch', key }, hit);
        else if (w.on === 'cue') addCue(`cue:${w.cue}`, w.cue, true, { on: 'cue', cue: w.cue }, hit);
        else if (w.on === 'say') addCue(`say:${key}:${c.use ?? c.name}`, d.t('tl.try.say', { name: `${name} · ${c.name}` }), true, { on: 'say', key, use: c.use ?? c.name }, hit);
        if (c.until?.cue) addCue(`cue:${c.until.cue}`, c.until.cue, true, { on: 'cue', cue: c.until.cue });
      }
    }
    return [...out.values()];
  }
  /** Press a cue's ▶: the scene runs as the game would (from "the game starts" if it was not running), then that happens. */
  function tryCue(id: string) {
    const cue = cues().find((c) => c.id === id);
    if (!cue) return;
    if (playing) stop();
    const now = performance.now();
    if (!trying || id === 'start') {
      if (trying) cancelAnimationFrame(trying.raf);
      const objs = moving().map((key) => ({ key, clips: clipsOf(key).map((c) => ({ ...c, when: whenOf(c), whens: whensOf(c) })) }));
      trying = { run: motionRunner(objs), t0: now, raf: 0 };
      sendRec();
      trying.run.fire({ on: 'start' }, now);
      const loop = () => {
        if (!trying) return;
        const t = performance.now();
        const at = trying.run.step(t, () => null);
        const poses: Array<{ key: string; pose: Pose }> = [];
        // studio-preview-rows: the runner plays the whole scene (so a row's "after X ends" still starts on time), but
        // only the rows are shown moving — an "after" chained to an object not on the timeline stays at its place.
        const rs = rowKeys();
        for (const k of moving()) {
          const o = rs.has(k) ? (at.get(k) as Offsets | undefined) : undefined;
          poses.push({ key: k, pose: o ? compose(d.place(k)!, o, dim()) : d.place(k)! });
        }
        if (poses.length) d.send({ type: 'studio:timeline/pose', poses });
        time = (t - trying.t0) / 1000;
        sentPoses = '';
        panel.place();
        const lit = JSON.stringify([...trying.run.playing()]);
        if (lit !== litWas) (litWas = lit), panel.render();
        trying.raf = requestAnimationFrame(loop);
      };
      trying.raf = requestAnimationFrame(loop);
    }
    if (id !== 'start') trying.run.fire(cue.ev, now);
    panel.render();
  }
  let litWas = '';
  function stopTry() {
    if (!trying) return;
    cancelAnimationFrame(trying.raf);
    trying = null;
    time = 0;
    refresh(true);
    panel.render();
  }
  /** Known cue names (this level's clips), for the menus: the ones in use first, as written. */
  function cueNames(): string[] {
    const out = new Set<string>();
    for (const k of raw().keys()) for (const c of raw().get(k)?.clips ?? []) {
      for (const w of whensOf(c) as MotionWhen[]) if (w.on === 'cue') out.add(w.cue);
      if (c.until?.cue) out.add(c.until.cue);
    }
    return [...out];
  }
  /** The picked clip's area, drawn in the game as a box (when it starts as someone enters it). */
  let sentArea = '';
  function sendArea(force = false) {
    const key = shown() ? d.picked() : null;
    const c = key ? clipOf(key) : null;
    const w = c ? (whensOf(c) as MotionWhen[]).find((x) => x.on === 'enter') : null;
    const msg: ShellToBridge = key && w?.on === 'enter' && w.area
      ? { type: 'studio:timeline/area', key, area: structuredClone(w.area), label: d.t('tl.area.label', { size: w.area.size.map((v) => Math.round(v * 10) / 10).join(' × ') }) }
      : { type: 'studio:timeline/area', key: null };
    const sig = JSON.stringify(msg);
    if (!force && sig === sentArea) return;
    sentArea = sig;
    d.send(msg);
  }

  const panel = makePanel(view, {
    t: d.t,
    ruleKnob(name, v, end) {
      const key = head();
      const c = key ? clipOf(key) : null;
      if (c) turnRule(c.use ?? c.name, name, v, end, true);
    },
    ruleOff(key, off) {
      const c = clipOf(key);
      if (c) editOf(key, c, (x) => {
        const out = { ...x };
        if (off) out.off = true;
        else delete out.off;
        return out;
      });
    },
    rulePoints: (key) => rulePoints(key),
    compare: (on) => d.compareShow?.(on),
    play: (on) => (on ? play() : stop()),
    scrub(t, end) {
      if (playing) stop();
      // The time line moved by hand: the person takes the times from here (making's "one second after the last" ends).
      if (making?.shown) making = null;
      time = snapT(t, span(), true);
      refresh();
      panel.place();
      if (end) panel.render();
    },
    auto(on) {
      auto = on;
      sendRec();
      panel.render();
    },
    fold: () => setOpen(false),
    done: () => void endMaking(),
    clip(value) {
      const key = head();
      if (!key) return;
      if (value === 'new:make') make(key);
      else if (value === 'delete') {
        const c = clipOf(key);
        if (!c) return;
        chosen.delete(key);
        sel = sel.filter((r) => r.key !== key);
        // A scene's "Delete" takes the whole scene off (every object in it: one undo step).
        if (c.scene) {
          const next = new Map(members(c.use).map((k) => [k, withClip(store().get(k), clipsOf(k).find((x) => x.use === c.use)!.name, null)] as [string, Motion | null]));
          scene = null;
          return commit(next, new Map([...next.keys()].map((k) => [k, store().get(k)])), true);
        }
        one(key, withClip(store().get(key), c.name, null));
      } else if (clipsOf(key).some((c) => c.name === value)) {
        chosen.set(key, value);
        const c = clipsOf(key).find((x) => x.name === value)!;
        openScene(c.scene ? c.use! : null);
        sel = sel.filter((r) => r.key !== key);
        refresh();
        panel.render();
      }
    },
    rename(name) {
      const key = head();
      const c = key ? clipOf(key) : null;
      if (!key || !c) return;
      // The Library motion is renamed, with every object that uses it (the name is the asset's, not this object's).
      const from = c.use ?? c.name;
      const n = name.slice(0, 40).trim();
      if (!n || n === from) return;
      renameLib(from, lib().free(n));
      panel.render();
      d.changed();
    },
    len: (s) => editClip((c) => {
      // Not shorter than its last key (the keys would fall off the end); 0.1 s … 10 minutes.
      const last = Math.max(0, ...CHANNELS.flatMap((ch) => (c.keys[ch] ?? []).map((k) => k.t)));
      return { ...c, len: Math.min(MAX_LEN, Math.max(MIN_LEN, last, Math.round(s * 1000) / 1000)) };
    }),
    // The line's "[1 s ▾]": the motion takes this long, its points scaled (timeline-model.ts stretchClip). A scene's
    // length only (its other objects' tracks are not this clip's keys; scaling one track would put them out of step).
    stretch: (s) => editClip((c) => (c.scene ? { ...c, len: Math.min(MAX_LEN, Math.max(MIN_LEN, ...CHANNELS.flatMap((ch) => (c.keys[ch] ?? []).map((k) => k.t)), s)) } : stretchClip(c, s))),
    repeat: (r) => editClip((c) => ({ ...c, repeat: r })),
    // When the focused clip starts / stops (studio-motion-triggers): the head's second row.
    setWhen: (w) => editClip((c) => {
      // A "when" chosen: the "✓ attached" / "✓ moves from 0 s to 1 s" line has done its job.
      if (fresh) (clearTimeout(fresh.timer), (fresh = null));
      madeKey = null;
      // A list of one is written as itself (studio-timeline-2: 2–4 = "any of these").
      const out: MotionClip = { ...c, when: Array.isArray(w) ? (w.length > 1 ? w.slice(0, 4) : w[0]!) : w };
      delete out.start;
      return out;
    }),
    setUntil: (u) => editClip((c) => {
      const out: MotionClip = { ...c };
      if (u) out.until = u;
      else delete out.until;
      return out;
    }),
    // studio-timeline-2: the head's "Point ▾" on the picked position keys; a row's "+ Add" / "×" for a scene.
    point(kind) {
      const keys = new Set(sel.filter((r) => r.ch === 'p').map((r) => r.key));
      const next = new Map<string, Motion | null>();
      for (const key of keys) {
        const c = clipOf(key);
        if (!c?.keys.p) continue;
        let ks = c.keys.p;
        for (const r of sel) if (r.key === key && r.ch === 'p') {
          const i = ks.findIndex((k) => sameT(k.t, r.t));
          if (i >= 0) ks = setKind(ks, i, kind);
        }
        next.set(key, withClip(store().get(key), c.name, { ...c, keys: { ...c.keys, p: ks } }));
      }
      if (next.size) commit(next, new Map([...next.keys()].map((k) => [k, store().get(k)])), true);
    },
    // studio-motion-focus: "+ Link an object" (its list, or a click in the game while it is open), a row's ×, ⋯'s rows.
    link: (key) => void link(key),
    linking(on) {
      if (linking === on) return;
      linking = on;
      panel.render();
    },
    leave: (key) => unlink(key),
    // studio-ui-lead2: a row dragged by its grip (or ↑ / ↓ on it) to a new place among the scene's rows.
    reorder: (key, to) => reorderRow(key, to),
    showAll(on) {
      all = on;
      // The rows changed, and with them what ▶ moves (studio-preview-rows).
      if (!playing && !trying) refresh();
      panel.render();
      d.layout();
    },
    tryCue: (id) => tryCue(id),
    tryStop: () => stopTry(),
    // studio-ui-lead: the picked keys' row has a Delete button (a phone has no Delete key); the same as the key.
    deleteKeys: () => void deletePicked(),
    ease(e) {
      if (!sel.length) return;
      const next = new Map<string, Motion | null>();
      for (const key of new Set(sel.map((r) => r.key))) {
        const c = clipOf(key);
        if (c) next.set(key, withClip(store().get(key), c.name, easeKeys(c, key, sel, e)));
      }
      commit(next, new Map([...next.keys()].map((k) => [k, store().get(k)])), true);
    },
    pickRow(key) {
      focusKey = key;
      d.select(key);
    },
    openRow(key) {
      if (openRows.has(key)) openRows.delete(key);
      else openRows.add(key);
      panel.render();
      d.layout();
    },
    pickKeys(refs, add) {
      const ids = new Set(sel.map(refId));
      sel = add ? [...sel, ...refs.filter((r) => !ids.has(refId(r)))] : refs.slice();
      if (refs[0]) focusKey = refs[0].key;
      sendPath();
      panel.render();
    },
    drag(dt, end, free) {
      if (!sel.length) return;
      if (!keyDrag) keyDrag = { sel: sel.slice(), from: new Map([...new Set(sel.map((r) => r.key))].map((k) => [k, store().get(k)])) };
      const step = free ? Math.round(dt * 1000) / 1000 : Math.round(dt / 0.05) * 0.05;
      const next = new Map<string, Motion | null>();
      const moved: KeyRef[] = [];
      for (const [key, was] of keyDrag.from) {
        const c = (was?.clips ?? []).find((x) => x.name === clipOf(key)?.name);
        if (!c) continue;
        const r = moveKeys(c, key, keyDrag.sel, step);
        moved.push(...r.moved);
        next.set(key, withClip(was, c.name, r.clip));
      }
      sel = moved;
      const from = keyDrag.from;
      if (end) keyDrag = null;
      commit(next, from, end);
    },
    key(e) {
      return onKey({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey }, true);
    },
    touched: () => (touched = true),
    fine(on) {
      // Folded to the line (⑨ B): Fine-tune brings the rows back first — it is the line's "show me more".
      if (slim) return unslim();
      if (fineNow() === on) return;
      fine = on;
      try {
        globalThis.localStorage?.setItem(FINE_KEY, on ? '1' : '0');
      } catch {
        /* private window: only the prefs below */
      }
      if (on) d.markSeen?.(FINE_SEEN);
      panel.render();
      // The plate is taller / shorter now: the shell lays the bottom out again (the game's inset, the chat box).
      d.layout();
      // Narrow (studio-fix-0142 ⑬): Fine-tune grows the plate up over the game — keep the picked object above it.
      // Not on PC: there the sheet is beside the rows, and a slide when it opens is ⑨'s question (not decided yet).
      const key = d.picked();
      if (on && open && d.narrow() && key) d.send({ type: 'studio:core/view', view: { action: 'reveal', key } });
    },
    ...(d.ask ? { ask: () => askAbout(head()) } : {}),
  });
  /** ✦ Ask AI about `key`'s motion on screen (the line's button, the card's Motion ▾): the shell's chat box takes it from here. */
  function askAbout(key: string | null) {
    const c = key ? clipOf(key) : null;
    if (key && c) d.ask?.(key, { name: c.name, use: c.use ?? c.name });
  }

  /** ⑨ B (studio-fix-0143): the plate to its one line for `key` (the bridge asked: plate-fold), then show it if still covered. */
  function slimFor(key: string) {
    if (!open || slim) return;
    slim = true;
    panel.render();
    // layout() sends the smaller inset first; the 'reveal' after it is measured against it (messages keep their order).
    d.layout();
    d.send({ type: 'studio:core/view', view: { action: 'reveal', key } });
  }
  /** The rows again (Fine-tune on the folded line): the picked object stays seen above them (a slide, no size change). */
  function unslim() {
    if (!slim) return;
    slim = false;
    panel.render();
    d.layout();
    const key = d.picked();
    if (open && key) d.send({ type: 'studio:core/view', view: { action: 'reveal', key } });
  }

  // Fold / open: the plate itself (PC: at the foot of the game; phone / side window: in the dock, above the card).
  panel.el.hidden = true;
  function setOpen(on: boolean) {
    if (open === on) return;
    open = on;
    slim = false;
    if (!on) {
      stop();
      stopTry();
      sel = [];
      making = null;
    }
    sentPoses = '';
    render();
    refresh(true);
    d.layout();
    d.changed();
    // A phone / the side window: the plate covers the lower half of the game; bring the picked object (and its path)
    // into what is left (the inset was just sent by layout()).
    // PC (studio-fix-0139, 2026-10-23): the plate rises over the foot of the game too, and a ship low in the frame was
    // under it — "Make a motion" asked for a drag the ruler then took. v0.1.31's "the camera stays put" still holds:
    // 'reveal' moves nothing unless the plate (or the card) covers the object's middle, then the short pan-only slide.
    // studio-fix-0142 (⑬ of the fourth first-run check, 2026-10-24): a phone / the side window too — 'reveal', not
    // 'focus'. focus centres the object in the WHOLE frame (bridge/editor.ts slideIntoFree says why), which on a phone
    // is under the plate: the gate being moved was not on screen at all (neon-ja-57). reveal slides it into the part
    // left above the plate (the inset layout() just sent), and falls back to focus when it is not drawn from here.
    const key = d.picked();
    if (on && key) d.send({ type: 'studio:core/view', view: { action: 'reveal', key } });
    // fix-0141 ⑨: closed, the camera goes back from the slides the plate made it take (the bridge keeps it where it is
    // if the person moved it meanwhile). Narrow too since studio-fix-0142, as it reveals there now.
    else if (!on) d.send({ type: 'studio:core/view', view: { action: 'unreveal' } });
  }
  // Shown or not at the last render: when that flips (the Library, the UI layer, Play), the game gets its poses again.
  let wasShown = false;
  function render() {
    const on = shown();
    if (panel.el.hidden === on) panel.el.hidden = !on;
    if (on) panel.render();
    else {
      panel.closeMore?.();
      if (playing) stop();
    }
    if (on !== wasShown) {
      wasShown = on;
      refresh(true);
    }
  }

  /** Keys meant for the timeline (from the plate itself, or the editor's keys when the plate was the last pressed). */
  function onKey(e: { key: string; ctrl: boolean; meta: boolean; shift: boolean }, onPlate = false): boolean {
    if (!shown()) return false;
    const mod = e.ctrl || e.meta;
    const k = e.key.toLowerCase();
    const mine = onPlate || touched;
    // Making (the line says "Esc to cancel"): Esc ends it — from the game page too (it drops the pick there as well).
    if (k === 'escape' && !mod && making) return endMaking();
    if (k === 'k' && !mod) return keyNow();
    if (!mine) return false;
    if (k === ' ' && !mod) return (playing ? stop() : play()), true;
    if ((k === 'delete' || k === 'backspace') && !mod) return deletePicked();
    if (mod && k === 'c' && sel.length) {
      const key = sel[0]!.key;
      const c = clipOf(key);
      if (c) clipboard = copyKeys(c, key, sel);
      return true;
    }
    if (mod && k === 'v' && clipboard) {
      const key = focus() ?? sel[0]?.key;
      if (!key) return false;
      const c = clipOf(key) ?? { name: firstName(key), len: 1, repeat: 'once' as MotionRepeat, when: { on: 'start' } as MotionWhen, keys: {} };
      const r = pasteKeys(c, clipboard, time, dim());
      sel = r.pasted.map((p) => ({ key, ch: p.ch, t: p.t }));
      chosen.set(key, c.name);
      one(key, withClip(store().get(key), c.name, r.clip));
      return true;
    }
    if ((k === 'arrowleft' || k === 'arrowright') && !mod) {
      // One tenth of a second (Shift: a whole one), on the time line.
      time = snapT(time + (k === 'arrowleft' ? -1 : 1) * (e.shift ? 1 : 0.1), span(), true);
      if (making?.shown) making = null;
      refresh();
      panel.render();
      return true;
    }
    if (k === 'escape' && sel.length) {
      sel = [];
      sendPath();
      panel.render();
      return true;
    }
    return false;
  }

  return {
    el: panel.el,
    isOpen: () => open,
    /** Folded to its one line (⑨ B): the inset's `plate` says 'slim', and a pick under it is not asked to fold again. */
    isSlim: () => open && slim,
    slimFor,
    /** The motion `key` shows (on the plate and the card), by its name on screen — the chat box's chip follows it (studio-motion-panel). */
    shownName: (key: string) => clipOf(key)?.name ?? null,
    /** Right-click's "Ask your AI about “Hop”…" (studio-motion-panel): the same as the plate's ✦. */
    askAbout: (key: string) => askAbout(key),
    setOpen,
    toggle: () => setOpen(!open),
    /** Draw again (the pick, the scene, the layout changed). */
    render() {
      render();
      // studio-preview-rows: the rows follow the pick, so an object that left them goes back to its place (and one
      // that joined shows its motion at the time line). Unchanged poses send nothing.
      if (shown()) (sendPath(), playing || trying || refresh());
    },
    refresh,
    shownPose,
    placeFor,
    records,
    /**
     * studio-motion-focus: an object picked in the game (placement/selected). With "+ Link an object" open it is linked
     * to the shown motion instead, and the pick goes back to the object being made: true = taken here (the shell does
     * not change its selection). A click on nothing just closes the list.
     */
    linkPick(key: string | null): boolean {
      if (!linking || !shown()) return false;
      const h = head();
      linking = false;
      if (!(key && key !== h && linkable().some((x) => x.key === key) && link(key))) panel.render();
      if (h) d.reselect?.(h);
      return true;
    },
    /** The person pressed something else (the game, the card): the editor's keys are the scene's again. */
    untouch: () => (touched = false),
    onKey,
    /**
     * An object moved in the game (placement/moved): true when it became a key (the shell then leaves its place
     * alone). `was`: the pose before the drag (the bridge's `from`).
     */
    moved(key: string, pose: Pose, end: boolean, was?: Pose): boolean {
      if (!records(key)) return false;
      stepBegins(key);
      begin(key, was);
      // From the motion before the gesture each time (a live drag sends many poses; the last one wins).
      store().set(key, before!.get(key) ?? null);
      const m = keyed(key, pose, startPose.get(key)!);
      const pre = end ? madeInGesture() : [];
      const from = end ? finish() : before;
      commit(new Map([[key, m]]), from, end, pre);
      if (end) stepEnds(key);
      return true;
    },
    /**
     * Several objects moved together (placement/moved-group): those that record become keys; the others are returned
     * (their poses turned into places) for the shell's usual handling. `changes` = the motion part of the one undo step.
     */
    movedGroup(poses: Array<{ key: string; pose: Pose; from?: Pose }>, end: boolean): { rest: Array<{ key: string; pose: Pose; from?: Pose }>; changes: Change[] } {
      const rest: Array<{ key: string; pose: Pose; from?: Pose }> = [];
      const next = new Map<string, Motion | null>();
      for (const e of poses) {
        if (!records(e.key)) {
          rest.push({ key: e.key, pose: placeFor(e.key, e.pose), from: e.from && placeFor(e.key, e.from) });
          continue;
        }
        stepBegins(e.key);
        begin(e.key, e.from);
        store().set(e.key, before!.get(e.key) ?? null);
        next.set(e.key, keyed(e.key, e.pose, startPose.get(e.key)!));
      }
      for (const [k, m] of next) store().set(k, m);
      const changes: Change[] = [];
      if (end) {
        changes.push(...madeInGesture());
        const from = finish();
        for (const [k, m] of next) if (!sameMotion(from?.get(k), m)) changes.push({ kind: 'motion', key: k, from: from?.get(k) ?? null, to: m });
        d.changed();
      }
      refresh();
      panel.render();
      if (end && making && next.has(making.key)) stepEnds(making.key);
      return { rest, changes };
    },
    /**
     * The card's numbers (typed, or a label dragged: `live` while it moves): true when it became a key. `from` = the
     * pose shown before the change.
     */
    card(key: string, pose: Pose, from: Pose, live = false): boolean {
      if (!records(key)) return false;
      stepBegins(key);
      begin(key, from);
      store().set(key, before!.get(key) ?? null);
      const m = keyed(key, pose, startPose.get(key)!);
      const pre = live ? [] : madeInGesture();
      const was = live ? before : finish();
      commit(new Map([[key, m]]), was, !live, pre);
      if (!live) stepEnds(key);
      return true;
    },
    onMessage(m: BridgeToShell): boolean {
      // The ◇ of a rule motion's path dragged in the game (studio-code-knobs): its knob, live then one undo step.
      if (m.type === 'studio:timeline/code-knob') {
        turnRule(m.name, m.knob, m.v, m.end, false);
        return true;
      }
      // The rule's shape as points (the answer to rulePoints): the Library motion becomes a motion of points, ONE undo step.
      if (m.type === 'studio:timeline/code-points') {
        const ask = pointsAsk;
        if (!ask || ask.id !== m.id) return true;
        pointsAsk = null;
        const l = lib().get(ask.name);
        if (!l?.code || !m.keys?.length) return void d.told?.(d.t('rule.pointsFail', { name: ask.name })), true;
        const to: LibraryMotion = { name: ask.name, len: ask.len, repeat: 'loop', keys: { p: structuredClone(m.keys) } };
        lib().set(ask.name, to);
        d.undo.push({ changes: [{ kind: 'motion-lib', key: ask.name, from: structuredClone(l), to: structuredClone(to) }] });
        d.changed();
        refresh();
        panel.render();
        d.told?.(d.t('rule.pointsDone', { name: ask.name, n: m.keys.length }));
        return true;
      }
      if (m.type === 'studio:timeline/area-moved') {
        const c = clipOf(m.key);
        const w = c ? (whensOf(c) as MotionWhen[]).find((x) => x.on === 'enter') : null;
        if (!c || !w) return true;
        begin(m.key);
        // The area is the first "enter" of the clip's ways to start (studio-timeline-2: there may be several).
        const ws = whensOf(c) as MotionWhen[];
        const i = ws.findIndex((x) => x.on === 'enter');
        const area = { p: m.p.slice(), size: (m.size ?? (ws[i] as Extract<MotionWhen, { on: 'enter' }>).area.size).slice() };
        const list = ws.map((x, j) => (j === i ? { ...x, area } : x)) as MotionWhen[];
        const nc: MotionClip = { ...c, when: list.length > 1 ? list : list[0]! };
        const from = m.end ? finish() : before;
        commit(new Map([[m.key, withClip(store().get(m.key), c.name, nc)]]), from, m.end);
        return true;
      }
      // studio-timeline-2: the path's handles, a key put on its line, a point made a corner (path-edit.ts).
      if (m.type === 'studio:timeline/handle') {
        editPath(m.key, (ks) => (ks[m.i] ? bend(ks, m.i, m.side, m.h, m.alone) : null), { end: m.end });
        return true;
      }
      if (m.type === 'studio:timeline/corner') {
        editPath(m.key, (ks) => (ks[m.i] ? toggleCorner(ks, m.i) : null));
        return true;
      }
      if (m.type === 'studio:timeline/insert') {
        const c = clipOf(m.key);
        if (!c?.keys.p?.length || !shown()) return true;
        if (playing) stop();
        const t = snapT(m.t, c.len, true);
        editPath(m.key, (ks) => insertAt(ks, t).keys);
        // The time line goes there and the new point is picked (its handles show).
        time = t;
        sel = [{ key: m.key, ch: 'p', t }];
        focusKey = m.key;
        refresh();
        panel.render();
        return true;
      }
      if (m.type !== 'studio:timeline/point') return false;
      const c = clipOf(m.key);
      if (!c?.keys.p?.[m.i]) return true;
      begin(m.key);
      const nc = structuredClone(c);
      nc.keys.p![m.i]!.v = m.v.slice();
      const from = m.end ? finish() : before;
      commit(new Map([[m.key, withClip(store().get(m.key), c.name, nc)]]), from, m.end);
      return true;
    },
    /** Undo / redo of a `motion` change. */
    apply(c: Extract<Change, { kind: 'motion' | 'motion-lib' | 'motion-rename' }>, dir: 'undo' | 'redo') {
      if (c.kind === 'motion-lib') lib().set(c.key, dir === 'undo' ? c.from : c.to);
      else if (c.kind === 'motion-rename') (dir === 'undo' ? renameLib(c.to, c.from, false) : renameLib(c.from, c.to, false));
      else store().set(c.key, dir === 'undo' ? c.from : c.to);
      if (c.kind !== 'motion') {
        refresh();
        if (shown()) panel.render();
        d.changed();
        return;
      }
      const names = new Set((store().get(c.key)?.clips ?? []).map((x) => x.name));
      if (chosen.has(c.key) && !names.has(chosen.get(c.key)!)) chosen.delete(c.key);
      sel = sel.filter((r) => keyTimes(clipOf(r.key), [r.ch]).some((t) => sameT(t, r.t)));
      refresh();
      if (shown()) panel.render();
      d.changed();
    },
    /**
     * ✦ Turn into a rule (studio-code-torule): the comparison changed (the AI swapped a rule in, the switch, a new
     * measure, Save cleared it): the strip, the line and the game's orange marks drawn again.
     */
    compared() {
      sendPath(true);
      if (shown()) panel.render();
    },
    /** The game page is new (reload, back from Play, another level): it shows places; send the poses again. */
    reset() {
      stop();
      stopTry();
      sentArea = '';
      sentPoses = '';
      sentPath = '';
      finish();
      keyDrag = null;
    },
    /**
     * The card's Motion row: this object's motions (each with when it starts), the Library's other motions to attach
     * (studio-motion-triggers), detach the shown one; and the button that opens the timeline.
     */
    cardRow(key: string, more: Pick<MotionCardDeps, 'menu' | 'say' | 'undoKey'> = {}): HTMLElement[] {
      return motionCardRow({
        ...more,
        // studio-motion-delete: the row's menu deletes the Library motion (every object, one undo step) and asks first
        // when other objects have it (usage = this level's objects; other levels lose it too, as the Library's Delete).
        remove: (name) => deleteLib(name),
        usedBy: (name) => usage(name).length,
        t: d.t,
        isRule: (name) => !!lib().get(name)?.code,
        ruleTag: d.t('rule.tag'),
        ruleTip: d.t('rule.motionTip'),
        clips: () => clipsOf(key),
        shown: () => clipOf(key),
        library: () => lib().list(),
        room: () => clipsOf(key).length < MAX_CLIPS,
        open: () => open,
        choose: (name) => {
          chosen.set(key, name);
          refresh();
          if (shown()) panel.render();
          d.changed();
        },
        attach: (name) => attachShow(key, name),
        detach: (name) => (detach(key, name), d.changed()),
        make: () => make(key),
        toggle: () => {
          focusKey = key;
          setOpen(!open);
        },
        ...(d.ask ? { ask: () => askAbout(key) } : {}),
        ...(d.toRule ? { toRule: (c: MotionClip) => d.toRule!(key, { name: c.name, use: c.use ?? c.name }) } : {}),
      });
    },
    // The Library's motions (library-motions.ts): what each is on, and what the Library page does with them.
    usage,
    attach,
    // studio-motion-flow: the plate on an object, from outside it (the Library's "+ New motion", a drop, its "Attach").
    make,
    show,
    detach,
    /** The motion the timeline shows for `key` first (the chosen one, else the one that plays at the start), or null. */
    clipName: (key: string): string | null => clipOf(key)?.name ?? null,
    /** More motions can go on `key` (MAX_CLIPS). */
    room: (key: string): boolean => clipsOf(key).length < MAX_CLIPS,
    duplicateLib,
    deleteLib,
    // The AI's hands (ai-hands.ts): the same edits as the plate's, named by object and motion.
    handsMake,
    handsClipSet,
    handsLibSet,
    renameLib: (from: string, to: string): string | null => {
      const n = lib().free(to.trim().slice(0, 40));
      if (!renameLib(from, n)) return null;
      d.changed();
      return n;
    },
    tryCue,
    stopTry,
    /** An object's motion as the timeline sees it (each clip with its Library motion's keys): tests, the Library. */
    motionOf: (key: string) => store().get(key),
    /** ● Auto key on / off (the plate's button; tests). */
    setAuto(on: boolean) {
      auto = on;
      sendRec();
      if (shown()) panel.render();
    },
    /** Tests and the ⌘K list. */
    state: () => ({ open, auto, time, playing: !!playing, sel: sel.slice(), clip: focus() ? clipOf(focus()!)?.name ?? null : null, trying: !!trying,
      lit: trying ? Object.fromEntries(trying.run.playing()) : {}, cues: cues().map((q) => q.id) }),
    setTime(t: number) {
      if (playing) stop();
      time = snapT(t, MAX_LEN, true);
      refresh();
      if (shown()) panel.render();
    },
  };
}

export type Timeline = ReturnType<typeof createTimeline>;
