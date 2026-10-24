// The game's code layouts in the game page (studio-code-knobs, 2026-10-24; the plan's step 2, "hand and rule", its
// decisions 9–11 and 16). A layout is the game's codePlace() — "hex: four hexagons, Gap m
// apart" — whose objects the loader put (loader/studio-placement.js layOut). Here:
//
//   place/layout  the draft's `places` changed (a knob on the card, a pin, "Convert to coordinates", their ⌘Z): the layouts
//                 are laid out again WHERE THEY STAND (relayCodePlace: the same objects move; a new count makes / takes
//                 out objects, then the list is sent again). Before (studio-code-base) every change read the whole game
//                 again — a second of a blank game for one number (the first step's report: "a layout's number reloads the game").
//   place/guide   the violet rings and dotted line of the picked object's layout (and the one under the mouse): where the
//                 rule puts each of its objects, an empty dashed ring where one is placed by hand, its "Hand" tag.
//                 Nothing to grab (the plan: "no points, no handles"): what the rule decides is changed by its knobs.
//   a drag        the picked object of a layout with a `drag` knob, moved with Move: the knob value that puts THIS object
//                 nearest the finger's spot on the ground is looked for (golden-section search over at() — the formula
//                 is never read, only run), and all its objects are laid out with it: the row follows, the object stops
//                 where the formula cannot reach (beside a row). place/knob goes to the shell (one ⌘Z, one Save count).
//                 ⌥: the ordinary move — the shell keeps it as that one object's pin ("Hand-placed").
//   by way        studio-to-coords (2026-10-24; a request that day: "a rule's object stays a rule however you touch it", and the
//                 CRYSTAL FIELD try of that day: a lamp of a row dragged away from the road did nothing and said nothing,
//                 and lifted or turned it silently became a pin). `drag` may name a knob per way — { along, side, up,
//                 turn, size }: Move turns along and side together (the numbers that bring it nearest the finger),
//                 Height up, Turn turn, Size size. A way with no knob does not move the object: the chip says why while
//                 the finger is down ("Sideways position is set by the rule · ⌥ for just this one"), and the shell says
//                 it again with ✦ when the drag ends where the rule cannot follow (place/held). WHY not move it and
//                 make a pin as before: the same drag gave "the whole row changes" one way and "this one leaves the
//                 rule" the other, without ⌥, and nobody saw it leave.
//   the line      the one line under the strip says, before a touch, which of the two a drag will do.
//   place/guide `compare`  ✦ Turn into a rule (studio-code-torule, 2026-10-24): where the hand-placed objects the
//                 layout replaced stood, until Save — an orange dot each (the hand's colour) and a thin line to where
//                 the rule's object of that number stands now, and over the farthest one the chip "lamp-3 · 0.6 m".
//                 Measured from what is on screen each frame, so a knob turned moves the lines and the number.
//
// WHY the look-up runs the game's at() (not a field the AI writes): "dragging one changes the formula's number, and
// the others follow" (the choice (a) of 10/24) must work for any rule the AI writes — a row, a spiral of
// lamps, a ring — and the editor only knows the rule by running it.
// WHY SVG in a shadow root, as timeline-path.ts: the same look in every engine, out of reach of the game's CSS.
import type { BridgeToShell, Lang, PlaceCompareMarks, PlacementPlace, PlaceWay, Pose, ShellToBridge, StudioAdapter } from '../contract.ts';
import { codePose, knobValues, relayCodePlace } from '../loader/studio-placement.js';
import { kindOf } from './code-lists.ts';

const VIOLET = '#a78bfa';
const YOU = '#ff6b1a';

type Win = Window & typeof globalThis;
/** A layout as the loader keeps it on globalThis (Symbol.for('game-studio.codePlaces')): plain fields only are read. */
interface Entry {
  id: string;
  name: string;
  knobs: Record<string, { v: number; label: string; unit: string; min?: number; max?: number; step?: number }>;
  drag?: string | Record<string, string>;
  keys: string[];
  objs: Array<{ position?: unknown; parent?: unknown; geometry?: unknown; scale?: unknown } | null>;
  spots?: Array<number[] | null>;
  home?: unknown;
}

// The words of the line and the chip ("rule", chosen on 10/24 with Gemini's wording of that day).
// The line is one line next to the strip (handles.ts .note, no wrap): in a narrow window (the side window, a phone) the
// layout's name goes ("Drag to adjust Gap · ⌥-drag to move one"), and with a finger the ⌥ part does (no ⌥ key there).
// studio-to-coords (2026-10-24): a way with no knob says so ("Height is set by the rule"), never "moving one places it
// individually" — without ⌥ a rule's object no longer leaves its rule. The shell's i18n.ts rule.held.* say the same.
export const PLACE_WORDS: Record<Lang, {
  head: (name: string, n: number) => string; drag: (labels: string[]) => string; alone: string; chipAlone: string;
  fixed: Record<PlaceWay, string>; pinned: (name: string) => string; hand: string;
}> = {
  en: {
    head: (name, n) => `${name} ×${n} (rule): `,
    drag: (labels) => `Drag to adjust ${labels.join(', ')}`,
    alone: ' · ⌥-drag to move one',
    chipAlone: ' · ⌥ for just this one',
    fixed: { along: 'Position along the row is set by the rule', side: 'Sideways position is set by the rule', move: 'Position is set by the rule',
      up: 'Height is set by the rule', turn: 'Angle is set by the rule', size: 'Size is set by the rule', group: 'Objects placed by a rule don’t move as a group' },
    pinned: (name) => `Hand-placed: just this one (${name})`,
    hand: 'Hand-placed',
  },
  ja: {
    head: (name, n) => `${name} ×${n}（ルールの並び）: `,
    drag: (labels) => `動かすと${labels.join('・')}が変わる`,
    alone: ' · ⌥+ドラッグで 1 個だけ',
    chipAlone: ' · ⌥ でこの 1 個だけ',
    fixed: { along: '並びに沿った位置はルールで決まっています', side: '横の位置はルールで決まっています', move: '場所はルールで決まっています',
      up: '高さはルールで決まっています', turn: '向きはルールで決まっています', size: '大きさはルールで決まっています', group: 'ルールで並んだ物はまとめて動かせません' },
    pinned: (name) => `手置き: この 1 個だけ（${name}）`,
    hand: '手置き',
  },
};
/** Narrower than this (css px), the line under the strip leaves the layout's name out (it was cut at 420 / 390). */
export const NOTE_FULL_PX = 600;
/**
 * The line under the strip for one object of a layout: what a drag with the tool does — the knobs it turns (`labels`),
 * or, with none for that way (`way`, default Move's), that the rule sets it. `narrow` = no name, `touch` = no ⌥ part.
 */
export function placeNote(lang: Lang, name: string, n: number, labels: string | string[] | null, o: { narrow: boolean; touch: boolean; way?: PlaceWay }): string {
  const w = PLACE_WORDS[lang] ?? PLACE_WORDS.en;
  const ls = labels === null ? [] : Array.isArray(labels) ? labels : [labels];
  const what = `${ls.length ? w.drag(ls) : w.fixed[o.way ?? 'move']}${o.touch ? '' : w.alone}`;
  return o.narrow ? what : `${w.head(name, n)}${what}`;
}
/** The chip while a drag does not move a rule's object that way: why, and (not on a finger) ⌥. */
export function heldChip(lang: Lang, way: PlaceWay, touch: boolean): string {
  const w = PLACE_WORDS[lang] ?? PLACE_WORDS.en;
  return `${w.fixed[way]}${touch || way === 'group' ? '' : w.chipAlone}`;
}
// The knobs' units as the person reads them (the shell's hands.unit.* say the same).
const UNITS: Record<Lang, Record<string, string>> = {
  en: { m: ' m', px: ' px', s: ' s', deg: '°', '%': '%', x: '×', 'm/s': ' m/s', 'px/s': ' px/s' },
  ja: { m: ' m', px: ' px', s: ' 秒', deg: '°', '%': '%', x: '×', 'm/s': ' m/秒', 'px/s': ' px/秒' },
};
/** A knob's number as the card writes it: an integer knob whole, others with up to two decimals. */
export function knobText(v: number, step?: number): string {
  if (step && step >= 1) return String(Math.round(v));
  const r = Math.round(v * 100) / 100;
  return String(r === 0 ? 0 : r);
}
export const unitText = (lang: Lang, unit: string) => (UNITS[lang] ?? UNITS.en)[unit] ?? (unit ? ` ${unit}` : '');
/** A gap as the card says it (shell/to-rule.ts gapText): 3D one decimal from 0.1 m, two below; 2D whole pixels. */
export function gapWords(lang: Lang, d: number, three: boolean): string {
  if (!three) return `${Math.round(d)}${unitText(lang, 'px')}`;
  return `${d >= 0.095 ? Math.round(d * 10) / 10 : Math.round(d * 100) / 100}${unitText(lang, 'm')}`;
}

/** The editor's tools a drag uses (handles.ts HandleKind). */
export type DragTool = 'move' | 'lift' | 'rotate' | 'scale';
type KnobWay = 'along' | 'side' | 'up' | 'turn' | 'size';
/** The ways each tool drags (Move: along and side together). */
const TOOL_WAYS: Record<DragTool, KnobWay[]> = { move: ['along', 'side'], lift: ['up'], rotate: ['turn'], scale: ['size'] };
/** The way a tool's drag is called when it has no knob (Move of a row: which of along / side is worked out from the drag). */
export const TOOL_WAY: Record<DragTool, PlaceWay> = { move: 'move', lift: 'up', rotate: 'turn', scale: 'size' };

/**
 * The knob each way a drag of one of its objects turns (codePlace `drag`): a name = Move's (along the row, as before
 * studio-to-coords); { along | move, side, up, turn, size } = one per way. Only knobs the layout has.
 */
export function dragKnobs(p: Pick<Entry, 'drag' | 'knobs'>): Partial<Record<KnobWay, string>> {
  const out: Partial<Record<KnobWay, string>> = {};
  const has = (k: unknown): k is string => typeof k === 'string' && !!p.knobs && k in p.knobs;
  if (typeof p.drag === 'string') {
    if (has(p.drag)) out.along = p.drag;
    return out;
  }
  if (!p.drag || typeof p.drag !== 'object') return out;
  const d = p.drag as Record<string, unknown>;
  const along = d.along ?? d.move;
  if (has(along)) out.along = along;
  for (const w of ['side', 'up', 'turn', 'size'] as const) if (has(d[w])) out[w] = d[w];
  return out;
}
/** The knobs a drag with `tool` turns (none: the rule decides that way), each once. */
export function toolKnobs(p: Pick<Entry, 'drag' | 'knobs'>, tool: DragTool): string[] {
  const k = dragKnobs(p);
  return [...new Set(TOOL_WAYS[tool].map((w) => k[w]).filter((x): x is string => !!x))];
}
/** The knob a Move drag of one of its objects turns first (codePlace `drag`: a name, or { along / move, side }), or null. */
export function dragKnob(p: Pick<Entry, 'drag' | 'knobs'>): string | null {
  const k = dragKnobs(p);
  return k.along ?? k.side ?? null;
}

/**
 * The knob value in [lo, hi] that brings `spot(v)` nearest `want` (golden-section search, 30 steps: ~1e-6 of the range,
 * well under 1 ms for a formula). The distance is measured on the ground (3D x and z; 2D x and y). `whole` = an integer
 * knob (a count): the nearest of the two whole numbers round the best. A formula that does not reach `want` (beside a
 * row) gives the value that comes closest — the object stops at the edge, the layout stays a formula.
 */
export function findKnob(spot: (v: number) => number[] | null, want: number[], lo: number, hi: number, whole = false): number | null {
  return findBy((v) => {
    const q = spot(v);
    if (!q) return Infinity;
    return q.length === 3 ? Math.hypot(q[0]! - want[0]!, q[2]! - want[2]!) : Math.hypot(q[0]! - want[0]!, q[1]! - want[1]!);
  }, lo, hi, whole);
}

/**
 * The value in [lo, hi] with the smallest `dist` (golden-section search, 30 steps), or null: findKnob's search for any
 * measure (studio-to-coords: a height, an angle, a size — not only a spot on the ground).
 */
export function findBy(dist: (v: number) => number, lo: number, hi: number, whole = false): number | null {
  if (!(hi > lo)) return null;
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = dist(c), fd = dist(d);
  for (let i = 0; i < 30; i++) {
    if (fc < fd) (b = d, d = c, fd = fc, c = b - g * (b - a), fc = dist(c));
    else (a = c, c = d, fc = fd, d = a + g * (b - a), fd = dist(d));
  }
  let v = (a + b) / 2;
  // The ends themselves (the search never tries them): a finger past the end of the range gets the end.
  for (const e of [lo, hi]) if (dist(e) < dist(v)) v = e;
  if (whole) {
    const f = Math.floor(v), k = Math.ceil(v);
    v = dist(f) <= dist(k) ? f : k;
  }
  return Number.isFinite(dist(v)) ? v : null;
}

/** A knob's search range: its min / max, else ten times round its number (a knob written without a range). */
export function knobRange(k: { v: number; min?: number; max?: number }): [number, number] {
  const span = Math.max(1, Math.abs(k.v)) * 10;
  return [typeof k.min === 'number' ? k.min : k.v > 0 ? 0 : k.v - span, typeof k.max === 'number' ? k.max : k.v + span];
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** One number for a size (a number, or the mean of one per axis); 1 = none given. */
const sizeOf = (s: number | number[] | undefined) => (typeof s === 'number' ? Math.abs(s) || 1 : Array.isArray(s) && s.length ? s.reduce((a, b) => a + Math.abs(b), 0) / s.length || 1 : 1);
/** A formula pose (loader codePose) as a Pose (the same fields). */
type RulePose = { p: number[]; r?: number; t?: [number, number]; s?: number | number[] };
/**
 * How far a rule's pose is from the pose a drag of `tool` asked for, in that tool's own measure: Move = the distance on
 * the ground (3D x, z; 2D x, y), Height = metres up, Turn = radians (round the up axis, and the tilt when the rule
 * gives one), Size = the log of the size ratio. The drag's look-up makes it smallest; what is left says whether the rule
 * could follow (studio-to-coords).
 */
export function poseGap(tool: DragTool, q: RulePose | null, want: Pose): number {
  if (!q || !q.p) return Infinity;
  if (tool === 'move') return q.p.length === 3 ? Math.hypot(q.p[0]! - want.p[0]!, q.p[2]! - (want.p[2] ?? 0)) : Math.hypot(q.p[0]! - want.p[0]!, q.p[1]! - want.p[1]!);
  if (tool === 'lift') return Math.abs((q.p[1] ?? 0) - (want.p[1] ?? 0));
  if (tool === 'rotate') {
    const tilt = q.t && want.t ? Math.hypot(wrapAngle(q.t[0] - want.t[0]), wrapAngle(q.t[1] - want.t[1])) : 0;
    return Math.hypot(wrapAngle((q.r ?? 0) - (want.r ?? 0)), tilt);
  }
  return Math.abs(Math.log(sizeOf(q.s) / sizeOf(want.s)));
}
/** Is the object somewhere else than its rule's pose (its place, and its turn / size when the rule gives them)? */
function offRule(q: RulePose | null, now: Pose | undefined): boolean {
  if (!q || !now) return false;
  if (q.p.some((v, i) => Math.abs(v - (now.p[i] ?? v)) > 1e-4)) return true;
  if (q.r !== undefined && Math.abs(wrapAngle(q.r - (now.r ?? 0))) > 1e-4) return true;
  return q.s !== undefined && Math.abs(Math.log(sizeOf(q.s) / sizeOf(now.s))) > 1e-4;
}
/** How much a drag of `tool` asked for, from `from` to `want`, in poseGap's measure. */
export function poseAsk(tool: DragTool, from: Pose, want: Pose): number {
  return poseGap(tool, { p: from.p, r: from.r, t: from.t, s: from.s }, want);
}
/**
 * Did the rule not follow the drag? What is left of it (poseGap after the look-up) is over 40 % of what the drag asked,
 * and more than a little (Move / Height: `px` on screen, 24 px; Turn: 8°; Size: 8 %) — a hand's wobble across a row is
 * not "sideways".
 */
export function ruleLags(tool: DragTool, left: number, asked: number, px?: { left: number; asked: number }): boolean {
  if (tool === 'move' || tool === 'lift') return !!px && px.left > 24 && px.left > 0.4 * px.asked;
  const floor = tool === 'rotate' ? (8 * Math.PI) / 180 : Math.log(1.08);
  return left > floor && left > 0.4 * asked;
}
/**
 * Which way a Move the rule did not follow went (studio-to-coords): along the row or away from it (a row: the line
 * through number i's neighbours), or just "this way" (anything else). `miss` = what was left, on the ground.
 */
export function moveWay(spots: Array<number[] | null>, i: number, miss: number[], line: boolean): PlaceWay {
  if (!line) return 'move';
  const a = spots[i - 1] ?? spots[i], b = spots[i + 1] ?? spots[i];
  if (!a || !b) return 'move';
  const g = (v: number[]) => (v.length === 3 ? [v[0]!, v[2]!] : [v[0]!, v[1]!]);
  const [ax, az] = g(a), [bx, bz] = g(b), [mx, mz] = g(miss);
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-9) return 'move';
  const along = Math.abs((mx * (bx - ax) + mz * (bz - az)) / len);
  const side = Math.abs((mx * (bz - az) - mz * (bx - ax)) / len);
  return along >= side ? 'along' : 'side';
}

export interface CodePlaceViewDeps {
  win: Win;
  adapter(): StudioAdapter;
  post(m: BridgeToShell): void;
  lang(): Lang;
  markDirty(): void;
  /** The world's list sent again (a new count made or took out objects): editor.ts refreshItems. */
  relist(): void;
}

export interface CodePlaceView {
  handle(msg: ShellToBridge): void;
  frame(): void;
  clear(): void;
  /** The line under the strip for this object with the chosen tool (none: Move), or null (not a layout's). */
  note(key: string, tool?: DragTool | null): string | null;
  /**
   * A drag of `key` with `tool` starts (input.ts moveHandle, its first step), before anything moves:
   *   'knob'  it turns the layout's knobs for that way (the rest of the drag goes to dragTo / dragEnd)
   *   'stop'  the rule has no knob for that way: nothing moves (stopChip while the finger is down, held at the end)
   *   'free'  ⌥: just this one, an ordinary move the shell keeps as its pin (the moves say `alone`)
   *   null    not a rule's object (a hand one, a layout placed by hand, one already put by hand): an ordinary move
   */
  dragStart(key: string, alone: boolean, tool?: DragTool): 'knob' | 'stop' | 'free' | null;
  /**
   * Where an ordinary drag would put `key` (its whole pose): the layout laid out again with the knobs that bring it
   * nearest; its pose, and the chip (the knobs' change, and why when the rule cannot follow that way).
   */
  dragTo(key: string, want: Pose, tool?: DragTool): { pose: Pose; chip: string } | null;
  /** The drag ended (keep false = cancelled: back to the knobs it had). The rule did not follow at the end: place/held. */
  dragEnd(key: string, keep: boolean): void;
  /**
   * A keep-out box being drawn / dragged (studio-code-keepout; keep-out.ts): layout `id` laid out again with `entry` (the
   * draft's entry with the box) — its objects step out of the box as it grows, and where they stood before shows dashed
   * with an arrow (the same picture as a knob's drag). The first call remembers where they stood.
   */
  preview(id: string, entry: PlacementPlace | null): void;
  /** The preview is over: how many of its objects moved (or have no place any more) since it began. */
  previewEnd(): number;
  /** The chip of a 'stop' drag (or of several picked, `group`): why it does not move. */
  stopChip(key: string, way: PlaceWay): string;
  /** A 'stop' drag ended after it travelled: the shell says why (place/held). */
  held(key: string, way: PlaceWay): void;
  /** Is `key` held by its rule (a layout's object, not put by hand)? Several picked: these stay unless ⌥. */
  ruled(key: string): boolean;
}

export function createCodePlaceView(d: CodePlaceViewDeps): CodePlaceView {
  const { win } = d;
  const doc = win.document;
  const host = doc.createElement('div');
  host.setAttribute('data-studio-ui', '');
  host.setAttribute('data-studio-code-place', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = `.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483645; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
text { font: 700 10px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; fill: #fff; }`;
  const root = doc.createElement('div');
  root.className = 'root';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg') as SVGSVGElement;
  root.append(svg);
  shadow.append(style, root);
  let mounted = false;

  // The draft's places (the shell's, with every guide / layout message): the pins, by hand, the knobs turned.
  let places: Record<string, PlacementPlace> = {};
  let guide: { ids: string[]; sel: string | null } = { ids: [], sel: null };
  // ✦ Turn into a rule (studio-code-torule): the hand-placed objects each layout replaced (the shell's, until Save).
  let compare: Record<string, PlaceCompareMarks> = {};
  // The layout of the object under the mouse (no button down): its rings too, before a press — "a layout's object tells
  // itself from a hand-placed one before it is touched" (the plan's need 2, n2-tell). Read once a frame (pickNear).
  let hoverId: string | null = null;
  let hoverAt: { x: number; y: number } | null = null;
  // A drag that turns knobs: the layout, the tool, its knobs with their numbers before and now, where the objects stood
  // before, the pose the object had, and the way the rule did not follow (null: it followed) at the last step.
  let drag: { id: string; key: string; i: number; tool: DragTool; knobs: string[]; from: Record<string, number>; v: Record<string, number>;
    before: Array<number[] | null>; start: Pose | null; lag: PlaceWay | null } | null = null;
  // A keep-out box being drawn (studio-code-keepout): the layout and where its objects stood when it began.
  let moving: { id: string; before: Array<number[] | null> } | null = null;
  let drawn = '';
  // Each object's ring (world radius, offset from its pivot to its foot), worked out once per object.
  const rings = new Map<string, { r: number; foot: number[] }>();
  // Each layout's look (a row is joined by a line; code-lists.ts kindOf runs its at()), worked out once per layout out.
  const kinds = new Map<string, string | null>();

  const list = (): Map<string, Entry> => {
    const m = (win as unknown as Record<symbol, unknown>)[Symbol.for('game-studio.codePlaces')];
    return m instanceof Map ? (m as Map<string, Entry>) : new Map();
  };
  const layoutOf = (key: string): Entry | null => {
    for (const p of list().values()) if (p.keys?.includes(key)) return p;
    return null;
  };
  const entryOf = (id: string): PlacementPlace => places[id] ?? {};
  const pinned = (p: Entry, key: string) => !!entryOf(p.id).pins?.[key];
  // The way a Move missed, unless the layout has a knob for it (then it is the end of that knob's range, not a way the
  // rule keeps: a gap at its largest).
  const uncovered = (p: Entry, way: PlaceWay): PlaceWay | null => ((way === 'along' || way === 'side') && dragKnobs(p)[way] ? null : way);
  // A finger (no ⌥ key there): the words leave the ⌥ part out.
  const touch = () => !!win.matchMedia?.('(pointer: coarse)').matches;

  /** Lay out these layouts again with the draft; moved objects go to the shell (made / taken out: a new list). */
  function relay(ids: string[]) {
    const all = list();
    const poses: Array<{ key: string; pose: Pose }> = [];
    let listAgain = false;
    for (const id of ids) {
      const p = all.get(id);
      if (!p) continue;
      const before = p.keys.join('\n');
      if (!relayCodePlace(id, entryOf(id))) continue;
      kinds.delete(id);
      if (p.keys.join('\n') !== before) listAgain = true;
      for (const k of p.keys) {
        rings.delete(k);
        const a = d.adapter().anchor(k);
        if (a) poses.push({ key: k, pose: a.pose });
      }
    }
    if (listAgain) d.relist();
    else if (poses.length) d.post({ type: 'studio:place/poses', poses });
    drawn = '';
    d.markDirty();
  }

  /** Scene space ← the layout's root space (its objects' parent; a scene at the top is the same). */
  const toScene = (p: Entry, v: number[]): number[] => {
    const home = p.home as { root?: { parent?: unknown; matrixWorld?: { elements: number[] } } } | undefined;
    const m = home?.root?.parent && home.root.matrixWorld ? home.root.matrixWorld.elements : null;
    if (!m || v.length !== 3) return v;
    const [x, y, z] = v as [number, number, number];
    return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
  };

  /** An object's ring: about its width on screen, at its foot (3D), measured once (and again after a relayout). */
  function ringOf(p: Entry, key: string): { r: number; foot: number[] } {
    const known = rings.get(key);
    if (known) return known;
    const a = d.adapter();
    const pose = a.anchor(key)?.pose;
    const foot = a.foot?.(key) ?? null;
    const off = pose && foot && pose.p.length === 3 ? foot.map((v, i) => v - toScene(p, pose.p)[i]!) : [0, 0, 0];
    let r = a.dim === '3d' ? 0.6 : 24;
    const an = a.anchor(key);
    if (a.dim === '3d' && an?.rect && pose && a.toScreen) {
      const c = toScene(p, pose.p);
      const s0 = a.toScreen(c), s1 = a.toScreen([c[0]! + 1, c[1]!, c[2]!]);
      const ppm = s0 && s1 ? Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) : 0;
      if (ppm > 1) r = Math.max(0.2, Math.min(4, (an.rect.w / 2 / ppm) * 0.85));
    } else if (an?.rect) r = Math.max(8, an.rect.w / 2);
    const out = { r, foot: off };
    rings.set(key, out);
    return out;
  }

  const draw = () => {
    const a = d.adapter();
    if (hoverAt) {
      const at = hoverAt;
      hoverAt = null;
      let k: string | undefined;
      try {
        k = a.pickNear(at.x, at.y, 2)[0];
      } catch {
        k = undefined;
      }
      const p = k ? layoutOf(k) : null;
      hoverId = p && !entryOf(p.id).hand ? p.id : null;
    }
    const ids = hoverId && !guide.ids.includes(hoverId) ? [...guide.ids, hoverId] : guide.ids;
    const shown = ids.map((id) => list().get(id)).filter((p): p is Entry => !!p && !entryOf(p.id).hand && !!p.spots);
    if (!shown.length || !a.toScreen) {
      if (svg.firstChild) svg.replaceChildren();
      drawn = '';
      return;
    }
    const three = a.dim === '3d';
    // A ring on the ground round `c` (3D: 24 points of a circle; 2D: an ellipse on the screen).
    const ringAt = (c: number[], r: number): Array<[number, number]> | null => {
      if (!three) {
        const s = a.toScreen!(c);
        return s ? Array.from({ length: 25 }, (_, j) => [s[0] + r * Math.cos((j / 24) * 2 * Math.PI), s[1] + r * 0.4 * Math.sin((j / 24) * 2 * Math.PI)] as [number, number]) : null;
      }
      const out: Array<[number, number]> = [];
      for (let j = 0; j <= 24; j++) {
        const t = (j / 24) * 2 * Math.PI;
        const s = a.toScreen!([c[0]! + r * Math.cos(t), c[1]!, c[2]! + r * Math.sin(t)]);
        if (!s) return null;
        out.push(s);
      }
      return out;
    };
    const parts: Array<{ kind: 'ring' | 'line' | 'tag' | 'old' | 'was' | 'gap' | 'chip'; pts: Array<[number, number]>; dash?: boolean; on?: boolean; text?: string; side?: -1 | 1 }> = [];
    for (const p of shown) {
      const spots = p.spots!;
      const centres: Array<[number, number] | null> = [];
      spots.forEach((q, i) => {
        const key = `${p.id}-${i + 1}`;
        if (!q) return void centres.push(null);
        const has = p.keys.includes(key);
        const ring = has ? ringOf(p, key) : { r: three ? 0.6 : 24, foot: [0, 0, 0] };
        const c = toScene(p, q).map((v, j) => v + (ring.foot[j] ?? 0));
        const pts = ringAt(c, ring.r);
        const pin = pinned(p, key);
        if (pts) parts.push({ kind: 'ring', pts, dash: pin, on: key === guide.sel });
        centres.push(a.toScreen!(c));
        // A pinned one: its "Hand" tag over it (where it stands now).
        if (pin && has) {
          const an = a.anchor(key);
          if (an?.visible) parts.push({ kind: 'tag', pts: [[an.center[0], (an.rect ? an.rect.y : an.center[1] - 20) - 8]], text: (PLACE_WORDS[d.lang()] ?? PLACE_WORDS.en).hand });
        }
      });
      // A row: the rings joined in order by a dotted line (a scatter is not a line: no line).
      if (!kinds.has(p.id)) kinds.set(p.id, kindOf(p as unknown as Record<string, unknown>));
      const isLine = kinds.get(p.id) === 'line';
      if (isLine) for (let i = 1; i < centres.length; i++) if (centres[i - 1] && centres[i]) parts.push({ kind: 'line', pts: [centres[i - 1]!, centres[i]!] });
      // ✦ Turn into a rule: where the hand-placed ones stood (orange dots), a thin line to the rule's object of the same
      // number where it stands now, and the chip over the farthest. The same distance as the card's (the whole one).
      const cmp = compare[p.id];
      if (cmp) {
        let far: { at: [number, number]; to: [number, number] | null; d: number; name: string } | null = null;
        cmp.was.forEach((w, i) => {
          if (!w) return;
          const key = `${p.id}-${i + 1}`;
          const ring = p.keys.includes(key) ? ringOf(p, key) : { r: three ? 0.6 : 24, foot: [0, 0, 0] };
          const s0 = a.toScreen!(toScene(p, w).map((v, j) => v + (ring.foot[j] ?? 0)));
          if (!s0) return;
          const now = p.keys.includes(key) ? a.anchor(key)?.pose.p : null;
          const s1 = now ? a.toScreen!(toScene(p, now).map((v, j) => v + (ring.foot[j] ?? 0))) : null;
          if (s1 && Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) > 2) parts.push({ kind: 'gap', pts: [s0, s1] });
          parts.push({ kind: 'was', pts: [s0] });
          const dd = now && now.length === w.length ? Math.hypot(...w.map((v, j) => v - now[j]!)) : null;
          if (dd !== null && (!far || dd > far.d + 1e-9)) far = { at: s0, to: s1, d: dd, name: cmp.names[i] ?? key };
        });
        // The chip beside the farthest dot, on the side away from the rule's object (over it, the object's own outline
        // and the strip cut it: the first picture of 10/24).
        const f = far as { at: [number, number]; to: [number, number] | null; d: number; name: string } | null;
        if (f) parts.push({ kind: 'chip', pts: [f.at], side: f.to && f.to[0] > f.at[0] ? -1 : 1, text: `${f.name} · ${gapWords(d.lang(), f.d, three)}` });
      }
      // While a drag turns the knob (or a keep-out box is drawn): where they stood before, dashed, with an arrow to where they go.
      const before = drag && drag.id === p.id ? drag.before : moving && moving.id === p.id ? moving.before : null;
      if (before) before.forEach((q, i) => {
        const now = spots[i];
        if (!q || !now) return;
        const key = `${p.id}-${i + 1}`;
        const ring = p.keys.includes(key) ? ringOf(p, key) : { r: three ? 0.6 : 24, foot: [0, 0, 0] };
        const c0 = toScene(p, q).map((v, j) => v + (ring.foot[j] ?? 0));
        const c1 = toScene(p, now).map((v, j) => v + (ring.foot[j] ?? 0));
        const pts = ringAt(c0, ring.r);
        const s0 = a.toScreen!(c0), s1 = a.toScreen!(c1);
        if (pts && s0 && s1 && Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) > 6) parts.push({ kind: 'old', pts }, { kind: 'old', pts: [s0, s1] });
      });
    }
    const sig = JSON.stringify(parts);
    if (sig === drawn) return;
    drawn = sig;
    if (!mounted && doc.body) (doc.body.append(host), (mounted = true));
    svg.replaceChildren();
    const path = (pts: Array<[number, number]>, stroke: string, width: number, dash?: string, close = false) => {
      const el = doc.createElementNS(NS, 'path');
      el.setAttribute('d', pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('') + (close ? 'Z' : ''));
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', stroke);
      el.setAttribute('stroke-width', String(width));
      el.setAttribute('stroke-linecap', 'round');
      if (dash) el.setAttribute('stroke-dasharray', dash);
      svg.append(el);
    };
    for (const x of parts) {
      if (x.kind === 'line') (path(x.pts, 'rgba(0,0,0,.35)', 4), path(x.pts, VIOLET, 1.6, '4 5'));
      else if (x.kind === 'old') path(x.pts, 'rgba(255,255,255,.55)', 1.2, '3 4', x.pts.length > 2);
      else if (x.kind === 'gap') (path(x.pts, 'rgba(0,0,0,.35)', 3), path(x.pts, YOU, 1.2));
      else if (x.kind === 'was') {
        const [cx, cy] = x.pts[0]!;
        const c = doc.createElementNS(NS, 'circle');
        c.setAttribute('cx', cx.toFixed(1));
        c.setAttribute('cy', cy.toFixed(1));
        c.setAttribute('r', '4');
        c.setAttribute('fill', YOU);
        c.setAttribute('stroke', '#fff');
        c.setAttribute('stroke-width', '1.2');
        c.setAttribute('data-part', 'place-was');
        svg.append(c);
      }
      else if (x.kind === 'ring') {
        path(x.pts, 'rgba(0,0,0,.35)', 4, undefined, true);
        path(x.pts, x.on ? '#c4b5fd' : VIOLET, x.on ? 2.2 : 1.6, x.dash ? '4 4' : undefined, true);
      } else if ((x.kind === 'tag' || x.kind === 'chip') && x.text) {
        // About the text's width at 10 px bold: a kana / kanji is twice as wide as a Latin letter (a Japanese name's chip).
        const w = 10 + [...x.text].reduce((n, ch) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 10.5 : 6.4), 0);
        // A chip with a side sits beside its point (8 px off), else centred on it (a tag over its object).
        const cx = x.pts[0]![0] + (x.side ? x.side * (w / 2 + 8) : 0);
        const cy = x.pts[0]![1];
        const r = doc.createElementNS(NS, 'rect');
        r.setAttribute('x', (cx - w / 2).toFixed(1));
        r.setAttribute('y', (cy - 9).toFixed(1));
        r.setAttribute('width', String(w));
        r.setAttribute('height', '16');
        r.setAttribute('rx', '4');
        r.setAttribute('fill', YOU);
        const tx = doc.createElementNS(NS, 'text');
        tx.setAttribute('x', (cx - w / 2 + 5).toFixed(1));
        tx.setAttribute('y', (cy + 3).toFixed(1));
        tx.textContent = x.text;
        if (x.kind === 'chip') r.setAttribute('data-part', 'place-gap-chip');
        svg.append(r, tx);
      }
    }
  };

  // The mouse over the game (never taken: the game's own listeners and input.ts see the same move).
  win.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    hoverAt = { x: e.clientX, y: e.clientY };
    d.markDirty();
  }, { capture: true, passive: true });
  // Out of the game page (into the editor's panels): no layout under the mouse any more.
  win.addEventListener('pointerout', (e) => {
    if (e.relatedTarget || !hoverId) return;
    hoverId = null;
    hoverAt = null;
    d.markDirty();
  }, { capture: true, passive: true });

  return {
    handle(msg) {
      if (msg.type === 'studio:place/layout') {
        places = structuredClone(msg.places ?? {});
        relay(msg.ids ?? [...list().keys()]);
      } else if (msg.type === 'studio:place/guide') {
        guide = { ids: msg.ids.slice(), sel: msg.sel };
        if (msg.places) places = structuredClone(msg.places);
        compare = structuredClone(msg.compare ?? {});
        drawn = '';
        d.markDirty();
      }
    },
    frame: draw,
    clear() {
      guide = { ids: [], sel: null };
      drag = null;
      moving = null;
      draw();
    },
    note(key, tool) {
      const p = layoutOf(key);
      if (!p || entryOf(p.id).hand) return null;
      if (pinned(p, key)) return (PLACE_WORDS[d.lang()] ?? PLACE_WORDS.en).pinned(p.name);
      const t = tool ?? 'move';
      return placeNote(d.lang(), p.name, p.keys.length, toolKnobs(p, t).map((k) => p.knobs[k]!.label),
        { narrow: win.innerWidth < NOTE_FULL_PX, touch: touch(), way: TOOL_WAY[t] });
    },
    dragStart(key, alone, tool = 'move') {
      drag = null;
      const p = layoutOf(key);
      if (!p || entryOf(p.id).hand || pinned(p, key)) return null;
      if (alone) return 'free';
      const knobs = toolKnobs(p, tool);
      if (!knobs.length) return 'stop';
      const v = knobValues(p.knobs, entryOf(p.id).knobs) as Record<string, number>;
      const from = Object.fromEntries(knobs.map((k) => [k, v[k]!]));
      drag = { id: p.id, key, i: Number(key.slice(p.id.length + 1)) - 1, tool, knobs, from, v: { ...from },
        before: (p.spots ?? []).map((q) => (q ? q.slice() : null)), start: d.adapter().anchor(key)?.pose ?? null, lag: null };
      return 'knob';
    },
    dragTo(key, want) {
      const p = drag && drag.key === key ? list().get(drag.id) : null;
      if (!drag || !p) return null;
      const dr = drag;
      const k0 = knobValues(p.knobs, entryOf(p.id).knobs) as Record<string, number>;
      const at = (k: Record<string, number>) => codePose(p.id, dr.i, k) as RulePose | null;
      const gap = (k: Record<string, number>) => poseGap(dr.tool, at(k), want);
      // Each knob in turn (Move: along, then side, three rounds — enough for a row's gap and its distance from the road,
      // which do not pull against each other); the same steps as the card's knob after (shell/knob.ts snapKnob: a
      // hundredth of its range, so a drag gives "4.5 m").
      const k = { ...k0 };
      for (let round = 0; round < (dr.knobs.length > 1 ? 3 : 1); round++) for (const name of dr.knobs) {
        const def = p.knobs[name]!;
        const [lo, hi] = knobRange(def);
        const found = findBy((x) => gap({ ...k, [name]: x }), lo, hi, !!def.step && def.step >= 1);
        if (found !== null) k[name] = found;
      }
      const next: Record<string, number> = {};
      for (const name of dr.knobs) {
        const def = p.knobs[name]!;
        const [lo, hi] = knobRange(def);
        const q = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, (hi - lo) / 100))));
        next[name] = def.step && def.step >= 1 ? k[name]! : Math.round(k[name]! / q) * q;
      }
      if (dr.knobs.some((n) => Math.abs(next[n]! - dr.v[n]!) > 1e-9)) {
        dr.v = next;
        const e = entryOf(p.id);
        const ks = { ...(e.knobs ?? {}) };
        for (const n of dr.knobs) ks[n] = { v: next[n]! };
        places = { ...places, [p.id]: { ...e, knobs: ks } };
        relay([p.id]);
        d.post({ type: 'studio:place/knob', id: p.id, knob: dr.knobs[0]!, v: next[dr.knobs[0]!]!, end: false, key, knobs: { ...next } });
      } else if (offRule(at(dr.v), d.adapter().anchor(key)?.pose)) {
        // The same numbers: the ordinary step has still moved this one object (input.ts drags it, then asks here) — back
        // where the rule puts it. Before studio-to-coords it stayed under the finger until the drag ended (a lamp dragged
        // sideways followed the finger, then jumped back on release).
        relay([p.id]);
      }
      // Did the rule follow? What is left of the drag, against what it asked (on screen for Move / Height).
      const now = at(dr.v);
      const left = poseGap(dr.tool, now, want);
      const asked = dr.start ? poseAsk(dr.tool, dr.start, want) : left;
      let px: { left: number; asked: number } | undefined;
      const a = d.adapter();
      if ((dr.tool === 'move' || dr.tool === 'lift') && a.toScreen && now?.p) {
        const sw = a.toScreen(toScene(p, want.p)), sn = a.toScreen(toScene(p, now.p)), s0 = dr.start ? a.toScreen(toScene(p, dr.start.p)) : null;
        if (sw && sn) px = { left: Math.hypot(sw[0] - sn[0], sw[1] - sn[1]), asked: s0 ? Math.hypot(sw[0] - s0[0], sw[1] - s0[1]) : Infinity };
      }
      // Both of Move's knobs there and the rule still short: the end of a knob's range — the object stops at the edge,
      // the chip shows the knob at its end (no "why": every way is the rule's to follow).
      dr.lag = !ruleLags(dr.tool, left, asked, px) ? null
        : dr.tool === 'move' ? (dr.knobs.length > 1 ? null : uncovered(p, moveWay(p.spots ?? [], dr.i, want.p.map((v, j) => v - (now?.p[j] ?? v)), kindOf(p as unknown as Record<string, unknown>) === 'line')))
        : TOOL_WAY[dr.tool];
      const pose = a.anchor(key)?.pose;
      const lang = d.lang();
      const turned = dr.knobs.filter((n) => Math.abs(dr.v[n]! - dr.from[n]!) > 1e-9);
      const said = (turned.length ? turned : dr.knobs.slice(0, 1)).map((n) => {
        const def = p.knobs[n]!;
        return `${def.label} ${knobText(dr.from[n]!, def.step)} → ${knobText(dr.v[n]!, def.step)}${unitText(lang, def.unit)}`;
      });
      const why = dr.lag ? heldChip(lang, dr.lag, touch()) : '';
      return pose ? { pose, chip: !turned.length && why ? why : [...said, why].filter(Boolean).join(' · ') } : null;
    },
    preview(id, entry) {
      const p = list().get(id);
      if (!p) return;
      if (!moving || moving.id !== id) moving = { id, before: (p.spots ?? []).map((q) => (q ? q.slice() : null)) };
      places = { ...places };
      if (entry) places[id] = structuredClone(entry);
      else delete places[id];
      relay([id]);
    },
    previewEnd() {
      const mv = moving;
      moving = null;
      drawn = '';
      d.markDirty();
      const now = mv ? list().get(mv.id)?.spots ?? [] : [];
      return mv ? mv.before.filter((q, i) => q && (!now[i] || now[i]!.some((v, j) => Math.abs(v - q[j]!) > 1e-6))).length : 0;
    },
    dragEnd(key, keep) {
      const dr = drag;
      drag = null;
      drawn = '';
      if (!dr || dr.key !== key) return;
      const changed = dr.knobs.some((n) => dr.v[n] !== dr.from[n]);
      if (!keep && changed) {
        const e = entryOf(dr.id);
        const ks = { ...(e.knobs ?? {}) };
        for (const n of dr.knobs) ks[n] = { v: dr.from[n]! };
        places = { ...places, [dr.id]: { ...e, knobs: ks } };
        relay([dr.id]);
      }
      const end = keep ? dr.v : dr.from;
      d.post({ type: 'studio:place/knob', id: dr.id, knob: dr.knobs[0]!, v: end[dr.knobs[0]!]!, end: true, key, knobs: { ...end } });
      // The finger let go where the rule could not follow (a lamp dragged away from the road): the shell says why.
      if (keep && dr.lag) d.post({ type: 'studio:place/held', id: dr.id, key, way: dr.lag });
      d.markDirty();
    },
    stopChip(key, way) {
      void key;
      return heldChip(d.lang(), way, touch());
    },
    held(key, way) {
      const p = layoutOf(key);
      if (p) d.post({ type: 'studio:place/held', id: p.id, key, way });
    },
    ruled(key) {
      const p = layoutOf(key);
      return !!p && !entryOf(p.id).hand && !pinned(p, key);
    },
  };
}
