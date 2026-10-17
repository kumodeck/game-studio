// Library: find asset file names written in the game's code, and match them
// against the files that exist in the folder.
//
// Why a text scan and not a real parser: games are hand-written or AI-written
// HTML/JS/CSS with no build step, in any style. A parser would add a
// dependency and still miss names built at runtime. What we need is only
// "does the code mention this file?", which a careful string scan answers
// well. Names assembled at runtime ('assets/' + name + '.png') are caught by
// the load log instead (the "loaded while playing" source), so the two
// sources together cover both styles.
//
// Pure functions only (no DOM, no fs): the local server, the shell and the
// tests all call the same code. The caller reads the files.

import type { AssetFile, AssetType, MissingRef } from '../../contract.ts';
import { ASSET_EXT, IGNORED_DIRS, RESULT_FILES } from '../../contract.ts';

/** Code files whose text is scanned for names. */
export const CODE_EXT = ['html', 'htm', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'css', 'json'] as const;

/** Every extension the library lists, lower case, without the dot. */
const ALL_ASSET_EXT: string[] = Object.values(ASSET_EXT).flat();

export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/**
 * Asset type from the file name alone. `.json` is ambiguous (config, level
 * data, or a sprite atlas); callers that can read the file should use
 * looksLikeAtlas() and fall back to 'other'.
 */
export function typeOfPath(path: string): AssetType {
  const ext = extOf(path);
  for (const [type, exts] of Object.entries(ASSET_EXT)) {
    if ((exts as readonly string[]).includes(ext)) return type as AssetType;
  }
  return 'other';
}

/**
 * A JSON file is a 2D atlas when it has the TexturePacker / Pixi spritesheet
 * shape: `frames` plus `meta.image`. Plain level data or config is not listed
 * as an asset (it would only add noise to the list).
 */
export function looksLikeAtlas(text: string): boolean {
  try {
    const j = JSON.parse(text);
    return !!j && typeof j === 'object' && !!j.frames && typeof j.meta?.image === 'string';
  } catch {
    return false;
  }
}

export function isCodePath(path: string): boolean {
  return (CODE_EXT as readonly string[]).includes(extOf(path));
}

/** true when any folder in the path is one we never list (node_modules, .git, build output...). */
export function isIgnoredPath(path: string): boolean {
  const parts = path.split('/');
  parts.pop();
  return parts.some((p) => (IGNORED_DIRS as readonly string[]).includes(p));
}

// A quoted string (or CSS url(...)) that ends in a known asset extension,
// optionally followed by ?query or #hash. Template literals with ${...} are
// skipped on purpose: the part before ${ is not a file name we can check.
const EXT_GROUP = ALL_ASSET_EXT.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const QUOTED_RE = new RegExp(`(["'\`])([^"'\`\\n\\r<>]{1,300}?\\.(?:${EXT_GROUP}))(?:[?#][^"'\`\\n\\r]*)?\\1`, 'gi');
const CSS_URL_RE = new RegExp(`url\\(\\s*(?:["']?)([^"')\\s]{1,300}?\\.(?:${EXT_GROUP}))(?:[?#][^"')\\s]*)?(?:["']?)\\s*\\)`, 'gi');

/**
 * File names mentioned in one code file, as written but without ?query/#hash
 * (not resolved yet).
 * Remote URLs (http:, https:, protocol-relative //) and data: URIs are
 * dropped: they are not files in the folder and the studio never fetches them.
 */
export function extractRefs(text: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    const s = raw.trim();
    if (!s || s.includes('${')) return;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(s)) return; // http:, data:, blob:, //cdn...
    out.add(s);
  };
  for (const m of text.matchAll(QUOTED_RE)) add(m[2]);
  for (const m of text.matchAll(CSS_URL_RE)) add(m[1]);
  return [...out];
}

/** Normalise a folder-relative path: forward slashes, no ./, .. resolved, no leading slash. */
export function normPath(p: string): string | null {
  const out: string[] = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null; // points outside the folder
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.length ? out.join('/') : null;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Where a name written in `fromFile` points to, as candidates in order.
 *
 * Browsers resolve fetch/Image/Audio URLs against the PAGE, not the script
 * file, while ES module imports and CSS url() resolve against the file. We
 * cannot know which one the code meant, so we try the file's folder first and
 * then the folder root ("/x.png" is always the root). The first candidate
 * that exists wins; if none exists the first one is reported as missing.
 */
export function candidatesFor(ref: string, fromFile: string): string[] {
  const clean = safeDecode(ref.split(/[?#]/)[0]);
  const out: string[] = [];
  const push = (p: string | null) => {
    if (p && !out.includes(p)) out.push(p);
  };
  if (clean.startsWith('/')) {
    push(normPath(clean));
  } else {
    push(normPath(`${dirOf(fromFile)}/${clean}`));
    push(normPath(clean));
  }
  return out;
}

export interface CodeFile {
  path: string;
  text: string;
}

export interface CodeMatch {
  /** asset path -> code files that mention it (sorted). */
  refsInCode: Map<string, string[]>;
  /** Names in code that match no file in the folder. */
  missing: MissingRef[];
}

/**
 * Match the names found in code against the asset files that exist.
 *
 * A name that does not resolve to an existing path but whose file NAME is
 * unique in the folder ('tree.png' while the file is assets/tree.png) counts
 * as a reference too: code often keeps the folder in a constant
 * (`const BASE = 'assets/'`). If two files share that name we do not guess.
 */
export function matchCode(code: CodeFile[], assetPaths: string[], allPaths: string[] = assetPaths): CodeMatch {
  // `allPaths` = every file in the folder. A name that points at an existing
  // non-asset file (level.json, a script) is neither a reference nor missing.
  const exists = new Set(allPaths);
  const isAsset = new Set(assetPaths);
  const byName = new Map<string, string[]>();
  for (const p of assetPaths) {
    const name = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), p]);
  }
  const refs = new Map<string, Set<string>>();
  const missing = new Map<string, Set<string>>();
  const note = (m: Map<string, Set<string>>, key: string, from: string) => {
    if (!m.has(key)) m.set(key, new Set());
    m.get(key)!.add(from);
  };

  for (const file of code) {
    for (const ref of extractRefs(file.text)) {
      const cands = candidatesFor(ref, file.path);
      if (!cands.length) continue; // "../../x.png" above the folder: not ours to judge
      const hit = cands.find((c) => exists.has(c));
      if (hit) {
        if (hit !== file.path && isAsset.has(hit)) note(refs, hit, file.path);
        continue;
      }
      const name = cands[0].slice(cands[0].lastIndexOf('/') + 1).toLowerCase();
      const same = byName.get(name);
      if (same && same.length === 1) {
        note(refs, same[0], file.path);
        continue;
      }
      note(missing, cands[0], file.path);
    }
  }
  const sorted = (s: Set<string>) => [...s].sort();
  return {
    refsInCode: new Map([...refs].map(([k, v]) => [k, sorted(v)])),
    missing: [...missing].map(([path, v]) => ({ path, refsInCode: sorted(v) })).sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
}

/**
 * Build the host's listAssets() answer from a folder listing.
 * `files` = every non-ignored file with its size; `read(path)` returns the
 * text of code files (and .json candidates). Used by the fake host in tests
 * and available to the local server so both agree on what "in code" means.
 */
export async function buildAssetList(
  files: Array<{ path: string; size: number }>,
  read: (path: string) => Promise<string>,
): Promise<{ files: AssetFile[]; missing: MissingRef[] }> {
  // The studio's own result files name assets too (library.json lists
  // replacements and unused files); reading them as "code" would mark every
  // listed file as mentioned in code. Only the folder-root copies are results.
  const results = new Set<string>(Object.values(RESULT_FILES));
  const visible = files.filter((f) => !isIgnoredPath(f.path) && !results.has(f.path));
  const code: CodeFile[] = [];
  const assets: Array<{ path: string; size: number; type: AssetType }> = [];
  for (const f of visible) {
    const ext = extOf(f.path);
    if (isCodePath(f.path)) {
      const text = await read(f.path).catch(() => '');
      code.push({ path: f.path, text });
      if (ext === 'json' && looksLikeAtlas(text)) assets.push({ ...f, type: 'atlas' });
      continue;
    }
    const type = typeOfPath(f.path);
    if (type !== 'other') assets.push({ ...f, type });
  }
  const m = matchCode(code, assets.map((a) => a.path), visible.map((f) => f.path));
  return {
    files: assets
      .map((a) => ({ path: a.path, size: a.size, type: a.type, refsInCode: m.refsInCode.get(a.path) ?? [] }))
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
    missing: m.missing,
  };
}
