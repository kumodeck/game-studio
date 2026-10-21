// The bottom sheet folded to one row (a phone, the side window next to a chat). A try of v0.1.7 in the Claude app's side
// window on 2026-10-21, with an AI-made NEON ORB and eleven tiles picked: "it's too hard to use from the Claude sidebar
// — the bottom menu has to be able to be minimised". The list sheet, the picked objects' card and the AI's line took
// the lower half of the window, and the grip at the sheet's top only switched between a low and a tall sheet, which
// nobody found.
//
// Folded = only the ask bar stays: ▴ at its left, then what is picked ("×11" / the short name) and the field to ask the
// AI. The game is seen over the rest (≥ 80 % of a 400×900 side window, test/studio-side-sheet). One press folds —
// the grip (a click, or dragged down), or ▾ at the bar's left — and one press on ▴ opens the list (and the card) again.
// (The card's own ▾, placement-panel.ts, 2026-10-20, stays: it shrinks the card to its name and leaves the list up.)
// Nothing opens it by itself: a pick, the AI's answer, Save keep it folded (the AI's news is a dot on ▴, its
// running light stays on the bar). Opening a page in the sheet (Look, Ideas, the Library, the Scene) is a person's
// own press, and unfolds.
//
// Kept in this browser (localStorage), as the card's own minimize is (placement-panel.ts MIN_KEY): a habit of the
// hand, not of the game, so it does not go in the game's .studio/ui.json. PC (a wide window) has no fold: its list is
// a column beside the game, not a sheet over it.

/** localStorage key: '1' = folded. */
export const FOLD_KEY = 'studio.sheetFold';

type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

/** Folded last time? Storage can be missing or throw (a private window, blocked site data): then not folded. */
export function readFold(store: Store): boolean {
  try {
    return store?.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeFold(store: Store, on: boolean): void {
  try {
    store?.setItem(FOLD_KEY, on ? '1' : '0');
  } catch {
    /* no storage: this page only */
  }
}

/**
 * What the bar's left button does: ▴ unfolds; ▾ (the list or the card up) folds — the whole of it, list, card and AI line,
 * not only the list as before 2026-10-21 (that left the card and its "Deselect" row standing over half the game); the
 * list icon (nothing up) opens the list. Two states for the hand, open and folded: ▴ always opens the list (with the
 * card, if something is picked), so the list is never more than one press away.
 */
export function barPress(s: { fold: boolean; open: boolean }): 'unfold' | 'fold' | 'open' {
  if (s.fold) return 'unfold';
  return s.open ? 'fold' : 'open';
}

/**
 * The grip let go. A press without a move folds. Dragged: further down than the low sheet goes (CSS holds the sheet
 * there, so the drag's own height reads lower than the sheet) by FOLD_DRAG px or more folds; otherwise the height
 * stays where it was dragged (tall), or the low sheet again when it ended there.
 *   fromH: the sheet's height at the press; dy: how far up the pointer went (negative = down);
 *   nowH: the sheet's height now (CSS-clamped).
 */
export const FOLD_DRAG = 32; // px below the low sheet: a deliberate pull down, not a hand that slipped on the way up
export function gripEnd(g: { moved: boolean; fromH: number; dy: number; nowH: number }): 'fold' | 'low' | 'tall' {
  if (!g.moved) return 'fold';
  if (g.fromH + g.dy <= g.nowH - FOLD_DRAG) return 'fold';
  // CSS held the sheet above where the drag asked for: it ended at the low sheet.
  return g.nowH > g.fromH + g.dy + 2 ? 'low' : 'tall';
}
