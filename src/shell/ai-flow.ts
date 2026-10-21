// What the AI line says, and when the game reloads by itself (AI feel, 2026-10-16).
//
// The flow the person should feel (the product plan for asking the AI): type "Add three lighthouses around
// the island", press Enter → at once "sent, your AI has it" → a violet light runs round the input
// while the AI works → when it is done the game is new WITHOUT pressing Reload, and only what
// changed glows violet → one press undoes it. No waiting without knowing why, no dead end.
//
// Kept as two pure functions so the rules can be tested without a browser (test/ai-flow.test.ts)
// and main.ts only draws what they decide.
//
// Phases, in the order the person sees them:
//   waiting / nudge  the host cannot tell whether an AI watches (older hosts): the old line,
//                    and "type look" after 20 s
//   sent             an AI's watch is running; the request is on its way to it
//   seen             the watch printed it to the AI (it will wake within seconds)
//   away             nobody watches: say so AT ONCE, with the one thing to do and what still
//                    works (play test 10/16: 21 s of "waiting" and then a dead end)
//   received/working the AI wrote its status (its note, if any, is the line)
//   asking           the AI asked the person something in its own window and waits (its note is the question;
//                    dogfood 2026-10-17: "Your AI has it" stayed up 5 minutes while it waited for an answer)
//   updating         the AI is done and the game is reloading behind the old picture
//   done / failed    the AI's one-line reply; done also has "Undo AI change"
//   undone / redone  after the person pressed Undo / Redo
import type { AiAgent, StudioStatus } from '../contract.ts';
import { statusCovers } from '../schema/handoff.mjs';

export type AiPhase = 'none' | 'waiting' | 'nudge' | 'sent' | 'seen' | 'away' | 'received' | 'working' | 'asking' | 'updating' | 'done' | 'failed' | 'undone' | 'redone';

export interface AiPending {
  kind: string;
  id?: string;
  /** Host time of the request (ms). */
  at: number;
  /** Page time it was sent (ms). */
  sent: number;
  text?: string;
}

export interface AiFlowState {
  now: number;
  /** The host has no AI behind it (the web demo). */
  offline: boolean;
  pending: AiPending | null;
  status: StudioStatus | null;
  /** When the status file was written (host ms). */
  statusTime: number | null;
  /** When this page opened: an older status is not news. */
  openedAt: number;
  /** Is an AI's watch running? undefined = this host cannot tell. */
  watching: boolean | undefined;
  /** The last request id the watch printed to the AI. */
  seen?: string;
  /** The game is reloading after the AI's change. */
  reloading: boolean;
  /** The person pressed Undo / Redo since the last request. */
  after: 'undone' | 'redone' | null;
}

/** Seconds without a pick-up before "type look" when the host cannot tell whether an AI watches. */
export const NUDGE_MS = 20_000;

/**
 * How long an AI's open question (`asking`) stays news for a page opened after it was asked. WHY (e2e-016,
 * 2026-10-20): the AI asked "12, 16 or 24 pillars?" and waited for the answer from the editor; the editor was opened
 * again (a reload) and showed nothing, so nobody could answer and the AI gave up after 10 minutes. A question is news
 * until it is answered, whenever the page opened. 6 hours: a question left from yesterday's session is not shown
 * (answering one anyway is harmless: the skill marks an answer it already had as done with no change).
 */
export const ASK_FRESH_MS = 6 * 60 * 60 * 1000;

export function aiPhase(s: AiFlowState): AiPhase {
  if (s.after) return s.after;
  const p = s.pending;
  const covered = p ? statusCovers({ id: p.id ?? '', at: p.at }, s.status, s.statusTime) : false;
  if (p && !covered) {
    if (s.offline) return 'waiting';
    if (s.watching === undefined) return s.now - p.sent < NUDGE_MS ? 'waiting' : 'nudge';
    // Ids sort by time: a watch that printed this one or a later one has shown it to the AI.
    if (p.id && s.seen && s.seen >= p.id) return 'seen';
    return s.watching ? 'sent' : 'away';
  }
  // An old status from an earlier session ("done" yesterday) is not news: only once it answers this
  // page's request or was written while the page is open.
  const openQuestion = s.status?.state === 'asking' && s.statusTime != null && s.now - s.statusTime < ASK_FRESH_MS;
  const fresh = !!s.status && ((p && covered) || (s.statusTime ?? 0) >= s.openedAt || openQuestion);
  if (!fresh || !s.status) return 'none';
  if (s.status.state === 'done') return s.reloading ? 'updating' : 'done';
  return s.status.state;
}

/**
 * The violet light runs round the input in these phases: the AI has it and is on it. Not while `asking`: then the
 * person is the one to act, and a running light would say "wait" (supervision 2026-10-17: the dot does not blink).
 */
export function aiBusy(phase: AiPhase): boolean {
  return phase === 'sent' || phase === 'seen' || phase === 'received' || phase === 'working' || phase === 'updating';
}

export interface ReloadState {
  /** The game files' signature now, and when the loaded game was opened. */
  code: string | undefined;
  loadedCode: string | undefined;
  /** How long `code` has stayed the same (ms). */
  stableMs: number;
  phase: AiPhase;
  playing: boolean;
  /** A reload is already under way. */
  reloading: boolean;
}

/**
 * An AI that has the request (or said "working") but never writes "done" still gets its change shown once its files
 * have been quiet this long.
 *
 * WHY so long (agent-solid pass 2026-10-17): it was 8 s. A real Claude Code run (report realagent-20261017-0029)
 * writes the lighthouses, then spends 20-40 s shooting the game (§3.3 `--shot`) and moving them again: every pause
 * passed 8 s, so the game reloaded 3 times in 50 s while the AI was still "working", and the violet marks blinked
 * 3 → 0 → 3. Worse, the last reload compared against the half-done game, so three NEW lighthouses were called
 * "AI moved 3". An AI that said it is working will say "done"; the long fallback is only for one that forgot.
 */
export const QUIET_MS = 180_000;

/**
 * Reload the game now, later, or not at all.
 * - The files did not change since the game was opened: no.
 * - Playing: no (the person is playing; Edit reloads anyway).
 * - The AI says it is done (or failed): now, the moment its files changed (no half-written game: it writes
 *   "done" after the files).
 * - The AI has it or is working: wait for "done", however many files it writes and however long it looks at the
 *   game in between; only files quiet for QUIET_MS (an AI that forgot the status) reload without it.
 * - Nobody is working (the person edited the code in their own editor, an AI without the skill):
 *   as soon as the files stopped changing for one poll.
 */
export function reloadDecision(r: ReloadState): 'now' | 'wait' | 'no' {
  if (!r.code || !r.loadedCode || r.code === r.loadedCode || r.playing || r.reloading) return 'no';
  if (r.phase === 'done' || r.phase === 'failed') return 'now';
  // Asking: the AI may have written half its change before its question; wait for its "done" like while it works.
  if (aiBusy(r.phase) || r.phase === 'asking') return r.stableMs >= QUIET_MS ? 'now' : 'wait';
  return r.stableMs > 0 ? 'now' : 'wait';
}

/**
 * "More in Claude" / "More in Codex" / "More in your AI" at the end of the line's small grey row (a try of v0.1.8,
 * 2026-10-21: "it should say 'see Claude for details' — Claude if you use Claude, Codex if Codex, or a general 'see your AI'").
 * The line is one sentence; the AI's whole answer (what it changed and why, what it would do next, its question in full)
 * is in its own window, and nothing said so.
 *
 * Only when the AI has done or said something: done, failed (why it stopped is there) and asking (it asked in its own
 * window too). Not while it works (the line is the news then), not after the person's own Undo / Redo (nothing new from
 * the AI), not on an offline host (the web demo: no AI to look at).
 * Words only, not a button (2026-10-21): a web page cannot bring the AI's window to the front — the Claude app's side
 * pane is right next to the chat anyway, and a browser tab has no way back to a terminal or to Codex.
 * Returns the i18n key, or null for no words.
 */
export function moreIn(phase: AiPhase, agent: AiAgent | undefined, offline: boolean): string | null {
  if (offline || (phase !== 'done' && phase !== 'failed' && phase !== 'asking')) return null;
  return agent === 'claude' ? 'ai.more.claude' : agent === 'codex' ? 'ai.more.codex' : 'ai.more.any';
}
