// The bridge: the studio's side inside the game page.
//
// It owns the global API (window.studio), finds an adapter, runs the
// adapter self-check, and translates between the shell's messages and the
// adapter. Pointer input and handles live in input.ts / handles.ts; this file
// only wires them up.
import {
  CONTRACT_VERSION,
  LOCAL_PATHS,
  isStudioMessage,
  type AdapterProbe,
  type BridgeToShell,
  type GameExtension,
  type GameTool,
  type Port2D,
  type ShellToBridge,
  type StudioAdapter,
  type StudioGlobal,
} from '../contract.ts';
import { installCore, type Core } from '../core/index.ts';
import { adapterFromPort2D } from '../core/port2d.ts';
import { runSelfCheck } from './selfcheck.ts';
import { createEditor, type Editor } from './editor.ts';
import type { RulesHolder } from '../core/rules.ts';

export interface BridgeOptions {
  builtins: AdapterProbe[];
  win?: Window & typeof globalThis;
}

/** Read the edit flag and the shell's origin from the page URL. */
export function readEditParams(href: string): { edit: boolean; parentOrigin: string } {
  const u = new URL(href);
  const [flagKey, flagVal] = LOCAL_PATHS.editFlag.split('=') as [string, string];
  const edit = u.searchParams.get(flagKey) === flagVal;
  let parentOrigin = u.origin;
  const p = u.searchParams.get(LOCAL_PATHS.parentParam);
  if (p) {
    try {
      parentOrigin = new URL(p).origin;
    } catch {
      /* malformed: stay on our own origin, which the shell can always reach locally */
    }
  }
  return { edit, parentOrigin };
}

export function startBridge(opts: BridgeOptions): void {
  const win = opts.win || window;
  const { edit, parentOrigin } = readEditParams(win.location.href);
  // Outside edit mode (e.g. the game opened directly while the server runs)
  // the script only publishes no-op API so `studio.ready()` calls are harmless.
  const inFrame = win.parent && win.parent !== win;
  const core: Core = installCore({ freezeAfterFirstFrame: edit && !!inFrame, firstFrameTimeoutMs: 4000, win });

  // Probes registered by the game folder (.studio/adapter.js) go first so an
  // AI-written adapter can override a built-in one.
  const gameProbes: AdapterProbe[] = [];
  // .studio/tools.js (loaded before the game) may call studio.extend() before
  // the editor exists; keep what it gave and hand it over when editing starts.
  const rules: RulesHolder = { config: null, ext: [] };
  const pendingTools: GameTool[] = [];
  let editorRef: Editor | null = null;
  const attached: Record<string, unknown>[] = [];

  const api: StudioGlobal = {
    version: CONTRACT_VERSION,
    ready: () => core.time.ready(),
    attach(parts) {
      attached.push(parts);
      win.dispatchEvent(new CustomEvent('studio:attach', { detail: parts }));
    },
    registerAdapter(probe) {
      try {
        probe.install(core);
      } catch (e) {
        console.warn('[studio] adapter install failed:', e);
      }
      gameProbes.push(probe);
    },
    register2D(port) {
      const get = typeof port === 'function' ? port : () => port;
      let built: StudioAdapter | null = null;
      api.registerAdapter({
        kind: 'port2d',
        install() {},
        found() {
          if (built) return built;
          const p = get() as Port2D | null;
          if (!p) return null;
          built = adapterFromPort2D(p, core);
          return built;
        },
      });
    },
    core,
    extend(ext: GameExtension) {
      if (!ext || typeof ext !== 'object') return;
      rules.ext.push(ext);
      const list = Array.isArray(ext.tools) ? ext.tools : [];
      if (editorRef) editorRef.addTools(list);
      else pendingTools.push(...list);
    },
  };
  for (const p of opts.builtins) {
    try {
      p.install(core);
    } catch (e) {
      console.warn('[studio] built-in adapter install failed:', e);
    }
  }
  /**
   * ▶ Play inside the editor: show the saved copies (and deletions) the AI has
   * not put in the code yet, as the editor shows them (polish pass 2026-10-16,
   * play test stumble 2). WHY: a copy lives only in placement.json `added`
   * until the AI writes it into the code; the game's loader only moves
   * existing objects, so every copy vanished in Play and a first-time user
   * read it as "Copy is broken". Same rules as reopening the editor (shell
   * placement-model.ts applyFileEdits): a key the game already has is an
   * ordinary object now (skipped); a `removed` key is hidden only while its
   * label and pose still match `was`. The copy is a clone of the original as
   * it stands, so it looks right but does not act (a boat that floats, a
   * coin that spins) until the AI adds it to the code. Games run outside the
   * editor get the same copies from studio-placement.js (src/loader).
   */
  async function showFileEditsInPlay() {
    type Added = { key?: unknown; from?: unknown; p?: unknown; r?: unknown; s?: unknown; t?: unknown };
    type Removed = { key?: unknown; label?: unknown; was?: { p?: unknown } };
    let file: { added?: Added[]; removed?: Removed[] } | null = null;
    try {
      const res = await fetch(new URL('placement.json', win.location.href).href, { cache: 'no-cache' });
      if (res.ok) file = await res.json();
    } catch {
      return;
    }
    const added = Array.isArray(file?.added) ? file!.added! : [];
    const removed = Array.isArray(file?.removed) ? file!.removed! : [];
    if (!added.length && !removed.length) return;
    await core.time.firstFrame();
    // The game may build its scene a little after its first frame (as in edit mode): look for up to ~5 s.
    let a: StudioAdapter | null = null;
    for (let i = 0; i < 35; i++) {
      for (const p of [...gameProbes, ...opts.builtins]) {
        try {
          a = p.found();
        } catch {
          a = null;
        }
        if (a) break;
      }
      try {
        if (a && a.list().length) break;
      } catch {
        /* not ready */
      }
      await new Promise((r) => win.setTimeout(r, 150));
    }
    if (!a || !a.clone) return;
    let shown = 0;
    const has = (k: string) => a!.list().some((i) => i.key === k);
    for (const e of added) {
      if (typeof e.key !== 'string' || typeof e.from !== 'string' || !Array.isArray(e.p)) continue;
      if (has(e.key) || !has(e.from)) continue;
      try {
        if (!a.clone(e.from, e.key)) continue;
        const pose: Record<string, unknown> = { p: e.p };
        if (typeof e.r === 'number') pose.r = e.r;
        if (e.s !== undefined) pose.s = e.s;
        if (Array.isArray(e.t)) pose.t = e.t;
        a.setPose(e.key, pose as never);
        shown++;
      } catch (err) {
        console.warn('[studio] could not show the copy ' + e.key + ' in Play:', err);
      }
    }
    if (a.remove) {
      const items = a.list();
      for (const r of removed) {
        const it = typeof r.key === 'string' ? items.find((i) => i.key === r.key) : undefined;
        if (!it || (typeof r.label === 'string' && r.label !== it.label)) continue;
        const wp = r.was && Array.isArray(r.was.p) ? (r.was.p as number[]) : null;
        if (wp && it.pose && it.pose.p.some((v, i) => Math.abs(v - (wp[i] ?? 0)) > 1e-3)) continue;
        try {
          if (a.remove(it.key)) shown++;
        } catch {
          /* keep it */
        }
      }
    }
    if (shown) console.info(`[studio] Play: ${shown} saved cop${shown === 1 ? 'y or deletion' : 'ies or deletions'} shown (not in the code yet)`);
  }

  /**
   * Tell the editor when the game's own page throws (polish pass 2026-10-16, "never stuck"): before, a game that
   * stopped on an error left the editor saying "Waiting for the game to draw…" forever, or Play showed a frozen
   * picture, with the reason only in the browser console a newcomer never opens. The shell turns it into one line
   * that says what to do. The first 3 per page load (an error inside a frame loop repeats 60 times a second).
   */
  function watchGameErrors() {
    let sent = 0;
    const send = (message: string, where?: string) => {
      if (sent >= 3) return;
      sent++;
      try {
        const msg: BridgeToShell = { type: 'studio:core/game-error', message: String(message).slice(0, 300), where };
        win.parent.postMessage(msg, parentOrigin);
      } catch {
        /* parent gone */
      }
    };
    win.addEventListener('error', (e: ErrorEvent) => {
      // Only script errors: a missing picture fires 'error' on the <img>, not here (it does not bubble).
      if (!e.message) return;
      const file = e.filename ? e.filename.split(/[?#]/)[0]!.split('/').pop() : '';
      send(e.message, file ? `${file}${e.lineno ? ':' + e.lineno : ''}` : undefined);
    });
    win.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string } | undefined;
      send(r && typeof r.message === 'string' ? r.message : String(e.reason));
    });
  }

  const g = win as unknown as Record<string, unknown>;
  g.__gameStudio = api;
  const prior = g.studio as Record<string, unknown> | undefined;
  if (prior === undefined) g.studio = api;
  else if (prior && typeof prior === 'object' && typeof prior.attach === 'function' && typeof prior.ready === 'function') {
    // The built-in three.js boot script published its own `studio` (attach /
    // waitForReady / ready) a moment earlier. Merge into that object so a game
    // calling studio.ready() reaches both the three.js hold and core time,
    // and studio.register2D() etc. still exist.
    const threeReady = prior.ready as (o?: unknown) => void;
    const threeAttach = prior.attach as (o: unknown) => void;
    const coreReady = api.ready;
    const coreAttach = api.attach;
    prior.ready = (o?: unknown) => {
      threeReady(o);
      // ready() before the game drew anything: the three.js boot lets ONE
      // frame run (so the game places its camera) and holds right after it,
      // with the layout put back as it was at ready() (boot.js, polish pass
      // 2026-10-16). Core time must not freeze before that frame, so tell it
      // "ready" once the boot holds (or after 1.6 s, if no frame comes).
      const boot = g.__studioThree as { holdAfterCamera?: unknown; held?: boolean; on?: (fn: (t: string) => void) => void } | undefined;
      if (boot && boot.holdAfterCamera && !boot.held && boot.on) {
        let done = false;
        const go = () => {
          if (done) return;
          done = true;
          coreReady();
        };
        boot.on((t) => {
          if (t === 'hold') go();
        });
        win.setTimeout(go, 1600);
      } else coreReady();
    };
    prior.attach = (o: Record<string, unknown>) => {
      threeAttach(o);
      coreAttach(o);
    };
    for (const k of ['version', 'registerAdapter', 'register2D', 'core', 'extend'] as const) prior[k] = api[k];
    api.ready = prior.ready as () => void;
    api.attach = prior.attach as (o: Record<string, unknown>) => void;
  }

  if (inFrame) watchGameErrors();
  if (!edit && inFrame) void showFileEditsInPlay();
  if (!edit || !inFrame) return;

  const post = (msg: BridgeToShell) => {
    try {
      win.parent.postMessage(msg, parentOrigin);
    } catch {
      /* parent gone */
    }
  };
  post({ type: 'studio:core/hello', contract: CONTRACT_VERSION });

  let editor: Editor | null = null;
  const queue: ShellToBridge[] = [];

  win.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== win.parent || ev.origin !== parentOrigin) return;
    if (!isStudioMessage(ev.data)) return;
    const msg = ev.data as ShellToBridge;
    if (editor) editor.handle(msg);
    else queue.push(msg);
  });

  const adapterFailed = new Set<string>();
  const findAdapter = (): StudioAdapter | null => {
    for (const p of [...gameProbes, ...opts.builtins]) {
      try {
        const a = p.found();
        if (a) return a;
      } catch (e) {
        console.warn(`[studio] adapter "${p.kind}" failed:`, e);
        // Once per adapter: the shell says what to do (the look-again loop below calls this many times).
        if (!adapterFailed.has(p.kind)) {
          adapterFailed.add(p.kind);
          post({ type: 'studio:core/error', message: `${p.kind}: ${(e as Error)?.message ?? String(e)}` });
        }
      }
    }
    return null;
  };

  core.time.firstFrame().then(async () => {
    // Engines often build the scene a little after their first frame (async
    // asset loading: Phaser's preload, a glTF loader, fonts). Freezing right
    // there would show — and list — nothing. So until an adapter answers with
    // at least one object, let the game run and look again; freeze as soon as
    // there is something to edit. studio.ready() from the game skips the wait
    // (the game knows best), and after ~8 s we stop waiting and report.
    const hasObjects = (a: StudioAdapter | null) => {
      try {
        return !!a && a.list().length > 0;
      } catch {
        return false;
      }
    };
    let adapter = findAdapter();
    for (let i = 0; !hasObjects(adapter) && !core.time.readyCalled && i < 55; i++) {
      post({ type: 'studio:core/wait', reason: adapter ? 'no-objects' : 'no-adapter' });
      core.time.thaw();
      await new Promise((r) => win.setTimeout(r, 150));
      adapter = findAdapter();
    }
    core.time.freeze();
    if (!adapter) {
      // Report "no adapter" now; a found adapter is checked by the editor
      // right after begin(), when 3D adapters have their edit camera.
      post({ type: 'studio:core/check', result: await runSelfCheck(null, core, win) });
      post({ type: 'studio:core/wait', reason: 'no-adapter' });
      return;
    }
    editor = createEditor({ adapter, core, win, post, rules, tools: pendingTools.splice(0) });
    editorRef = editor;
    // Read-only peek for headless tests and debugging (not part of the contract):
    // where the handles of an object are, and what is selected.
    // Through the editor's layers, so copies, deletions and rules show as the shell sees them.
    // under(x, y): the object right under a point of the game (radius 0: no finger slack), or null. Tests use it to
    // choose something to tap that nothing stands in front of (W1 merge 2026-10-17: in test/web-demo the earlier
    // visits' saves had moved a sailboat in front of the small sea stack, and the tap rightly picked the boat).
    const found = editor.driven;
    Object.defineProperty(api, '_debug', {
      value: Object.freeze({ anchor: (k: string) => found.anchor(k), list: () => found.list(), view: () => found.view.state(), foot: (k: string) => found.foot?.(k) ?? null,
        middle: (k: string) => found.middle?.(k) ?? null,
        under: (x: number, y: number) => { try { return found.pickNear(x, y, 0)[0] ?? null; } catch { return null; } } }),
      enumerable: false,
    });
    post({ type: 'studio:core/ready', kind: adapter.kind, dim: adapter.dim, version: adapter.version, editing: false, rise: adapter.dim === '3d' && !!adapter.view.rise, fly: adapter.dim === '3d' && !!adapter.view.fly });
    for (const m of queue.splice(0)) editor.handle(m);
  });
}
