// The line after Save: what was kept, and whether it reached the game (plan step 6, 2026-10-23).
//
// WHY: a try of the editor, 2026-10-21: "I don't notice it saved" / "you'd never notice like this" / "'Save to game' — I don't get what it
// means". The line after Save said only "Claude is on it" (and the top bar a small "✓ Saved"), so nothing on screen said
// WHAT was kept or WHETHER it got into the game. Now the same line (right over the ask field, where the AI's replies
// already are) says it with the objects' own names:
//   pressed       "Saved: moved gate · gate’s motion · ship’s motion"   + "Claude is putting it in the code…"
//   AI finished   "✓ In the game (3)" [▶ Play]                          + "Undo AI change · More in Claude"
//   no AI there   "Saved. Claude puts it in the code when it opens"     (a fact, not a promise; "How to open" stays the
//                                                                         presence words under it — one, not two)
// More than 3 names: the first 3 and "2 more" (the line is one line, on a phone too).
//
// Pure, so test/save-receipt.test.ts reads the rules without a browser; main.ts handOff() collects the things (before
// markSaved forgets them) and renderAiLine() draws the line.

/** One thing a Save kept. `moved` = its place / turn / size; `motion` = a motion (the name is the motion's own). */
export interface SavedThing {
  kind: 'moved' | 'motion';
  name: string;
}

/** The names shown before "N more" (the plan: three, then "2 more"). */
export const RECEIPT_NAMES = 3;

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * "moved gate · gate’s motion · 2 more". `total` = everything the Save counted (Save · N), so changes with no name of
 * their own (a UI piece's text, a level's order) are in "N more" and the count matches the button that was pressed.
 * The same words twice (a motion attached to gate and kept in the Library under "gate’s motion") are said once.
 */
export function savedList(things: readonly SavedThing[], total: number, t: T): string {
  const words: string[] = [];
  for (const th of things) {
    const w = th.kind === 'moved' ? t('save.moved', { name: th.name }) : th.name;
    if (w && !words.includes(w)) words.push(w);
  }
  if (!words.length) return t('save.changes', { n: Math.max(1, total) });
  const shown = words.slice(0, RECEIPT_NAMES);
  // What is left: the names cut here, and the changes that had no name (never fewer than the names cut).
  const rest = Math.max(words.length - shown.length, total - shown.length);
  return rest > 0 ? [...shown, t('save.more', { n: rest })].join(' · ') : shown.join(' · ');
}

/** What the line says for a Save, by the AI's phase (ai-flow.ts). null = the editor's usual words for that phase. */
export interface Receipt {
  head: string;
  sub: string;
  /** "In the game": the ▶ Play button at the end of the line (not while already playing). */
  play?: boolean;
}

export interface ReceiptInput {
  /** ai-flow.ts phase. */
  phase: string;
  things: readonly SavedThing[];
  total: number;
  /** aiVars() of main.ts ({ai}, {Ai}…), so the line names the person's AI. */
  vars: Record<string, string>;
  t: T;
}

export function receipt(i: ReceiptInput): Receipt | null {
  const { t, vars } = i;
  const kept = t('save.kept', { list: savedList(i.things, i.total, t) });
  switch (i.phase) {
    case 'seen':
    case 'sent':
    case 'received':
    case 'working':
    case 'updating':
      // The AI has it (or the heartbeat says it will within seconds): what was kept, and what it is doing with it.
      return { head: kept, sub: t('save.putting', vars) };
    case 'away':
    case 'nudge':
      // Nobody can pick it up now: the fact. What was kept stays under it (proof the Save happened).
      return { head: t('save.later', vars), sub: savedList(i.things, i.total, t) };
    case 'done':
      // The count is what the person saved (Save · N), not the AI's own count of changed objects: "the 3 I saved are in".
      return { head: t('save.in', { n: Math.max(1, i.total) }), sub: '', play: true };
    default:
      return null;
  }
}
