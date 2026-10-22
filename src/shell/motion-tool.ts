// The Motion button in the object's tool strip (studio-motion-tool, 2026-10-22). The strip itself is the game page's
// (bridge/handles.ts draws it, bridge/input.ts reports the press as placement/motion-press); this file decides what
// the button shows and what a press does, with the editor's own pieces — nothing new underneath:
//   no motion yet  →  a small menu at the button: New motion (Back and forth / Round / Once / Spin, timeline-model
//                     TEMPLATES) and From the Library (its motions). A choice puts it on the thing and opens the
//                     timeline with "✓ attached · When does it move?" (timeline-wire show(), as a drop does since v0.1.19)
//   a motion       →  the timeline opens on it. The button wears a small dot ("this thing moves").
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
// WHY no "Empty" row: an empty motion has no keys and nothing moves until the person moves the thing on the timeline —
// the card's "+ New motion" is that way in. The strip's menu is the quick way: pick a kind, it moves at once.
import type { LibraryMotion, ShellToBridge } from '../contract.ts';
import type { MenuEntry, OpenOptions } from './context-menu.ts';
import type { Template } from './timeline-model.ts';

/** The menu's kinds, in the timeline's order (its clip menu's "New: …"), without "empty" (see the header). */
export const STRIP_TEMPLATES: Template[] = ['pingpong', 'loop', 'once', 'spin'];

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
  /** A new motion from a template on `key`, shown with "When does it move?" open (timeline-wire makeFrom). */
  make(key: string, kind: Template): void;
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

  /** The rows of the menu for `key` (no motion yet): the kinds, then the Library's motions when it has any. */
  function entries(key: string): MenuEntry[] {
    const out: MenuEntry[] = [{ head: d.t('motion.tool.new') }];
    for (const kind of STRIP_TEMPLATES) out.push({ id: `motion-new-${kind}`, label: d.t(`tl.tpl.${kind}`), run: () => d.make(key, kind) });
    const lib = d.library();
    if (lib.length && d.room(key)) {
      out.push({ sep: true }, { head: d.t('motion.tool.lib') });
      for (const m of lib) out.push({ id: `motion-lib-${m.name}`, label: m.name, key: `${Math.round(m.len * 10) / 10} s`, run: () => d.attach(key, m.name) });
    }
    return out;
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
    d.menu(entries(key), x, y, { place: 'motion', touch, keyboard, label: d.t('motion.tool.menu') }, btn);
    sync();
  }

  /**
   * A new game page (a reload, back from Play, another level): it starts with the button hidden, so the next sync must
   * send even if nothing changed here (the first test run caught it: the button missing after the page came up again).
   */
  function reset() {
    sent = '';
  }

  return { sync, press, reset, entries, label, words, state, target: () => d.target() };
}
