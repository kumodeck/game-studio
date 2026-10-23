// Is the AI there? Said next to the ask field BEFORE the person types (ai presence, a hands-on review 2026-10-23).
//
// WHY: the top bar had a grey "● AI" that nobody could read, and a request sent with no AI to pick it up ended on
// "Your request is in. It goes into the game the next time your AI runs." — to someone new, "I asked and nothing
// happened". The field now says in words, before a key is pressed, one of these:
//   watching  "● Claude is watching"                  a heartbeat from this moment: a note reaches the AI now
//   working   "● Claude is working"                   the AI is at work on this page's request (no heartbeat needed)
//   look      "Codex reads it when you type “look”"   Codex has no hooks: what we KNOW is the rule, not whether it is open
//   away      "Claude isn't watching · How to open"   Claude was watching in this page and has been gone a while
//   unsure    "Not sure Claude is open · How to open" anything else; the field's placeholder adds "kept either way"
// The name is the person's own AI (Claude / Codex), "your AI" when the editor cannot tell.
//
// The rule that shapes all of it (ux-review consult, 2026-10-23): a wrong green is worse than no dot. So the two
// green states need proof from this moment, "away" needs proof too, and everything in between is said as not knowing.
// Design review of this plan (2026-10-23) changed three things from the first draft:
// - "away" says "isn't watching", not "isn't open" (the first wording): a long turn the person started in
//   Claude itself leaves no heartbeat for minutes, and "isn't open" next to a visibly open Claude is a wrong colour
//   the other way round. "Isn't watching" is what the editor knows.
// - Codex never gets "not sure": its rule is known ("type look"), and a fact beats a shrug.
// - a status-only "here" says "working", not "watching": the AI is there, but a NEW note may not wake it until its
//   turn ends.
//
// What the editor can know (ai-watch.mjs, which-ai.mjs):
// - `watching` true: the AI's watch (`studio.mjs --watch`) or Claude Code's plugin wake hook wrote its heartbeat in
//   the last 5 s. false: no fresh heartbeat. undefined: this host cannot tell.
// - false is NOT proof the AI is closed: Codex has no hooks (false while open), Claude Code without the plugin and
//   without a watch is false while open, a watch restarts every 29 minutes (a few seconds of false), and in a turn the
//   plugin's hook woke Claude into, the hook has exited (false while Claude works on the request).
// So:
// - watching = `watching` true (any AI; a Codex with a watch running is watching too).
// - working  = the AI holds a request of this page right now (seen / received / working / updating / asking), or it
//              wrote a status in the last HERE_STATUS_MS.
// - look     = Codex, otherwise.
// - away     = Claude (the plugin's hook is the one thing that makes "false" mean "gone"), seen watching in THIS
//              page, not watching for AWAY_AFTER_MS since, and the page visible all that time (a hidden tab's timers
//              starve: coming back to it must not read as a minute of silence).
// - unsure   = everything else (never seen watching, a host that cannot tell, the grace after a heartbeat stops).
// Pure, so test/ai-presence.test.ts reads the rules without a browser; main.ts keeps the clock and draws the words.
import type { AiAgent } from '../contract.ts';
import { aiBusy, type AiPhase } from './ai-flow.ts';

export type AiPresence = 'watching' | 'working' | 'look' | 'away' | 'unsure';

/** A status the AI wrote this recently says it is at work, whatever the heartbeat says (ms). */
export const HERE_STATUS_MS = 20_000;
/**
 * How long Claude's heartbeat must stay gone before the field says "isn't watching" (ms). Longer than a watch's restart
 * and the moment between the AI's "done" and its turn ending (when the plugin starts waiting again): both are seconds.
 */
export const AWAY_AFTER_MS = 60_000;

export interface PresenceState {
  now: number;
  /** ai-watch.mjs: is a request reaching the AI right now? undefined = this host cannot tell. */
  watching: boolean | undefined;
  agent: AiAgent | undefined;
  /** The AI line's phase (ai-flow.ts aiPhase). */
  phase: AiPhase;
  /** When the AI last wrote its status (host ms), any request. */
  statusTime: number | null;
  /** When this page last saw `watching` true (page ms); null = never in this page. */
  lastWatching: number | null;
  /** Since when the page has been visible without a break (page ms). */
  visibleSince: number;
}

export function aiPresence(s: PresenceState): AiPresence {
  if (s.watching === true) return 'watching';
  if (aiBusy(s.phase) || s.phase === 'asking') return 'working';
  if (s.statusTime != null && s.now - s.statusTime < HERE_STATUS_MS) return 'working';
  if (s.agent === 'codex') return 'look';
  if (s.watching === false && s.agent === 'claude' && s.lastWatching != null && s.now - s.lastWatching >= AWAY_AFTER_MS
    && s.now - s.visibleSince >= AWAY_AFTER_MS) return 'away';
  return 'unsure';
}

/** Green (the dot): only the two states with proof from this moment. */
export function presenceSure(p: AiPresence): boolean {
  return p === 'watching' || p === 'working';
}

/**
 * Sent while a heartbeat said "watching", but no watch or hook has shown it to the AI after this long (ms): the line
 * stops saying "on it" and says the fact instead (kept as a note), with "How to open". A heartbeat that vanished just
 * as the person pressed Enter must not leave "Claude is on it" hanging.
 */
export const UNSEEN_MS = 15_000;

/** A request the AI has but has said nothing new about for this long shows how long it has been ("· 3 min"). */
export const QUIET_WORK_MS = 120_000;

/** The AI's name in the words: i18n key suffix for "Claude" / "Codex" / "your AI". */
export function aiNameKey(agent: AiAgent | undefined): 'claude' | 'codex' | 'any' {
  return agent === 'claude' ? 'claude' : agent === 'codex' ? 'codex' : 'any';
}
