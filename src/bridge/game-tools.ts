// Game tools: small editor tools the AI writes for one game in
// `.studio/tools.js` (draw the race course, place along a path, paint tiles…).
//
// The editor stays the same; a tool only gets a narrow context (CONTRACT.md
// §7): read the objects, move one (undoable), turn screen points into scene
// points and back, draw on an overlay canvas, and say "my data changed".
// While a tool is on, pointer presses go to it first (after the handles);
// whatever it does not use still looks around / selects as usual.
import {
  TOOL_ID_RE,
  type BridgeToShell,
  type GameTool,
  type GameToolContext,
  type GameToolInfo,
  type GameToolPointer,
  type Lang,
  type Pose,
  type StudioAdapter,
} from '../contract.ts';
import type { EditState } from './editor.ts';

export interface ToolHostDeps {
  win: Window & typeof globalThis;
  adapter: StudioAdapter;
  state: EditState;
  post: (msg: BridgeToShell) => void;
  select: (key: string | null) => void;
  lang: () => Lang;
  markDirty: () => void;
}

export interface ToolHost {
  register(tools: GameTool[]): void;
  activate(id: string | null): void;
  /** Pointer routing from the input layer; true = the tool used it. */
  pointer(e: GameToolPointer): boolean;
  active(): boolean;
  frame(): void;
  restore(id: string, data: unknown): void;
  collect(): void;
  saved(ids: string[]): void;
  announce(): void;
  detach(): void;
}

const text = (v: GameTool['label'] | undefined, lang: Lang): string =>
  v === undefined ? '' : typeof v === 'string' ? v : v[lang] || v.en || Object.values(v)[0] || '';

export function createToolHost(d: ToolHostDeps): ToolHost {
  const tools = new Map<string, GameTool>();
  const dirty = new Map<string, number>();
  let current: GameTool | null = null;
  let overlay: HTMLCanvasElement | null = null;
  let g: CanvasRenderingContext2D | null = null;
  let needDraw = false;
  // Pose before a run of `hold` moves made by a tool (one undo step per run).
  const holdFrom = new Map<string, Pose>();

  const ensureOverlay = () => {
    if (overlay) return;
    overlay = d.win.document.createElement('canvas');
    overlay.dataset.studio = 'ui';
    overlay.setAttribute('data-studio-ui', '');
    Object.assign(overlay.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '2147483646' });
    (d.win.document.body || d.win.document.documentElement).appendChild(overlay);
    g = overlay.getContext('2d');
  };
  const sizeOverlay = () => {
    if (!overlay || !g) return;
    const dpr = d.win.devicePixelRatio || 1;
    const w = d.win.innerWidth, h = d.win.innerHeight;
    if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
      overlay.width = Math.round(w * dpr);
      overlay.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
  };

  const poseNow = (key: string) => d.adapter.anchor(key)?.pose ?? d.state.items.find((i) => i.key === key)?.pose ?? null;

  const ctx = (): GameToolContext => ({
    dim: d.adapter.dim,
    lang: d.lang(),
    items: () => d.state.items,
    selected: () => d.state.selected,
    select: (k) => d.select(k),
    setPose(key, pose, opts) {
      const from = holdFrom.get(key) ?? poseNow(key);
      const after = d.adapter.setPose(key, pose);
      if (!after || !from) return after;
      d.markDirty();
      if (opts?.hold) {
        if (!holdFrom.has(key)) holdFrom.set(key, from);
        d.post({ type: 'studio:placement/moved', key, pose: after, hold: true });
      } else {
        holdFrom.delete(key);
        d.post({ type: 'studio:placement/moved', key, pose: after, end: true, from });
      }
      return after;
    },
    pickNear: (x, y) => d.adapter.pickNear(x, y, 16),
    toGround: (x, y, gy) => d.adapter.toGround?.(x, y, gy) ?? null,
    toScreen: (p) => d.adapter.toScreen?.(p) ?? null,
    get overlay() {
      ensureOverlay();
      return g!;
    },
    changed() {
      if (current) dirty.set(current.id, (dirty.get(current.id) || 0) + 1);
      needDraw = true;
      if (current) postState(current.id);
    },
  });

  const postState = (id: string) => {
    const t = tools.get(id);
    const n = t?.dirty ? Number(t.dirty()) || 0 : dirty.get(id) || 0;
    d.post({ type: 'studio:tool/state', id, dirty: n, active: current?.id === id });
  };

  const info = (): GameToolInfo[] =>
    [...tools.values()].map((t) => ({ id: t.id, label: text(t.label, d.lang()) || t.id, icon: t.icon ? String(t.icon).slice(0, 4) : undefined, hint: text(t.hint, d.lang()) || undefined }));

  return {
    register(list) {
      for (const t of list || []) {
        if (!t || typeof t.id !== 'string' || !TOOL_ID_RE.test(t.id)) {
          console.warn('[studio] game tool skipped: id must match', TOOL_ID_RE, t && t.id);
          continue;
        }
        tools.set(t.id, t);
      }
    },
    announce() {
      if (tools.size) d.post({ type: 'studio:tool/list', tools: info() });
    },
    activate(id) {
      const next = id ? tools.get(id) || null : null;
      if (current === next) return;
      const c = ctx();
      if (current) {
        try {
          current.deactivate?.(c);
        } catch (e) {
          console.warn('[studio] tool deactivate failed:', e);
        }
        const was = current.id;
        current = null;
        postState(was);
      }
      current = next;
      if (current) {
        ensureOverlay();
        try {
          current.activate?.(c);
        } catch (e) {
          console.warn('[studio] tool activate failed:', e);
        }
        postState(current.id);
      }
      needDraw = true;
    },
    pointer(e) {
      if (!current?.pointer) return false;
      try {
        return !!current.pointer(e, ctx());
      } catch (err) {
        console.warn('[studio] tool pointer failed:', err);
        return false;
      }
    },
    active: () => !!current,
    frame() {
      if (!overlay) return;
      sizeOverlay();
      if (!current?.draw) return;
      try {
        current.draw(ctx());
      } catch (e) {
        if (needDraw) console.warn('[studio] tool draw failed:', e);
      }
      needDraw = false;
    },
    restore(id, data) {
      const t = tools.get(id);
      try {
        t?.restore?.(data);
      } catch (e) {
        console.warn('[studio] tool restore failed:', e);
      }
      needDraw = true;
    },
    collect() {
      const items: Array<{ id: string; data: unknown }> = [];
      for (const [id, t] of tools) {
        const n = t.dirty ? Number(t.dirty()) || 0 : dirty.get(id) || 0;
        if (!n || !t.data) continue;
        try {
          items.push({ id, data: t.data() ?? null });
        } catch (e) {
          console.warn('[studio] tool data failed:', e);
        }
      }
      d.post({ type: 'studio:tool/data', items });
    },
    saved(ids) {
      for (const id of ids) {
        dirty.set(id, 0);
        try {
          tools.get(id)?.saved?.();
        } catch {
          /* the save itself succeeded */
        }
        postState(id);
      }
    },
    detach() {
      if (current) this.activate(null);
      overlay?.remove();
      overlay = null;
      g = null;
    },
  };
}
