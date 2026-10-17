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

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // alive, owned by someone else
  }
}

/**
 * What the watch last wrote: { watching, seen? }. Lenient like the status: a missing or broken
 * file is "not watching", never an error.
 */
export async function readWatch(rootReal, now = Date.now()) {
  const f = await readStudioFileInfo(rootReal, 'watch.json', 4096);
  if (!f) return { watching: false };
  let w;
  try {
    w = JSON.parse(f.text);
  } catch {
    return { watching: false };
  }
  const at = typeof w?.at === 'string' ? Date.parse(w.at) : NaN;
  const fresh = Number.isFinite(at) && now - at < AIW_FRESH_MS && now - f.mtimeMs < AIW_FRESH_MS;
  const watching = fresh && pidAlive(w.pid);
  const out = { watching };
  if (isRequestId(w?.seen)) out.seen = w.seen;
  return out;
}

/** One `studio:` line for a kept request: the same words the server prints when it keeps it. */
export function handoffLine(rec, relPath) {
  const v = rec || {};
  if (v.kind === 'saved') return `studio: saved ${(v.files && v.files[0]) || 'placement.json'} (${v.text || ''})`;
  if (v.kind === 'undone') return `studio: undone ${relPath} ${JSON.stringify(v.text || '')}`;
  if (v.kind === 'next-step' && (KUMODECK_STEP_IDS.includes(v.step) || FILE_STEP_IDS.includes(v.step))) {
    return `studio: next-step ${v.step} ${(v.files && v.files[0]) || '.studio/next-step.md'}`;
  }
  const what = v.kind === 'next-step' ? `next-step ${v.step}` : v.kind;
  const objs = Array.isArray(v.objects) ? v.objects : [];
  const names = objs.slice(0, 4).map((o) => o.label || o.key).join(', ');
  const more = objs.length > 4 ? ` +${objs.length - 4}` : '';
  const text = v.text ? ' ' + JSON.stringify(v.text.length > 120 ? v.text.slice(0, 119) + '…' : v.text) : '';
  // An ask with no objects is about the whole game: the line says so.
  const about = names ? ` (${names}${more})` : v.kind === 'ask' ? ' (whole game)' : '';
  return `studio: request ${what} ${relPath}${text}${about}`;
}

/**
 * `studio.mjs <folder> --watch`: print a line for every request (the waiting ones first), keep
 * .studio/watch.json fresh, and run until stopped. Resolves only when `signal` aborts (tests).
 */
export async function runWatch(rootReal, { out = (l) => process.stdout.write(l + '\n'), signal } = {}) {
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
    if (first) out(`studio: watching ${names.length} waiting`);
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
  while (!signal?.aborted) {
    await new Promise((r) => setTimeout(r, AIW_POLL_MS));
    if (signal?.aborted) break;
    await scan(false);
  }
  await stop();
}
