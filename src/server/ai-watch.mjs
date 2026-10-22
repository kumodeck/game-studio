// "Is the AI watching this editor right now?" (CONTRACT.md §3.4, AI feel 2026-10-16).
//
// The play test found the worst wait in the whole flow: after Send / Save, nobody could tell for
// 21 s whether an AI was there at all ("Waiting for it to pick it up…", then "say look"). The
// editor cannot see the AI's window, so the AI has to leave a sign. The sign is one process:
//
//   node studio.mjs <game folder> --watch
//
// The agent runs it as its watch (Claude Code: Monitor; anything that wakes on a new output line).
// It prints one `studio:` line per new request (the same lines the server prints) and, while it
// runs, rewrites .studio/watch.json every AIW_BEAT_MS with its pid and the last request it printed.
// The server reads that file: "watching" = written in the last AIW_FRESH_MS by a process that is
// still alive. So the editor knows the moment the person presses Enter (the request's answer
// carries it), and "seen" turns into "your AI has it" within half a second.
//
// WHY a heartbeat file and not "the AI wrote status lately": an agent that is watching but idle
// writes nothing. WHY the watch process and not the agent itself: an agent cannot run a timer
// between turns, but its watch runs exactly as long as it can be woken, which is the thing the
// person needs to know. When the watch ends (Monitor time-out, the session closed), the file goes
// stale within seconds and the editor says what to do instead.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isRequestId, KUMODECK_STEP_IDS, FILE_STEP_IDS } from '../schema/handoff.mjs';
import { readStudioFileInfo, writeStudioFile } from './files.mjs';

export const AIW_BEAT_MS = 1500;
export const AIW_FRESH_MS = 5000;
const AIW_POLL_MS = 400;
// How long one `--watch` runs before it ends on its own (quiet watch, 2026-10-19).
// WHY end at all: Claude Code's Monitor kills every watch at its timeout_ms (default 5 min, at most
// 30 min) and wakes the agent with a bare "monitor expired" notice; the agents then told the person
// "I started watching again, no requests yet" every time (a play test saw it over and over). A watch
// that ends a minute before the cap with its own line tells the agent, in the event itself, that
// nothing is wrong and what to do (start it again, say nothing). 29 = just under the 30-min cap
// (recommended); `--for 0` = never end (agents without a time limit on their watch).
export const AIW_FOR_MIN = 29;
// The last line of a watch that ended on time. Read by the agent (SKILL.md §3 table), so the words
// carry the instruction: it is not news for the person.
export const AIW_REST_LINE = 'studio: watch rest (nothing wrong) - start the same --watch again now; tell the person nothing';

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // alive, owned by someone else
  }
}

/** Is a heartbeat file (watch.json, wake.json) fresh and written by a live process? */
async function beatAlive(rootReal, name, now) {
  const f = await readStudioFileInfo(rootReal, name, 4096);
  if (!f) return { alive: false };
  let w;
  try {
    w = JSON.parse(f.text);
  } catch {
    return { alive: false };
  }
  const at = typeof w?.at === 'string' ? Date.parse(w.at) : NaN;
  const fresh = Number.isFinite(at) && now - at < AIW_FRESH_MS && now - f.mtimeMs < AIW_FRESH_MS;
  return { alive: fresh && pidAlive(w.pid), seen: isRequestId(w?.seen) ? w.seen : undefined, pid: w?.pid };
}

/**
 * The last request id any watch or wake hook printed to the AI (.studio/told.json). WHY a file of its own
 * (push to the AI, 2026-10-19): watch.json is removed when a watch ends, and the wake hook (ai-wake.mjs) ends the
 * moment it wakes the AI; without a lasting mark the editor fell back from "Your AI has it" to "not watching" in
 * the seconds between the wake and the AI's `received`, and the next wake could not tell which requests it already
 * handed over.
 */
export async function readTold(rootReal) {
  const f = await readStudioFileInfo(rootReal, 'told.json', 4096);
  try {
    const id = f ? JSON.parse(f.text)?.seen : undefined;
    return isRequestId(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Remember that `id` (and every request before it) was printed to the AI. Never goes back. */
export async function markTold(rootReal, id) {
  if (!isRequestId(id)) return;
  const was = await readTold(rootReal);
  if (was && was >= id) return;
  await writeStudioFile(rootReal, 'told.json', JSON.stringify({ version: 1, seen: id, at: new Date().toISOString() }) + '\n').catch(() => {});
}

/**
 * What the AI's way in looks like right now: { watching, seen? }. `watching` = a `--watch` is running, or the
 * plugin's wake hook is waiting to wake the AI (wake.json, ai-wake.mjs): either way a request reaches the AI
 * without the person doing anything. Lenient like the status: a missing or broken file is "not watching".
 */
export async function readWatch(rootReal, now = Date.now()) {
  const [w, k, told] = await Promise.all([beatAlive(rootReal, 'watch.json', now), beatAlive(rootReal, 'wake.json', now), readTold(rootReal)]);
  const out = { watching: w.alive || k.alive };
  const seen = [w.seen, told].filter(Boolean).sort().pop();
  if (seen) out.seen = seen;
  return out;
}

/** Is a `--watch` (not the wake hook) running for this folder? The wake hook steps aside for it. */
export async function watchAlive(rootReal, now = Date.now()) {
  return (await beatAlive(rootReal, 'watch.json', now)).alive;
}

/** Is a wake hook already waiting for this folder (one is enough)? */
export async function wakeAlive(rootReal, now = Date.now()) {
  return (await beatAlive(rootReal, 'wake.json', now)).alive;
}

/** One `studio:` line for a kept request: the same words the server prints when it keeps it. */
export function handoffLine(rec, relPath) {
  const v = rec || {};
  if (v.kind === 'saved') return `studio: saved ${(v.files && v.files[0]) || 'placement.json'} (${v.text || ''})`;
  if (v.kind === 'undone') return `studio: undone ${relPath} ${JSON.stringify(v.text || '')}`;
  // The person answered your `asking` question in the editor (2026-10-19): the answer, then what it answers.
  if (v.kind === 'answer') {
    const q = v.question ? ` to ${JSON.stringify(v.question.length > 80 ? v.question.slice(0, 79) + '…' : v.question)}` : '';
    return `studio: answer ${relPath} ${JSON.stringify(v.text || '')}${q}${v.to ? ` (request ${v.to})` : ''}`;
  }
  // Asked while playing (§3.5, 2026-10-20): the words, then what came with them — the picture's file (the AI opens it)
  // and how many errors the console had, so the line alone says "look at the picture and the log".
  if (v.kind === 'play') {
    const errs = Array.isArray(v.logs) ? v.logs.filter((l) => l && l.level === 'error').length : 0;
    // Paused (2026-10-22): they stopped the game to talk; the line names the chat file, which has the whole talk.
    const chatId = v.paused === true ? (typeof v.chat === 'string' && v.chat ? v.chat : String(relPath).replace(/^.*\/|\.json$/g, '')) : '';
    const bits = [chatId ? `paused, chat .studio/chat/${chatId}.json` : 'while playing', v.shot ? `picture ${v.shot}` : '', errs ? `${errs} error${errs === 1 ? '' : 's'}` : ''].filter(Boolean);
    return `studio: request play ${relPath} ${JSON.stringify((v.text || '').length > 120 ? v.text.slice(0, 119) + '…' : v.text || '')} (${bits.join(', ')})`;
  }
  if (v.kind === 'next-step' && (KUMODECK_STEP_IDS.includes(v.step) || FILE_STEP_IDS.includes(v.step))) {
    return `studio: next-step ${v.step} ${(v.files && v.files[0]) || '.studio/next-step.md'}`;
  }
  const what = v.kind === 'next-step' ? `next-step ${v.step}` : v.kind;
  const objs = Array.isArray(v.objects) ? v.objects : [];
  // Files picked in the Library ("use the Library", 2026-10-18) are named after the objects, by their folder path:
  // the line alone then says what "this" is ("Add this to the scene" (assets/boss.glb)).
  const assets = Array.isArray(v.assets) ? v.assets : [];
  const all = [...objs.map((o) => o.label || o.key), ...assets];
  const names = all.slice(0, 4).join(', ');
  const more = all.length > 4 ? ` +${all.length - 4}` : '';
  const text = v.text ? ' ' + JSON.stringify(v.text.length > 120 ? v.text.slice(0, 119) + '…' : v.text) : '';
  // An ask with no objects is about the whole game: the line says so.
  const about = names ? ` (${names}${more})` : v.kind === 'ask' ? ' (whole game)' : '';
  return `studio: request ${what} ${relPath}${text}${about}`;
}

/**
 * `studio.mjs <folder> --watch`: print a line for every request (the waiting ones first), keep
 * .studio/watch.json fresh, and run until stopped or for `forMs` (then AIW_REST_LINE; 0 = no end).
 * Prints nothing else while no request comes: every line wakes the agent (and costs a turn).
 */
export async function runWatch(rootReal, { out = (l) => process.stdout.write(l + '\n'), quiet = (l) => process.stderr.write(l + '\n'), signal, forMs = AIW_FOR_MIN * 60_000 } = {}) {
  const dir = path.join(rootReal, '.studio', 'requests');
  const printed = new Set();
  let seen;
  let lastBeat = 0;
  const beat = async () => {
    lastBeat = Date.now();
    const body = { version: 1, pid: process.pid, at: new Date().toISOString(), ...(seen ? { seen } : {}) };
    await writeStudioFile(rootReal, 'watch.json', JSON.stringify(body) + '\n').catch(() => {});
  };
  const scan = async (first) => {
    const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json') && isRequestId(n.slice(0, -5))).sort();
    // `watching 0 waiting` goes to stderr: on stdout it woke the agent at every (re)start with nothing to do,
    // and the agent said "still watching" (quiet watch 2026-10-19). With requests waiting it stays on stdout
    // as the header of the lines that follow. A start that fails prints its error instead, so the agent
    // still hears about that (Monitor ends, with the exit code).
    if (first) (names.length ? out : quiet)(`studio: watching ${names.length} waiting`);
    let fresh = false;
    for (const n of names) {
      const id = n.slice(0, -5);
      if (printed.has(id)) continue;
      printed.add(id);
      let rec;
      try {
        rec = JSON.parse(await fs.readFile(path.join(dir, n), 'utf8'));
      } catch {
        continue; // half-written (the server writes atomically, so rare): the next scan has it
      }
      out(handoffLine(rec, `.studio/requests/${n}`));
      seen = id;
      fresh = true;
    }
    if (fresh) await markTold(rootReal, seen);
    // The beat right after a line: "your AI has it" shows in the editor at once.
    if (fresh || Date.now() - lastBeat >= AIW_BEAT_MS) await beat();
  };
  const stop = async () => {
    // Leaving: the file goes, so the editor says "not watching" at once instead of after 5 s.
    await fs.rm(path.join(rootReal, '.studio', 'watch.json'), { force: true }).catch(() => {});
  };
  await scan(true);
  if (!signal) {
    const quit = () => void stop().finally(() => process.exit(0));
    process.once('SIGINT', quit);
    process.once('SIGTERM', quit);
    process.once('SIGHUP', quit);
  }
  const endAt = forMs > 0 ? Date.now() + forMs : Infinity;
  let rested = false;
  while (!signal?.aborted) {
    await new Promise((r) => setTimeout(r, AIW_POLL_MS));
    if (signal?.aborted) break;
    await scan(false);
    if (Date.now() >= endAt) {
      rested = true;
      break;
    }
  }
  await stop();
  if (rested) out(AIW_REST_LINE);
}
