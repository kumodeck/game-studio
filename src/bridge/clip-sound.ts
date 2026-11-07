// ● Clip stage 3 (decided 2026-11-07; CONTRACT.md §3.5.4): the game's sound in the clip, captured in the game page.
// The rules (where a piece goes in the clip, when there is no track) are in shell/clip-sound-model.ts; play-clip.ts
// starts a capture with each clip and asks for the encoded sound at its end; shell/mp4.ts writes it as a second track.
//
// How the sound is reached, without changing what the person hears:
//   - Web Audio: every connection the game makes to a context's speakers (`node.connect(ctx.destination)`) goes to one
//     gain node of ours instead (the "tap"), which goes to the speakers. Installed with the bridge, before the game's
//     code, so the game's graph is the same from its first sound on and nothing is re-wired when a clip starts — WHY:
//     re-wiring a running graph at the press clicks, and wiring a second path to the speakers doubles the sound.
//     While recording, the tap also feeds a MediaStreamAudioDestinationNode, which plays nothing.
//   - <audio> / <video> (in the page or `new Audio()`, which most small games use for effects): captureStream() on each
//     element that plays while recording. It does not change the element's own playing (Chrome, Edge; Firefox's
//     prefixed mozCaptureStream mutes the element, so it is not used). An element the game sends through Web Audio
//     (createMediaElementSource) is already in the tap and is not captured twice. Its limit: an element already playing
//     at the press is heard in the clip from when its captured track starts, up to ~0.3 s in (measured in headless
//     Chrome, 2026-11-07); capturing every element all the time to avoid that would cost while nobody records.
//   - Both go into one mixing AudioContext of ours, whose recorder (an AudioWorklet; a ScriptProcessor where a page's
//     rules block the worklet's blob: script) copies the samples out. Its own output is silence: nothing of ours is heard.
// The samples are kept (12 s of stereo is ~5 MB) and encoded at the end with the browser's AAC encoder (WebCodecs
// AudioEncoder), so a late stop can drop the same stretch from the sound as from the picture (clip-sound-model.ts).
// A browser without an AAC encoder still captures, to know whether the game made sound: then the clip is saved without
// it and the editor says so in one line (`unsupported`). A game that made no sound gets no track (`silent`).
import { nativeClearTimeout, nativeNow, nativeSetTimeout } from '../core/native.ts';
import {
  SOUND_BITRATE, SOUND_CHANNELS, SOUND_CODEC, SOUND_FEED_FRAMES, SOUND_RATE, SOUND_SILENT_PEAK, layOut,
  type ClipSoundState, type SoundPiece,
} from '../shell/clip-sound-model.ts';

type Win = Window & typeof globalThis;

/** What a capture gives at its end: the encoded track, or why there is none. */
export type SoundResult =
  | { state: 'on'; rate: number; channels: number; asc: ArrayBuffer; chunks: Array<{ data: ArrayBuffer; ts: number; dur: number }> }
  | { state: Exclude<ClipSoundState, 'on'>; msg?: string };

export interface SoundCapture {
  /**
   * Stop capturing and encode. `clipAt(perf)` = the clip's time (ms) of a moment on the page's clock, null = not in the
   * clip (play-clip.ts's clocks); `endMs` = the clip's length.
   */
  finish(o: { endMs: number; clipAt: (perf: number) => number | null }): Promise<SoundResult>;
  abort(): void;
}

interface Live {
  addContext(ctx: AudioContext): void;
  addMedia(el: HTMLMediaElement): void;
}

/** One per page: the taps, the elements seen playing, the capture under way. */
const S = {
  installed: false,
  taps: new WeakMap<BaseAudioContext, GainNode>(),
  /** The contexts with a tap (weak: a context the game drops is not kept alive here). */
  tapped: [] as Array<WeakRef<AudioContext>>,
  /** Our own mixing contexts: never tapped (their recorder's silence would come back into the clip). */
  ours: new WeakSet<BaseAudioContext>(),
  /** Elements sent through Web Audio by the game: their sound is in the tap already. */
  routed: new WeakSet<HTMLMediaElement>(),
  /** Elements the game played (`new Audio()` is not in the document, so a scan would miss it). */
  media: [] as Array<WeakRef<HTMLMediaElement>>,
  seen: new WeakSet<HTMLMediaElement>(),
  live: null as Live | null,
  connect: null as null | ((this: AudioNode, ...a: unknown[]) => unknown),
};

/**
 * Install the taps (before the game's code, like play-clip.ts's watchCanvasKinds). Nothing is recorded until a clip
 * starts; the only change before that is one gain node between the game's graph and its speakers.
 */
export function watchSound(win: Win) {
  if (S.installed) return;
  S.installed = true;
  const NodeProto = win.AudioNode && win.AudioNode.prototype;
  const Dest = win.AudioDestinationNode;
  const Offline = win.OfflineAudioContext;
  if (NodeProto && Dest) {
    const connect = NodeProto.connect as unknown as (this: AudioNode, ...a: unknown[]) => unknown;
    const disconnect = NodeProto.disconnect as unknown as (this: AudioNode, ...a: unknown[]) => unknown;
    S.connect = connect;
    const tapOf = (d: unknown): GainNode | null => {
      if (!(d instanceof Dest)) return null;
      const ctx = d.context;
      // An OfflineAudioContext renders to a buffer, never to the speakers: not the game's sound.
      if (S.ours.has(ctx) || (Offline && ctx instanceof Offline)) return null;
      let tap = S.taps.get(ctx);
      if (!tap) {
        try {
          tap = ctx.createGain();
          connect.call(tap, d);
        } catch {
          return null;
        }
        S.taps.set(ctx, tap);
        if (typeof WeakRef === 'function') S.tapped.push(new WeakRef(ctx as AudioContext));
        S.live?.addContext(ctx as AudioContext);
      }
      return tap;
    };
    const wrappedConnect = function (this: AudioNode, ...a: unknown[]) {
      const tap = this instanceof win.GainNode && S.taps.get(this.context) === this ? null : tapOf(a[0]);
      if (!tap) return connect.apply(this, a);
      connect.apply(this, [tap, ...a.slice(1)]);
      // What connect() returns is its first argument: the speakers, so `a.connect(b).connect(ctx.destination)` chains as before.
      return a[0];
    };
    const wrappedDisconnect = function (this: AudioNode, ...a: unknown[]) {
      const d = a[0];
      const tap = d instanceof Dest ? S.taps.get(d.context) : undefined;
      if (!tap || tap === this) return disconnect.apply(this, a);
      try {
        return disconnect.apply(this, [tap, ...a.slice(1)]);
      } catch {
        // Connected straight to the speakers after all (made before the bridge, or by a frozen copy of connect).
        return disconnect.apply(this, a);
      }
    };
    try {
      NodeProto.connect = wrappedConnect as unknown as typeof NodeProto.connect;
      NodeProto.disconnect = wrappedDisconnect as unknown as typeof NodeProto.disconnect;
    } catch {
      /* a frozen prototype: Web Audio is not in clips, nothing else changes */
    }
  }
  const Ctx = win.AudioContext as (typeof AudioContext & { prototype: AudioContext }) | undefined;
  const mes = Ctx && Ctx.prototype.createMediaElementSource;
  if (Ctx && mes) {
    Ctx.prototype.createMediaElementSource = function (this: AudioContext, el: HTMLMediaElement) {
      S.routed.add(el);
      return mes.call(this, el);
    };
  }
  const MediaProto = win.HTMLMediaElement && win.HTMLMediaElement.prototype;
  const play = MediaProto && MediaProto.play;
  if (MediaProto && play) {
    MediaProto.play = function (this: HTMLMediaElement) {
      remember(this);
      const r = play.call(this);
      S.live?.addMedia(this);
      return r;
    };
  }
}

function remember(el: HTMLMediaElement) {
  if (S.seen.has(el) || typeof WeakRef !== 'function') return;
  S.seen.add(el);
  S.media.push(new WeakRef(el));
  // A game that makes a new Audio() per shot: keep the list to the ones still around.
  if (S.media.length > 256) S.media = S.media.filter((r) => !!r.deref());
}

/** The recorder in the mixing context: copies 4096 frames at a time out, each with the context's frame number. */
const WORKLET = `class StudioClipSound extends AudioWorkletProcessor {
  constructor() { super(); this.buf = [new Float32Array(4096), new Float32Array(4096)]; this.n = 0; this.at = 0; this.on = true;
    this.port.onmessage = (e) => { if (e.data === 'end') { this.flush(); this.on = false; this.port.postMessage({ end: true }); } }; }
  flush() { if (!this.n) return; this.port.postMessage({ frame: this.at, ch: [this.buf[0].slice(0, this.n), this.buf[1].slice(0, this.n)] }); this.n = 0; }
  process(inputs) {
    if (!this.on) return false;
    const inp = inputs[0] || [];
    const len = inp[0] ? inp[0].length : 128;
    if (this.n === 0) this.at = currentFrame;
    for (let c = 0; c < 2; c++) { const src = inp[c] || inp[0]; if (src) this.buf[c].set(src, this.n); else this.buf[c].fill(0, this.n, this.n + len); }
    this.n += len;
    if (this.n + 128 > 4096) this.flush();
    return true;
  }
}
registerProcessor('studio-clip-sound', StudioClipSound);`;

/**
 * Start capturing the game's sound for one clip. `can` = this browser can encode AAC (checked by the caller once; a
 * capture without it still learns whether there was sound). The mixing context is made at the first sound source, so a
 * game with no sound at all never gets one.
 */
export function startSound(win: Win): SoundCapture {
  let mix: AudioContext | null = null;
  let sum: GainNode | null = null;
  let recorder: AudioNode | null = null;
  let workletPort: MessagePort | null = null;
  let failedWhy = '';
  let over = false;
  const pieces: Array<{ frame: number; data: Float32Array[] }> = [];
  const undo: Array<() => void> = [];
  const attached = new WeakSet<object>();

  const ensureMix = (): boolean => {
    if (mix) return true;
    try {
      try {
        mix = new win.AudioContext({ sampleRate: SOUND_RATE, latencyHint: 'interactive' });
      } catch {
        mix = new win.AudioContext();
      }
    } catch (e) {
      failedWhy = String((e as Error)?.message || e);
      return false;
    }
    S.ours.add(mix);
    sum = mix.createGain();
    void mix.resume().catch(() => {});
    const m = mix;
    const s = sum;
    const viaScript = () => {
      // The fallback: runs on the page's thread, so a very busy page can miss a buffer — still better than no sound.
      const sp = m.createScriptProcessor(4096, SOUND_CHANNELS, SOUND_CHANNELS);
      sp.onaudioprocess = (e) => {
        if (over) return;
        const b = e.inputBuffer;
        const data = Array.from({ length: SOUND_CHANNELS }, (_, c) => b.getChannelData(Math.min(c, b.numberOfChannels - 1)).slice());
        pieces.push({ frame: Math.round(e.playbackTime * m.sampleRate) - b.length, data });
      };
      s.connect(sp);
      sp.connect(m.destination);
      recorder = sp;
    };
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      m.audioWorklet.addModule(url).then(() => {
        URL.revokeObjectURL(url);
        if (over) return;
        const w = new AudioWorkletNode(m, 'studio-clip-sound', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [SOUND_CHANNELS],
          channelCount: SOUND_CHANNELS, channelCountMode: 'explicit' });
        w.port.onmessage = (e: MessageEvent) => {
          const d = e.data as { frame?: number; ch?: Float32Array[] };
          if (d && d.ch) pieces.push({ frame: d.frame ?? 0, data: d.ch });
        };
        workletPort = w.port;
        s.connect(w);
        // Its output is silence; connected so the context runs it.
        w.connect(m.destination);
        recorder = w;
      }, () => {
        URL.revokeObjectURL(url);
        if (!over) viaScript();
      });
    } catch {
      viaScript();
    }
    return true;
  };

  const live: Live = {
    addContext(ctx) {
      if (over || attached.has(ctx) || S.ours.has(ctx) || ctx.state === 'closed') return;
      const tap = S.taps.get(ctx);
      if (!tap || !ensureMix() || !mix || !sum) return;
      attached.add(ctx);
      try {
        const out = ctx.createMediaStreamDestination();
        tap.connect(out);
        const src = mix.createMediaStreamSource(out.stream);
        src.connect(sum);
        undo.push(() => {
          try {
            tap.disconnect(out);
          } catch {
            /* already */
          }
          src.disconnect();
          for (const t of out.stream.getTracks()) t.stop();
        });
      } catch (e) {
        failedWhy = String((e as Error)?.message || e);
      }
    },
    addMedia(el) {
      if (over || attached.has(el) || S.routed.has(el)) return;
      const cap = (el as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream;
      if (typeof cap !== 'function') return;
      let stream: MediaStream;
      try {
        // Throws for an element playing another site's file without CORS: its sound is not readable, like such a picture.
        stream = cap.call(el);
      } catch {
        return;
      }
      if (!ensureMix() || !mix || !sum) return;
      attached.add(el);
      const m = mix;
      const s = sum;
      // The element's own volume and mute (captureStream gives the sound before them).
      const gain = m.createGain();
      const level = () => (gain.gain.value = el.muted ? 0 : el.volume);
      level();
      el.addEventListener('volumechange', level);
      gain.connect(s);
      const sources: AudioNode[] = [];
      // Each track once. WHY: Chrome can also send `addtrack` for a track getTracks() gave already, and a track taken
      // twice was in the clip twice — the two copies a little apart in time, so the sound came out doubled in places and
      // gone in others (the screen test's <audio> tone read 0.73 and 0.00 where 0.37 was played, 2026-11-07).
      const took = new Set<string>();
      const take = (t: MediaStreamTrack) => {
        if (took.has(t.id)) return;
        took.add(t.id);
        if (t.kind !== 'audio') return void t.stop(); // a <video>'s picture: not needed
        try {
          const src = m.createMediaStreamSource(new MediaStream([t]));
          src.connect(gain);
          sources.push(src);
        } catch {
          /* a track that ended already */
        }
      };
      stream.getTracks().forEach(take);
      // An element that has not loaded yet gets its track later.
      const onTrack = (e: MediaStreamTrackEvent) => take(e.track);
      stream.addEventListener('addtrack', onTrack);
      undo.push(() => {
        el.removeEventListener('volumechange', level);
        stream.removeEventListener('addtrack', onTrack);
        for (const n of sources) n.disconnect();
        gain.disconnect();
        for (const t of stream.getTracks()) t.stop();
      });
    },
  };

  // What is there already: every tapped context, every element seen playing (and any in the page) that plays now.
  S.live = live;
  for (const r of S.tapped) {
    const c = r.deref();
    if (c) live.addContext(c);
  }
  const playing = (e: HTMLMediaElement) => !e.paused && !e.ended;
  for (const r of S.media) {
    const e = r.deref();
    if (e && playing(e)) live.addMedia(e);
  }
  for (const e of Array.from(win.document.querySelectorAll('audio, video')) as HTMLMediaElement[]) if (playing(e)) live.addMedia(e);
  // An element in the page that starts by itself (autoplay, a `play` from the page's own controls): media events do not
  // bubble, the capture phase still sees them on the document (as play-pause.ts does).
  const onPlay = (e: Event) => {
    const el = e.target as HTMLMediaElement | null;
    if (el && typeof (el as { captureStream?: unknown }).captureStream === 'function') live.addMedia(el);
  };
  win.document.addEventListener('play', onPlay, true);
  undo.push(() => win.document.removeEventListener('play', onPlay, true));

  const stop = () => {
    if (S.live === live) S.live = null;
    over = true;
    for (const u of undo.splice(0)) {
      try {
        u();
      } catch {
        /* gone */
      }
    }
  };

  return {
    abort() {
      stop();
      void mix?.close().catch(() => {});
    },
    async finish(o) {
      // The recorder's last part first (the worklet's buffer), then everything let go.
      const m = mix;
      let map: { ctxTime: number; perf: number } | null = null;
      if (m) {
        // The mixing context's frames on the page's clock: getOutputTimestamp says when its sound at `contextTime` is
        // heard, which is when the game's own sound is heard too (both go out the same way). A context that has not
        // started yet (no time to say) falls back to now = its current time.
        try {
          const ts = m.getOutputTimestamp();
          if (ts && (ts.performanceTime ?? 0) > 0 && (ts.contextTime ?? 0) > 0) map = { ctxTime: ts.contextTime!, perf: ts.performanceTime! };
        } catch {
          /* older browser */
        }
        if (!map) map = { ctxTime: m.currentTime, perf: nativeNow() };
        if (workletPort) {
          const port = workletPort;
          await new Promise<void>((ok) => {
            const t = nativeSetTimeout(ok, 400);
            port.addEventListener('message', (e: MessageEvent) => {
              if ((e.data as { end?: boolean })?.end) {
                nativeClearTimeout(t);
                ok();
              }
            });
            port.postMessage('end');
          });
        }
      }
      stop();
      recorder?.disconnect();
      const rate = m ? m.sampleRate : SOUND_RATE;
      void m?.close().catch(() => {});
      if (!m) return failedWhy ? { state: 'failed', msg: failedWhy } : { state: 'silent' };
      const mapped: SoundPiece[] = [];
      for (const p of pieces) {
        const perf = map!.perf + (p.frame / rate - map!.ctxTime) * 1000;
        const at = o.clipAt(perf);
        if (at !== null) mapped.push({ atMs: at, data: p.data });
      }
      const { data, peak } = layOut(mapped, { rate, endMs: o.endMs });
      if (peak < SOUND_SILENT_PEAK) return { state: 'silent' };
      return encode(win, data, rate);
    },
  };
}

/** The clip's sound as AAC (WebCodecs AudioEncoder), or `unsupported` when this browser has no AAC encoder. */
async function encode(win: Win, data: Float32Array[], rate: number): Promise<SoundResult> {
  const W = win as unknown as { AudioEncoder?: typeof AudioEncoder; AudioData?: typeof AudioData };
  if (!W.AudioEncoder || !W.AudioData) return { state: 'unsupported' };
  const config: AudioEncoderConfig = { codec: SOUND_CODEC, sampleRate: rate, numberOfChannels: SOUND_CHANNELS, bitrate: SOUND_BITRATE };
  try {
    const ok = await W.AudioEncoder.isConfigSupported(config);
    if (!ok.supported) return { state: 'unsupported' };
  } catch {
    return { state: 'unsupported' };
  }
  const chunks: Array<{ data: ArrayBuffer; ts: number; dur: number }> = [];
  let asc: ArrayBuffer | null = null;
  let err = '';
  const enc = new W.AudioEncoder({
    output: (c, meta) => {
      const d = meta?.decoderConfig?.description;
      if (d && !asc) {
        const v = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array((d as ArrayBufferView).buffer, (d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteLength);
        asc = v.slice().buffer;
      }
      const buf = new ArrayBuffer(c.byteLength);
      c.copyTo(buf);
      chunks.push({ data: buf, ts: c.timestamp, dur: c.duration ?? Math.round((1024 * 1e6) / rate) });
    },
    error: (e) => (err = String((e as Error)?.message || e)),
  });
  try {
    enc.configure(config);
    const n = data[0]!.length;
    for (let at = 0; at < n && !err; at += SOUND_FEED_FRAMES) {
      const len = Math.min(SOUND_FEED_FRAMES, n - at);
      const planar = new Float32Array(len * SOUND_CHANNELS);
      for (let c = 0; c < SOUND_CHANNELS; c++) planar.set(data[c]!.subarray(at, at + len), c * len);
      const ad = new W.AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: len, numberOfChannels: SOUND_CHANNELS, timestamp: Math.round((at * 1e6) / rate), data: planar });
      enc.encode(ad);
      ad.close();
    }
    await enc.flush();
    enc.close();
  } catch (e) {
    err = err || String((e as Error)?.message || e);
  }
  if (err || !asc || !chunks.length) return { state: 'failed', msg: err || 'no sound out of the encoder' };
  return { state: 'on', rate, channels: SOUND_CHANNELS, asc, chunks };
}
