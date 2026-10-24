// "Did the write-back keep the look?" (studio-writeback, 2026-10-24; CONTRACT.md §1.12 "Written into the code").
// Pure logic, no DOM (test/write-back.test.ts).
//
// WHY (a request, that day): "Is what the code says then hard-coded again by the JSON? The code has to be the truth."
// On Save the AI writes a layout's changes — its offsets, the objects placed by hand, the boxes drawn by hand — into the
// game's code, and `place.code --fold` takes them out of placement.json. The person must see nothing move: the editor
// measures every object of the layout before (old code + the file's changes) and after (the new code alone), and only
// a gap over a hand's width of nothing (1 cm, 1 px, half a degree, 1 % of the size) is said — to the AI, with the
// numbers to fix its rule, and to the person in one line ("Farthest off: Street lamps 3, 0.4 m"). The same measure as ✦
// Turn into a rule (to-rule.ts placeGaps), by key instead of by number: the keys are the same rule's.
import type { Dim, Pose } from '../contract.ts';

/** One object of the layout before the write-back: its key, the name the person sees, where it stood. */
export interface FoldSpot {
  key: string;
  label: string;
  pose: Pose;
}
/** The farthest off: in place (`p`, m / px), turn (`r`, degrees) or size (`s`, the factor now ÷ before). */
export interface FoldGap {
  key: string;
  label: string;
  what: 'p' | 'r' | 's';
  d: number;
  was: Pose;
  now: Pose;
}

/** What counts as the same look: 1 cm (3D) / 1 px (2D), half a degree, 1 % of the size. */
export const FOLD_TOL = { p3: 0.01, p2: 1, r: (0.5 * Math.PI) / 180, s: 0.01 };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const sizeOf = (s: Pose['s']) => (typeof s === 'number' ? Math.abs(s) || 1 : Array.isArray(s) && s.length ? s.reduce((a, b) => a + Math.abs(b), 0) / s.length || 1 : 1);
const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));

/**
 * Each object before against itself after (`after(key)`; undefined = the layout no longer has it). One that left the
 * layout but stands where it stood as another object (`elsewhere`: the AI took a hand-placed one out of the rule into an
 * object of its own) is not gone. `max` = the farthest off over the tolerance (place first, then turn, then size), null
 * = the same look; `gone` = those no longer there.
 */
export function foldGaps(before: FoldSpot[], after: (key: string) => Pose | undefined, dim: Dim, elsewhere: Pose[] = []): { max: FoldGap | null; gone: FoldSpot[] } {
  const tolP = dim === '3d' ? FOLD_TOL.p3 : FOLD_TOL.p2;
  const gone: FoldSpot[] = [];
  let p: FoldGap | null = null, r: FoldGap | null = null, s: FoldGap | null = null;
  for (const b of before) {
    const now = after(b.key);
    if (!now) {
      if (!elsewhere.some((q) => dist(q.p, b.pose.p) <= tolP)) gone.push(b);
      continue;
    }
    const dp = dist(now.p, b.pose.p);
    if (dp > tolP && (!p || dp > p.d)) p = { key: b.key, label: b.label, what: 'p', d: dp, was: b.pose, now };
    const dr = Math.abs(wrap((now.r ?? 0) - (b.pose.r ?? 0)));
    if (dr > FOLD_TOL.r && (!r || dr > (r.d * Math.PI) / 180)) r = { key: b.key, label: b.label, what: 'r', d: (dr * 180) / Math.PI, was: b.pose, now };
    const ds = sizeOf(now.s) / sizeOf(b.pose.s);
    if (Math.abs(ds - 1) > FOLD_TOL.s && (!s || Math.abs(ds - 1) > Math.abs(s.d - 1))) s = { key: b.key, label: b.label, what: 's', d: ds, was: b.pose, now };
  }
  return { max: p ?? r ?? s, gone };
}

/** A place for the AI's line: centimetres (3D) or whole pixels (2D). */
const at = (q: number[], dim: Dim) => `[${q.map((v) => (dim === '2d' ? Math.round(v) : Math.round(v * 100) / 100)).join(', ')}]`;

/**
 * The editor's measure for the AI's `studio: did …` line (English, exact enough to act on): the same look, or the
 * farthest off with where it stood and stands, and what to do — fix the rule, then `place.code` again (no --fold: the
 * editor measures against the same before).
 */
export function foldSaid(id: string, g: { max: FoldGap | null; gone: FoldSpot[] }, dim: Dim): string {
  const unit = (x: number) => (dim === '2d' ? `${Math.round(x)} px` : `${Math.round(x * 100) / 100} m`);
  const parts: string[] = [];
  const m = g.max;
  if (m) {
    parts.push(m.what === 'p' ? `the farthest off is ${m.key}, ${unit(m.d)} (it stood at ${at(m.was.p, dim)}, now ${at(m.now.p, dim)})`
      : m.what === 'r' ? `${m.key} is turned ${Math.round(m.d)}° from where it was`
      : `${m.key} is ${Math.round(Math.abs(m.d - 1) * 100)} % ${m.d > 1 ? 'bigger' : 'smaller'} than it was`);
  }
  if (g.gone.length) {
    parts.push(`${g.gone.slice(0, 4).map((x) => x.key).join(', ')}${g.gone.length > 4 ? ` +${g.gone.length - 4}` : ''} ${g.gone.length > 1 ? 'are' : 'is'} gone (the rule no longer puts ${g.gone.length > 1 ? 'them' : 'it'}: the count, or a keep-out area — a place written from a pin answers { p, hand: true })`);
  }
  if (!parts.length) return `; the editor measured every object before and after: all within ${dim === '2d' ? '1 px' : '1 cm'} — the look is the same`;
  return `; the editor measured every object before and after: ${parts.join('; ')} — fix codePlace('${id}') so the look is as before, then send place.code --id ${id} (no --fold: it measures against the same before)`;
}
