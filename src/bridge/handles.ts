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
/** 1–4: the same tools in the 3D strip's order (basics pass, 2026-10-18; shell/keymap.ts). Not W/E/R: E turns, R is the axis. */
export const TOOL_NUMBERS: Record<HandleKind, string> = { move: '1', lift: '2', rotate: '3', scale: '4' };
export const toolFromKey = (key: string): HandleKind | null =>
  (Object.keys(TOOL_KEYS) as HandleKind[]).find((k) => TOOL_KEYS[k] === key.toUpperCase() || TOOL_NUMBERS[k] === key) ?? null;

/**
 * The Motion button's keys (studio-motion-tool, 2026-10-22): A ("animate") and 5, the strip's order after 1–4. Not a
 * tool (nothing is dragged with it): a press opens the pick's motion, or its small menu. A is also fly-left (W A S D),
 * but only with nothing picked or the right button held — the same split as S (Size / fly back); the Motion keys
 * work with something picked. shell/keymap.ts lists them; test/keymap.test.ts keeps the two the same.
 */
export const MOTION_KEYS = ['A', '5'] as const;
export const isMotionKey = (key: string): boolean => (MOTION_KEYS as readonly string[]).includes(key.toUpperCase());

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
 * The one line shown the first time a tool is chosen (then never again on this computer): what a drag does now and
 * how to stop. 40 characters at most (design review 2, item ③): it was 101 — "Drag anywhere: Turn · Look around:
 * ⌥-drag, right-drag, or hold Space · Esc: no tool · Tilt: ▾ on Turn" — and its ▾ came out as "•" in the font. How to
 * look around is in the ? sheet (shell/shortcuts.ts); the ▾ says itself that the tilts are behind it. On touch the
 * two-finger look stays: a phone has no ? sheet. `tool` is the readout word ("Turn", "Tilt forward").
 */
export const TOOL_HINT: Record<Lang, { mouse: (tool: string) => string; touch: (tool: string) => string }> = {
  en: { mouse: (t) => `Drag to ${t.toLowerCase()} · Esc to stop`, touch: (t) => `Drag to ${t.toLowerCase()} · 2 fingers: look` },
  ja: { mouse: (t) => `引いて${t} ・ Esc でやめる`, touch: (t) => `引いて${t} ・ 2 本指で見回す` },
};
/**
 * A dimmed tool's one line (studio-tool-clear, 2026-10-23): why it does not work on this object, then what can be done
 * — never only "you can't" (the brief: "do not end on a sentence that leaves nothing to do"). The tooltip of the dimmed
 * button, and the small line by the strip (noteLine). The menu a press opened is gone (studio-move-plain, 2026-10-23);
 * the `game` move / lift lines stay for a group whose Move is off, but Move on what the game moves works (hold.ts).
 * Turn and size the game sets get "Ask AI", not a start value: a game that spins or pulses a thing mostly sets the angle
 * or the size outright every frame, so a start value would not show (hold.ts; the design review proposed both).
 */
export const OFF_LINES: Record<Lang, Record<'game' | 'ground' | 'locked' | 'none', Record<HandleKind, string>>> = {
  en: {
    game: {
      move: 'Your game moves this while playing. You choose only where it starts.',
      lift: 'Your game sets its height while playing. You can set the height it starts at.',
      rotate: 'Your game turns this while playing. Ask AI to change how it turns.',
      scale: 'Your game sets its size while playing. Ask AI to change it.',
    },
    ground: { move: 'Held still so it isn’t nudged by mistake. You can unlock it.', lift: 'Held still so it isn’t nudged by mistake. You can unlock it.', rotate: 'Held still so it isn’t nudged by mistake. You can unlock it.', scale: 'Held still so it isn’t nudged by mistake. You can unlock it.' },
    locked: { move: 'The game’s rules keep this in place. Ask AI to change the rule.', lift: 'The game’s rules keep this in place. Ask AI to change the rule.', rotate: 'The game’s rules keep this in place. Ask AI to change the rule.', scale: 'The game’s rules keep this in place. Ask AI to change the rule.' },
    none: { move: 'This one can’t be moved here. Ask AI to move it.', lift: 'This one’s height can’t be changed here. Ask AI to change it.', rotate: 'This one can’t be turned here. Ask AI to turn it.', scale: 'This one can’t be resized here. Ask AI to resize it.' },
  },
  ja: {
    game: {
      move: 'この物は遊ぶとゲームが動かします。決められるのはスタート位置だけです。',
      lift: 'ゲームが高さを決めている物です。最初の高さなら決められます。',
      rotate: 'ゲームが向きを変えている物です。変えるなら AI に頼めます。',
      scale: 'ゲームが大きさを変えている物です。変えるなら AI に頼めます。',
    },
    ground: { move: 'うっかり動かさないよう固定しています。解除できます。', lift: 'うっかり動かさないよう固定しています。解除できます。', rotate: 'うっかり動かさないよう固定しています。解除できます。', scale: 'うっかり動かさないよう固定しています。解除できます。' },
    locked: { move: 'ゲームのルールで固定されています。AI にルールの変更を頼めます。', lift: 'ゲームのルールで固定されています。AI にルールの変更を頼めます。', rotate: 'ゲームのルールで固定されています。AI にルールの変更を頼めます。', scale: 'ゲームのルールで固定されています。AI にルールの変更を頼めます。' },
    none: { move: 'この物はここでは動かせません。AI に頼めます。', lift: 'この物の高さはここでは変えられません。AI に頼めます。', rotate: 'この物はここでは回せません。AI に頼めます。', scale: 'この物の大きさはここでは変えられません。AI に頼めます。' },
  },
};
/**
 * The small line by the strip (studio-move-plain, 2026-10-23, a hands-on try on a neon runner: "the left of the strip was
 * the plain Move — both ends are Motion now"). What the game does to the picked thing while playing, and, when the game
 * moves it, that a move here sets where it starts — Move itself is the plain Move, with no menu in between. One line,
 * short; no "Ask AI" (the ask box below is where that happens). `parts` = what the game changes (Item.driven).
 */
export function gameNote(lang: Lang, parts: readonly ('move' | 'lift' | 'turn' | 'size')[]): string {
  const moves = parts.includes('move') || parts.includes('lift');
  const what = (['move', 'turn', 'size'] as const).filter((k) => (k === 'move' ? moves : parts.includes(k)));
  if (!what.length) return '';
  if (lang === 'ja') {
    const v = { move: '動かし', turn: '回し', size: '大きさを変え' };
    return `遊ぶとゲームが${what.map((k) => v[k]).join('、')}ます。${moves ? 'ここで動かすとスタート位置が変わります。' : ''}`;
  }
  const v = { move: 'moves', turn: 'turns', size: 'resizes' };
  const list = what.length < 3 ? what.map((k) => v[k]).join(' and ') : `${v.move}, ${v.turn} and ${v.size}`;
  return `Your game ${list} this while playing.${moves ? ' Moving it here sets where it starts.' : ''}`;
}
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
/**
 * Turning several (multi rotate, play test 2026-10-18: "no turn options with several picked"): the size button's two
 * words, in the same order, under the axes on the turn button's ▾ (2D: alone — one axis there).
 */
export const TURN_WAY_WORDS: Record<Lang, Record<GroupScaleMode, [string, string]>> = {
  en: { spread: ['Together', 'Everything turns as one piece, around the middle of what’s selected'], inplace: ['Each in place', 'Each one turns in its own spot; nothing moves away'] },
  ja: { spread: ['並びごと', '並び全体が 1 つの物のように、選んだ物の真ん中を中心に回る'], inplace: ['その場で', 'それぞれが自分の場所で回る（置き場所はそのまま）'] },
};
type Choice = { kind: 'axis' | 'scale' | 'turn'; id: string };

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

/**
 * Turning several. Each in place: two boxes, each with its own small turn arrow. Together: two boxes riding one big
 * turn round a middle dot — not the turn tool's own picture, which the axes row's Turn already wears in 3D (2D, where
 * the axes are not shown, uses the tool's own picture for Together: see `turnWayIcon`).
 */
const TURN_WAY_ICONS: Record<GroupScaleMode, string> = {
  spread: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M17.8 2.8v4h-4"/><rect x="2.5" y="10" width="4" height="4" rx=".8"/><rect x="17.5" y="10" width="4" height="4" rx=".8"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  inplace: '<rect x="3" y="13" width="6" height="6" rx="1"/><rect x="15" y="13" width="6" height="6" rx="1"/><path d="M3.5 9a3 3 0 0 1 5-1.8"/><path d="M8.8 4.8v2.6H6.2"/><path d="M15.5 9a3 3 0 0 1 5-1.8"/><path d="M20.8 4.8v2.6h-2.6"/>',
};

const ICONS: Record<HandleKind, string> = {
  move: '<path d="M12 4v16M4 12h16M9.5 6.5 12 4l2.5 2.5M9.5 17.5 12 20l2.5-2.5M6.5 9.5 4 12l2.5 2.5M17.5 9.5 20 12l-2.5 2.5"/>',
  rotate: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17.5 3.5v4h-4"/>',
  lift: '<path d="M12 4v16M8.5 7.5 12 4l3.5 3.5M8.5 16.5 12 20l3.5-3.5"/>',
  scale: '<path d="M5 19 19 5M13.5 5H19v5.5M5 13.5V19h5.5"/>',
};

/**
 * The Motion button's picture: a dotted path from a small point to the thing at its end (a ring) — "this goes from
 * here to there over time". Not the timeline's ◆ (a key, one moment) nor ▶ (Play, which runs the whole game).
 */
// The thing at the top LEFT (not right, as first drawn): the top right corner is where the dot goes, and the ring
// there hid it (the first run's pictures, 2026-10-22).
const MOTION_ICON = '<path d="M20 19c-4.5 0-5-7-8.5-9.5S7 8 5.5 6.5" stroke-dasharray="0.01 3.2"/><circle cx="20" cy="19" r="1.3" fill="currentColor" stroke="none"/><circle cx="5.5" cy="6.5" r="2.6"/>';

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
  /**
   * Under the object. `caps.off` = the tools that do not work on it, each with its one line of why (the tooltip): they
   * stay in their place, dimmed (studio-tool-clear, 2026-10-23). A tool not in `off` works. `caps.note` = the one small
   * line by the strip (studio-move-plain, 2026-10-23), or none.
   */
  place(a: Anchor | null, caps: { off?: Partial<Record<HandleKind, string>>; note?: string | null } | null, dim: '2d' | '3d'): void;
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
   * The Motion button after the tools (studio-motion-tool): `show` = the pick can have a motion, `has` = it has one (the
   * dot), `label` = the tooltip (the editor's words), `open` = its menu is open in the editor page (the button pressed).
   */
  setMotion(m: { show: boolean; has: boolean; label: string; open: boolean }): void;
  /** The Motion button's box on screen (null = not shown): the editor's menu opens at it, also for the A / 5 keys. */
  motionRect(): DOMRect | null;
  /** A tool button's box on screen (null = the strip is not shown). */
  toolRect(kind: HandleKind): DOMRect | null;
  /**
   * The selection's outline: the shape when the adapter gave one, else one
   * rounded box per rect. `tag` = the name tag over it (null = none).
   */
  selection(shape: Outline | null, rects: Rect[], tag: string | null): void;
  /** What the AI's last change touched: same kind of outline, violet, one tag. */
  ai(shape: Outline | null, rects: Rect[], tag: string | null): void;
  /** What the mouse is over in the editor page (a list row, the card, the ask chip): a softer light in your colour. */
  hover(shape: Outline | null, rects: Rect[]): void;
  /** A new pick: its mark lights up once, then settles (the moment the eye looks for it). */
  flash(): void;
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
  /** How several turn (together / each in place): 2D's turn button wears it (3D's wears its axis). */
  setTurnMode(mode: GroupScaleMode): void;
  /**
   * Which buttons have choices now: they show the ▾ (turn: 3D, or several picked; size: several). `axes`: the turn
   * choices include the axes (3D); `several`: they include together / each in place.
   */
  setOptions(opts: { axis: boolean; scale: boolean; axes?: boolean; several?: boolean }, lang: Lang): void;
  /**
   * The choices over the strip: 'axis' (the turn button), 'scale' (several picked),
   * or null to close. `current` is the chosen one. The turn button's choices are
   * `turn.axes` (3D: Turn / Tilt forward / Tilt sideways) and, when `turn.way` is
   * given (several picked), Together / Each in place in a row under them.
   */
  menu(kind: 'axis' | 'scale' | null, current: string, lang: Lang, turn?: { axes: boolean; way: GroupScaleMode | null }): void;
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
/* The chosen tool: the phone strip's grey ground (design review 2, item ③), not a filled ink square — the square was the
   loudest thing on the game after the object itself (review 2, photo 03; the light editor's was black). */
button:active, button.on { color: #f5f5f7; background: rgba(255,255,255,.16); cursor: grabbing; transition-duration: 0s; }
button:focus-visible { outline: 2px solid ${YOU}; outline-offset: 1px; }
button[hidden], .tsep[hidden] { display: none; }
/* A tool that does not work on this object (studio-tool-clear, 2026-10-23: "Move is gone from the strip"). It keeps
   its place and its own icon — the strip is the same four tools for every object — at a third of the ink, and a press
   on it does nothing; why is the one small line by the strip (.note). studio-move-plain (2026-10-23): no slash across
   it and no menu on a press any more — the slashed Move read as a second Motion button ("both ends are Motion now"),
   and a menu between the hand and the tool was one step too many. Move and Height on what the game moves are never
   off (hold.ts holdItem: they set where it starts). */
button.off { color: rgba(161,161,166,.42); cursor: default; }
button.off:hover, button.off:active { color: rgba(161,161,166,.42); background: transparent; }
button.off.rest { color: rgba(161,161,166,.42); background: transparent; }
.root.light button.off, .root.light button.off.rest, .root.light button.off:hover, .root.light button.off:active { color: rgba(110,110,115,.42); background: transparent; }
/* The Motion button (studio-motion-tool, 2026-10-22) sits after a hairline: the four tools change how the thing stands
   (a drag does it), Motion changes what it does over time (a press opens it). The same button as the tools — size,
   ink, ground — so the strip stays one object; the hairline is the menu's own (.msep). */
.tsep { align-self: stretch; width: .5px; margin: 5px 3px; background: rgba(255,255,255,.14); flex: none; }
.root.light .tsep { background: rgba(0,0,0,.1); }
.row.big .tsep { margin: 10px 4px; }
button[data-studio-motion] { cursor: pointer; }
/* "This thing moves": a 5 px dot in the button's own ink, top right — no new colour on the game (orange is your pick,
   violet the AI's). A finger strip: 6 px, 7 in. */
.dot { position: absolute; right: 3px; top: 3px; width: 5px; height: 5px; border-radius: 50%; background: currentColor; display: none; pointer-events: none; }
button.has .dot { display: block; }
.row.big .dot { right: 7px; top: 7px; width: 6px; height: 6px; }
/* Touch: past 44 px for the finger, whatever the drawn size. */
@media (pointer: coarse) { button::after { content: ""; position: absolute; inset: -2px; } }
svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6px; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.big svg { width: 20px; height: 20px; }
svg * { vector-effect: non-scaling-stroke; }
/* Outlines: a canvas per shape, a rounded box when there is no shape. */
.ol { position: absolute; pointer-events: none; }
.box { position: absolute; border: 1.5px solid var(--c); border-radius: 6px; box-sizing: border-box; pointer-events: none; }
/* Your pick, strongly (a hands-on try, 2026-10-19, item 3: "make what I picked stand out in the scene"; one of 20 black
   pillars had a thin orange line and the eye kept losing it). A 3 px line with an orange glow round it, the object
   lightly tinted (ring(): tint), and once on a new pick a brighter glow that settles in .6 s. The hover light is the
   same in a softer dose. Boxes (adapters without a shape) get the same, as a box. */
.layer.sel .ol { filter: drop-shadow(0 0 6px rgba(255,107,26,.6)); }
.layer.sel .box { border-width: 3px; background: rgba(255,107,26,.12); box-shadow: 0 0 10px rgba(255,107,26,.55); }
.layer.sel.flash .ol, .layer.sel.flash .box { animation: pick-flash .6s cubic-bezier(.2,.8,.2,1); }
@keyframes pick-flash { from { filter: drop-shadow(0 0 16px rgba(255,107,26,1)) brightness(1.25); } }
.layer.hover .ol { filter: drop-shadow(0 0 5px rgba(255,107,26,.45)); }
.layer.hover .box { border-width: 2px; background: rgba(255,107,26,.08); box-shadow: 0 0 8px rgba(255,107,26,.4); }
@media (prefers-reduced-motion: reduce) { .layer.sel.flash .ol, .layer.sel.flash .box { animation: none; } }
/* Name tags: the only filled colour on the game (your hand / the AI's hand), round-ended so they read as labels. */
.tag { position: absolute; display: none; height: 22px; padding: 0 9px; border-radius: 999px; align-items: center; gap: 4px; color: #fff; white-space: nowrap; font-weight: 600;
  transform: translate(-50%, -100%); box-shadow: 0 1px 2px rgba(0,0,0,.2), 0 4px 12px rgba(0,0,0,.18); max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
.tag.you { background: ${YOU}; }
.tag.ai { background: ${AI}; }
/* Stand-in copy: see-through picture of the original, dashed edge ("dashed = not real yet"). */
.ghost { position: absolute; opacity: .6; outline: 1.5px dashed rgba(255,255,255,.9); border-radius: 4px; pointer-events: none; background-size: 100% 100%; }
.band { position: absolute; border: 1px solid ${YOU}; border-radius: 2px; background: rgba(255,107,26,.1); display: none; pointer-events: none; }
/* The choices over the strip (design review 2, item ③): ONE row as high as the strip, its buttons the strip's own size,
   pictures only — the words are the tooltip and the label read aloud (the readout and the hint line name the way while
   it works). Before: big buttons with a picture over a word, twice the strip's width (265 px over a 125 px strip),
   the chosen one a black square, "Tilt sideways" wrapping on a phone. The chosen way: the strip's grey ground. */
.menu { position: absolute; display: none; gap: 2px; padding: 4px; border-radius: 12px; transform: translateX(-50%);
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); animation: rise .24s cubic-bezier(.2,.8,.2,1); }
@keyframes rise { from { opacity: 0; transform: translateX(-50%) translateY(6px) scale(.985); } }
.menu button { cursor: pointer; }
.menu button span { display: none; }
.menu button.chosen { color: #f5f5f7; background: rgba(255,255,255,.16); box-shadow: none; }
/* 3D with several picked: the axes, a hairline, then Together / Each in place — side by side in the one row. */
.menu .mrow { display: flex; gap: 2px; }
.menu .msep { align-self: stretch; width: .5px; margin: 4px 3px; background: rgba(255,255,255,.14); }
.root.light .menu .msep { background: rgba(0,0,0,.1); }
.menu.big { gap: 0; padding: 2px; border-radius: 14px; background: rgba(42, 42, 46, .92); box-shadow: 0 0 0 1px rgba(255,255,255,.08);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.menu.big .mrow { gap: 0; }
.menu.big button { border-radius: 12px; }
.menu.big button.chosen { background: rgba(255,255,255,.10); }
.root.light .menu.big { background: rgba(255,255,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.08); }
.root.light .menu.big button.chosen { background: rgba(0,0,0,.08); }
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
.root.light .menu button.chosen { color: #1d1d1f; background: rgba(0,0,0,.08); }
.root.light button { color: #6e6e73; }
.root.light button:hover { color: #1d1d1f; background: rgba(0,0,0,.045); }
.root.light button.rest { color: #1d1d1f; background: rgba(0,0,0,.075); }
.root.light button:active, .root.light button.on { color: #1d1d1f; background: rgba(0,0,0,.08); }
/* The readout while a drag works, and the first-time hint line: the same glass, the small size, tabular digits (rule 4). */
.chip, .hint { position: absolute; display: none; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; white-space: nowrap;
  font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; font-variant-numeric: tabular-nums; color: #f5f5f7;
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); }
.chip { transform: translateY(-50%); }
.hint { height: 32px; padding: 0 14px; font-weight: 400; transform: translateX(-50%); max-width: calc(100vw - 24px); overflow: hidden; text-overflow: ellipsis; animation: rise .24s cubic-bezier(.2,.8,.2,1); }
.root.light .chip, .root.light .hint { color: #1d1d1f; backdrop-filter: blur(30px) saturate(1.25); -webkit-backdrop-filter: blur(30px) saturate(1.25); background: rgba(251,251,253,.8); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.7), 0 1px 1px rgba(0,0,0,.04), 0 10px 32px rgba(0,0,0,.13); }
/* The one small line by the strip (studio-move-plain, 2026-10-23): why a tool is off, or that the game moves this and
   a move here sets where it starts. On the far side of the strip from the object, centred on it; plain words on the
   same glass as the readout, lighter weight, never a button (pointer-events: none — the strip's tools stay the only
   thing to press). */
.note { position: absolute; display: none; align-items: center; height: 22px; padding: 0 10px; border-radius: 999px; white-space: nowrap;
  transform: translateX(-50%); max-width: calc(100vw - 24px); overflow: hidden; text-overflow: ellipsis; pointer-events: none;
  font: 400 11px/1 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; color: #d1d1d6;
  background: rgba(28, 28, 30, .78); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 8px 24px rgba(0,0,0,.3);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); }
.root.light .note { color: #3a3a3c; background: rgba(251,251,253,.82); backdrop-filter: blur(30px) saturate(1.25); -webkit-backdrop-filter: blur(30px) saturate(1.25);
  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.7), 0 1px 1px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.1); }
@media (pointer: coarse) { .note { height: 26px; font-size: 12px; } }
/* A finger: clear of the camera's ↑ ↓ at the bottom right (44 wide + 12 margin on each side, review 2 item ③). */
@media (pointer: coarse) { .hint { height: 36px; font-size: 13px; max-width: calc(100vw - 128px); } }
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
/** How a ring is drawn: `line` px wide (2 = the AI's), `tint` = the share of `color` laid over the object (0 = none). */
export interface RingStyle {
  line: number;
  tint: number;
}
const RING_AI: RingStyle = { line: 2, tint: 0 };
// 3 px and a 16 % tint: strong enough to find one black pillar among twenty (a hands-on try, 2026-10-19) and still the
// game's own colours underneath. Hover: the same line in the softer 2 px with half the tint (the canvas is drawn at 70 %).
const RING_YOU: RingStyle = { line: 3, tint: 0.16 };
const RING_HOVER: RingStyle = { line: 2, tint: 0.1 };
/** Draw a ring just outside the mask's shape, in `color`, on a faint dark halo (and a tint over the shape: `style`). */
function ring(doc: Document, el: HTMLCanvasElement, o: Outline, color: string, style: RingStyle = RING_AI) {
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
  stamp((style.line + 1) * dpr);
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
    const t = style.line * dpr;
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
  // Keep only the ring: the object itself stays exactly as the game draws it — except your pick and the hover, which
  // get a light tint of the colour over the shape (2026-10-19: the ring alone round a small far object was lost).
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(o.mask, 0, 0, W, H);
  if (style.tint > 0) {
    const fill = (tintCanvas ||= doc.createElement('canvas'));
    fill.width = W;
    fill.height = H;
    const fg = fill.getContext('2d');
    if (fg) {
      fg.drawImage(o.mask, 0, 0, W, H);
      fg.globalCompositeOperation = 'source-in';
      fg.fillStyle = color;
      fg.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = style.tint;
      g.drawImage(fill, 0, 0);
      g.globalAlpha = 1;
    }
  }
  g.globalCompositeOperation = 'source-over';
}
let tintCanvas: HTMLCanvasElement | null = null;

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
  // The tooltip each button has when it works (its name and key, or the turn's axis); a dimmed one shows its why.
  const tips = {} as Record<HandleKind, string>;
  const offs: Partial<Record<HandleKind, string>> = {};
  // Order of the strip: move, height, turn, size (where it is, then how it sits).
  const kinds: HandleKind[] = hasLift ? ['move', 'lift', 'rotate', 'scale'] : ['move', 'rotate', 'scale'];
  for (const k of kinds) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.studioHandle = k;
    b.setAttribute('aria-label', HANDLE_LABELS.en[k]);
    b.title = HANDLE_LABELS.en[k];
    tips[k] = b.title;
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
  // The Motion button, after a hairline (hidden until the editor says the pick can have a motion: setMotion).
  const motionSep = doc.createElement('div');
  motionSep.className = 'tsep';
  motionSep.setAttribute('role', 'separator');
  motionSep.hidden = true;
  const motionBtn = doc.createElement('button');
  motionBtn.type = 'button';
  motionBtn.dataset.studioMotion = '';
  motionBtn.hidden = true;
  motionBtn.setAttribute('aria-haspopup', 'menu');
  motionBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${MOTION_ICON}</svg><span class="dot"></span>`; // static markup only
  row.append(motionSep, motionBtn);
  let motionShow = false;
  buttons.move.classList.add('rest');
  for (const k of kinds) buttons[k].setAttribute('aria-pressed', 'false');
  // One layer per kind of mark, bottom to top: ghosts, AI outlines, your outline, tags, strip, band.
  const ghostLayer = doc.createElement('div');
  const aiLayer = doc.createElement('div');
  const selLayer = doc.createElement('div');
  const hoverLayer = doc.createElement('div');
  aiLayer.className = 'layer ai';
  selLayer.className = 'layer sel';
  hoverLayer.className = 'layer hover';
  hoverLayer.style.opacity = '.7';
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
  const noteEl = doc.createElement('div');
  noteEl.className = 'note';
  noteEl.dataset.studioNote = '';
  /** Swap a strip button's picture, keeping its ▾. */
  const paintIcon = (b: HTMLButtonElement, inner: string) => {
    const tmp = doc.createElement('div');
    tmp.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`; // static markup only
    b.querySelector(':scope > svg')?.replaceWith(tmp.firstElementChild!);
  };
  let scaleMode: GroupScaleMode = 'spread';
  let scaleOpts = false;
  const paintScale = () => paintIcon(buttons.scale, scaleOpts ? SCALE_ICONS[scaleMode] : ICONS.scale);
  // The turn button: 3D wears its axis (AXIS_ICONS, the first row of its choices); 2D with several picked wears
  // together / each in place (its only choices), the tool's own picture for together (the default), as the size button.
  let turnAxis: TurnAxis = 'y';
  let turnMode: GroupScaleMode = 'spread';
  let turnAxes = false;
  let turnSeveral = false;
  let turnLang: Lang = 'en';
  const turnWayIcon = (m: GroupScaleMode) => (turnAxes || m === 'inplace' ? TURN_WAY_ICONS[m] : ICONS.rotate);
  const paintTurn = () => {
    const b = buttons.rotate;
    const wayOnly = turnSeveral && !turnAxes;
    paintIcon(b, wayOnly ? turnWayIcon(turnMode) : AXIS_ICONS[turnAxis]);
    const w = wayOnly ? (TURN_WAY_WORDS[turnLang] || TURN_WAY_WORDS.en)[turnMode] : (AXIS_WORDS[turnLang] || AXIS_WORDS.en)[turnAxis];
    // 3D, several: the way too ("Tilt forward · Each in place"), since the picture shows the axis only.
    const way = turnSeveral && turnAxes ? ` · ${(TURN_WAY_WORDS[turnLang] || TURN_WAY_WORDS.en)[turnMode][0]}` : '';
    tip('rotate', `${w[0]}${way} (${TOOL_KEYS.rotate}) — ${w[1]}`);
    b.setAttribute('aria-label', `${w[0]}${way} (${TOOL_KEYS.rotate})`);
  };
  const tip = (k: HandleKind, text: string) => {
    tips[k] = text;
    if (!offs[k]) buttons[k].title = text;
  };
  let held: HandleKind | null = null;
  let chosen: HandleKind | null = null;
  const paintButtons = () => {
    for (const k of kinds) {
      buttons[k].classList.toggle('on', !offs[k] && (k === held || (k === chosen && !held)));
      buttons[k].setAttribute('aria-pressed', String(k === chosen));
    }
    // While a tool is chosen or another button is held, move is not "the one at rest" any more.
    buttons.move.classList.toggle('rest', !chosen && (!held || held === 'move') && !offs.move);
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
    const top = win.innerHeight - inset.bottom - 12 - hintEl.offsetHeight;
    // The card's room on the right (inset.right) only reaches down to inset.rightTo, as for the camera ↑↓ (rise.ts).
    // Below the card the line is in the middle of the game, over the ask bar's middle (the third design review's ⑩,
    // 2026-10-20: centred in the room left of the card, it sat 146 px left of the bar at 1280).
    const right = inset.rightTo === undefined || top < inset.rightTo ? inset.right : 0;
    const vw = win.innerWidth - inset.left - right;
    hintEl.style.left = `${inset.left + vw / 2}px`;
    hintEl.style.top = `${top}px`;
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
  /** The one small line: on the far side of the strip from the object (under a strip under it), centred on the strip. */
  const positionNote = () => {
    if (noteEl.style.display === 'none') return;
    if (row.style.display === 'none') {
      noteEl.style.visibility = 'hidden';
      return;
    }
    noteEl.style.visibility = '';
    const rr = row.getBoundingClientRect();
    const w = noteEl.offsetWidth, nh = noteEl.offsetHeight;
    const x = Math.max(8 + w / 2, Math.min(win.innerWidth - 8 - w / 2, rr.left + rr.width / 2));
    let y = stripBelow ? rr.bottom + 4 : rr.top - 4 - nh;
    if (y + nh > win.innerHeight - 8 - inset.bottom) y = rr.top - 4 - nh;
    if (y < 8 + inset.top) y = rr.bottom + 4;
    noteEl.style.left = `${x}px`;
    noteEl.style.top = `${y}px`;
  };
  root.append(ghostLayer, aiLayer, hoverLayer, selLayer, aiTag, youTag, row, noteEl, menuEl, chip, hintEl, band);
  shadow.append(style, root);
  (doc.body || doc.documentElement).appendChild(host);

  const win = doc.defaultView!;
  let size: number = UI.handlePx;
  let inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 };

  /** Fill a layer with the shape's ring, or with one box per rect; returns the box round all of it. */
  const outline = (layer: HTMLElement, shape: Outline | null, rects: Rect[], color: string, style?: RingStyle): Rect | null => {
    if (shape) {
      let c = layer.firstElementChild as HTMLCanvasElement | null;
      if (!c || c.tagName !== 'CANVAS' || layer.children.length !== 1) {
        layer.replaceChildren();
        c = doc.createElement('canvas');
        c.className = 'ol';
        layer.append(c);
      }
      // No tint over something that fills much of the view (the sky dome, the ground): the whole game turned orange
      // when the mouse passed the sky's row (2026-10-19 photos). The ring and glow still say which.
      const big = shape.w * shape.h > 0.3 * win.innerWidth * win.innerHeight;
      ring(doc, c, shape, color, style && big ? { ...style, tint: 0 } : style);
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
      const note = (show && caps?.note) || '';
      if (noteEl.textContent !== note) noteEl.textContent = note; // our own words only
      noteEl.style.display = note ? 'flex' : 'none';
      if (!show || !a || !caps) {
        positionMenu();
        positionChip();
        return;
      }
      // Every tool in its place (Height: 3D only — 2D has no height); the ones that do not work, dimmed with their why.
      if (buttons.lift) buttons.lift.hidden = dim !== '3d';
      let offChanged = false;
      for (const k of kinds) {
        const why = caps.off?.[k] || undefined;
        if (offs[k] === why) continue;
        offChanged = true;
        const b = buttons[k];
        if (why) {
          offs[k] = why;
          b.classList.add('off');
          b.setAttribute('aria-disabled', 'true');
          b.title = why;
        } else {
          delete offs[k];
          b.classList.remove('off');
          b.removeAttribute('aria-disabled');
          b.title = tips[k] ?? '';
        }
      }
      if (offChanged) paintButtons();
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
        noteEl.style.display = 'none';
        positionMenu();
        return;
      }
      const tools = kinds.filter((k) => !buttons[k].hidden).length;
      // The Motion button counts as a button; its hairline adds 8.5 px either way (.5 + 3 + 3 and one more 2 px gap on
      // the mouse strip; .5 + 4 + 4 and no gaps on the finger strip).
      motionBtn.hidden = !motionShow;
      motionSep.hidden = !motionShow || tools === 0;
      const n = tools + (motionShow ? 1 : 0);
      if (n === 0) row.style.display = 'none';
      // .big (finger size): no gaps, 2 px in (W1-2); else 2 px gaps, 4 px in.
      const big = size >= 40;
      const sepW = motionSep.hidden ? 0 : 8.5;
      const rowW = (big ? n * size + 4 : n * size + (n - 1) * 2 + 4) + sepW;
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
      positionNote();
    },
    setAxis(axis, lang) {
      buttons.rotate.dataset.axis = axis;
      turnAxis = axis;
      turnLang = lang;
      paintTurn();
    },
    setTurnMode(mode) {
      if (mode === turnMode) return;
      turnMode = mode;
      buttons.rotate.dataset.mode = mode;
      paintTurn();
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
      const axes = !!opts.axes, several = !!opts.several;
      if (axes !== turnAxes || several !== turnSeveral || lang !== turnLang) {
        turnAxes = axes;
        turnSeveral = several;
        turnLang = lang;
        paintTurn();
      }
    },
    menu(kind, current, lang, turn) {
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
      /** One row of choices (the buttons go straight into `into`). */
      const choices = (into: HTMLElement, ck: Choice['kind'], words: Record<string, [string, string]>, icons: Record<string, string>, cur: string) => {
        for (const id of Object.keys(words)) {
          const b = doc.createElement('button');
          b.type = 'button';
          b.dataset.studioChoice = `${ck}:${id}`;
          b.setAttribute('role', 'menuitemradio');
          b.setAttribute('aria-checked', String(id === cur));
          if (id === cur) b.classList.add('chosen');
          b.title = `${words[id]![0]} — ${words[id]![1]}`;
          b.setAttribute('aria-label', words[id]![0]);
          b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[id]}</svg>`; // static markup only
          const t = doc.createElement('span');
          t.textContent = words[id]![0];
          b.append(t);
          into.append(b);
        }
      };
      const axes = kind === 'axis' && (!turn || turn.axes);
      const way = kind === 'axis' && turn ? turn.way : null;
      const wayIcons = { spread: turnWayIcon('spread'), inplace: TURN_WAY_ICONS.inplace };
      // One row as before (one object in 3D, the size button, 2D's turn with several); two rows in 3D with several.
      menuEl.classList.toggle('big', size >= 40);
      if (kind === 'scale') choices(menuEl, 'scale', SCALE_WORDS[lang] || SCALE_WORDS.en, SCALE_ICONS, current);
      else if (axes && way) {
        const top = doc.createElement('div'), sep = doc.createElement('div'), bottom = doc.createElement('div');
        top.className = bottom.className = 'mrow';
        top.setAttribute('role', 'group');
        bottom.setAttribute('role', 'group');
        sep.className = 'msep';
        sep.setAttribute('role', 'separator');
        choices(top, 'axis', AXIS_WORDS[lang] || AXIS_WORDS.en, AXIS_ICONS, current);
        choices(bottom, 'turn', TURN_WAY_WORDS[lang] || TURN_WAY_WORDS.en, wayIcons, way);
        menuEl.append(top, sep, bottom);
      } else if (way) choices(menuEl, 'turn', TURN_WAY_WORDS[lang] || TURN_WAY_WORDS.en, wayIcons, way);
      else choices(menuEl, 'axis', AXIS_WORDS[lang] || AXIS_WORDS.en, AXIS_ICONS, current);
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
    setMotion(m) {
      motionShow = !!m.show;
      motionBtn.classList.toggle('has', !!m.has);
      motionBtn.classList.toggle('on', !!m.open);
      motionBtn.setAttribute('aria-expanded', String(!!m.open));
      if (motionBtn.title !== m.label) {
        motionBtn.title = m.label;
        motionBtn.setAttribute('aria-label', m.label);
      }
    },
    toolRect: (k) => (buttons[k] && row.style.display !== 'none' && !buttons[k].hidden ? buttons[k].getBoundingClientRect() : null),
    motionRect: () => (motionShow && row.style.display !== 'none' && !motionBtn.hidden ? motionBtn.getBoundingClientRect() : null),
    setLabels(labels) {
      for (const k of kinds) {
        buttons[k].setAttribute('aria-label', labels[k]);
        // The turn button's tooltip names its axis (setAxis), with the key.
        if (k !== 'rotate' || !buttons[k].dataset.axis) tip(k, labels[k]);
      }
    },
    selection(shape, rects, tag) {
      tagAt(youTag, outline(selLayer, shape, rects, YOU, RING_YOU), tag);
    },
    hover(shape, rects) {
      outline(hoverLayer, shape, rects, YOU, RING_HOVER);
    },
    flash() {
      selLayer.classList.remove('flash');
      void selLayer.offsetWidth; // restart the animation
      selLayer.classList.add('flash');
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

/** The Motion button under a pointer event (its box in the page's px), or null. */
export function motionFromEvent(e: Event): DOMRect | null {
  for (const el of e.composedPath()) {
    if ((el as HTMLElement).dataset?.studioMotion !== undefined && (el as HTMLElement).tagName === 'BUTTON') return (el as HTMLElement).getBoundingClientRect();
  }
  return null;
}

/** The choice under a pointer event (the strip's menu), or null. */
export function choiceFromEvent(e: Event): Choice | null {
  for (const el of e.composedPath()) {
    const c = (el as HTMLElement).dataset?.studioChoice;
    if (c) {
      const [kind, id] = c.split(':') as [Choice['kind'], string];
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
