// A rule layout's keep-out areas as rows (studio-code-keepout, 2026-10-24; the plan's step 3, "need 4": "when things are
// placed procedurally I want to say where they must not go — sometimes as coordinates, sometimes as code").
// Pure logic, no DOM: the card's list (keep-out-wire.ts) and the game page's painting (bridge/keep-out.ts) both read the
// rows from here, so the list and the ground always show the same areas (test/keep-out-model.test.ts).
//
// Two kinds in ONE list, told apart by their edge only (the plan's decision 12):
//   box   drawn by hand on the ground — coordinates, kept in the file (`places[id].avoid[i].box`): orange.
//   code  a codeAvoid() condition in the game's code ("On the road", "From the player [5 m] within") — the rule decides
//         where; the file keeps only whether it is off and the knobs the person turned: violet, dashed.
// A condition the layout names in its own code (codePlace `avoid: ['road']`) is on without any file entry; switching it
// off writes `{ code, off: true }`, switching it back on with nothing else changed takes the entry out again (the file
// keeps only what the person changed — the same rule as ai-hands.ts place.avoid).
//
// Where it acts (chosen on 10/24, answer (a) of the plan's question 2): only the layout it is listed under — a box drawn
// for the crystals does not move the coins — and never an object put by hand. "Also for another layout" copies it.
import type { CodeKnob, KnobValue, PlacementAvoid, PlacementPlace } from '../contract.ts';

export type Box = { p: number[]; size: number[] };
export type AvoidRow =
  /** `i` = its place in the file's avoid list; `n` = which box it is (1, 2 …: "Box 2" when it has no name). */
  | { kind: 'box'; i: number; n: number; name: string | null; box: Box; off: boolean }
  /** `i` = its file entry's place (-1: none, the code's own condition untouched); `inCode` = the layout's code names it. */
  | { kind: 'code'; code: string; i: number; inCode: boolean; off: boolean; knobs?: Record<string, KnobValue> };

/** At most this many areas in one layout's list (studio-files.mjs LIMITS.maxAvoid). */
export const MAX_AVOID = 16;

const list = (e: PlacementPlace | null | undefined): PlacementAvoid[] => (Array.isArray(e?.avoid) ? e!.avoid! : []);
const isBox = (a: PlacementAvoid): a is Extract<PlacementAvoid, { box: Box }> => !!a && 'box' in a && !!a.box;

/**
 * The rows of one layout: the boxes first (in the order drawn), then the conditions — the code's own (in its order),
 * then the ones added to the file (the AI's `--do place.avoid --code`). WHY boxes first: what the hand drew is what the
 * person looks for right after drawing it (the plan's picture n4-box has "Box 1" on top).
 */
export function rowsOf(codeIds: readonly string[], e: PlacementPlace | null | undefined): AvoidRow[] {
  const all = list(e);
  const rows: AvoidRow[] = [];
  all.forEach((a, i) => {
    if (isBox(a)) rows.push({ kind: 'box', i, n: rows.length + 1, name: a.name ?? null, box: a.box, off: !!a.off });
  });
  const fileCode = new Map<string, number>();
  all.forEach((a, i) => {
    if (!isBox(a) && typeof (a as { code?: unknown }).code === 'string') fileCode.set((a as { code: string }).code, i);
  });
  const codeRow = (code: string, inCode: boolean): AvoidRow => {
    const i = fileCode.get(code) ?? -1;
    const a = i >= 0 ? (all[i] as { code: string; knobs?: Record<string, KnobValue>; off?: true }) : null;
    return { kind: 'code', code, i, inCode, off: !!a?.off, ...(a?.knobs ? { knobs: a.knobs } : {}) };
  };
  for (const c of codeIds) rows.push(codeRow(c, true));
  for (const c of fileCode.keys()) if (!codeIds.includes(c)) rows.push(codeRow(c, false));
  return rows;
}

/** An entry with `avoid` replaced (none left: no `avoid`). */
function withAvoid(e: PlacementPlace | null | undefined, avoid: PlacementAvoid[]): PlacementPlace {
  const o: PlacementPlace = { ...(e ?? {}) };
  if (avoid.length) o.avoid = avoid;
  else delete o.avoid;
  return o;
}

/**
 * A code condition's file entry after a change: one the code names, on, with no knob turned, is no entry at all; one the
 * file added stays `{ code }` (it is what makes it act).
 */
function codeEntry(code: string, inCode: boolean, off: boolean, knobs: Record<string, KnobValue> | undefined): PlacementAvoid | null {
  if (inCode && !off && !knobs) return null;
  return { code, ...(knobs ? { knobs } : {}), ...(off ? { off: true as const } : {}) };
}

/** Put a code row's new entry in its place (or at the end for a first entry; out when it is no entry any more). */
function putCode(e: PlacementPlace | null | undefined, row: Extract<AvoidRow, { kind: 'code' }>, entry: PlacementAvoid | null): PlacementPlace {
  const all = list(e).slice();
  if (row.i >= 0) {
    if (entry) all[row.i] = entry;
    else all.splice(row.i, 1);
  } else if (entry) all.push(entry);
  return withAvoid(e, all);
}

/** The switch: on (true) / off. One change of the entry. */
export function switchRow(e: PlacementPlace | null | undefined, row: AvoidRow, on: boolean): PlacementPlace {
  if (row.kind === 'box') {
    const all = list(e).slice();
    const a = all[row.i];
    if (!a || !isBox(a)) return { ...(e ?? {}) };
    const { off: _off, ...rest } = a;
    all[row.i] = on ? rest : { ...rest, off: true };
    return withAvoid(e, all);
  }
  return putCode(e, row, codeEntry(row.code, row.inCode, !on, row.knobs));
}

/**
 * × : the row out of the list. Only a row the file holds (a box, a condition added to the file); the code's own
 * conditions have no × — they are switched off instead (taking them out of the code is the AI's job, on request).
 */
export function canRemove(row: AvoidRow): boolean {
  return row.kind === 'box' || !row.inCode;
}
export function removeRow(e: PlacementPlace | null | undefined, row: AvoidRow): PlacementPlace {
  if (!canRemove(row) || row.i < 0) return { ...(e ?? {}) };
  const all = list(e).slice();
  all.splice(row.i, 1);
  return withAvoid(e, all);
}

/**
 * A condition's knob turned (the card's number, the ◇ on the ground): `{ v, was }` with the code's number as `was`; back on
 * the code's number = no knob (the file keeps only what differs).
 */
export function knobRow(e: PlacementPlace | null | undefined, row: AvoidRow, name: string, v: number, code: Record<string, CodeKnob>): PlacementPlace {
  if (row.kind !== 'code') return { ...(e ?? {}) };
  const r = (x: number) => {
    const y = Math.round(x * 10000) / 10000;
    return y === 0 ? 0 : y;
  };
  const ks: Record<string, KnobValue> = { ...(row.knobs ?? {}) };
  const was = code[name]?.v;
  if (was !== undefined && r(v) === r(was)) delete ks[name];
  else ks[name] = { v: r(v), ...(was !== undefined ? { was: r(was) } : {}) };
  return putCode(e, row, codeEntry(row.code, row.inCode, row.off, Object.keys(ks).length ? ks : undefined));
}

/** The knob values a condition runs with: the file's v over the code's. */
export function knobsNow(code: Record<string, CodeKnob>, file?: Record<string, KnobValue>): Record<string, number> {
  return Object.fromEntries(Object.entries(code).map(([n, k]) => [n, file?.[n]?.v ?? k.v]));
}

/** A box drawn: at the end of the list, with its name. */
export function addBox(e: PlacementPlace | null | undefined, box: Box, name: string): PlacementPlace {
  return withAvoid(e, [...list(e), { box: { p: box.p.slice(), size: box.size.slice() }, ...(name ? { name } : {}) }]);
}

/** Box `i` moved or resized (its name and off stay). */
export function setBox(e: PlacementPlace | null | undefined, i: number, box: Box): PlacementPlace {
  const all = list(e).slice();
  const a = all[i];
  if (!a || !isBox(a)) return { ...(e ?? {}) };
  all[i] = { ...a, box: { p: box.p.slice(), size: box.size.slice() } };
  return withAvoid(e, all);
}

/** The first "Box n" no box of this layout is called yet (n from 1): a box taken out leaves its number free. */
export function nextBoxName(e: PlacementPlace | null | undefined, nameOf: (n: number) => string): string {
  const used = new Set(list(e).filter(isBox).map((a) => a.name));
  for (let n = 1; n <= MAX_AVOID + 1; n++) if (!used.has(nameOf(n))) return nameOf(n);
  return nameOf(MAX_AVOID + 1);
}

/**
 * "Also for <another layout>" (the row's ⋯; answer (a) of 10/24: an area acts on its own layout, and this is how the
 * same area reaches a second one). A box is copied as it is (its name too); a condition is added with its knobs and
 * off as they are here. null = nothing to add (the other layout has it already, or its list is full).
 */
export function copyRowTo(target: PlacementPlace | null | undefined, targetCodeIds: readonly string[], row: AvoidRow): PlacementPlace | null {
  const all = list(target);
  if (all.length >= MAX_AVOID) return null;
  if (row.kind === 'box') {
    const same = all.some((a) => isBox(a) && JSON.stringify(a.box) === JSON.stringify(row.box));
    return same ? null : withAvoid(target, [...all, { box: { p: row.box.p.slice(), size: row.box.size.slice() }, ...(row.name ? { name: row.name } : {}), ...(row.off ? { off: true as const } : {}) }]);
  }
  const there = all.find((a) => !isBox(a) && (a as { code: string }).code === row.code) as { off?: true } | undefined;
  if (there ? !there.off : targetCodeIds.includes(row.code) && !row.knobs && !row.off) return null;
  const entry = codeEntry(row.code, targetCodeIds.includes(row.code), row.off, row.knobs);
  if (!entry) return null;
  const rest = all.filter((a) => isBox(a) || (a as { code: string }).code !== row.code);
  return withAvoid(target, [...rest, entry]);
}

/**
 * Rows the AI changed (a hands job's place.avoid): the rows of `after` that are new or differ from `before` — the card
 * lights them violet for a moment ("the row that arrived glows", the plan's step 3, item 4). Keys as rowKey.
 */
export function changedRows(codeIds: readonly string[], before: PlacementPlace | null | undefined, after: PlacementPlace | null | undefined): string[] {
  const was = new Map(rowsOf(codeIds, before).map((r) => [rowKey(r), JSON.stringify(r)]));
  return rowsOf(codeIds, after).filter((r) => was.get(rowKey(r)) !== JSON.stringify(r)).map(rowKey);
}
/** A row's lasting name: a condition by its code id, a box by its name (or its place). */
export const rowKey = (r: AvoidRow): string => (r.kind === 'code' ? `code:${r.code}` : `box:${r.name ?? r.i}`);

/** Is ground point `q` (the layout's space) inside box `b`? The loader's own rule (studio-placement.js inBox). */
export function inBox(q: number[], b: Box, n: 2 | 3): boolean {
  if (!b || !Array.isArray(b.p) || !Array.isArray(b.size) || !Array.isArray(q)) return false;
  if (n === 2) return Math.abs(q[0]! - b.p[0]!) <= b.size[0]! / 2 && Math.abs(q[1]! - b.p[1]!) <= b.size[1]! / 2;
  return Math.abs(q[0]! - b.p[0]!) <= b.size[0]! / 2 && q[1]! >= b.p[1]! - 1e-9 && q[1]! <= b.p[1]! + b.size[1]! && Math.abs(q[2]! - b.p[2]!) <= b.size[2]! / 2;
}
