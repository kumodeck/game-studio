// ● Clip, stage 1 (decided 2026-11-05; CONTRACT.md §3.5.4): the recording, in the game page.
//
// WHY here and not in the editor page: the game is an iframe, often of another origin (shell main.ts gameOrigin), and a
// page cannot read the pixels of another origin's frame. The bridge is already in the game page, so it composes each
// frame itself, encodes it with the browser's own H.264 encoder (WebCodecs VideoEncoder) and posts the encoded samples
// to the editor page, which puts them in an MP4 (shell/mp4.ts) and has the local server save it (src/server/clips.mjs).
// The editor's frame, bar, column, address (with its pass) and folder names are never in the picture: only this page.
//
// One frame (30 fps, 1280×720):
//   1. the page's HTML UI is painted into layers by play-shot.ts's painter (`paintPage` with `canvas`): under the first
//      canvas, between canvases, over the last — the HUD, the score, the title. That painter is slow (it reads every
//      element's style), so the layers are painted again only when the page changed (a MutationObserver, resize) and at
//      most 10 times a second; between, each frame reuses them;
//   2. each frame is the layers with the canvases' live pictures between them, the game's page fitted into 16:9 on black;
//   3. the last second also gets the mark (clip-model.ts CLIP_MARK_LINES) when the person keeps it on, and that second is
//      encoded a second time the other way (with ↔ without) by a second encoder starting on a key frame, so the editor
//      can swap the end of the clip ("Remove “Made with”" in its line) without recording again;
//   4. new VideoFrame(composite) → VideoEncoder → each chunk posted (`studio:clip/chunk`, transferred, not copied).
//
// Stage 2 (decided 2026-11-05):
//   - Stop is cut at the PRESS, not at the message: the editor says when ● Clip was pressed (`at`, one clock for both
//     pages: performance.timeOrigin + now). A busy game page takes the message late (seconds, at a load of 60–75), and
//     the clip used to end a second after the message came — 2 s pressed, 4–6 s saved. Now the frames recorded between
//     the press and the message are dropped (their encoded samples are not posted) and the mark's second starts on the
//     next frame, stamped as if right after the press: the clip is exactly as long as pressed, a little of the game
//     after the press left out.
//   - ● Clip Before / After (`before` in the start): the asked frame, still, with "Before" and the asked words, is
//     encoded first (BA_STILL_FPS, no waiting: its frames are stamped, not timed), then `started` — the editor resumes
//     the paused Try then — and the game's picture follows on the clip's clock from there, with the Before wiped off
//     over its first `wipeMs` and "After" in its corner.
//   - Tall (720×1280): only the size changes here; the editor gives the game a 9:16 window while recording, so the page
//     fills the frame. The asked frame (taken in the wide window) is cut to fill a tall frame (cover), never squeezed.
//
// Stage 3 (decided 2026-11-07):
//   - the game's sound (clip-sound.ts): captured from the start of the game's picture, encoded as AAC at the end and
//     posted (`studio:clip/sound`) before `done`, which says how it went (`sound`: on / silent / off / unsupported /
//     failed). A game that made no sound gets no sound track, as before;
//   - WebGPU: no longer refused. Its picture is taken in its own frame while recording (`gpu` below), since a WebGPU
//     canvas has no equivalent of WebGL's preserveDrawingBuffer (which play-ask.ts turns on for WebGL). `webgpu` stays
//     in the refusals for an older bridge's answer.
// Said in one line instead of recording (`studio:clip/error`):
//   - tainted: a canvas that drew a picture from another site without CORS cannot be read at all (the browser refuses
//     the VideoFrame); the person can ask their AI to keep the pictures in the game's folder;
//   - no-encoder: no WebCodecs H.264 in this browser.
// Not drawn (play-shot.ts's limits): CSS gradients, shadows, SVG, rotated boxes.
import type { BridgeToShell, ShellToBridge } from '../contract.ts';
import { isStudioMessage } from '../contract.ts';
import { nativeCancelRaf, nativeClearTimeout, nativeNow, nativeRaf, nativeSetTimeout } from '../core/native.ts';
import { cutAtPress, markStartMs, wordsPlace, type ClipBox } from '../shell/clip-model.ts';
import { clipTimeAt, type ClipSoundState, type SoundClock } from '../shell/clip-sound-model.ts';
import { startSound, type SoundCapture } from './clip-sound.ts';
import { paintPage } from './play-shot.ts';

type Win = Window & typeof globalThis;
type Ctx2D = OffscreenCanvasRenderingContext2D;

/** The HTML UI is painted again at most this often (ms) — the plan's "at most 10 times a second". */
const LAYER_MS = 100;
/** …and at least this often, for a HUD that changes without a DOM change (a CSS animation, a canvas-free timer). */
const LAYER_MAX_MS = 1000;
/** Frames waiting in the encoder before the next one waits for it (a slow machine: the clip stays whole, just later). */
const QUEUE_MAX = 6;

const webgpuCanvases = new WeakSet<HTMLCanvasElement>();

/**
 * WebGPU (stage 3, decided 2026-11-07): a WebGPU canvas has no preserveDrawingBuffer, so its picture is sure to be
 * readable only in the task that drew it — before the browser shows it. While a clip records (`on` > 0), every canvas
 * that took its texture this frame (getCurrentTexture) is copied into a picture of ours right after the game submits its
 * work (a microtask: after the game's frame callback, before the frame is shown), and the clip draws that picture.
 * Checked in headless Chrome with a GPU (2026-11-07): plain WebGPU, PixiJS 8 (preference 'webgpu') and three.js's
 * WebGPURenderer all record. Outside a clip nothing is copied: the two wrapped calls only check `on`.
 */
const gpu = {
  on: 0,
  pending: new Set<HTMLCanvasElement>(),
  queued: false,
  snaps: new WeakMap<HTMLCanvasElement, OffscreenCanvas>(),
  /** Pictures taken so far (a clip's stats say how many were taken while it recorded). */
  taken: 0,
};

function snapGpu() {
  gpu.queued = false;
  for (const c of gpu.pending) {
    const w = c.width, h = c.height;
    if (!w || !h) continue;
    let s = gpu.snaps.get(c);
    if (!s || s.width !== w || s.height !== h) {
      s = new OffscreenCanvas(w, h);
      gpu.snaps.set(c, s);
    }
    const g = s.getContext('2d') as Ctx2D | null;
    if (!g) continue;
    g.clearRect(0, 0, w, h);
    try {
      g.drawImage(c, 0, 0);
      gpu.taken++;
    } catch {
      /* a canvas the browser will not read: the clip draws it live instead */
    }
  }
  gpu.pending.clear();
}

/**
 * Remember which canvases draw with WebGPU (a canvas does not say so itself), and take their pictures in their own frame
 * while a clip records (see `gpu`). Installed with the bridge, before the game's code, like play-ask.ts's
 * keepWebGLPictures. Nothing else changes.
 */
export function watchCanvasKinds(win: Win) {
  const proto = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
  if (!proto || (proto.getContext as { __studioClip?: boolean }).__studioClip) return;
  const orig = proto.getContext;
  const wrapped = function (this: HTMLCanvasElement, type: string, attrs?: unknown) {
    const c = (orig as (t: string, a?: unknown) => RenderingContext | null).call(this, type, attrs);
    if (type === 'webgpu' && c) webgpuCanvases.add(this);
    return c;
  } as typeof proto.getContext & { __studioClip?: boolean };
  wrapped.__studioClip = true;
  proto.getContext = wrapped;
  type GpuCtx = { canvas: unknown; getCurrentTexture(): unknown };
  const G = win as unknown as { GPUCanvasContext?: { prototype: GpuCtx }; GPUQueue?: { prototype: { submit(...a: unknown[]): unknown } } };
  const ctxProto = G.GPUCanvasContext?.prototype;
  const queueProto = G.GPUQueue?.prototype;
  if (!ctxProto || !queueProto || typeof ctxProto.getCurrentTexture !== 'function' || typeof queueProto.submit !== 'function') return;
  const current = ctxProto.getCurrentTexture;
  const submit = queueProto.submit;
  try {
    ctxProto.getCurrentTexture = function (this: GpuCtx) {
      const t = current.call(this);
      if (gpu.on && this.canvas instanceof win.HTMLCanvasElement) gpu.pending.add(this.canvas);
      return t;
    };
    queueProto.submit = function (this: unknown, ...a: unknown[]) {
      const r = submit.apply(this, a);
      if (gpu.on && gpu.pending.size && !gpu.queued) {
        gpu.queued = true;
        queueMicrotask(snapGpu);
      }
      return r;
    };
  } catch {
    /* frozen: a WebGPU game is drawn live (it reads as its last shown frame in Chrome) */
  }
}

export interface PlayClipOptions {
  win: Win;
  parentOrigin: string;
  /** The editor's own parts in the page (the ask overlay, the strip): never in the clip. */
  skip: (el: Element) => boolean;
}

type Start = Extract<ShellToBridge, { type: 'studio:clip/start' }>;

export function startPlayClip(o: PlayClipOptions) {
  const { win, parentOrigin, skip } = o;
  let rec: Recording | null = null;

  const post = (m: BridgeToShell, transfer: Transferable[] = []) => {
    try {
      win.parent.postMessage(m, parentOrigin, transfer);
    } catch {
      /* parent gone */
    }
  };

  win.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== win.parent || ev.origin !== parentOrigin || !isStudioMessage(ev.data)) return;
    const m = ev.data as ShellToBridge;
    if (m.type === 'studio:clip/start') {
      rec?.abort();
      rec = record(win, m, skip, post, () => (rec = null));
    } else if (m.type === 'studio:clip/stop' && rec?.id === m.id) rec.stop(m.at);
  });
}

interface Recording {
  id: string;
  /** `at`: when ● Clip was pressed again (timeOrigin + now, the editor page's clock); absent = now. */
  stop(at?: number): void;
  abort(): void;
}

function record(win: Win, m: Start, skip: (el: Element) => boolean, post: (m: BridgeToShell, t?: Transferable[]) => void, ended: () => void): Recording {
  const id = m.id;
  const W = m.w, H = m.h, fps = m.fps;
  const dt = 1000 / fps;
  const usPerFrame = 1e6 / fps;
  // In time, not frame counts (2026-11-05): a frame is stamped with WHEN it was taken, on the 1/30 s grid, so a game
  // that draws 20 frames a second on this machine gives a clip of the right length at 20 fps — never a sped-up one.
  // (The first version counted 30 frames per second; in headless Chrome's software GL the sample game drew ~2 a second,
  // and its "8 s" clip played back in half a second.)
  let endMs = Math.max(dt, m.seconds * 1000);
  let tailMs = markStartMs(endMs);
  // Before / After: the still part's length (ms) — the game's picture starts at this time of the clip. 0 = a plain clip.
  const before = m.before ?? null;
  const base = before ? Math.max(0, Math.min(endMs - dt, before.ms)) : 0;
  let beforeImg: ImageBitmap | null = null;
  /**
   * Frames encoded (the still ones too); live ones (the game's picture); the grid slot of the last one in the CLIP's
   * time (slot × dt = its time from the clip's 0:00; -1 = none yet); is the tail (the mark's second) under way.
   */
  let i = 0;
  let live = 0;
  let slot = -1;
  // Late stop (stage 2): main-encoder outputs with an index below `dropBelow` and a timestamp at or past `dropFromUs`
  // were recorded after the press — not posted. `outMain` counts the main encoder's outputs (one per frame, in order).
  let dropBelow = 0;
  let dropFromUs = Infinity;
  let outMain = 0;
  let tailStarted = false;
  let over = false;
  let timer: number | undefined;
  let raf: number | undefined;
  // Declared first: a refusal before the recording starts (no encoder, WebGPU) ends through finish() too.
  let watch: MutationObserver | null = null;
  let onResize: (() => void) | null = null;
  let main: VideoEncoder | null = null;
  let other: VideoEncoder | null = null;
  let flushing = false;
  /**
   * The game picture's 0:00 (at clip time `base`) — reset to the first live frame actually taken (a slow page's first
   * frame can come a second late), and moved on a late stop (see stop()).
   */
  let t0 = nativeNow();
  /**
   * Stage 3: `t0` over time, for the sound (clip-sound-model.ts clipTimeAt): one at the first live frame, one at a late
   * stop. The game's sound before the first live frame is not in the clip (a Before / After's still part is silent).
   */
  const clocks: SoundClock[] = [];
  /** The game's sound for this clip (stage 3; `m.sound` = Sound is on in Clip options), null = none captured. */
  let sound: SoundCapture | null = null;
  /** This clip is counted in `gpu.on` (WebGPU pictures taken in their frames) until it ends. */
  let gpuOn = false;
  let gpuFrom = 0;
  const origin = (win.performance && win.performance.timeOrigin) || 0;
  const fail = (why: Extract<BridgeToShell, { type: 'studio:clip/error' }>['why'], msg?: string) => {
    if (over) return;
    over = true;
    finish();
    post({ type: 'studio:clip/error', id, why, ...(msg ? { msg } : {}) });
    ended();
  };
  const handle: Recording = {
    id,
    stop(at?: number) {
      if (over || tailStarted) return;
      const now = nativeNow();
      // The clip's time now, and at the press (the editor's clock: both pages share timeOrigin + now). Never before the
      // game's picture started, never later than now.
      const nowMs = live ? base + (now - t0) : base;
      const pressMs = typeof at === 'number' && Number.isFinite(at) && origin && live ? base + (at - origin - t0) : nowMs;
      const c = cutAtPress({ nowMs, pressMs, liveFrom: base, slot, endMs, fps });
      endMs = c.endMs;
      tailMs = c.tailMs;
      stats.stoppedAt = Math.round(c.pressed);
      stats.late = Math.round(nowMs - c.pressed);
      stats.endMs = Math.round(endMs);
      // Frames already taken at or past the mark's second's slot (the message came after it): dropped, and the clock
      // put back so the next frame is the mark's second's first — the clip ends exactly one second after the press.
      if (c.drop > 0) {
        dropBelow = i;
        dropFromUs = Math.round(c.tailSlot * usPerFrame);
        stats.dropped = c.drop;
        t0 = now - (c.tailSlot * dt - base);
        // The sound follows the same clock (stage 3): what it recorded between the press and now is laid over by what
        // comes after, as the picture's frames are.
        clocks.push({ from: now, t0 });
        slot = c.tailSlot - 1;
      }
    },
    abort() {
      if (over) return;
      over = true;
      finish();
      ended();
    },
  };

  const W_ = win as unknown as { VideoEncoder?: typeof VideoEncoder; VideoFrame?: typeof VideoFrame; OffscreenCanvas?: typeof OffscreenCanvas };
  if (!W_.VideoEncoder || !W_.VideoFrame || !W_.OffscreenCanvas) {
    nativeSetTimeout(() => fail('no-encoder'), 0);
    return handle;
  }

  const out = new W_.OffscreenCanvas(W, H);
  const g = out.getContext('2d') as Ctx2D | null;
  if (!g) {
    nativeSetTimeout(() => fail('no-encoder'), 0);
    return handle;
  }

  // ----- the layers of the HTML UI (see the head) -----
  type Piece = { layer: OffscreenCanvas } | { canvas: HTMLCanvasElement; alpha: number };
  const pool: OffscreenCanvas[] = [];
  let pieces: Piece[] = [];
  let fit = { k: 1, ox: 0, oy: 0 };
  let dirty = true;
  let paintedAt = -Infinity;
  const layerCtx = (n: number): Ctx2D => {
    const c = (pool[n] ??= new W_.OffscreenCanvas!(W, H));
    const lg = c.getContext('2d') as Ctx2D;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.clearRect(0, 0, W, H);
    lg.setTransform(fit.k, 0, 0, fit.k, fit.ox, fit.oy);
    return lg;
  };
  let drewSomething = false;
  const paintLayers = () => {
    const p0 = nativeNow();
    const vw = win.innerWidth || 1, vh = win.innerHeight || 1;
    const k = Math.min(W / vw, H / vh);
    fit = { k, ox: (W - vw * k) / 2, oy: (H - vh * k) / 2 };
    const next: Piece[] = [{ layer: pool[0] ?? (pool[0] = new W_.OffscreenCanvas!(W, H)) }];
    let n = 0;
    const first = layerCtx(0);
    const drawn = paintPage(win, first as unknown as CanvasRenderingContext2D, (e) => skip(e) || e.hasAttribute('data-studio-ui'), {
      canvas: (el, _r, alpha) => {
        next.push({ canvas: el, alpha });
        n++;
        const lg = layerCtx(n);
        next.push({ layer: pool[n]! });
        return lg as unknown as CanvasRenderingContext2D;
      },
    });
    drewSomething = drawn > 0;
    pieces = next;
    dirty = false;
    paintedAt = nativeNow();
    stats.paint += paintedAt - p0;
    stats.paints++;
  };
  // A change of the editor's own parts (the ask overlay's line, the strip) is not a change of the picture.
  const ours = (n: Node) => {
    const e = n instanceof Element ? n : n.parentElement;
    return !!e && (skip(e) || !!e.closest('[data-studio-ui], game-studio-play'));
  };
  watch = new MutationObserver((list) => {
    if (list.some((r) => !ours(r.target))) dirty = true;
  });
  watch.observe(win.document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  onResize = () => (dirty = true);
  win.addEventListener('resize', onResize);

  const markLines = m.lines.slice(0, 2);
  const drawMark = () => {
    // Small, bottom right, half see-through: it says where the clip was made without covering the game (the plan's
    // option (a): "the last second, bottom right, small").
    const pad = Math.round(H * 0.033);
    const f1 = Math.round(H * 0.026), f2 = Math.round(H * 0.021);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.font = `600 ${f1}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const w1 = g.measureText(markLines[0] ?? '').width;
    g.font = `400 ${f2}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const w2 = g.measureText(markLines[1] ?? '').width;
    const bw = Math.max(w1, w2) + pad, bh = f1 + f2 + pad * 0.9;
    // In the game's own picture's corner, not the frame's: a page not exactly 16:9 is fitted with black bars, and the
    // mark half on a bar looked cut off.
    const right = Math.min(W, fit.ox + (win.innerWidth || W) * fit.k), bottom = Math.min(H, fit.oy + (win.innerHeight || H) * fit.k);
    const x = right - pad - bw, y = bottom - pad - bh;
    g.fillStyle = 'rgba(0, 0, 0, 0.5)';
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(x, y, bw, bh, Math.round(bh / 4));
    else g.rect(x, y, bw, bh);
    g.fill();
    g.textBaseline = 'top';
    g.fillStyle = 'rgba(255, 255, 255, 0.92)';
    g.font = `600 ${f1}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.fillText(markLines[0] ?? '', x + pad / 2, y + pad * 0.4);
    g.fillStyle = 'rgba(255, 255, 255, 0.72)';
    g.font = `400 ${f2}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.fillText(markLines[1] ?? '', x + pad / 2, y + pad * 0.4 + f1 + pad * 0.15);
    g.restore();
  };
  const compose = () => {
    const now = nativeNow();
    const c0 = now;
    if ((dirty && now - paintedAt >= LAYER_MS) || now - paintedAt >= LAYER_MAX_MS) paintLayers();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    for (const p of pieces) {
      if ('layer' in p) {
        g.globalAlpha = 1;
        g.drawImage(p.layer, 0, 0);
        continue;
      }
      // The canvas where it is NOW (a game that resizes its canvas moves it without a DOM change).
      const r = p.canvas.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      g.globalAlpha = p.alpha;
      // A WebGPU canvas: the picture taken in its own frame (see `gpu`), else the canvas itself (before its first frame).
      const src = webgpuCanvases.has(p.canvas) ? (gpu.snaps.get(p.canvas) ?? p.canvas) : p.canvas;
      try {
        g.drawImage(src, fit.ox + r.left * fit.k, fit.oy + r.top * fit.k, r.width * fit.k, r.height * fit.k);
      } catch {
        /* a canvas with no size yet */
      }
    }
    g.globalAlpha = 1;
    stats.compose += nativeNow() - c0;
  };

  // ----- the encoders -----
  const config: VideoEncoderConfig = { codec: m.codec, width: W, height: H, bitrate: m.bitrate, framerate: fps, avc: { format: 'avc' }, latencyMode: 'realtime' };
  // 'realtime', not 'quality': measured 2026-11-05 in headless Chrome 153's software H.264, 30 frames at 1280×720 took 0.97 s
  // in realtime and 11.2 s in quality (every frame came out in both) — quality ran the clip at ~2 frames a second.
  const toBuffer = (d: AllowSharedBufferSource): ArrayBuffer => {
    const v = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array((d as ArrayBufferView).buffer, (d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteLength);
    return v.slice().buffer;
  };
  const makeEncoder = (alt: boolean) => {
    let told = false;
    return new W_.VideoEncoder!({
      output: (chunk, meta) => {
        if (over && !flushing) return;
        // Recorded after the press of a late stop (see stop()): left out of the clip.
        if (!alt && outMain++ < dropBelow && chunk.timestamp >= dropFromUs) return;
        const desc = meta?.decoderConfig?.description;
        if (desc && !told) {
          told = true;
          const avcc = toBuffer(desc);
          post({ type: 'studio:clip/config', id, avcc, ...(alt ? { alt: true } : {}) }, [avcc]);
        }
        if (!alt) stats.chunks++;
        const data = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(data);
        post({ type: 'studio:clip/chunk', id, data, key: chunk.type === 'key', ts: chunk.timestamp, dur: chunk.duration ?? usPerFrame, ...(alt ? { alt: true } : {}) }, [data]);
      },
      error: (e) => fail('failed', String((e as Error)?.message || e)),
    });
  };
  try {
    main = makeEncoder(false);
    main.configure(config);
  } catch (e) {
    nativeSetTimeout(() => fail('no-encoder', String((e as Error)?.message || e)), 0);
    return handle;
  }

  function finish() {
    sound?.abort();
    sound = null;
    if (gpuOn) {
      gpuOn = false;
      gpu.on = Math.max(0, gpu.on - 1);
      stats.gpu = gpu.taken - gpuFrom;
    }
    nativeClearTimeout(timer);
    if (raf !== undefined) nativeCancelRaf(raf);
    watch?.disconnect();
    if (onResize) win.removeEventListener('resize', onResize);
    for (const e of [main, other]) {
      try {
        if (e && e.state !== 'closed' && !flushing) e.close();
      } catch {
        /* closed already */
      }
    }
  }

  // Where the time goes (ms, summed), for the screen test and for anyone checking a slow machine:
  // window.__studioClipStats in the game page (not enumerable, nothing reads it).
  // stoppedAt / late / dropped (stage 2): the press in the clip's time, how late the message came after it (ms), and how
  // many recorded frames that dropped.
  const stats = { frames: 0, paints: 0, paint: 0, compose: 0, encode: 0, waits: 0, started: t0, stoppedAt: -1, late: 0, dropped: 0, endMs: Math.round(endMs), chunks: 0,
    /** Stage 3: how the clip's sound ended up ('' while recording). */
    sound: '' as ClipSoundState | '',
    /** Stage 3: WebGPU pictures taken in their own frame while this clip recorded (0 = no WebGPU canvas). */
    gpu: 0,
    /** The game picture's 0:00 on the shared clock (timeOrigin + now): a test checks the press against its own clock. */
    t0Wall: 0 };
  try {
    Object.defineProperty(win, '__studioClipStats', { value: stats, configurable: true, enumerable: false });
  } catch {
    /* a page that froze its window */
  }
  // The clock: the browser's own requestAnimationFrame (captured before the game's code, core/native.ts), and a frame is
  // taken on the first animation frame at or after its time. WHY not setTimeout (the first try, 2026-11-05): timers in
  // the game's frame were throttled to about one a second in headless Chrome, so a 2 s clip took a minute; animation
  // frames run whenever the game draws, and a frame taken there is the picture the game just drew. A page that draws
  // no frames at all (hidden) falls back to a timer.
  const next = () => {
    if (over) return;
    nativeClearTimeout(timer);
    // The next slot's time on this page's clock (slots are in the clip's time; the game's picture starts at `base`).
    const due = t0 + (slot + 1) * dt - base;
    raf = nativeRaf(() => {
      raf = undefined;
      if (over) return;
      if (nativeNow() >= due - 2) tick();
      else next();
    });
    timer = nativeSetTimeout(() => {
      if (raf !== undefined) nativeCancelRaf(raf);
      raf = undefined;
      tick();
    }, Math.max(250, due - nativeNow() + 250));
  };
  const tick = () => {
    nativeClearTimeout(timer);
    if (over) return;
    if (main!.encodeQueueSize > QUEUE_MAX || (other && other.encodeQueueSize > QUEUE_MAX)) {
      stats.waits++;
      return next();
    }
    compose();
    const e0 = nativeNow();
    if (live === 0 && !drewSomething && !pieces.some((p) => 'canvas' in p)) return fail('nothing');
    // This frame's slot on the grid: the time it is taken, never before the last one's next slot.
    if (live === 0) {
      t0 = nativeNow();
      stats.t0Wall = origin + t0;
      clocks.push({ from: t0, t0 });
    }
    const lastSlot = slot;
    slot = Math.max(slot + 1, Math.round((base + nativeNow() - t0) / dt));
    let inTail = slot * dt >= tailMs - 0.5;
    // The mark's second starts exactly on its time (a key frame there): a late frame that jumped past it is put on it.
    if (inTail && !tailStarted) slot = Math.max(lastSlot + 1, Math.round(tailMs / dt));
    inTail = slot * dt >= tailMs - 0.5;
    // Never a frame at or past the end (a late frame in the tail is the last one, on the last slot).
    const lastAllowed = Math.ceil(endMs / dt - 0.5) - 1;
    if (slot > lastAllowed) slot = Math.max(lastSlot + 1, lastAllowed);
    const ts = Math.round(slot * usPerFrame);
    // The last frame lasts until the clip's end, so the clip is exactly its length.
    const last = (slot + 1) * dt >= endMs - 0.5;
    const dur = last ? Math.max(1, Math.round(endMs * 1000) - ts) : usPerFrame;
    const frameOf = (t: number) => new W_.VideoFrame!(out, { timestamp: t, duration: dur });
    const keySecond = Math.floor(slot / fps) !== Math.floor(lastSlot / fps);
    // Before / After: the wipe and "After" on the game's picture (under the mark, which drawMark puts on top).
    if (before) drawAfter(slot * dt - base);
    try {
      if (!inTail) {
        const f = frameOf(ts);
        main!.encode(f, { keyFrame: i === 0 || live === 0 || keySecond });
        f.close();
      } else {
        // The last second, both ways: the person's choice to the main encoder, the other way to the second one (which
        // starts here, so its first frame is a key frame — and the main one's is forced to one, so the ends can swap).
        const first = !tailStarted;
        if (first) {
          tailStarted = true;
          other = makeEncoder(true);
          other.configure(config);
        }
        const plain = frameOf(ts);
        drawMark();
        const marked = frameOf(ts);
        main!.encode(m.mark ? marked : plain, { keyFrame: first || keySecond });
        other!.encode(m.mark ? plain : marked, { keyFrame: first });
        plain.close();
        marked.close();
      }
    } catch (e) {
      // The browser refuses a frame of a canvas that drew another site's picture (a SecurityError).
      const name = (e as Error)?.name;
      return fail(name === 'SecurityError' ? 'tainted' : 'failed', String((e as Error)?.message || e));
    }
    stats.encode += nativeNow() - e0;
    i++;
    live++;
    stats.frames = i;
    // Every frame: the editor's bar moves, and it knows the game page is still there however slowly it draws.
    post({ type: 'studio:clip/progress', id, done: Math.round(Math.min(endMs, (slot + 1) * dt)), total: Math.round(endMs) });
    if (last) return void end();
    next();
  };
  const end = async () => {
    flushing = true;
    try {
      await main!.flush();
      if (other) await other.flush();
    } catch (e) {
      flushing = false;
      return fail('failed', String((e as Error)?.message || e));
    }
    if (over) return;
    over = true;
    flushing = false;
    // The sound (stage 3): its capture stops here and is encoded on the clip's time; posted before `done`, so the
    // editor has it when it writes the MP4. A failure of the sound never loses the clip: it is saved without it.
    let soundState: ClipSoundState = m.sound ? 'silent' : 'off';
    let soundMsg = '';
    const snd = sound;
    sound = null;
    if (snd) {
      const r = await snd.finish({ endMs, clipAt: (perf) => clipTimeAt(perf, clocks, base) }).catch((e) => ({ state: 'failed' as const, msg: String((e as Error)?.message || e) }));
      soundState = r.state;
      if (r.state === 'on') {
        post({ type: 'studio:clip/sound', id, rate: r.rate, channels: r.channels, asc: r.asc, chunks: r.chunks }, [r.asc, ...r.chunks.map((c) => c.data)]);
      } else if (r.msg) soundMsg = r.msg;
      stats.sound = r.state;
    }
    finish();
    post({ type: 'studio:clip/done', id, frames: i, seconds: Math.round(endMs) / 1000, markAt: Math.round(tailMs * 1000), sound: soundState, ...(soundMsg ? { soundMsg } : {}) });
    ended();
  };

  // ----- Before / After: the still part, the wipe, the words (stage 2) -----
  const pill = (text: string, x: number, y: number, f: number, bg: string, align: 'left' | 'right'): ClipBox => {
    g.font = `700 ${f}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const w = g.measureText(text).width + f * 1.2, hgt = f * 1.7;
    const left = align === 'right' ? x - w : x;
    g.fillStyle = bg;
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(left, y, w, hgt, Math.round(hgt / 4));
    else g.rect(left, y, w, hgt);
    g.fill();
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(text, left + f * 0.6, y + hgt / 2);
    return { x: left, y, w, h: hgt };
  };
  const labelSize = () => Math.round(Math.min(W, H) * 0.045);
  /** The asked frame over the whole picture: fitted (wide) or cut to fill (tall: it was taken in the wide window). */
  const drawBeforeImage = (clipX = 0) => {
    if (!beforeImg) return;
    const iw = beforeImg.width || 1, ih = beforeImg.height || 1;
    const k = H > W ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
    const dw = iw * k, dh = ih * k;
    g.save();
    g.beginPath();
    g.rect(clipX, 0, W - clipX, H);
    g.clip();
    if (clipX <= 0) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
    }
    g.drawImage(beforeImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    g.restore();
  };
  /**
   * The game's own text on the Before (fixed 2026-11-07), in frame pixels: the words' bubble keeps out of it
   * (clip-model.ts wordsPlace says why). Read from the live page, which is paused on the asked moment while the
   * Before is drawn, so its HUD is where the asked frame shows it. Wide: the asked frame was taken in a window of the
   * same shape, so a box maps onto the picture as drawn. Tall: the page now lays out in its 9:16 window while the
   * picture is the wide frame cut to fill, so both readings are kept (where the HUD is in the tall page, and the same
   * place on the picture): a hint anchored to the bottom center is then avoided in either. Text drawn inside a canvas
   * is not seen (only the page's HTML).
   */
  const textBoxes = (): ClipBox[] => {
    const doc = win.document;
    const vw = win.innerWidth || 1, vh = win.innerHeight || 1;
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    if (doc.body) {
      const walk = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
      const seen = new Set<Element>();
      for (let n = walk.nextNode(), k = 0; n && k < 600 && rects.length < 40; n = walk.nextNode(), k++) {
        const el = n.parentElement;
        if (!el || seen.has(el) || !(n.textContent || '').trim()) continue;
        seen.add(el);
        if (el.closest('[data-studio-ui], game-studio-play, script, style, noscript')) continue;
        let ours = false;
        for (let e: Element | null = el; e && !ours; e = e.parentElement) ours = skip(e);
        if (ours) continue;
        const vis = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
        if (vis && !vis.call(el, { opacityProperty: true, visibilityProperty: true })) continue;
        // The element's box (a hint's pill, its padding and background); a big container's box would cover
        // the whole page, so for one of those only its text's own box.
        let r: { left: number; top: number; width: number; height: number } = el.getBoundingClientRect();
        if (r.width * r.height > vw * vh * 0.25) {
          const range = doc.createRange();
          range.selectNodeContents(n);
          r = range.getBoundingClientRect();
        }
        if (r.width < 1 || r.height < 1 || r.left >= vw || r.top >= vh || r.left + r.width <= 0 || r.top + r.height <= 0) continue;
        rects.push({ x: r.left / vw, y: r.top / vh, w: r.width / vw, h: r.height / vh });
      }
    }
    const out: ClipBox[] = [];
    const onto = (ox: number, oy: number, dw: number, dh: number) => {
      for (const b of rects) out.push({ x: ox + b.x * dw, y: oy + b.y * dh, w: b.w * dw, h: b.h * dh });
    };
    const iw = beforeImg?.width || 0, ih = beforeImg?.height || 0;
    if (iw && ih) {
      const k = H > W ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
      onto((W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
    }
    if (!iw || !ih || Math.abs(iw / ih - vw / vh) > 0.03 * (vw / vh)) {
      const k = Math.min(W / vw, H / vh);
      onto((W - vw * k) / 2, (H - vh * k) / 2, vw * k, vh * k);
    }
    return out;
  };
  const drawWords = (text: string, avoid: ClipBox[], top: number) => {
    const f = Math.round(Math.min(W, H) * 0.04);
    g.font = `600 ${f}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const maxW = W * 0.84;
    // Two lines at most (the words were cut at BA_WORDS_MAX already): split where the first line fills up.
    const quoted = `“${text}”`;
    const lines: string[] = [];
    let cur = '';
    for (const word of quoted.split(' ')) {
      const tryLine = cur ? `${cur} ${word}` : word;
      if (g.measureText(tryLine).width > maxW && cur && lines.length < 1) {
        lines.push(cur);
        cur = word;
      } else cur = tryLine;
    }
    lines.push(cur);
    const lh = f * 1.3;
    const bw = Math.min(W * 0.9, Math.max(...lines.map((l) => g.measureText(l).width)) + f * 1.4);
    const bh = lines.length * lh + f * 0.8;
    // Not on the game's own text (fixed 2026-11-07: it used to be always at the bottom, over Lantern Cove's hint).
    const { x, y } = wordsPlace({ W, H, bw, bh, avoid, top });
    g.fillStyle = 'rgba(0, 0, 0, 0.66)';
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(x, y, bw, bh, Math.round(f / 2));
    else g.rect(x, y, bw, bh);
    g.fill();
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    lines.forEach((l, k) => g.fillText(l, W / 2, y + f * 0.4 + lh * (k + 0.5), maxW));
    g.textAlign = 'left';
  };
  const AFTER_BG = 'rgba(124, 77, 255, 0.92)';
  const BEFORE_BG = 'rgba(0, 0, 0, 0.72)';
  /** One still frame of the Before: the asked frame, "Before", the words. */
  const drawBefore = () => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    drawBeforeImage(0);
    const f = labelSize(), pad = Math.round(Math.min(W, H) * 0.035);
    const label = pill(before!.label, W - pad, pad, f, BEFORE_BG, 'right');
    let hud: ClipBox[] = [];
    try {
      hud = textBoxes();
    } catch {
      /* a page that will not be read: the words go where they always went */
    }
    // The "Before" label is a box to keep out of too; the top place is under it.
    if (before!.words) drawWords(before!.words, [...hud, label], label.y + label.h + pad / 2);
  };
  /** On a game frame `ms` after the After began: the Before wiped off (left to right) at first, then "After". */
  function drawAfter(ms: number) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    if (ms < before!.wipeMs && beforeImg) {
      const p = Math.max(0, ms) / Math.max(1, before!.wipeMs);
      const edge = Math.round(W * (1 - (1 - p) * (1 - p)));
      drawBeforeImage(edge);
      g.fillStyle = '#fff';
      g.fillRect(edge - 2, 0, 4, H);
    }
    const f = labelSize(), pad = Math.round(Math.min(W, H) * 0.035);
    pill(before!.after, W - pad, pad, f, AFTER_BG, 'right');
  }
  /** Encode the still part (as fast as the encoder takes it: its frames are stamped, not timed), then the live clock. */
  const still = async () => {
    try {
      const W2 = win as unknown as { createImageBitmap?: typeof createImageBitmap };
      if (W2.createImageBitmap) beforeImg = await W2.createImageBitmap(new Blob([before!.image]));
    } catch {
      beforeImg = null; // a picture that will not decode: the Before is black with its words
    }
    if (over) return;
    const sfps = Math.max(1, before!.stillFps || 10);
    const n = Math.max(1, Math.round((base / 1000) * sfps));
    const usStill = 1e6 / sfps;
    drawBefore();
    for (let k = 0; k < n && !over; k++) {
      while (main!.encodeQueueSize > QUEUE_MAX && !over) await new Promise((r) => nativeSetTimeout(r, 5));
      const tsK = Math.round(k * usStill);
      const durK = k === n - 1 ? Math.max(1, Math.round(base * 1000) - tsK) : Math.round(usStill);
      try {
        const f = new W_.VideoFrame!(out, { timestamp: tsK, duration: durK });
        main!.encode(f, { keyFrame: k === 0 || k % sfps === 0 });
        f.close();
      } catch (e) {
        const name = (e as Error)?.name;
        return fail(name === 'SecurityError' ? 'tainted' : 'failed', String((e as Error)?.message || e));
      }
      i++;
    }
    if (over) return;
    // The game's picture starts on the grid slot of the still part's end.
    slot = Math.round(base / dt) - 1;
    post({ type: 'studio:clip/started', id, total: Math.round(endMs) });
    next();
  };

  // The sound and the WebGPU pictures start with the recording (the encoder is set up; nothing was refused).
  if (m.sound) sound = startSound(win);
  gpuOn = true;
  gpu.on++;
  gpuFrom = gpu.taken;
  if (before) void still();
  else {
    post({ type: 'studio:clip/started', id, total: Math.round(endMs) });
    next();
  }
  return handle;
}
