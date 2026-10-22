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

import type { AssetRef, Lang, LibraryFileUse, LibraryMotions, LibraryObjects, LoadEntry, StudioHost } from '../../contract.ts';
import { ASSET_EXT } from '../../contract.ts';
import { assetsOfKey, buildRows, filterRows, normalizeList, SHELVES, shelfOfType } from './marks.ts';
import type { Badge, LibraryRow, Shelf } from './marks.ts';
import { addFile, buildLibraryJson, emptyState, pendingCount, setReplace, stateFromFile } from './result.ts';
import type { LibraryState, LibraryValidator } from './result.ts';
import { formatSize, t } from './strings.ts';
import type { StringKey } from './strings.ts';
import { atlasImageUrl, fontFamily, modelThumb } from './thumbs.ts';
import { injectStyles } from './styles.ts';
import { HEAVY_MODEL_BYTES, elapsed, mountAiMake } from './ai-make.ts';
import type { AiWork } from './ai-make.ts';

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
  /**
   * The Objects shelf instead of the game (plan 1, 2026-10-18): `file` narrows it to the objects that use the file
   * ("Show in Objects →"), `key` opens one object there (a name under "3 objects use this file"). Optional: without
   * it those presses select in the game as before.
   */
  showObjects?(o: { file?: string; key?: string }): void;
  /**
   * The name a person reads for an object (the list's name). Optional: without it the key is shown. WHY: an unnamed
   * object's key is `path:3/0`, an inner handle that must never show on screen (dogfood 2026-10-17, U4).
   */
  nameOf?(key: string): string;
  /** The shared validator from src/schema (used by the panel's own save button only). */
  validate?: LibraryValidator;
  /**
   * The saved library.json the shell loaded at start-up (ShellTool.restore).
   * undefined = the panel loads it itself through host.load().
   */
  initial?: object | null;
  /**
   * With `initial`: the last SAVED decisions, when they differ from `initial` (the panel was closed with
   * unsaved swaps and is opened again: index.ts keeps both). Absent = `initial` is the saved state.
   * WHY (e2e-save 2026-10-18): a swap, then back to the Scene and ⌘S, never reached the AI — the panel was
   * gone, so it counted 0 unsaved and the shell's Save skipped library.json.
   */
  initialSaved?: object | null;
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
  /**
   * Send one line to the person's AI (ctx.ask, kind 'ask', about the whole game). Used by "Ask my
   * AI to make it lighter" on heavy 3D files. Resolves false when it couldn't be sent. Absent = no button.
   */
  askAi?(text: string): Promise<boolean>;
  /**
   * The objects placed in the game ("one Library", 2026-10-18): with them the panel is the whole Library — objects
   * and assets in one grid, counted with the files in All / 3D / 2D (by the game's dim), one search, one count, one
   * detail at a time (an object's or a file's). Absent (the dev harness, older shells) = assets only, as before.
   */
  objects?: LibraryObjects;
  /** The Library's motions (studio-motion-triggers, 2026-10-22): the "Motion" filter, and All. Absent = none. */
  motions?: LibraryMotions;
  /**
   * What the Library shows (All / 3D / 2D / Sound / Other and the search), kept by the caller across
   * re-mounts (a language or layout change mounts a new panel; the view should not jump back to All). Mutated here.
   */
  view?: LibraryView;
  /**
   * The files as things to use ("use the Library", 2026-10-18; ShellContext.files): the pick goes to the ask box's
   * chip, a file's detail gets "Add to scene" and "Ask your AI…", and its tile can be dragged onto the Scene row.
   * Absent (the dev harness) = none of that.
   */
  files?: LibraryFileUse;
}

/** The drag type of a file's tile (dropped on the Scene row = "Add to scene"); the data is the file's folder path. */
export const DRAG_FILE = 'application/x-studio-file';

/**
 * What the Library shows: one of All / 3D / 2D / Sound / Other (marks.ts Shelf; a review of the editor, 2026-10-18, it replaced
 * Show: All / Objects / Assets, the objects' Made from, Asset type and Use) and the search.
 */
export interface LibraryView {
  shelf: Shelf;
  q: string;
}

export interface LibraryTool {
  /** Re-read the folder and the game's loads. */
  refresh(): Promise<void>;
  /** Validate and write library.json (the panel's own save; the shell saves through result()). */
  save(): Promise<{ ok: boolean; error?: string }>;
  /** The shell saved result(): the current decisions are now the saved ones. */
  markSaved(): void;
  pending(): number;
  /** The last saved decisions as a library.json object (index.ts keeps it when the panel closes unsaved). */
  savedResult(): object;
  /** Open the detail of one file. */
  open(path: string): void;
  /** The Library narrowed to the objects that use this file. */
  showUsers(path: string): void;
  /** The file's detail with its "Replace…" picker open. */
  replace(path: string): void;
  /** Bring the open detail (a file's or the picked objects') into view: the menus' "Details". */
  revealDetail(): void;
  /** Run `fn` (a pick or an open for a tile's menu) without the page scrolling to the new detail. */
  holdStill(fn: () => void): void;
  /**
   * The Scene's "Show in Library →" (2026-10-18): the picked objects' detail, with nothing else open or narrowing
   * the grid, and their tile in view.
   */
  showPick(): void;
  /** The files picked now (the open file, or several with Shift / Multi-select), for the tile's menu. */
  pickedFiles(): string[];
  /** The filters (All / 3D / 2D / Sound / Other): the shell puts them in its left column on PC; on a phone a chip row. */
  filtersEl: HTMLElement;
  /** An empty head at the top of the panel: the shell puts its Objects | Assets switch there on a phone. */
  headEl: HTMLElement;
  /** Draw again (the shell's selection or object list changed). */
  redraw(): void;
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
const ACCEPT = Object.values(ASSET_EXT).flat().filter((e) => e !== 'json').map((e) => `.${e}`).join(',');
/**
 * How long one read of the folder may take before the panel says it got no answer (seconds).
 * 15 = far above a real read (the local server lists a starter in < 50 ms, a big project in
 * < 2 s), short enough that nobody stares at "Reading the folder…" wondering. Was: no limit,
 * so a request that never came back left that line on screen forever.
 */
const READ_SECONDS = 15;

export function mountLibrary(root: El, deps: LibraryDeps): LibraryTool {
  injectStyles();
  const L = (k: StringKey, v?: Record<string, string | number>) => t(deps.lang, k, v);
  const gameUrl = (path: string) => new URL(path.split('/').map(encodeURIComponent).join('/'), deps.base()).href;

  let rows: LibraryRow[] = [];
  let state: LibraryState = emptyState();
  let saved: LibraryState = emptyState();
  const objects = deps.objects;
  const motions = deps.motions;
  /** The motions are in the grid on All and on Motion (not while a file's objects narrow it). */
  const showsMotions = () => !!motions && (filter.shelf === 'all' || filter.shelf === 'motion') && !objects?.band();
  // Kept by the caller across re-mounts (index.ts); a fresh one in the dev harness.
  const filter: LibraryView = deps.view || { shelf: 'all', q: '' };
  /** The shelf the game's objects sit on (3D or 2D), or null without objects (the dev harness: files only). */
  const objShelf = (): Shelf | null => (objects ? (objects.dim() === '2d' ? '2d' : '3d') : null);
  /**
   * The objects are in the grid on All and on their own shelf, and never while a file's "Show just these objects"
   * narrows them (then only those objects: the band above the grid says so and has the × back).
   */
  const showsObjects = () => !!objects && (filter.shelf === 'all' || filter.shelf === objShelf());
  const showsFiles = () => !objects?.band() && filter.shelf !== 'motion';
  /** The detail last drawn (a file's path or the picked objects' keys): a new one scrolls the phone sheet up to it. */
  let lastDetail = '';
  /**
   * A pick made for a tile's menu (context menu, 2026-10-18): the new detail does NOT scroll the page to itself. The
   * menu opens at the finger / pointer over the tile; a phone sheet jumping to its top under it moved the tile away
   * and closed the menu. The menu's "Details" brings the detail into view instead (revealDetail).
   */
  let still = false;
  let openPath: string | null = null;
  /**
   * Files picked to use ("use the Library", 2026-10-18): the open file, or several with Shift / Multi-select (then the
   * picked objects stay picked too: "these two and this sound"). They are what the ask box's chip names and what
   * "Add to scene" / "Ask your AI…" on a file's detail work on. Orange like any pick; the detail shows the last one.
   */
  const pickedFiles = new Set<string>();
  // What the shell was last told; null = nothing yet, so a new panel (a re-mount) always tells it its pick, even an empty
  // one (the shell kept the old panel's files and the chip said "3 picked" for 1 — found in the pictures, 2026-10-18).
  let pickSent: string | null = null;
  let picking = false;
  let deleting = false;
  const asked = deps.asked || new Set<string>();
  let status = '';
  /** The folder has been read at least once (before: an empty folder said "Reading the folder…" forever). */
  let loaded = false;
  /**
   * Why the last read of the folder failed, or null. Shown above the grid with "Try again".
   * WHY (play test 2026-10-17, "the assets don't show up"): a read that threw or never answered left
   * "0 files" + "Reading the folder…" on screen for good, with nothing in the console, so
   * nobody could tell a slow read from a dead one.
   */
  let readError: string | null = null;
  /** What Make with AI is making now: shown as "Making…" tiles at the top of the grid. */
  let aiWork: AiWork[] = [];
  let workTick = 0;
  /** Heavy files already sent to the AI with "make it lighter" in this session. */
  const askedLighter = new Set<string>();
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
  search.value = filter.q;
  const addBtn = h('button', 'gsl-btn gsl-add', L('addFiles'));
  addBtn.type = 'button';
  addBtn.dataset.action = 'add-files';
  const addInput = h('input');
  addInput.type = 'file';
  addInput.multiple = true;
  addInput.accept = ACCEPT;
  addInput.hidden = true;
  bar.append(search, addBtn, addInput);
  // "Make with AI" (ai-make.ts): only when the host has the optional KUMODeck sign-in (the local
  // server). One quiet button; nothing is asked of KUMODeck until it is pressed.
  const aiBtn = deps.host.kumo ? h('button', 'gsl-btn gsl-ai-open', L('aiOpen')) : null;
  if (aiBtn) {
    aiBtn.type = 'button';
    aiBtn.dataset.action = 'ai-open';
    aiBtn.setAttribute('aria-expanded', 'false');
    bar.append(aiBtn);
  }
  // The phone's "+" (the second design review's ⑦, 2026-10-19): the bar's buttons (Multi-select, Add files, Make with
  // AI) fold into one menu next to the search, so the Library's head is two rows — Scene | Library with the filters, then
  // the search and "+" — and the first tile starts in the top half of the screen (it started at y 470 of 844 under four
  // rows). Shown by the shell's phone CSS only (hidden here and on PC, where the buttons stay in the bar). Each entry
  // presses the real button, so the bar's behaviour stays in one place.
  const moreBtn = h('button', 'gsl-btn gsl-more');
  moreBtn.type = 'button';
  moreBtn.dataset.action = 'library-more';
  moreBtn.textContent = '+';
  moreBtn.setAttribute('aria-label', L('more'));
  moreBtn.setAttribute('aria-haspopup', 'menu');
  moreBtn.setAttribute('aria-expanded', 'false');
  const moreMenu = h('div', 'gsl-more-menu');
  moreMenu.setAttribute('role', 'menu');
  moreMenu.hidden = true;
  const closeMore = () => {
    moreMenu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
  };
  moreBtn.addEventListener('click', () => {
    if (!moreMenu.hidden) return closeMore();
    moreMenu.replaceChildren();
    const entries = [...bar.querySelectorAll<HTMLButtonElement>(':scope > .shelf-multi, :scope > .gsl-add, :scope > .gsl-ai-open')];
    for (const b of entries) {
      const item = h('button', 'gsl-more-item', b.textContent || '');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      if (b.dataset.action) item.dataset.action = `more-${b.dataset.action}`;
      item.addEventListener('click', () => {
        closeMore();
        b.click();
      });
      moreMenu.append(item);
    }
    moreMenu.hidden = false;
    moreBtn.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('pointerdown', (e) => {
    if (!moreMenu.hidden && !moreMenu.contains(e.target as Node) && e.target !== moreBtn) closeMore();
  }, true);
  bar.append(moreBtn, moreMenu);

  // The filters: All / 3D / 2D / Sound / Other, one list with no headings (a review of the editor, 2026-10-18: "I couldn't make out
  // how they are split at all. 3D assets, 2D assets, music, other is about enough."). In the shell's left column on PC
  // (as rows), a row of chips that scrolls sideways on a phone. Before: four headed groups — Show (All / Objects /
  // Assets), Made from (a file / drawn in code), Asset type (Images / 3D models / Sounds…) and Use (used / not used).
  // Used / not used is still on a file's tile and in its detail. (Object vs asset was on each tile's small tag until the
  // second design review, 2026-10-19.)
  const chips = h('div', 'gsl-chips shelf-filters');
  chips.setAttribute('role', 'group');
  const headEl = h('div', 'gsl-head shelf-head');
  const count = h('div', 'gsl-count');
  const grid = h('div', 'gsl-grid');
  // "Couldn't read the folder (…)." + Try again: only after a failed read (renderReadFail).
  const readFail = h('div', 'gsl-readfail');
  readFail.setAttribute('role', 'alert');
  readFail.hidden = true;
  const readFailText = h('span');
  const retryBtn = h('button', 'gsl-btn gsl-retry', L('readRetry'));
  retryBtn.type = 'button';
  retryBtn.dataset.action = 'library-retry';
  retryBtn.addEventListener('click', () => {
    retryBtn.disabled = true;
    void refresh().finally(() => { retryBtn.disabled = false; });
  });
  readFail.append(readFailText, retryBtn);
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
  wrap.append(headEl, bar);
  const ai = deps.host.kumo
    ? mountAiMake(wrap, {
        kumo: deps.host.kumo,
        lang: deps.lang,
        // New in the grid, but NOT a change to save (polish pass 2026-10-17): the file is already in
        // assets/ and nothing in the game changed, yet it used to count as "Save · 1" / "1 unsaved",
        // and the person could not tell what Save would do. It becomes a change when they place it
        // in the scene (in-game.ts adds it to library.json's "added" with a place) or ask their AI.
        // A file added by hand still counts: "Add files" promises that the AI hooks it up on Save.
        onAdded: async (p) => {
          newFiles.add(p);
          await refresh();
          return { size: rows.find((r) => r.path === p)?.size };
        },
        onWork: (w) => {
          aiWork = w;
          // Only the clocks change each second; the grid itself redraws when the list changes.
          if (w.length && !workTick) workTick = window.setInterval(() => {
            for (const el of grid.querySelectorAll<HTMLElement>('[data-since]')) el.textContent = L('makingTile', { time: elapsed(Number(el.dataset.since)) });
          }, 1000);
          if (!w.length && workTick) {
            window.clearInterval(workTick);
            workTick = 0;
          }
          renderGrid();
        },
        askLighter: deps.askAi ? (p, size) => askLighter(p, size) : undefined,
        formatSize: (n) => formatSize(deps.lang, n),
        // The "Just made" card (generate-ui, 2026-10-22): its image / ▶, and the same "Add to scene" / "Ask your AI…"
        // as a file's detail (one way to hand a file to the AI).
        assetUrl: (p) => deps.host.assetUrl(p),
        files: deps.files,
      })
    : null;
  wrap.append(chips, count, readFail, grid, detail, foot);
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

  /** "Make assets/x.glb lighter for the game (it's 45.7 MB now)…" to the person's AI. */
  async function askLighter(path: string, size: number): Promise<boolean> {
    if (!deps.askAi) return false;
    const ok = await deps.askAi(L('askLighterText', { path, size: formatSize(deps.lang, size) })).catch(() => false);
    if (ok) askedLighter.add(path);
    return ok;
  }

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
      // Until the picture is drawn, say so: a 45.7 MB AI model took 10–30 s, and a plain ◆ looked
      // like "no preview" (2026-10-17). The label shows only where there is room (the detail).
      box.classList.add('gsl-thumb-wait');
      box.title = L('thumbWait');
      if (size >= 200) box.append(h('span', 'gsl-wait-label', L('thumbWait')));
      modelThumb(url, size).then((d) => {
        box.classList.remove('gsl-thumb-wait');
        box.removeAttribute('title');
        box.querySelector('.gsl-wait-label')?.remove();
        if (d && d.startsWith('data:image/png;base64,')) showImg(d);
      });
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
  /** One filter row: a chip in the phone's row, a row of the left column on PC (the shell's CSS). */
  function chip(label: string, n: number, on: boolean, press: () => void, data: Record<string, string>, extra = ''): HTMLButtonElement {
    const c = h('button', `gsl-chip filter-row${extra ? ` ${extra}` : ''}`);
    c.type = 'button';
    for (const [k, v] of Object.entries(data)) c.dataset[k] = v;
    c.setAttribute('aria-pressed', String(on));
    c.append(h('span', 'label', label));
    if (n) c.append(h('b', undefined, String(n)));
    c.addEventListener('click', press);
    return c;
  }

  function renderChips() {
    chips.replaceChildren();
    chips.dataset.shelf = filter.shelf;
    chips.setAttribute('aria-label', L('filterShow'));
    const n: Record<Shelf, number> = { all: rows.length, '3d': 0, '2d': 0, sound: 0, other: 0, motion: motions?.count() ?? 0 };
    n.all += n.motion;
    for (const r of rows) n[shelfOfType(r.type)]++;
    const os = objShelf();
    if (os) {
      n.all += objects!.count();
      n[os] += objects!.count();
    }
    for (const sh of SHELVES) {
      // A shelf with nothing on it is noise (Lantern Cove has no 2D, Firefly Ruins no 3D); kept while it is the one on,
      // so it can still be turned off. All is always there.
      if (sh !== 'all' && !n[sh] && filter.shelf !== sh) continue;
      chips.append(chip(L(`shelf_${sh}` as StringKey), n[sh], filter.shelf === sh, () => {
        // A press on the one that is on goes back to All; any press ends "Show just these objects".
        filter.shelf = filter.shelf === sh ? 'all' : sh;
        objects?.showFile(null);
        render();
      }, { shelf: sh }));
    }
  }

  function renderGrid() {
    const showFiles = showsFiles();
    const list = showFiles ? filterRows(rows, filter) : [];
    // The objects first (what is in the game), then the files they are made from: one grid ("one Library").
    const objs = showsObjects() ? objects!.tiles(filter.q.trim().toLowerCase()) : null;
    const mots = showsMotions() ? motions!.tiles(filter.q.trim().toLowerCase()) : null;
    // "0 files" above "No assets yet" says the same thing twice, and above "Reading the folder…"
    // it reads as a wrong answer ("0 files" + "Reading the folder…" in the play test of 2026-10-17).
    // While "Couldn't read the folder" shows, it takes the count's place (same cell in shell.css).
    const fileCount = loaded && rows.length && !readError ? L('count', { n: list.length }) : '';
    const band = objs ? objects!.band() : null;
    count.replaceChildren();
    if (band) count.append(band);
    else if (!objs) count.textContent = fileCount;
    else if (!showFiles) count.textContent = L('countObjects', { n: objs.n });
    else count.textContent = fileCount ? L('countBoth', { o: objs.n, f: list.length }) : objs.n ? L('countObjects', { n: objs.n }) : '';
    grid.replaceChildren();
    // The Motion filter: "+ New motion" first (studio-motion-flow), then the motions; with none, one line that does
    // the same as the tile (a press on it = the tile's press: "the same guidance, one line, pressable").
    if (filter.shelf === 'motion') {
      count.textContent = L('countMotions', { n: mots?.n ?? 0 });
      const plus = filter.q.trim() ? null : motions?.newTile?.() ?? null;
      if (plus) grid.append(plus);
      if (mots?.tiles.length) grid.append(...mots.tiles);
      else {
        const line = h('div', 'gsl-empty', L(plus ? 'noMotionsMake' : 'noMotionsYet'));
        if (plus) {
          line.classList.add('gsl-empty-act');
          line.setAttribute('role', 'button');
          line.tabIndex = 0;
          line.dataset.part = 'motion-new-line';
          line.addEventListener('click', () => plus.click());
          line.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), plus.click()));
        }
        grid.append(line);
      }
      return;
    }
    if (objs) {
      grid.append(...objs.tiles);
      if (mots) grid.append(...mots.tiles);
      if (!showFiles) {
        if (!objs.tiles.length) grid.append(h('div', 'gsl-empty', objects!.count() ? L('emptyObjects') : L('noObjectsYet')));
        return;
      }
      // Nothing at all for this search: one line for both halves.
      if (!objs.tiles.length && !list.length && filter.q.trim() && loaded) {
        grid.append(h('div', 'gsl-empty', L('emptyBoth')));
        return;
      }
    }
    // What Make with AI is making: a tile first, so the wait has a place even with the panel closed.
    for (const w of aiWork) {
      const tile = h('div', 'gsl-tile gsl-tile-making');
      tile.dataset.making = w.kind;
      // sound effects, music and voice lines wait as sounds (generate-ui, 2026-10-22)
      const type = w.kind === 'model' ? 'model' : w.kind === 'picture' ? 'image' : 'sound';
      const thumb = h('div', `gsl-thumb gsl-thumb-${type} gsl-thumb-wait`);
      thumb.append(h('span', 'gsl-icon', TYPE_ICON[type]!));
      const meta = h('span', 'gsl-meta');
      const clock = h('span', 'gsl-tag gsl-tag-making', L('makingTile', { time: elapsed(w.since) }));
      clock.dataset.since = String(w.since);
      meta.append(clock);
      tile.title = w.prompt;
      tile.append(thumb, h('span', 'gsl-name', w.prompt), meta);
      grid.append(tile);
    }
    if (!list.length) {
      if (aiWork.length) return;
      // Not read yet and the read failed: the line above the grid says so (and has Try again).
      if (!loaded && readError) return;
      const empty = !loaded ? L('loading') : rows.length || status ? L('empty') : deps.host.kumo ? L('noFilesYetAi') : L('noFilesYet');
      // Under the objects, a line about the assets only when there is something to say (none yet / still reading).
      if (objs?.tiles.length && loaded && rows.length) return;
      grid.append(h('div', 'gsl-empty', empty));
      return;
    }
    for (const row of list) {
      // A div, not a <button>: sound tiles hold their own play button, and
      // buttons cannot be nested.
      const tile = h('div', 'gsl-tile');
      tile.tabIndex = 0;
      tile.setAttribute('role', 'button');
      tile.dataset.path = row.path; // dataset is an attribute value, not HTML
      tile.dataset.kind = 'file';
      tile.title = row.path;
      if (row.path === openPath) tile.classList.add('gsl-open');
      const name = h('span', 'gsl-name', baseName(row.path));
      const meta = h('span', 'gsl-meta');
      // One file, many objects (plan 1): a file that objects use says how many ("Used by 3"), in your colour, instead
      // of the plain "Used" mark; files the game only loads (a sound, a sky) keep their mark, and so does every other
      // mark (a missing file an object asks for stays "Missing": that is the news).
      const users = new Set(row.usedBy.map((u) => u.key)).size;
      if (users && row.badge === 'used') {
        const u = h('span', 'gsl-uses', L('usedByN', { n: users }));
        u.title = L('hint_used');
        meta.append(u);
      } else meta.append(badgeEl(row.badge));
      const to = state.replace.get(row.path);
      if (to) meta.append(h('span', 'gsl-tag gsl-tag-replace', `→ ${baseName(to)}`));
      if (newFiles.has(row.path) || state.added.some((a) => a.file === row.path)) meta.append(h('span', 'gsl-tag gsl-tag-new', L('added')));
      if (asked.has(row.path)) meta.append(h('span', 'gsl-tag gsl-tag-del', L('delAsked')));
      // No "Asset" tag in the picture's corner any more (the second design review's ⑦ and "what to cut" 3, 2026-10-19):
      // every tile had one ("Object" on the objects'), saying what the filters, the file name and the picture already
      // say. The line under the name says what is particular to the tile: "Used by 3", or the file's mark.
      const pic = thumbFor(row, 128);
      tile.append(pic, name, meta);
      if (pickedFiles.has(row.path)) tile.classList.add('gsl-open');
      // Dragged onto the Scene row = "Add to scene" (main.ts). Only where an AI can make the object (deps.files.add).
      if (deps.files?.add && row.exists) {
        tile.draggable = true;
        tile.addEventListener('dragstart', (e) => {
          if (!e.dataTransfer) return;
          e.dataTransfer.setData(DRAG_FILE, row.path);
          e.dataTransfer.effectAllowed = 'copy';
        });
      }
      // Shift, or Multi-select: add the file to the pick (or take it out) instead of opening it alone.
      const press = (add: boolean) => (add || objects?.multi() ? toggleFile(row.path) : open(row.path));
      tile.addEventListener('click', (e) => press(e.shiftKey));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          press(e.shiftKey);
        }
      });
      grid.append(tile);
    }
  }

  // ---------- detail ----------
  function renderDetail() {
    const row = rows.find((r) => r.path === openPath);
    // One detail at a time: the open file's, else the picked objects' (an open file drops the pick, see open()).
    const mot = !row && motions ? motions.detail() : null;
    const obj = !row && !mot && objects ? objects.detail() : null;
    detail.hidden = !row && !obj && !mot;
    wrap.classList.toggle('gsl-has-detail', !detail.hidden);
    detail.dataset.kind = row ? 'file' : mot ? 'motion' : obj ? 'object' : '';
    detail.replaceChildren();
    const key = row ? `file:${row.path}` : mot ? mot.key : obj ? `obj:${obj.key}` : '';
    // Phone: the detail sits at the top of the sheet, under its head; a new one picked further down scrolls the sheet
    // back up to it (scrolling the detail itself into view hid the Scene | Library switch above it).
    if (key && key !== lastDetail && !still && getComputedStyle(detail).order !== '0') requestAnimationFrame(() => wrap.scrollTo?.({ top: 0 }));
    lastDetail = key;
    if (mot) detail.append(mot.el);
    if (obj) detail.append(obj.el);
    if (!row) return;

    const head = h('div', 'gsl-dhead');
    const close = h('button', 'gsl-btn gsl-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', L('close'));
    close.addEventListener('click', () => {
      openPath = null;
      pickedFiles.clear();
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
    if (deps.files) detail.append(useSection(row));

    // A heavy 3D file: say what it costs the game, and hand the fix to the AI (the editor only adds files).
    if (row.exists && row.type === 'model' && row.size > HEAVY_MODEL_BYTES) {
      const hv = h('div', 'gsl-section gsl-heavy');
      hv.append(h('p', undefined, L('heavyModel', { size: formatSize(deps.lang, row.size) })));
      if (deps.askAi) {
        const sent = askedLighter.has(row.path);
        const b = h('button', 'gsl-btn gsl-ask-lighter', sent ? L('askLighterSent') : L('askLighter'));
        b.type = 'button';
        b.disabled = sent;
        b.addEventListener('click', async () => {
          b.disabled = true;
          const ok = await askLighter(row.path, row.size);
          if (!ok) setStatus(L('askLighterFailed'));
          render();
        });
        hv.append(b);
      }
      detail.append(hv);
    }

    // Where this file is in the scene. The file and the objects that show it
    // are one thing seen from two sides, so the detail opens with a way back:
    // "In the scene: 2" selects them all in the scene (handles and outlines
    // on the game), and each name below selects one. The scene side has the
    // mirror of it ("Assets: tree.png" on the selected object's card).
    // Plan 1 (2026-10-18): "3 objects use this file", their names, then two ways on — "Show in Objects →" (the Objects
    // shelf narrowed to them: shelf to shelf, the game stays where it is) and "Show in game →" (selects them all in the
    // game, what "In the scene: 3" did). A name opens that object on the Objects shelf. Before, every press here
    // jumped to the game; that jump was the confusing part in a try on 10/18.
    const used = h('div', 'gsl-section gsl-in-scene');
    const keysOf = [...new Set(row.usedBy.map((u) => u.key))];
    if (!keysOf.length) used.append(h('p', 'gsl-muted', L('inSceneNone')));
    else used.append(h('h4', undefined, L('usersHead', { n: keysOf.length })));
    const keys = h('div', 'gsl-keys');
    for (const u of row.usedBy) {
      const k = h('button', 'gsl-key', deps.nameOf ? deps.nameOf(u.key) : u.key);
      k.type = 'button';
      k.dataset.key = u.key;
      k.title = L('select');
      if (!u.sure) k.append(h('i', 'gsl-guess', ` (${L('guessed')})`));
      // In the Library: that object's detail, right here (the file closes). Elsewhere: the shell's way.
      k.addEventListener('click', () => {
        if (objects) {
          openPath = null;
          objects.select(u.key);
        } else if (deps.showObjects) deps.showObjects({ key: u.key });
        else deps.selectObject(u.key);
      });
      keys.append(k);
    }
    used.append(keys);
    // Design review 2, item ①: a file's detail is "Add to scene · Ask your AI… · Replace…" and these chips (a chip opens
    // that object) — nothing more. Gone: "Show just these objects" (the chips are those objects), "Show in game →"
    // (`asset-select-users`: the chip, then the object's own "Show in game →") and the "Mentioned in" list of code files
    // (a fact for the AI, not for the person placing things; refsInCode still feeds the badges and the AI's request).
    // There were 7 kinds of action here (review 2, photo 12).
    detail.append(used);

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

  /**
   * "Add to scene" and "Ask your AI…" for the picked files ("use the Library", 2026-10-18). A new object from a file
   * is code the AI writes, so "Add to scene" drafts that request in the ask box (the file's chip in it, sent with
   * Enter) — the same box and the same Enter as everywhere else, nothing sent behind the person's back. Without an AI
   * (the web demo) the button stays, dimmed, with one line saying why: a missing button reads as "can't be done".
   */
  function useSection(row: LibraryRow): El {
    const use = h('div', 'gsl-section gsl-use');
    const acts = h('div', 'gsl-acts');
    const paths = pickedFiles.size > 1 && pickedFiles.has(row.path) ? [...pickedFiles] : [row.path];
    const many = paths.length > 1;
    const add = h('button', 'gsl-btn gsl-primary gsl-add-scene', many ? L('addToSceneN', { n: paths.length }) : L('addToScene'));
    add.type = 'button';
    add.dataset.action = 'file-add-to-scene';
    const can = !!deps.files!.add && row.exists;
    add.disabled = !can;
    if (can) add.addEventListener('click', () => deps.files!.add!(paths));
    acts.append(add);
    if (deps.files!.ask) {
      const ask = h('button', 'gsl-btn gsl-ask-file', L('askAiFile'));
      ask.type = 'button';
      ask.dataset.action = 'file-ask';
      ask.addEventListener('click', () => deps.files!.ask!(paths));
      acts.append(ask);
    }
    use.append(acts);
    if (!deps.files!.add) use.append(h('p', 'gsl-muted gsl-use-why', L('addNeedsAi')));
    else if (!row.exists) use.append(h('p', 'gsl-muted gsl-use-why', L('addMissing')));
    return use;
  }

  /** Shift / Multi-select on a file's tile: in or out of the pick; the detail shows the last one put in. */
  function toggleFile(path: string) {
    if (pickedFiles.has(path)) {
      pickedFiles.delete(path);
      if (openPath === path) openPath = [...pickedFiles].pop() ?? null;
    } else {
      // The file open alone so far becomes the first of several.
      if (openPath && !pickedFiles.size) pickedFiles.add(openPath);
      pickedFiles.add(path);
      openPath = path;
    }
    picking = false;
    deleting = false;
    objects?.showFile(null);
    render();
  }

  /** Tell the shell what is picked when it changed (its ask box's chip). */
  function sendPick() {
    const list = [...pickedFiles].filter((p) => rows.some((r) => r.path === p));
    const sig = list.join('\n');
    if (sig === pickSent) return;
    pickSent = sig;
    deps.files?.picked(list);
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
  // A press on an object's tile picks it: the file open on the right closes (one detail at a time).
  objects?.onPick((add) => {
    picking = false;
    deleting = false;
    // Shift / Multi-select: the files stay picked with the objects; the detail shows the objects now.
    if (!add) (pickedFiles.clear(), motions?.clear());
    openPath = null;
  });
  // A press on a motion's tile: the same (one detail at a time; Shift / Multi-select keeps the objects and files).
  motions?.onPick((add) => {
    picking = false;
    deleting = false;
    if (!add) (pickedFiles.clear(), objects?.clear());
    openPath = null;
  });
  saveBtn.addEventListener('click', () => void save());

  function renderReadFail() {
    readFail.hidden = !readError;
    readFailText.textContent = readError ? L('readFailed', { e: readError }) : '';
  }

  function render() {
    // Multi-select acts on the objects: in the bar while objects are shown.
    if (objects) {
      const mb = objects.multiButton();
      if (!showsObjects() && !showsMotions()) mb.remove();
      else if (mb.parentElement !== bar) bar.insertBefore(mb, addBtn);
    }
    renderChips();
    renderReadFail();
    renderGrid();
    renderDetail();
    notifyPending();
    sendPick();
  }

  // ---------- public ----------
  /**
   * Read the folder (host) and what the game loaded (bridge), then redraw. Never throws and never
   * waits forever: a failure or no answer within READ_SECONDS shows "Couldn't read the folder (…)."
   * with Try again, and the rows from an earlier good read stay. (Before 2026-10-17 a throw here
   * went to the caller's .catch, which only called refresh() again, and a request that never came
   * back had no limit: either way "Reading the folder…" stayed on screen.)
   * The game's half already has its own 4 s limit (requestAssets) and is optional: without it the
   * folder's files are still listed, only without "Used".
   */
  async function refresh() {
    let timer = 0;
    try {
      const slow = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(L('readSlow', { s: READ_SECONDS }))), READ_SECONDS * 1000);
      });
      const [list, game] = await Promise.race([
        Promise.all([
          deps.host.listAssets(),
          deps.requestAssets().catch(() => ({ loads: [] as LoadEntry[], uses: {} as Record<string, AssetRef[]> })),
        ]),
        slow,
      ]);
      rows = buildRows({ ...normalizeList(list), loads: game?.loads ?? [], uses: game?.uses ?? {}, base: deps.base() });
      loaded = true;
      readError = null;
    } catch (e) {
      readError = (e instanceof Error ? e.message : String(e)) || '?';
    } finally {
      window.clearTimeout(timer);
    }
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
    pickedFiles.clear();
    pickedFiles.add(path);
    picking = false;
    deleting = false;
    // One thing open in the Library: a file's detail drops the objects' pick (its tiles would stay orange next to the
    // open file's: two "picked" at once). On another shelf the file would not be in the grid: show all.
    if (objects) {
      objects.showFile(null);
      objects.clear();
    }
    const row = rows.find((r) => r.path === path);
    if (row && filter.shelf !== 'all' && shelfOfType(row.type) !== filter.shelf) filter.shelf = 'all';
    render();
    // The shell's phone sheet draws the detail at its top, under the head (CSS `order`, plan 1): renderDetail scrolls
    // the sheet up to it so its head (the Scene | Library switch) stays in sight. Elsewhere the detail is where it was.
    if (!still && getComputedStyle(detail).order === '0') detail.scrollIntoView?.({ block: 'nearest' });
  }

  /** "Show just these objects": the Library narrowed to the objects that use `path` (the detail's button, the tile's menu). */
  function showUsers(path: string) {
    if (!objects) return deps.showObjects?.({ file: path });
    openPath = null;
    pickedFiles.clear();
    // On the objects' shelf or All (Sound / Other would hide them); the files step aside while the band shows.
    if (!showsObjects()) filter.shelf = 'all';
    objects.showFile(path);
    objects.clear();
    render();
  }

  /** "Replace…" from the tile's menu (context menu, 2026-10-18): the file's detail with its picker open, in view. */
  function replace(path: string) {
    open(path);
    picking = true;
    render();
    detail.querySelector('.gsl-replace')?.scrollIntoView?.({ block: 'nearest' });
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
  const restore = (j: unknown, s: unknown = j) => {
    state = stateFromFile(j);
    saved = stateFromFile(s);
    render();
  };
  if (deps.initial !== undefined) {
    restore(deps.initial, deps.initialSaved !== undefined ? deps.initialSaved : deps.initial);
    if (deps.initialSaved !== undefined) notifyPending();
  }
  else {
    render();
    void deps.host.load('library').then(restore).catch(() => undefined);
  }

  return {
    refresh,
    save,
    markSaved,
    pending: () => pendingCount(state, saved),
    savedResult: () => buildLibraryJson(saved, rows),
    open,
    showUsers,
    replace,
    revealDetail: () => {
      render();
      if (detail.hidden) return;
      // Phone: the detail heads the sheet (CSS order): the sheet's top. PC: its own column, into view.
      if (getComputedStyle(detail).order !== '0') wrap.scrollTo?.({ top: 0 });
      else detail.scrollIntoView?.({ block: 'nearest' });
    },
    showPick() {
      openPath = null;
      pickedFiles.clear();
      picking = false;
      deleting = false;
      objects?.showFile(null);
      // The objects sit on All and on the game's 3D / 2D only; a search that hides the pick is cleared too.
      if (!showsObjects()) filter.shelf = 'all';
      const sel = (objects?.detail()?.key || '').split(',').filter(Boolean);
      if (filter.q && sel.length && !objects!.tiles(filter.q.trim().toLowerCase()).tiles.some((t) => sel.includes(t.dataset.key!))) {
        filter.q = '';
        search.value = '';
      }
      render();
      // The picked tile in view (it may be far down a long grid), without scrolling the page sideways.
      const tile = sel.length ? grid.querySelector<HTMLElement>('.lib-object.gsl-open') : null;
      if (tile) tile.scrollIntoView?.({ block: 'nearest' });
      if (getComputedStyle(detail).order !== '0') wrap.scrollTo?.({ top: 0 });
    },
    pickedFiles: () => [...pickedFiles],
    holdStill: (fn: () => void) => {
      still = true;
      try {
        fn();
      } finally {
        still = false;
      }
    },
    redraw: () => render(),
    filtersEl: chips,
    headEl,
    assetsOf: (key) => assetsOfKey(rows, key),
    renderAssetsOf,
    rows: () => rows,
    result: () => buildLibraryJson(state, rows),
    destroy() {
      audio.pause();
      if (workTick) window.clearInterval(workTick);
      wrap.remove();
      // The shell may have moved the filters into its left column.
      chips.remove();
    },
  };
}
