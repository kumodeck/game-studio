// What the AI's last change did, as marks: which objects it added and which it moved (the violet outlines, the list's
// dots and the one tag in the game, "Claude moved 2"). Split out of main.ts (studio-motion-fix, decided 2026-11-05) so
// the rules below are unit-tested (test/ai-marks.test.ts) and main.ts stops growing.
//
// WHY two objects are never counted as moved by the AI (a first-time walk of v0.1.77):
// - What the game moves by itself (Item.held 'game', the list's ↻ ones: a ring the game spins, an orb that pulses, a
//   pillar on a code motion). Its pose is different on every frame, so the page before the reload and the page after it
//   never agree — every Save that the AI wrote into the code ended with "AI moved 2" / "AI moved 7" on things the AI had
//   not touched, right under the editor's own line "the look is the same". The AI can still move such an object in the
//   code; the mark just cannot tell that from the game's own motion, and a false "moved" is worse than none.
// - The objects of a code layout the AI wrote back (`place.code --fold`) and the editor MEASURED as the same look (every
//   object within 1 cm / 1 px). A write-back on purpose changes nothing on screen; marking it says the opposite.
import type { Dim, Item, Pose } from '../contract.ts';
import { samePose } from './pose-compare.ts';

export type AiMark = 'moved' | 'added';

export interface AiMarkInput {
  /** Poses on screen before the reload (the model's pose, else the adapter's). */
  before: Map<string, Pose>;
  /** The code's own poses (`was`) at the same moment: an unsaved move of the person's is not the AI's. */
  beforeCode: Map<string, Pose> | null;
  /** The new page's first list. */
  items: Item[];
  dim: Dim;
  /** Keys the game moved by itself on the page before (held 'game'); the new page may not have watched them yet. */
  heldBefore?: Set<string>;
  /** Keys never marked moved: the objects of layouts the AI wrote back with the same look. */
  sameLook?: Set<string>;
}

export interface AiMarkResult {
  marks: Map<string, AiMark>;
  /** Objects of the old page not on the new one (the "N gone" of the AI line), less the renamed ones. */
  gone: number;
}

const flat = (p: Pose): Pose => ({ ...p, z: undefined });

export function aiMarksOf(x: AiMarkInput): AiMarkResult {
  const { before, beforeCode, items, dim } = x;
  const marks = new Map<string, AiMark>();
  const now = new Set(items.map((i) => i.key));
  // An object without a name gets a new path key when the AI adds things before it in the
  // tree (path:8 → path:11): same place as one that is gone = the same object, not a new one.
  const goneAt = [...before.entries()].filter(([k]) => !now.has(k)).map(([, p]) => p);
  let renamed = 0;
  for (const it of items) {
    const was = before.get(it.key);
    if (!was && it.unstable && goneAt.some((p) => samePose(flat(it.pose), flat(p), dim))) {
      renamed++;
      continue;
    }
    if (!was) {
      marks.set(it.key, 'added');
      continue;
    }
    if (samePose(flat(it.pose), flat(was), dim)) continue;
    if (it.held === 'game' || x.heldBefore?.has(it.key) || x.sameLook?.has(it.key)) continue;
    // At its old code's pose: the person's unsaved move is not shown yet (it is pushed back later), not the AI's.
    const code0 = beforeCode?.get(it.key);
    if (!code0 || !samePose(flat(it.pose), flat(code0), dim)) marks.set(it.key, 'moved');
  }
  const gone = Math.max(0, [...before.keys()].filter((k) => !now.has(k)).length - renamed);
  return { marks, gone };
}

/** The one tag in the game, in the AI's own name ("Claude moved 2": the strings use {Ai}, filled by translate()). */
export function aiMarksLabel(marks: Map<string, AiMark>, t: (k: string, v?: Record<string, string | number>) => string): string | undefined {
  const list = [...marks.values()];
  if (!list.length) return undefined;
  const added = list.filter((v) => v === 'added').length;
  const key = added === list.length ? 'ai.tagAdded' : added === 0 ? 'ai.tagMoved' : 'ai.tagChanged';
  return t(key, { n: added === list.length ? added : list.length });
}
