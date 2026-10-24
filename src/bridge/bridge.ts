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
import { installPlayClock } from '../core/play-clock.ts';
import { adapterFromPort2D } from '../core/port2d.ts';
import { findDomUiPort, uiAdapterFromPort } from '../adapters/ui/index.ts';
import { codeUiEntries, createCodeUi, mergeUiPorts, type CodeUi } from './code-ui.ts';
import { findUi as findUiNow, markHudCanvases, type Rect } from './ui-found.ts';
import { runSelfCheck } from './selfcheck.ts';
import { createEditor, type Editor } from './editor.ts';
import { startPlayAsk, type PlayAskHandle } from './play-ask.ts';
import { createPlaySwitch, type PlaySwitch } from './play-switch.ts';
import { arrangeInPlay, moveInPlay, type PlayFile } from './play-arrange.ts';
import { applyPlacement, placementForLevel } from '../loader/studio-placement.js';
import { pickLevel } from './levels.ts';
import { watchEarlyTaps } from './early-press.ts';
import type { RulesHolder } from '../core/rules.ts';
import { nativeSetTimeout } from '../core/native.ts';

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
  // ▶ Play inside the editor: the game's clock, so a pause (P) takes no time (core/play-clock.ts). Before the core and
  // before any game code, so the game's first performance.now() and every frame's timestamp already go through it.
  // In the edit page too since ▶ Play in the same page (fast switch, 2026-10-22; play-switch.ts): there it stops with
  // every hold of the game (time.ts `clock`), so the page that becomes Play steps one frame, not the minutes of Edit.
  const playClock = inFrame ? installPlayClock(win) : null;
  const core: Core = installCore({ freezeAfterFirstFrame: edit && !!inFrame, firstFrameTimeoutMs: 4000, win,
    ...(playClock ? { stamp: playClock.at } : {}), ...(playClock && edit ? { clock: playClock } : {}) });

  // Probes registered by the game folder (.studio/adapter.js) go first so an
  // AI-written adapter can override a built-in one.
  const gameProbes: AdapterProbe[] = [];
  // The UI seat (UI stage 1, CONTRACT.md §1.1): ports the game registered with studio.registerUI(), asked before the
  // built-in DOM UI adapter. A separate list from the world's probes, so a UI never competes with three.js or the
  // game's own adapter for the one world slot.
  const uiPorts: Array<{ get: () => Port2D | null; built: StudioAdapter | null }> = [];
  // .studio/tools.js (loaded before the game) may call studio.extend() before
  // the editor exists; keep what it gave and hand it over when editing starts.
  const rules: RulesHolder = { config: null, ext: [] };
  const pendingTools: GameTool[] = [];
  let editorRef: Editor | null = null;
  // studio.redraw(fn) (studio-canvas-ui, 2026-10-24): the game's own one-frame draw for its codeUis, when it does not
  // draw from requestAnimationFrame. null = the editor runs the game's waiting frame once (core time.step()).
  let redrawFn: (() => void) | null = null;
  // The codeUi side of the UI seat once the editor found it (studio.screen() reads its screen).
  let uiCodeRef: CodeUi | null = null;
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
    registerUI(port) {
      uiPorts.push({ get: typeof port === 'function' ? port : () => port, built: null });
    },
    redraw(fn) {
      redrawFn = typeof fn === 'function' ? fn : null;
    },
    // The canvas UI's screen the editor shows (studio-canvas-ui stage 2; code-ui.ts): null outside editing — the game
    // decides then, and ▶ Play starts from its own first screen as with HTML screens.
    screen: () => (playSwitch?.playing ? null : uiCodeRef?.screenNow() ?? null),
    core,
    // Levels (2026-10-22, bridge/levels.ts): the code's levels go to the editor (once per page), and the page builds
    // the level the editor's URL asks for. Outside the editor's frame: null, the game picks its level itself.
    levels(list) {
      const r = pickLevel(list, win.location.href, !!inFrame);
      if (!r) return null;
      if (inFrame) {
        try {
          const msg: BridgeToShell = { type: 'studio:core/levels', levels: r.levels, current: r.pick.id };
          win.parent.postMessage(msg, parentOrigin);
        } catch {
          /* parent gone */
        }
      }
      return r.pick;
    },
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
   * ▶ Play inside the editor: the game as the editor shows it, saved or not (play-arrange.ts says why and what). The
   * file is the editor's draft, written just before Play opened this page (shell keepNow). Its UI places go through the
   * loader's own applyPlacement(document, …) (placeUi: the same offset set again, never added), the world's through the
   * page's adapter once it lists its objects.
   */
  async function showFileEditsInPlay(): Promise<string[]> {
    let file: PlayFile & { ui?: unknown } | null = null;
    try {
      const res = await fetch(new URL('placement.json', win.location.href).href, { cache: 'no-cache' });
      if (res.ok) file = await res.json();
    } catch {
      return [];
    }
    if (!file || typeof file !== 'object') return [];
    // A game with levels (2026-10-22): only the level this page shows (the URL's studioLevel; none = nothing moves).
    if (Array.isArray((file as { levels?: unknown }).levels)) file = placementForLevel(file, new URL(win.location.href).searchParams.get(LOCAL_PATHS.levelParam) || '');
    if (!file) return [];
    if (file.ui && typeof file.ui === 'object') {
      try {
        await applyPlacement(win.document, { tool: 'placement', objects: {}, ui: file.ui });
      } catch {
        /* the UI stays as the game draws it */
      }
    }
    const busy = (file.objects && Object.keys(file.objects).length) || file.added?.length || file.removed?.length || file.order?.length
      || (file.motion && Object.keys(file.motion).length);
    if (!busy) return [];
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
      await new Promise((r) => nativeSetTimeout(r, 150));
    }
    if (!a) return [];
    const shown = arrangeInPlay(a, file);
    if (shown) console.info(`[studio] Play: ${shown} change${shown === 1 ? '' : 's'} from the editor shown (saved or not, not in the code yet)`);
    // The draft's motions (motion-gui, 2026-10-22), for the objects the page's own loader does not move.
    const moving = moveInPlay(a, file, win);
    if (moving.length) console.info(`[studio] Play: ${moving.length} motion${moving.length === 1 ? '' : 's'} from the editor played (not in the code yet)`);
    // The keys those motions move: a pause shows them as "just for this moment" (play-move.ts).
    return moving;
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
        nativeSetTimeout(go, 1600);
      } else coreReady();
    };
    prior.attach = (o: Record<string, unknown>) => {
      threeAttach(o);
      coreAttach(o);
    };
    for (const k of ['version', 'registerAdapter', 'register2D', 'registerUI', 'redraw', 'screen', 'core', 'extend', 'levels'] as const) prior[k] = api[k];
    api.ready = prior.ready as () => void;
    api.attach = prior.attach as (o: Record<string, unknown>) => void;
  }

  if (inFrame) watchGameErrors();
  // ▶ Play inside the editor: ask your AI without stopping (play-ask.ts, §3.5). Installed now, before the game's code,
  // so the console is kept from its first line and the ask key is the first listener on the window.
  // In the edit page too, asleep (`standby`) until the page becomes Play (play-switch.ts, fast switch 2026-10-22): its
  // key listener must be the first on the window, and the AudioContexts the game makes must be kept from the start.
  let playAsk: PlayAskHandle | null = null;
  let playSwitch: PlaySwitch | null = null;
  if (inFrame) {
    // For tests (test/studio-play-unsaved.browser.mjs), like `_debug` in edit mode: the page's objects as its adapter
    // lists them while playing, to compare with what the editor showed. Not enumerable, nothing else uses it.
    Object.defineProperty(api, '_play', {
      value: Object.freeze({
        // Play in the same page (test/studio-fast-switch.browser.mjs): is this edit page playing now? A Play page: true.
        playing: () => (edit ? !!playSwitch?.playing : true),
        list: () => {
          // An edit page playing (fast switch): what it shows, through the editor's copies and deletions — the page's
          // own objects as a Play page's draft would have made them.
          const l = edit ? editorRef?.playLayers()[0] : null;
          if (l) return l.edits.list();
          for (const p of [...gameProbes, ...opts.builtins]) {
            try {
              const a = p.found();
              if (a) return a.list();
            } catch {
              /* next */
            }
          }
          return null;
        },
      }),
      enumerable: false,
    });
    // The edit page shows the draft already (the editor's own work): nothing to arrange; Play gives its motions then.
    const arranged = edit ? Promise.resolve([] as string[]) : showFileEditsInPlay();
    // Pause-move (stage 2): the editor that wakes in a paused game needs the core and the game's rules, and the draft's
    // motions (what the game page moves for the editor) to say "just for this moment" on them.
    playAsk = startPlayAsk({ win, parentOrigin, probes: () => [...gameProbes, ...opts.builtins], standby: edit,
      ...(playClock ? { pause: { time: core.time, clock: playClock }, move: { core, rules, arranged } } : {}) });
  }
  if (!edit || !inFrame) return;
  // A tap in the game before the editor is ready is kept for it (early-press.ts): from the very start, before the game's code.
  const earlyTaps = watchEarlyTaps(win);

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
    // Play / Edit in this page (play-switch.ts): the shell sends it only once the editor is up.
    if (msg.type === 'studio:core/play') {
      playSwitch?.handle(msg);
      return;
    }
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
  /**
   * The UI layer's adapter (UI stage 1), or null — then everything below runs exactly as before. Order: the game's
   * registerUI() ports, then the built-in DOM UI (elements marked data-studio-key). Not for a game whose world IS
   * the DOM (a port named 'dom', examples/dom-board): its pieces carry data-studio-key as world objects, and they
   * stay there; elements the world already lists are skipped for any game.
   */
  // The UI found is the built-in DOM one (not a game's registerUI port): screens, text and colours apply (ui-extras.ts).
  let uiDom = false;
  // The UI the game draws in its canvas (codeUi, studio-canvas-ui 2026-10-24; code-ui.ts), merged into the same list.
  let uiCode: CodeUi | null = null;
  // The keys the DOM UI lists (a codeUi with the same key is not listed: the HTML one stays, said once).
  let domKeys = new Set<string>();
  const findUi = (world: StudioAdapter | null): StudioAdapter | null => {
    uiDom = false;
    uiCode = null;
    for (const u of uiPorts) {
      try {
        if (u.built) return u.built;
        const p = u.get();
        if (p) return (u.built = uiAdapterFromPort(p, core, win));
      } catch (e) {
        console.warn('[studio] UI port failed:', e);
      }
    }
    if (world && world.kind === 'dom') return null;
    // A 2D canvas laid over the game's (a HUD canvas): the UI layer's, before any adapter hides "the game's DOM over the
    // canvas" when editing starts (studio-canvas-ui stage 2; ui-found.ts markHudCanvases).
    try {
      markHudCanvases(win);
    } catch {
      /* none marked: as before */
    }
    try {
      const skip = () => {
        try {
          return new Set(world ? world.list().map((i) => i.key) : []);
        } catch {
          return new Set<string>();
        }
      };
      const dom = findDomUiPort(win, skip);
      uiDom = !!dom;
      domKeys = new Set(dom ? dom.objects().map((o) => o.key) : []);
      // codeUis (none = exactly as before: the DOM port alone, in its page order).
      const code = codeUiEntries(win).length ? createCodeUi({ win, core, post, lang: () => editorRef?.lang() ?? 'en', redraw: () => redrawFn, domKeys: () => domKeys,
        // The world adapter draws the frame when the engine's loop sleeps while editing (Phaser, Pixi).
        world: () => world }) : null;
      if (code && code.port.objects().length) {
        uiCode = code;
        return uiAdapterFromPort(mergeUiPorts(dom, code.port), core, win);
      }
      if (dom) return uiAdapterFromPort(dom, core, win);
      // Nothing selectable yet, but the game's UI is seen (studio-canvas-ui stage 2, 2026-10-24; ui-found.ts): a HUD canvas
      // over the game's with something drawn in it, or UI the engine's adapter leaves out. An empty UI layer then, so
      // Scene | UI is there, its list says "No selectable UI yet", the frames show where it is, and a press there says
      // why with ✦. One canvas with everything in it finds nothing: no UI layer, exactly as before.
      const boxes: Rect[] = code ? code.port.objects().map((o) => code.port.bounds(o.key)).filter((b): b is Rect => !!b) : [];
      let left: Rect[] = [];
      try {
        left = world?.leftOut?.() ?? [];
      } catch {
        left = [];
      }
      // Only beside a world: with no world adapter (yet) an empty UI layer would end the wait for one (the loop above
      // stops at the first UI it finds) and open an editor with nothing to edit.
      if (world && (code || findUiNow(win, boxes, left).length)) return uiAdapterFromPort(nothingYet(), core, win);
      return null;
    } catch (e) {
      console.warn('[studio] DOM UI adapter failed:', e);
      return null;
    }
  };

  /** The UI seat with nothing to select yet (stage 2): an empty list, the same 2D base as every UI port. */
  const nothingYet = (): Port2D => ({
    name: 'canvas-ui',
    objects: () => [],
    get: () => null,
    set() {},
    parentToScreen: () => null,
    bounds: () => null,
    render() {},
    canvas: () => null,
    capture: async () => null,
  });

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
    // The wait is the world's alone (a title shown before the 3D models load must not stop it early). One
    // exception (UI stage 1): no world adapter at all but a UI — an HTML-only game — stops after ~1 s instead of 8.
    let uiOnly: StudioAdapter | null = null;
    for (let i = 0; !hasObjects(adapter) && !core.time.readyCalled && i < 55; i++) {
      if (!adapter && i >= 6 && (uiOnly = findUi(null))) break;
      post({ type: 'studio:core/wait', reason: adapter ? 'no-objects' : 'no-adapter' });
      core.time.thaw();
      await new Promise((r) => nativeSetTimeout(r, 150));
      adapter = findAdapter();
    }
    core.time.freeze();
    const ui = adapter ? findUi(adapter) : uiOnly || findUi(null);
    if (!adapter && !ui) {
      // Report "no adapter" now; a found adapter is checked by the editor
      // right after begin(), when 3D adapters have their edit camera.
      post({ type: 'studio:core/check', result: await runSelfCheck(null, core, win) });
      post({ type: 'studio:core/wait', reason: 'no-adapter' });
      return;
    }
    uiCodeRef = uiCode;
    editor = createEditor({ adapter, ui, uiDom: !!ui && uiDom, uiCode, redraw: () => redrawFn, core, win, post, rules, tools: pendingTools.splice(0), earlyTaps });
    editorRef = editor;
    if (playAsk) playSwitch = createPlaySwitch({ win, core, editor, playAsk });
    // Read-only peek for headless tests and debugging (not part of the contract):
    // where the handles of an object are, and what is selected.
    // Through the editor's layers, so copies, deletions and rules show as the shell sees them.
    // under(x, y): the object right under a point of the game (radius 0: no finger slack), or null. Tests use it to
    // choose something to tap that nothing stands in front of (W1 merge 2026-10-17: in test/web-demo the earlier
    // visits' saves had moved a sailboat in front of the small sea stack, and the tap rightly picked the boat).
    // The layer being edited now (UI stage 1: `layer()` says which; the world's unless switched).
    const ed = editor;
    const found = () => ed.driven;
    const debug = Object.freeze({ anchor: (k: string) => found().anchor(k), list: () => found().list(), view: () => found().view.state(), foot: (k: string) => found().foot?.(k) ?? null,
      middle: (k: string) => found().middle?.(k) ?? null, layer: () => ed.layer(),
      // Snap to surfaces (test/studio-snap-surface.browser.mjs): bottom / surface heights, and a scene point on screen.
      rest: (k: string) => found().rest?.(k) ?? null, toScreen: (p: number[]) => found().toScreen?.(p) ?? null,
      under: (x: number, y: number) => { try { return found().pickNear(x, y, 0)[0] ?? null; } catch { return null; } } });
    // Absent while this page plays (fast switch, 2026-10-22): the screen tests read "_debug there = the editor is up,
    // gone = Play" (and `_play` for Play's list), as when Play was always another page.
    Object.defineProperty(api, '_debug', { get: () => (playSwitch?.playing ? undefined : debug), enumerable: false });
    // core/ready (with `drop` for snap to surfaces, and the layers for UI stage 1): editor.ts ready().
    editor.announce();
    for (const m of queue.splice(0)) editor.handle(m);
  });
}
