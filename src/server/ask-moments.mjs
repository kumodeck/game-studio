// The moment of each paused ask (pause-ask stage 3, 2026-11-02; CONTRACT.md §3.5.1 `back`, SKILL.md "Paused").
//
// WHY: the person paused at 0:05.02, asked "bring the boss in from here", and the AI fixed the code. To SEE the fix they
// had to play 5 s again (or 40 s, for a boss later in the level), and the second run is never the same run. So every
// paused ask keeps the moment it was asked from, invisibly, and the request names it (`back`):
//   - the editor sends `back: { time, level?, moment?, view? }` with the request; `moment` = what the game's codeMoment
//     save() returned at that pause (absent when the game has no save / load yet: then time, level and camera only);
//   - the host keeps it as .studio/asks/<request id>.json and the request says `"back": ".studio/asks/<id>.json"`;
//   - the editor's ▶ Try from 0:05.02 opens it with the NEW code (load(moment) before the first frame, paused at once),
//     and `studio.mjs --check-moment <back>` lets the AI open the same moment headless before it answers.
// Decided 2026-11-02: an ask's moment is NOT a checkpoint — it is never in ⚑'s list (the person did not name or keep
// it), lives in the editor's folder only (like checkpoints, never in the game's code or its published files), and only
// the newest ASK_MOMENTS_KEPT are kept (like the asks' pictures in .studio/play/).
//
//   { "version": 1, "at": "2026-11-02T…Z", "level": null, "time": 5.02, "moment": { …save() … }, "view": { … } }
//
// The pure parts are exported for test/ask-moments.test.mjs.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isRequestId } from '../schema/handoff.mjs';
import { CHECKPOINT_MAX_CHARS } from './checkpoints.mjs';
import { readStudioFile, writeStudioFile } from './files.mjs';

/** The form of the file. */
export const ASK_MOMENT_VERSION = 1;
/** Asks' moments kept, at most (newest kept): the same number as the asks' pictures (server.mjs PLAY_SHOTS_KEPT). */
export const ASK_MOMENTS_KEPT = 24;
/** A file read back, at most: the moment (checkpoints' limit) and the rest. */
export const ASK_MOMENT_MAX_FILE = CHECKPOINT_MAX_CHARS + 16 * 1024;
/** The folder under .studio/ and the request's path of one. */
export const askMomentRel = (id) => `asks/${id}.json`;
export const askMomentPath = (id) => `.studio/${askMomentRel(id)}`;

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => fin(x) && Math.abs(x) < 1e7);

/**
 * What the editor sent as `back`, made into the file's content (pure), or { error }. `time` is needed (the game's
 * seconds since ▶ Play at the pause); `moment` is optional JSON data within the checkpoints' limit; `view` = the
 * player's camera { eye, target } (informational: a game without save / load opens at the same time, its own camera).
 */
export function askMomentFile(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: '"back" must be the moment of the ask' };
  if (!fin(input.time) || input.time < 0) return { error: '"back.time" must be the game\'s seconds (0 or more)' };
  if (input.level !== undefined && input.level !== null && (typeof input.level !== 'string' || !input.level || input.level.length > 80)) return { error: '"back.level" must be a level id or null' };
  const out = { version: ASK_MOMENT_VERSION, at: now.toISOString(), level: input.level ?? null, time: Math.round(Math.min(input.time, 86400 * 7) * 1000) / 1000 };
  if (input.moment !== undefined) {
    let m;
    try {
      m = JSON.stringify(input.moment);
    } catch {
      m = undefined;
    }
    if (m === undefined) return { error: '"back.moment" must be JSON data (what the game\'s save() returned)' };
    if (m.length > CHECKPOINT_MAX_CHARS) return { error: `"back.moment" is ${m.length} characters (at most ${CHECKPOINT_MAX_CHARS})` };
    out.moment = input.moment;
  }
  if (input.view && typeof input.view === 'object' && vec3(input.view.eye) && vec3(input.view.target)) out.view = { eye: input.view.eye.slice(), target: input.view.target.slice() };
  return { value: out };
}

/** A file's text read as an ask's moment (pure), or null. A later version reads as far as it says the same things. */
export function readAskMoment(text) {
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v) || !Number.isInteger(v.version) || v.version < 1) return null;
  if (!fin(v.time) || v.time < 0) return null;
  const out = { version: 1, at: typeof v.at === 'string' ? v.at : '', level: typeof v.level === 'string' && v.level ? v.level : null, time: v.time };
  if ('moment' in v && v.moment !== undefined) out.moment = v.moment;
  if (v.view && vec3(v.view.eye) && vec3(v.view.target)) out.view = v.view;
  return out;
}

/** The request id a `back` path names (".studio/asks/<id>.json" or "asks/<id>.json" or the id), or null. */
export function askMomentId(back) {
  if (typeof back !== 'string') return null;
  const m = /^(?:\.\/)?(?:\.studio\/)?(?:asks\/)?([^/]+?)(?:\.json)?$/.exec(back.trim());
  return m && isRequestId(m[1]) ? m[1] : null;
}

/**
 * Keep the ask's moment as .studio/asks/<id>.json (the request's own id) and drop the oldest beyond ASK_MOMENTS_KEPT.
 * Answers the path, or { error } when `input` is not a moment (the request is kept anyway, without `back`).
 */
export async function keepAskMoment(rootReal, id, input, now = new Date()) {
  const f = askMomentFile(input, now);
  if (f.error) return { error: f.error };
  const p = await writeStudioFile(rootReal, askMomentRel(id), JSON.stringify(f.value) + '\n');
  try {
    const dir = path.join(rootReal, '.studio', 'asks');
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && isRequestId(n.slice(0, -5))).sort();
    for (const n of names.slice(0, Math.max(0, names.length - ASK_MOMENTS_KEPT))) await fs.rm(path.join(dir, n), { force: true });
  } catch {
    /* pruning is tidying only */
  }
  return { path: p, exact: 'moment' in f.value };
}

/** One ask's moment whole, or null (none, pruned, or not a moment). */
export async function getAskMoment(rootReal, id) {
  if (!isRequestId(id)) return null;
  const text = await readStudioFile(rootReal, askMomentRel(id), ASK_MOMENT_MAX_FILE);
  return text === null ? null : readAskMoment(text);
}
