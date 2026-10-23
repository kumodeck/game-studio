// The motions in the Library (studio-motion-triggers, 2026-10-22; ShellContext.motions): their tiles (the "Motion" filter,
// and All), their detail, and the pick that goes to the ask box with the objects and files.
//
// A request (2026-10-22): "Treat a motion as one of the assets: then a creator ties motions to objects and asks the AI 'play this
// motion when …'". So a motion has a tile like a sound or a model: a picture of its path seen from above (the position
// keys; a turn or a size change gets its own small sign), its name, its length and how it repeats, and what it is on.
// Pointing at a tile plays it on the tile (a dot runs along the path, the loader's own clipAt), so a person can tell
// "Bob" from "Hop" without opening the game.
//
// What the detail does: "Attach to <the picked object>" (or any object from its menu), "Ask your AI…" (the ask box
// with this motion named), Duplicate ("Hop 2": its own from now on), Delete (it comes off every object; ⌘Z). Rename on
// the title. The work is timeline-wire.ts's (attach / detach / duplicateLib / deleteLib / renameLib): one undo step each.
//
// The pick lives here (a Set of names): Shift / Multi-select adds to it and keeps the objects and files picked (the
// "this crate and this Hop" ask); a plain press picks this motion alone. Names are the person's text: textContent only.
//
// studio-motion-flow (a hands-on try of v0.1.18, 2026-10-22: "I couldn't tell how to make a motion and put it on objects"): a tile can
// be picked up and dropped on an object in the game (motion-drag.ts), the Motion filter starts with a "+ New motion"
// tile (newTile: the picked object gets a new motion on the timeline; nothing picked → "Pick an object first"), and the
// count line says the hand ("drag one onto an object to attach it").
import type { Item, LibraryMotion, LibraryMotions, MotionRepeat, MotionUntil, MotionWhen } from '../contract.ts';
import { clipAt } from '../loader/studio-placement.js';
import { h } from './dom.ts';
import { displayName } from './names.ts';
import { whenShort } from './timeline-panel.ts';

export interface LibraryMotionsDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  list(): LibraryMotion[];
  usage(name: string): Array<{ key: string; when: MotionWhen; until?: MotionUntil }>;
  items(): Item[];
  /** The object picked in the scene (for "Attach to …"), or null. */
  picked(): string | null;
  multi(): boolean;
  attach(key: string, name: string): void;
  duplicate(name: string): string | null;
  remove(name: string): void;
  /** The new name ("Jump", or "Jump 2" when taken), or null when nothing changed. */
  rename(name: string, to: string): string | null;
  /** "Ask your AI…": the cursor in the ask box (its chip names the pick). Absent = no AI here. */
  askAi?(): void;
  /** "+ New motion" (studio-motion-flow): a new motion on the picked object (or, with none, on the next one picked). Absent = no tile. */
  create?(): void;
  /** Make a tile one that can be picked up and dropped on an object (motion-drag.ts). */
  holdable?(tile: HTMLElement, name: string): void;
  /** The pick changed (the ask box's chip, the detail): the Library draws again. */
  changed(): void;
}

export interface LibraryMotionsPart extends LibraryMotions {
  /** The motions picked now (the ask's `motions`). */
  picked(): string[];
}

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const repeatSign = (r: MotionRepeat | undefined) => (r === 'pingpong' ? '↔' : r === 'loop' ? '↻' : '→');

/**
 * A motion's picture: the position keys seen from above (x across, z down), fitted into the square with a margin, the
 * keys as small diamonds and a dot that runs when `play` is called. No position keys: a turning arrow (angle keys) or
 * two nested squares (size keys).
 */
export function motionPicture(m: LibraryMotion, px: number): { el: SVGSVGElement; play(on: boolean): void } {
  if (m.tracks) return scenePicture(m, px);
  const svg = svgEl('svg', { viewBox: '0 0 100 100', width: px, height: px, class: 'lib-motion-pic', 'aria-hidden': 'true' }) as SVGSVGElement;
  const ks = m.keys.p ?? [];
  let toXY: ((v: number[]) => [number, number]) | null = null;
  if (ks.length) {
    // From above: x → right, z → down (3D); y → down (2D, already screen-like). A path straight up (only y changes) is
    // drawn from the side instead (x across, y up), or it would be a dot.
    const flat = ks.every((k) => Math.abs((k.v[0] ?? 0) - (ks[0]!.v[0] ?? 0)) < 1e-6 && Math.abs((k.v[2] ?? 0) - (ks[0]!.v[2] ?? 0)) < 1e-6);
    const pick = (v: number[]): [number, number] => (v.length === 3 ? (flat ? [v[0]!, -v[1]!] : [v[0]!, v[2]!]) : [v[0]!, v[1]!]);
    const pts: number[][] = [];
    for (let i = 0; i <= 48; i++) {
      const a = clipAt({ ...m, repeat: 'once' }, (m.len * i) / 48) as { p: number[] | null };
      if (a.p) pts.push(pick(a.p));
    }
    for (const k of ks) pts.push(pick(k.v));
    const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const span = Math.max(x1 - x0, y1 - y0, 1e-6);
    const s = 64 / span;
    toXY = (v) => {
      const [x, y] = pick(v);
      return [50 + (x - (x0 + x1) / 2) * s, 50 + (y - (y0 + y1) / 2) * s];
    };
    const line = [];
    for (let i = 0; i <= 48; i++) {
      const a = clipAt({ ...m, repeat: 'once' }, (m.len * i) / 48) as { p: number[] | null };
      if (a.p) line.push(toXY(a.p));
    }
    svg.append(svgEl('path', { d: line.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(''), fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.7 }));
    for (const k of ks) {
      const [x, y] = toXY(k.v);
      svg.append(svgEl('rect', { x: x - 3.5, y: y - 3.5, width: 7, height: 7, transform: `rotate(45 ${x} ${y})`, class: 'lib-motion-key' }));
    }
  } else if (m.keys.r?.length) {
    svg.append(svgEl('path', { d: 'M50 24 A 26 26 0 1 1 24 50', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0.7 }));
    svg.append(svgEl('path', { d: 'M50 16 L58 24 L50 32', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.7 }));
  } else if (m.keys.s?.length) {
    svg.append(svgEl('rect', { x: 34, y: 34, width: 32, height: 32, rx: 4, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, opacity: 0.5 }));
    svg.append(svgEl('rect', { x: 22, y: 22, width: 56, height: 56, rx: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, opacity: 0.7, 'stroke-dasharray': '4 4' }));
  }
  const dot = svgEl('circle', { r: 6, class: 'lib-motion-dot', cx: 50, cy: 50 });
  const place = (t: number) => {
    const a = clipAt(m, t) as { p: number[] | null; r: number[] | null };
    if (toXY && a.p) {
      const [x, y] = toXY(a.p);
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));
    } else if (a.r) {
      const ang = (a.r.length === 3 ? a.r[1]! : a.r[0]!) - Math.PI / 2;
      dot.setAttribute('cx', (50 + 26 * Math.cos(ang)).toFixed(1));
      dot.setAttribute('cy', (50 + 26 * Math.sin(ang)).toFixed(1));
    }
  };
  place(m.len / 2);
  svg.append(dot);
  let raf = 0;
  return {
    el: svg,
    play(on) {
      cancelAnimationFrame(raf);
      if (!on) return place(m.len / 2);
      const t0 = performance.now();
      const loop = (now: number) => {
        if (!svg.isConnected) return;
        // A once motion plays again from its start after a short rest, so the tile keeps showing what it does.
        const t = (now - t0) / 1000;
        place(m.repeat && m.repeat !== 'once' ? t : t % (m.len + 0.6));
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    },
  };
}

/**
 * A scene motion's picture (studio-timeline-2: several objects in one motion): a small dope sheet — one line per object
 * (up to 4) with its keys as diamonds, and a time line that runs when `play` is called. WHY not the paths from above:
 * each object's path is an offset from its own place, so drawn together they would all start in the middle and cross;
 * what a scene adds is "these things, at these moments", which is the timeline's own picture.
 */
function scenePicture(m: LibraryMotion, px: number): { el: SVGSVGElement; play(on: boolean): void } {
  const svg = svgEl('svg', { viewBox: '0 0 100 100', width: px, height: px, class: 'lib-motion-pic', 'aria-hidden': 'true' }) as SVGSVGElement;
  const tracks = Object.values(m.tracks ?? {}).slice(0, 4);
  const len = Math.max(0.1, m.len);
  const x = (t: number) => 16 + (Math.min(t, len) / len) * 68;
  const gap = 64 / Math.max(1, tracks.length);
  tracks.forEach((ks, i) => {
    const y = 18 + gap * (i + 0.5);
    const ts = [...new Set((['p', 'r', 's'] as const).flatMap((ch) => (ks[ch] ?? []).map((k) => k.t)))].sort((a, b) => a - b);
    svg.append(svgEl('path', { d: `M16 ${y}L84 ${y}`, stroke: 'currentColor', 'stroke-width': 1.2, opacity: 0.25 }));
    if (ts.length > 1) svg.append(svgEl('path', { d: `M${x(ts[0]!)} ${y}L${x(ts[ts.length - 1]!)} ${y}`, stroke: 'currentColor', 'stroke-width': 2.2, opacity: 0.6 }));
    for (const t of ts) svg.append(svgEl('rect', { x: x(t) - 3.5, y: y - 3.5, width: 7, height: 7, transform: `rotate(45 ${x(t)} ${y})`, class: 'lib-motion-key' }));
  });
  const head = svgEl('path', { d: '', class: 'lib-motion-dot', stroke: 'currentColor', 'stroke-width': 2 });
  const place = (t: number) => head.setAttribute('d', `M${x(t).toFixed(1)} 14L${x(t).toFixed(1)} 86`);
  place(len / 2);
  svg.append(head);
  let raf = 0;
  return {
    el: svg,
    play(on) {
      cancelAnimationFrame(raf);
      if (!on) return place(len / 2);
      const t0 = performance.now();
      const loop = (now: number) => {
        if (!svg.isConnected) return;
        place(((now - t0) / 1000) % (len + 0.6));
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    },
  };
}
/** How many keys a motion has (a scene: every object's). */
const keyCount = (m: LibraryMotion) => [m.keys, ...Object.values(m.tracks ?? {})].reduce((n, ks) => n + (['p', 'r', 's'] as const).reduce((a, ch) => a + (ks?.[ch]?.length ?? 0), 0), 0);

export function createLibraryMotions(d: LibraryMotionsDeps): LibraryMotionsPart {
  const pick = new Set<string>();
  let pickHook: (add: boolean) => void = () => undefined;
  const name = (k: string) => {
    const it = d.items().find((i) => i.key === k);
    return it ? displayName(it, d.t) : k;
  };
  const press = (m: string, add: boolean) => {
    const many = add || d.multi();
    pickHook(many);
    if (many) {
      if (pick.has(m)) pick.delete(m);
      else pick.add(m);
    } else {
      pick.clear();
      pick.add(m);
    }
    d.changed();
  };

  function tiles(q: string): { tiles: HTMLElement[]; n: number } {
    const list = d.list().filter((m) => !q || m.name.toLowerCase().includes(q));
    const out: HTMLElement[] = [];
    for (const m of list) {
      const on = pick.has(m.name);
      const pic = motionPicture(m, 96);
      const users = d.usage(m.name);
      const meta = h('span', { class: 'gsl-meta' }, h('span', { class: 'lib-motion-on', text: users.length ? d.t('lib.motion.on', { names: users.slice(0, 2).map((u) => name(u.key)).join(', ') + (users.length > 2 ? ` +${users.length - 2}` : '') }) : d.t('lib.motion.free') }));
      const tile = h('div', { class: `gsl-tile lib-motion${on ? ' gsl-open' : ''}`, role: 'button', tabindex: 0, 'aria-pressed': String(on), title: m.name,
        dataset: { kind: 'motion', motion: m.name } },
      h('div', { class: 'gsl-thumb lib-motion-thumb' }, pic.el),
      h('span', { class: 'gsl-name' }, m.name, h('span', { class: 'lib-motion-len', text: ` ${(Math.round(m.len * 10) / 10).toFixed(1)} s ${repeatSign(m.repeat)}` })), meta);
      // A scene (studio-timeline-2) says so on its tile: it moves several objects, dropping it on another adds that one.
      if (m.tracks) meta.prepend(h('span', { class: 'lib-motion-scene', dataset: { part: 'motion-scene' }, text: `${d.t('lib.motion.scene', { n: Object.keys(m.tracks).length })} · ` }));
      d.holdable?.(tile, m.name);
      tile.addEventListener('pointerenter', () => pic.play(true));
      tile.addEventListener('pointerleave', () => pic.play(on));
      if (on) pic.play(true);
      tile.addEventListener('click', (e) => press(m.name, e.shiftKey));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          press(m.name, e.shiftKey);
        }
      });
      out.push(tile);
    }
    return { tiles: out, n: list.length };
  }

  function detail(): { el: HTMLElement; key: string } | null {
    const names = [...pick].filter((n) => d.list().some((m) => m.name === n));
    const m = d.list().find((x) => x.name === names[names.length - 1]);
    if (!m) return null;
    const el = h('div', { class: 'lib-motion-detail', dataset: { kind: 'motion', part: 'motion-detail' } });
    const pic = motionPicture(m, 120);
    pic.play(true);
    const close = h('button', { type: 'button', class: 'gsl-btn gsl-close', 'aria-label': d.t('btn.close'), text: '×', onclick: () => (pick.clear(), d.changed()) });
    const keys = keyCount(m);
    const title = h('b', { text: m.name, title: d.t('lib.motion.renameTip'), class: 'lib-motion-title', dataset: { part: 'motion-title' } });
    const head = h('div', { class: 'gsl-dtitle' }, title,
      h('span', { class: 'gsl-path', text: d.t('lib.motion.meta', { len: (Math.round(m.len * 10) / 10).toFixed(1), repeat: d.t(`tl.repeat.${m.repeat ?? 'once'}`), n: keys }) }),
      // The hand, said where the attaching is (studio-motion-flow): the tile itself goes onto an object.
      ...(d.holdable ? [h('span', { class: 'gsl-path lib-motion-hand', text: d.t('lib.motion.dragTip') })] : []));
    // Rename: the title becomes a field (Enter / leaving keeps it, Esc goes back). Every object that uses it follows.
    const rename = () => {
      const f = h('input', { type: 'text', class: 'tl-rename', maxlength: '40', 'aria-label': d.t('lib.motion.renameTip'), dataset: { part: 'motion-rename' } });
      f.value = m.name;
      let done = false;
      const end = (keep: boolean) => {
        if (done) return;
        done = true;
        const v = f.value.trim();
        const n = keep && v && v !== m.name ? d.rename(m.name, v) : null;
        if (n) (pick.clear(), pick.add(n));
        d.changed();
      };
      f.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') end(true);
        if (e.key === 'Escape') end(false);
      });
      f.addEventListener('blur', () => end(true));
      title.replaceWith(f);
      f.focus();
      f.select();
    };
    title.addEventListener('dblclick', rename);
    el.append(h('div', { class: 'gsl-dhead' }, h('div', { class: 'gsl-thumb lib-motion-thumb' }, pic.el), head, close));
    // What it is on, and when each one starts.
    const rows = h('dl', { class: 'shelf-rows' });
    const users = d.usage(m.name);
    const on = h('dd', { class: 'lib-motion-users' });
    if (!users.length) on.append(h('span', { class: 'muted', text: d.t('lib.motion.free') }));
    for (const u of users) on.append(h('span', { class: 'lib-motion-user', dataset: { key: u.key } }, h('b', { text: name(u.key) }), ' ', h('span', { class: 'muted', text: whenShort(d.t, u.when, u.until ?? null, m.repeat ?? 'once') })));
    rows.append(h('dt', { text: d.t('lib.motion.onLabel') }), on);
    // Attach to any object: a menu of the scene's objects (the picked one first).
    const free = d.items().filter((i) => !users.some((u) => u.key === i.key));
    if (free.length) {
      const sel = h('select', { class: 'lib-motion-attach', 'aria-label': d.t('lib.motion.attachTo'), dataset: { part: 'motion-attach-to' } });
      sel.append(h('option', { value: '', text: d.t('lib.motion.attachPick') }));
      for (const i of free) sel.append(h('option', { value: i.key, text: displayName(i, d.t) }));
      sel.addEventListener('change', () => sel.value && (d.attach(sel.value, m.name), d.changed()));
      rows.append(h('dt', { text: d.t('lib.motion.attachTo') }), h('dd', {}, sel));
    }
    el.append(rows);
    const acts = h('div', { class: 'shelf-acts' });
    const target = d.picked();
    if (target && !users.some((u) => u.key === target)) {
      acts.append(h('button', { type: 'button', class: 'gsl-btn gsl-primary', dataset: { action: 'motion-attach' }, text: d.t('lib.motion.attach', { name: name(target) }),
        onclick: () => (d.attach(target, m.name), d.changed()) }));
    }
    // ✦ (studio-uniforms, 2026-10-23): the AI's uniform — spark, violet, "Ask AI…" — so it is not read as a plain action.
    if (d.askAi) acts.append(h('button', { type: 'button', class: 'gsl-btn ai', dataset: { action: 'lib-ask' }, onclick: () => d.askAi!() },
      h('span', { class: 'gsl-spark', 'aria-hidden': 'true', text: '✦' }), d.t('lib.askAboutIt')));
    acts.append(h('button', { type: 'button', class: 'gsl-btn', dataset: { action: 'motion-rename' }, text: d.t('tl.rename'), onclick: rename }));
    acts.append(h('button', { type: 'button', class: 'gsl-btn', dataset: { action: 'motion-duplicate' }, text: d.t('lib.motion.duplicate'), onclick: () => {
      const n = d.duplicate(m.name);
      if (n) (pick.clear(), pick.add(n));
      d.changed();
    } }));
    acts.append(h('button', { type: 'button', class: 'gsl-btn', dataset: { action: 'motion-delete' }, text: d.t('ops.remove'), title: d.t('lib.motion.deleteTip'), onclick: () => {
      pick.delete(m.name);
      d.remove(m.name);
      d.changed();
    } }));
    el.append(acts);
    return { el, key: `motion:${m.name}` };
  }

  /**
   * "+ New motion": the Motion filter's first tile (and the only one with no motions yet). Its second line says what
   * a press does: "for crate" (the picked object gets a new motion on the timeline) or "Pick an object first".
   */
  function newTile(): HTMLElement | null {
    if (!d.create) return null;
    const target = d.picked();
    const tile = h('div', { class: 'gsl-tile lib-motion lib-motion-new', role: 'button', tabindex: 0, dataset: { part: 'motion-new' } },
      h('div', { class: 'gsl-thumb lib-motion-thumb lib-motion-plus' }, h('span', { 'aria-hidden': 'true', text: '+' })),
      h('span', { class: 'gsl-name', text: d.t('lib.motion.new') }),
      h('span', { class: 'gsl-meta' }, h('span', { class: 'lib-motion-on', text: target ? d.t('lib.motion.newFor', { name: name(target) }) : d.t('lib.motion.pickFirst') })));
    tile.addEventListener('click', () => d.create!());
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        d.create!();
      }
    });
    return tile;
  }

  return {
    count: () => d.list().length,
    tiles,
    newTile,
    detail,
    clear() {
      if (!pick.size) return;
      pick.clear();
    },
    onPick(fn) {
      pickHook = fn;
    },
    picked: () => [...pick].filter((n) => d.list().some((m) => m.name === n)),
  };
}
