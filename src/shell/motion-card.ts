// The card's Motion row (motion-gui → studio-timeline → studio-motion-triggers → studio-motion-flow, 2026-10-22 →
// studio-card-doors, 2026-10-23: one line, only when the object has a motion — see motionCardRow).
//
// History — studio-motion-flow (a hands-on try of v0.1.18, 2026-10-22: "I couldn't tell how to make a motion and then put it on objects"): the row
// had one menu ("None ▾") and ◆ Timeline whatever the object had, so an object with no motion showed no way in. Now:
//   no motion yet  →  [+ New motion]  [From Library ▾]        the two ways in, side by side (the second only when the
//                                                             Library has motions: no button that leads nowhere)
//   a motion       →  [Hop  ⌨ E · 3× ▾]  [◆ Timeline]         its name and when it plays; the ▾ is the menu it was
//                                                             (its other motions, attach more, take it off)
// "+ New motion" (the Library's tile says the same words) opens the timeline to make one on this object; an attach (either menu) opens the timeline on
// it with "When does it move?" open (timeline-wire show()). WHY no "when" menu of its own in the card: the timeline's
// second row has every "when" with its field (seconds, key, area, cue…); a second, smaller copy here would drift.
// Split out of timeline-wire.ts (970 lines) with this change; it only reads the timeline's state through `MotionCardDeps`.
import type { LibraryMotion, MotionClip } from '../contract.ts';
import type { MenuEntry } from './context-menu.ts';
import { h } from './dom.ts';
import { icon, setButton } from './icons.ts';

export interface MotionCardDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  /** This object's motions (resolved: each with its Library motion's len / repeat / keys). */
  clips(): MotionClip[];
  /** The one the timeline shows for it. */
  shown(): MotionClip | null;
  /** The Library's motions. */
  library(): LibraryMotion[];
  /** More can be attached (an object holds at most MAX_CLIPS). */
  room(): boolean;
  /** The timeline is open. */
  open(): boolean;
  /** Show another of its motions on the timeline. */
  choose(name: string): void;
  attach(name: string): void;
  detach(name: string): void;
  /** "+ New motion": the timeline opens with a new motion on this object. */
  make(): void;
  /** ◆ Timeline: open / fold it on this object. */
  toggle(): void;
  /** studio-motion-panel: "✦ Ask your AI about it…" — the chat box gets the "object · motion" chip. Absent = no AI here. */
  ask?(): void;
  /**
   * studio-motion-delete (2026-10-24): the row's own menu — right-click on it, or its ⋯ at the right end. Opened under
   * `at` (the ⋯) or at the pointer. Absent (a build without the context menu) = no ⋯ and no right-click here.
   */
  menu?(at: HTMLElement | { x: number; y: number }, entries: MenuEntry[]): void;
  /** Delete the Library motion: it comes off every object (timeline-wire deleteLib, one undo step). */
  remove?(name: string): void;
  /** How many objects in this level have the Library motion `name` on them (this one too). */
  usedBy?(name: string): number;
  /** A one-line notice (the ask bar's toast). */
  say?(text: string): void;
  /** The Undo key as this system spells it ("⌘Z" / "Ctrl+Z"), for the "⌘Z brings it back" line. */
  undoKey?: string;
  /**
   * studio-code-knobs (2026-10-24): the Library motion `name` is a rule motion (the game's codeMotion) — the row says its
   * name with the tag "Rule" (`ruleTag`, its tooltip `ruleTip`). Absent = never.
   */
  isRule?(name: string): boolean;
  ruleTag?: string;
  ruleTip?: string;
  /**
   * ✦ Turn into a rule… (studio-code-torule, 2026-10-24; need 3, the plan's picture n3-motion): the menu's row on a motion
   * of points — the chat box gets the "object · motion" chip and the draft "Turn into a close rule" (nothing sent).
   * Absent = no AI here: no row.
   */
  toRule?(clip: MotionClip): void;
}

export function motionCardRow(d: MotionCardDeps): HTMLElement[] {
  // studio-card-doors (2026-10-23, a hands-on try: "I couldn't tell how to make a motion and then put it on objects";
  // "it's all over the place"): the card was a second way in — "+ Make a motion", "Use a saved motion ▾" and
  // "◆ Timeline", cut to "Use a sa…" / "Motion ▶ S…" on a 272 px card — beside the strip's Motion button. One way in
  // now (the plan's rule, docs 02-map): the strip's Motion. The card only SAYS what the object has, in one row —
  // "Motion  ship’s motion ›" (fix-0140: the name only, see below) — and a press on it opens the motion's timeline below the game.
  // No motion = no row at all (an empty "Motion: none" row would be one more thing to read and nothing to do there).
  // Its other motions, attach / take off and "Ask AI about it" are the timeline's (its ⋯ Fine-tune and the strip's
  // menu): the MotionCardDeps keep those for the timeline-wire caller, the card no longer uses them.
  const cs = d.clips();
  const c = d.shown() ?? cs[0];
  if (!c) return [];
  const label = h('span', { class: 'f-l', text: d.t('motion.label') });
  // fix-0140 (J1 of the first-run check, 2026-10-23 — the same kind as a hands-on try's "I can't read anything in this
  // UI"): the row was "lighthouse's motion · When game starts", and on a 1280 card it ended "lighthouse's motion ·
  // When …" (cut the same way in Japanese). The row now says only the motion's name; WHEN it plays is the
  // timeline's one-line sentence below the game (one place for it — a second, shorter copy here was the cut one).
  // whenOf / whenShort stay out of the card on purpose: don't add "when" back here, widen the timeline's line instead.
  const more = cs.length > 1 ? ` +${cs.length - 1}` : '';
  const open = d.open();
  const btn = h('button', { type: 'button', class: `motion-line${open ? ' on' : ''}`, 'aria-pressed': String(open), title: d.t('tl.openTip'), dataset: { action: 'timeline', part: 'motion-timeline-line' },
    onclick: () => (open ? undefined : d.toggle()) },
  h('span', { class: 'motion-line-text', text: `${c.name}${more}` }),
  // A rule motion (studio-code-knobs): "Spiral [Rule]" — its shape is the game's rule, its numbers are on the timeline.
  d.isRule?.(c.use ?? c.name) && d.ruleTag ? h('span', { class: 'pill rule-tag', title: d.ruleTip, text: d.ruleTag }) : null,
  icon('chevronRight'));
  const row = h('div', { class: 'f-cells motion-cells', dataset: { part: 'motion-row' } }, btn);
  if (d.menu) {
    // studio-motion-delete (a request, 10/24: "is there a way to delete a motion?" — the answer was two places deep: the
    // timeline's ⋯ Fine-tune → Motion → "Remove from this object", and the Library's motion → Delete). The row the card
    // already has gets both, where the object is: a right-click on the row (as everywhere else in the editor) and a ⋯ at
    // its right end (the same ⋯ as the card's head — for a trackpad without a right-click, and so it can be seen).
    // It acts on the motion the row names (the shown one; "+1" others stay — pick another on the timeline for those).
    // WHY a menu and not two buttons in the row: the row is one line on a 272 px card and already cuts long names.
    const more = h('button', { type: 'button', class: 'icon-btn motion-more', dataset: { action: 'motion-more', part: 'motion-more' }, 'aria-haspopup': 'menu',
      onclick: () => d.menu!(more, motionMenu(d, c, more)) });
    // Its name is what it holds (the card head's ⋯ does the same: no "More" word, glossary).
    setButton(more, 'more', motionMenu(d, c, more).filter((e): e is { id: string; label: string; run(): void } => 'label' in e).map((e) => e.label).join(' · '), false);
    row.append(more);
    // main.ts's document listener (capture, runs first) only stops the browser's own menu for this row
    // ([data-part="motion-row"]) and opens nothing; this one opens the motion's.
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const keyboard = !e.clientX && !e.clientY;
      const r = row.getBoundingClientRect();
      const at = keyboard ? { x: r.left + 12, y: r.bottom } : { x: e.clientX, y: e.clientY };
      d.menu!(at, motionMenu(d, c, at));
    });
  }
  return [label, row];
}

/**
 * The Motion row's menu (studio-motion-delete, 2026-10-24). Two rows, the glossary's two words (04-words: Remove from / Delete):
 *   Remove from this object   — this object only; the motion stays in the Library (and on the other objects)
 *   Delete motion  (red)      — the Library's motion goes: it comes off every object that has it
 * Both one undo step (⌘Z). Delete asks first only when it would take the motion off OTHER objects too ("It also comes
 * off 2 other objects" + Delete again, in the same menu plate — Esc / a press outside is "no"); on this object alone it
 * just goes and the ask bar says "⌘Z brings it back" (a question every time would teach people to press through it).
 * A motion of this object only (no Library motion behind it: `use` missing, an old file) has only "Remove".
 */
export function motionMenu(d: MotionCardDeps, c: MotionClip, at: HTMLElement | { x: number; y: number }): MenuEntry[] {
  const lib = c.use ?? c.name;
  const inLib = !!d.remove && d.library().some((l) => l.name === lib);
  // ✦ Turn into a rule… first (the way on from here, as the plan's picture has it), then the two that take it away.
  // Only on points: a rule motion is a rule already ("Make editable points" is its way back to points).
  const toRule: MenuEntry[] = d.toRule && !d.isRule?.(lib) && (c.keys?.p?.length ?? 0) >= 2
    ? [{ id: 'motion-to-rule', label: d.t('toRule.motion'), ai: true, run: () => d.toRule!(c) }, { sep: true }] : [];
  const out: MenuEntry[] = [...toRule, { id: 'motion-detach', label: d.t('motion.menu.detach'), run: () => {
    d.detach(c.name);
    d.say?.(d.t('motion.removed', { name: c.name }));
  } }];
  if (!inLib) return out;
  const gone = () => {
    d.remove!(lib);
    d.say?.(d.t('motion.deleted', { name: lib, key: d.undoKey ?? '⌘Z' }));
  };
  out.push({ sep: true }, { id: 'motion-delete', label: d.t('motion.menu.delete'), danger: true, run: () => {
    const others = Math.max(0, (d.usedBy?.(lib) ?? 1) - 1);
    if (!others || !d.menu) return gone();
    // The ask, where this menu was (under the ⋯, or at the right-click's point): one sentence and the same red row.
    d.menu(at, [{ note: d.t(others === 1 ? 'motion.delete.other1' : 'motion.delete.others', { n: others }) }, { id: 'motion-delete-yes', label: d.t('motion.menu.delete'), danger: true, run: gone }]);
  } });
  return out;
}
