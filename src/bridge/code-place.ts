// The game's code layouts in the game page (studio-code-knobs, 2026-10-24; the plan's step 2, "hand and rule", its
// decisions 9–11 and 16). A layout is the game's codePlace() — "hex: four hexagons, Gap m
// apart" — whose objects the loader put (loader/studio-placement.js layOut). Here:
//
//   place/layout  the draft's `places` changed (a knob on the card, a pin, "Place individually", their ⌘Z): the layouts
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
//                 ⌥ (or a layout without `drag`, or another tool): the ordinary move — the shell keeps it as that one
//                 object's pin ("Manually overridden").
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
import type { BridgeToShell, Lang, PlaceCompareMarks, PlacementPlace, Pose, ShellToBridge, StudioAdapter } from '../contract.ts';
import { codeSpot, knobValues, relayCodePlace } from '../loader/studio-placement.js';
import { kindOf } from './code-lists.ts';

const VIOLET = '#a78bfa';
const YOU = '#ff6b1a';

type Win = Window & typeof globalThis;
/** A layout as the loader keeps it on globalThis (Symbol.for('game-studio.codePlaces')): plain fields only are read. */
interface Entry {
  id: string;
  name: string;
  knobs: Record<string, { v: number; label: string; unit: string; min?: number; max?: number; step?: number }>;
  drag?: string | { move?: string };
  keys: string[];
  objs: Array<{ position?: unknown; parent?: unknown; geometry?: unknown; scale?: unknown } | null>;
  spots?: Array<number[] | null>;
  home?: unknown;
}

// The words of the line and the chip ("rule", chosen on 10/24 with Gemini's wording of that day).
// The line is one line next to the strip (handles.ts .note, no wrap): in a narrow window (the side window, a phone) the
// layout's name goes ("Drag to adjust Gap · ⌥-drag to move one"), and with a finger the ⌥ part does (no ⌥ key there).
export const PLACE_WORDS: Record<Lang, { head: (name: string, n: number) => string; drag: (label: string) => string; alone: string; one: string; pinned: (name: string) => string; hand: string }> = {
  en: {
    head: (name, n) => `${name} ×${n} (rule): `,
    drag: (label) => `Drag to adjust ${label}`,
    alone: ' · ⌥-drag to move one',
    one: 'Moving one places it individually',
    pinned: (name) => `Manually overridden (${name})`,
    hand: 'Hand',
  },
  ja: {
    head: (name, n) => `${name} ×${n}（ルールの並び）: `,
    drag: (label) => `動かすと${label}が変わる`,
    alone: ' · ⌥+ドラッグで 1 個だけ',
    one: '動かすとこの 1 個だけ手動で配置',
    pinned: (name) => `この 1 個だけ手動で配置中（${name}）`,
    hand: '手',
  },
};
/** Narrower than this (css px), the line under the strip leaves the layout's name out (it was cut at 420 / 390). */
export const NOTE_FULL_PX = 600;
/** The line under the strip for one object of a layout: `narrow` = no name, `touch` = no ⌥ part. */
export function placeNote(lang: Lang, name: string, n: number, knobLabel: string | null, o: { narrow: boolean; touch: boolean }): string {
  const w = PLACE_WORDS[lang] ?? PLACE_WORDS.en;
  const what = knobLabel ? `${w.drag(knobLabel)}${o.touch ? '' : w.alone}` : w.one;
  return o.narrow ? what : `${w.head(name, n)}${what}`;
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

/** The knob a Move drag of one of its objects turns (codePlace `drag`: a name, or { move }), or null. */
export function dragKnob(p: Pick<Entry, 'drag' | 'knobs'>): string | null {
  const k = typeof p.drag === 'string' ? p.drag : p.drag && typeof p.drag === 'object' ? p.drag.move : undefined;
  return typeof k === 'string' && p.knobs && k in p.knobs ? k : null;
}

/**
 * The knob value in [lo, hi] that brings `spot(v)` nearest `want` (golden-section search, 30 steps: ~1e-6 of the range,
 * well under 1 ms for a formula). The distance is measured on the ground (3D x and z; 2D x and y). `whole` = an integer
 * knob (a count): the nearest of the two whole numbers round the best. A formula that does not reach `want` (beside a
 * row) gives the value that comes closest — the object stops at the edge, the layout stays a formula.
 */
export function findKnob(spot: (v: number) => number[] | null, want: number[], lo: number, hi: number, whole = false): number | null {
  const dist = (v: number) => {
    const q = spot(v);
    if (!q) return Infinity;
    return q.length === 3 ? Math.hypot(q[0]! - want[0]!, q[2]! - want[2]!) : Math.hypot(q[0]! - want[0]!, q[1]! - want[1]!);
  };
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
  /** The line under the strip for this object, or null (not a layout's). */
  note(key: string): string | null;
  /**
   * A Move drag of `key` starts (input.ts moveHandle, its first step): true = it turns the layout's knob (the rest of
   * the drag goes to dragTo / dragEnd); false = an ordinary move (⌥, no `drag` knob, not a layout's object).
   */
  dragStart(key: string, alone: boolean): boolean;
  /** The finger's spot for `key` (where an ordinary move would put it): the layout laid out again; its pose, and the chip. */
  dragTo(key: string, want: number[]): { pose: Pose; chip: string } | null;
  /** The drag ended (keep false = cancelled: back to the knob it had). */
  dragEnd(key: string, keep: boolean): void;
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
  // A drag that turns a knob: the layout, the knob, its number before, its number now, where the objects stood before.
  let drag: { id: string; key: string; i: number; knob: string; from: number; v: number; before: Array<number[] | null> } | null = null;
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
      // While a drag turns the knob: where they stood before, dashed, with an arrow to where they go.
      if (drag && drag.id === p.id) drag.before.forEach((q, i) => {
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
      draw();
    },
    note(key) {
      const p = layoutOf(key);
      if (!p || entryOf(p.id).hand) return null;
      if (pinned(p, key)) return (PLACE_WORDS[d.lang()] ?? PLACE_WORDS.en).pinned(p.name);
      const k = dragKnob(p);
      return placeNote(d.lang(), p.name, p.keys.length, k ? p.knobs[k]!.label : null,
        { narrow: win.innerWidth < NOTE_FULL_PX, touch: !!win.matchMedia?.('(pointer: coarse)').matches });
    },
    dragStart(key, alone) {
      drag = null;
      const p = layoutOf(key);
      const knob = p ? dragKnob(p) : null;
      if (!p || !knob || alone || entryOf(p.id).hand || pinned(p, key)) return false;
      const v = (knobValues(p.knobs, entryOf(p.id).knobs) as Record<string, number>)[knob]!;
      drag = { id: p.id, key, i: Number(key.slice(p.id.length + 1)) - 1, knob, from: v, v, before: (p.spots ?? []).map((q) => (q ? q.slice() : null)) };
      return true;
    },
    dragTo(key, want) {
      const p = drag && drag.key === key ? list().get(drag.id) : null;
      if (!drag || !p) return null;
      const dr = drag;
      const def = p.knobs[dr.knob]!;
      const k0 = knobValues(p.knobs, entryOf(p.id).knobs) as Record<string, number>;
      const [lo, hi] = knobRange(def);
      const found = findKnob((x) => codeSpot(p.id, dr.i, { ...k0, [dr.knob]: x }) as number[] | null, want, lo, hi, !!def.step && def.step >= 1);
      // The same steps as the card's knob (shell/knob.ts snapKnob): a hundredth of its range, so a drag gives "4.5 m".
      const q = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, (hi - lo) / 100))));
      const v = found === null ? null : def.step && def.step >= 1 ? found : Math.round(found / q) * q;
      if (v !== null && Math.abs(v - dr.v) > 1e-9) {
        dr.v = v;
        const e = entryOf(p.id);
        places = { ...places, [p.id]: { ...e, knobs: { ...(e.knobs ?? {}), [dr.knob]: { v } } } };
        relay([p.id]);
        d.post({ type: 'studio:place/knob', id: p.id, knob: dr.knob, v, end: false, key });
      }
      const pose = d.adapter().anchor(key)?.pose;
      const lang = d.lang();
      const u = unitText(lang, def.unit);
      return pose ? { pose, chip: `${def.label} ${knobText(dr.from, def.step)} → ${knobText(dr.v, def.step)}${u}` } : null;
    },
    dragEnd(key, keep) {
      const dr = drag;
      drag = null;
      drawn = '';
      if (!dr || dr.key !== key) return;
      if (!keep && dr.v !== dr.from) {
        const e = entryOf(dr.id);
        places = { ...places, [dr.id]: { ...e, knobs: { ...(e.knobs ?? {}), [dr.knob]: { v: dr.from } } } };
        relay([dr.id]);
      }
      d.post({ type: 'studio:place/knob', id: dr.id, knob: dr.knob, v: keep ? dr.v : dr.from, end: true, key });
      d.markDirty();
    },
  };
}
