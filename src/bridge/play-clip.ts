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
//      can swap the end of the clip ("Remove mark" in its line) without recording again;
//   4. new VideoFrame(composite) → VideoEncoder → each chunk posted (`studio:clip/chunk`, transferred, not copied).
//
// Said in one line instead of recording (`studio:clip/error`):
//   - webgpu: a canvas drawing with WebGPU — its picture is readable only inside its own frame callback (no equivalent of
//     WebGL's preserveDrawingBuffer, which play-ask.ts turns on for WebGL), so it would come out black. Later stage;
//   - tainted: a canvas that drew a picture from another site without CORS cannot be read at all (the browser refuses
//     the VideoFrame); the person can ask their AI to keep the pictures in the game's folder;
//   - no-encoder: no WebCodecs H.264 in this browser.
// Not drawn (play-shot.ts's limits): CSS gradients, shadows, SVG, rotated boxes; sound is a later stage.
import type { BridgeToShell, ShellToBridge } from '../contract.ts';
import { isStudioMessage } from '../contract.ts';
import { nativeCancelRaf, nativeClearTimeout, nativeNow, nativeRaf, nativeSetTimeout } from '../core/native.ts';
import { endAfterStop, markStartMs } from '../shell/clip-model.ts';
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
 * Remember which canvases draw with WebGPU (a canvas does not say so itself). Installed with the bridge, before the
 * game's code, like play-ask.ts's keepWebGLPictures. Nothing else changes.
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
    } else if (m.type === 'studio:clip/stop' && rec?.id === m.id) rec.stop();
  });
}

interface Recording {
  id: string;
  stop(): void;
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
  /** Frames encoded; the grid slot of the last one (-1 = none yet); is the tail (the mark's second) under way. */
  let i = 0;
  let slot = -1;
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
  /** The clip's 0:00 — reset to the first frame actually taken (a slow page's first frame can come a second late). */
  let t0 = nativeNow();
  const fail = (why: Extract<BridgeToShell, { type: 'studio:clip/error' }>['why'], msg?: string) => {
    if (over) return;
    over = true;
    finish();
    post({ type: 'studio:clip/error', id, why, ...(msg ? { msg } : {}) });
    ended();
  };
  const handle: Recording = {
    id,
    stop() {
      if (over || tailStarted) return;
      endMs = endAfterStop(nativeNow() - t0, endMs, fps);
      tailMs = markStartMs(endMs);
      stats.stoppedAt = Math.round(nativeNow() - t0);
      stats.endMs = Math.round(endMs);
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
  const canvases = () => Array.from(win.document.querySelectorAll('canvas')).filter((c) => !skip(c) && !c.closest('[data-studio-ui]'));
  if (canvases().some((c) => webgpuCanvases.has(c) && c.getBoundingClientRect().width > 0)) {
    nativeSetTimeout(() => fail('webgpu'), 0);
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
      try {
        g.drawImage(p.canvas, fit.ox + r.left * fit.k, fit.oy + r.top * fit.k, r.width * fit.k, r.height * fit.k);
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
  const stats = { frames: 0, paints: 0, paint: 0, compose: 0, encode: 0, waits: 0, started: t0, stoppedAt: -1, endMs: Math.round(endMs), chunks: 0 };
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
    const due = t0 + (slot + 1) * dt;
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
    if (i === 0 && !drewSomething && !pieces.some((p) => 'canvas' in p)) return fail('nothing');
    // This frame's slot on the grid: the time it is taken, never before the last one's next slot.
    if (i === 0) t0 = nativeNow();
    const lastSlot = slot;
    slot = Math.max(slot + 1, Math.round((nativeNow() - t0) / dt));
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
    try {
      if (!inTail) {
        const f = frameOf(ts);
        main!.encode(f, { keyFrame: i === 0 || keySecond });
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
    finish();
    post({ type: 'studio:clip/done', id, frames: i, seconds: Math.round(endMs) / 1000, markAt: Math.round(tailMs * 1000) });
    ended();
  };

  post({ type: 'studio:clip/started', id, total: Math.round(endMs) });
  next();
  return handle;
}
