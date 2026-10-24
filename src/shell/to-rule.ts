// ✦ Turn into a rule (studio-code-torule, 2026-10-24; the plan's step 4 — need 3 of the four asked for that day: "I want to
// turn what I placed by hand, or a motion I made by hand, into a close procedural / formula version"). The other way
// round from "Convert to coordinates" (rule → hand; once "Place individually" / "Make editable points"): hand → rule.
//
// Who does what (the plan's decisions 13 and 15):
//   the person   picks the hand-placed objects (or a motion of points) and presses ✦ Turn into a rule: the chat box gets a
//                draft ("Turn these into a close rule"), and they send it (or add "6 m apart" first).
//   the AI       writes the nearest rule (codePlace / codeMotion, 1–3 knobs) and swaps it in ITSELF — `--do place.code
//                --replace` / `motion.code --replace` — never handing steps back (10/24: "the worst experience").
//   the editor   (this file) keeps the hand's shape from just before the swap and MEASURES how close the rule came: the
//                largest gap, which object (places, in the `replace` order) or which moment (a motion, 64 places over
//                one round of the rule). A number the person reads off the screen, not the AI's word for it; ⌘Z puts
//                the hand's shape back.
// The comparison (orange dots = the hand, a thin line = the gap, "Max deviation: lamp-3 (0.6 m)") stays until Save:
// after Save the AI takes the hand's shape out of the code, and there is nothing left to compare with.
// Pure (no DOM): test/to-rule.test.ts.
import type { Dim, MotionClip, MotionKey, MotionRepeat } from '../contract.ts';
import { offsetsAt } from './timeline-model.ts';

/**
 * One hand-placed object a layout replaced: its key, the name the person saw, where it stood (the model's pose), and
 * the rule's object it is compared with — number `n` (1-based: `<id>-<n>`), its place in the `replace` list.
 */
export interface HandSpot {
  key: string;
  label: string;
  p: number[];
  n: number;
}
/** The motion of points a rule motion replaced: its position keys (offsets), length and repeat. */
export interface HandMotion {
  keys: MotionKey[];
  len: number;
  repeat?: MotionRepeat;
}
/** The largest gap of a layout: the rule's number it was (1-based), the hand object, how far (m / px). */
export interface PlaceGap {
  n: number;
  key: string;
  label: string;
  d: number;
}
/** The largest gap of a motion over one round: when (s from its start), how far, and the hand's path at the same times. */
export interface MotionGap {
  t: number;
  d: number;
}

/** How many places one round of a rule motion is compared at (the plan's decision 13: 64, as its violet line has). */
export const MOTION_SAMPLES = 64;

const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));

/**
 * A layout against the hand-placed objects it replaced: each hand object ↔ the rule's object number `n` (`ruleAt(n)`,
 * where it stands now; null = the rule has no such number — a count that came out smaller, a number a keep-out area
 * skipped). The distance is the whole one (3D x, y and z: a lamp a metre too high is as wrong as a metre to the side;
 * 2D px). `max` = the farthest pair, null when no pair could be measured; `unmatched` = hand objects with no partner.
 */
export function placeGaps(hand: HandSpot[], ruleAt: (n: number) => number[] | null | undefined): { each: Array<number | null>; max: PlaceGap | null; unmatched: number } {
  const each: Array<number | null> = [];
  let max: PlaceGap | null = null;
  let unmatched = 0;
  for (const h of hand) {
    const r = ruleAt(h.n);
    if (!r || r.length !== h.p.length) {
      each.push(null);
      unmatched++;
      continue;
    }
    const d = dist(h.p, r);
    each.push(d);
    if (!max || d > max.d + 1e-9) max = { n: h.n, key: h.key, label: h.label, d };
  }
  return { each, max, unmatched };
}

/** The hand motion as a clip the loader's maths reads (position only: the rule is compared where it goes, not how it turns). */
const handClip = (m: HandMotion): MotionClip => ({ name: '', len: m.len, ...(m.repeat ? { repeat: m.repeat } : {}), keys: { p: m.keys } }) as MotionClip;

/**
 * A rule motion against the motion of points it replaced, over one round of the rule: `rule` = its offsets at
 * MOTION_SAMPLES + 1 times (the game page runs its at(): studio:timeline/code-points), each compared with the hand
 * motion at the same time (its own repeat: a 2 s back-and-forth is 4 s a round). `was` = the hand's path at those times
 * (the orange line drawn beside the violet one). `max` null = nothing to compare.
 */
export function motionGap(hand: HandMotion, rule: Array<{ t: number; v: number[] }>): { max: MotionGap | null; was: number[][] } {
  const clip = handClip(hand);
  const was: number[][] = [];
  let max: MotionGap | null = null;
  for (const s of rule) {
    const p = offsetsAt(clip, s.t).p;
    if (!p) continue;
    was.push(p);
    if (p.length !== s.v.length) continue;
    const d = dist(p, s.v);
    if (!max || d > max.d + 1e-9) max = { t: s.t, d };
  }
  return { max, was };
}

/**
 * The hand motion's path over one round of the rule (`n` + 1 places, as the violet line has), offsets from where the
 * object stands: the orange line the game page draws beside the rule's.
 */
export function handPath(hand: HandMotion, round: number, n = MOTION_SAMPLES): number[][] {
  const clip = handClip(hand);
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const p = offsetsAt(clip, (round * i) / n).p;
    if (p) out.push(p.map((v) => Math.round(v * 1000) / 1000));
  }
  return out;
}

/**
 * A gap as people read it: 3D metres (one decimal from 0.1 m, two below it: "0.6 m", "0.04 m"), 2D whole pixels.
 * The unit is the knobs' own words (hands.unit.m / px), so "m" / "px" read the same as the card's Gap.
 */
export function gapText(d: number, dim: Dim, unit: (u: string) => string): string {
  if (dim === '2d') return `${Math.round(d)}${unit('px')}`;
  const r = d >= 0.095 ? Math.round(d * 10) / 10 : Math.round(d * 100) / 100;
  return `${r}${unit('m')}`;
}

/** Seconds as the ruler reads them ("1.2"). */
export const timeText = (t: number) => String(Math.round(t * 10) / 10);

/**
 * What the editor keeps of the hand's shape between the AI's swap and Save: per layout (by level, since `places` are
 * the level's) the objects it replaced, per Library motion the points it had. It is shown only while the swap is still
 * there (the layout's `from` still names those objects; the motion is still a rule) — ⌘Z the swap and the comparison
 * goes with it, ⌘⇧Z and it is back — and the whole of it goes on Save.
 */
export class RuleCompare {
  private places = new Map<string, HandSpot[]>();
  private motions = new Map<string, HandMotion>();
  private gaps = new Map<string, MotionGap | null>();
  /** The card's / the line's switch "Compare with original" (one for both: the person either wants the marks or not). */
  show = true;

  private static placeId(level: string, id: string) {
    return `${level}\n${id}`;
  }
  /** A swap of the AI's: the hand objects it replaced (added to an earlier swap of the same layout). */
  setPlace(level: string, id: string, spots: HandSpot[]): void {
    const k = RuleCompare.placeId(level, id);
    const old = (this.places.get(k) ?? []).filter((s) => !spots.some((x) => x.key === s.key));
    this.places.set(k, [...old, ...spots.map((s) => ({ key: s.key, label: s.label, p: s.p.slice(), n: s.n }))]);
    this.show = true;
  }
  /** The hand objects layout `id` replaced, in the `replace` order — only those its `from` still names (else []). */
  place(level: string, id: string, from: string[] | undefined): HandSpot[] {
    const spots = this.places.get(RuleCompare.placeId(level, id)) ?? [];
    return from?.length ? spots.filter((s) => from.includes(s.key)) : [];
  }
  /** A swap of the AI's: the points motion `name` had, and the gap measured then (null = not measured). */
  setMotion(name: string, m: HandMotion, gap: MotionGap | null = null): void {
    this.motions.set(name, { keys: structuredClone(m.keys), len: m.len, ...(m.repeat ? { repeat: m.repeat } : {}) });
    this.gaps.set(name, gap);
    this.show = true;
  }
  /** Measured again (a knob of the rule turned). */
  setMotionGap(name: string, gap: MotionGap | null): void {
    if (this.motions.has(name)) this.gaps.set(name, gap);
  }
  motionGapOf(name: string): MotionGap | null {
    return this.gaps.get(name) ?? null;
  }
  /** The points Library motion `name` had before the AI made it a rule — while it is a rule (`isRule`), else null. */
  motion(name: string, isRule: boolean): HandMotion | null {
    return isRule ? this.motions.get(name) ?? null : null;
  }
  /** A Library motion renamed: its comparison goes with it. */
  rename(from: string, to: string): void {
    const m = this.motions.get(from);
    if (!m) return;
    this.motions.delete(from);
    this.motions.set(to, m);
    this.gaps.set(to, this.gaps.get(from) ?? null);
    this.gaps.delete(from);
  }
  any(): boolean {
    return this.places.size > 0 || this.motions.size > 0;
  }
  /** Save: the AI takes the hand's shape out of the code now — nothing left to compare with. */
  clear(): void {
    this.places.clear();
    this.motions.clear();
    this.gaps.clear();
    this.show = true;
  }
}
