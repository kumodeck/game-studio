// The one line over the game while playing (ask while playing, CONTRACT.md §3.5, 2026-10-20).
//
// The person asked from inside ▶ Play and keeps playing. What they need to see is short: the AI is on it, then what
// it did, and — only when the game's files changed — a Reload they choose to press (the game is NOT reloaded under
// them: a run in progress is theirs). The same phases as the editor's AI line (ai-flow.ts), fewer words.
//
// Pure, so test/play-ask.test.ts reads the rules without a browser; main.ts sends the result to the game page,
// where bridge/play-ask.ts draws it.
import type { AiAgent, PlayLine, StudioStatus } from '../contract.ts';
import { moreIn, type AiPhase } from './ai-flow.ts';

export interface PlayLineInput {
  phase: AiPhase;
  status: StudioStatus | null;
  /** The person's words for the request this line follows (already cut short). */
  asked?: string;
  /** The game's files changed since the game in the frame was opened (undefined: this host cannot tell). */
  codeChanged: boolean | undefined;
  /** Which AI is behind the editor (host.status().agent, which-ai.mjs): "More in Claude" / "Codex" / "your AI". */
  agent?: AiAgent;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/** The line for this phase, or null when there is nothing to say (no request from this Play, or it is history). */
export function playLine(i: PlayLineInput): PlayLine | null {
  const { phase: ph, status: s, t } = i;
  const note = s?.note ? s.note.replace(/[.…]+$/, '') : '';
  const asked = i.asked ? t('ai.asked', { text: i.asked }).replace(/\s*→\s*$/, '') : undefined;
  // "More in Claude" at the end of the small row (a try of v0.1.8, 2026-10-21: the editor's line had it, the line over the game
  // did not). The same rule as the editor's line, by the same function: only when the AI did or said something (done,
  // failed, asking), so not while it looks / fixes, not on "kept", and not on "updating" (the files still move).
  // Offline is false here: the offline web demo never sends this line (main.ts sendPlayLine).
  const moreKey = moreIn(ph, i.agent, false);
  const more = moreKey ? t(moreKey) : undefined;
  const out = (state: PlayLine['state'], text: string, extra: Partial<PlayLine> = {}): PlayLine =>
    ({ state, text, ...(asked ? { asked } : {}), ...(more ? { more } : {}), ...extra });
  switch (ph) {
    case 'waiting':
    case 'sent':
    case 'seen':
    case 'received':
      return out('looking', t('play.looking'));
    case 'nudge':
    case 'away':
      // Shorter than the editor's line: it sits over the game, one line on a phone.
      return out('kept', t('play.kept'));
    case 'working':
      return out('fixing', note ? `${note}…` : t('play.fixing'));
    case 'asking':
      return out('asking', s?.note || t('ai.asking'), s?.choices?.length ? { choices: s.choices.slice() } : {});
    case 'updating':
    case 'done':
      // A host that cannot tell whether files changed: offer Reload anyway (it is harmless and the person decides).
      return out('fixed', s?.note || t('play.fixed'), { reload: i.codeChanged !== false });
    case 'failed':
      return out('failed', s?.note || t('ai.failed'));
    default:
      return null;
  }
}

/** The overlay's own words (the bridge has none), in the person's language. */
export function playWords(t: (key: string) => string): Record<string, string> {
  const keys = ['ask', 'askTip', 'placeholder', 'placeholderShort', 'answerPlaceholder', 'sending', 'sendFail', 'reload', 'reloadTip', 'enterReloads', 'keep', 'close'];
  return Object.fromEntries(keys.map((k) => [k, t(`play.${k}`)]));
}
