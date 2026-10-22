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
import type { BridgeToShell, Dim, Motion, MotionChannel, MotionClip, MotionEase, MotionRepeat, Pose, ShellToBridge } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { MotionStore } from './motion-model.ts';
import { sameMotion } from './motion-model.ts';
import { createTimelinePanel, type TimelineView } from './timeline-panel.ts';
import {
  CHANNELS, changedChannels, compose, copyKeys, deleteKeys, easeKeys, freeName, fromTemplate, keyTimes, MAX_CLIPS, MAX_LEN, MIN_LEN, moveKeys,
  offsetOf, offsetsAt, pasteKeys, refId, restOf, sameT, setKey, snapT, withClip, type Copied, type KeyRef, type Offsets, type Template,
} from './timeline-model.ts';
import type { Change, UndoStack } from './undo.ts';

export interface TimelineDeps {
  /** The world's motions (worldModel.motion; a getter: a game with levels has one model per level). */
  readonly store: MotionStore;
  undo: UndoStack;
  send(m: ShellToBridge): void;
  dim(): Dim;
  /** The timeline can be shown now: editing the world of a 3D game, not playing, the Scene on screen. */
  usable(): boolean;
  /** The one picked object (null with none or several). */
  picked(): string | null;
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
}

/**
 * `makePanel`: the plate (timeline-panel.ts). The unit tests give a stand-in with no DOM, so what a move, a typed number
 * or a key press does is tested without a browser (test/timeline.test.ts).
 */
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
  const finish = () => {
    const from = before;
    before = null;
    startPose.clear();
    return from;
  };
  let keyDrag: { sel: KeyRef[]; from: Map<string, Motion | null> } | null = null;
  // What the game page shows now, so a frame that changes nothing sends nothing.
  let sentPoses = '';
  let sentPath = '';

  const store = () => d.store;
  const dim = () => d.dim();
  const clipsOf = (key: string): MotionClip[] => store().get(key)?.clips ?? [];
  const clipOf = (key: string): MotionClip | null => {
    const cs = clipsOf(key);
    const want = chosen.get(key);
    return cs.find((c) => c.name === want) ?? cs.find((c) => c.start) ?? cs[0] ?? null;
  };
  const focus = () => d.picked() ?? (focusKey && d.place(focusKey) ? focusKey : null);
  const shown = () => open && d.usable();
  /** The keys with a motion that are in the scene now. */
  const moving = () => store().keys().filter((k) => !!d.place(k));
  const offsets = (key: string, at = time): Offsets | null => {
    const c = clipOf(key);
    return c ? offsetsAt(c, at) : null;
  };

  // ----- what the game page shows -----
  /** Every moving object at its place + its clip now (open), or at its place (folded). `force`: send even if unchanged. */
  function refresh(force = false) {
    const poses: Array<{ key: string; pose: Pose }> = [];
    for (const k of moving()) {
      const place = d.place(k)!;
      const at = shown() ? offsets(k) : null;
      poses.push({ key: k, pose: at ? compose(place, at, dim()) : place });
    }
    const sig = JSON.stringify(poses);
    if (poses.length && (force || sig !== sentPoses)) {
      d.send({ type: 'studio:timeline/pose', poses });
      d.numbers();
    }
    sentPoses = sig;
    sendPath(force);
  }
  /** The picked object's path (its position keys), drawn in 3D in the game. */
  function sendPath(force = false) {
    const key = shown() ? d.picked() : null;
    const c = key ? clipOf(key) : null;
    const place = key ? d.place(key) : undefined;
    const ks = c?.keys.p;
    const msg: ShellToBridge = key && place && ks?.length
      ? { type: 'studio:timeline/path', key, base: place.p.slice(), keys: structuredClone(ks), now: offsets(key)?.p ?? null,
        sel: ks.map((k, i) => (sel.some((r) => r.key === key && r.ch === 'p' && sameT(r.t, k.t)) ? i : -1)).filter((i) => i >= 0) }
      : { type: 'studio:timeline/path', key: null };
    const sig = JSON.stringify(msg);
    if (!force && sig === sentPath) return;
    sentPath = sig;
    d.send(msg);
  }

  // ----- edits: one place for "store, undo, show" -----
  /** Put new motions in the store; `end` = also one undo step from `from` (the motions before the gesture). */
  function commit(next: Map<string, Motion | null>, from: Map<string, Motion | null> | null, end: boolean) {
    for (const [k, m] of next) store().set(k, m);
    if (end) {
      const changes: Change[] = [];
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
    const key = focus();
    const c = key ? clipOf(key) : null;
    if (!key || !c) return;
    const next = f(structuredClone(c));
    chosen.set(key, next.name);
    one(key, withClip(store().get(key), c.name, next));
  };

  /**
   * Record `pose` (what the object shows now) as keys at the time line, for the channels that differ from `was` (what
   * it showed before the gesture). The object's first clip is made here when it has none.
   */
  function keyed(key: string, pose: Pose, was: Pose): Motion | null {
    const place = d.place(key);
    if (!place) return store().get(key);
    let m = store().get(key);
    let c = clipOf(key);
    if (!c) {
      c = { name: freeName([], 'Motion'), len: Math.max(1, snapT(time, MAX_LEN)), repeat: 'once', start: true, keys: {} };
      chosen.set(key, c.name);
    }
    const name = c.name;
    for (const ch of changedChannels(was, pose, dim())) {
      // A property that had no key yet starts from how it stood at 0 s (else the motion would begin at the new pose).
      if (!c.keys[ch]?.length && time > 0) c = setKey(c, ch, 0, restOf(ch, dim()));
      c = setKey(c, ch, time, offsetOf(place, pose, ch, dim()));
    }
    m = withClip(m, name, c);
    return m;
  }
  /** Is a gesture on `key` a key now (● on, the timeline open), or a move of its place? */
  const records = (key: string) => shown() && auto && (!!clipOf(key) || time > 0) && !!d.place(key);
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
    const c = focus() ? clipOf(focus()!) : null;
    const len = c?.len ?? span();
    const rep = c?.repeat ?? 'once';
    if (rep === 'loop') time = run % len;
    else if (rep === 'pingpong') time = run % (2 * len) > len ? 2 * len - (run % (2 * len)) : run % (2 * len);
    else time = Math.min(run, len);
    // Every object at the same running time (each with its own repeat).
    const poses: Array<{ key: string; pose: Pose }> = [];
    for (const k of moving()) {
      const at = offsets(k, rep === 'once' || !c ? time : run);
      if (at) poses.push({ key: k, pose: compose(d.place(k)!, at, dim()) });
    }
    if (poses.length) (d.send({ type: 'studio:timeline/pose', poses }), d.numbers());
    sentPoses = '';
    panel.place();
    sendPath();
    if (rep === 'once' && run >= len && moving().every((k) => (clipOf(k)?.repeat ?? 'once') === 'once')) return void stop();
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (!shown()) return;
    const c = focus() ? clipOf(focus()!) : null;
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
    const lens = [...rows().map((r) => r.clip?.len ?? 0), focus() ? clipOf(focus()!)?.len ?? 0 : 0].filter((x) => x > 0);
    return lens.length ? Math.max(1, ...lens) : 4;
  };

  function rows() {
    const keys = new Set(moving());
    const p = d.picked();
    if (p && d.place(p)) keys.add(p);
    const order = d.order();
    const at = (k: string) => {
      const i = order.indexOf(k);
      return i < 0 ? 1e9 : i;
    };
    return [...keys].sort((a, b) => at(a) - at(b)).map((k) => ({ key: k, label: d.label(k), picked: k === p, open: openRows.has(k), clip: clipOf(k) }));
  }

  function view(): TimelineView {
    const key = focus();
    const c = key ? clipOf(key) : null;
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
    };
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
    let c = clipOf(key) ?? { name: 'Motion', len: Math.max(1, snapT(time, MAX_LEN)), repeat: 'once' as MotionRepeat, start: true, keys: {} };
    const name = c.name;
    const chs = CHANNELS.filter((ch) => c.keys[ch]?.length);
    for (const ch of chs.length ? chs : (['p'] as MotionChannel[])) c = setKey(c, ch, time, offsetOf(place, pose, ch, dim()));
    chosen.set(key, name);
    one(key, withClip(store().get(key), name, c));
    return true;
  }

  const panel = makePanel(view, {
    t: d.t,
    play: (on) => (on ? play() : stop()),
    scrub(t, end) {
      if (playing) stop();
      time = snapT(t, span(), true);
      refresh();
      panel.place();
      if (end) panel.render();
    },
    auto(on) {
      auto = on;
      panel.render();
    },
    fold: () => setOpen(false),
    clip(value) {
      const key = focus();
      if (!key) return;
      if (value.startsWith('new:')) {
        const cs = clipsOf(key);
        if (cs.length >= MAX_CLIPS) return;
        const kind = value.slice(4) as Template;
        const c = fromTemplate(kind, freeName(cs, kind === 'empty' ? 'Motion' : d.t(`tl.tpl.${kind}`)), dim());
        // The first motion of an object plays at the start; another waits for a cue (one start per object).
        c.start = !cs.some((x) => x.start);
        chosen.set(key, c.name);
        openRows.add(key);
        time = 0;
        one(key, withClip(store().get(key), c.name, c));
      } else if (value === 'delete') {
        const c = clipOf(key);
        if (!c) return;
        chosen.delete(key);
        sel = sel.filter((r) => r.key !== key);
        one(key, withClip(store().get(key), c.name, null));
      } else if (clipsOf(key).some((c) => c.name === value)) {
        chosen.set(key, value);
        sel = sel.filter((r) => r.key !== key);
        refresh();
        panel.render();
      }
    },
    rename(name) {
      const key = focus();
      const c = key ? clipOf(key) : null;
      if (!key || !c) return;
      const n = freeName(clipsOf(key).filter((x) => x !== c), name.slice(0, 40));
      chosen.set(key, n);
      one(key, withClip(store().get(key), c.name, { ...c, name: n }));
    },
    len: (s) => editClip((c) => {
      // Not shorter than its last key (the keys would fall off the end); 0.1 s … 10 minutes.
      const last = Math.max(0, ...CHANNELS.flatMap((ch) => (c.keys[ch] ?? []).map((k) => k.t)));
      return { ...c, len: Math.min(MAX_LEN, Math.max(MIN_LEN, last, Math.round(s * 1000) / 1000)) };
    }),
    repeat: (r) => editClip((c) => ({ ...c, repeat: r })),
    start(on) {
      const key = focus();
      const c = key ? clipOf(key) : null;
      if (!key || !c) return;
      // One clip per object plays at the start: choosing it here makes the others wait for a cue.
      let m = store().get(key);
      for (const x of m?.clips ?? []) if (x.name !== c.name && x.start && on) m = withClip(m, x.name, { ...x, start: undefined });
      const next: MotionClip = { ...c, start: on || undefined };
      if (on) delete next.when;
      one(key, withClip(m, c.name, next));
    },
    when: (text) => editClip((c) => ({ ...c, when: text.trim() || undefined })),
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
  });

  // Fold / open: the plate itself (PC: at the foot of the game; phone / side window: in the dock, above the card).
  panel.el.hidden = true;
  function setOpen(on: boolean) {
    if (open === on) return;
    open = on;
    if (!on) {
      stop();
      sel = [];
    }
    sentPoses = '';
    render();
    refresh(true);
    d.layout();
    d.changed();
    // A phone / the side window: the plate covers the lower half of the game; bring the picked object (and its path)
    // into what is left (the inset was just sent by layout()).
    const key = d.picked();
    if (on && key && d.narrow()) d.send({ type: 'studio:core/view', view: { action: 'focus', key } });
  }
  // Shown or not at the last render: when that flips (the Library, the UI layer, Play), the game gets its poses again.
  let wasShown = false;
  function render() {
    const on = shown();
    if (panel.el.hidden === on) panel.el.hidden = !on;
    if (on) panel.render();
    else if (playing) stop();
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
      const c = clipOf(key) ?? { name: 'Motion', len: 1, repeat: 'once' as MotionRepeat, start: true, keys: {} };
      const r = pasteKeys(c, clipboard, time, dim());
      sel = r.pasted.map((p) => ({ key, ch: p.ch, t: p.t }));
      chosen.set(key, c.name);
      one(key, withClip(store().get(key), c.name, r.clip));
      return true;
    }
    if ((k === 'arrowleft' || k === 'arrowright') && !mod) {
      // One tenth of a second (Shift: a whole one), on the time line.
      time = snapT(time + (k === 'arrowleft' ? -1 : 1) * (e.shift ? 1 : 0.1), span(), true);
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
    setOpen,
    toggle: () => setOpen(!open),
    /** Draw again (the pick, the scene, the layout changed). */
    render() {
      render();
      if (shown()) sendPath();
    },
    refresh,
    shownPose,
    placeFor,
    records,
    /** The person pressed something else (the game, the card): the editor's keys are the scene's again. */
    untouch: () => (touched = false),
    onKey,
    /**
     * An object moved in the game (placement/moved): true when it became a key (the shell then leaves its place
     * alone). `was`: the pose before the drag (the bridge's `from`).
     */
    moved(key: string, pose: Pose, end: boolean, was?: Pose): boolean {
      if (!records(key)) return false;
      begin(key, was);
      // From the motion before the gesture each time (a live drag sends many poses; the last one wins).
      store().set(key, before!.get(key) ?? null);
      const m = keyed(key, pose, startPose.get(key)!);
      const from = end ? finish() : before;
      commit(new Map([[key, m]]), from, end);
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
        begin(e.key, e.from);
        store().set(e.key, before!.get(e.key) ?? null);
        next.set(e.key, keyed(e.key, e.pose, startPose.get(e.key)!));
      }
      for (const [k, m] of next) store().set(k, m);
      const changes: Change[] = [];
      if (end) {
        const from = finish();
        for (const [k, m] of next) if (!sameMotion(from?.get(k), m)) changes.push({ kind: 'motion', key: k, from: from?.get(k) ?? null, to: m });
        d.changed();
      }
      refresh();
      panel.render();
      return { rest, changes };
    },
    /**
     * The card's numbers (typed, or a label dragged: `live` while it moves): true when it became a key. `from` = the
     * pose shown before the change.
     */
    card(key: string, pose: Pose, from: Pose, live = false): boolean {
      if (!records(key)) return false;
      begin(key, from);
      store().set(key, before!.get(key) ?? null);
      const m = keyed(key, pose, startPose.get(key)!);
      const was = live ? before : finish();
      commit(new Map([[key, m]]), was, !live);
      return true;
    },
    onMessage(m: BridgeToShell): boolean {
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
    apply(c: Extract<Change, { kind: 'motion' }>, dir: 'undo' | 'redo') {
      store().set(c.key, dir === 'undo' ? c.from : c.to);
      const names = new Set((store().get(c.key)?.clips ?? []).map((x) => x.name));
      if (chosen.has(c.key) && !names.has(chosen.get(c.key)!)) chosen.delete(c.key);
      sel = sel.filter((r) => keyTimes(clipOf(r.key), [r.ch]).some((t) => sameT(t, r.t)));
      refresh();
      if (shown()) panel.render();
      d.changed();
    },
    /** The game page is new (reload, back from Play, another level): it shows places; send the poses again. */
    reset() {
      stop();
      sentPoses = '';
      sentPath = '';
      finish();
      keyDrag = null;
    },
    /** The card's Motion row: the clip menu (this object's motions) and the button that opens the timeline. */
    cardRow(key: string): HTMLElement[] {
      const cs = clipsOf(key);
      const c = clipOf(key);
      const sel = h('select', { class: 'motion-kind', 'aria-label': d.t('motion.label'), dataset: { part: 'motion-clip' } });
      if (!cs.length) sel.append(h('option', { value: '', text: d.t('motion.none') }));
      for (const x of cs) {
        const o = h('option', { value: x.name, text: `${x.name} · ${Math.round(x.len * 10) / 10} s` });
        if (x.name === c?.name) o.selected = true;
        sel.append(o);
      }
      sel.disabled = !cs.length;
      sel.addEventListener('change', () => {
        chosen.set(key, sel.value);
        refresh();
        if (shown()) panel.render();
      });
      const btn = h('button', { type: 'button', class: `motion-tl${open ? ' on' : ''}`, 'aria-pressed': String(open), title: d.t('tl.openTip'), dataset: { action: 'timeline', part: 'motion-timeline' },
        onclick: () => {
          focusKey = key;
          setOpen(!open);
        } }, h('span', { class: 'tl-diamond' }), h('span', { text: d.t('tl.open') }));
      const cells = h('div', { class: 'f-cells motion-cells' }, h('span', { class: 'motion-pick' }, sel, icon('chevronDown')), btn);
      return [h('span', { class: 'f-l', text: d.t('motion.label') }), cells];
    },
    /** ● Auto key on / off (the plate's button; tests). */
    setAuto(on: boolean) {
      auto = on;
      if (shown()) panel.render();
    },
    /** Tests and the ⌘K list. */
    state: () => ({ open, auto, time, playing: !!playing, sel: sel.slice(), clip: focus() ? clipOf(focus()!)?.name ?? null : null }),
    setTime(t: number) {
      if (playing) stop();
      time = snapT(t, MAX_LEN, true);
      refresh();
      if (shown()) panel.render();
    },
  };
}

export type Timeline = ReturnType<typeof createTimeline>;
