// "Ask your AI" about a motion, in the chat box (studio-motion-panel, 2026-10-22).
//
// A review of 2026-10-22, on the timeline's strip ("Starts [In my words…] [When? (for your AI)]"): "For files, asking the AI has
// its own UI and that is good; for motions this screen is hard to follow. A press that puts the motion's name and the
// object's name in the AI chat box, and you talk there, seems clear." So every "Ask AI" on a motion — the strip's ✦,
// the card's Motion ▾, right-click — ends here: the motion is remembered, the chat box's chip reads "crate · Hop" (the
// same chip the Library's "Ask your AI…" gives a file or a motion), and the words sent go with that motion (`motions`
// of the request, as a Library pick does).
//
// It lasts while it is still what the person is looking at: the same object picked, the plate (and card) showing that
// motion. Pick something else, or switch the plate to another motion, and it is gone — the chip never names a motion
// the screen does not show. After a send it stays, so "slower" can follow "start when the player walks up".
// Pure (no DOM), so test/motion-ask.test.ts reads the rule without a browser.

export interface MotionAskDeps {
  /** The one picked object (null with none or several, or outside the world layer). */
  picked(): string | null;
  /** The motion `key` shows now, by its name on screen (timeline-wire shownName). */
  shown(key: string): string | null;
}

export interface MotionAskAt {
  key: string;
  /** The clip's name on screen ("Hop", "Motion 3"): the chip's words. */
  name: string;
  /** Its Library motion (what the request names: the AI finds it in placement.json's `motions`). */
  use: string;
}

export function createMotionAsk(d: MotionAskDeps) {
  let at: MotionAskAt | null = null;
  return {
    set(key: string, m: { name: string; use: string }) {
      at = { key, name: m.name, use: m.use };
    },
    /** The motion the chat box is about now, or null (and forgotten) once the screen moved on. */
    now(): MotionAskAt | null {
      if (at && (d.picked() !== at.key || d.shown(at.key) !== at.name)) at = null;
      return at;
    },
    clear() {
      at = null;
    },
  };
}
