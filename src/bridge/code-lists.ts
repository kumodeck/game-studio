// The game's code motions and code layouts, as the editor sees them (studio-code-base, 2026-10-24; CONTRACT.md §1.9.4,
// §1.12). The game's copy of the loader keeps what codeMotion() / codePlace() / codeAvoid() were told on globalThis
// (Symbol.for('game-studio.codeMotions' / 'codePlaces' / 'codeAvoids')); this reads them in the game's page and words
// them for the shell (`studio:code-motions`, `studio:code-places`): names, the objects a layout put, the knobs with the
// code's numbers.
//
// WHY sent with every world list (editor.ts post): the shell must know them as soon as it knows the objects — the
// AI's `--do place.code` waits for the id to be there, and a knob the AI wrote into the code on Save (the file's v
// now equal to the code's) is taken out of the file then (shell code-places.ts). Functions (at, make, test) never
// leave the page; only plain data does.
import type { CodeAvoidInfo, CodeKnob, CodeMotionInfo, CodePlaceInfo } from '../contract.ts';

type Win = Window & typeof globalThis;
type Entry = Record<string, unknown>;

const listOf = (win: Win, name: string): Map<string, Entry> | null => {
  const m = (win as unknown as Record<symbol, unknown>)[Symbol.for(`game-studio.${name}`)];
  return m instanceof Map ? (m as Map<string, Entry>) : null;
};
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** A knob list as plain data (the loader has checked its shape already; this only copies what it knows). */
function knobs(v: unknown): Record<string, CodeKnob> {
  const out: Record<string, CodeKnob> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [n, k] of Object.entries(v as Record<string, Entry>).slice(0, 3)) {
    if (!k || !num(k.v)) continue;
    out[n] = { v: k.v, label: str(k.label, 20) || n, unit: str(k.unit, 8), ...(num(k.min) ? { min: k.min } : {}), ...(num(k.max) ? { max: k.max } : {}), ...(num(k.step) ? { step: k.step } : {}) };
  }
  return out;
}

/** One round of a code motion in seconds with the code's knobs; null = none (it never ends) or it failed. */
function roundOf(m: Entry): number | null {
  let r = m.round;
  try {
    if (typeof r === 'function') r = (r as (k: Record<string, number>) => unknown)(Object.fromEntries(Object.entries(knobs(m.knobs)).map(([n, k]) => [n, k.v])));
  } catch {
    r = null;
  }
  return num(r) && r > 0 ? r : null;
}

/** The code motions of the game's page (none: an empty list, the same as a game without the loader). */
export function codeMotionsOf(win: Win): CodeMotionInfo[] {
  return [...(listOf(win, 'codeMotions')?.values() ?? [])].map((m) => ({
    code: str(m.id, 40), name: str(m.name, 40), knobs: knobs(m.knobs), round: roundOf(m),
    ...(str(m.note, 20) ? { note: str(m.note, 20) } : {}), ...(m.game === true ? { game: true } : {}),
  }));
}

/** The code layouts of the game's page, with the objects they put (keys) and the ones left out (skipped). */
export function codePlacesOf(win: Win): CodePlaceInfo[] {
  return [...(listOf(win, 'codePlaces')?.values() ?? [])].map((p) => {
    const drag = typeof p.drag === 'string' || (p.drag && typeof p.drag === 'object') ? structuredClone(p.drag as string | Record<string, string>) : undefined;
    return {
      id: str(p.id, 40), name: str(p.name, 40),
      keys: Array.isArray(p.keys) ? (p.keys as string[]).slice() : [],
      skipped: Array.isArray(p.skipped) ? (p.skipped as string[]).slice() : [],
      knobs: knobs(p.knobs),
      ...(drag ? { drag } : {}),
      avoid: Array.isArray(p.avoid) ? (p.avoid as string[]).slice() : [],
    };
  });
}

/** Every keep-out condition of the game's page (codeAvoid), whichever layouts use it. */
export function codeAvoidsOf(win: Win): CodeAvoidInfo[] {
  return [...(listOf(win, 'codeAvoids')?.values() ?? [])].map((a) => ({
    code: str(a.id, 40), name: str(a.name, 40), ...(str(a.after, 20) ? { after: str(a.after, 20) } : {}), knobs: knobs(a.knobs), ...(typeof a.show === 'function' ? { show: true } : {}),
  }));
}

/**
 * A layout's objects under its name and number ("Hex row 2" for hex-2) where the adapter knows them by their key
 * alone (the loader marks them with their key): the editor's list, card and `--do list` then say what the person was
 * told ("a row of hexagons"). An object the game names itself keeps its own label.
 */
export function namedByLayout<T extends { key: string; label?: string }>(items: T[], places: CodePlaceInfo[]): T[] {
  const names = new Map<string, string>();
  for (const p of places) p.keys.forEach((k) => names.set(k, `${p.name} ${k.slice(p.id.length + 1)}`));
  return items.map((it) => (names.has(it.key) && (!it.label || it.label === it.key) ? { ...it, label: names.get(it.key)! } : it));
}
