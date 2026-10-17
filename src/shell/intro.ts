// The first-run intro: one line over the ask bar that says what to do next,
// four steps, then gone for good (2026-10-16, "first 5 minutes").
//
// WHY it grew out of the old one-line hint ("Click an object to pick it ·
// ⌘K for everything") instead of being a tour with arrows and a dimmed page:
// the person came to move things in their game, not to read about the editor.
// One quiet line in the place the news card already uses keeps the game in
// full view, never blocks a click, and has a close button. It only ever says
// the next thing, and it moves on the moment the person has done it (doing a
// later step first skips the earlier ones: it never asks you to go back).
//
// Where "seen" is kept: .studio/ui/prefs.json in the game folder (UiPrefs.intro),
// not the browser's storage. The server picks a free port every run, so the
// page's origin (and its localStorage) changes each time; and the editor's
// promise is that it only writes inside the game folder, so no file in the home
// folder either. The cost: a second game folder shows the intro once more —
// but only when that folder has never been edited (no placement.json, no
// prefs.json), see introStart().

export const INTRO_STEPS = ['pick', 'move', 'ask', 'save'] as const;
export type IntroStep = (typeof INTRO_STEPS)[number];
/** The step value that means "finished or closed": nothing is shown. */
export const INTRO_DONE = INTRO_STEPS.length;

/**
 * Where to start when the editor opens.
 * - `saved`: UiPrefs.intro from prefs.json (a step number; undefined = never seen).
 * - `usedBefore`: the folder already has placement.json or prefs.json, so the
 *   person has used the editor here before the intro existed: do not teach them.
 */
export function introStart(saved: number | undefined, usedBefore: boolean): number {
  if (typeof saved === 'number' && Number.isInteger(saved)) return Math.min(INTRO_DONE, Math.max(0, saved));
  return usedBefore ? INTRO_DONE : 0;
}

/** The person did `did`: the step after it, unless they are already further on. */
export function introAdvance(at: number, did: IntroStep): number {
  const i = INTRO_STEPS.indexOf(did);
  return i >= at ? i + 1 : at;
}

/** The step to show now (null = nothing to show). */
export function introStep(at: number): IntroStep | null {
  return at >= 0 && at < INTRO_DONE ? INTRO_STEPS[at]! : null;
}
