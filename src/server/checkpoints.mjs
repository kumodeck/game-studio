// Checkpoints: the paused moments a person kept, in the editor's own folder (pause-edit stage 3, 2026-10-28;
// CONTRACT.md §1.14 "Checkpoints", §3.2).
//
// The plan's Q2, answered (a) on 2026-10-28: a checkpoint is the maker's tool, not part of the game —
// `.studio/checkpoints/<id>.json`, never in the game's code or its published files (the game only has the codeMoment
// save / load hooks, which do nothing outside the editor). Like the chat over a paused game (.studio/chat/), the server
// keeps the files and only the editor page reads them (no dot-file is ever served to the game page).
//
//   { "version": 1, "name": "Before the boss", "at": "2026-10-28T…Z", "level": null, "time": 42.31,
//     "moment": { …what the game's save() returned… }, "shot": "data:image/jpeg;base64,…" }
//
// The id is the name made safe for a file (checkpointSlug): the person who opens the folder sees "Before-the-boss.json".
// Keeping a name again in the same level replaces that one (the person kept "Before the boss" again: the newer moment
// is the one they mean); the same name in another level gets "-2". A file that does not read as a checkpoint (cut
// short, hand-edited) is listed as `broken` and never offered (decision 14: a checkpoint that cannot open is said, not
// shown as one that can). Pure parts are exported for test/checkpoint.test.mjs.
import { CHECKPOINT_ID, httpError, listStudioDir, readStudioFile, removeStudioFile, writeStudioFile } from './files.mjs';

/** The form of the file (CONTRACT.md §1.14). */
export const CHECKPOINT_VERSION = 1;
/** save()'s data, at most (JSON characters; the same number as contract.ts CHECKPOINT_MAX_CHARS). */
export const CHECKPOINT_MAX_CHARS = 1_000_000;
/** The small picture (a JPEG data URL), at most. */
export const CHECKPOINT_MAX_SHOT = 200_000;
/** A file read back, at most (the moment, the picture, the rest). */
export const CHECKPOINT_MAX_FILE = CHECKPOINT_MAX_CHARS + CHECKPOINT_MAX_SHOT + 16 * 1024;
/** Checkpoints kept in one game, at most (a list of 200 is a save folder, not a menu). */
export const CHECKPOINT_MAX_COUNT = 200;
/** A name, at most (the menu's row: "⚑ Play from Before the boss"). */
export const CHECKPOINT_NAME_MAX = 40;

/** A name as kept: one line, trimmed, ≤ CHECKPOINT_NAME_MAX; '' = none. */
export function cleanCheckpointName(v) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHECKPOINT_NAME_MAX).trim();
}

/** The file's id for a name: its letters and digits (any language), the rest "-" ("0:42" → "0-42"); "checkpoint" when none. */
export function checkpointSlug(name) {
  const s = cleanCheckpointName(name).replace(/[^\p{L}\p{N}\p{M}_-]+/gu, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 56);
  return CHECKPOINT_ID.test(s) ? s : 'checkpoint';
}

/**
 * The id to keep `name` of `level` under (pure): its slug, or that slug's file of the same level (replaced); a slug
 * another level has gets -2, -3 … `have` = the files there now, id → level (undefined = broken: never replaced).
 */
export function checkpointIdFor(name, level, have) {
  const base = checkpointSlug(name);
  for (let n = 1; n < 1000; n++) {
    const id = n === 1 ? base : `${base.slice(0, 55)}-${n}`;
    if (!have.has(id)) return id;
    const l = have.get(id);
    if (l !== undefined && (l ?? null) === (level ?? null)) return id;
  }
  throw httpError(409, 'too many checkpoints with this name');
}

const cpFinite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * A checkpoint the editor sent, made into the file's content (pure), or { error }. `moment` must be JSON data within
 * CHECKPOINT_MAX_CHARS (the game page checked it too; a hand-made request is checked again here).
 */
export function checkpointFile(input, now = new Date()) {
  if (!input || typeof input !== 'object') return { error: 'body must be a checkpoint' };
  const name = cleanCheckpointName(input.name);
  if (!name) return { error: '"name" must be a name of 1 to 40 characters' };
  if (input.level !== undefined && input.level !== null && (typeof input.level !== 'string' || !input.level || input.level.length > 80)) return { error: '"level" must be a level id or null' };
  if (!cpFinite(input.time) || input.time < 0) return { error: '"time" must be the game\'s seconds (0 or more)' };
  if (input.moment === undefined) return { error: '"moment" is missing (what the game\'s save() returned)' };
  let m;
  try {
    m = JSON.stringify(input.moment);
  } catch {
    m = undefined;
  }
  if (m === undefined) return { error: '"moment" must be JSON data' };
  if (m.length > CHECKPOINT_MAX_CHARS) return { error: `"moment" is ${m.length} characters (at most ${CHECKPOINT_MAX_CHARS})` };
  const out = { version: CHECKPOINT_VERSION, name, at: now.toISOString(), level: input.level ?? null, time: Math.round(input.time * 1000) / 1000, moment: input.moment };
  if (input.shot !== undefined) {
    if (typeof input.shot !== 'string' || input.shot.length > CHECKPOINT_MAX_SHOT || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(input.shot)) return { error: `"shot" must be a small JPEG / PNG data URL (at most ${CHECKPOINT_MAX_SHOT} characters)` };
    out.shot = input.shot;
  }
  return { value: out };
}

/**
 * A file's text read as a checkpoint (pure), or null — a broken file is never offered. A later version of the file is
 * read as far as it says the same things (version ≥ 1 with these fields): a newer editor's file still opens here.
 */
export function readCheckpoint(text) {
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (!Number.isInteger(v.version) || v.version < 1) return null;
  const name = cleanCheckpointName(v.name);
  if (!name || typeof v.at !== 'string' || Number.isNaN(Date.parse(v.at)) || !('moment' in v)) return null;
  if (v.level !== null && v.level !== undefined && typeof v.level !== 'string') return null;
  const out = { version: 1, name, at: v.at, level: typeof v.level === 'string' && v.level ? v.level : null, time: cpFinite(v.time) && v.time >= 0 ? v.time : 0, moment: v.moment };
  if (typeof v.shot === 'string' && v.shot.startsWith('data:image/')) out.shot = v.shot;
  return out;
}

/** The menu's row of a checkpoint (no moment, no picture). */
export const checkpointInfo = (id, c) => ({ id, name: c.name, at: c.at, level: c.level, time: c.time });

/** Every checkpoint of the folder, newest first, and the ids of files that are not checkpoints. */
export async function listCheckpoints(rootReal) {
  const checkpoints = [];
  const broken = [];
  const names = (await listStudioDir(rootReal, 'checkpoints')).filter((n) => n.endsWith('.json')).slice(0, CHECKPOINT_MAX_COUNT * 2);
  for (const n of names) {
    const id = n.slice(0, -5);
    if (!CHECKPOINT_ID.test(id)) continue;
    const text = await readStudioFile(rootReal, `checkpoints/${n}`, CHECKPOINT_MAX_FILE);
    const c = text === null ? null : readCheckpoint(text);
    if (c) checkpoints.push({ info: checkpointInfo(id, c), c });
    else broken.push(id);
  }
  checkpoints.sort((a, b) => Date.parse(b.info.at) - Date.parse(a.info.at) || a.info.id.localeCompare(b.info.id));
  return { checkpoints: checkpoints.map((x) => x.info), broken: broken.sort() };
}

/** One checkpoint whole, or null (none, or broken). */
export async function getCheckpoint(rootReal, id) {
  if (!CHECKPOINT_ID.test(id)) return null;
  const text = await readStudioFile(rootReal, `checkpoints/${id}.json`, CHECKPOINT_MAX_FILE);
  return text === null ? null : readCheckpoint(text);
}

/** The ids there now, id → level (undefined for a broken file). */
async function idsNow(rootReal) {
  const have = new Map();
  const l = await listCheckpoints(rootReal);
  for (const c of l.checkpoints) have.set(c.id, c.level);
  for (const id of l.broken) have.set(id, undefined);
  return { have, count: l.checkpoints.length };
}

/** Keep a checkpoint (POST): its id from its name (checkpointIdFor). */
export async function addCheckpoint(rootReal, input, now = new Date()) {
  const f = checkpointFile(input, now);
  if (f.error) throw httpError(422, f.error);
  const { have, count } = await idsNow(rootReal);
  const id = checkpointIdFor(f.value.name, f.value.level, have);
  if (!have.has(id) && count >= CHECKPOINT_MAX_COUNT) throw httpError(409, `this game has ${CHECKPOINT_MAX_COUNT} checkpoints already: delete some (▶ Play ⌄, ⋯)`);
  const path = await writeStudioFile(rootReal, `checkpoints/${id}.json`, JSON.stringify(f.value, null, 1) + '\n');
  return { id, path, info: checkpointInfo(id, f.value) };
}

/** A new name: the file moves to the new name's id (a free one), the moment and the time stay. */
export async function renameCheckpoint(rootReal, id, name) {
  const c = await getCheckpoint(rootReal, id);
  if (!c) throw httpError(404, 'no such checkpoint');
  const clean = cleanCheckpointName(name);
  if (!clean) throw httpError(422, '"name" must be a name of 1 to 40 characters');
  const { have } = await idsNow(rootReal);
  have.delete(id);
  // Another checkpoint of this level with that name is not replaced by a rename: the rename takes a free id.
  let next = checkpointSlug(clean);
  for (let n = 2; have.has(next); n++) next = `${checkpointSlug(clean).slice(0, 55)}-${n}`;
  const out = { ...c, name: clean };
  const path = await writeStudioFile(rootReal, `checkpoints/${next}.json`, JSON.stringify(out, null, 1) + '\n');
  if (next !== id) await removeStudioFile(rootReal, `checkpoints/${id}.json`);
  return { id: next, path };
}

export async function deleteCheckpoint(rootReal, id) {
  if (!CHECKPOINT_ID.test(id)) throw httpError(400, 'not a checkpoint id');
  return removeStudioFile(rootReal, `checkpoints/${id}.json`);
}
