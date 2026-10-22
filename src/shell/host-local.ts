// StudioHost for the local server (src/server, CONTRACT.md §3.2).
//
// Authentication: the server trades the one-time pass in the printed link
// (?t=…) for an HttpOnly, SameSite=Strict cookie and redirects to a clean URL
// before this page loads, so the shell never sees or stores the secret. Every
// call is same-origin with credentials; writes are also checked by Origin.
import {
  LOCAL_PATHS,
  type AssetFile,
  type AssetType,
  type GameConfig,
  type KumoHost,
  type KumoRefusal,
  type KumoStatus,
  type UiPrefs,
  type Lang,
  type MissingRef,
  type NextStepId,
  type SelfCheckResult,
  type StudioHost,
  type StudioRequestInput,
  type StudioStatus,
  type ToolId,
} from '../contract.ts';

const TYPES: AssetType[] = ['image', 'model', 'sound', 'atlas', 'font', 'other'];

/**
 * The optional KUMODeck sign-in (src/server/kumo.mjs). A refusal (422 { error, code }) comes back
 * as { ok: false, code, message } for the editor to word; other failures as code 'failed'.
 */
function createKumoHost(base: string): KumoHost {
  const kumo = async <T>(method: string, path: string, body?: unknown): Promise<({ ok: true } & T) | KumoRefusal> => {
    try {
      const r = await fetch(base + 'kumo/' + path, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (r.ok && data) return { ok: true, ...(data as T) };
      return {
        ok: false,
        code: typeof data?.code === 'string' ? data.code : 'failed',
        message: typeof data?.error === 'string' ? data.error : `HTTP ${r.status}`,
        ...(typeof data?.balanceCents === 'number' ? { balanceCents: data.balanceCents } : {}),
        ...(typeof data?.needCents === 'number' ? { needCents: data.needCents } : {}),
      };
    } catch (e) {
      return { ok: false, code: 'unreachable', message: (e as Error).message };
    }
  };
  return {
    async status() {
      const r = await kumo<KumoStatus>('GET', 'status');
      return r.ok ? r : { signedIn: false, loginCommand: 'npx kumodeck login', error: { code: r.code, message: r.message } };
    },
    pickProject: (id) => kumo('POST', 'project', { projectId: id }),
    makePicture: (req) => kumo('POST', 'image', req),
    makeModel: (req) => kumo('POST', 'model3d', req),
    job: (id) => kumo('GET', `model3d/${encodeURIComponent(id)}`),
    makeSound: (req) => kumo('POST', 'sound', req),
  };
}

export function createLocalHost(base: string = LOCAL_PATHS.api): StudioHost {
  const call = async <T>(method: string, path: string, body?: BodyInit, type?: string, keepalive = false): Promise<T> => {
    const headers: Record<string, string> = {};
    if (type) headers['content-type'] = type;
    const r = await fetch(base + path, { method, headers, body, cache: 'no-store', credentials: 'same-origin', ...(keepalive ? { keepalive } : {}) });
    const data = (await r.json().catch(() => null)) as (T & { error?: string; details?: string[] }) | null;
    if (!r.ok) {
      const details = data && Array.isArray(data.details) ? `: ${data.details.join('; ')}` : '';
      throw new Error(((data && data.error) || `HTTP ${r.status}`) + details);
    }
    return data as T;
  };

  return {
    kumo: createKumoHost(base),
    async open() {
      const r = await call<{ gameUrl: string; origin: string; title?: string }>('GET', 'open');
      return { gameUrl: r.gameUrl, origin: r.origin, title: r.title };
    },
    async load(tool: ToolId) {
      const r = await call<{ value: object | null }>('GET', `files/${tool}`);
      return r.value ?? null;
    },
    async save(tool: ToolId, data: object, opts?: { handoff?: boolean }) {
      try {
        const q = opts?.handoff === false ? '?handoff=0' : '';
        const body = JSON.stringify(data);
        // The draft written as the tab closes (main.ts pagehide, after "Leave" on the browser's question) must outlive
        // the page: keepalive. Only under the browser's 64 KB keepalive limit (a bigger body would fail outright).
        const keepalive = opts?.handoff === false && body.length < 60_000;
        const r = await call<{ request?: string; at?: number; watching?: boolean; seen?: string; undo?: boolean }>('PUT', `files/${tool}${q}`, body, 'application/json', keepalive);
        return { ok: true, request: r.request, at: r.at, watching: r.watching, seen: r.seen, undo: r.undo };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async listAssets() {
      const r = await call<{ assets: AssetFile[]; missing: Array<{ ref: string; in: string[] }> }>('GET', 'assets');
      // The local server says "audio" for sounds (src/server/assets.mjs); the contract says "sound". Mapping it to
      // "other" put every mp3 under Other in the Library's filters (found with All / 3D / 2D / Sound / Other, 2026-10-18).
      const typeOf = (t: string) => (t === 'audio' ? 'sound' : TYPES.includes(t as AssetType) ? (t as AssetType) : 'other');
      const files = (r.assets || []).map((a) => ({ ...a, type: typeOf(a.type) }) as AssetFile);
      const missing: MissingRef[] = (r.missing || []).map((m) => ({ path: m.ref, refsInCode: m.in || [] }));
      return { files, missing };
    },
    assetUrl(path: string) {
      return '/' + path.split('/').map(encodeURIComponent).join('/');
    },
    async addAsset(file: File) {
      const r = await call<{ path: string }>('POST', `assets?name=${encodeURIComponent(file.name)}`, file, 'application/octet-stream');
      return { path: r.path };
    },
    async nextStep(id: NextStepId, _lang: Lang, detail?: { files?: string[] }) {
      // The server writes the steps in English for the agent; the shell shows
      // the user's language and keeps its own copyable request text.
      const body = detail?.files ? { id, files: detail.files } : { id };
      await call('POST', 'next-step', JSON.stringify(body), 'application/json');
      return { ok: true, prompt: '' };
    },
    async request(r: StudioRequestInput) {
      try {
        const v = await call<{ id: string; at: number; watching?: boolean; seen?: string; undo?: boolean }>('POST', 'request', JSON.stringify(r), 'application/json');
        return { ok: true, id: v.id, at: v.at, watching: v.watching, seen: v.seen, undo: v.undo };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async status() {
      const r = await call<{ status: StudioStatus | null; time: number | null; watching?: boolean; seen?: string; code?: string; agent?: string }>('GET', 'status')
        .catch(() => ({ status: null, time: null } as { status: null; time: null; watching?: boolean; seen?: string; code?: string; agent?: string }));
      // Only the two names the line knows; anything else is "your AI" (which-ai.mjs).
      const agent = r.agent === 'claude' || r.agent === 'codex' ? r.agent : undefined;
      return { status: r.status ?? null, time: typeof r.time === 'number' ? r.time : null, watching: r.watching, seen: r.seen, code: r.code, agent };
    },
    async undoAi(to: string, opts?: { redo?: boolean }) {
      try {
        const v = await call<{ restored: number; removed: number; redo: string | null }>('POST', 'undo', JSON.stringify({ to, redo: opts?.redo === true }), 'application/json');
        return { ok: true, restored: v.restored, removed: v.removed, redo: v.redo };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async loadUi() {
      return (await call<{ value: unknown }>('GET', 'ui').catch(() => ({ value: null }))).value ?? null;
    },
    async saveUi(prefs: UiPrefs) {
      try {
        await call('PUT', 'ui', JSON.stringify(prefs), 'application/json');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    // The printed link with its pass (server.mjs "link"), asked only when "Open large" is pressed and handed straight
    // to window.open: the shell keeps no copy of it.
    async largeLink() {
      return (await call<{ url?: string }>('GET', 'link').catch(() => ({ url: undefined }))).url || null;
    },
    async loadConfig() {
      const r = await call<{ value: GameConfig | null; error?: string }>('GET', 'config').catch(() => ({ value: null, error: undefined }));
      if (r.error) console.warn('[studio]', r.error);
      return r.value ?? null;
    },
    async loadData(id: string) {
      return (await call<{ value: unknown }>('GET', `data/${encodeURIComponent(id)}`).catch(() => ({ value: null }))).value ?? null;
    },
    async saveData(id: string, data: unknown) {
      try {
        await call('PUT', `data/${encodeURIComponent(id)}`, JSON.stringify(data), 'application/json');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    customUi() {
      return { css: '/__studio/game-ui.css', js: '/__studio/game-ui.js' };
    },
    async reportCheck(result: SelfCheckResult) {
      await fetch(base + 'check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result), credentials: 'same-origin' }).catch(() => undefined);
    },
  };
}
