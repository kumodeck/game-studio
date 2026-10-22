// The chat over a paused game, kept as one file (pause, 2026-10-22; CONTRACT.md §3.5.1).
//
// The person paused ▶ Play and talks to their AI about the moment it stopped at. Each message is a `play` request
// marked `paused` (the first carries the moment, the next ones `chat` = the first one's id). This keeps the whole talk
// in .studio/chat/<first id>.json, both sides, so the AI (or the person, later) reads one file instead of piecing it
// together from requests and status lines:
// - the person's turns: written by the server when it keeps the request (server.mjs, POST /request);
// - the AI's turns: written by `studio.mjs --status done|asking|failed --request <id> --note …` (cli.mjs), the same
//   note the editor shows as the reply.
// Either side may write first or alone (an AI that writes status.json by hand adds no turn; the request still has
// `history`), so every write reads the file again and adds to it.
import { readStudioFile, writeStudioFile } from './files.mjs';

/** Turns kept in one chat file: a talk this long is a different conversation. */
const CHAT_TURNS_KEPT = 200;

/** The chat a request belongs to: its `chat`, or itself when it is the first message of a pause. Else null. */
export function chatIdOf(rec) {
  if (!rec || rec.kind !== 'play' || rec.paused !== true) return null;
  return typeof rec.chat === 'string' && rec.chat ? rec.chat : rec.id || null;
}

/**
 * The file's next content (pure, test/pause.test.ts): `old` as read (null / broken = a new talk), the turn added.
 * `first`: what the talk's first request carries, written into a new file (the moment: picture, camera, near, logs).
 */
export function chatWithTurn(old, id, turn, first = {}) {
  let c = null;
  try {
    c = old ? JSON.parse(old) : null;
  } catch {
    c = null;
  }
  if (!c || typeof c !== 'object' || c.id !== id || !Array.isArray(c.turns)) {
    c = { version: 1, id, at: turn.at, paused: true };
    for (const k of ['shot', 'view', 'near', 'logs', 'size', 'fullscreen']) if (first[k] !== undefined) c[k] = first[k];
    c.turns = [];
  }
  // The same turn twice (a status written again for the same request and words): once.
  const dup = c.turns.some((t) => t && t.who === turn.who && t.request === turn.request && t.text === turn.text);
  if (!dup) c.turns.push(turn);
  if (c.turns.length > CHAT_TURNS_KEPT) c.turns = c.turns.slice(-CHAT_TURNS_KEPT);
  return JSON.stringify(c, null, 2) + '\n';
}

/** Add one turn to .studio/chat/<id>.json; returns its path, or null (never throws: the talk is a record, not a gate). */
export async function addChatTurn(rootReal, id, turn, first) {
  const rel = `chat/${id}.json`;
  try {
    const old = await readStudioFile(rootReal, rel, 512 * 1024).catch(() => null);
    return await writeStudioFile(rootReal, rel, chatWithTurn(old, id, turn, first));
  } catch {
    return null;
  }
}
