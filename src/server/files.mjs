// File-system rules for the local server: which files may be served, how HTML is decorated, and
// how the two result files and new assets are written.
//
// The server hands a browser tab the contents of one folder (the game). Anything the tab can reach
// is effectively readable by any script running in that tab, including the game's own code and
// anything it loads from the internet. So the rules are deliberately narrow:
// - Serve only files whose real path (after following symlinks) is inside the folder. A symlink
//   that points outside is refused, not followed.
// - Never serve dot-files or dot-folders (.env, .git, .studio, ...). Games do not need them and they
//   are where secrets live.
// - Write only placement.json, library.json, .studio/next-step.md and *new* files under assets/.
//   Existing files are never overwritten except our own result files, and those are replaced
//   atomically (temp file + rename) so a crash never leaves half a JSON file for the agent to read.

import { promises as fs, constants as FS } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RESULT_FILES = Object.freeze({ placement: 'placement.json', library: 'library.json' });

// Types for the files a web game usually ships. Unknown types are served as octet-stream so the
// browser never guesses (with nosniff set on every response).
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.fbx': 'application/octet-stream',
  '.obj': 'text/plain; charset=utf-8',
  '.mtl': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * Map a URL path to a file inside `rootReal` (which must already be a realpath).
 * @returns {Promise<{ ok: true, abs: string, rel: string, stat: import('node:fs').Stats } | { ok: false, status: number, reason: string }>}
 */
export async function resolveInside(rootReal, urlPath) {
  let segs;
  try {
    // Decode per segment so an encoded slash (%2F) cannot glue two segments into one "name".
    segs = urlPath.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    return { ok: false, status: 400, reason: 'bad URL encoding' };
  }
  for (const s of segs) {
    if (s === '..' || s === '.' || s.includes('/') || s.includes('\\') || s.includes('\0')) {
      return { ok: false, status: 400, reason: 'path leaves the folder' };
    }
    if (s.startsWith('.')) return { ok: false, status: 404, reason: 'hidden files are not served' };
  }
  let abs = path.join(rootReal, ...segs);
  let real;
  try {
    real = await fs.realpath(abs);
  } catch {
    return { ok: false, status: 404, reason: 'not found' };
  }
  if (!isInside(rootReal, real)) return { ok: false, status: 403, reason: 'symlink points outside the folder' };
  let stat = await fs.stat(real);
  if (stat.isDirectory()) {
    abs = path.join(real, 'index.html');
    try {
      real = await fs.realpath(abs);
    } catch {
      return { ok: false, status: 404, reason: 'not found' };
    }
    if (!isInside(rootReal, real)) return { ok: false, status: 403, reason: 'symlink points outside the folder' };
    stat = await fs.stat(real);
  }
  if (!stat.isFile()) return { ok: false, status: 404, reason: 'not a file' };
  return { ok: true, abs: real, rel: path.relative(rootReal, real).split(path.sep).join('/'), stat };
}

export function isInside(rootReal, p) {
  return p === rootReal || p.startsWith(rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep);
}

/**
 * Put the edit script first in <head>, without touching the file on disk.
 *
 * WHY first: the edit script installs the hooks that three.js / PixiJS look for when they start
 * (__THREE_DEVTOOLS__, __PIXI_APP_INIT__) and wraps requestAnimationFrame. It must run before any
 * game script, including module scripts and import maps, so it goes right after <head> (or at the
 * very top when the page has no <head>). It is a classic, blocking script on purpose: a module
 * script would be deferred and run too late, and would also have to come after the import map.
 */
export function injectEditScript(html, scriptUrl, adapterUrl, toolsUrl) {
  // The game folder's own adapter and tools (.studio/adapter.js, .studio/tools.js, CONTRACT.md §1.4
  // and §7) must run right after the edit script and before any game code, so the tags go first in
  // <head>, in this order.
  const tag =
    `<script src="${scriptUrl}" data-studio-edit></script>` +
    (adapterUrl ? `<script src="${adapterUrl}" data-studio-adapter></script>` : '') +
    (toolsUrl ? `<script src="${toolsUrl}" data-studio-tools></script>` : '');
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return doctype[0] + tag + html.slice(doctype[0].length);
  return tag + html;
}

/**
 * Write one of the result files atomically. Refuses when the target exists but is not a plain file
 * (a symlink could redirect the write outside the folder; a directory would be clobbered).
 */
export async function writeResultFile(rootReal, tool, text) {
  const name = RESULT_FILES[tool];
  const target = path.join(rootReal, name);
  await refuseIfNotPlainFile(target);
  const tmp = path.join(rootReal, `.${name}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  await fs.writeFile(tmp, text, { flag: 'wx' });
  try {
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  return name;
}

export async function readResultFile(rootReal, tool) {
  const target = path.join(rootReal, RESULT_FILES[tool]);
  try {
    const st = await fs.lstat(target);
    if (!st.isFile()) return { text: null, error: `${RESULT_FILES[tool]} is not a plain file` };
    return { text: await fs.readFile(target, 'utf8') };
  } catch (e) {
    if (e.code === 'ENOENT') return { text: null };
    throw e;
  }
}

/** Write .studio/next-step.md (our own scratch folder inside the game folder). */
export async function writeNextStep(rootReal, text) {
  return writeStudioNote(rootReal, 'next-step.md', text);
}

/**
 * Write a note for the agent under .studio/ (next-step.md, check.md). Only these fixed names are
 * ever written; the folder is created when missing and must be a real folder (not a symlink).
 */
export async function writeStudioNote(rootReal, name, text) {
  if (name !== 'next-step.md' && name !== 'check.md') throw httpError(400, 'unknown note');
  return writeStudioFile(rootReal, name, text);
}

/**
 * Folders under .studio/ the server may create, and the file names it may write there.
 * requests/<id>.json: hand-offs to the AI (§3.4; the id comes from handoff.mjs, never from the
 * browser). status.json: written by the AI; the server only writes it for `studio.mjs --status`.
 * watch.json: the heartbeat of `studio.mjs --watch` while an AI watches (ai-watch.mjs).
 * generated.json: what "Make with AI" made, with the words (generated.mjs; only the server writes it, 2026-10-22).
 */
// chat/<id>.json (pause, 2026-10-22): the talk over a paused game, named by its first `play` request (play-chat.mjs).
const STUDIO_WRITABLE = /^(generated\.json|requests\/[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-z-]{2,10}-[0-9a-f]{4}\.json|play\/[0-9]{8}-[0-9]{6}-[0-9]{3}-play-[0-9a-f]{4}\.(?:jpg|png)|chat\/[0-9]{8}-[0-9]{6}-[0-9]{3}-play-[0-9a-f]{4}\.json|status\.json|watch\.json|wake\.json|told\.json|server\.json|open\.json|next-step\.md|check\.md|view-check\.md|view-check\/(?:game|editor)\.png|shot\/game(?:-phone)?\.png|ui\/prefs\.json|data\/[a-z0-9][a-z0-9-]{0,39}\.json)$/;

async function ensureRealDir(dir) {
  const check = async () => {
    const st = await fs.lstat(dir);
    if (!st.isDirectory()) throw httpError(409, `${path.basename(dir)} exists and is not a folder`);
  };
  try {
    await check();
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // Two writes at once (⌘S hands off placement.json and library.json 1 ms apart) both see no folder; the second
    // mkdir then fails with EEXIST and that save was lost: "studio: error EEXIST … mkdir '.studio/requests'", the
    // placement never reached the AI and the editor kept "Save · 8" (e2e-016, 2026-10-20; the same race as
    // ai-undo.mjs's copy folder in e2e-save). Made by the other write: use it if it is a real folder.
    await fs.mkdir(dir).catch(async (m) => {
      if (m.code !== 'EEXIST') throw m;
      await check();
    });
  }
}

/**
 * Write a file under .studio/ atomically. Only the fixed names in STUDIO_WRITABLE: notes for the
 * agent, the person's UI preferences (ui/prefs.json), and game tools' data. Folders must be real (no symlinks).
 */
export async function writeStudioFile(rootReal, rel, text) {
  if (!STUDIO_WRITABLE.test(rel)) throw httpError(400, 'not a writable studio file');
  let dir = path.join(rootReal, '.studio');
  await ensureRealDir(dir);
  const parts = rel.split('/');
  const name = parts.pop();
  for (const p of parts) {
    dir = path.join(dir, p);
    await ensureRealDir(dir);
  }
  const target = path.join(dir, name);
  await refuseIfNotPlainFile(target);
  const tmp = path.join(dir, `.${name}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  await fs.writeFile(tmp, text, { flag: 'wx' });
  await fs.rename(tmp, target);
  return `.studio/${rel}`;
}

/**
 * Read a file under .studio/ (plain file, no symlinks along the way), or null. Used for the AI's
 * adapter.js / tools.js / studio.json, the person's ui.json / data files, and the AI's status.json.
 */
export async function readStudioFile(rootReal, rel, maxBytes) {
  const r = await readStudioFileInfo(rootReal, rel, maxBytes);
  return r ? r.text : null;
}

/** Like readStudioFile, plus when the file was last written (ms): the AI's status (CONTRACT.md §3.4). */
export async function readStudioFileInfo(rootReal, rel, maxBytes) {
  // chat/<id>.json (pause, 2026-10-22): read back only to add a turn (play-chat.mjs); no route serves it.
  if (!/^(generated\.json|adapter\.js|tools\.js|studio\.json|status\.json|watch\.json|wake\.json|told\.json|open\.json|ui\/prefs\.json|ui\/studio\.css|ui\/shell\.js|data\/[a-z0-9][a-z0-9-]{0,39}\.json|chat\/[0-9]{8}-[0-9]{6}-[0-9]{3}-play-[0-9a-f]{4}\.json)$/.test(rel)) return null;
  let p = path.join(rootReal, '.studio');
  try {
    for (const part of ['', ...rel.split('/').slice(0, -1)]) {
      if (part) p = path.join(p, part);
      if (!(await fs.lstat(p)).isDirectory()) return null;
    }
    const target = path.join(rootReal, '.studio', rel);
    const st = await fs.lstat(target);
    if (!st.isFile() || st.size > maxBytes) return null;
    return { text: await fs.readFile(target, 'utf8'), mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * The game folder's adapter, .studio/adapter.js, or null. This is the one dot-file the server
 * serves: the AI writes it for this game (CONTRACT.md §1.4). It must be a plain file inside the
 * folder (no symlink), so it cannot be used to read anything else.
 */
export async function readGameAdapter(rootReal) {
  return readStudioFile(rootReal, 'adapter.js', 512 * 1024);
}

// Extensions a user may drop into the library (plan: images, 3D models, sounds, 2D atlases, fonts).
// Code files (.js, .html) are deliberately excluded: adding code is the agent's job, with the
// user's consent, not something a drag-and-drop should do.
export const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif',
  '.glb', '.gltf', '.bin', '.fbx', '.obj', '.mtl',
  '.mp3', '.ogg', '.wav', '.m4a',
  '.json', '.atlas',
  '.woff2', '.woff', '.ttf', '.otf',
]);
export const MAX_ASSET_BYTES = 100 * 1024 * 1024;

/**
 * Turn a user-supplied file name into a safe single path segment, or null.
 * "My Tree (final).PNG" -> "my-tree-final.png". Non-ASCII letters are replaced: the agent will put
 * this name into code, and plain ASCII names avoid encoding bugs in URLs and imports.
 */
export function safeAssetName(name) {
  if (typeof name !== 'string') return null;
  const base = name.split(/[\\/]/).pop() || '';
  const ext = path.extname(base).toLowerCase();
  if (!ASSET_EXTENSIONS.has(ext)) return null;
  const stem = base
    .slice(0, base.length - ext.length)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return (stem || 'asset') + ext;
}

/**
 * Create a new file under assets/ from a stream. Never overwrites: if the name is taken, "-2",
 * "-3", ... is appended; the final open uses O_EXCL so a race cannot overwrite either.
 * @returns {Promise<string>} the new path relative to the folder, like "assets/rock-2.glb"
 */
export async function addAsset(rootReal, name, stream, declaredLength) {
  const safe = safeAssetName(name);
  if (!safe) throw httpError(415, `this file type cannot be added (allowed: ${[...ASSET_EXTENSIONS].join(' ')})`);
  if (declaredLength !== undefined && declaredLength > MAX_ASSET_BYTES) throw httpError(413, 'file is larger than 100 MB');

  const dir = path.join(rootReal, 'assets');
  try {
    const st = await fs.lstat(dir);
    if (st.isSymbolicLink()) {
      const real = await fs.realpath(dir);
      if (!isInside(rootReal, real)) throw httpError(403, 'assets/ points outside the folder');
    } else if (!st.isDirectory()) throw httpError(409, 'assets exists and is not a folder');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    await fs.mkdir(dir);
  }

  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let handle;
  let file;
  for (let n = 1; n <= 99 && !handle; n++) {
    file = n === 1 ? safe : `${stem}-${n}${ext}`;
    try {
      handle = await fs.open(path.join(dir, file), FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  if (!handle) throw httpError(409, 'too many files with this name already');

  const abs = path.join(dir, file);
  let written = 0;
  try {
    for await (const chunk of stream) {
      written += chunk.length;
      if (written > MAX_ASSET_BYTES) throw httpError(413, 'file is larger than 100 MB');
      await handle.write(chunk);
    }
    await handle.close();
  } catch (e) {
    await handle.close().catch(() => {});
    await fs.rm(abs, { force: true });
    throw e;
  }
  return `assets/${file}`;
}

async function refuseIfNotPlainFile(target) {
  try {
    const st = await fs.lstat(target);
    if (!st.isFile()) throw httpError(409, `${path.basename(target)} exists and is not a plain file; not overwriting it`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
