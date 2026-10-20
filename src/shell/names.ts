// The name a person reads for an object in the list and on the card (polish pass 2026-10-16, play test
// stumble 8: the list showed "No name" with `path:8` next to it, and two rows both called "tree").
//
// WHY here and not in the adapters: the key (`path:6`, `tree#2`) is the editor's and the AI's handle and must not
// change; only what is SHOWN changes. A tree path means nothing to a newcomer, so an object without a name is
// called by what it looks like: the picture file it draws ("rock" for rock.svg), else a name guessed from its shape,
// colour, size and place (below), else its kind ("Unnamed shape").
// The key stays in the row's tooltip and in everything sent to the AI.
//
// Guessed names (a hands-on try, 2026-10-19, item 3): an AI-written runner built its pillars as `new Group()` of a black
// box and a pink lid, and the card, the list and the ask bar all read "Unnamed group" — "group"
// is three.js's word, and nobody could tell which of 20 it was. Now the adapter reports what an unnamed object looks
// like (Item.look: world box, main colour, drawn from inside) and the editor says it in words:
// "Black pillar by the road (left, 3rd)" (in Japanese the same words), the road "Road", the sky dome "Sky", the player
// "Blue box".
// - Shape: from the box's proportions (tall = pillar, flat and large = ground / road, …) and the geometry kind.
// - Colour: the main part's (the body, not the thin lid); left out for sky / ground / road unless two need it.
// - Size: "big" / "small" only when two kinds would otherwise read the same.
// - Place: "by the road" when a road is there and it stands at its edge; "left / right" and "3rd" only when several
//   read the same (the count goes from the camera's side, +z, the way three.js games face).
// Names are worked out once per set of objects, from where each one stood when first seen, so a name does not change
// while it is dragged (moving "left, 3rd" to the right keeps calling it that until the game reloads).
import type { Item, Lang } from '../contract.ts';

/** Kind tags (adapters' Item.kinds) → the i18n word for "an unnamed one of these". */
const KIND_WORD: Record<string, string> = {
  sprite: 'picture', text: 'text', graphics: 'shape', container: 'group', group: 'group', model: 'model',
  box: 'shape', sphere: 'shape', plane: 'shape', cylinder: 'shape', cone: 'shape', mesh: 'shape',
};

/** The file name without folder and extension, when `group` is a picture / model URL or path. */
export function fileStem(group: string | undefined): string | null {
  if (!group || !/\.(png|jpe?g|webp|gif|svg|avif|glb|gltf)(\?|#|$)/i.test(group)) return null;
  const last = group.split(/[?#]/)[0]!.split('/').pop() || '';
  const stem = decodeURIComponentSafe(last).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  return stem || null;
}
function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ----- guessed names -----

type Noun = 'sky' | 'road' | 'ground' | 'panel' | 'wall' | 'building' | 'pillar' | 'bar' | 'ball' | 'ring' | 'cone' | 'cylinder' | 'box' | 'thing';
type Hue = 'black' | 'white' | 'gray' | 'red' | 'orange' | 'brown' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink';
/** Scenery: called by its shape alone ("Road", not "Gray road") unless two of them need the colour. */
const SCENERY = new Set<Noun>(['sky', 'road', 'ground']);
/** Long things take the counter for long things in Japanese ("3rd" of pillars), the rest the general one. */
const LONG = new Set<Noun>(['pillar', 'bar', 'cylinder']);

// The words, per language. Here and not in i18n.ts: they are put together by grammar (Japanese adjectives before the
// noun with their particles, English capitalised and with ordinals), not looked up as whole lines.
const WORDS: Record<Lang, { noun: Record<Noun, string>; hue: Record<Hue, string>; big: string; small: string; left: string; right: string }> = {
  en: {
    noun: { sky: 'sky', road: 'road', ground: 'ground', panel: 'panel', wall: 'wall', building: 'building', pillar: 'pillar', bar: 'bar', ball: 'ball', ring: 'ring', cone: 'cone', cylinder: 'cylinder', box: 'box', thing: 'object' },
    hue: { black: 'black', white: 'white', gray: 'gray', red: 'red', orange: 'orange', brown: 'brown', yellow: 'yellow', green: 'green', cyan: 'light blue', blue: 'blue', purple: 'purple', pink: 'pink' },
    big: 'big', small: 'small', left: 'left', right: 'right',
  },
  ja: {
    noun: { sky: '空', road: '道路', ground: '地面', panel: '板', wall: '壁', building: '建物', pillar: '柱', bar: '棒', ball: '玉', ring: '輪', cone: '円すい', cylinder: '筒', box: '箱', thing: '物' },
    hue: { black: '黒い', white: '白い', gray: '灰色の', red: '赤い', orange: 'オレンジの', brown: '茶色の', yellow: '黄色い', green: '緑の', cyan: '水色の', blue: '青い', purple: '紫の', pink: 'ピンクの' },
    big: '大きな', small: '小さな', left: '左', right: '右',
  },
};

/** A colour word from #rrggbb (hue buckets; dark / light / grey first). */
export function hueOf(hex: string | undefined): Hue | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l < 0.13) return 'black';
  if (s < 0.15 || d < 0.08) return l > 0.85 ? 'white' : l < 0.2 ? 'black' : 'gray';
  if (l > 0.94) return 'white';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return l > 0.72 ? 'pink' : 'red';
  if (h < 40) return l < 0.4 ? 'brown' : 'orange';
  if (h < 66) return l < 0.3 ? 'brown' : 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

type Guessable = Pick<Item, 'key' | 'kinds' | 'unstable' | 'look' | 'copyOf' | 'group'> & { pose?: { p: number[] } };

/** The shape word from the box's proportions and the geometry kind. `ref` = the usual size of things in this scene. */
function nounOf(it: Guessable, ref: number): Noun {
  const look = it.look!;
  const [w = 0, h = 0, d = 0] = look.size;
  const kinds = it.kinds || [];
  const across = Math.max(w, d), thin = Math.min(w, d), big = Math.max(w, h, d);
  const is = (k: string) => kinds.includes(k);
  if ((is('sphere') || look.inside) && (look.inside || big > 20 * ref)) return 'sky';
  if (h <= 0.1 * across) {
    if (across >= 4 * ref) return across >= 3 * Math.max(thin, 1e-6) ? 'road' : 'ground';
    return 'panel';
  }
  if (is('torus')) return 'ring';
  if (is('sphere') || is('icosahedron') || is('dodecahedron')) return 'ball';
  if (is('cone')) return 'cone';
  if (h >= 2 * across) return 'pillar';
  if (thin <= 0.15 * across && h >= 0.4 * across) return 'wall';
  if (h >= 1.2 * across && big >= 2.5 * ref) return 'building';
  if (across >= 3 * Math.max(thin, h)) return 'bar';
  if (is('cylinder')) return 'cylinder';
  if (is('box')) return 'box';
  return 'thing';
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 1;
};
const ordinal = (n: number) => {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th'}`;
};

/**
 * Names for the unnamed objects that report a look (Item.look), all different from each other. Pure: the same
 * objects give the same names. Objects without a look, and copies (they read as their original, with the copy tag),
 * are left out.
 */
export function guessNames(items: Guessable[], lang: Lang): Map<string, string> {
  const W = WORDS[lang] || WORDS.en;
  const ja = lang === 'ja';
  const all = items.filter((i) => i.unstable && i.look && i.look.size?.length >= 2 && !i.copyOf);
  const out = new Map<string, string>();
  if (!all.length) return out;
  const sizeOf = (i: Guessable) => Math.max(...i.look!.size);
  const ref = Math.max(1e-3, median(all.filter((i) => !i.look!.inside).map(sizeOf)));
  const mid = (i: Guessable) => i.look!.c || i.pose?.p || [0, 0, 0];
  type G = { it: Guessable; noun: Noun; hue: Hue | null; road: boolean; color: boolean; size: '' | 'big' | 'small'; where: string[] };
  const gs: G[] = all.map((it) => ({ it, noun: nounOf(it, ref), hue: hueOf(it.look!.color), road: false, color: false, size: '', where: [] }));
  for (const g of gs) g.color = !SCENERY.has(g.noun) && !!g.hue;
  // "By the road": one road, and the thing stands near its edge (beside it, or on it near the side) across the road.
  const roads = gs.filter((g) => g.noun === 'road');
  if (roads.length === 1) {
    const r = roads[0]!.it.look!;
    const ax = r.size[0]! < (r.size[2] ?? 0) ? 0 : 2; // across the road: x for a road along z
    const half = Math.max(1e-6, r.size[ax]! / 2), rc = (r.c || [0, 0, 0])[ax]!;
    for (const g of gs) {
      if (SCENERY.has(g.noun)) continue;
      const off = Math.abs(mid(g.it)[ax]! - rc) / half;
      g.road = off > 0.55 && off < 1.6;
    }
  }
  const base = (g: G) => {
    const sz = g.size ? W[g.size] : '';
    const hue = g.color && g.hue ? W.hue[g.hue] : '';
    const noun = W.noun[g.noun];
    if (ja) return `${g.road ? '道路わきの' : ''}${sz}${hue}${noun}`;
    const s = [sz, hue, noun].filter(Boolean).join(' ') + (g.road ? ' by the road' : '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const buckets = () => {
    const m = new Map<string, G[]>();
    for (const g of gs) m.set(base(g), [...(m.get(base(g)) || []), g]);
    return [...m.values()].filter((b) => b.length > 1);
  };
  // Two pieces of scenery that read the same: give them their colours.
  for (const b of buckets()) if (b.some((g) => SCENERY.has(g.noun))) for (const g of b) g.color = !!g.hue;
  // Different kinds of thing that read the same (a 1 m and a 4 m box): "big" / "small" where the size tells them apart.
  for (const b of buckets()) {
    if (new Set(b.map((g) => g.it.group || g.it.key)).size < 2) continue;
    // The middle between the smallest and the largest (geometric: 1 m and 4 m → 2 m), so both ends get a word.
    const ss = b.map((g) => sizeOf(g.it)), m = Math.sqrt(Math.min(...ss) * Math.max(...ss));
    for (const g of b) g.size = sizeOf(g.it) > 1.4 * m ? 'big' : sizeOf(g.it) < 0.7 * m ? 'small' : '';
  }
  // Still the same: left / right (when they stand on two sides) and the count from the camera's side.
  for (const b of buckets()) {
    const xs = b.map((g) => mid(g.it)[0]!);
    const lo = Math.min(...xs), hi = Math.max(...xs), c = (lo + hi) / 2, spread = hi - lo;
    const sides = spread > 0.5 * median(b.map((g) => sizeOf(g.it))) && xs.every((x) => Math.abs(x - c) > 0.25 * spread);
    const runs = new Map<string, G[]>();
    for (const g of b) {
      const side = sides ? (mid(g.it)[0]! < c ? W.left : W.right) : '';
      runs.set(side, [...(runs.get(side) || []), g]);
    }
    for (const [side, run] of runs) {
      // Nearest first: three.js games mostly look down −z from +z; ties keep the game's order. 2D (no z): left first.
      const order = run.map((g, i) => ({ g, i })).sort((a, b2) => {
        const za = mid(a.g.it)[2], zb = mid(b2.g.it)[2];
        const k = za !== undefined && zb !== undefined ? zb - za : mid(a.g.it)[0]! - mid(b2.g.it)[0]!;
        return Math.abs(k) > 1e-6 ? k : a.i - b2.i;
      });
      order.forEach(({ g }, n) => {
        if (side) g.where.push(side);
        if (run.length > 1) g.where.push(ja ? `${n + 1} ${LONG.has(g.noun) ? '本目' : '番目'}` : ordinal(n + 1));
      });
    }
  }
  for (const g of gs) out.set(g.it.key, g.where.length ? (ja ? `${base(g)}（${g.where.join('・')}）` : `${base(g)} (${g.where.join(', ')})`) : base(g));
  // Copies read as their original (the row's copy tag tells them apart).
  for (const it of items) if (it.unstable && it.copyOf && out.has(it.copyOf)) out.set(it.key, out.get(it.copyOf)!);
  return out;
}

// The editor's current guesses (main.ts tells it every object list; the language is read when needed).
let langOf: () => Lang = () => 'en';
let firstSeen = new Map<string, Guessable>();
let guessSig = '';
let guessed = new Map<string, string>();
let current: Guessable[] = [];
let stale = false;
/** Where the editor's language comes from (main.ts, once). */
export function useNameLang(get: () => Lang): void {
  langOf = get;
}
/**
 * A new object list: remember how each unnamed object looked when first seen (names keep while it is dragged).
 * The guesses themselves are worked out when a name is next read.
 */
export function noteItems(items: Guessable[]): void {
  if (stale) (firstSeen = new Map()), (stale = false);
  for (const it of items) if (it.unstable && it.look && !firstSeen.has(it.key)) firstSeen.set(it.key, { ...it, pose: it.pose ? { p: [...it.pose.p] } : undefined });
  current = items.map((it) => firstSeen.get(it.key) && it.unstable ? { ...firstSeen.get(it.key)!, copyOf: it.copyOf } : it);
  guessSig = '';
}
/**
 * The game is loaded again (another folder, or reloaded after the AI's change): the next object list is seen afresh.
 * Until it comes the names on screen stay (a soft reload keeps the list on screen).
 */
export function forgetNames(): void {
  stale = true;
}
function guessFor(key: string): string | undefined {
  const lang = langOf();
  const sig = `${lang}|${current.length}|${current.map((i) => i.key).join(',')}`;
  if (sig !== guessSig) {
    guessSig = sig;
    guessed = guessNames(current, lang);
  }
  return guessed.get(key);
}

/**
 * A guessed name's two parts: what it is and which one ("Black pillar by the road (left, 3rd)" → base "Black pillar
 * by the road", where "left, 3rd"; Japanese the same with full-width brackets). The card shows them on two lines and a "name ×N" group's rows only
 * the second, so the part that tells them apart is never the part cut off with "…" (PC list, 2026-10-19 photos).
 */
export function nameParts(name: string): { base: string; where: string } {
  const m = /^(.*?)\s*[（(]([^（）()]+)[）)]$/.exec(name);
  return m && m[1] ? { base: m[1], where: m[2]! } : { base: name, where: '' };
}

/** Is this object's shown name one the editor made up from its look (not a file's name or its kind)? */
export function isGuessed(it: Pick<Item, 'key' | 'group' | 'unstable'>): boolean {
  return !!it.unstable && !fileStem(it.group) && guessFor(it.key) !== undefined;
}

/**
 * The shown name.
 * - Named: its label; a second, third… object with the same name (key `tree#2`) reads "tree 2".
 * - Unnamed (`unstable`): the stem of its picture or model file, else the guessed name (guessNames), else
 *   "Unnamed <kind>" (`t('noname.kind.<w>')`).
 */
export function displayName(it: Pick<Item, 'key' | 'label' | 'kinds' | 'group' | 'unstable'>, t: (k: string) => string): string {
  if (it.unstable) {
    const stem = fileStem(it.group);
    if (stem) return stem;
    const guess = guessFor(it.key);
    if (guess) return guess;
    const w = KIND_WORD[(it.kinds || []).find((k) => KIND_WORD[k]) || ''] || 'object';
    return t(`noname.kind.${w}`);
  }
  const m = /^(.*)#(\d+)$/.exec(it.key);
  if (m && m[2] !== '1' && it.label === m[1]) return `${it.label} ${m[2]}`;
  return it.label;
}
