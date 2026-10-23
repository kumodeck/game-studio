// The Motion button in the object's tool strip (studio-motion-tool, 2026-10-22). The strip itself is the game page's
// (bridge/handles.ts draws it, bridge/input.ts reports the press as placement/motion-press); this file decides what
// the button shows and what a press does, with the editor's own pieces — nothing new underneath:
//   no motion yet  →  a small menu at the button, two rows under "No motion yet":
//                       Make a motion           → the timeline opens on it at 1 s, where it stands now being 0 s: one
//                                                 line says "drag it where it should move (Esc to cancel)"; the drag
//                                                 is the 1 s key, it plays, and each next move adds a second
//                                                 (timeline-wire make(), studio-no-presets 2026-10-23)
//                       Use a saved motion      → the same menu again with the Library's motions (only when it has
//                                                 some); a choice puts it on the thing, "✓ attached · When?" open
//   a motion       →  the timeline opens on it. The button wears a small dot ("this thing moves").
//
// studio-tool-clear (2026-10-23): until then a press listed kinds first — "New motion: Back and forth / Round / Once /
// Spin" — and a hands-on try on a neon runner: "this makes no sense at all". The day before, motion had been
// made a timeline with keys (Unity / Blender), and a list of kinds is the opposite: two keys the person never placed,
// "Round" and "Once" being repeat settings, not motions. The kinds are gone from the strip (the design review: drop
// them, the repeat lives in the timeline's ⋯); the one way in is "move it on the timeline".
// studio-no-presets (2026-10-23): a review, on the kinds still in the timeline's own menu and the words: "what is
// this? presets?" — and to keeping only the two ways in: "we don't need them" (no kinds anywhere now).
//
// WHY (a review of the strip, 2026-10-22: "wouldn't a motion button go well here?"): v0.1.19 attaches a motion by
// dragging it from the Library onto the thing, and the card has "+ New motion" — but with the thing picked in the game,
// the one control next to it (the strip) had no way in. Before that (v0.1.18): "I couldn't tell how to make a motion and
// then put it on objects."
//
// WHY the editor's menu (context-menu.ts) and not choices drawn in the game page like the turn button's: the Library
// motions are names (words, any number of them), and the game page has only icon rows. The context menu already has
// the glass, the keys, Esc, a finger's size and "a press outside only closes it".
//
import type { LibraryMotion, ShellToBridge } from '../contract.ts';
import type { MenuEntry, OpenOptions } from './context-menu.ts';

export interface MotionToolDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  send(m: ShellToBridge): void;
  /** The one picked thing that can have a motion now (editing a 3D game's world, one world object), else null. */
  target(): string | null;
  /** Its motions' names (the first = the one the timeline shows for it). */
  motions(key: string): string[];
  /** The Library's motions. */
  library(): LibraryMotion[];
  /** More can go on it (an object holds at most MAX_CLIPS). */
  room(key: string): boolean;
  /** The key that opens it ("A"), already spelled for this system; '' = none. */
  keyText(): string;
  /** The timeline open on `key` to make its first motion: its pose now is 0 s, the time line at 1 s (timeline-wire make). */
  make(key: string): void;
  /** Put a Library motion on `key` and show it the same way (main.ts attachAndShow). */
  attach(key: string, name: string): void;
  /** The timeline open on `key`'s motion `name`. */
  open(key: string, name: string): void;
  /** The editor's menu (context-menu.ts): open at a point of the editor page; `place` = 'motion'. */
  menu(entries: MenuEntry[], x: number, y: number, o: OpenOptions, avoid: DOMRect | null): void;
  /** Is the editor's menu open on this place now. */
  menuOpen(): boolean;
  /** The game's frame: the press comes in its own px. */
  frame(): HTMLIFrameElement | null;
}

export function createMotionTool(d: MotionToolDeps) {
  // What the game page was last told (a frame that changes nothing sends nothing).
  let sent = '';

  /** What it does, in words: "Motion — make one or attach one", or "Motion: Hop — open on the timeline" (⌘K's row too). */
  function words(key = d.target()): string {
    const names = key ? d.motions(key) : [];
    return names.length ? d.t('pal.tool.motionHas', { name: names[0]! }) : d.t('pal.tool.motion');
  }
  /** The tooltip: the words and the key, two spaces apart (keymap.ts tipText's way, as the tools' tooltips). */
  function label(key = d.target()): string {
    const k = d.keyText();
    return k ? `${words(key)}  ${k}` : words(key);
  }
  /** What the button shows now. */
  function state() {
    const key = d.target();
    return { show: !!key, has: !!key && d.motions(key).length > 0, label: label(key), open: !!key && d.menuOpen() };
  }

  /** Tell the game page what the button shows now (after a pick, an attach, an undo, a layer switch…). */
  function sync() {
    const m = { type: 'studio:placement/motion' as const, ...state() };
    const sig = JSON.stringify(m);
    if (sig === sent) return;
    sent = sig;
    d.send(m);
  }

  // Where the last menu opened (the second step, "Use a saved motion", opens in the same place).
  let last: { x: number; y: number; o: OpenOptions; btn: DOMRect | null } | null = null;
  /** The rows of the menu for `key` (no motion yet): what it is now, then make one / use a saved one. */
  function entries(key: string): MenuEntry[] {
    const out: MenuEntry[] = [{ note: d.t('motion.tool.none') }, { id: 'motion-make', label: d.t('motion.tool.make'), run: () => d.make(key) }];
    if (d.library().length && d.room(key)) out.push({ id: 'motion-lib', label: d.t('motion.tool.saved'), run: () => savedMenu(key) });
    return out;
  }
  /** The second step: the Library's motions, each with its length. */
  function libEntries(key: string): MenuEntry[] {
    const out: MenuEntry[] = [{ head: d.t('motion.tool.savedHead') }];
    for (const m of d.library()) out.push({ id: `motion-lib-${m.name}`, label: m.name, key: `${Math.round(m.len * 10) / 10} s`, run: () => d.attach(key, m.name) });
    return out;
  }
  function savedMenu(key: string) {
    if (!last || d.target() !== key) return;
    d.menu(libEntries(key), last.x, last.y, last.o, last.btn);
    sync();
  }

  /**
   * The button pressed (placement/motion-press) or its key typed in the editor page: open the motion, or the menu at
   * the button. `at` = the button in the game page's px (w 0 = not known: under the middle of the game).
   */
  function press(key: string, at: { x: number; y: number; w: number; h: number }, touch: boolean, keyboard: boolean) {
    if (d.target() !== key) return;
    const names = d.motions(key);
    if (names.length) {
      d.open(key, names[0]!);
      sync();
      return;
    }
    const f = d.frame()?.getBoundingClientRect();
    const fx = f?.left ?? 0, fy = f?.top ?? 0;
    const btn = at.w > 0 ? new DOMRect(fx + at.x, fy + at.y, at.w, at.h) : null;
    // A mouse: under the button from its left edge, as a menu button's menu. A finger: above the button, centred on it
    // (context-menu.ts puts a touch menu above the point, so the finger does not cover the rows). No button (a key with
    // the strip off screen): the game's middle.
    const x = btn ? (touch ? btn.left + btn.width / 2 : btn.left) : fx + (f?.width ?? 0) / 2;
    const y = btn ? (touch ? btn.top : btn.bottom + 6) : fy + (f?.height ?? 0) / 2;
    last = { x, y, o: { place: 'motion', touch, keyboard, label: d.t('motion.tool.menu') }, btn };
    d.menu(entries(key), x, y, last.o, btn);
    sync();
  }

  /**
   * A new game page (a reload, back from Play, another level): it starts with the button hidden, so the next sync must
   * send even if nothing changed here (the first test run caught it: the button missing after the page came up again).
   */
  function reset() {
    sent = '';
  }

  return { sync, press, reset, entries, libEntries, label, words, state, target: () => d.target() };
}
