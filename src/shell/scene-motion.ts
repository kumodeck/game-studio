// Scene motions (studio-timeline-2, 2026-10-22; CONTRACT.md §4.1 `tracks`): one motion that moves several objects — a
// cutscene ("the boat rows in, the buoy dips, the barrel rolls off the pier"). Pure helpers on the timeline's resolved
// clips; timeline-wire.ts keeps the state (which scene is open) and does the edits through them. Unit-tested in
// test/timeline-2.test.ts.
//
// The shape: a Library motion with `tracks` (keys per object key) instead of `keys`; each object in it has the usual
// attachment `{ use: 'Arrival', when, until }`. WHY not a new container next to `motion` (a `scenes` list): every part
// that already knows an object's motion (undo, the Save count, levels, Try, the loader, the schema, the AI's skill)
// then knows a scene too — one way to read `motion.<key>.clips[]`. The cost is that each object's attachment repeats
// the scene's `when` / `until`: the editor writes them together (sceneWhens), and the loader starts the whole scene
// when any one of them starts (motionRunner), so they cannot drift apart in the game.
import type { LibraryMotion, Motion, MotionClip } from '../contract.ts';

export interface SceneStore {
  keys(): string[];
  /** An object's motion as the timeline sees it (resolved clips). */
  get(key: string): Motion | null;
}

/** The objects in scene motion `name` (in the store's order). */
export function sceneMembers(store: SceneStore, name: string): string[] {
  return store.keys().filter((k) => (store.get(k)?.clips ?? []).some((c) => c.use === name && c.scene));
}

/**
 * The clip an object gets when it joins the scene: the scene's len / repeat, no keys yet (its row is empty until it is
 * moved), and the same `when` / `until` as the objects already in it (`like`), so the scene still starts as one.
 */
export function joinClip(l: LibraryMotion, like: MotionClip | null): MotionClip {
  const c: MotionClip = { name: l.name, use: l.name, len: l.len, repeat: l.repeat, scene: true, keys: {}, when: structuredClone(like?.when ?? { on: 'start' }) };
  if (like?.until) c.until = structuredClone(like.until);
  return c;
}

/**
 * `c` with the "when" of `from` (the clip just edited): what the editor writes to every other object of the scene when
 * one of them changes its Starts / Stops, length or repeat (all the scene's, not the object's).
 */
export function likeScene(c: MotionClip, from: MotionClip): MotionClip {
  const out: MotionClip = { ...c, len: from.len, repeat: from.repeat, when: structuredClone(from.when) };
  if (from.until) out.until = structuredClone(from.until);
  else delete out.until;
  delete out.start;
  return out;
}

/** "Scene · 3 objects": how many objects a Library motion moves (1 for an ordinary one). */
export const sceneSize = (l: LibraryMotion | null | undefined) => (l?.tracks ? Object.keys(l.tracks).length : 1);

// ----- linking (studio-motion-focus, 2026-10-23) -----
// A request (2026-10-23): "mostly I only need the object I picked; sometimes I want it to work with other objects, so let me add
// the ones to link". The timeline shows the picked object's row only, and "+ Link an object" puts another object in the
// same motion — a scene motion above, nothing new: an ordinary motion that gets its first linked object becomes one
// (`tracks`, the picked object's keys as its track), and one whose last linked object is taken off becomes ordinary
// again (`keys`), so link + unlink leaves the file as it was.

/** An ordinary Library motion as a scene of one: `key`'s keys become its track (the rest of it stays); the order starts with it. */
export function asScene(l: LibraryMotion, key: string): LibraryMotion {
  const out: LibraryMotion = { ...structuredClone(l), keys: {}, tracks: { [key]: structuredClone(l.keys ?? {}) }, order: [key] };
  return out;
}

/** A scene left with one object (`key`) as an ordinary motion again: that object's track becomes its keys (no order: no rows). */
export function asOrdinary(l: LibraryMotion, key: string): LibraryMotion {
  const out: LibraryMotion = { ...structuredClone(l), keys: structuredClone(l.tracks?.[key] ?? {}) };
  delete out.tracks;
  delete out.order;
  return out;
}

// ----- the rows' order (studio-ui-lead2, 2026-10-23) -----
// `order` (contract LibraryMotion.order): the tracks' keys as the person arranged the rows. WHY an array next to `tracks`
// and not the tracks' key order: the file is written canonical (object keys sorted), so only an array keeps an order.
// Absent (a file from before, or never dragged): the tracks' keys as they are.

/** The scene's rows in order: `order` where it is, then any track it does not name (as written). */
export function trackOrder(l: Pick<LibraryMotion, 'tracks' | 'order'> | null | undefined): string[] {
  const ks = Object.keys(l?.tracks ?? {});
  const named = (l?.order ?? []).filter((k) => ks.includes(k));
  return [...named, ...ks.filter((k) => !named.includes(k))];
}

/** The scene with `key`'s track set to `keys` (a new object goes last in the order; one already there keeps its place). */
export function withTrack(l: LibraryMotion, key: string, keys: LibraryMotion['keys']): LibraryMotion {
  const tracks = { ...(l.tracks ?? {}), [key]: structuredClone(keys) };
  const order = trackOrder({ tracks: l.tracks ?? {}, order: l.order });
  return { ...l, keys: {}, tracks, order: order.includes(key) ? order : [...order, key] };
}

/** The scene without `key`'s track (and without it in the order). */
export function withoutTrack(l: LibraryMotion, key: string): LibraryMotion {
  const tracks = { ...(l.tracks ?? {}) };
  delete tracks[key];
  const out: LibraryMotion = { ...l, tracks };
  if (l.order) out.order = l.order.filter((k) => k !== key);
  return out;
}

/** The scene with its rows in `order` (the dragged row's new place); tracks the order does not name keep theirs, after. */
export function withOrder(l: LibraryMotion, order: string[]): LibraryMotion {
  const ks = Object.keys(l.tracks ?? {});
  const named = order.filter((k, i) => ks.includes(k) && order.indexOf(k) === i);
  return { ...l, order: [...named, ...ks.filter((k) => !named.includes(k))] };
}
