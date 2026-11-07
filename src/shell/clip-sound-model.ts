// ● Clip stage 3 (decided 2026-11-07): the pure rules of a clip's sound — the encoder's settings, how the captured pieces
// are laid on the clip's own time, and when a clip gets no sound track at all. Unit tests: test/clip-sound.test.ts. The
// capture is in the game page (bridge/clip-sound.ts), the track in the MP4 in shell/mp4.ts.
//
// WHY the sound is laid on the CLIP's time and not simply appended: the video is not real time end to end. A Before /
// After starts with a still part encoded as fast as the encoder takes it, and a stop that reaches a busy game page late
// drops the frames recorded after the press and goes on from there (play-clip.ts stop()). The sound follows the same
// clock — the game picture's 0:00 (`t0`), moved when the video's is — so what is heard is what is seen.

/** AAC-LC: what X takes in an MP4 (not Opus), and what every player plays. */
export const SOUND_CODEC = 'mp4a.40.2';
/** The mixing context's rate (the encoder takes 48000 and 44100; 48000 is what most systems run at). */
export const SOUND_RATE = 48000;
export const SOUND_CHANNELS = 2;
/** 128 kb/s stereo: clean for music and effects, ~200 KB for 12 s (the video is ~4 MB). */
export const SOUND_BITRATE = 128_000;
/**
 * Below this peak the clip has no sound track (about −80 dB). WHY not "any non-zero sample": a context that is running but
 * playing nothing still passes tiny dither / denormal values through some graphs, and a game that made no sound must
 * come out as before — a video-only MP4, not one with a silent track (decided 2026-11-07).
 */
export const SOUND_SILENT_PEAK = 1e-4;

/**
 * How a clip's sound ended up (the bridge says it in `studio:clip/done`):
 *   on          — a sound track is in the clip;
 *   silent      — the game made no sound while recording: no track (as before stage 3);
 *   off         — the person turned Sound off in Clip options;
 *   unsupported — the game made sound, but this browser cannot encode AAC: the clip has none, and the line says so;
 *   failed      — the sound could not be captured or encoded (the clip is still saved, without it).
 */
export type ClipSoundState = 'on' | 'silent' | 'off' | 'unsupported' | 'failed';

/** The editor's one line for a clip saved without its sound, or null when there is nothing to say (silent, off, on). */
export function soundNoteKey(state: ClipSoundState | undefined): string | null {
  if (state === 'unsupported') return 'clip.noSound';
  if (state === 'failed') return 'clip.soundFailed';
  return null;
}

/**
 * The game picture's 0:00 over time: `from` = the page's clock (performance.now) from which `t0` holds. play-clip.ts adds
 * one when the first live frame is taken and one when a late stop moves the clock (see its stop()).
 */
export interface SoundClock {
  from: number;
  t0: number;
}

/**
 * The clip's time (ms) of a moment on the page's clock, or null before the game's picture started (the sound then is
 * not in the clip: a Before / After's still part is silent). `base` = where the game's picture starts in the clip.
 */
export function clipTimeAt(perf: number, clocks: readonly SoundClock[], base: number): number | null {
  let c: SoundClock | null = null;
  for (const k of clocks) if (k.from <= perf + 1e-6) c = k;
  return c ? base + (perf - c.t0) : null;
}

/** A captured piece of sound: its first sample's place in the clip (ms) and its samples, one array per channel. */
export interface SoundPiece {
  atMs: number;
  data: Float32Array[];
}

/**
 * The clip's sound, one array per channel, from 0:00 to `endMs` at `rate`: every piece written at its place, LATER pieces
 * over earlier ones (so after a late stop the sound from after the message replaces what was recorded between the press
 * and the message, as the video's frames do). Nothing before 0:00 or after the end. Mono pieces go to both channels.
 * `peak` = the loudest sample in the clip (SOUND_SILENT_PEAK decides if there is a track).
 */
export function layOut(pieces: readonly SoundPiece[], o: { rate: number; endMs: number; channels?: number }): { data: Float32Array[]; peak: number } {
  const ch = o.channels ?? SOUND_CHANNELS;
  const n = Math.max(0, Math.round((o.endMs * o.rate) / 1000));
  const data = Array.from({ length: ch }, () => new Float32Array(n));
  for (const p of pieces) {
    if (!p.data.length || !Number.isFinite(p.atMs)) continue;
    const at = Math.round((p.atMs * o.rate) / 1000);
    const len = p.data[0]!.length;
    const from = Math.max(0, -at);
    const to = Math.min(len, n - at);
    if (to <= from) continue;
    for (let c = 0; c < ch; c++) {
      const src = p.data[Math.min(c, p.data.length - 1)]!;
      data[c]!.set(src.subarray(from, to), at + from);
    }
  }
  let peak = 0;
  for (const d of data) for (let i = 0; i < d.length; i++) {
    const v = Math.abs(d[i]!);
    if (v > peak) peak = v;
  }
  return { data, peak };
}

/** The encoder is fed in pieces of this many frames (100 ms at 48 kHz): small enough not to hold up the page. */
export const SOUND_FEED_FRAMES = 4800;
