// StudioHost for the browser-only web demo (CONTRACT.md §3.1, `offline`).
//
// What it is for: anyone opens a URL on KUMODeck hosting and
// tries the editor on a sample game from any device — no local server, no
// pass, no AI (decided 2026-10-16, step 1 of 2). So:
// - results (placement.json, library.json), game-tool data, UI prefs and the
//   kept requests live in this browser (IndexedDB, see store.ts);
// - the asset list is a table made at build time (scripts/build-web-demo.mjs
//   runs the server's own listAssets() on the sample folder) plus the files
//   added here, which are kept as Blobs and shown through object URLs;
// - request() keeps the request (so the person's words are not lost) but no
//   AI picks it up; `offline: true` makes the shell say so (text.ts).
// It never calls a server API and never needs a pass: every file it reads is
// a plain static file next to the page.
import type {
  AssetFile,
  AssetType,
  GameConfig,
  MissingRef,
  NextStepId,
  Lang,
  SelfCheckResult,
  StudioHost,
  StudioRequestInput,
  ToolId,
  UiPrefs,
} from '../../contract.ts';
import { validateLibrary, validatePlacement } from '../../schema/index.ts';
import type { KvStore } from './store.ts';


/** Where to get Game Studio, for the line that stands in for the ask box (W1-6). The only copy of this address in the demo. */
export const GET_STUDIO_URL = 'https://github.com/kumodeck/game-studio#readme';

/** One sample in studio/games.json (written by scripts/build-web-demo.mjs). */
export interface DemoGame {
  id: string;
  title: string;
  dim: '2d' | '3d';
  /** Page of the game inside its folder, e.g. "index.html". */
  entry: string;
  assets: AssetFile[];
  missing: MissingRef[];
  config: GameConfig | null;
}

const TYPES: AssetType[] = ['image', 'model', 'sound', 'atlas', 'font', 'other'];
const EXT_TYPE: Record<string, AssetType> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image',
  glb: 'model', gltf: 'model', fbx: 'model', obj: 'model',
  mp3: 'sound', ogg: 'sound', wav: 'sound', m4a: 'sound',
  woff2: 'font', woff: 'font', ttf: 'font', otf: 'font',
};

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * @param game     the sample being edited
 * @param gamesDir URL of the folder holding the samples, relative to the editor page ("../games/")
 * @param store    where everything is kept
 */
export async function createBrowserHost(game: DemoGame, gamesDir: string, store: KvStore): Promise<StudioHost> {
  const k = (name: string) => `${game.id}/${name}`;
  const base = new URL(`${gamesDir}${enc(game.id)}/`, location.href);

  // Files added from the Library: path -> object URL (made once per page; the Blobs stay in the store).
  const added = new Map<string, { file: AssetFile; url: string }>();
  for (const [key, v] of await store.list<{ file: AssetFile; blob: Blob }>(k('asset/'))) {
    if (v && v.blob instanceof Blob && v.file) added.set(key.slice(k('asset/').length), { file: v.file, url: URL.createObjectURL(v.blob) });
  }

  const freeName = (name: string) => {
    // Same rule as the local server: never overwrite, pick "name-2.png", "name-3.png"…
    const clean = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 80) || 'file';
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    const taken = (p: string) => added.has(p) || game.assets.some((a) => a.path === p);
    let path = `assets/${clean}`;
    for (let n = 2; taken(path); n++) path = `assets/${stem}-${n}${ext}`;
    return path;
  };

  return {
    offline: true,
    // The one place the demo names where to get the studio (W1-6): the public install page.
    getUrl: GET_STUDIO_URL,
    async open() {
      return { gameUrl: new URL(enc(game.entry), base).href, origin: location.origin, title: game.title };
    },
    async load(tool: ToolId) {
      return ((await store.get<object>(k(`file/${tool}`))) ?? null) as object | null;
    },
    async save(tool: ToolId, json: object) {
      // The same validator as the local server: a broken file is refused, not kept.
      const r = tool === 'placement' ? validatePlacement(json) : validateLibrary(json);
      if (!r.ok) return { ok: false, error: r.errors.join('; ') };
      try {
        await store.set(k(`file/${tool}`), r.value);
        // No request id: there is no AI to hand the save to (the shell shows "saved in this browser").
        return { ok: true, at: Date.now() };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async listAssets() {
      const files = [...game.assets, ...[...added.values()].map((a) => a.file)]
        .map((a) => ({ ...a, type: TYPES.includes(a.type) ? a.type : 'other' }) as AssetFile);
      return { files, missing: game.missing };
    },
    assetUrl(path: string) {
      return added.get(path)?.url ?? new URL(enc(path), base).href;
    },
    async addAsset(file: File) {
      const path = freeName(file.name);
      const ext = (path.split('.').pop() || '').toLowerCase();
      const info: AssetFile = { path, size: file.size, type: EXT_TYPE[ext] || 'other', refsInCode: [] };
      await store.set(k(`asset/${path}`), { file: info, blob: file });
      added.set(path, { file: info, url: URL.createObjectURL(file) });
      return { path };
    },
    async nextStep(_id: NextStepId, _lang: Lang) {
      return { ok: true, prompt: '' };
    },
    async request(r: StudioRequestInput) {
      // Kept so the person's words are not lost (and a later "send to my AI" could read them);
      // nobody picks them up here. Ids sort by time like the local server's.
      const at = Date.now();
      const id = `${new Date(at).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${r.kind}-${Math.random().toString(16).slice(2, 6)}`;
      try {
        await store.set(k(`request/${id}`), { version: 1, id, at, ...r });
      } catch {
        /* keeping it is a bonus; the shell still shows the words */
      }
      return { ok: true, id, at };
    },
    async status() {
      return { status: null, time: null };
    },
    async reportCheck(result: SelfCheckResult) {
      if (!result.ok) console.warn('[studio demo] adapter self-check failed', result);
    },
    async loadUi() {
      // The person's look prefs are about them, not one sample: one key for all games.
      return (await store.get('ui')) ?? null;
    },
    async saveUi(prefs: UiPrefs) {
      try {
        await store.set('ui', prefs);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async loadConfig() {
      return game.config;
    },
    async loadData(id: string) {
      return (await store.get(k(`data/${id}`))) ?? null;
    },
    async saveData(id: string, data: unknown) {
      try {
        await store.set(k(`data/${id}`), data);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    customUi() {
      // No AI rewrites the look here: nothing extra to load.
      return { css: '', js: '' };
    },
  };
}
