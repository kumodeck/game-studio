// The Library tool as the shell sees it (ShellTool, CONTRACT.md §5).
//
// "Library" = the files THIS game uses, listed from three sources (folder,
// names in code, loads while playing), with badges, object <-> file links,
// replace (a note for the AI, plus an image preview in the game) and add
// (new files under assets/, never overwriting). The result is library.json;
// the user's AI reads it and changes the code.
//
// This module only adapts the ShellContext to the panel's small LibraryDeps
// (panel.ts), so the panel can also run in the dev harness and later in the
// cloud shell without changes.

import type { AssetRef, LoadEntry, ShellContext, ShellTool } from '../../contract.ts';
import { mountLibrary } from './panel.ts';
import type { LibraryTool } from './panel.ts';
import { assetsOfKey, buildRows, normalizeList } from './marks.ts';
import type { LibraryRow } from './marks.ts';
import { t } from './strings.ts';
import type { StringKey } from './strings.ts';

let panel: LibraryTool | null = null;
let restored: object | null | undefined;
let offs: Array<() => void> = [];
/** A file to open once the library panel is mounted (pressed from the placement side). */
let pendingOpen: string | null = null;
/** Files the person asked the AI to delete in this session (the whole list goes with every request). */
const askedDelete = new Set<string>();

/** One request/answer over the bridge, matched by the answer's type (and url for previews). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the message union is narrowed by `type`
function ask<T>(ctx: ShellContext, send: () => void, type: 'studio:library/assets' | 'studio:library/previewed', match: (m: any) => boolean, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      reject(new Error('the game did not answer'));
    }, ms);
    off = ctx.on(type, (m) => {
      if (!match(m)) return;
      clearTimeout(timer);
      off();
      resolve(m as T);
    });
    offs.push(off);
    send();
  });
}

/** How long the first read of the folder waits for host.open() (ms); see mount(). */
const OPEN_WAIT_MS = 4000;

/** Folder root of the game URL: "http://127.0.0.1:5173/game/index.html?studio=edit" -> ".../game/". */
export function baseOf(gameUrl: string): string {
  // The local host answers with a path ("/game/index.html"): resolve it
  // against the shell page, or `new URL` throws and every object looked
  // like it used no file (the card's "Assets:" line stayed empty).
  const u = new URL(gameUrl, typeof location !== 'undefined' ? location.href : undefined);
  u.search = '';
  u.hash = '';
  u.pathname = u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
  return u.href;
}

export const libraryTool: ShellTool = {
  id: 'library',
  label: { en: 'Assets', ja: '素材' },

  restore(json) {
    restored = json;
  },

  mount(el, ctx) {
    let base = new URL('/', location.href).href;
    panel = mountLibrary(el, {
      host: ctx.host,
      base: () => base,
      lang: ctx.lang,
      initial: restored === undefined ? undefined : restored,
      requestAssets: () => ask<{ loads: LoadEntry[]; uses: Record<string, AssetRef[]> }>(
        ctx, () => ctx.send({ type: 'studio:library/assets' }), 'studio:library/assets', () => true, 4000),
      preview: async (url, to) => {
        const r = await ask<{ ok: boolean }>(ctx, () => ctx.send({ type: 'studio:library/preview', url, to }),
          'studio:library/previewed', (m) => m.url === url, 4000);
        return r.ok;
      },
      selectObject: (key) => ctx.selectObject(key),
      selectObjects: ctx.selectObjects ? (keys) => ctx.selectObjects!(keys) : undefined,
      onPending: () => ctx.changed(),
      // Same hand-off as "Ideas for your AI" and the card's ask box: host.request (kept as
      // .studio/requests/<id>.json, plus .studio/next-step.md and the `studio: next-step
      // delete-files` line), so the AI line under the bar follows it and a cloud host passes it on
      // the same way. Was host.nextStep before the AI-partner merge (2026-10-16).
      askDelete: async (paths) => {
        const ok = await ctx.ask({ kind: 'next-step', step: 'delete-files', text: '', files: paths });
        if (!ok) throw new Error('request');
      },
      asked: askedDelete,
      // "Ask my AI to make it lighter" on a heavy 3D file: one line to the AI like the ask box (about
      // the whole game, no objects), so it shows in the AI line under the bar and the AI follows the
      // skill's "Heavy 3D files" steps.
      askAi: (text) => ctx.ask({ kind: 'ask', text }),
    });
    // This mount's own panel: a re-mount (language, layout) makes a new one, and the read below
    // must not land in the next panel with this mount's `base`.
    const me = panel;
    // Re-list whenever the game (re)starts in edit mode: a reload after a
    // save loads files again, and an asset added here may now be in use.
    offs.push(ctx.on('studio:core/ready', () => void me.refresh()));
    // First read: once host.open() has told us where the game lives (so loads map to files), but
    // never later than OPEN_WAIT_MS — the folder list does not need it, and waiting on an open()
    // that never answered left "Reading the folder…" on screen for good (2026-10-17). An open()
    // that answers after that only re-reads, so "Used" marks come right.
    // refresh() itself never throws (it shows "Couldn't read the folder" + Try again).
    let first = true;
    const read = () => me.refresh().then(() => {
      if (!first) return;
      first = false;
      if (pendingOpen && panel === me) me.open(pendingOpen);
      pendingOpen = null;
    });
    let opened = false;
    const wait = window.setTimeout(() => { if (!opened && panel === me) void read(); }, OPEN_WAIT_MS);
    void ctx.host.open().then((o) => { base = baseOf(o.gameUrl); }, () => undefined).then(() => {
      opened = true;
      window.clearTimeout(wait);
      if (panel === me) void read();
    });
  },

  unmount() {
    for (const off of offs) off();
    offs = [];
    panel?.destroy();
    panel = null;
  },

  dirty() {
    return panel?.pending() ?? 0;
  },

  result() {
    return panel ? panel.result() : null;
  },

  saved() {
    panel?.markSaved();
  },
};

/** One file an object uses, for the scene card's "Assets: tree.png" line. */
export interface ObjectFile {
  path: string;
  /** The file name without its folder. */
  name: string;
  /** host.assetUrl for images that exist (shown with <img> only), else absent. */
  src?: string;
}

/**
 * The files one object uses (the reverse of the detail's "In the scene: 2"),
 * from the mounted panel's rows when it has them, else listed here once.
 * Never throws: no answer from the game = no files.
 */
export async function filesOfObject(key: string, ctx: ShellContext): Promise<ObjectFile[]> {
  let list: LibraryRow[];
  try {
    if (panel && panel.rows().length) list = panel.assetsOf(key);
    else {
      const [files, game, open] = await Promise.all([
        ctx.host.listAssets(),
        ask<{ loads: LoadEntry[]; uses: Record<string, AssetRef[]> }>(ctx, () => ctx.send({ type: 'studio:library/assets' }), 'studio:library/assets', () => true, 4000),
        ctx.host.open(),
      ]);
      list = assetsOfKey(buildRows({ ...normalizeList(files), ...game, base: baseOf(open.gameUrl) }), key);
    }
  } catch {
    return [];
  }
  return list.map((r) => ({ path: r.path, name: r.path.slice(r.path.lastIndexOf('/') + 1), src: r.type === 'image' && r.exists ? ctx.host.assetUrl(r.path) : undefined }));
}

/** Switch to Assets with one file's detail open (from the scene card). */
export function openAsset(path: string, ctx: ShellContext): void {
  pendingOpen = path;
  ctx.switchTool('library');
  if (panel) {
    panel.open(path);
    pendingOpen = null;
  }
}

/**
 * For the placement panel: "files of this object" for the selected key (the
 * reverse of the library's "used by"). Works while the library panel is not
 * mounted: it lists the files itself the first time. Pressing a file opens it
 * in the library tool.
 *
 * Names are untrusted (folder and game): textContent only; pictures through
 * <img> only.
 */
export async function renderFilesOfObject(el: HTMLElement, key: string, ctx: ShellContext): Promise<void> {
  const L = (k: StringKey) => t(ctx.lang, k);
  let list: LibraryRow[];
  try {
    if (panel && panel.rows().length) list = panel.assetsOf(key);
    else {
      const [files, game, open] = await Promise.all([
        ctx.host.listAssets(),
        ask<{ loads: LoadEntry[]; uses: Record<string, AssetRef[]> }>(ctx, () => ctx.send({ type: 'studio:library/assets' }), 'studio:library/assets', () => true, 4000),
        ctx.host.open(),
      ]);
      list = assetsOfKey(buildRows({ ...normalizeList(files), ...game, base: baseOf(open.gameUrl) }), key);
    }
  } catch {
    list = [];
  }
  const head = document.createElement('h4');
  head.textContent = L('assetsOfObject');
  el.replaceChildren(head);
  if (!list.length) {
    const p = document.createElement('p');
    p.textContent = L('noAssets');
    el.append(p);
    return;
  }
  const ul = document.createElement('div');
  ul.className = 'gsl-objfiles';
  for (const r of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = r.path;
    if (r.type === 'image' && r.exists) {
      const img = document.createElement('img');
      img.alt = '';
      img.width = 32;
      img.height = 32;
      img.src = ctx.host.assetUrl(r.path);
      b.append(img);
    }
    const name = document.createElement('span');
    name.textContent = r.path.slice(r.path.lastIndexOf('/') + 1);
    b.append(name);
    b.addEventListener('click', () => {
      pendingOpen = r.path;
      ctx.switchTool('library');
      if (panel) {
        panel.open(r.path);
        pendingOpen = null;
      }
    });
    ul.append(b);
  }
  el.append(ul);
}
