// TEST DOUBLE for the dev harness only — stands in for the shell (src/shell)
// so the library tool can be tried and checked headless before the real
// shell exists. It drives the REAL `libraryTool` (ShellTool) through a fake
// ShellContext:
//   - host = the dev server's /api/* (same routes and rules as CONTRACT.md §3.2,
//     minus the token),
//   - send/on = postMessage to the game iframe (origin and source checked),
//   - Save = validate with src/schema, then host.save (like the shell will),
//   - a tiny "placement" stub that shows the selected object and its files
//     (renderFilesOfObject), to check object <-> file in both directions.

import type { AssetFile, BridgeToShell, LibraryFile, MissingRef, ShellContext, ShellToBridge, StudioHost, ToolId, ValidateResult } from '../../../contract.ts';
import { libraryTool, renderFilesOfObject } from '../index.ts';

type Any = Record<string, any>;

const qs = new URLSearchParams(location.search);
const lang = qs.get('lang') === 'ja' ? 'ja' : 'en';
const frame = document.getElementById('game') as HTMLIFrameElement;
const gameOrigin = location.origin; // the dev server serves the game from the same origin, like the local host

async function api(path: string, init?: RequestInit) {
  const r = await fetch(`/__studio/api/${path}`, init);
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const host: StudioHost = {
  open: () => api('open'),
  load: (tool: ToolId) => api(`result/${tool}`),
  save: (tool: ToolId, json: object) => api(`result/${tool}`, { method: 'PUT', body: JSON.stringify(json), headers: { 'content-type': 'application/json' } }),
  listAssets: () => api('assets') as Promise<{ files: AssetFile[]; missing: MissingRef[] }>,
  assetUrl: (path: string) => '/' + path.split('/').map(encodeURIComponent).join('/'),
  addAsset: (file: File) => api(`assets?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file }),
  async nextStep() {
    return { ok: false, prompt: '' };
  },
  async request() {
    return { ok: false, error: 'no AI hand-off in the library dev harness' };
  },
  async status() {
    return { status: null, time: null };
  },
  async reportCheck() {},
  async loadUi() {
    return null;
  },
  async saveUi() {
    return { ok: true };
  },
  async loadConfig() {
    return null;
  },
  async loadData() {
    return null;
  },
  async saveData() {
    return { ok: true };
  },
  customUi() {
    return { css: '', js: '' };
  },
};

const listeners = new Map<string, Set<(m: Any) => void>>();
addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || e.origin !== gameOrigin) return;
  const m = e.data as Any;
  if (!m || typeof m.type !== 'string' || !m.type.startsWith('studio:')) return;
  for (const cb of [...(listeners.get(m.type) ?? [])]) cb(m);
});

let current: ToolId = 'library';
const ctx: ShellContext = {
  host,
  lang,
  t: (k) => k,
  send: (msg: ShellToBridge) => frame.contentWindow?.postMessage(msg, gameOrigin),
  on(type, cb) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(cb as (m: Any) => void);
    return () => listeners.get(type)?.delete(cb as (m: Any) => void);
  },
  items: () => [],
  selectObject(key) {
    ctx.send({ type: 'studio:placement/select', key, focus: true });
    ctx.switchTool('placement');
  },
  switchTool(id) {
    current = id;
    document.body.dataset.tool = id;
  },
  changed() {
    const n = libraryTool.dirty();
    saveBtn.textContent = n ? `Save (${n})` : 'Save';
    saveBtn.disabled = n === 0;
  },
  phone: () => innerWidth <= 720,
  async ask(r) {
    return (await host.request({ ...r, lang })).ok;
  },
};

const schema = await import('/__lib/schema/index.ts' as string);
async function save() {
  const json = libraryTool.result();
  if (!json) return;
  const v = schema.validateLibrary(json) as ValidateResult<LibraryFile>;
  if (!v.ok) {
    status.textContent = `Not saved: ${v.errors.join('; ')}`;
    return;
  }
  const r = await host.save('library', v.value);
  if (r.ok) {
    libraryTool.saved();
    status.textContent = 'Saved library.json';
  } else status.textContent = `Not saved: ${r.error}`;
  ctx.changed();
}

const saveBtn = document.getElementById('save') as HTMLButtonElement;
const status = document.getElementById('status')!;
saveBtn.addEventListener('click', () => void save());
document.getElementById('back')!.addEventListener('click', () => ctx.switchTool('library'));

// The Selected-object stub: what the placement panel will show.
ctx.on('studio:placement/selected', (m: Extract<BridgeToShell, { type: 'studio:placement/selected' }>) => {
  document.getElementById('sel')!.textContent = m.key ?? '';
  void renderFilesOfObject(document.getElementById('files-of')!, m.key ?? '', ctx);
});

libraryTool.restore?.(await host.load('library'));
const open = await host.open();
frame.src = open.gameUrl;
frame.addEventListener('load', () => {
  // The stand-in has no core/ready; list once the game had time to load its files.
  setTimeout(() => {
    if (!document.querySelector('[data-studio-tool=library]')) libraryTool.mount(document.getElementById('library')!, ctx);
    ctx.changed();
  }, 1500);
}, { once: true });
ctx.switchTool(current);
(window as Any).__harness = { tool: libraryTool, ctx, save };
