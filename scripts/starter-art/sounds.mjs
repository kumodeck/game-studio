// The starters' sound files, synthesized in Node (run by scripts/make-starter-assets.mjs; not part of the games).
//
// Additive synthesis for the bells (a few inharmonic partials, each with its own decay: how real bells ring) and
// filtered noise for the sea. Seeded noise, so the same code gives the same samples. Encoded to MP3 with ffmpeg
// (every browser plays MP3; Ogg is still missing on older iPhones). Nothing recorded, nothing to license.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RATE = 44100;

function noise(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

/**
 * A struck bell. partials = [frequency Hz, amplitude, decay seconds (to −60 dB)]. A short noise click is the strike.
 * `beat` detunes a twin of each partial by that many Hz: the slow shimmer of a real bell's two nearly equal modes.
 */
function bell({ partials, seconds, strike = 0.25, beat = 0.6, seed = 3 }) {
  const n = Math.round(seconds * RATE), out = new Float32Array(n), rnd = noise(seed);
  for (const [f, a, d] of partials) {
    const k = Math.log(1000) / d; // amplitude falls 60 dB over d seconds
    for (let i = 0; i < n; i++) {
      const t = i / RATE, env = a * Math.exp(-k * t) * Math.min(1, t * 2000); // 0.5 ms attack: no click
      out[i] += env * 0.5 * (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * (f + beat) * t + 0.7));
    }
  }
  let lp = 0;
  for (let i = 0; i < 0.03 * RATE; i++) {
    lp += (rnd() - lp) * 0.35;
    out[i] += lp * strike * Math.exp(-i / (0.006 * RATE));
  }
  return normalize(out, 0.8, 0.25);
}

/**
 * The sea under a harbour wall: low rumble that swells every few seconds, and small laps on top. Made 1 s longer
 * than `seconds` and the extra second crossfaded into the start, so the file loops without a seam.
 */
function sea({ seconds, seed = 9 }) {
  const n = Math.round(seconds * RATE), m = n + RATE, raw = new Float32Array(m), rnd = noise(seed);
  let a = 0, b = 0, c = 0;
  // Laps: short bursts of brighter noise at fixed, uneven times.
  const laps = [];
  for (let t = 0.4; t < seconds + 1; t += 0.9 + Math.abs(rnd()) * 1.6) laps.push([t, 0.3 + Math.abs(rnd()) * 0.5]);
  for (let i = 0; i < m; i++) {
    const t = i / RATE, w = rnd();
    a += (w - a) * 0.012; // deep rumble
    b += (w - b) * 0.08; // wash
    c += (w - c) * 0.3; // hiss of the laps
    // Swells: periods that divide `seconds` (10 s → 5 s and 3.33 s), so the envelope itself also loops.
    const swell = 0.55 + 0.3 * Math.sin((2 * Math.PI * t) / (seconds / 2)) + 0.15 * Math.sin((2 * Math.PI * t) / (seconds / 3) + 1);
    let lap = 0;
    for (const [lt, la] of laps) { const d = t - lt; if (d > 0 && d < 0.8) lap += la * Math.sin(Math.PI * Math.min(1, d / 0.12)) * Math.exp(-d * 6); }
    raw[i] = a * 7 * swell + b * 0.9 * swell + (c - b) * lap * 0.9;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i < RATE) { const f = i / RATE; out[i] = raw[i] * f + raw[i + n] * (1 - f); } else out[i] = raw[i];
  }
  return normalize(out, 0.55, 0);
}

function normalize(x, peak, fadeOut) {
  let mx = 0;
  for (const v of x) mx = Math.max(mx, Math.abs(v));
  const g = mx ? peak / mx : 1, fade = Math.round(fadeOut * RATE);
  for (let i = 0; i < x.length; i++) x[i] *= g * (i > x.length - fade ? (x.length - i) / fade : 1);
  return x;
}

function wav(x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return b;
}

/** Float samples → MP3 bytes (mono; `kbps` bit rate). -bitexact + no metadata: the same input gives the same file. */
function mp3(x, kbps) {
  const dir = mkdtempSync(join(tmpdir(), 'starter-sound-'));
  try {
    writeFileSync(join(dir, 'in.wav'), wav(x));
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(dir, 'in.wav'), '-ac', '1', '-codec:a', 'libmp3lame',
      '-b:a', `${kbps}k`, '-map_metadata', '-1', '-write_xing', '1', '-fflags', '+bitexact', '-flags:a', '+bitexact', join(dir, 'out.mp3')]);
    return readFileSync(join(dir, 'out.mp3'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function sounds() {
  return {
    'lantern-cove': {
      // The bell on the harbour buoy: higher and brighter than a temple bell, a hard strike (iron clapper).
      'assets/bell.mp3': mp3(bell({
        seconds: 3.2, strike: 0.5, beat: 0.9, seed: 5,
        partials: [[305, 0.35, 2.8], [610, 1, 2.6], [722, 0.55, 1.9], [915, 0.35, 1.5], [1220, 0.3, 1.1], [1623, 0.18, 0.7], [2013, 0.1, 0.45]],
      }), 80),
      'assets/waves.mp3': mp3(sea({ seconds: 10 }), 64),
    },
    'firefly-ruins': {
      // The same bronze bell the game used to synthesize live (G4 with its partials), with a hum and a slow beat.
      'assets/bell.mp3': mp3(bell({
        seconds: 3.6, strike: 0.2, beat: 0.5, seed: 7,
        partials: [[196, 0.3, 3.4], [392, 1, 3.2], [925, 0.5, 2.2], [1082, 0.35, 1.4], [2117, 0.15, 0.8]],
      }), 80),
    },
  };
}
