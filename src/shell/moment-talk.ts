// The talk of a paused moment (pause-edit, 2026-10-28; it was bridge/play-chat.ts, the chat panel over a paused game,
// 2026-10-22). The panel is gone (decision 7): the paused moment is the editor, and the person asks their AI in the
// editor's ONE field at the foot ("Ask Claude about this moment…"). What stays is the talk itself, here, pure
// (test/pause.test.ts):
//   - each message is the same `play` request as before, marked `paused`; the first one carries the moment taken when
//     the game stopped (picture, player's camera, what was near, the console), the next ones `chat` (the first one's
//     id) and `history` (the talk so far) — so the AI reads one record and knows the whole conversation (the host
//     also keeps it as .studio/chat/<id>.json, play-chat.mjs);
//   - the AI's replies are the same status line the editor already has (play-ask.ts playLine): its `done` / `asking` /
//     `failed` note becomes a turn; the line over the field shows the latest, "▴ Earlier · N" the ones before.
import type { PlayLine } from '../contract.ts';

export interface ChatTurn {
  who: 'you' | 'ai';
  text: string;
  /** AI turns: how it ended (fixed = answered / fixed, failed, asking = a question with `choices`). */
  state?: PlayLine['state'];
  choices?: string[];
  reload?: boolean;
  more?: string;
}

/** The turns the next request carries (`history`): the last 12, each cut to 300 characters (HANDOFF_LIMITS). */
export const HISTORY_MAX = 12;
export function historyOf(turns: ChatTurn[]): Array<{ who: 'you' | 'ai'; text: string }> {
  return turns.slice(-HISTORY_MAX).map((t) => ({ who: t.who, text: t.text.length > 300 ? t.text.slice(0, 299) + '…' : t.text }));
}

/**
 * The pure part (test/pause.test.ts): what a new line from the editor does to the chat.
 * - `awaiting`: a message was kept (play/sent ok) and its answer has not come yet. Only then does a finished line
 *   (fixed / failed / asking) become a NEW reply: before the request is kept, the editor may still be showing the
 *   previous request's line, which is already in the chat.
 * - A finished line while not awaiting updates the last reply in place (the AI's files settled and Reload appeared,
 *   "More in Claude" came) — never a second copy of it.
 * - looking / fixing / kept: the row under the talk that says the AI is on it (`live`); a reply clears it. Always
 *   shown: the editor sends these only for the latest request made in this Play, which is the person's own.
 */
export interface ChatModel {
  turns: ChatTurn[];
  awaiting: boolean;
  live: PlayLine | null;
}
export function chatOnLine(m: ChatModel, s: PlayLine | null): ChatModel {
  if (!s) return { ...m, live: null };
  const finished = s.state === 'fixed' || s.state === 'failed' || s.state === 'asking';
  if (!finished) return { ...m, live: s };
  const turn: ChatTurn = { who: 'ai', text: s.text, state: s.state };
  if (s.choices?.length) turn.choices = s.choices.slice();
  if (s.reload) turn.reload = true;
  if (s.more) turn.more = s.more;
  if (m.awaiting) return { turns: [...m.turns, turn], awaiting: false, live: null };
  const last = m.turns[m.turns.length - 1];
  if (last && last.who === 'ai') return { turns: [...m.turns.slice(0, -1), turn], awaiting: false, live: null };
  return { ...m, live: null };
}

