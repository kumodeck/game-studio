// ● Clip, stage 1 (decided 2026-11-05): where the editor's clips are saved, and "Show in Finder".
//
// WHY Movies › KUMODeck (Windows: Videos › KUMODeck, Linux: ~/Videos/KUMODeck) and not the game folder or .studio/:
// - .studio/ starts with a dot: hidden, so X's file picker (and the Finder) does not show it;
// - the game folder is the person's code: a few MB of video per press would end up in their git history.
// The folder is made on the first clip. Never overwrites: "<stem>-1.mp4", "-2"… The one exception is the clip the
// person just made, saved again with its end swapped ("Remove mark" / "Add mark" in the editor's line): `replace`.
// Nothing here talks to the network; the file goes from the editor page to this folder and stays there.
import { constants as FS, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { httpError } from './files.mjs';

/** The largest clip taken (bytes): 12 s at 4 Mbit/s is ~6 MB; 64 MB leaves room for a busy game at a higher rate. */
export const CLIP_MAX_BYTES = 64 * 1024 * 1024;
/** A clip's file name as the editor makes it (shell/clip-model.ts clipStem + "-N"): a–z 0–9 "-", then .mp4. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,60}\.mp4$/;
const STEM_RE = /^[a-z0-9][a-z0-9-]{0,50}$/;

/** Where clips go on this system, and which of the editor's words names it ('movies' | 'videos'). */
export function clipPlace(platform = process.platform, home = os.homedir()) {
  if (platform === 'darwin') return { dir: path.join(home, 'Movies', 'KUMODeck'), where: 'movies', reveal: 'finder' };
  return { dir: path.join(home, 'Videos', 'KUMODeck'), where: 'videos', reveal: 'folder' };
}

async function readAll(stream, max) {
  const parts = [];
  let n = 0;
  for await (const c of stream) {
    n += c.length;
    if (n > max) throw httpError(413, 'clip is larger than 64 MB');
    parts.push(c);
  }
  return Buffer.concat(parts);
}

/** Does this look like an MP4 (an ftyp box first)? A clip is never anything else. */
const isMp4 = (b) => b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp';

/**
 * Save a clip. `stem` = the name without the number ("neon-run-clip"): the first free "<stem>-N.mp4" is taken.
 * `replace` = a name this editor saved before (the same clip, its end swapped): written over, only if it is there.
 * Returns { name, where, reveal }.
 */
export async function saveClip(place, { stem, replace }, stream, declaredLength) {
  if (declaredLength !== undefined && declaredLength > CLIP_MAX_BYTES) throw httpError(413, 'clip is larger than 64 MB');
  const body = await readAll(stream, CLIP_MAX_BYTES);
  if (!isMp4(body)) throw httpError(415, 'not an MP4');
  await fs.mkdir(place.dir, { recursive: true });
  if (replace !== undefined) {
    if (!NAME_RE.test(replace)) throw httpError(400, 'bad clip name');
    const abs = path.join(place.dir, replace);
    const st = await fs.lstat(abs).catch(() => null);
    if (!st || !st.isFile()) throw httpError(404, 'no such clip');
    await fs.writeFile(abs, body);
    return { name: replace, where: place.where, reveal: place.reveal };
  }
  if (!STEM_RE.test(stem || '')) throw httpError(400, 'bad clip name');
  for (let n = 1; n <= 999; n++) {
    const name = `${stem}-${n}.mp4`;
    let handle;
    try {
      handle = await fs.open(path.join(place.dir, name), FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL);
    } catch (e) {
      if (e.code === 'EEXIST') continue;
      throw e;
    }
    try {
      await handle.write(body);
    } finally {
      await handle.close();
    }
    return { name, where: place.where, reveal: place.reveal };
  }
  throw httpError(409, 'too many clips with this name already');
}

/**
 * "Show in Finder": the system's file manager with the clip selected (macOS `open -R`, Windows `explorer /select,`,
 * elsewhere the folder with xdg-open). Only a clip that is in the folder. `run` is for tests (no window opens).
 */
export async function revealClip(place, name, run = defaultRun) {
  if (!NAME_RE.test(name || '')) throw httpError(400, 'bad clip name');
  const abs = path.join(place.dir, name);
  const st = await fs.lstat(abs).catch(() => null);
  if (!st || !st.isFile()) throw httpError(404, 'no such clip');
  if (process.platform === 'darwin') run('open', ['-R', abs]);
  else if (process.platform === 'win32') run('explorer', [`/select,${abs}`]);
  else run('xdg-open', [place.dir]);
  return { ok: true };
}

function defaultRun(cmd, args) {
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
  } catch {
    /* no file manager: the line still says where the clip is */
  }
}
