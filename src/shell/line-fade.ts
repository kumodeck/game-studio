// The AI's finished line goes by itself (2026-10-20: "this line is always there, it's in the way" — the line "● Moved the pillar to the
// middle of the road (in the game) / 1 thing changed" stayed over the game until the next request).
//
// What fades: a line that only REPORTS (done, undone, redone in the editor; "fixed" over the game while playing).
// What stays: a line that needs the person — the AI's question (asking), a failure (failed: they have to decide what
// to do next, and the reason is the one thing to read twice), and every "on it" phase (sent, seen, working…: the
// person is waiting for it, and it is the only sign that something is happening).
//
// How long: long enough to read it twice, no longer. A report is read once when it appears and once more when the
// person looks back from the game to check it; ~250 ms a word is a slow reading pace, so 5 s covers the short ones
// ("Done." / "1 thing changed"), and the AI's own sentence gets a little more per character up to 10 s (longer than
// that is no longer a report, it is a fixture). While the pointer is over the line or the keyboard is in it, it never
// goes; after it leaves, LINE_GRACE_MS more so it does not vanish the moment the mouse slides off.
//
// Pure, so test/line-fade.test.ts reads the rules without a browser; main.ts (the editor) and bridge/play-ask.ts (over
// the game) run the timers.
import type { AiPhase } from './ai-flow.ts';

/** The shortest a finished line stays (ms): "Done." read twice. */
export const LINE_MIN_MS = 5000;
/** The longest (ms): a long reply from the AI. */
export const LINE_MAX_MS = 10_000;
/** Extra time per character of the line's text (ms): ~20 characters a second, a calm pace in English and in Japanese. */
export const LINE_PER_CHAR_MS = 50;
/** After the pointer / focus leaves the line (ms). */
export const LINE_GRACE_MS = 2000;
/** The fade itself (ms; shell.css and bridge/play-ask.ts use the same). */
export const LINE_FADE_MS = 400;

/** Phases whose line goes by itself. Everything else stays as long as it is true. */
export function lineFades(ph: AiPhase): boolean {
  return ph === 'done' || ph === 'undone' || ph === 'redone';
}

/** How long a finished line with this text stays (ms). */
export function lineStayMs(text: string): number {
  const n = [...(text || '')].length;
  return Math.max(LINE_MIN_MS, Math.min(LINE_MAX_MS, LINE_MIN_MS + Math.max(0, n - 20) * LINE_PER_CHAR_MS));
}

/**
 * What a finished line is about, so the same report that faded does not come back on the next poll (every 3 s the
 * line is drawn again) or after a save with nothing new: the phase, the AI's status time and its note. A new report
 * (another request done, Undo, Redo) has another key and shows again. `turn` counts the Undo / Redo presses, so
 * Undo → Redo → Undo shows "Back to before" again (same phase, same status, a new press).
 */
export function lineKey(ph: AiPhase, statusAt: string | number | undefined, note: string | undefined, turn = 0): string {
  return `${ph}|${statusAt ?? ''}|${note ?? ''}|${turn}`;
}
