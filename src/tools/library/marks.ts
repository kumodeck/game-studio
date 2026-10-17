// Library: combine the three sources into one row per asset, with a badge.
//
//   folder files (host.listAssets)          -> what exists
//   names in code (AssetFile.refsInCode)    -> what the code mentions
//   load log + adapter assetsOf (bridge)    -> what the game actually used
//
// Badges (exactly one per row):
//   used      loaded while playing, or an object uses it
//   codeOnly  the code mentions it but it was not loaded this time
//             (another level, a sound that plays on game over, ...)
//   unused    in the folder, but neither in code nor loaded
//   missing   the code mentions it, but there is no such file
//             (also: the game tried to load it and the load failed)
//
// "unused" is a hint for the AI to ASK the creator, never a delete list: a
// file can be used through a name built at runtime that we did not see load
// because that part of the game did not run.
//
// Pure functions (no DOM): unit-tested without a browser.

import type { AssetFile, AssetRef, AssetType, LoadEntry, MissingRef } from '../../contract.ts';
import { normPath, typeOfPath } from './refs.ts';

/**
 * Accept the host's listAssets() answer in the contract shape
 * ({ files, missing: [{ path, refsInCode }] }) and also in the early local
 * server shape ({ assets, missing: [{ ref, in }] }, type "audio"), so the
 * two branches can be joined in either order. Anything else becomes empty.
 */
export function normalizeList(raw: unknown): { files: AssetFile[]; missing: MissingRef[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.files) ? r.files : Array.isArray(r.assets) ? r.assets : [];
  const files: AssetFile[] = [];
  for (const f of list as Array<Record<string, unknown>>) {
    if (!f || typeof f.path !== 'string') continue;
    const type = f.type === 'audio' ? 'sound' : (f.type as AssetType);
    files.push({
      path: f.path,
      size: typeof f.size === 'number' ? f.size : 0,
      type: ['image', 'model', 'sound', 'atlas', 'font', 'other'].includes(type) ? type : typeOfPath(f.path),
      refsInCode: Array.isArray(f.refsInCode) ? f.refsInCode.filter((x): x is string => typeof x === 'string') : [],
    });
  }
  const missing: MissingRef[] = [];
  for (const m of (Array.isArray(r.missing) ? r.missing : []) as Array<Record<string, unknown>>) {
    const p = typeof m?.path === 'string' ? m.path : typeof m?.ref === 'string' ? normPath(m.ref.split(/[?#]/)[0]) : null;
    const refs = Array.isArray(m?.refsInCode) ? m.refsInCode : Array.isArray(m?.in) ? m.in : [];
    if (p) missing.push({ path: p, refsInCode: refs.filter((x): x is string => typeof x === 'string') });
  }
  return { files, missing };
}

/**
 * The studio's own files (results, .studio/) are not game assets: a game that
 * fetches placement.json before the first save gets a 404, which is normal.
 */
export function isStudioFile(path: string): boolean {
  return path === 'placement.json' || path === 'library.json' || path.startsWith('.studio/');
}

export type Badge = 'used' | 'codeOnly' | 'unused' | 'missing';

export interface UsedBy {
  key: string;
  how: AssetRef['how'];
  /** false = guessed link (e.g. a glb matched by load order). */
  sure: boolean;
}

export interface LibraryRow {
  /** Folder-relative path. */
  path: string;
  type: AssetType;
  /** Bytes; 0 for missing rows. */
  size: number;
  exists: boolean;
  refsInCode: string[];
  loaded: boolean;
  usedBy: UsedBy[];
  badge: Badge;
}

/**
 * Map a URL the game loaded back to a folder-relative path, or null when it
 * is not a file of this game (another origin, a CDN, data:/blob:).
 *
 * `base` is the folder root as a URL (for the local host, the server origin
 * plus "/"). Query strings and hashes are dropped: cache-busting
 * `tree.png?v=3` is still assets/tree.png.
 */
export function urlToPath(url: string, base: string): string | null {
  let u: URL;
  let b: URL;
  try {
    b = new URL(base);
    u = new URL(url, b);
  } catch {
    return null;
  }
  if (u.origin !== b.origin) return null;
  let rootPath = b.pathname;
  if (!rootPath.endsWith('/')) rootPath = rootPath.slice(0, rootPath.lastIndexOf('/') + 1);
  if (!u.pathname.startsWith(rootPath)) return null;
  let rel = u.pathname.slice(rootPath.length);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep as is */
  }
  return normPath(rel);
}

export interface BuildRowsInput {
  files: AssetFile[];
  missing: MissingRef[];
  loads: LoadEntry[];
  /** key -> assets that object uses (adapter assetsOf, from studio:library/assets). */
  uses: Record<string, AssetRef[]>;
  /** Folder root as a URL, see urlToPath(). */
  base: string;
}

export function buildRows(input: BuildRowsInput): LibraryRow[] {
  const rows = new Map<string, LibraryRow>();
  for (const f of input.files) {
    rows.set(f.path, {
      path: f.path, type: f.type, size: f.size, exists: true,
      refsInCode: [...f.refsInCode], loaded: false, usedBy: [], badge: 'unused',
    });
  }
  const missingRow = (path: string, refsInCode: string[] = []): LibraryRow => ({
    path, type: typeOfPath(path), size: 0, exists: false, refsInCode, loaded: false, usedBy: [], badge: 'missing',
  });
  for (const m of input.missing) {
    if (!rows.has(m.path)) rows.set(m.path, missingRow(m.path, [...m.refsInCode]));
  }

  // The load log and `uses` come from the game page (the bridge, and the game's own adapter
  // through assetsOf): untrusted shapes. Skip what is not a list / not a URL instead of throwing:
  // one throw here left the Assets panel on "Reading the folder…" (2026-10-17).
  for (const e of Array.isArray(input.loads) ? input.loads : []) {
    if (!e || typeof e.url !== 'string') continue;
    const path = urlToPath(e.url, input.base);
    if (!path) continue;
    const row = rows.get(path);
    if (row) {
      // A failed load of an existing file is still "the game wants it"; a
      // successful one proves it is used.
      if (e.ok !== false) row.loaded = true;
    } else if (e.ok === false && typeOfPath(path) !== 'other' && !isStudioFile(path)) {
      // The game asked for a file that is not there (a 404): as useful as a
      // missing name in code, and catches names built at runtime.
      rows.set(path, missingRow(path));
    }
  }

  for (const [key, refs] of Object.entries(input.uses && typeof input.uses === 'object' ? input.uses : {})) {
    if (!Array.isArray(refs)) continue;
    for (const r of refs) {
      if (!r || typeof r.url !== 'string') continue;
      const path = urlToPath(r.url, input.base);
      if (!path) continue;
      let row = rows.get(path);
      if (!row) {
        row = missingRow(path);
        rows.set(path, row);
      }
      const prev = row.usedBy.find((u) => u.key === key);
      if (prev) prev.sure = prev.sure || r.sure;
      else row.usedBy.push({ key, how: r.how, sure: r.sure });
    }
  }

  for (const row of rows.values()) {
    row.usedBy.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (!row.exists) row.badge = 'missing';
    else if (row.loaded || row.usedBy.length) row.badge = 'used';
    else if (row.refsInCode.length) row.badge = 'codeOnly';
    else row.badge = 'unused';
  }
  return [...rows.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Reverse lookup for the placement side: "the assets of this object". */
export function assetsOfKey(rows: LibraryRow[], key: string): LibraryRow[] {
  return rows.filter((r) => r.usedBy.some((u) => u.key === key));
}

export type TypeFilter = AssetType | 'all';
export type BadgeFilter = Badge | 'all';

/** Filter by type, badge and a case-insensitive name search (matches anywhere in the path). */
export function filterRows(rows: LibraryRow[], f: { type?: TypeFilter; badge?: BadgeFilter; q?: string }): LibraryRow[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return rows.filter((r) =>
    (!f.type || f.type === 'all' || r.type === f.type)
    && (!f.badge || f.badge === 'all' || r.badge === f.badge)
    && (!q || r.path.toLowerCase().includes(q)));
}

export function countBadges(rows: LibraryRow[]): Record<Badge, number> {
  const c: Record<Badge, number> = { used: 0, codeOnly: 0, unused: 0, missing: 0 };
  for (const r of rows) c[r.badge]++;
  return c;
}
