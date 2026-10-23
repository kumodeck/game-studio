// The objects in the Library ("one Library", decided after a try of the editor, 2026-10-18).
//
// "Put objects and files all in one library. The left has two things, Scene and Library; inside the Library you
// narrow it to objects or files." — "Scene is where you work on the game's screen, the Library holds every object and
// file." Before that (plan 1, earlier the same day) the objects had a shelf of their own ("Objects" with "Scene | Grid")
// next to the files' shelf ("Assets"): two rows, two shelves, and a switch inside one of them — "I can't tell assets
// from the scene", "why aren't the objects in the library?".
//
// So this file no longer draws a page. It is ShellContext.objects (contract.ts LibraryObjects): the objects' part of
// the Library's page — their tiles (one per kind group, "pine ×3"), their detail on the right (the file it is drawn with, where it is, Show in game →, Duplicate,
// Delete) and Multi-select. The Library (tools/library/panel.ts) owns the page: one search, one count, one grid with
// the files, one row of filters (All / 3D / 2D / Sound / Other: the objects sit under the game's 3D or 2D, a review
// 2026-10-18; their own Unnamed / Duplicates / made-from filters went then) and one detail at a time.
//
// One file, many objects: each object's tile names the file it is drawn with ("planks.jpg", from the game's own
// assetsOf through the library's rows); the file's tile says "Used by 3". A file's "Show just these objects" narrows
// the objects to the ones that use it (`showFile`), with a band to undo that.
//
// Selection is the editor's one selection (main.ts): a press here picks without moving the camera and without leaving
// the Library (a try of the editor: "pressing an object in the library should show its detail, not throw me back to the
// game"); only "Show in game →" (or the Scene row) goes to the game. Duplicate / Delete / ⌘Z / the ask bar work on the
// pick as they do in the game.
//
// Using what is here ("use the Library", a request after a try of the editor, 2026-10-18: "I can look at things in the
// Library, but it doesn't do anything yet. I want to add things from it to the scene, and point at one and ask the AI
// 'make this enemy the boss at the climax'"): the detail's "Add to scene" (also the tile's menu, and dragging the tile
// onto the Scene row) puts a copy in the middle of what the camera sees and shows it picked in the Scene — one undo
// step, as Duplicate; "Ask your AI…" puts the cursor in the ask box, whose chip already names the pick (the same box
// as in the Scene). The tiles are draggable for that (application/x-studio-object = the tile's first key).
// Names and file names are untrusted text: textContent only; pictures are the game's PNG data URLs (safeImageSrc).
import type { Dim, Item, LibraryObjects, Pose } from '../contract.ts';
import { h, safeImageSrc } from './dom.ts';
import { displayName } from './names.ts';
import { toneThumb } from './thumb-tone.ts';

export interface LibraryObjectsDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  items(): Item[];
  selected(): string | null;
  group(): string[];
  multi(): boolean;
  setMulti(on: boolean): void;
  /** The list's picture of an object (a PNG data URL from the game), or null while it is not drawn yet. */
  thumb(key: string): string | null;
  /** The tile's own picture is there: drawn at the tile's size, from the game as it is now (not the list's 96 px one). */
  sharp(key: string): boolean;
  /** Tiles in view without their own picture: ask the game for them first, `px` square (twice the tile on screen). */
  wantThumbs(keys: string[], px: number): void;
  pose(key: string): Pose | undefined;
  dim(): Dim;
  /** A press on a tile: pick (or add / take out with `add`), never moving the camera or leaving the Library. */
  select(key: string, add: boolean): void;
  selectMany(keys: string[], primary: string): void;
  clear(): void;
  copy(): void;
  remove(): void;
  /** "Show in game →": the Scene with this pick (the only way from the Library to the game, besides the Scene row). */
  showInGame(): void;
  /** An object's file ("planks.jpg →"): that file's detail, in the Library. */
  openFile(path: string): void;
  /** Object key → the files it is drawn with (folder paths). Resolves to an empty map when they can't be read. */
  uses(): Promise<Map<string, string[]>>;
  askName(keys: string[]): Promise<boolean>;
  /** ✦ "Ask AI to name it…" as a draft in the AI box (studio-uniforms); absent = askName (sent at once). */
  nameDraft?(keys: string[]): void;
  /** The object part changed on its own (the files were read): the Library draws again. */
  changed(): void;
  /** "Add to scene": a copy of one of each picked kind, in the middle of the view, then the Scene with it picked. */
  addToScene(): void;
  /** "Ask your AI…": the cursor in the ask box (its chip names the pick). Absent = no AI here (the web demo). */
  askAi?(): void;
}

/** The drag type of an object's tile (dropped on the Scene row = "Add to scene"); the data is the tile's first key. */
export const DRAG_OBJECT = 'application/x-studio-object';

export interface LibraryObjectsPart extends LibraryObjects {
  /** Read object → files again (a new game page, copies). Keeps the old answer on screen until the new one lands. */
  refreshUses(): void;
  updateThumb(key: string): void;
}

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** The largest picture a tile asks for (the bridge's cap too, bridge/editor.ts placement/thumbs). */
export const TILE_PX_MAX = 384;

export function createLibraryObjects(d: LibraryObjectsDeps): LibraryObjectsPart {
  let onlyFile: string | null = null;
  let uses: Map<string, string[]> | null = null;
  let usesAsked = 0;
  let pickHook: (add: boolean) => void = () => undefined;
  const imgs = new Map<string, HTMLImageElement[]>();
  const multiBtn = h('button', { type: 'button', class: 'gsl-btn shelf-multi', dataset: { action: 'shelf-multi' }, onclick: () => d.setMulti(!d.multi()) });

  const thumbImg = (key: string) => {
    const img = h('img', { class: 'shelf-pic', alt: '', draggable: false });
    const src = safeImageSrc(d.thumb(key));
    if (src) (img.src = src), toneThumb(img, src);
    else img.hidden = true;
    // Only pictures still on screen are kept (each draw of the grid makes new ones).
    const arr = (imgs.get(key) || []).filter((i) => i.isConnected);
    arr.push(img);
    imgs.set(key, arr);
    return img;
  };
  // The shared start of a group's names ("crate-1", "crate-2" → "crate"): the same as the list's "crate ×4" row.
  const kindName = (members: Item[]) => {
    const names = members.map((m) => displayName(m, d.t));
    let pre = names[0] || '';
    for (const n of names) while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
    pre = pre.replace(/[\s#:_.-]+$/, '');
    return pre.length >= 2 ? pre : names[0] || '';
  };
  const filesOf = (key: string) => uses?.get(key) || [];
  const match = (it: Item, q: string): boolean => {
    if (onlyFile && !filesOf(it.key).includes(onlyFile)) return false;
    if (q && !`${displayName(it, d.t)} ${it.label} ${it.key}`.toLowerCase().includes(q)) return false;
    return true;
  };
  const askUses = () => {
    if (!uses && !usesAsked) refreshUses();
  };

  function refreshUses() {
    const ask = ++usesAsked;
    void d.uses().then((m) => {
      if (ask !== usesAsked) return;
      uses = m;
      d.changed();
    }, () => undefined);
  }

  // Pictures for the tiles in view (the list asks for its rows the same way, main.ts requestVisibleThumbs). The
  // Library's page scrolls, not this part: any scroll in the page looks again.
  let frame = 0;
  let shown: HTMLElement[] = [];
  const thumbsSoon = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const want: string[] = [];
      let side = 0;
      for (const tile of shown) {
        if (!tile.isConnected) continue;
        const box = (tile.closest('.gsl') || document.documentElement).getBoundingClientRect();
        const r = tile.getBoundingClientRect();
        if (!r.height || r.bottom < box.top || r.top > box.bottom) continue;
        side = Math.max(side, (tile.querySelector('.gsl-thumb') as HTMLElement | null)?.clientWidth || 0);
        if (!d.sharp(tile.dataset.key!)) want.push(tile.dataset.key!);
      }
      // Twice the tile's size on screen (Ive review 3 ⑧, 2026-10-20: the tiles showed the list's 96 px picture
      // stretched to ~140 px, blurred on any screen and twice so on a Retina one), in steps of 32, 96–384.
      const px = Math.min(TILE_PX_MAX, Math.max(96, Math.ceil((side * 2) / 32) * 32));
      if (want.length) d.wantThumbs(want, px);
    });
  };
  document.addEventListener('scroll', () => shown.length && thumbsSoon(), { capture: true, passive: true });

  function tiles(q: string): { tiles: HTMLElement[]; n: number } {
    askUses();
    const items = d.items().filter((it) => match(it, q));
    const sel = d.selected();
    const group = d.group();
    const picked = (k: string) => k === sel || group.includes(k);
    // One tile per kind ("pine ×3"), like the list: the tile picks the whole group.
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      const g = it.group || `key:${it.key}`;
      const arr = groups.get(g) || [];
      arr.push(it);
      groups.set(g, arr);
    }
    const out: HTMLElement[] = [];
    for (const [g, members] of groups) {
      const first = members[0]!;
      const many = members.length > 1;
      const keys = members.map((m) => m.key);
      const on = many ? keys.every(picked) : picked(first.key);
      const files = [...new Set(keys.flatMap(filesOf))];
      const meta = h('span', { class: 'gsl-meta' });
      // The line under the name: the file it is drawn with, or nothing. (No grey "Drawn in code" and no "Object" tag in
      // the picture's corner since the second design review's ⑦, 2026-10-19: twelve tiles said the same two things.)
      if (files.length) meta.append(h('span', { class: 'shelf-file', title: files.join('\n'), text: files.slice(0, 2).map(base).join('・') + (files.length > 2 ? ` +${files.length - 2}` : '') }));
      const thumb = h('div', { class: 'gsl-thumb' }, thumbImg(first.key), many ? h('span', { class: 'shelf-many', text: `×${members.length}` }) : null);
      const tile = h('div', { class: `gsl-tile lib-object${on ? ' gsl-open' : ''}`, role: 'button', tabindex: 0, 'aria-pressed': String(on),
        dataset: { key: first.key, kind: 'object', ...(many ? { group: g } : {}) }, title: many ? d.t('ops.selectGroup', { n: members.length }) : displayName(first, d.t) },
      thumb, h('span', { class: `gsl-name${first.unstable && !many ? ' unnamed' : ''}`, text: many ? kindName(members) : displayName(first, d.t) }), meta);
      // Drag onto the Scene row (main.ts) = "Add to scene" for this kind. The press itself still picks (click).
      tile.draggable = true;
      tile.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(DRAG_OBJECT, first.key);
        e.dataTransfer.effectAllowed = 'copy';
      });
      const press = (add: boolean) => {
        pickHook(add || d.multi());
        if (add || d.multi()) {
          if (!many) d.select(first.key, true);
          else {
            const now = d.group().length ? d.group() : d.selected() ? [d.selected()!] : [];
            const next = on ? now.filter((k) => !keys.includes(k)) : [...new Set([...now, ...keys])];
            if (next.length) d.selectMany(next, next[next.length - 1]!);
            else d.clear();
          }
        } else if (many) d.selectMany(keys, keys[0]!);
        else d.select(first.key, false);
      };
      tile.addEventListener('click', (e) => press(e.shiftKey));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          press(e.shiftKey);
        }
      });
      out.push(tile);
    }
    shown = out;
    thumbsSoon();
    return { tiles: out, n: items.length };
  }

  /** The numbers read the way the card shows them: "X 3.5  Y 0.0  Z 17.0" (3D metres) / "X 120  Y 80" (2D pixels). */
  const where = (p: Pose) => {
    const v = d.dim() === '3d' ? p.p.map((n) => n.toFixed(1)) : p.p.slice(0, 2).map((n) => String(Math.round(n)));
    return v.map((n, i) => h('span', { class: 'axis' }, h('i', { text: 'XYZ'[i]! }), ` ${n}`));
  };
  const size = (p: Pose) => (Array.isArray(p.s) ? p.s[0] ?? 1 : p.s ?? 1).toFixed(2);

  function detail(): { el: HTMLElement; key: string } | null {
    const items = d.items();
    const keys = (d.group().length ? d.group() : d.selected() ? [d.selected()!] : []).filter((k) => items.some((i) => i.key === k));
    if (!keys.length) return null;
    const el = h('div', { class: 'lib-object-detail', dataset: { kind: 'object' } });
    const members = keys.map((k) => items.find((i) => i.key === k)!);
    const one = members.length === 1 ? members[0]! : null;
    const close = h('button', { type: 'button', class: 'gsl-btn gsl-close', 'aria-label': d.t('btn.close'), text: '×', onclick: () => d.clear() });
    const pic = h('div', { class: 'gsl-thumb' }, thumbImg(members[0]!.key));
    const names = members.slice(0, 6).map((m) => displayName(m, d.t)).join(', ') + (members.length > 6 ? ' …' : '');
    el.append(h('div', { class: 'gsl-dhead' }, pic,
      h('div', { class: 'gsl-dtitle' }, h('b', { text: one ? displayName(one, d.t) : d.t('ops.many', { n: members.length }) }), h('span', { class: 'gsl-path', text: one ? d.t('shelf.placed') : names })),
      close));
    if (one) {
      const rows = h('dl', { class: 'shelf-rows' });
      const files = filesOf(one.key);
      const src = h('dd', {});
      if (files.length) for (const f of files) src.append(h('button', { type: 'button', class: 'shelf-file to', dataset: { action: 'open-asset', path: f }, title: f, text: `${base(f)} →`, onclick: () => d.openFile(f) }));
      else if (uses) src.append(h('span', { class: 'muted', text: d.t('shelf.noSource') }));
      rows.append(h('dt', { text: d.t('shelf.source') }), src);
      const p = d.pose(one.key);
      if (p) {
        rows.append(h('dt', { text: d.t('placement.pos') }), h('dd', { class: 'mono' }, ...where(p)));
        if (one.rotatable) rows.append(h('dt', { text: d.t('placement.rot') }), h('dd', { class: 'mono', text: `${Math.round(((p.r ?? 0) * 180) / Math.PI)}°` }));
        if (one.scalable) rows.append(h('dt', { text: d.t('placement.scale') }), h('dd', { class: 'mono', text: size(p) }));
      }
      el.append(rows);
      if (one.unstable) {
        el.append(h('p', { class: 'shelf-note' }, h('span', { class: 'muted', text: d.t('noname.tag') }), ' ',
          d.nameDraft
            ? h('button', { type: 'button', class: 'link-btn ai', dataset: { action: 'ask-name' }, onclick: () => d.nameDraft!([one.key]) },
              h('span', { class: 'gsl-spark', 'aria-hidden': 'true', text: '✦' }), d.t('ctx.nameAsk'))
            : h('button', { type: 'button', class: 'link-btn', dataset: { action: 'ask-name' }, text: d.t('ask.name'), onclick: async (e: Event) => {
              (e.currentTarget as HTMLButtonElement).disabled = true;
              await d.askName([one.key]);
            } })));
      }
    }
    const locked = members.every((m) => m.movable === false);
    if (locked) el.append(h('p', { class: 'shelf-note muted', text: d.t('placement.locked') }));
    // "Add to scene" first (the Library's main use, 2026-10-18), then "Ask your AI…", then the way to the game, then
    // Delete — four, the same four as the tile's menu (context-rows.ts). No "Duplicate" (design review 2, item ①): in
    // the Library it did exactly what "Add to scene" does, and nobody could tell the two apart; the scene's Duplicate is
    // the card's button and ⌘D. A locked object can't be copied (the game's settings), so it has no "Add to scene".
    const acts = h('div', { class: 'shelf-acts' });
    if (!locked) acts.append(h('button', { type: 'button', class: 'gsl-btn gsl-primary', dataset: { action: 'add-to-scene' }, text: d.t('lib.addToScene'), onclick: () => d.addToScene() }));
    // ✦ (studio-uniforms, 2026-10-23): the AI's uniform — spark, violet, "Ask AI…" — so it is not read as a plain action.
    if (d.askAi) acts.append(h('button', { type: 'button', class: 'gsl-btn ai', dataset: { action: 'lib-ask' }, onclick: () => d.askAi!() },
      h('span', { class: 'gsl-spark', 'aria-hidden': 'true', text: '✦' }), d.t('lib.askAboutIt')));
    acts.append(h('button', { type: 'button', class: `gsl-btn${locked ? ' gsl-primary' : ''}`, dataset: { action: 'show-in-game' }, text: d.t('shelf.showInGame'), onclick: () => d.showInGame() }));
    if (!locked) acts.append(h('button', { type: 'button', class: 'gsl-btn', dataset: { action: 'remove' }, text: d.t('ops.remove'), onclick: () => d.remove() }));
    el.append(acts);
    return { el, key: keys.join(',') };
  }

  return {
    count: () => d.items().length,
    dim: () => d.dim(),
    showFile(path) {
      onlyFile = path;
    },
    band() {
      if (!onlyFile) return null;
      const n = d.items().filter((it) => filesOf(it.key).includes(onlyFile!)).length;
      // "planks.jpg used by 3 ×": where this narrower view came from, and the way back to all objects.
      return h('span', { class: 'shelf-band', dataset: { file: onlyFile } },
        h('b', { text: base(onlyFile) }), h('span', { text: ` ${d.t('shelf.using', { n })}` }),
        h('button', { type: 'button', class: 'shelf-band-x', title: d.t('shelf.clearFile'), 'aria-label': d.t('shelf.clearFile'), text: '×', onclick: () => {
          onlyFile = null;
          d.changed();
        } }));
    },
    tiles,
    detail,
    select(key) {
      pickHook(false);
      d.select(key, false);
    },
    clear: () => d.clear(),
    multiButton() {
      multiBtn.textContent = d.multi() ? d.t('ops.multiDone') : d.t('ops.multi');
      multiBtn.setAttribute('aria-pressed', String(d.multi()));
      return multiBtn;
    },
    onPick(fn) {
      pickHook = fn;
    },
    multi: () => d.multi(),
    refreshUses,
    updateThumb(key) {
      const src = safeImageSrc(d.thumb(key));
      if (!src) return;
      for (const img of imgs.get(key) || []) {
        img.src = src;
        img.hidden = false;
        toneThumb(img, src);
      }
    },
  };
}
