// ● Clip stage 3 (decided 2026-11-07; src/shell/clip-sound-model.ts, src/shell/mp4.ts, src/bridge/clip-sound.ts): the
// rules of a clip's sound that need no browser — where each captured piece goes on the clip's time (a late stop, a
// Before / After's still part), when a clip gets no sound track at all, the sound track in the MP4, the Sound row's
// choice in the prefs, and the editor's words for a clip saved without its sound. The capture itself is checked in the
// screen tests (studio-clip.browser.mjs `sound`, studio-clip-ba.browser.mjs), with ffprobe on the saved file.
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeClipPrefs } from '../src/shell/clip-model.ts';
import { SOUND_CODEC, SOUND_SILENT_PEAK, clipTimeAt, layOut, soundNoteKey } from '../src/shell/clip-sound-model.ts';
import { mp4Info, muxMp4, type Mp4Sample } from '../src/shell/mp4.ts';
import { translate } from '../src/shell/i18n.ts';

const tone = (n: number, v = 0.5) => Float32Array.from({ length: n }, () => v);

test('the sound on the clip\'s time: before the first live frame it is not in the clip; a late stop moves the clock', () => {
  // A plain clip: the picture's 0:00 at page time 1000.
  assert.equal(clipTimeAt(999, [{ from: 1000, t0: 1000 }], 0), null);
  assert.equal(clipTimeAt(1500, [{ from: 1000, t0: 1000 }], 0), 500);
  // A Before / After: the game's picture starts 2 s into the clip.
  assert.equal(clipTimeAt(1500, [{ from: 1000, t0: 1000 }], 2000), 2500);
  // A late stop at page time 4000 put the clock back 700 ms (the frames between the press and the message dropped):
  // what comes after it is laid 700 ms earlier, over what was recorded in between.
  const clocks = [{ from: 1000, t0: 1000 }, { from: 4000, t0: 1700 }];
  assert.equal(clipTimeAt(3999, clocks, 0), 2999);
  assert.equal(clipTimeAt(4000, clocks, 0), 2300);
});

test('the sound laid out: later pieces over earlier ones, nothing before 0:00 or past the end, mono to both sides', () => {
  const rate = 1000; // 1 sample a ms, to read the places easily
  const { data, peak } = layOut([
    { atMs: -5, data: [tone(10, 0.1)] }, // starts before 0:00: only its last 5 samples
    { atMs: 20, data: [tone(10, 0.2), tone(10, 0.3)] },
    { atMs: 25, data: [tone(10, 0.4)] }, // later: over the second half of the one before
    { atMs: 95, data: [tone(10, 0.9)] }, // runs past the end (100 ms): cut there
  ], { rate, endMs: 100 });
  assert.equal(data.length, 2);
  assert.equal(data[0]!.length, 100);
  assert.equal(data[0]![0], Math.fround(0.1));
  assert.equal(data[0]![5], 0);
  assert.equal(data[0]![20], Math.fround(0.2));
  assert.equal(data[1]![20], Math.fround(0.3));
  assert.equal(data[0]![25], Math.fround(0.4));
  assert.equal(data[1]![25], Math.fround(0.4)); // mono: the same on the right
  assert.equal(data[0]![99], Math.fround(0.9));
  assert.ok(Math.abs(peak - 0.9) < 1e-6);
});

test('a game that made no sound gets no sound track: below the silence line the peak says so', () => {
  const { peak } = layOut([{ atMs: 0, data: [tone(100, 1e-6)] }], { rate: 1000, endMs: 100 });
  assert.ok(peak < SOUND_SILENT_PEAK);
  assert.equal(layOut([], { rate: 48000, endMs: 2000 }).peak, 0);
  assert.equal(SOUND_CODEC, 'mp4a.40.2'); // AAC-LC: what X takes in an MP4
});

test('Sound in Clip options: on unless turned off, kept as chosen', () => {
  assert.equal(normalizeClipPrefs({}).sound, true);
  assert.equal(normalizeClipPrefs({ sound: false }).sound, false);
  assert.equal(normalizeClipPrefs({ sound: 'no' }).sound, true);
});

test('the line for a clip saved without its sound: only when sound was lost, in both languages, saying what to do', () => {
  assert.equal(soundNoteKey('on'), null);
  assert.equal(soundNoteKey('silent'), null);
  assert.equal(soundNoteKey('off'), null);
  assert.equal(soundNoteKey(undefined), null);
  for (const lang of ['en', 'ja'] as const) {
    for (const k of ['clip.sound', soundNoteKey('unsupported')!, soundNoteKey('failed')!]) {
      const s = translate(lang, k, {});
      assert.ok(s && s !== k, `${lang} ${k}`);
    }
  }
  // Says what happened, then what to do (VOICE.md rule 2).
  assert.match(translate('en', 'clip.noSound', {}), /^Saved without sound: .*Chrome or Edge/);
});

// A fake H.264 stream and fake AAC frames: the box does not look inside the samples.
const video = (n: number): Mp4Sample[] =>
  Array.from({ length: n }, (_, i) => ({ data: new Uint8Array([0, 0, 0, 4, i & 255, 1, 2, 3]), key: i % 30 === 0, ts: Math.round((i * 1e6) / 30), dur: Math.round(1e6 / 30) }));
const aac = (n: number, rate = 48000) =>
  Array.from({ length: n }, (_, i) => ({ data: new Uint8Array([0x21, i & 255, 7]), ts: Math.round((i * 1024 * 1e6) / rate), dur: Math.round((1024 * 1e6) / rate) }));

test('the MP4 with sound: a second track (soun, mp4a, 48 kHz stereo), its samples after the video\'s, moov first', () => {
  const frames = Math.ceil((2 * 48000) / 1024); // 2 s
  const file = muxMp4({ width: 1280, height: 720, avcc: new Uint8Array([1, 0x42, 0xe0, 0x1f, 0xff, 0xe0, 0]), samples: video(60),
    audio: { rate: 48000, channels: 2, asc: Uint8Array.of(0x11, 0x90), samples: aac(frames) } });
  const info = mp4Info(file);
  assert.ok(info);
  assert.equal(info.codec, 'avc1');
  assert.equal(info.samples, 60);
  assert.equal(info.width, 1280);
  assert.ok(Math.abs(info.seconds - 2) < 1e-6);
  assert.equal(info.fastStart, true);
  assert.ok(info.audio);
  assert.equal(info.audio.codec, 'mp4a');
  assert.equal(info.audio.rate, 48000);
  assert.equal(info.audio.channels, 2);
  assert.equal(info.audio.samples, frames);
  assert.ok(Math.abs(info.audio.seconds - (frames * 1024) / 48000) < 1e-6);
  // The AudioSpecificConfig is in the esds (0x05 descriptor), and the sound's bytes are the file's last.
  const at = Buffer.from(file).indexOf(Buffer.from([0x05, 0x02, 0x11, 0x90]));
  assert.ok(at > 0, 'the ASC in esds');
  assert.deepEqual([...file.subarray(file.length - 3)], [0x21, (frames - 1) & 255, 7]);
});

test('the MP4 without sound is as before: one track, no sound', () => {
  const info = mp4Info(muxMp4({ width: 2, height: 2, avcc: new Uint8Array(1), samples: video(30) }));
  assert.ok(info);
  assert.equal(info.audio, null);
  // An empty sound (nothing came out of the encoder) is no track either, never a silent one.
  const empty = mp4Info(muxMp4({ width: 2, height: 2, avcc: new Uint8Array(1), samples: video(30), audio: { rate: 48000, channels: 2, asc: Uint8Array.of(0x11, 0x90), samples: [] } }));
  assert.equal(empty?.audio, null);
});
