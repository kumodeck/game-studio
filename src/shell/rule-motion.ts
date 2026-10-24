// A rule motion as the timeline shows it (studio-code-knobs, 2026-10-24; the plan's step 2, item 7: "the rule motion's
// strip", and the first step's report: "a code motion's row says 'Repeat: Once'"). Pure, no DOM (test/rule-motion.test.ts).
//
// A rule motion is a Library motion whose shape is the game's codeMotion() (LibraryMotion.code): no points, no length
// of its own (the strip is as wide as one round of it), nothing that repeats "once" — it goes on as long as the game
// runs (until a `until` stops it). So the timeline's line says its knobs instead of "Repeat [Once ▾]", and its row is a
// violet strip that says what it is in words made FROM THE KNOBS ("Rule motion: Spiral · Radius 2 m · Lap 4 s") — turn
// a knob and the words follow, so they are never a stale sentence of the AI's.
import type { CodeKnob, CodeMotionInfo, KnobValue, LibraryMotion } from '../contract.ts';
import { knobNumber } from './knob.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;

/** One knob of a rule motion on screen: the code's definition with the number now (the file's v over the code's). */
export interface RuleKnob extends CodeKnob {
  name: string;
  /** The number in the game's code (where the AI writes v on Save). */
  code: number;
}

/** What the timeline needs of a rule motion: its knobs now, its round, and whether the game page has it. */
export interface RuleInfo {
  code: string;
  name: string;
  knobs: RuleKnob[];
  round: number | null;
  drag?: string;
  note?: string;
  /** The game page listed its rules and this one is not there (the AI took it out, it failed to load). */
  missing: boolean;
  /** The game page has not said yet (it is opening): the name only. */
  loading: boolean;
}

/** The rule behind a Library motion (null = a motion of points). `list` = the game page's (null = not said yet). */
export function ruleOf(l: LibraryMotion | undefined | null, list: CodeMotionInfo[] | null): RuleInfo | null {
  if (!l?.code) return null;
  const c = list?.find((x) => x.code === l.code);
  const knobs = c ? Object.entries(c.knobs).map(([name, k]) => ({ ...k, name, code: k.v, v: l.knobs?.[name]?.v ?? k.v })) : [];
  return { code: l.code, name: l.name, knobs, round: c?.round ?? null, ...(c?.drag ? { drag: c.drag } : {}), ...(c?.note ? { note: c.note } : {}),
    missing: !!list && !c, loading: !list };
}

/** A knob's number with its unit, as people read it ("2 m", "4 s"). */
export const knobSaid = (t: T, k: Pick<CodeKnob, 'v' | 'unit' | 'step'>) => `${knobNumber(k.v, k.step)}${k.unit ? t(`hands.unit.${k.unit}`) : ''}`;

/** "Spiral · Radius 2 m · Lap 4 s" — the rule's name, then each knob (and its note): the strip's words, the Library's. */
export function ruleWords(t: T, r: RuleInfo): string {
  return [r.name, ...r.knobs.map((k) => `${k.label} ${knobSaid(t, k)}`), ...(r.note ? [r.note] : [])].join(' · ');
}

/** The knobs a turn leaves in the Library motion: { v, was } for each one off the code's number, none for the rest. */
export function ruleKnobsAfter(r: RuleInfo, name: string, v: number): Record<string, KnobValue> | null {
  const out: Record<string, KnobValue> = {};
  for (const k of r.knobs) {
    const now = k.name === name ? v : k.v;
    if (Math.abs(now - k.code) > 1e-9) out[k.name] = { v: Math.round(now * 10000) / 10000, was: k.code };
  }
  return Object.keys(out).length ? out : null;
}
