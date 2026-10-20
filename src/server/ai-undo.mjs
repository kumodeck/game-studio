// "Undo AI change" and "the game's code changed" (CONTRACT.md §3.4, AI feel 2026-10-16).
//
// Two jobs, one walk over the game folder:
//
// 1. A SIGNATURE of the game's files (path, size, mtime). The status route returns it, and the
//    editor reloads the game by itself when it changes (no "Reload" button to find). WHY mtimes and
//    not a file watcher: fs.watch is unreliable across platforms and network folders, the editor
//    already polls the status, and a folder the AI edits is small (a walk is ~1 ms).
//
// 2. SNAPSHOTS. Right before a hand-off is kept as a request (ask, name, an in-game idea, Save),
//    the server copies the game's files into .studio/undo/ (content-addressed blobs, so an
//    unchanged file costs nothing the second time). "Undo AI change" in the editor then puts the
//    folder back exactly as it was when the person asked: one press, at once, whether or not the AI
//    is still watching. WHY the server and not "ask the AI to undo": the design asks for one
//    press with no waiting and no dead end, and an AI that has stopped watching is exactly when the
//    person wants their game back. The AI is still told (an `undone` request), so it does not build
//    on code that is gone.
//    Before restoring, the current files are snapshotted too, so the undo can be undone ("Redo").
//    Files the AI created after the snapshot are removed on undo (they are in the redo snapshot).
//
// Not part of either: .studio/ (the editor's own notes and these snapshots), dot files and folders,
// node_modules, and the editor's own result files at the top (placement.json, library.json: the
// editor writes them as the person works, so they must neither trigger a reload nor be rolled back
// under the person's hands). Files over AIU_MAX_FILE are listed but never copied or touched.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isSafeRelativePath } from '../schema/studio-files.mjs';
import { isRequestId } from '../schema/handoff.mjs';
import { RESULT_FILES, isInside } from './files.mjs';

const AIU_MAX_FILES = 4000; // a bigger folder (a whole project with build output) is not snapshotted
const AIU_MAX_FILE = 8 * 1024 * 1024; // models / textures bigger than this are left alone
const AIU_MAX_NEW_BYTES = 200 * 1024 * 1024; // new blob bytes per snapshot
const AIU_KEEP = 12; // snapshots kept; older ones (and blobs nobody uses) are removed
const AIU_SKIP_DIRS = new Set(['node_modules']);
const AIU_TOP_SKIP = new Set(Object.values(RESULT_FILES));

/**
 * The game's files, sorted by path: [{ rel, abs, size, mtimeMs }]. `truncated` when the folder has
 * more than AIU_MAX_FILES (then no snapshot is taken: a partial one could not be restored honestly).
 */
export async function listGameFiles(rootReal) {
  const out = [];
  let truncated = false;
  const walk = async (dir, rel, depth) => {
    if (truncated || depth > 12) return;
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      // Symlinks are never followed or touched (lstat-style Dirent): nothing outside the folder.
      if (e.isDirectory()) {
        if (!AIU_SKIP_DIRS.has(e.name)) await walk(abs, r, depth + 1);
      } else if (e.isFile()) {
        if (!rel && AIU_TOP_SKIP.has(e.name)) continue;
        if (out.length >= AIU_MAX_FILES) {
          truncated = true;
          return;
        }
        try {
          const st = await fs.lstat(abs);
          out.push({ rel: r, abs, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
        } catch {
          /* gone while walking */
        }
      }
    }
  };
  await walk(rootReal, '', 0);
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { files: out, truncated };
}

/** A short signature of the file list: changes when any file is added, removed or rewritten. */
export function codeSignature(list) {
  const h = crypto.createHash('sha1');
  for (const f of list.files) h.update(`${f.rel}\0${f.size}\0${f.mtimeMs}\n`);
  if (list.truncated) h.update('+');
  return h.digest('hex').slice(0, 16);
}

// Hash cache: a file whose size and mtime did not change is not read again.
const aiuHashes = new Map();
async function hashOf(f) {
  const k = f.abs;
  const c = aiuHashes.get(k);
  if (c && c.size === f.size && c.mtimeMs === f.mtimeMs) return c.sha;
  const buf = await fs.readFile(f.abs);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  aiuHashes.set(k, { size: f.size, mtimeMs: f.mtimeMs, sha });
  return sha;
}

/** .studio/undo/ (and blobs/), real folders only: a symlink there is refused, never followed. */
async function undoDir(rootReal, sub = '') {
  let dir = rootReal;
  for (const part of ['.studio', 'undo', ...(sub ? [sub] : [])]) {
    dir = path.join(dir, part);
    try {
      const st = await fs.lstat(dir);
      if (!st.isDirectory()) throw new Error(`${part} is not a folder`);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      // Two requests at the same moment (⌘S hands over placement.json and library.json 1 ms apart) both find no
      // folder; the second mkdir then fails with EEXIST and that request got no undo copy (e2e-save 2026-10-18,
      // "studio: note no undo … EEXIST"). The folder the other one made is fine, if it is a real folder.
      await fs.mkdir(dir).catch(async (m) => {
        if (m.code !== 'EEXIST' || !(await fs.lstat(dir)).isDirectory()) throw m;
      });
    }
  }
  return dir;
}

async function writeAtomic(target, data) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  await fs.writeFile(tmp, data, { flag: 'wx' });
  await fs.rename(tmp, target);
}

/**
 * Snapshot the game's files as they are now, under `id` (a request id). Returns false (and writes
 * nothing) when the folder is too big to snapshot honestly.
 */
export async function snapshotGame(rootReal, id) {
  if (!isRequestId(id)) throw new Error('snapshot id must be a request id');
  const list = await listGameFiles(rootReal);
  if (list.truncated) return false;
  const blobs = await undoDir(rootReal, 'blobs');
  const files = [];
  const big = [];
  let newBytes = 0;
  for (const f of list.files) {
    if (f.size > AIU_MAX_FILE) {
      big.push(f.rel);
      continue;
    }
    let sha;
    try {
      sha = await hashOf(f);
    } catch {
      continue; // unreadable or gone: not part of the snapshot
    }
    const blob = path.join(blobs, sha);
    try {
      await fs.lstat(blob);
    } catch {
      newBytes += f.size;
      if (newBytes > AIU_MAX_NEW_BYTES) return false;
      await writeAtomic(blob, await fs.readFile(f.abs));
    }
    files.push([f.rel, sha, f.size]);
  }
  const manifest = { version: 1, id, at: new Date().toISOString(), files, big };
  await writeAtomic(path.join(await undoDir(rootReal), `${id}.json`), JSON.stringify(manifest) + '\n');
  await pruneSnapshots(rootReal).catch(() => {});
  return true;
}

async function readManifest(rootReal, id) {
  if (!isRequestId(id)) return null;
  try {
    const dir = await undoDir(rootReal);
    const m = JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8'));
    if (!m || m.version !== 1 || !Array.isArray(m.files)) return null;
    return m;
  } catch {
    return null;
  }
}

/** Is there a snapshot for this request? (The editor shows "Undo AI change" only when there is.) */
export async function hasSnapshot(rootReal, id) {
  return (await readManifest(rootReal, id)) !== null;
}

/** Keep the newest AIU_KEEP snapshots and the blobs they use. */
async function pruneSnapshots(rootReal) {
  const dir = await undoDir(rootReal);
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && isRequestId(n.slice(0, -5))).sort();
  for (const n of names.slice(0, Math.max(0, names.length - AIU_KEEP))) await fs.rm(path.join(dir, n), { force: true });
  const used = new Set();
  for (const n of names.slice(-AIU_KEEP)) {
    const m = await readManifest(rootReal, n.slice(0, -5));
    for (const [, sha] of m?.files || []) used.add(sha);
  }
  const blobs = await undoDir(rootReal, 'blobs');
  for (const b of await fs.readdir(blobs)) if (/^[0-9a-f]{64}$/.test(b) && !used.has(b)) await fs.rm(path.join(blobs, b), { force: true });
}

/** Make the parent folders of a game file (real folders only, inside the game folder). */
async function ensureParents(rootReal, rel) {
  let dir = rootReal;
  for (const part of rel.split('/').slice(0, -1)) {
    dir = path.join(dir, part);
    try {
      const st = await fs.lstat(dir);
      if (!st.isDirectory()) return null;
    } catch (e) {
      if (e.code !== 'ENOENT') return null;
      // Made at the same moment by another copy (the race of e2e-016, files.mjs ensureRealDir): a real folder is fine.
      const made = await fs.mkdir(dir).then(() => true, async (m) => m.code === 'EEXIST' && (await fs.lstat(dir)).isDirectory());
      if (!made) return null;
    }
  }
  return dir;
}

/**
 * Put the game folder back as snapshot `id` has it. The current files are snapshotted first under
 * `redoId`, so this can be reversed by restoring `redoId`.
 *
 * @returns {Promise<{ ok: true, restored: string[], removed: string[], redo: string | null } | { ok: false, error: string }>}
 */
export async function restoreGame(rootReal, id, redoId) {
  const m = await readManifest(rootReal, id);
  if (!m) return { ok: false, error: 'no snapshot for that change' };
  const redo = redoId && (await snapshotGame(rootReal, redoId).catch(() => false)) ? redoId : null;
  const blobs = await undoDir(rootReal, 'blobs');
  const now = await listGameFiles(rootReal);
  const cur = new Map(now.files.map((f) => [f.rel, f]));
  const keep = new Set([...m.files.map(([rel]) => rel), ...(m.big || [])]);
  const restored = [];
  const removed = [];
  for (const [rel, sha] of m.files) {
    // The manifest is a file on disk: check every path again before writing anything.
    if (!isSafeRelativePath(rel) || rel.split('/').some((s) => s.startsWith('.') || AIU_SKIP_DIRS.has(s)) || !/^[0-9a-f]{64}$/.test(sha)) continue;
    if (!rel.includes('/') && AIU_TOP_SKIP.has(rel)) continue;
    const f = cur.get(rel);
    if (f && f.size <= AIU_MAX_FILE && (await hashOf(f).catch(() => '')) === sha) continue;
    const dir = await ensureParents(rootReal, rel);
    if (!dir) continue;
    const target = path.join(rootReal, ...rel.split('/'));
    if (!isInside(rootReal, target)) continue;
    try {
      const st = await fs.lstat(target);
      if (!st.isFile()) continue; // never replace a symlink or a folder
    } catch {
      /* missing: write it back */
    }
    let data;
    try {
      data = await fs.readFile(path.join(blobs, sha));
    } catch {
      continue;
    }
    await writeAtomic(target, data);
    restored.push(rel);
  }
  // New since the snapshot (made by the AI): removed, but kept in the redo snapshot. Only when the
  // redo snapshot was taken, so nothing is ever lost.
  if (redo && !now.truncated) {
    for (const f of now.files) {
      if (keep.has(f.rel) || f.size > AIU_MAX_FILE) continue;
      await fs.rm(f.abs, { force: true });
      removed.push(f.rel);
    }
  }
  return { ok: true, restored, removed, redo };
}
