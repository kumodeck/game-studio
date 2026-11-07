// The MP4 box for ● Clip (decided 2026-11-05): one H.264 video track, written by hand. Pure; test/clip-model.test.ts
// (mp4 part) writes one and reads it back.
//
// WHY our own and not a library: the browser's encoder (WebCodecs VideoEncoder, bridge/play-clip.ts) gives the H.264
// samples but no file; X takes MP4 / MOV, not WebM. One video track with no B-frames (Constrained Baseline, see
// clip-model.ts CLIP_CODEC) is the plainest MP4 there is — about 150 lines — and the editor ships with no runtime
// dependencies, so a muxer library would be the first one. MediaRecorder could write an MP4 itself, but it takes the
// frames' times from the wall clock (stage 2's still "Before" and Try's wait could not be cut), so it is not used.
//
// The layout ("fast start"): ftyp, moov (all the tables), then mdat with every sample in one chunk per track (the video's,
// then the sound's). moov goes first so a player (and X's upload check) can start before the whole file is read.
// Stage 3 (decided 2026-11-07): an optional second track, the game's sound as AAC-LC (Mp4Audio below).

export interface Mp4Sample {
  /** The sample as the encoder gave it (AVC format: length-prefixed NAL units, no start codes). */
  data: Uint8Array;
  /** A key frame (IDR). */
  key: boolean;
  /** Its time, µs from the clip's start (the encoder's timestamp). */
  ts: number;
  /** Its duration, µs. */
  dur: number;
}

export interface Mp4Track {
  width: number;
  height: number;
  /** The avcC record (the encoder's decoderConfig.description: SPS and PPS). */
  avcc: Uint8Array;
  samples: Mp4Sample[];
  /**
   * Where the clip ends (µs): the last sample lasts until then. WHY: the encoder gives each chunk the frame rate's
   * duration, not the longer one of a last frame that holds until the end (a slow game's clip came out 0.6 s short).
   * Absent = the last sample's own `dur`.
   */
  endUs?: number;
}

/** Ticks per second of the track: 30 fps → 3000 per frame, 60 fps → 1500, both whole. */
export const MP4_TIMESCALE = 90000;
/** Ticks per second of the movie header (ms). */
const MOVIE_TIMESCALE = 1000;

const enc = new TextEncoder();

class Out {
  parts: Uint8Array[] = [];
  size = 0;
  bytes(b: Uint8Array) {
    this.parts.push(b);
    this.size += b.length;
  }
  u8(n: number) {
    this.bytes(Uint8Array.of(n & 255));
  }
  u16(n: number) {
    this.bytes(Uint8Array.of((n >>> 8) & 255, n & 255));
  }
  u32(n: number) {
    this.bytes(Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255));
  }
  zeros(n: number) {
    this.bytes(new Uint8Array(n));
  }
  str(s: string) {
    this.bytes(enc.encode(s));
  }
  done(): Uint8Array {
    const o = new Uint8Array(this.size);
    let at = 0;
    for (const p of this.parts) (o.set(p, at), (at += p.length));
    return o;
  }
}

/** A box: 4-byte size, 4-character type, then what `fill` writes. */
function box(type: string, fill: (o: Out) => void): Uint8Array {
  const inner = new Out();
  fill(inner);
  const o = new Out();
  o.u32(8 + inner.size);
  o.str(type);
  for (const p of inner.parts) o.bytes(p);
  return o.done();
}
/** A "full box": a box with a version byte and 3 bytes of flags first. */
const fullBox = (type: string, version: number, flags: number, fill: (o: Out) => void) =>
  box(type, (o) => {
    o.u8(version);
    o.u8((flags >>> 16) & 255);
    o.u16(flags & 0xffff);
    fill(o);
  });

/** The unit matrix of mvhd / tkhd (16.16 and 2.30 fixed point). */
function matrix(o: Out) {
  for (const v of [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]) o.u32(v);
}

/** Each sample's duration in track ticks, from the µs timestamps (rounded on the running time, so nothing drifts). */
export function sampleTicks(samples: Mp4Sample[], timescale = MP4_TIMESCALE, endUs?: number): number[] {
  const at = (us: number) => Math.round((us * timescale) / 1e6);
  return samples.map((s, i) => {
    const end = i + 1 < samples.length ? samples[i + 1]!.ts : Math.max(s.ts + 1, endUs ?? s.ts + s.dur);
    return Math.max(1, at(end) - at(s.ts));
  });
}

/**
 * ● Clip stage 3 (decided 2026-11-07): the game's sound, AAC-LC as the browser's AudioEncoder gave it (bridge/clip-sound.ts).
 * A second track ("soun", mp4a + esds) next to the video; absent = a clip without a sound track at all (a game that made
 * no sound, a browser that cannot encode AAC, or the person turned Sound off) — never a silent track. WHY AAC: X takes
 * AAC-LC in MP4 (not Opus), and every player plays it.
 */
export interface Mp4Audio {
  /** Samples a second (the encoder's: 48000 or 44100). It is also the track's timescale, so each AAC frame is 1024 ticks. */
  rate: number;
  channels: number;
  /** The AudioSpecificConfig (the encoder's decoderConfig.description; 2 bytes for AAC-LC). */
  asc: Uint8Array;
  /** Encoded AAC frames in order; ts / dur in µs from the clip's 0:00. Every AAC frame is a sync sample (no stss). */
  samples: Array<{ data: Uint8Array; ts: number; dur: number }>;
}

/** An MPEG-4 descriptor (esds): tag, one length byte (every one here is under 128), body. */
function descriptor(tag: number, body: Uint8Array): Uint8Array {
  if (body.length > 127) throw new Error('descriptor too long');
  const o = new Uint8Array(2 + body.length);
  o[0] = tag;
  o[1] = body.length;
  o.set(body, 2);
  return o;
}

/** The esds box of an AAC track: ES_Descriptor ⊃ DecoderConfigDescriptor (MPEG-4 audio, 0x40) ⊃ the ASC, and SLConfig. */
function esds(a: Mp4Audio, avgBitrate: number): Uint8Array {
  const dcd = new Out();
  dcd.u8(0x40); // objectTypeIndication: MPEG-4 Audio (AAC)
  dcd.u8(0x15); // streamType 5 (audio) << 2 | upStream 0 | reserved 1
  dcd.u8(0); // bufferSizeDB (24 bits): 0 = unknown, which players accept
  dcd.u16(0);
  dcd.u32(avgBitrate); // maxBitrate
  dcd.u32(avgBitrate); // avgBitrate
  dcd.bytes(descriptor(0x05, a.asc));
  const es = new Out();
  es.u16(0); // ES_ID
  es.u8(0); // flags
  es.bytes(descriptor(0x04, dcd.done()));
  es.bytes(descriptor(0x06, Uint8Array.of(0x02))); // SLConfig: predefined 2 (MP4)
  return fullBox('esds', 0, 0, (o) => o.bytes(descriptor(0x03, es.done())));
}

/** Run-length coded durations (stts): a steady track is one entry. */
function stts(ticks: number[]): Uint8Array {
  const runs: Array<[number, number]> = [];
  for (const d of ticks) {
    const last = runs[runs.length - 1];
    if (last && last[1] === d) last[0]++;
    else runs.push([1, d]);
  }
  return fullBox('stts', 0, 0, (m) => {
    m.u32(runs.length);
    for (const [c, d] of runs) (m.u32(c), m.u32(d));
  });
}

/** One trak: its header, media header (`timescale`, `total` ticks), handler, and the sample tables around `entry`. */
function trak(o: {
  id: number; movieDur: number; timescale: number; total: number; kind: 'vide' | 'soun'; w?: number; h?: number;
  entry: Uint8Array; ticks: number[]; sizes: number[]; keys: number[] | null; offset: number;
}): Uint8Array {
  const n = o.sizes.length;
  return box('trak', (tr) => {
    tr.bytes(fullBox('tkhd', 0, 3, (m) => {
      m.u32(0);
      m.u32(0);
      m.u32(o.id);
      m.u32(0);
      m.u32(o.movieDur);
      m.zeros(8);
      m.u16(0); // layer
      m.u16(o.kind === 'soun' ? 1 : 0); // alternate group
      m.u16(o.kind === 'soun' ? 0x0100 : 0); // volume: 1.0 for sound, 0 for video
      m.u16(0);
      matrix(m);
      m.u32((o.w ?? 0) * 0x10000);
      m.u32((o.h ?? 0) * 0x10000);
    }));
    tr.bytes(box('mdia', (md) => {
      md.bytes(fullBox('mdhd', 0, 0, (m) => {
        m.u32(0);
        m.u32(0);
        m.u32(o.timescale);
        m.u32(o.total);
        m.u16(0x55c4); // "und"
        m.u16(0);
      }));
      md.bytes(fullBox('hdlr', 0, 0, (m) => {
        m.u32(0);
        m.str(o.kind);
        m.zeros(12);
        m.str(o.kind === 'soun' ? 'SoundHandler' : 'VideoHandler');
        m.u8(0);
      }));
      md.bytes(box('minf', (mi) => {
        if (o.kind === 'soun') mi.bytes(fullBox('smhd', 0, 0, (m) => m.zeros(4)));
        else mi.bytes(fullBox('vmhd', 0, 1, (m) => m.zeros(8)));
        mi.bytes(box('dinf', (d) => d.bytes(fullBox('dref', 0, 0, (m) => {
          m.u32(1);
          m.bytes(fullBox('url ', 0, 1, () => undefined));
        }))));
        mi.bytes(box('stbl', (st) => {
          st.bytes(fullBox('stsd', 0, 0, (m) => {
            m.u32(1);
            m.bytes(o.entry);
          }));
          st.bytes(stts(o.ticks));
          // Video: the key frames. Sound: none written = every sample is a sync sample (AAC frames all are).
          if (o.keys) {
            const keys = o.keys;
            st.bytes(fullBox('stss', 0, 0, (m) => {
              m.u32(keys.length);
              for (const k of keys) m.u32(k);
            }));
          }
          st.bytes(fullBox('stsc', 0, 0, (m) => {
            m.u32(1);
            m.u32(1); // first chunk
            m.u32(n); // samples per chunk: all of them
            m.u32(1); // sample description
          }));
          st.bytes(fullBox('stsz', 0, 0, (m) => {
            m.u32(0);
            m.u32(n);
            for (const sz of o.sizes) m.u32(sz);
          }));
          st.bytes(fullBox('stco', 0, 0, (m) => {
            m.u32(1);
            m.u32(o.offset);
          }));
        }));
      }));
    }));
  });
}

/** The whole MP4 file. Throws when there is nothing to write. `audio` (stage 3): the sound track, absent = video only. */
export function muxMp4(t: Mp4Track & { audio?: Mp4Audio | null }): Uint8Array {
  if (!t.samples.length) throw new Error('no samples');
  const ticks = sampleTicks(t.samples, MP4_TIMESCALE, t.endUs);
  const total = ticks.reduce((a, b) => a + b, 0);
  const n = t.samples.length;
  const a = t.audio && t.audio.samples.length ? t.audio : null;
  // The sound's ticks are its own samples (timescale = rate); its last frame lasts its own duration.
  const aTicks = a ? sampleTicks(a.samples.map((s) => ({ ...s, key: true })), a.rate) : [];
  const aTotal = aTicks.reduce((x, y) => x + y, 0);
  const movieDur = Math.max(Math.round((total * MOVIE_TIMESCALE) / MP4_TIMESCALE), a ? Math.round((aTotal * MOVIE_TIMESCALE) / a.rate) : 0);
  const videoBytes = t.samples.reduce((x, s) => x + s.data.length, 0);
  const audioBytes = a ? a.samples.reduce((x, s) => x + s.data.length, 0) : 0;

  const ftyp = box('ftyp', (o) => {
    o.str('isom');
    o.u32(0x200);
    for (const b of ['isom', 'iso2', 'avc1', 'mp41']) o.str(b);
  });

  const avc1 = box('avc1', (x) => {
    x.zeros(6);
    x.u16(1); // data reference index
    x.zeros(16);
    x.u16(t.width);
    x.u16(t.height);
    x.u32(0x00480000); // 72 dpi
    x.u32(0x00480000);
    x.u32(0);
    x.u16(1); // frames per sample
    x.zeros(32); // compressor name
    x.u16(0x0018); // depth
    x.u16(0xffff);
    x.bytes(box('avcC', (c) => c.bytes(t.avcc)));
  });
  // The sound's bit rate for esds, from the bytes and the length (players use it only as a hint).
  const aSeconds = a ? aTotal / a.rate : 0;
  const mp4a = a
    ? box('mp4a', (x) => {
        x.zeros(6);
        x.u16(1); // data reference index
        x.zeros(8);
        x.u16(a.channels);
        x.u16(16); // sample size
        x.u16(0);
        x.u16(0);
        x.u32((a.rate & 0xffff) * 0x10000); // 16.16; 48000 and 44100 fit in 16 bits
        x.bytes(esds(a, aSeconds > 0 ? Math.round((audioBytes * 8) / aSeconds) : 0));
      })
    : null;

  const moovWith = (mdatData: number) =>
    box('moov', (o) => {
      o.bytes(fullBox('mvhd', 0, 0, (m) => {
        m.u32(0); // created
        m.u32(0); // modified
        m.u32(MOVIE_TIMESCALE);
        m.u32(movieDur);
        m.u32(0x00010000); // rate 1.0
        m.u16(0x0100); // volume 1.0
        m.zeros(10);
        matrix(m);
        m.zeros(24);
        m.u32(a ? 3 : 2); // next track id
      }));
      o.bytes(trak({ id: 1, movieDur, timescale: MP4_TIMESCALE, total, kind: 'vide', w: t.width, h: t.height, entry: avc1, ticks,
        sizes: t.samples.map((s) => s.data.length), keys: t.samples.flatMap((s, i) => (s.key ? [i + 1] : [])), offset: mdatData }));
      // mdat holds the video's samples, then the sound's: each track is one chunk (a 12 s clip is a few MB, read whole).
      if (a && mp4a) {
        o.bytes(trak({ id: 2, movieDur, timescale: a.rate, total: aTotal, kind: 'soun', entry: mp4a, ticks: aTicks,
          sizes: a.samples.map((s) => s.data.length), keys: null, offset: mdatData + videoBytes }));
      }
    });

  // moov's size does not depend on the offsets' values, so build it once to learn where mdat's data starts.
  const moovSize = moovWith(0).length;
  const moov = moovWith(ftyp.length + moovSize + 8);
  const o = new Out();
  o.bytes(ftyp);
  o.bytes(moov);
  o.u32(8 + videoBytes + audioBytes);
  o.str('mdat');
  for (const s of t.samples) o.bytes(s.data);
  if (a) for (const s of a.samples) o.bytes(s.data);
  return o.done();
}

/** What a written MP4 says about itself (tests, and the screen test's check of a saved clip). */
export interface Mp4Info {
  brand: string;
  width: number;
  height: number;
  /** Seconds (the video track's own duration). */
  seconds: number;
  samples: number;
  keys: number;
  codec: string;
  /** moov comes before mdat (fast start). */
  fastStart: boolean;
  /** The sound track (stage 3), or null when the clip has none. */
  audio: { codec: string; rate: number; channels: number; samples: number; seconds: number } | null;
}

/** Reads back the boxes muxMp4 writes (not a general MP4 reader). null when it does not read as one. */
export function mp4Info(b: Uint8Array): Mp4Info | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = (at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
  type Trak = { kind?: string; width?: number; height?: number; seconds?: number; samples?: number; keys?: number; codec?: string; channels?: number; rate?: number };
  const order: string[] = [];
  let brand = '';
  const traks: Trak[] = [];
  let cur: Trak | null = null;
  const walk = (from: number, to: number, depth: number) => {
    let at = from;
    while (at + 8 <= to) {
      const size = dv.getUint32(at);
      const ty = type(at + 4);
      if (size < 8 || at + size > to) return;
      if (depth === 0) order.push(ty);
      const body = at + 8;
      if (ty === 'ftyp') brand = type(body);
      else if (ty === 'trak') traks.push((cur = {}));
      else if (cur && ty === 'tkhd') {
        cur.width = dv.getUint32(at + size - 8) / 0x10000;
        cur.height = dv.getUint32(at + size - 4) / 0x10000;
      } else if (cur && ty === 'mdhd') cur.seconds = dv.getUint32(body + 16) / dv.getUint32(body + 12);
      else if (cur && ty === 'hdlr') cur.kind = type(body + 8);
      else if (cur && ty === 'stsz') cur.samples = dv.getUint32(body + 8);
      else if (cur && ty === 'stss') cur.keys = dv.getUint32(body + 4);
      else if (cur && ty === 'stsd') {
        // The first sample entry: its type, and for sound its channels and rate (mp4a's fixed fields).
        const e = body + 8;
        cur.codec = type(e + 4);
        if (cur.codec === 'mp4a') {
          cur.channels = dv.getUint16(e + 8 + 16);
          cur.rate = dv.getUint16(e + 8 + 24);
        }
      }
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(ty)) walk(body, at + size, depth + 1);
      at += size;
    }
  };
  walk(0, b.length, 0);
  const v = traks.find((x) => x.kind === 'vide') ?? traks[0];
  const s = traks.find((x) => x.kind === 'soun');
  if (!brand || !v || v.samples === undefined || v.seconds === undefined) return null;
  return {
    brand,
    width: v.width ?? 0,
    height: v.height ?? 0,
    seconds: v.seconds,
    samples: v.samples,
    keys: v.keys ?? 0,
    codec: v.codec ?? '',
    fastStart: order.indexOf('moov') >= 0 && order.indexOf('moov') < order.indexOf('mdat'),
    audio: s ? { codec: s.codec ?? '', rate: s.rate ?? 0, channels: s.channels ?? 0, samples: s.samples ?? 0, seconds: s.seconds ?? 0 } : null,
  };
}
