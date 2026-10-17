// Library: the panel in the shell ("which files does this game use?").
//
// The panel only talks through small injected functions (LibraryDeps), so the
// same code runs in the real shell, in the cloud shell later, and in the dev
// harness with a fake host. It never edits game code: it lists, previews,
// adds new files (add-only, through the host) and builds library.json.
//
// Safety rules followed everywhere below:
// - File names and object keys are untrusted text (they come from the folder
//   and from the game): they are only ever set with textContent / value /
//   title, never innerHTML.
// - Pictures are shown with <img> only (SVG included), so an SVG file cannot
//   run a script in the shell.

import type { AssetRef, Lang, LoadEntry, StudioHost } from '../../contract.ts';
import { ASSET_EXT } from '../../contract.ts';
import { assetsOfKey, buildRows, countBadges, filterRows, normalizeList } from './marks.ts';
import type { Badge, BadgeFilter, LibraryRow, TypeFilter } from './marks.ts';
import { addFile, buildLibraryJson, emptyState, pendingCount, setReplace, stateFromFile } from './result.ts';
import type { LibraryState, LibraryValidator } from './result.ts';
import { formatSize, t } from './strings.ts';
import type { StringKey } from './strings.ts';
import { atlasImageUrl, fontFamily, modelThumb } from './thumbs.ts';
import { injectStyles } from './styles.ts';
import { mountAiMake } from './ai-make.ts';

export interface LibraryDeps {
  host: StudioHost;
  /**
   * Folder root as the GAME sees it (origin + base path), used to map loaded
   * URLs back to folder paths. A function: the shell learns it from
   * host.open() after the panel is mounted.
   */
  base(): string;
  lang: Lang;
  /** Ask the bridge for the load log and object -> files (studio:library/assets). */
  requestAssets(): Promise<{ loads: LoadEntry[]; uses: Record<string, AssetRef[]> }>;
  /** studio:library/preview. Resolves with whether a picture on screen changed. */
  preview(url: string, to: string | null): Promise<boolean>;
  /** Switch to the placement tool and select this object. */
  selectObject(key: string): void;
  /**
   * Switch to the scene and select all of these objects at once (the detail's
   * "In the scene: 2"). Optional: without it the button selects the first one.
   */
  selectObjects?(keys: string[]): void;
  /** The shared validator from src/schema (used by the panel's own save button only). */
  validate?: LibraryValidator;
  /**
   * The saved library.json the shell loaded at start-up (ShellTool.restore).
   * undefined = the panel loads it itself through host.load().
   */
  initial?: object | null;
  /** Called whenever the unsaved count changes (for the shell's save button). */
  onPending?(n: number): void;
  /** Show the panel's own save button (the dev harness); the shell has its own. */
  ownSave?: boolean;
  /**
   * "Delete" on files marked unused: hand the whole list asked so far to the
   * user's AI (ctx.ask → host.request, step 'delete-files'). The editor never deletes a
   * file itself. Absent = no Delete button.
   */
  askDelete?(paths: string[]): Promise<void>;
  /** Files already handed over in this session (kept across re-mounts). */
  asked?: Set<string>;
}

export interface LibraryTool {
  /** Re-read the folder and the game's loads. */
  refresh(): Promise<void>;
  /** Validate and write library.json (the panel's own save; the shell saves through result()). */
  save(): Promise<{ ok: boolean; error?: string }>;
  /** The shell saved result(): the current decisions are now the saved ones. */
  markSaved(): void;
  pending(): number;
  /** Open the detail of one file. */
  open(path: string): void;
  /** Rows of one object (for the placement side's "files of this object"). */
  assetsOf(key: string): LibraryRow[];
  /** Render "files of this object" into a container owned by the placement panel. */
  renderAssetsOf(into: HTMLElement, key: string): void;
  rows(): LibraryRow[];
  /** The current library.json object (not validated). */
  result(): object;
  destroy(): void;
}

type El = HTMLElement;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

const TYPE_ICON: Record<string, string> = { image: '▦', model: '◆', sound: '♪', atlas: '▤', font: 'Aa', other: '•' };
const TYPES: TypeFilter[] = ['all', 'image', 'model', 'sound', 'atlas', 'font'];
const BADGES: Badge[] = ['used', 'codeOnly', 'unused', 'missing'];
const ACCEPT = Object.values(ASSET_EXT).flat().filter((e) => e !== 'json').map((e) => `.${e}`).join(',');

export function mountLibrary(root: El, deps: LibraryDeps): LibraryTool {
  injectStyles();
  const L = (k: StringKey, v?: Record<string, string | number>) => t(deps.lang, k, v);
  const gameUrl = (path: string) => new URL(path.split('/').map(encodeURIComponent).join('/'), deps.base()).href;

  let rows: LibraryRow[] = [];
  let state: LibraryState = emptyState();
  let saved: LibraryState = emptyState();
  let filter: { type: TypeFilter; badge: BadgeFilter; q: string } = { type: 'all', badge: 'all', q: '' };
  let openPath: string | null = null;
  let picking = false;
  let deleting = false;
  const asked = deps.asked || new Set<string>();
  let status = '';
  const newFiles = new Set<string>();
  const audio = new Audio();
  let playing: string | null = null;

  // ---------- skeleton (built once; lists are re-rendered) ----------
  const wrap = h('div', 'gsl');
  wrap.setAttribute('data-studio-tool', 'library');
  const bar = h('div', 'gsl-bar');
  const search = h('input', 'gsl-search');
  search.type = 'search';
  search.placeholder = L('search');
  search.setAttribute('aria-label', L('search'));
  const typeSel = h('select', 'gsl-type');
  typeSel.setAttribute('aria-label', L('typeAll'));
  for (const ty of TYPES) {
    const o = h('option', undefined, ty === 'all' ? L('typeAll') : L(`type_${ty}` as StringKey));
    o.value = ty;
    typeSel.append(o);
  }
  const addBtn = h('button', 'gsl-btn gsl-add', L('addFiles'));
  addBtn.type = 'button';
  const addInput = h('input');
  addInput.type = 'file';
  addInput.multiple = true;
  addInput.accept = ACCEPT;
  addInput.hidden = true;
  bar.append(search, typeSel, addBtn, addInput);
  // "Make with AI" (ai-make.ts): only when the host has the optional KUMODeck sign-in (the local
  // server). One quiet button; nothing is asked of KUMODeck until it is pressed.
  const aiBtn = deps.host.kumo ? h('button', 'gsl-btn gsl-ai-open', L('aiOpen')) : null;
  if (aiBtn) {
    aiBtn.type = 'button';
    aiBtn.setAttribute('aria-expanded', 'false');
    bar.append(aiBtn);
  }

  const chips = h('div', 'gsl-chips');
  const count = h('div', 'gsl-count');
  const grid = h('div', 'gsl-grid');
  const detail = h('div', 'gsl-detail');
  detail.hidden = true;
  const foot = h('div', 'gsl-foot');
  const statusEl = h('span', 'gsl-status');
  statusEl.setAttribute('role', 'status');
  const pendingEl = h('span', 'gsl-pending');
  const saveBtn = h('button', 'gsl-btn gsl-save', L('save'));
  saveBtn.type = 'button';
  foot.append(statusEl, pendingEl);
  if (deps.ownSave) foot.append(saveBtn);
  wrap.append(bar);
  const ai = deps.host.kumo
    ? mountAiMake(wrap, {
        kumo: deps.host.kumo,
        lang: deps.lang,
        // Same as a file added by hand: New in the grid, counted in library.json's "added".
        onAdded: (p) => {
          newFiles.add(p);
          addFile(state, p);
          void refresh();
        },
      })
    : null;
  wrap.append(chips, count, grid, detail, foot);
  root.append(wrap);
  if (aiBtn && ai) {
    aiBtn.addEventListener('click', () => {
      if (ai.isOpen()) ai.close();
      else ai.open();
      aiBtn.setAttribute('aria-expanded', String(ai.isOpen()));
    });
  }

  // ---------- helpers ----------
  const setStatus = (s: string) => {
    status = s;
    statusEl.textContent = s;
  };
  const notifyPending = () => {
    const n = pendingCount(state, saved);
    pendingEl.textContent = n ? L('pending', { n }) : '';
    saveBtn.disabled = n === 0;
    deps.onPending?.(n);
  };

  function thumbFor(row: LibraryRow, size: number, withPlay = true): El {
    const box = h('div', `gsl-thumb gsl-thumb-${row.type}`);
    const icon = h('span', 'gsl-icon', TYPE_ICON[row.type] ?? '•');
    box.append(icon);
    if (!row.exists) return box;
    const url = deps.host.assetUrl(row.path);
    const showImg = (src: string) => {
      const img = h('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      img.onload = () => icon.remove();
      img.onerror = () => img.remove();
      img.src = src;
      box.append(img);
    };
    if (row.type === 'image') showImg(url);
    else if (row.type === 'model' && /\.(glb|gltf)$/i.test(row.path)) {
      modelThumb(url, size).then((d) => { if (d && d.startsWith('data:image/png;base64,')) showImg(d); });
    } else if (row.type === 'atlas') {
      atlasImageUrl(new URL(url, location.href).href).then((u) => { if (u) showImg(u); });
    } else if (row.type === 'font') {
      fontFamily(new URL(url, location.href).href).then((fam) => {
        if (fam) {
          icon.style.fontFamily = `"${fam}", sans-serif`;
          icon.classList.add('gsl-font-sample');
        }
      });
    } else if (row.type === 'sound' && withPlay) {
      const play = h('button', 'gsl-play', playing === row.path ? '■' : '▶');
      play.type = 'button';
      play.setAttribute('aria-label', playing === row.path ? L('stop') : L('play'));
      play.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSound(row.path);
      });
      box.append(play);
    }
    return box;
  }

  function toggleSound(path: string) {
    if (playing === path) {
      audio.pause();
      playing = null;
    } else {
      audio.src = deps.host.assetUrl(path);
      audio.currentTime = 0;
      void audio.play().catch(() => { playing = null; render(); });
      playing = path;
    }
    render();
  }
  audio.addEventListener('ended', () => {
    playing = null;
    render();
  });

  function badgeEl(b: Badge): El {
    const e = h('span', `gsl-badge gsl-badge-${b}`, L(`badge_${b}` as StringKey));
    e.title = L(`hint_${b}` as StringKey);
    return e;
  }

  // ---------- list ----------
  function renderChips() {
    chips.replaceChildren();
    const c = countBadges(rows);
    for (const b of BADGES) {
      // A mark with nothing behind it ("missing 0") is only noise, and four
      // chips took half the phone sheet (UI/UX 2026-10-16). Kept while it is the
      // active filter, so the person can still turn the filter off.
      if (c[b] === 0 && filter.badge !== b) continue;
      const chip = h('button', `gsl-chip gsl-chip-${b}`);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(filter.badge === b));
      chip.title = L(`hint_${b}` as StringKey);
      chip.append(h('span', `gsl-dot gsl-dot-${b}`), h('span', undefined, L(`badge_${b}` as StringKey)), h('b', undefined, String(c[b])));
      chip.addEventListener('click', () => {
        filter.badge = filter.badge === b ? 'all' : b;
        render();
      });
      chips.append(chip);
    }
  }

  function renderGrid() {
    const list = filterRows(rows, filter);
    count.textContent = L('count', { n: list.length });
    grid.replaceChildren();
    if (!list.length) {
      grid.append(h('div', 'gsl-empty', rows.length || status ? L('empty') : L('loading')));
      return;
    }
    for (const row of list) {
      // A div, not a <button>: sound tiles hold their own play button, and
      // buttons cannot be nested.
      const tile = h('div', 'gsl-tile');
      tile.tabIndex = 0;
      tile.setAttribute('role', 'button');
      tile.dataset.path = row.path; // dataset is an attribute value, not HTML
      tile.title = row.path;
      if (row.path === openPath) tile.classList.add('gsl-open');
      const name = h('span', 'gsl-name', baseName(row.path));
      const meta = h('span', 'gsl-meta');
      meta.append(badgeEl(row.badge));
      const to = state.replace.get(row.path);
      if (to) meta.append(h('span', 'gsl-tag gsl-tag-replace', `→ ${baseName(to)}`));
      if (newFiles.has(row.path) || state.added.some((a) => a.file === row.path)) meta.append(h('span', 'gsl-tag gsl-tag-new', L('added')));
      if (asked.has(row.path)) meta.append(h('span', 'gsl-tag gsl-tag-del', L('delAsked')));
      tile.append(thumbFor(row, 128), name, meta);
      tile.addEventListener('click', () => open(row.path));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(row.path);
        }
      });
      grid.append(tile);
    }
  }

  // ---------- detail ----------
  function renderDetail() {
    const row = rows.find((r) => r.path === openPath);
    detail.hidden = !row;
    wrap.classList.toggle('gsl-has-detail', !!row);
    detail.replaceChildren();
    if (!row) return;

    const head = h('div', 'gsl-dhead');
    const close = h('button', 'gsl-btn gsl-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', L('close'));
    close.addEventListener('click', () => {
      openPath = null;
      picking = false;
      render();
    });
    const title = h('div', 'gsl-dtitle');
    title.append(h('b', undefined, baseName(row.path)), h('span', 'gsl-path', row.path));
    head.append(thumbFor(row, 256), title, close);
    detail.append(head);

    const info = h('div', 'gsl-dinfo');
    info.append(badgeEl(row.badge), h('span', 'gsl-hint', L(`hint_${row.badge}` as StringKey)));
    if (row.exists) info.append(h('span', 'gsl-size', formatSize(deps.lang, row.size)));
    detail.append(info);

    // Where this file is in the scene. The file and the objects that show it
    // are one thing seen from two sides, so the detail opens with a way back:
    // "In the scene: 2" selects them all in the scene (handles and outlines
    // on the game), and each name below selects one. The scene side has the
    // mirror of it ("Assets: tree.png" on the selected object's card).
    const used = h('div', 'gsl-section gsl-in-scene');
    if (!row.usedBy.length) used.append(h('p', 'gsl-muted', L('inSceneNone')));
    else {
      const all = h('button', 'gsl-btn gsl-scene-all', L('inScene', { n: row.usedBy.length }));
      all.type = 'button';
      all.title = L('inSceneTip');
      all.dataset.action = 'asset-select-users';
      const keysOf = row.usedBy.map((u) => u.key);
      all.addEventListener('click', () => (deps.selectObjects ? deps.selectObjects(keysOf) : deps.selectObject(keysOf[0]!)));
      used.append(all);
    }
    const keys = h('div', 'gsl-keys');
    for (const u of row.usedBy) {
      const k = h('button', 'gsl-key', u.key);
      k.type = 'button';
      k.title = L('select');
      if (!u.sure) k.append(h('i', 'gsl-guess', ` (${L('guessed')})`));
      k.addEventListener('click', () => deps.selectObject(u.key));
      keys.append(k);
    }
    used.append(keys);
    detail.append(used);

    const code = h('div', 'gsl-section');
    code.append(h('h4', undefined, L('inCode')));
    if (!row.refsInCode.length) code.append(h('p', 'gsl-muted', L('inCodeNone')));
    else {
      const ul = h('ul', 'gsl-files');
      for (const f of row.refsInCode) ul.append(h('li', undefined, f));
      code.append(ul);
    }
    detail.append(code);

    // Replace
    const rep = h('div', 'gsl-section gsl-replace');
    const to = state.replace.get(row.path);
    if (to) {
      const line = h('div', 'gsl-repline');
      line.append(h('span', undefined, L('replacedWith')), h('b', undefined, to));
      const undo = h('button', 'gsl-btn', L('undoReplace'));
      undo.type = 'button';
      undo.addEventListener('click', () => void choose(row, null));
      rep.append(line, undo);
    }
    const repBtn = h('button', 'gsl-btn gsl-primary', L('replace'));
    repBtn.type = 'button';
    repBtn.setAttribute('aria-expanded', String(picking));
    repBtn.addEventListener('click', () => {
      picking = !picking;
      render();
    });
    rep.append(repBtn);
    if (picking) rep.append(picker(row));
    detail.append(rep);

    // Delete: only files marked unused, and only as a request to the AI.
    if (row.badge === 'unused' && row.exists && deps.askDelete) {
      const del = h('div', 'gsl-section gsl-delete');
      if (asked.has(row.path)) del.append(h('p', 'gsl-muted', L('delSent', { n: asked.size })));
      else if (!deleting) {
        const b = h('button', 'gsl-btn gsl-del', L('del'));
        b.type = 'button';
        b.addEventListener('click', () => {
          deleting = true;
          render();
        });
        del.append(b);
      } else {
        del.append(h('p', undefined, L('delIntro')));
        const yes = h('button', 'gsl-btn gsl-primary gsl-del-ask', L('delAsk'));
        yes.type = 'button';
        yes.addEventListener('click', async () => {
          asked.add(row.path);
          try {
            await deps.askDelete!([...asked].sort());
            setStatus(L('delSent', { n: asked.size }));
          } catch (e) {
            asked.delete(row.path);
            setStatus(L('delFailed', { e: e instanceof Error ? e.message : String(e) }));
          }
          deleting = false;
          render();
        });
        const no = h('button', 'gsl-btn', L('delCancel'));
        no.type = 'button';
        no.addEventListener('click', () => {
          deleting = false;
          render();
        });
        const line = h('div', 'gsl-repline');
        line.append(yes, no);
        del.append(line);
      }
      detail.append(del);
    }
  }

  function picker(row: LibraryRow): El {
    const box = h('div', 'gsl-picker');
    box.append(h('h4', undefined, L('pickFile')));
    const opts = h('div', 'gsl-pgrid');
    for (const r of rows) {
      if (r.path === row.path || !r.exists || r.type !== row.type) continue;
      const b = h('button', 'gsl-tile gsl-small');
      b.type = 'button';
      b.dataset.path = r.path;
      b.title = r.path;
      b.append(thumbFor(r, 96, false), h('span', 'gsl-name', baseName(r.path)));
      b.addEventListener('click', () => void choose(row, r.path));
      opts.append(b);
    }
    box.append(opts);
    const drop = h('label', 'gsl-drop');
    drop.append(h('span', undefined, L('dropHere')));
    const inp = h('input');
    inp.type = 'file';
    inp.accept = (ASSET_EXT as Record<string, readonly string[]>)[row.type]?.map((e) => `.${e}`).join(',') || ACCEPT;
    inp.className = 'gsl-file';
    inp.setAttribute('aria-label', L('chooseFile'));
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const p = await addOne(f);
      if (p) await choose(row, p);
    });
    drop.append(inp);
    onDrop(drop, async (files) => {
      const p = await addOne(files[0]);
      if (p) await choose(row, p);
    });
    box.append(drop);
    return box;
  }

  async function choose(row: LibraryRow, to: string | null) {
    setReplace(state, row.path, to);
    picking = false;
    if (row.type === 'image' || row.type === 'atlas') {
      const fromUrl = row.type === 'atlas' ? await atlasImageUrl(gameUrl(row.path)) : gameUrl(row.path);
      const toUrl = !to ? null : row.type === 'atlas' ? await atlasImageUrl(gameUrl(to)) : gameUrl(to);
      if (fromUrl) {
        const shown = await deps.preview(fromUrl, toUrl).catch(() => false);
        setStatus(to ? (shown ? L('preview') : L('previewMiss')) : '');
      }
    }
    notifyPending();
    render();
  }

  // ---------- add (add-only through the host) ----------
  async function addOne(f: File): Promise<string | null> {
    try {
      const { path } = await deps.host.addAsset(f);
      newFiles.add(path);
      await refresh();
      return path;
    } catch (e) {
      setStatus(L('addFailed', { e: e instanceof Error ? e.message : String(e) }));
      return null;
    }
  }
  async function addMany(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const p = await addOne(f);
      if (p) {
        addFile(state, p);
        setStatus(L('addedHint'));
      }
    }
    notifyPending();
    render();
  }
  addBtn.addEventListener('click', () => addInput.click());
  addInput.addEventListener('change', () => {
    if (addInput.files?.length) void addMany(addInput.files);
    addInput.value = '';
  });
  function onDrop(el: El, cb: (files: File[]) => void) {
    el.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        el.classList.add('gsl-dragover');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('gsl-dragover'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('gsl-dragover');
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      e.preventDefault();
      e.stopPropagation();
      cb(Array.from(files));
    });
  }
  onDrop(grid, (files) => void addMany(files));

  // ---------- filters ----------
  search.addEventListener('input', () => {
    filter.q = search.value;
    renderGrid();
  });
  typeSel.addEventListener('change', () => {
    filter.type = typeSel.value as TypeFilter;
    renderGrid();
  });
  saveBtn.addEventListener('click', () => void save());

  function render() {
    renderChips();
    renderGrid();
    renderDetail();
    notifyPending();
  }

  // ---------- public ----------
  async function refresh() {
    const [list, game] = await Promise.all([
      deps.host.listAssets(),
      deps.requestAssets().catch(() => ({ loads: [] as LoadEntry[], uses: {} as Record<string, AssetRef[]> })),
    ]);
    rows = buildRows({ ...normalizeList(list), ...game, base: deps.base() });
    render();
  }

  function markSaved() {
    saved = stateFromFile(JSON.parse(JSON.stringify(buildLibraryJson(state, rows))));
    notifyPending();
  }

  async function save() {
    if (!deps.validate) return { ok: false, error: 'no validator' };
    const v = deps.validate(buildLibraryJson(state, rows));
    if (!v.ok) {
      const error = v.errors.join('; ');
      setStatus(L('saveFailed', { e: error }));
      return { ok: false, error };
    }
    const r = await deps.host.save('library', v.value);
    if (r.ok) {
      saved = stateFromFile(JSON.parse(JSON.stringify(v.value)));
      setStatus(L('saved'));
    } else setStatus(L('saveFailed', { e: r.error ?? '' }));
    notifyPending();
    return r;
  }

  function open(path: string) {
    openPath = path;
    picking = false;
    deleting = false;
    render();
    detail.scrollIntoView?.({ block: 'nearest' });
  }

  function renderAssetsOf(into: El, key: string) {
    into.replaceChildren();
    into.append(h('h4', undefined, L('assetsOfObject')));
    const list = assetsOfKey(rows, key);
    if (!list.length) {
      into.append(h('p', 'gsl-muted', L('noAssets')));
      return;
    }
    const g = h('div', 'gsl-pgrid');
    for (const r of list) {
      const b = h('button', 'gsl-tile gsl-small');
      b.type = 'button';
      b.dataset.path = r.path;
      b.title = r.path;
      b.append(thumbFor(r, 96, false), h('span', 'gsl-name', baseName(r.path)));
      b.addEventListener('click', () => open(r.path));
      g.append(b);
    }
    into.append(g);
  }

  // The last saved decisions: from the shell (restore) or read here.
  const restore = (j: unknown) => {
    state = stateFromFile(j);
    saved = stateFromFile(j);
    render();
  };
  if (deps.initial !== undefined) restore(deps.initial);
  else {
    render();
    void deps.host.load('library').then(restore).catch(() => undefined);
  }

  return {
    refresh,
    save,
    markSaved,
    pending: () => pendingCount(state, saved),
    open,
    assetsOf: (key) => assetsOfKey(rows, key),
    renderAssetsOf,
    rows: () => rows,
    result: () => buildLibraryJson(state, rows),
    destroy() {
      audio.pause();
      wrap.remove();
    },
  };
}
