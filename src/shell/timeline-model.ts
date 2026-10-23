// The timeline's pure logic (studio-timeline, 2026-10-22; CONTRACT.md §1.9): clips and
// their keys, the pose an object shows at a time, the older motion shape read as a clip, a new motion, and the key
// edits the panel makes (set, move, delete, copy / paste, ease). No DOM: unit-tested in test/timeline.test.ts.
//
// WHY offsets from the place, not absolute values (Unity's clips hold absolute ones): the object's place
// (`objects` in placement.json) keeps its meaning — moving the object with the timeline folded carries the whole
// motion along, a level that puts the same object elsewhere reuses the motion, and the AI reads "turns 90° from where
// it stands". Position is added, angles are added, size is multiplied.
// WHY every change returns a new clip / motion: the undo stack keeps whole motions (`{ kind: 'motion', from, to }`,
// the change motion-gui added), so one edit = one snapshot, and nothing here mutates what the store holds.
import type { Dim, Motion, MotionChannel, MotionClip, MotionEase, MotionKey, MotionRepeat, Pose } from '../contract.ts';
import { clipAt, motionAt } from '../loader/studio-placement.js';

export const CHANNELS: MotionChannel[] = ['p', 'r', 's'];
/** Two keys closer than this (seconds) are the same moment: a new key there replaces the old one. */
export const SAME_T = 0.0005;
/** Keys dragged on the timeline snap to this (seconds); Alt drags freely. 1/20 s: fine enough for game motion, coarse enough to land on 1.0. */
export const SNAP_T = 0.05;
export const MIN_LEN = 0.1;
export const MAX_LEN = 600;
export const MAX_CLIPS = 16;
export const MAX_KEYS = 256;
/** A new key's ease (Blender's and Unity's default curve: starts slowly, stops slowly). */
export const DEFAULT_EASE: MotionEase = 'ease';

export type Offsets = { p: number[] | null; r: number[] | null; s: number[] | null };

const rt = (t: number) => Math.round(t * 1000) / 1000;
const zeros = (n: number) => Array.from({ length: n }, () => 0);
const ones = (n: number) => Array.from({ length: n }, () => 1);
/** How many numbers one key of a channel holds: p / s 3 in 3D, 2 in 2D; r 3 in 3D, 1 in 2D. */
export const width = (ch: MotionChannel, dim: Dim) => (dim === '3d' ? 3 : ch === 'r' ? 1 : 2);
/** The key value that changes nothing (the rest of a channel). */
export const restOf = (ch: MotionChannel, dim: Dim) => (ch === 's' ? ones(width(ch, dim)) : zeros(width(ch, dim)));

/** Where a clip is at `t` (the loader's own maths, so the editor and the game agree). */
export function offsetsAt(clip: MotionClip | null | undefined, t: number): Offsets & { done: boolean } {
  return clipAt(clip, t) as Offsets & { done: boolean };
}

/** The pose shown for an object at its place with these offsets. */
export function compose(place: Pose, at: Offsets, dim: Dim): Pose {
  const out: Pose = structuredClone(place);
  if (at.p) out.p = place.p.map((v, i) => v + (at.p![i] ?? 0));
  if (at.r) {
    if (dim === '3d') {
      out.r = (place.r ?? 0) + (at.r[1] ?? 0);
      const tx = (place.t?.[0] ?? 0) + (at.r[0] ?? 0), tz = (place.t?.[1] ?? 0) + (at.r[2] ?? 0);
      // A tilt only when there is one: a pose without `t` leaves the game's own x / z angles alone (contract Pose.t).
      if (place.t || Math.abs(tx) > 1e-9 || Math.abs(tz) > 1e-9) out.t = [tx, tz];
    } else out.r = (place.r ?? 0) + (at.r[0] ?? 0);
  }
  if (at.s) {
    const n = width('s', dim);
    const base = Array.isArray(place.s) ? place.s : Array.from({ length: n }, () => (typeof place.s === 'number' ? place.s : 1));
    const s = base.map((v, i) => v * (at.s![i] ?? 1));
    out.s = s.every((v) => Math.abs(v - s[0]!) < 1e-9) && !Array.isArray(place.s) ? s[0]! : s;
  }
  return out;
}

/** The offsets that turn `place` into `pose` (compose's inverse), for one channel. */
export function offsetOf(place: Pose, pose: Pose, ch: MotionChannel, dim: Dim): number[] {
  if (ch === 'p') return pose.p.map((v, i) => v - (place.p[i] ?? 0));
  if (ch === 'r') {
    if (dim !== '3d') return [(pose.r ?? 0) - (place.r ?? 0)];
    return [(pose.t?.[0] ?? 0) - (place.t?.[0] ?? 0), (pose.r ?? 0) - (place.r ?? 0), (pose.t?.[1] ?? 0) - (place.t?.[1] ?? 0)];
  }
  const n = width('s', dim);
  const vec = (s: Pose['s']) => (Array.isArray(s) ? s : Array.from({ length: n }, () => (typeof s === 'number' ? s : 1)));
  const a = vec(place.s), b = vec(pose.s);
  return b.map((v, i) => (a[i] ? v / a[i]! : 1));
}

/** The channels whose value differs between two poses (what a drag / a typed number changed). */
export function changedChannels(a: Pose, b: Pose, dim: Dim): MotionChannel[] {
  const diff = (x: number[], y: number[], eps: number) => x.some((v, i) => Math.abs(v - (y[i] ?? 0)) > eps);
  const out: MotionChannel[] = [];
  if (diff(a.p, b.p, 1e-6)) out.push('p');
  if (diff(offsetOf(a, b, 'r', dim), zeros(width('r', dim)), 1e-6)) out.push('r');
  if (diff(offsetOf(a, b, 's', dim), ones(width('s', dim)), 1e-6)) out.push('s');
  return out;
}

// ----- the older shape (v0.1.13) as a clip -----

/**
 * A motion in the timeline's shape: its clips as they are, or the older path / speed / repeat / spin turned into one
 * clip "Motion" that plays at the start. The path becomes position keys at the times the old constant speed reached
 * each point (straight lines: 'linear'); a loop gets its way back to the start as a last key; a spin becomes one turn
 * (0 → 360°, linear) that loops. With both, the spin is spread over the path's time.
 */
export function toClips(m: Motion | null | undefined, dim: Dim): Motion | null {
  if (!m) return null;
  if (m.clips?.length) return { clips: m.clips.map((c) => structuredClone(c)) };
  const keys: MotionClip['keys'] = {};
  let len = 0;
  let repeat: MotionRepeat = 'loop';
  if (m.path?.length) {
    const n = m.path[0]!.length;
    const pts = [zeros(n), ...m.path.map((q) => q.slice())];
    repeat = m.repeat ?? 'pingpong';
    if (repeat === 'loop') pts.push(zeros(n));
    const speed = m.speed && m.speed > 0 ? m.speed : 1;
    let t = 0;
    keys.p = pts.map((v, i) => {
      if (i) t += Math.hypot(...v.map((x, k) => x - pts[i - 1]![k]!)) / speed;
      return { t: rt(t), v, ease: 'linear' as MotionEase };
    });
    len = Math.max(MIN_LEN, rt(t));
  }
  if (m.spin) {
    const turn = Math.sign(m.spin) * Math.PI * 2;
    const T = len || rt(Math.abs(turn / m.spin));
    len ||= Math.max(MIN_LEN, T);
    const v = (a: number) => (dim === '3d' ? [0, a, 0] : [a]);
    keys.r = [{ t: 0, v: v(0), ease: 'linear' }, { t: len, v: v(keys.p ? m.spin * len : turn), ease: 'linear' }];
  }
  if (!keys.p && !keys.r) return null;
  return { clips: [{ name: 'Motion', len, repeat, start: true, keys }] };
}

// ----- new motions (studio-no-presets, 2026-10-23) -----
// Until then this was "templates": the v0.1.13 kinds (Back and forth, Round, Once, Spin) kept as starting points, each
// with two or five keys the person never placed. A review, on seeing them in the menus: "what is this? presets? why
// are 'back and forth' and 'round' in there?" — and to "keep just 'Make a motion' and 'Use a saved motion'": "we don't
// need them" (10/23). A motion is made by showing it (timeline-wire make: where it stands is 0 s, a drag is the next
// key). A file whose motion goes back and forth still plays as it did: that is its `repeat` (and toClips above reads
// the older path / spin), never a template.

/** A motion with no keys yet: the clip menu's "+ Make a motion" on a thing that moves already (filled by the next move). */
export function blankClip(name: string): MotionClip {
  return { name, len: 2, repeat: 'once', keys: {} };
}
// (sceneClip — an empty scene from the clip menu's "New: Scene" — went with that menu line, studio-ui-lead2 2026-10-23:
// a scene is made by linking an object to a motion, timeline-wire.ts link(); scene-motion.ts asScene.)

/** "Motion", or "Motion 2", "Motion 3"… — a name no clip of this object has. */
export function freeName(clips: MotionClip[], base: string): string {
  const taken = new Set(clips.map((c) => c.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

// ----- keys -----

/** A key picked on the timeline: object, channel, time (a time names a key: two keys of a channel never share one). */
export interface KeyRef {
  key: string;
  ch: MotionChannel;
  t: number;
}
export const refId = (r: KeyRef) => `${r.key}\n${r.ch}\n${rt(r.t)}`;
export const sameT = (a: number, b: number) => Math.abs(a - b) < SAME_T;

const sorted = (ks: MotionKey[]) => ks.slice().sort((a, b) => a.t - b.t);

/** The clip with a key at `t` on `ch` (replacing one at that moment, keeping its ease); the length grows to hold it. */
export function setKey(c: MotionClip, ch: MotionChannel, t: number, v: number[], ease?: MotionEase): MotionClip {
  const out = structuredClone(c);
  const ks = out.keys[ch] ?? [];
  const at = ks.findIndex((k) => sameT(k.t, t));
  const key: MotionKey = { t: rt(t), v: v.slice(), ease: ease ?? (at >= 0 ? ks[at]!.ease : undefined) ?? DEFAULT_EASE };
  // A key set again keeps the path's handles it had (studio-timeline-2): moving a bent point keeps it bent.
  if (at >= 0 && ks[at]!.in) key.in = ks[at]!.in!.slice();
  if (at >= 0 && ks[at]!.out) key.out = ks[at]!.out!.slice();
  if (at >= 0) ks[at] = key;
  else if (ks.length < MAX_KEYS) ks.push(key);
  out.keys[ch] = sorted(ks);
  if (t > out.len) out.len = Math.min(MAX_LEN, rt(t));
  return out;
}

/** Keys of `c` (this object's) that `sel` picks. */
const picks = (sel: KeyRef[], key: string) => sel.filter((r) => r.key === key);
const isPicked = (sel: KeyRef[], ch: MotionChannel, t: number) => sel.some((r) => r.ch === ch && sameT(r.t, t));

/** The clip without the picked keys. A channel left with no key goes (that property then stays as placed). */
export function deleteKeys(c: MotionClip, key: string, sel: KeyRef[]): MotionClip {
  const mine = picks(sel, key);
  const out = structuredClone(c);
  for (const ch of CHANNELS) {
    const ks = (out.keys[ch] ?? []).filter((k) => !isPicked(mine, ch, k.t));
    if (ks.length) out.keys[ch] = ks;
    else delete out.keys[ch];
  }
  return out;
}

/**
 * The clip with the picked keys moved by `dt` seconds (kept between 0 and the length). A moved key that lands on a
 * key that was not moved replaces it (the dragged one wins, as in Blender). Returns the moved refs' new times too.
 */
export function moveKeys(c: MotionClip, key: string, sel: KeyRef[], dt: number): { clip: MotionClip; moved: KeyRef[] } {
  const mine = picks(sel, key);
  const out = structuredClone(c);
  const moved: KeyRef[] = [];
  for (const ch of CHANNELS) {
    const ks = out.keys[ch];
    if (!ks) continue;
    const go = ks.filter((k) => isPicked(mine, ch, k.t)).map((k) => ({ ...k, t: rt(Math.min(out.len, Math.max(0, k.t + dt))) }));
    const stay = ks.filter((k) => !isPicked(mine, ch, k.t) && !go.some((g) => sameT(g.t, k.t)));
    // Two moved keys squeezed onto one moment (against 0 or the end): the later one wins.
    const merged = new Map<number, MotionKey>();
    for (const k of go) merged.set(Math.round(k.t * 1000), k);
    out.keys[ch] = sorted([...stay, ...merged.values()]);
    for (const k of merged.values()) moved.push({ key, ch, t: k.t });
  }
  return { clip: out, moved };
}

/** The picked keys' ease set to `ease`. */
export function easeKeys(c: MotionClip, key: string, sel: KeyRef[], ease: MotionEase): MotionClip {
  const mine = picks(sel, key);
  const out = structuredClone(c);
  for (const ch of CHANNELS) for (const k of out.keys[ch] ?? []) if (isPicked(mine, ch, k.t)) k.ease = ease;
  return out;
}

/** What ⌘C holds: keys by channel, their times from the earliest one copied (so ⌘V puts the first at the playhead). */
export type Copied = Array<{ ch: MotionChannel; dt: number; v: number[]; ease?: MotionEase; in?: number[]; out?: number[] }>;

export function copyKeys(c: MotionClip, key: string, sel: KeyRef[]): Copied {
  const mine = picks(sel, key);
  const out: Copied = [];
  for (const ch of CHANNELS) for (const k of c.keys[ch] ?? []) if (isPicked(mine, ch, k.t)) out.push({ ch, dt: k.t, v: k.v.slice(), ease: k.ease, ...(k.in ? { in: k.in.slice() } : {}), ...(k.out ? { out: k.out.slice() } : {}) });
  const t0 = Math.min(...out.map((k) => k.dt));
  return out.map((k) => ({ ...k, dt: rt(k.dt - t0) }));
}

/** ⌘V: the copied keys put on this clip from `at` (a channel the clip's object cannot take — another dim — is skipped). */
export function pasteKeys(c: MotionClip, keys: Copied, at: number, dim: Dim): { clip: MotionClip; pasted: Array<{ ch: MotionChannel; t: number }> } {
  let out = c;
  const pasted: Array<{ ch: MotionChannel; t: number }> = [];
  for (const k of keys) {
    if (k.v.length !== width(k.ch, dim)) continue;
    const t = rt(at + k.dt);
    if (t > MAX_LEN) continue;
    out = setKey(out, k.ch, t, k.v, k.ease);
    // The handles come along (a bent point pasted is bent the same way).
    const got = out.keys[k.ch]!.find((x) => sameT(x.t, t))!;
    if (k.in) got.in = k.in.slice();
    if (k.out) got.out = k.out.slice();
    pasted.push({ ch: k.ch, t });
  }
  return { clip: out, pasted };
}

/** Every key time of a clip (any channel), for the object's summary row. */
export function keyTimes(c: MotionClip | null | undefined, chs: MotionChannel[] = CHANNELS): number[] {
  const ts: number[] = [];
  for (const ch of chs) for (const k of c?.keys[ch] ?? []) if (!ts.some((t) => sameT(t, k.t))) ts.push(k.t);
  return ts.sort((a, b) => a - b);
}

/** Snap a time to the timeline's grid (and to 0 … max). */
export function snapT(t: number, max: number, free = false): number {
  const s = free ? rt(t) : Math.round(t / SNAP_T) * SNAP_T;
  return rt(Math.min(max, Math.max(0, s)));
}

/** A KeyboardEvent.code as a person reads it: "KeyE" → "E", "Digit1" → "1", "ArrowUp" → "↑", "Space" → "Space". */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return arrows[code] ?? code;
}

/** "0:01.6" — minutes, seconds and a tenth (the time readout; tabular figures keep it still while it runs). */
export function clock(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** A motion (the store's shape) with clip `name` replaced by `c` (or added; null = removed). Empty → null. */
export function withClip(m: Motion | null, name: string, c: MotionClip | null): Motion | null {
  // In place (a rename keeps the clip where it was in the menu), removed, or added at the end.
  const clips = (m?.clips ?? []).slice();
  const i = clips.findIndex((x) => x.name === name);
  if (i >= 0) c ? (clips[i] = c) : clips.splice(i, 1);
  else if (c) clips.push(c);
  return clips.length ? { clips } : null;
}

/** The older motion's pose at `t` (the editor still previews one it could not turn into a clip, e.g. a bad file). */
export function legacyOffsets(m: Motion, t: number, dim: Dim): Offsets {
  const a = motionAt(m, t) as { off: number[] | null; turn: number };
  return { p: a.off, r: m.spin ? (dim === '3d' ? [0, a.turn, 0] : [a.turn]) : null, s: null };
}

/**
 * The Library motions that count on Save on their own (studio-motion-line, 2026-10-23: "one hand, one change" — making a
 * motion with one drag said "Save · 2", later 3: the object's motion and the new Library motion it uses, counted apart).
 * A Library motion used by an object whose motion changed too is that object's change: counted once, with the object.
 * One changed alone (its keys edited on the plate, a rename, one made in the Library) still counts.
 */
export function libCounted(changedNames: string[], changedKeys: string[], usesOf: (key: string) => string[]): string[] {
  const told = new Set(changedKeys.flatMap(usesOf));
  return changedNames.filter((n) => !told.has(n));
}

/**
 * The line's "[1 s ▾]" (studio-motion-line, 2026-10-23): "gate moves in 2 s" — the whole motion takes `s` seconds, every
 * point's time scaled with it (a motion of 0 s → 1 s becomes 0 s → 2 s). The length field of before only moved the end
 * (and never before the last point), which the sentence would not say. 0.1 s … 10 minutes, to the millisecond.
 */
export function stretchClip(c: MotionClip, s: number): MotionClip {
  const len = Math.min(MAX_LEN, Math.max(MIN_LEN, Math.round(s * 1000) / 1000));
  const f = c.len > 0 ? len / c.len : 1;
  const keys: MotionClip['keys'] = {};
  for (const ch of CHANNELS) {
    const ks = c.keys[ch];
    if (ks) keys[ch] = ks.map((k) => ({ ...k, t: Math.min(len, Math.round(k.t * f * 1000) / 1000) }));
  }
  return { ...c, len, keys };
}
