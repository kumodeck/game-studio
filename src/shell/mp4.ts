// The MP4 box for ● Clip (decided 2026-11-05): one H.264 video track, written by hand. Pure; test/clip-model.test.ts
// (mp4 part) writes one and reads it back.
//
// WHY our own and not a library: the browser's encoder (WebCodecs VideoEncoder, bridge/play-clip.ts) gives the H.264
// samples but no file; X takes MP4 / MOV, not WebM. One video track with no B-frames (Constrained Baseline, see
// clip-model.ts CLIP_CODEC) is the plainest MP4 there is — about 150 lines — and the editor ships with no runtime
// dependencies, so a muxer library would be the first one. MediaRecorder could write an MP4 itself, but it takes the
// frames' times from the wall clock (stage 2's still "Before" and Try's wait could not be cut), so it is not used.
//
// The layout ("fast start"): ftyp, moov (all the tables), then mdat with every sample in one chunk. moov goes first so a
// player (and X's upload check) can start before the whole file is read.

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

/** The whole MP4 file. Throws when there is nothing to write. */
export function muxMp4(t: Mp4Track): Uint8Array {
  if (!t.samples.length) throw new Error('no samples');
  const ticks = sampleTicks(t.samples, MP4_TIMESCALE, t.endUs);
  const total = ticks.reduce((a, b) => a + b, 0);
  const movieDur = Math.round((total * MOVIE_TIMESCALE) / MP4_TIMESCALE);
  const n = t.samples.length;

  const ftyp = box('ftyp', (o) => {
    o.str('isom');
    o.u32(0x200);
    for (const b of ['isom', 'iso2', 'avc1', 'mp41']) o.str(b);
  });

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
        m.u32(2); // next track id
      }));
      o.bytes(box('trak', (tr) => {
        tr.bytes(fullBox('tkhd', 0, 3, (m) => {
          m.u32(0);
          m.u32(0);
          m.u32(1); // track id
          m.u32(0);
          m.u32(movieDur);
          m.zeros(8);
          m.u16(0); // layer
          m.u16(0); // alternate group
          m.u16(0); // volume (video)
          m.u16(0);
          matrix(m);
          m.u32(t.width * 0x10000);
          m.u32(t.height * 0x10000);
        }));
        tr.bytes(box('mdia', (md) => {
          md.bytes(fullBox('mdhd', 0, 0, (m) => {
            m.u32(0);
            m.u32(0);
            m.u32(MP4_TIMESCALE);
            m.u32(total);
            m.u16(0x55c4); // "und"
            m.u16(0);
          }));
          md.bytes(fullBox('hdlr', 0, 0, (m) => {
            m.u32(0);
            m.str('vide');
            m.zeros(12);
            m.str('VideoHandler');
            m.u8(0);
          }));
          md.bytes(box('minf', (mi) => {
            mi.bytes(fullBox('vmhd', 0, 1, (m) => m.zeros(8)));
            mi.bytes(box('dinf', (d) => d.bytes(fullBox('dref', 0, 0, (m) => {
              m.u32(1);
              m.bytes(fullBox('url ', 0, 1, () => undefined));
            }))));
            mi.bytes(box('stbl', (st) => {
              st.bytes(fullBox('stsd', 0, 0, (m) => {
                m.u32(1);
                m.bytes(box('avc1', (a) => {
                  a.zeros(6);
                  a.u16(1); // data reference index
                  a.zeros(16);
                  a.u16(t.width);
                  a.u16(t.height);
                  a.u32(0x00480000); // 72 dpi
                  a.u32(0x00480000);
                  a.u32(0);
                  a.u16(1); // frames per sample
                  a.zeros(32); // compressor name
                  a.u16(0x0018); // depth
                  a.u16(0xffff);
                  a.bytes(box('avcC', (c) => c.bytes(t.avcc)));
                }));
              }));
              // Durations, run-length coded (a steady 30 fps clip is one entry).
              const runs: Array<[number, number]> = [];
              for (const d of ticks) {
                const last = runs[runs.length - 1];
                if (last && last[1] === d) last[0]++;
                else runs.push([1, d]);
              }
              st.bytes(fullBox('stts', 0, 0, (m) => {
                m.u32(runs.length);
                for (const [c, d] of runs) (m.u32(c), m.u32(d));
              }));
              const keys = t.samples.flatMap((s, i) => (s.key ? [i + 1] : []));
              st.bytes(fullBox('stss', 0, 0, (m) => {
                m.u32(keys.length);
                for (const k of keys) m.u32(k);
              }));
              st.bytes(fullBox('stsc', 0, 0, (m) => {
                m.u32(1);
                m.u32(1); // first chunk
                m.u32(n); // samples per chunk: all of them
                m.u32(1); // sample description
              }));
              st.bytes(fullBox('stsz', 0, 0, (m) => {
                m.u32(0);
                m.u32(n);
                for (const s of t.samples) m.u32(s.data.length);
              }));
              st.bytes(fullBox('stco', 0, 0, (m) => {
                m.u32(1);
                m.u32(mdatData);
              }));
            }));
          }));
        }));
      }));
    });

  // moov's size does not depend on the offset's value, so build it once to learn where mdat's data starts.
  const moovSize = moovWith(0).length;
  const moov = moovWith(ftyp.length + moovSize + 8);
  const dataSize = t.samples.reduce((a, s) => a + s.data.length, 0);
  const o = new Out();
  o.bytes(ftyp);
  o.bytes(moov);
  o.u32(8 + dataSize);
  o.str('mdat');
  for (const s of t.samples) o.bytes(s.data);
  return o.done();
}

/** What a written MP4 says about itself (tests, and the screen test's check of a saved clip). */
export interface Mp4Info {
  brand: string;
  width: number;
  height: number;
  /** Seconds (the track's own duration). */
  seconds: number;
  samples: number;
  keys: number;
  codec: string;
  /** moov comes before mdat (fast start). */
  fastStart: boolean;
}

/** Reads back the boxes muxMp4 writes (not a general MP4 reader). null when it does not read as one. */
export function mp4Info(b: Uint8Array): Mp4Info | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = (at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
  const info: Partial<Mp4Info> & { order: string[] } = { order: [] };
  const walk = (from: number, to: number, depth: number) => {
    let at = from;
    while (at + 8 <= to) {
      const size = dv.getUint32(at);
      const ty = type(at + 4);
      if (size < 8 || at + size > to) return;
      if (depth === 0) info.order.push(ty);
      const body = at + 8;
      if (ty === 'ftyp') info.brand = type(body);
      else if (ty === 'tkhd') {
        info.width = dv.getUint32(at + size - 8) / 0x10000;
        info.height = dv.getUint32(at + size - 4) / 0x10000;
      } else if (ty === 'mdhd') info.seconds = dv.getUint32(body + 16) / dv.getUint32(body + 12);
      else if (ty === 'stsz') info.samples = dv.getUint32(body + 8);
      else if (ty === 'stss') info.keys = dv.getUint32(body + 4);
      else if (ty === 'stsd') info.codec = type(body + 12);
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(ty)) walk(body, at + size, depth + 1);
      at += size;
    }
  };
  walk(0, b.length, 0);
  if (!info.brand || info.samples === undefined || info.seconds === undefined) return null;
  return {
    brand: info.brand,
    width: info.width ?? 0,
    height: info.height ?? 0,
    seconds: info.seconds,
    samples: info.samples,
    keys: info.keys ?? 0,
    codec: info.codec ?? '',
    fastStart: info.order.indexOf('moov') >= 0 && info.order.indexOf('moov') < info.order.indexOf('mdat'),
  };
}
