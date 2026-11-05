// ● Clip, stage 1 (decided 2026-11-05; src/shell/clip-model.ts, src/shell/mp4.ts): the rules that need no browser —
// lengths, frames, the early stop, the file's name, the post and its count, the mark's one switch, the prefs, and the
// MP4 box written and read back. The recording itself: test/studio-clip.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/clip-model.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIP_DEFAULT_LENGTH, CLIP_FPS, CLIP_LENGTHS, CLIP_MARK_DEFAULT, CLIP_MARK_LINES, CLIP_REPO_URL, X_LIMIT,
  clipFrames, clipStem, downloadName, endAfterStop, markStartMs, normalizeClipPrefs, postText, recClock, xLength,
} from '../src/shell/clip-model.ts';
import { mp4Info, muxMp4, sampleTicks, type Mp4Sample } from '../src/shell/mp4.ts';
import { translate } from '../src/shell/i18n.ts';

test('lengths: 6 / 8 / 12 s, 8 first; frames at 30 fps', () => {
  assert.deepEqual([...CLIP_LENGTHS], [6, 8, 12]);
  assert.equal(CLIP_DEFAULT_LENGTH, 8);
  assert.equal(CLIP_FPS, 30);
  assert.equal(clipFrames(8), 240);
  assert.equal(clipFrames(2), 60);
  assert.equal(clipFrames(0), 1);
});

test('stopped early: one more second for the mark, on the frame grid, never past the planned end', () => {
  assert.ok(Math.abs(endAfterStop(3000, 8000) - 4000) < 1e-9);
  assert.ok(Math.abs(endAfterStop(1010, 8000) - 2033.333) < 0.01);
  assert.equal(endAfterStop(7600, 8000), 8000);
  assert.ok(Math.abs(endAfterStop(0, 8000) - 1033.333) < 0.01);
  // The mark's second: the last second before the end.
  assert.equal(markStartMs(8000), 7000);
  assert.equal(markStartMs(600), 0);
});

test('the file name: the game\'s name in a–z 0–9 and "-"; a name with nothing left is "game"', () => {
  assert.equal(clipStem('Neon Run'), 'neon-run-clip');
  assert.equal(clipStem('  Café: Déjà vu!! '), 'cafe-deja-vu-clip');
  assert.equal(clipStem('ネオン'), 'game-clip');
  assert.equal(clipStem(''), 'game-clip');
  assert.ok(clipStem('x'.repeat(200)).length <= 45);
  assert.equal(downloadName('Neon Run', new Date(2026, 10, 5, 9, 4, 7)), 'neon-run-clip-20261105-090407.mp4');
});

test('the post: with the mark it names the editor and the address; off, neither (one switch)', () => {
  const on = postText({ game: 'Neon Run', seconds: 8, mark: true });
  const off = postText({ game: 'Neon Run', seconds: 8, mark: false });
  assert.equal(on, `Neon Run: an 8-second clip from my web game, made with KUMODeck Game Studio 👇 ${CLIP_REPO_URL}`);
  assert.match(on, /KUMODeck Game Studio/);
  assert.ok(on.includes(CLIP_REPO_URL));
  assert.doesNotMatch(off, /KUMODeck|github/);
  assert.equal(off, 'Neon Run: an 8-second clip from my web game 👇');
  assert.equal(postText({ game: '', seconds: 6, mark: false }), 'A 6-second clip from my web game 👇');
  // Within X's limit even for the longest game name kept (60 characters).
  assert.ok(xLength(postText({ game: 'W'.repeat(500), seconds: 12, mark: true })) <= X_LIMIT);
});

test('X\'s count: a URL is 23, an emoji 2, Japanese 2 a character', () => {
  assert.equal(xLength('hello'), 5);
  assert.equal(xLength(`see ${CLIP_REPO_URL}`), 4 + 23);
  assert.equal(xLength('👇'), 2);
  assert.equal(xLength('ゲーム'), 6);
  assert.equal(xLength(postText({ game: 'Neon Run', seconds: 8, mark: true })), 102);
});

test('the mark: on by default, two English lines, and the prefs keep what the person chose', () => {
  assert.equal(CLIP_MARK_DEFAULT, true);
  assert.deepEqual([...CLIP_MARK_LINES], ['Made with KUMODeck Game Studio', 'github.com/kumodeck/game-studio']);
  assert.ok(CLIP_REPO_URL.endsWith(CLIP_MARK_LINES[1]));
  assert.deepEqual(normalizeClipPrefs(undefined), { seconds: 8, mark: CLIP_MARK_DEFAULT });
  assert.deepEqual(normalizeClipPrefs({ seconds: 12, mark: false }), { seconds: 12, mark: false });
  assert.deepEqual(normalizeClipPrefs({ seconds: 9, mark: 'no' }), { seconds: 8, mark: CLIP_MARK_DEFAULT });
});

test('the clock on the button', () => {
  assert.equal(recClock(0), '0:00');
  assert.equal(recClock(3400), '0:03');
  assert.equal(recClock(61000), '1:01');
});

test('the words: English and Japanese for the button, the line and the refusals', () => {
  for (const lang of ['en', 'ja'] as const) {
    for (const k of ['clip.btn', 'clip.tip', 'clip.stop', 'clip.saved', 'clip.downloaded', 'clip.where', 'clip.finder', 'clip.copy', 'clip.copied',
      'clip.mark', 'clip.length', 'clip.local', 'clip.webgpu', 'clip.tainted', 'clip.noEncoder', 'clip.failed', 'clip.saveFailed', 'clip.markOff', 'clip.markOn']) {
      const s = translate(lang, k, { n: 8, name: 'neon-run-clip-1.mp4', dir: 'Movies › KUMODeck', t: '0:03', s: 8 });
      assert.ok(s && s !== k, `${lang} ${k}`);
    }
  }
  assert.equal(translate('en', 'clip.local', {}), 'Nothing leaves this computer.');
  assert.equal(translate('en', 'clip.webgpu', {}), 'Clip needs WebGL for now. This game draws with WebGPU.');
});

// A fake H.264 stream: the box does not look inside the samples.
const fake = (n: number, fps = 30): Mp4Sample[] =>
  Array.from({ length: n }, (_, i) => ({ data: new Uint8Array([0, 0, 0, 4, i & 255, 1, 2, 3]), key: i % fps === 0, ts: Math.round((i * 1e6) / fps), dur: Math.round(1e6 / fps) }));

test('the MP4: 2 s at 30 fps reads back as 60 samples, 2 key frames, 2.000 s, 1280×720, avc1, moov first', () => {
  const file = muxMp4({ width: 1280, height: 720, avcc: new Uint8Array([1, 0x42, 0xe0, 0x1f, 0xff, 0xe0, 0]), samples: fake(60) });
  const info = mp4Info(file);
  assert.ok(info);
  assert.equal(info.brand, 'isom');
  assert.equal(info.samples, 60);
  assert.equal(info.keys, 2);
  assert.equal(info.codec, 'avc1');
  assert.equal(info.width, 1280);
  assert.equal(info.height, 720);
  assert.ok(Math.abs(info.seconds - 2) < 1e-6, String(info.seconds));
  assert.equal(info.fastStart, true);
  // The samples are in mdat as given, right after the header.
  const tail = file.subarray(file.length - 8 * 60);
  assert.equal(tail[4], 0);
  assert.equal(tail[8 + 4], 1);
});

test('the MP4: durations from the timestamps, rounded on the running time (no drift)', () => {
  const t = sampleTicks(fake(300));
  assert.equal(t.reduce((a, b) => a + b, 0), 900000);
  assert.ok(t.every((d) => d === 3000));
  // A slow game's last frame holds until the clip's end (the encoder's chunk says only one frame's time).
  const slow = fake(5);
  const info = mp4Info(muxMp4({ width: 2, height: 2, avcc: new Uint8Array(1), samples: slow, endUs: 1_500_000 }));
  assert.ok(info && Math.abs(info.seconds - 1.5) < 1e-6, String(info?.seconds));
  assert.throws(() => muxMp4({ width: 2, height: 2, avcc: new Uint8Array(1), samples: [] }));
  assert.equal(mp4Info(new Uint8Array([1, 2, 3])), null);
});
