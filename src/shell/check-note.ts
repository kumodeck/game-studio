// Which self-check line the top of the list shows (studio-blank-level, 2026-10-23). Pure, so it is unit-tested
// (test/check-note.test.ts); main.ts renderStatus draws it.
//
// WHY: on NEON DASH (a runner whose code moves its road pieces, pillars and orbs every frame) a hands-on try showed
// "Moving things may not show in this game yet. Your AI has the details." over the levels' "New level" — "I don't
// know what that means". The self-check (bridge/selfcheck.ts) moves ONE object a little and looks at the picture. When
// that object is one the game itself puts back every frame (held 'game', found a moment later by bridge/observe.ts),
// or the sky / road (a 0.5 m move of a sky dome draws the same picture), the "failure" is the game's, not the editor's
// connection, and the editor already says it where it matters: the tool strip's note on that object ("the game moves
// this"). A sample that is no longer listed (deleted, hidden by a blank level) says nothing either. So those moving
// checks are not shown to the person; the AI still gets every check (host.reportCheck → .studio/check.md).
// A real fault (an AI-written 2D adapter whose set() writes a copy) still shows the line, on an object the game leaves alone.
import type { Item, SelfCheckId, SelfCheckResult } from '../contract.ts';

/** The checks that move the sample and read it back (bridge/selfcheck.ts MOVING_CHECKS). */
const MOVING = new Set<SelfCheckId>(['pose-roundtrip', 'screen-changes', 'anchor-follows', 'restored']);

/**
 * The failed check to show (its `check.<id>` line), or null = no line. `items` = the world's list now. `blank` = a New
 * level is on screen (studio-fix-0146, 2026-10-24): it hides everything but the ground, so "Nothing in this game can be
 * selected yet" (has-objects) is the level being empty, not the game — on Lantern Cove, whose sea is not listed, the
 * blank Level 2 said it over the Library's "Not in this level". Not shown then.
 */
export function checkNoteId(check: SelfCheckResult | null, items: readonly Pick<Item, 'key' | 'held' | 'backdrop'>[], blank = false): SelfCheckId | null {
  if (!check || check.ok) return null;
  const failed = check.checks.filter((c) => !c.ok && !c.skipped && !(blank && c.id === 'has-objects'));
  const it = check.sample ? items.find((i) => i.key === check.sample) : undefined;
  // The game moves it, it is the ground / sky, or it is gone from the list: the move test says nothing about the editor.
  const gameOwn = !!check.sample && items.length > 0 && (!it || it.held === 'game' || it.held === 'ground' || !!it.backdrop);
  const shown = gameOwn ? failed.filter((c) => !MOVING.has(c.id)) : failed;
  return shown[0]?.id ?? null;
}
