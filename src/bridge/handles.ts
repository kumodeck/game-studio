// What the editor draws on the game, inside the game page: the tool strip
// under the selected object, the outline round the selection, its name tag,
// the outlines of what the AI changed, stand-in copies and the box selection.
//
// WHY DOM (not drawn into the game's canvas): it must look and hit the same in
// every engine, stay crisp regardless of post-processing or fog, and be real
// elements for accessibility labels. It lives in a shadow root (open, so
// composedPath() can see which strip button was pressed) so the game's CSS
// cannot restyle it, and the root ignores pointer events except on the strip.
//
// Rebrand 2026-10-16 (the "one list, one card, one input" design). Before:
// four white discs with a ring in the job's colour (orange / yellow / grey)
// floating round the object, a blue box round it and blue boxes round each
// member of a group. They were the loudest thing on screen and used four
// colours. Now the editor has two colours with one meaning each:
//   ORANGE (#ff6b1a) = your hand: what you picked (outline, name tag);
//   VIOLET (#8b7cff) = the AI's hand: what its last change touched.
// Everything else on the game is the game's own colour. The four handles are
// one dark strip of 28 px buttons (44 on phones) right under the object; the
// object itself can be dragged to move it (input.ts).
//
// Tool modes (play test 10/16: "only move works by clicking and then
// dragging anywhere; the others need the button held while the mouse moves —
// not intuitive"). A press on a strip button now CHOOSES that tool, as in
// every design and 3D tool: it stays pressed (`setTool`) until another one is
// chosen, and a drag anywhere on the game does it (input.ts). A drag started
// on a button still works the old way (press and drag on it), so nothing a
// hand learnt stops working. While a drag works, a small readout next to the
// strip says what changed by how much ("Turn 32°", "Size ×1.40"), and the
// first time a tool is chosen one line at the bottom says how to look around.
//
// WHY an outline that follows the object's shape (adapter.silhouette) and not
// a box: a box is wider than the object and overlaps its neighbours, so "which
// one is picked?" was answered by guessing. Adapters that cannot draw objects
// alone get a rounded box (6 px corners, the radius of every control).
import { UI, type Anchor, type GroupScaleMode, type Inset, type Lang, type StripTool, type TurnAxis } from '../contract.ts';

export type HandleKind = StripTool;

/** The tools' keys (also in the tooltips and in ⌘K): the English initials, none taken by another single key (Q/E steps, R axis, F, P). */
export const TOOL_KEYS: Record<HandleKind, string> = { move: 'M', lift: 'H', rotate: 'T', scale: 'S' };
export const toolFromKey = (key: string): HandleKind | null =>
  (Object.keys(TOOL_KEYS) as HandleKind[]).find((k) => TOOL_KEYS[k] === key.toUpperCase()) ?? null;

export const HANDLE_LABELS: Record<Lang, Record<HandleKind, string>> = {
  en: { move: 'Move (M)', rotate: 'Turn (T)', lift: 'Height (H)', scale: 'Size (S)' },
  ja: { move: '移動（M）', rotate: '回す（T）', lift: '高さ（H）', scale: '大きさ（S）' },
};
/** The readout's words while a drag works (short: it sits next to the strip). */
export const READOUT_WORDS: Record<Lang, Record<HandleKind | 'tipX' | 'tipZ', string>> = {
  en: { move: 'Move', rotate: 'Turn', lift: 'Height', scale: 'Size', tipX: 'Tilt forward', tipZ: 'Tilt sideways' },
  ja: { move: '移動', rotate: '回す', lift: '高さ', scale: '大きさ', tipX: '前後に倒す', tipZ: '左右に倒す' },
};
/**
 * The one line shown the first time a tool is chosen (then never again on
 * this computer): what a drag does now and how to look around instead.
 * Mac 3D tools' habits: Option-drag orbits, right / middle drag pans, Space
 * held = the hand; on touch one finger is the tool, two fingers look.
 */
export const TOOL_HINT: Record<Lang, { mouse: (tool: string) => string; touch: (tool: string) => string }> = {
  en: { mouse: (t) => `Drag anywhere: ${t} · Look around: ⌥-drag, right-drag, or hold Space · Esc: no tool`, touch: (t) => `One finger: ${t} · Two fingers: look around` },
  ja: { mouse: (t) => `どこでも引く: ${t} ・ 見回す: ⌥ か右ボタンで引く、Space を押しながら ・ Esc: 道具をやめる`, touch: (t) => `1 本指: ${t} ・ 2 本指: 見回す` },
};
/**
 * Added to the turn tool's first-time line in 3D: where the tilts are. Was "Press Turn again to tilt" (polish pass
 * 2026-10-16); play test 2026-10-18: "nobody presses a button twice" — the tilts are behind the ▾ on the button now.
 */
export const TILT_HINT: Record<Lang, string> = {
  en: ' · Tilt: ▾ on Turn',
  ja: ' ・ 倒すのは「回す」の ▾ から',
};
/** The ▾'s tooltip and label (PC: hovering the button lights the ▾ and this says what it opens). */
export const MORE_LABELS: Record<Lang, Record<'axis' | 'scale', string>> = {
  en: { axis: 'Ways to turn', scale: 'Ways to resize' },
  ja: { axis: '回し方を選ぶ', scale: '大きさの変え方を選ぶ' },
};
/**
 * The choices behind strip buttons (2026-10-16): the turn button (3D, one
 * object) has "Turn / Tilt forward / Tilt sideways"; the size button with
 * several picked, "Together / Each in place". They open from the small ▾ in
 * the button's bottom-right corner, or a long press on the button (tool
 * options, play test 2026-10-18; before, a SECOND tap on the chosen button
 * opened them, which nobody finds — kept only as an unadvertised shortcut).
 * Big buttons with a picture and a short word, the long words as the tooltip.
 * The first of each is the default and wears the tool's own picture, so the
 * strip looks the same until another way is chosen; then the button wears
 * that way's picture (the menu's and the button's pictures always match).
 */
export const AXIS_WORDS: Record<Lang, Record<TurnAxis, [string, string]>> = {
  // Turn / Tilt, not Rotate / Tip (words pass 2026-10-17): the tool is Turn (key T), and "tip" and
  // "upright axis" read oddly to North American players (play test 2026-10-16).
  en: { y: ['Turn', 'Turn left or right (R: next axis)'], x: ['Tilt forward', 'Tilt forward or back (R: next axis)'], z: ['Tilt sideways', 'Tilt left or right (R: next axis)'] },
  ja: { y: ['横に回す', '縦の軸で横に回す（R で次の軸）'], x: ['前後に倒す', '前か後ろに倒す（R で次の軸）'], z: ['左右に倒す', '左か右に倒す（R で次の軸）'] },
};
export const SCALE_WORDS: Record<Lang, Record<GroupScaleMode, [string, string]>> = {
  en: { spread: ['Together', 'Everything grows, including the gaps, from each object’s base'], inplace: ['Each in place', 'Each one grows in its own spot; the gaps stay the same'] },
  ja: { spread: ['並びごと', '物どうしの間も一緒に広がる（足元が基準）'], inplace: ['その場で', 'それぞれが自分の足元で大きくなる（間はそのまま）'] },
};
type Choice = { kind: 'axis' | 'scale'; id: string };

/** The group tag ("3 selected"). */
export const MANY_LABEL: Record<Lang, (n: number) => string> = {
  en: (n) => `${n} selected`,
  ja: (n) => `${n} 個を選択`,
};

// Line icons (24×24 grid, stroke = currentColor), same rule as the shell's icons.
// The three turns, as the motion looks from in front: the turn tool's own
// arrow = turning on the spot (y, the default), an upright ellipse = tipping
// forward / back (x), a circle facing you = tipping sideways (z).
const AXIS_ICONS: Record<TurnAxis, string> = {
  // y = the turn tool's own picture (the default way; see AXIS_WORDS). Was a flat ellipse until 2026-10-18.
  y: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17.5 3.5v4h-4"/>',
  x: '<ellipse cx="12" cy="12" rx="3.5" ry="8"/><path d="M6.2 7.5 8.6 4l1.9 3.6"/><path d="M4 12h16" stroke-dasharray="2 2.5"/>',
  z: '<circle cx="12" cy="12" r="7.5"/><path d="M15.5 2.8 19 5.2l-3.6 1.9"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
};
const SCALE_ICONS: Record<GroupScaleMode, string> = {
  // spread = the size tool's own picture (the default way). Was two boxes with arrows apart until 2026-10-18.
  spread: '<path d="M5 19 19 5M13.5 5H19v5.5M5 13.5V19h5.5"/>',
  inplace: '<rect x="4" y="12" width="5" height="6" rx="1"/><rect x="13" y="8" width="7" height="10" rx="1"/><path d="M3 21h18"/><path d="M16.5 2.5v3.5M14.8 4.2l1.7-1.7 1.7 1.7"/>',
};

const ICONS: Record<HandleKind, string> = {
  move: '<path d="M12 4v16M4 12h16M9.5 6.5 12 4l2.5 2.5M9.5 17.5 12 20l2.5-2.5M6.5 9.5 4 12l2.5 2.5M17.5 9.5 20 12l-2.5 2.5"/>',
  rotate: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17.5 3.5v4h-4"/>',
  lift: '<path d="M12 4v16M8.5 7.5 12 4l3.5 3.5M8.5 16.5 12 20l3.5-3.5"/>',
  scale: '<path d="M5 19 19 5M13.5 5H19v5.5M5 13.5V19h5.5"/>',
};

export interface Outline {
  /** Viewport CSS px the mask covers. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Alpha = the objects' coverage (adapter.silhouette). */
  mask: HTMLCanvasElement;
}
type Rect = { x: number; y: number; w: number; h: number };

export interface Handles {
  place(a: Anchor | null, caps: { rotatable: boolean; scalable: boolean; movable?: boolean; liftable?: boolean } | null, dim: '2d' | '3d'): void;
  /** Strip button size in px (the person's UI preference; default UI.handlePx). */
  setSize(px: number): void;
  /** Viewport px covered by the shell's floating panels: the strip stays clear of them. */
  setInset(inset: Inset): void;
  /** The shell's theme: the strip follows it (light plate on a light editor). */
  setTheme(theme: 'dark' | 'light'): void;
  /** The button being pressed and dragged right now (or null). */
  setActive(kind: HandleKind | null): void;
  /** The chosen tool: its button stays pressed (null = none; dragging the picked object still moves it). */
  setTool(kind: HandleKind | null): void;
  /** What the drag changed, next to the strip ("Turn 32°"), or null to hide. */
  readout(text: string | null): void;
  /** The one line at the bottom of the game (the first time a tool is chosen), or null. */
  hint(text: string | null): void;
  setLabels(labels: Record<HandleKind, string>): void;
  /**
   * The selection's outline: the shape when the adapter gave one, else one
   * rounded box per rect. `tag` = the name tag over it (null = none).
   */
  selection(shape: Outline | null, rects: Rect[], tag: string | null): void;
  /** What the AI's last change touched: same kind of outline, violet, one tag. */
  ai(shape: Outline | null, rects: Rect[], tag: string | null): void;
  /**
   * Stand-in copies (adapters without clone(), CONTRACT.md §1.8): a
   * see-through picture of the original at each copy's place. `src` is a
   * data:image/png URL (or null: a dashed box only), `rot` extra turn in
   * radians (clockwise), `w`/`h` the picture size, centred on (cx, cy).
   */
  ghosts(list: Array<{ key: string; cx: number; cy: number; w: number; h: number; rot: number; src: string | null }>): void;
  /** The rubber band of a box selection, or null. */
  box(r: Rect | null): void;
  /** The turn button draws the axis it uses. */
  setAxis(axis: TurnAxis, lang: Lang): void;
  /** The size button draws the way several objects resize (only while several are picked: `setOptions`). */
  setScaleMode(mode: GroupScaleMode): void;
  /** Which buttons have choices now: they show the ▾ (3D turn with one picked; size with several). */
  setOptions(opts: { axis: boolean; scale: boolean }, lang: Lang): void;
  /**
   * The choices over the strip: 'axis' (3D turn), 'scale' (several picked),
   * or null to close. `current` is the chosen one.
   */
  menu(kind: 'axis' | 'scale' | null, current: string, lang: Lang): void;
  menuOpen(): 'axis' | 'scale' | null;
  destroy(): void;
}

/** Your hand and the AI's hand. Kept in step with --you / --ai in shell.css (fixed: they sit on the game, not on the shell's theme). */
const YOU = '#ff6b1a';
const AI = '#8b7cff';
/** Gap between the object and the strip (px): 12 = the review's number (wave 1, W1-2 / M4, 2026-10-17); was 10. */
const GAP = 12;
const CSS = `
:host { all: initial; }
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
/* The strip: the shell's one glass (shell.css rule 1) — frosted, so the game shows through and the strip
   belongs to it. Corners nest: buttons 8, 4 in, so the plate is 12. */
.row { position: absolute; display: none; gap: 2px; padding: 4px; border-radius: 12px; transform: translateX(-50%);
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); }
button { position: relative; pointer-events: auto; width: var(--h, ${UI.handlePx}px); height: var(--h, ${UI.handlePx}px); border-radius: 8px; border: 0;
  background: transparent; color: #a1a1a6; display: grid; place-items: center; padding: 0; cursor: grab;
  transition: background-color .16s cubic-bezier(.2,.8,.2,1), color .16s cubic-bezier(.2,.8,.2,1); touch-action: none; -webkit-tap-highlight-color: transparent; }
button:hover { color: #f5f5f7; background: rgba(255,255,255,.07); }
/* No tool chosen: move is what dragging the object does, shown lightly as "the one at rest". A chosen tool is .on (ink). */
button.rest { color: #f5f5f7; background: rgba(255,255,255,.12); }
button:active, button.on { color: #1c1c1e; background: #f5f5f7; cursor: grabbing; transition-duration: 0s; }
button:focus-visible { outline: 2px solid ${YOU}; outline-offset: 1px; }
button[hidden] { display: none; }
/* Touch: past 44 px for the finger, whatever the drawn size. */
@media (pointer: coarse) { button::after { content: ""; position: absolute; inset: -2px; } }
svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6px; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.big svg { width: 20px; height: 20px; }
svg * { vector-effect: non-scaling-stroke; }
/* Outlines: a canvas per shape, a rounded box when there is no shape. */
.ol { position: absolute; pointer-events: none; }
.box { position: absolute; border: 1.5px solid var(--c); border-radius: 6px; box-sizing: border-box; pointer-events: none; }
/* Name tags: the only filled colour on the game (your hand / the AI's hand), round-ended so they read as labels. */
.tag { position: absolute; display: none; height: 22px; padding: 0 9px; border-radius: 999px; align-items: center; gap: 4px; color: #fff; white-space: nowrap; font-weight: 600;
  transform: translate(-50%, -100%); box-shadow: 0 1px 2px rgba(0,0,0,.2), 0 4px 12px rgba(0,0,0,.18); max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
.tag.you { background: ${YOU}; }
.tag.ai { background: ${AI}; }
/* Stand-in copy: see-through picture of the original, dashed edge ("dashed = not real yet"). */
.ghost { position: absolute; opacity: .6; outline: 1.5px dashed rgba(255,255,255,.9); border-radius: 4px; pointer-events: none; background-size: 100% 100%; }
.band { position: absolute; border: 1px solid ${YOU}; border-radius: 2px; background: rgba(255,107,26,.1); display: none; pointer-events: none; }
/* The choices over the strip: big buttons, a picture over a short word. */
.menu { position: absolute; display: none; gap: 2px; padding: 6px; border-radius: 18px; transform: translateX(-50%);
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); animation: rise .24s cubic-bezier(.2,.8,.2,1); }
@keyframes rise { from { opacity: 0; transform: translateX(-50%) translateY(6px) scale(.985); } }
.menu button { width: auto; min-width: 76px; height: auto; padding: 8px 10px 6px; display: grid; gap: 4px; justify-items: center; cursor: pointer;
  font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; color: #a1a1a6; border-radius: 12px; }
.menu button svg { width: 24px; height: 24px; }
/* The chosen way: ink, not orange (orange is the picked object, on the game). */
.menu button.chosen { color: #1c1c1e; background: #f5f5f7; box-shadow: none; }
@media (pointer: coarse) { .menu button { min-width: 88px; min-height: 64px; } }
/* The ▾ (tool options, play test 2026-10-18): "this button has choices", in the button's bottom-right corner, inside
   it — so the strip is not one px taller or wider and does not move when it appears (W1-2). The mark is 7×4 in the
   button's own colour, faint at rest, full on hover (PC: the hover says "there is more here"); its press area is the
   corner, 12 px on the mouse strip and 20 px on the finger strip (a quarter of a 44 button; the rest of the button
   still chooses the tool). A long press anywhere on the button opens the same choices. */
/* z-index 1: over the button's touch ::after (inset −2 px, drawn after the ▾), which otherwise took the press on a
   phone and the ▾ chose the tool instead of opening the choices (studio-transform, 2026-10-18). */
.more { position: absolute; z-index: 1; right: 0; bottom: 0; width: 12px; height: 12px; display: none; place-items: end; padding: 0 2px 2px 0;
  box-sizing: border-box; pointer-events: auto; cursor: pointer; border-radius: 0 0 8px 0; opacity: .6; transition: opacity .16s cubic-bezier(.2,.8,.2,1); }
.more svg { width: 7px; height: 4px; stroke-width: 1.5px; }
button.opts .more { display: grid; }
button:hover .more, button.on .more, .more.open { opacity: 1; }
.row.big .more { width: 20px; height: 20px; padding: 0 5px 5px 0; border-radius: 0 0 12px 0; }
.row.big .more svg { width: 8px; height: 5px; }
/* Light editor: the light glass, the same two colours. */
.root.light .menu, .root.light .row { backdrop-filter: blur(30px) saturate(1.25); -webkit-backdrop-filter: blur(30px) saturate(1.25); background: rgba(251,251,253,.8); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.7), 0 1px 1px rgba(0,0,0,.04), 0 10px 32px rgba(0,0,0,.13); }
.root.light .menu button { color: #6e6e73; }
.root.light .menu button.chosen { color: #fff; background: #1d1d1f; }
.root.light button { color: #6e6e73; }
.root.light button:hover { color: #1d1d1f; background: rgba(0,0,0,.045); }
.root.light button.rest { color: #1d1d1f; background: rgba(0,0,0,.075); }
.root.light button:active, .root.light button.on { color: #fff; background: #1d1d1f; }
/* The readout while a drag works, and the first-time hint line: the same glass, the small size, tabular digits (rule 4). */
.chip, .hint { position: absolute; display: none; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; white-space: nowrap;
  font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; font-variant-numeric: tabular-nums; color: #f5f5f7;
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); }
.chip { transform: translateY(-50%); }
.hint { height: 32px; padding: 0 14px; font-weight: 400; transform: translateX(-50%); max-width: calc(100vw - 24px); overflow: hidden; text-overflow: ellipsis; animation: rise .24s cubic-bezier(.2,.8,.2,1); }
.root.light .chip, .root.light .hint { color: #1d1d1f; backdrop-filter: blur(30px) saturate(1.25); -webkit-backdrop-filter: blur(30px) saturate(1.25); background: rgba(251,251,253,.8); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.7), 0 1px 1px rgba(0,0,0,.04), 0 10px 32px rgba(0,0,0,.13); }
@media (pointer: coarse) { .hint { height: 36px; font-size: 13px; } }
@media (prefers-reduced-motion: reduce) { button, .more { transition: none; } .menu, .hint { animation: none; } }
/* The finger-sized strip (buttons 44 px: phones and the side window; .big = 40 px and up), design review wave 1 (W1-2 / N4,
   2026-10-17): 48 high (44 + 2 in), no gaps between buttons, 14 corners, a light plate — white 92 % with a 12 px blur
   and a 1 px line (dark: #2a2a2e 92 %). WHY: the dark, thick plate with the chosen tool as a second plate on it weighed
   ten times the small object it served (review photo 12 / 15 / 18). The chosen tool (and Move at rest) is told by its
   ground alone, black 8 % (dark: white 10 %), never a filled square on top. */
.row.big { gap: 0; padding: 2px; border-radius: 14px; background: rgba(42, 42, 46, .92); box-shadow: 0 0 0 1px rgba(255,255,255,.08);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.row.big button { border-radius: 12px; }
.row.big button:hover { background: transparent; }
.row.big button.rest, .row.big button.on, .row.big button:active { color: #f5f5f7; background: rgba(255,255,255,.10); }
.root.light .row.big { background: rgba(255,255,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.08); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.root.light .row.big button { color: #6e6e73; }
.root.light .row.big button.rest, .root.light .row.big button.on, .root.light .row.big button:active { color: #1d1d1f; background: rgba(0,0,0,.08); }
`;

let scratch: HTMLCanvasElement | null = null;
/** Draw a 2 px ring just outside the mask's shape, in `color`, on a faint dark halo. */
function ring(doc: Document, el: HTMLCanvasElement, o: Outline, color: string) {
  const dpr = doc.defaultView?.devicePixelRatio || 1;
  const W = Math.max(1, Math.ceil(o.w * dpr));
  const H = Math.max(1, Math.ceil(o.h * dpr));
  if (el.width !== W) el.width = W;
  if (el.height !== H) el.height = H;
  el.style.left = `${o.x}px`;
  el.style.top = `${o.y}px`;
  el.style.width = `${o.w}px`;
  el.style.height = `${o.h}px`;
  const g = el.getContext('2d');
  if (!g) return;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, H);
  // A faint dark halo 1 px outside the coloured line first (ive finish, 10/16): orange alone vanished on
  // orange, sand or sunset games; the halo keeps the line readable on any colour without a second colour.
  const stamp = (px: number) => {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.drawImage(o.mask, Math.cos(a) * px, Math.sin(a) * px, W, H);
    }
  };
  stamp(3 * dpr);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = 'rgba(0, 0, 0, .28)';
  g.fillRect(0, 0, W, H);
  // Then the line: the shape stamped round a small circle (16 directions, 2 px), in `color`, over the halo.
  // One scratch canvas, reused: outlines are redrawn up to every 40 ms while dragging.
  const line = (scratch ||= doc.createElement('canvas'));
  line.width = W;
  line.height = H;
  const lg = line.getContext('2d');
  if (lg) {
    const t = 2 * dpr;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      lg.drawImage(o.mask, Math.cos(a) * t, Math.sin(a) * t, W, H);
    }
    lg.globalCompositeOperation = 'source-in';
    lg.fillStyle = color;
    lg.fillRect(0, 0, W, H);
  }
  g.globalCompositeOperation = 'source-over';
  g.drawImage(line, 0, 0);
  // Keep only the ring: the object itself stays exactly as the game draws it.
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(o.mask, 0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
}

export function createHandles(doc: Document, hasLift: boolean): Handles {
  const host = doc.createElement('div');
  host.setAttribute('data-studio-ui', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const root = doc.createElement('div');
  root.className = 'root';
  const row = doc.createElement('div');
  row.className = 'row';
  row.setAttribute('role', 'toolbar');
  const buttons = {} as Record<HandleKind, HTMLButtonElement>;
  // Order of the strip: move, height, turn, size (where it is, then how it sits).
  const kinds: HandleKind[] = hasLift ? ['move', 'lift', 'rotate', 'scale'] : ['move', 'rotate', 'scale'];
  for (const k of kinds) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.studioHandle = k;
    b.setAttribute('aria-label', HANDLE_LABELS.en[k]);
    b.title = HANDLE_LABELS.en[k];
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`; // static markup only
    if (k === 'rotate' || k === 'scale') {
      // The ▾ (shown only while the button has choices: setOptions). A span, not a button: a button in a button is not
      // allowed; keyboards reach the same choices with R (turn) and the menu's own buttons.
      const more = doc.createElement('span');
      more.className = 'more';
      more.dataset.studioMore = k === 'rotate' ? 'axis' : 'scale';
      more.innerHTML = '<svg viewBox="0 0 7 4" aria-hidden="true"><path d="M.75.75 3.5 3.25 6.25.75"/></svg>'; // static markup only
      b.append(more);
    }
    buttons[k] = b;
    row.appendChild(b);
  }
  buttons.move.classList.add('rest');
  for (const k of kinds) buttons[k].setAttribute('aria-pressed', 'false');
  // One layer per kind of mark, bottom to top: ghosts, AI outlines, your outline, tags, strip, band.
  const ghostLayer = doc.createElement('div');
  const aiLayer = doc.createElement('div');
  const selLayer = doc.createElement('div');
  const youTag = doc.createElement('div');
  youTag.className = 'tag you';
  const aiTag = doc.createElement('div');
  aiTag.className = 'tag ai';
  const band = doc.createElement('div');
  band.className = 'band';
  const menuEl = doc.createElement('div');
  menuEl.className = 'menu';
  menuEl.setAttribute('role', 'menu');
  const chip = doc.createElement('div');
  chip.className = 'chip';
  chip.setAttribute('aria-live', 'polite');
  const hintEl = doc.createElement('div');
  hintEl.className = 'hint';
  hintEl.setAttribute('role', 'status');
  /** Swap a strip button's picture, keeping its ▾. */
  const paintIcon = (b: HTMLButtonElement, inner: string) => {
    const tmp = doc.createElement('div');
    tmp.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`; // static markup only
    b.querySelector(':scope > svg')?.replaceWith(tmp.firstElementChild!);
  };
  let scaleMode: GroupScaleMode = 'spread';
  let scaleOpts = false;
  const paintScale = () => paintIcon(buttons.scale, scaleOpts ? SCALE_ICONS[scaleMode] : ICONS.scale);
  let held: HandleKind | null = null;
  let chosen: HandleKind | null = null;
  const paintButtons = () => {
    for (const k of kinds) {
      buttons[k].classList.toggle('on', k === held || (k === chosen && !held));
      buttons[k].setAttribute('aria-pressed', String(k === chosen));
    }
    // While a tool is chosen or another button is held, move is not "the one at rest" any more.
    buttons.move.classList.toggle('rest', !chosen && (!held || held === 'move'));
  };
  /** Next to the strip (right of it; left when there is no room), on its middle line. */
  const positionChip = () => {
    if (chip.style.display === 'none') return;
    if (row.style.display === 'none') {
      chip.style.visibility = 'hidden';
      return;
    }
    chip.style.visibility = '';
    const rr = row.getBoundingClientRect();
    const w = chip.offsetWidth;
    const right = inset.rightTo === undefined || rr.top < inset.rightTo ? inset.right : 0;
    let x = rr.right + 6;
    if (x + w > win.innerWidth - 8 - right) x = Math.max(8 + inset.left, rr.left - 6 - w);
    chip.style.left = `${x}px`;
    chip.style.top = `${rr.top + rr.height / 2}px`;
  };
  const positionHint = () => {
    if (hintEl.style.display === 'none') return;
    const vw = win.innerWidth - inset.left - inset.right;
    hintEl.style.left = `${inset.left + vw / 2}px`;
    hintEl.style.top = `${win.innerHeight - inset.bottom - 12 - hintEl.offsetHeight}px`;
  };
  let menuKind: 'axis' | 'scale' | null = null;
  // Where the strip went last: under the object (true) or over it.
  let stripBelow = true;
  /** Over the strip (under it when there is no room above), centred on the button it belongs to. */
  const positionMenu = () => {
    if (!menuKind) return;
    if (row.style.display === 'none') {
      menuEl.style.display = 'none';
      return;
    }
    menuEl.style.display = 'flex';
    const btn = (menuKind === 'axis' ? buttons.rotate : buttons.scale).getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    const x = Math.max(8 + mw / 2, Math.min(win.innerWidth - 8 - mw / 2, btn.left + btn.width / 2));
    // On the far side of the strip from the object, so the choices never cover what they change.
    const vh = win.innerHeight;
    let y = stripBelow ? rr.bottom + 8 : rr.top - 8 - mh;
    if (stripBelow && y + mh > vh - 8 - inset.bottom) y = rr.top - 8 - mh;
    if (!stripBelow && y < 8 + inset.top) y = rr.bottom + 8;
    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;
  };
  root.append(ghostLayer, aiLayer, selLayer, aiTag, youTag, row, menuEl, chip, hintEl, band);
  shadow.append(style, root);
  (doc.body || doc.documentElement).appendChild(host);

  const win = doc.defaultView!;
  let size: number = UI.handlePx;
  let inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 };

  /** Fill a layer with the shape's ring, or with one box per rect; returns the box round all of it. */
  const outline = (layer: HTMLElement, shape: Outline | null, rects: Rect[], color: string): Rect | null => {
    if (shape) {
      let c = layer.firstElementChild as HTMLCanvasElement | null;
      if (!c || c.tagName !== 'CANVAS' || layer.children.length !== 1) {
        layer.replaceChildren();
        c = doc.createElement('canvas');
        c.className = 'ol';
        layer.append(c);
      }
      ring(doc, c, shape, color);
      // The shape's own box (the mask has a few px of room round it).
      return { x: shape.x + 4, y: shape.y + 4, w: Math.max(0, shape.w - 8), h: Math.max(0, shape.h - 8) };
    }
    if (layer.firstElementChild?.tagName === 'CANVAS') layer.replaceChildren();
    while (layer.children.length > rects.length) layer.lastChild!.remove();
    while (layer.children.length < rects.length) {
      const m = doc.createElement('div');
      m.className = 'box';
      m.style.setProperty('--c', color);
      layer.append(m);
    }
    let all: Rect | null = null;
    rects.forEach((r, i) => {
      const m = layer.children[i] as HTMLElement;
      m.style.left = `${r.x - 3}px`;
      m.style.top = `${r.y - 3}px`;
      m.style.width = `${r.w + 6}px`;
      m.style.height = `${r.h + 6}px`;
      all = all ? union(all, r) : { ...r };
    });
    return all;
  };
  const union = (a: Rect, b: Rect): Rect => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  /** A tag over a box, kept inside the window. `left` = start at the box's left edge instead of its middle. */
  const tagAt = (el: HTMLElement, box: Rect | null, text: string | null, left = false) => {
    if (!box || !text || box.y > win.innerHeight - inset.bottom) {
      el.style.display = 'none';
      return;
    }
    el.textContent = text; // untrusted names: text only
    el.style.display = 'flex';
    const vw = win.innerWidth;
    const w = el.offsetWidth || 80;
    let x = left ? box.x + w / 2 : box.x + box.w / 2;
    const right = inset.rightTo === undefined || box.y - 28 < inset.rightTo ? inset.right : 0;
    x = Math.max(8 + inset.left + w / 2, Math.min(vw - 8 - right - w / 2, x));
    // Above the object; under its top edge when there is no room above.
    const y = box.y - 8 < 28 + inset.top ? box.y + 28 : box.y - 8;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };

  return {
    setSize(px) {
      if (!(px >= 24 && px <= 120)) return;
      size = Math.round(px);
      root.style.setProperty('--h', `${size}px`);
      row.classList.toggle('big', size >= 40);
    },
    setTheme(theme) {
      root.classList.toggle('light', theme === 'light');
    },
    setInset(i) {
      inset = { top: Math.max(0, i.top || 0), right: Math.max(0, i.right || 0), bottom: Math.max(0, i.bottom || 0), left: Math.max(0, i.left || 0), rightTo: i.rightTo };
    },
    place(a, caps, dim) {
      const show = !!a && a.visible && !!caps;
      row.style.display = show ? 'flex' : 'none';
      if (!show || !a || !caps) {
        positionMenu();
        positionChip();
        return;
      }
      buttons.move.hidden = caps.movable === false;
      buttons.rotate.hidden = !caps.rotatable;
      buttons.scale.hidden = !caps.scalable;
      if (buttons.lift) buttons.lift.hidden = dim !== '3d' || caps.liftable === false;
      const [cx, cy] = a.center;
      let top: number, bottom: number;
      if (a.rect && a.rect.w > 0 && a.rect.h > 0) {
        top = a.rect.y;
        bottom = a.rect.y + a.rect.h;
      } else {
        const r = Math.max(12, a.size / 2);
        top = cy - r;
        bottom = cy + r;
      }
      const vw = win.innerWidth, vh = win.innerHeight;
      // Under a panel of the editor (a phone's sheet): no strip floating somewhere else.
      if (top > vh - inset.bottom) {
        row.style.display = 'none';
        positionMenu();
        return;
      }
      const n = kinds.filter((k) => !buttons[k].hidden).length;
      if (n === 0) row.style.display = 'none';
      // .big (finger size): no gaps, 2 px in (W1-2); else 2 px gaps, 4 px in.
      const big = size >= 40;
      const rowW = big ? n * size + 4 : n * size + (n - 1) * 2 + 4;
      const rowH = big ? size + 4 : size + 8;
      const lo = 8 + inset.top, hi = vh - 8 - inset.bottom - rowH;
      // Under the object; above it when there is no room below (over the ask bar on a phone).
      let y = bottom + GAP;
      if (y > hi) y = top - GAP - rowH - 28; // 28: keep clear of the name tag above
      if (y < lo) y = Math.min(hi, bottom + GAP);
      y = Math.max(lo, Math.min(hi, y));
      // The card covers the top right corner only: below it, the strip may go to the edge.
      const right = inset.rightTo === undefined || y < inset.rightTo ? inset.right : 0;
      const x = Math.max(8 + inset.left + rowW / 2, Math.min(vw - 8 - right - rowW / 2, cx));
      row.style.left = `${x}px`;
      row.style.top = `${y}px`;
      stripBelow = y >= bottom;
      positionMenu();
      positionChip();
      positionHint();
    },
    setAxis(axis, lang) {
      const b = buttons.rotate;
      b.dataset.axis = axis;
      paintIcon(b, AXIS_ICONS[axis]);
      const w = (AXIS_WORDS[lang] || AXIS_WORDS.en)[axis];
      b.title = `${w[0]} (${TOOL_KEYS.rotate}) — ${w[1]}`;
      b.setAttribute('aria-label', `${w[0]} (${TOOL_KEYS.rotate})`);
    },
    setScaleMode(mode) {
      if (mode === scaleMode) return;
      scaleMode = mode;
      buttons.scale.dataset.mode = mode;
      paintScale();
    },
    setOptions(opts, lang) {
      // Called every frame (place): touch the DOM only when something changed.
      const words = MORE_LABELS[lang] || MORE_LABELS.en;
      for (const [k, on, kind] of [['rotate', opts.axis, 'axis'], ['scale', opts.scale, 'scale']] as const) {
        const b = buttons[k];
        if (b.classList.contains('opts') === on && b.dataset.optsLang === lang) continue;
        b.classList.toggle('opts', on);
        b.dataset.optsLang = lang;
        if (on) b.setAttribute('aria-haspopup', 'menu');
        else b.removeAttribute('aria-haspopup');
        const m = b.querySelector<HTMLElement>('.more');
        if (m) m.title = words[kind];
      }
      if (opts.scale !== scaleOpts) {
        scaleOpts = opts.scale;
        paintScale();
      }
    },
    menu(kind, current, lang) {
      menuKind = kind;
      // The open one's ▾ stays lit, and the button says its choices are showing.
      for (const [k, mk] of [['rotate', 'axis'], ['scale', 'scale']] as const) {
        const open = kind === mk && row.style.display !== 'none';
        buttons[k].querySelector('.more')?.classList.toggle('open', open);
        if (buttons[k].hasAttribute('aria-haspopup')) buttons[k].setAttribute('aria-expanded', String(open));
      }
      menuEl.replaceChildren();
      if (!kind || row.style.display === 'none') {
        menuKind = null;
        menuEl.style.display = 'none';
        return;
      }
      const words: Record<string, [string, string]> = kind === 'axis' ? (AXIS_WORDS[lang] || AXIS_WORDS.en) : (SCALE_WORDS[lang] || SCALE_WORDS.en);
      const icons: Record<string, string> = kind === 'axis' ? AXIS_ICONS : SCALE_ICONS;
      for (const id of Object.keys(words)) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.dataset.studioChoice = `${kind}:${id}`;
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('aria-checked', String(id === current));
        if (id === current) b.classList.add('chosen');
        b.title = words[id]![1];
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[id]}</svg>`; // static markup only
        const t = doc.createElement('span');
        t.textContent = words[id]![0];
        b.append(t);
        menuEl.append(b);
      }
      menuEl.style.display = 'flex';
      positionMenu();
    },
    menuOpen: () => menuKind,
    setActive(kind) {
      held = kind;
      paintButtons();
    },
    setTool(kind) {
      chosen = kind && buttons[kind] ? kind : null;
      paintButtons();
    },
    readout(text) {
      if (!text) {
        chip.style.display = 'none';
        return;
      }
      chip.textContent = text; // our own words and numbers only
      chip.style.display = 'flex';
      positionChip();
    },
    hint(text) {
      if (!text) {
        hintEl.style.display = 'none';
        return;
      }
      hintEl.textContent = text;
      hintEl.style.display = 'flex';
      positionHint();
    },
    setLabels(labels) {
      for (const k of kinds) {
        buttons[k].setAttribute('aria-label', labels[k]);
        // The turn button's tooltip names its axis (setAxis), with the key.
        if (k !== 'rotate' || !buttons[k].dataset.axis) buttons[k].title = labels[k];
      }
    },
    selection(shape, rects, tag) {
      tagAt(youTag, outline(selLayer, shape, rects, YOU), tag);
    },
    ai(shape, rects, tag) {
      tagAt(aiTag, outline(aiLayer, shape, rects, AI), tag, true);
    },
    ghosts(list) {
      const keep = new Set(list.map((g) => g.key));
      for (const el of Array.from(ghostLayer.children) as HTMLElement[]) if (!keep.has(el.dataset.key!)) el.remove();
      for (const g of list) {
        let el = Array.from(ghostLayer.children).find((c) => (c as HTMLElement).dataset.key === g.key) as HTMLElement | undefined;
        if (!el) {
          el = doc.createElement('div');
          el.className = 'ghost';
          el.dataset.key = g.key;
          ghostLayer.append(el);
        }
        // Only PNG data URLs from capture() are used as pictures (never game text).
        const bg = g.src && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(g.src) ? `url("${g.src}")` : 'none';
        if (el.dataset.bg !== bg.slice(0, 64)) {
          el.style.backgroundImage = bg;
          el.dataset.bg = bg.slice(0, 64);
        }
        el.style.left = `${g.cx - g.w / 2}px`;
        el.style.top = `${g.cy - g.h / 2}px`;
        el.style.width = `${Math.max(4, g.w)}px`;
        el.style.height = `${Math.max(4, g.h)}px`;
        el.style.transform = g.rot ? `rotate(${g.rot}rad)` : '';
      }
    },
    box(r) {
      band.style.display = r ? 'block' : 'none';
      if (!r) return;
      band.style.left = `${r.x}px`;
      band.style.top = `${r.y}px`;
      band.style.width = `${r.w}px`;
      band.style.height = `${r.h}px`;
    },
    destroy() {
      host.remove();
    },
  };
}

/** The ▾ under a pointer event (which choices it opens), or null. Checked before handleFromEvent: it sits in a button. */
export function moreFromEvent(e: Event): 'axis' | 'scale' | null {
  for (const el of e.composedPath()) {
    const m = (el as HTMLElement).dataset?.studioMore;
    if (m === 'axis' || m === 'scale') return m;
  }
  return null;
}

/** The choice under a pointer event (the strip's menu), or null. */
export function choiceFromEvent(e: Event): Choice | null {
  for (const el of e.composedPath()) {
    const c = (el as HTMLElement).dataset?.studioChoice;
    if (c) {
      const [kind, id] = c.split(':') as ['axis' | 'scale', string];
      return { kind, id };
    }
  }
  return null;
}

/** The handle under a pointer event, looking through the shadow root. */
export function handleFromEvent(e: Event): HandleKind | null {
  for (const el of e.composedPath()) {
    const k = (el as HTMLElement).dataset?.studioHandle;
    if (k) return k as HandleKind;
  }
  return null;
}
