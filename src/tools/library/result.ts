// Library: the creator's decisions, and the library.json built from them.
//
// The studio never edits game code. A "replace" is only a note for the AI
// ("make the code load B where it loads A"); "added" lists new files the
// creator dropped in (the host already wrote them under assets/, add-only);
// "unused" lists files to ASK the creator about. The AI reads library.json
// and changes the code after asking.
//
// Validation is not done here: the shell passes the shared validator from
// src/schema (one validator for the shell, the local server and the cloud),
// so this module cannot drift from what the server accepts.

import type { LibraryFile, ValidateResult } from '../../contract.ts';
import type { LibraryRow } from './marks.ts';

export interface Placed {
  key: string;
  p: number[];
  r?: number;
  s?: number;
}

export interface LibraryState {
  /** from path -> to path. */
  replace: Map<string, string>;
  /** Added files in the order they were added. */
  added: Array<{ file: string; place?: Placed }>;
}

export function emptyState(): LibraryState {
  return { replace: new Map(), added: [] };
}

/** Restore the state from a previously saved library.json (unknown shapes are ignored). */
export function stateFromFile(json: unknown): LibraryState {
  const s = emptyState();
  if (!json || typeof json !== 'object') return s;
  const j = json as Partial<LibraryFile>;
  if (Array.isArray(j.replace)) {
    for (const r of j.replace) {
      if (r && typeof r.from === 'string' && typeof r.to === 'string' && r.from !== r.to) s.replace.set(r.from, r.to);
    }
  }
  if (Array.isArray(j.added)) {
    for (const a of j.added) {
      if (a && typeof a.file === 'string' && !s.added.some((x) => x.file === a.file)) {
        s.added.push(a.place ? { file: a.file, place: a.place } : { file: a.file });
      }
    }
  }
  return s;
}

/** Choose `to` as the replacement of `from`. Choosing the same file again (or null) clears it. */
export function setReplace(s: LibraryState, from: string, to: string | null): void {
  if (!to || to === from) s.replace.delete(from);
  else s.replace.set(from, to);
}

export function addFile(s: LibraryState, file: string, place?: Placed): void {
  const prev = s.added.find((a) => a.file === file);
  if (prev) {
    if (place) prev.place = place;
    return;
  }
  s.added.push(place ? { file, place } : { file });
}

/** Number of decisions not yet saved, shown next to the save button. */
export function pendingCount(s: LibraryState, saved: LibraryState): number {
  let n = 0;
  for (const [from, to] of s.replace) if (saved.replace.get(from) !== to) n++;
  for (const from of saved.replace.keys()) if (!s.replace.has(from)) n++;
  for (const a of s.added) if (!saved.added.some((b) => b.file === a.file)) n++;
  return n;
}

/**
 * The library.json object. Field order and sorting are fixed so the same
 * decisions always give the same bytes (the AI can diff saves). The schema's
 * stringifyResult() sorts again; doing it here too keeps the unvalidated
 * preview identical to the saved file.
 */
export function buildLibraryJson(s: LibraryState, rows: LibraryRow[]): LibraryFile {
  const byPath = new Map(rows.map((r) => [r.path, r]));
  const replace = [...s.replace]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([from, to]) => {
      const usedBy = (byPath.get(from)?.usedBy ?? []).map((u) => u.key);
      return usedBy.length ? { from, to, usedBy } : { from, to };
    });
  // A file that is about to be used (a replacement target or a new file) is
  // not "unused", even though nothing loads it yet.
  const willUse = new Set<string>([...s.replace.values(), ...s.added.map((a) => a.file)]);
  const unused = rows
    .filter((r) => r.badge === 'unused' && !willUse.has(r.path))
    .map((r) => r.path)
    .sort();
  return {
    version: 1,
    tool: 'library',
    replace,
    added: s.added.map((a) => (a.place ? { file: a.file, place: a.place } : { file: a.file })),
    unused,
  };
}

export type LibraryValidator = (json: unknown) => ValidateResult<LibraryFile>;
