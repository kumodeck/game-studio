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
