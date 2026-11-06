// ● Clip, stage 1 (decided 2026-11-05; src/shell/clip-model.ts, src/shell/mp4.ts): the rules that need no browser —
// lengths, frames, the early stop, the file's name, the post and its count, the mark's one switch, the prefs, and the
// MP4 box written and read back. Stage 2 (decided 2026-11-05): Wide / Tall, the Before / After's name, words and post,
// ✦ Rewrite's check of the AI's post. The recording itself: test/studio-clip.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/clip-model.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BA_ADDS_SECONDS, BA_AFTER_SECONDS, BA_BEFORE_MS, BA_WORDS_MAX, CLIP_DEFAULT_LENGTH, CLIP_FPS, CLIP_LENGTHS, CLIP_MARK_DEFAULT, CLIP_MARK_LINES, CLIP_REPO_URL, CLIP_TALL, CLIP_WIDE, X_LIMIT,
  baSeconds, baWords, beforeAfterPost, beforeAfterStem, checkRewrite, clipFrames, cutAtPress, clipShapeFor, clipSize, clipStem, downloadName, endAfterStop, markStartMs,
  normalizeClipPrefs, postText, recClock, withAddress, xLength,
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
  assert.deepEqual(normalizeClipPrefs(undefined), { seconds: 8, mark: CLIP_MARK_DEFAULT, words: true });
  assert.deepEqual(normalizeClipPrefs({ seconds: 12, mark: false }), { seconds: 12, mark: false, words: true });
  assert.deepEqual(normalizeClipPrefs({ seconds: 9, mark: 'no' }), { seconds: 8, mark: CLIP_MARK_DEFAULT, words: true });
  // Stage 2: the shape once chosen, the words on Before / After (on unless turned off); an odd shape reads as not chosen.
  assert.deepEqual(normalizeClipPrefs({ seconds: 6, mark: true, shape: 'tall', words: false }), { seconds: 6, mark: true, words: false, shape: 'tall' });
  assert.equal('shape' in normalizeClipPrefs({ shape: 'square' }), false);
});

test('the clock on the button', () => {
  assert.equal(recClock(0), '0:00');
  assert.equal(recClock(3400), '0:03');
  assert.equal(recClock(61000), '1:01');
});

test('the words: English and Japanese for the button, the line and the refusals', () => {
  for (const lang of ['en', 'ja'] as const) {
    for (const k of ['clip.btn', 'clip.tip', 'clip.stop', 'clip.saved', 'clip.downloaded', 'clip.where', 'clip.finder', 'clip.copy', 'clip.copied',
      'clip.mark', 'clip.length', 'clip.local', 'clip.webgpu', 'clip.tainted', 'clip.noEncoder', 'clip.failed', 'clip.saveFailed', 'clip.markOff', 'clip.markOn',
      'clip.shape', 'clip.shape.wide', 'clip.shape.tall', 'clip.words', 'clip.ba', 'clip.baTip', 'clip.share', 'clip.saveHere', 'clip.shareFailed',
      'clip.rewrite', 'clip.rewriteTip', 'clip.rewriting', 'clip.rewritten', 'clip.rewriteLong', 'clip.rewriteEmpty', 'clip.rewriteNone',
      // studio-clip-3 (2026-11-06)
      'clip.ending', 'clip.saving', 'clip.holdTip', 'clip.whereTip', 'clip.postX', 'clip.postXTip', 'clip.postXOpened',
      'clip.askAi', 'clip.askWebgpu', 'clip.askTainted',
      // walk 2 (2026-11-06)
      'clip.baAdds', 'clip.markAdd', 'clip.markRemove', 'clip.post.clip', 'clip.post.clipBare', 'clip.post.clipMade', 'clip.post.clipPlain', 'clip.post.ba',
      'clip.post.baPlain', 'clip.post.baMarked', 'clip.post.ai']) {
      const s = translate(lang, k, { n: 8, name: 'neon-run-clip-1.mp4', dir: 'Movies › KUMODeck', t: '0:03', s: 8 });
      assert.ok(s && s !== k, `${lang} ${k}`);
    }
  }
  assert.equal(translate('en', 'clip.local', {}), 'Nothing leaves this computer.');
  // studio-clip-3 (decided 2026-11-06): each refusal says what to do next (VOICE.md rule 2), the AI by its name.
  assert.equal(translate('en', 'clip.webgpu', { Ai: 'Claude' }), 'Clip can’t record WebGPU yet, and this game draws with WebGPU. Claude can switch it to WebGL, or use your computer’s screen recorder.');
  assert.equal(translate('en', 'clip.tainted', { Ai: 'Claude' }), 'This game draws images from another site, so the browser won’t let Clip read its picture. Claude can move them into the game’s folder.');
  assert.equal(translate('en', 'clip.stop', { t: '0:05' }), '0:05 left · Stop');
  assert.equal(translate('ja', 'clip.stop', { t: '0:05' }), '残り 0:05 · 止める');
  // Stage 2: the line names the shape it was recorded in.
  // Walk 2 △9 (decided 2026-11-06): the folder is the head ("Saved to Movies › KUMODeck", whole), the shape and length
  // the button after it — the folder is said once, not cut at the row's end.
  assert.equal(translate('en', 'clip.where', { s: 8, shape: translate('en', 'clip.shape.tall', {}) }), '8 s · Tall 720×1280');
  assert.equal(translate('en', 'clip.saved', { dir: translate('en', 'clip.dir.movies', {}) }), 'Saved to Movies › KUMODeck');
  assert.ok(translate('ja', 'clip.saved', { dir: 'X' }).includes('X'));
  assert.ok(!translate('ja', 'clip.where', { s: 8, shape: 'S' }).includes('KUMODeck'));
});

test('stage 2 · Wide / Tall: 1280×720 and 720×1280 (one H.264 level holds both); a phone records Tall until the person chooses', () => {
  assert.deepEqual(clipSize('wide'), CLIP_WIDE);
  assert.deepEqual(clipSize('tall'), CLIP_TALL);
  assert.deepEqual(CLIP_TALL, { w: 720, h: 1280 });
  // Level 3.1 = at most 3600 macroblocks (16×16) a frame: both shapes are exactly that.
  for (const { w, h } of [CLIP_WIDE, CLIP_TALL]) assert.equal((w / 16) * (h / 16), 3600);
  assert.equal(clipShapeFor({}, false), 'wide');
  assert.equal(clipShapeFor({}, true), 'tall');
  assert.equal(clipShapeFor({ shape: 'wide' }, true), 'wide');
  assert.equal(clipShapeFor({ shape: 'tall' }, false), 'tall');
});

test('stage 2 · the late stop: the clip ends one second after the PRESS, however late the game page reads it', () => {
  // Pressed 1.0 s in: 2.033 s (on the 1/30 s grid), whether the message came at 1.1 s or 5 s — play-clip.ts gives
  // endAfterStop the press's time and drops the frames recorded after it.
  // On time (read 20 ms after the press, the last frame at slot 30 = 1.0 s): ends at 2.0 s, nothing dropped.
  const onTime = cutAtPress({ nowMs: 1020, pressMs: 1000, liveFrom: 0, slot: 30, endMs: 8000 });
  assert.ok(Math.abs(onTime.endMs - 2000) < 1e-6 && onTime.tailSlot === 30 && onTime.drop === 1, JSON.stringify(onTime));
  // Read 4 s late (a busy page; frames up to slot 150 = 5.0 s taken): still 2.0 s, the 121 frames after the press dropped.
  const late = cutAtPress({ nowMs: 5000, pressMs: 1000, liveFrom: 0, slot: 150, endMs: 8000 });
  assert.ok(Math.abs(late.endMs - 2000) < 1e-6 && late.drop === 121, JSON.stringify(late));
  // A press "in the future" (clocks a little apart) is now; one before the game's picture started is its first frame.
  assert.equal(cutAtPress({ nowMs: 1000, pressMs: 1500, liveFrom: 0, slot: 30, endMs: 8000 }).pressed, 1000);
  assert.ok(Math.abs(cutAtPress({ nowMs: 2500, pressMs: 100, liveFrom: 2000, slot: 75, endMs: 10000 }).pressed - 2033.333) < 0.01);
  // A press within the last second (the mark's second has started) ends where it was going to.
  assert.equal(cutAtPress({ nowMs: 7600, pressMs: 7500, liveFrom: 0, slot: 228, endMs: 8000 }).endMs, 8000);
  // The Before / After's whole length: 2 s still + 8 s of the After = 10 s, its mark on the last second.
  assert.equal(BA_BEFORE_MS / 1000 + BA_AFTER_SECONDS, 10);
  // Walk 2 △10 (decided 2026-11-06): the After follows the length chosen (it was a fixed 8 s whatever was chosen), and
  // Clip options says what the Before adds — so "8 seconds ✓" and a 10 s Before / After agree.
  assert.equal(baSeconds(CLIP_DEFAULT_LENGTH), 10);
  assert.deepEqual(CLIP_LENGTHS.map(baSeconds), [8, 10, 14]);
  assert.equal(BA_ADDS_SECONDS, 2);
  assert.equal(translate('en', 'clip.baAdds', { s: BA_ADDS_SECONDS }), 'Before / After adds 2 s: the frame you asked from');
  assert.equal(translate('en', 'clip.baTip', { s: baSeconds(12) }), 'Make a 14-second video: the frame you asked from, then the new code from the same moment');
  assert.equal(markStartMs(10000), 9000);
});

test('stage 2 · Before / After: its file name, the words on the Before, the post (within 280, words optional)', () => {
  assert.equal(beforeAfterStem('Neon Run'), 'neon-run-before-after');
  assert.equal(beforeAfterStem('ネオン'), 'game-before-after');
  assert.equal(baWords('  “Bring the boss in\n from here.” '), 'Bring the boss in from here.');
  assert.equal(baWords(''), '');
  const long = baWords('w'.repeat(300));
  assert.equal(long.length, BA_WORDS_MAX);
  assert.ok(long.endsWith('…'));
  const post = beforeAfterPost({ time: 5.02, asked: 'Bring the boss in from here.', mark: true, words: true, marked: true, ai: 'Claude' });
  assert.equal(post, `Paused my game at 0:05, marked a spot and told Claude “bring the boss in from here”. It fixed the code. Before → After 👇 ${CLIP_REPO_URL}`);
  // The plan's own count of this post: 146 / 280 (launch/count-x.mjs).
  assert.equal(xLength(post), 146);
  // Words off: no words of theirs at all; the mark off: no address.
  const plain = beforeAfterPost({ time: 65, asked: 'secret words', mark: false, words: false, marked: false, ai: 'Codex' });
  assert.equal(plain, 'Paused my game at 1:05 and asked Codex for a fix. It fixed the code. Before → After 👇');
  // Long words are cut so the whole post fits.
  const cut = beforeAfterPost({ time: 3, asked: 'make the boss '.repeat(40), mark: true, words: true, marked: false, ai: 'Claude' });
  assert.ok(xLength(cut) <= X_LIMIT, String(xLength(cut)));
  assert.match(cut, /…”/);
  assert.ok(cut.endsWith(CLIP_REPO_URL));
});

test('walk 2 △11 · a post in the editor\'s language: the table\'s words, the same rules (280, the address with the mark)', () => {
  const say = (k: string, v: Record<string, string | number>) => translate('ja', k, v);
  const ai = translate('ja', 'clip.post.ai', {});
  const ba = beforeAfterPost({ time: 4.11, asked: 'Bring the boss in from here.', mark: true, words: true, marked: true, ai: 'Claude', say });
  assert.equal(ba, `${translate('ja', 'clip.post.ba', { at: '0:04', marked: translate('ja', 'clip.post.baMarked', {}), ai: 'Claude', words: 'Bring the boss in from here' })} ${CLIP_REPO_URL}`);
  // No English sentence around the words (the walk: "Paused my game at 0:04 … told Claude “<their words>”").
  assert.doesNotMatch(ba, /Paused my game|It fixed the code/);
  const off = beforeAfterPost({ time: 65, asked: 'x', mark: false, words: false, marked: false, ai, say });
  assert.equal(off, translate('ja', 'clip.post.baPlain', { at: '1:05', marked: '', ai }));
  assert.ok(!off.includes('github.com'), 'the mark off: no address');
  // Long words (each counted 2 by X) are cut so the whole post fits.
  const long = beforeAfterPost({ time: 3, asked: translate('ja', 'clip.post.baMarked', {}).repeat(80), mark: true, words: true, marked: false, ai: 'Claude', say });
  assert.ok(xLength(long) <= X_LIMIT, String(xLength(long)));
  assert.ok(long.endsWith(CLIP_REPO_URL));
  // A plain clip's post.
  assert.equal(postText({ game: 'Neon Run', seconds: 8, mark: false, say }), translate('ja', 'clip.post.clipPlain', { what: translate('ja', 'clip.post.clip', { game: 'Neon Run', s: 8 }) }));
  assert.ok(postText({ game: '', seconds: 6, mark: true, say }).endsWith(CLIP_REPO_URL));
  // No `say` = English, as before.
  assert.match(postText({ game: 'Neon Run', seconds: 8, mark: false }), /^Neon Run: an 8-second clip/);
});

test('"marked a spot" only when the ask had a mark, in English and Japanese (decided 2026-11-06, seen on Big Swell)', () => {
  const o = { time: 7.6, asked: 'Make the waves twice as tall.', mark: true, words: true, ai: 'Claude' };
  assert.equal(beforeAfterPost({ ...o, marked: false }),
    `Paused my game at 0:07 and told Claude “make the waves twice as tall”. It fixed the code. Before → After 👇 ${CLIP_REPO_URL}`);
  assert.equal(beforeAfterPost({ ...o, marked: true }),
    `Paused my game at 0:07, marked a spot and told Claude “make the waves twice as tall”. It fixed the code. Before → After 👇 ${CLIP_REPO_URL}`);
  assert.doesNotMatch(beforeAfterPost({ ...o, words: false, marked: false }), /marked/);
  // Japanese: the table's words; without a mark the sentence still reads (the comma is the template's, not the mark's).
  const say = (k: string, v: Record<string, string | number>) => translate('ja', k, v);
  const mk = translate('ja', 'clip.post.baMarked', {});
  const jaOff = beforeAfterPost({ ...o, asked: 'x y z', marked: false, say });
  const jaOn = beforeAfterPost({ ...o, asked: 'x y z', marked: true, say });
  assert.ok(!jaOff.includes(mk), jaOff);
  assert.ok(jaOn.includes(mk), jaOn);
  assert.equal(jaOff, `${translate('ja', 'clip.post.ba', { at: '0:07', marked: '', ai: 'Claude', words: 'x y z' })} ${CLIP_REPO_URL}`);
  assert.ok(jaOff.startsWith('0:07 ') && /\S、Claude /.test(jaOff), `the pause and the ask joined by the template's comma: ${jaOff}`);
  assert.ok(!beforeAfterPost({ ...o, words: false, marked: false, say }).includes(mk));
});

test('stage 2 · ✦ Rewrite: the AI\'s post is taken only within 280, and the address follows the mark whatever it wrote', () => {
  const ok = checkRewrite('"Paused my game, told Claude to bring the boss in — fixed 👇 github.com/kumodeck/game-studio"', true);
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.text, `Paused my game, told Claude to bring the boss in — fixed 👇 ${CLIP_REPO_URL}`);
  // Mark off: the address the AI kept is taken out.
  const off = checkRewrite(`My boss fight, fixed 👇 ${CLIP_REPO_URL}`, false);
  assert.ok(off.ok && off.text === 'My boss fight, fixed 👇', JSON.stringify(off));
  // Mark on, the AI left it out: put back at the end.
  const on = checkRewrite('My boss fight, fixed 👇', true);
  assert.ok(on.ok && on.text === `My boss fight, fixed 👇 ${CLIP_REPO_URL}`);
  // Too long for X: the person's post stays (the line says how long it was).
  const long = checkRewrite('a'.repeat(270), true);
  assert.deepEqual(long, { ok: false, why: 'long', n: 270 + 1 + 23 });
  // A note cut by the status's 300 characters ("…"): too long.
  assert.equal(checkRewrite('b'.repeat(299) + '…', false).ok, false);
  assert.deepEqual(checkRewrite('', true), { ok: false, why: 'empty', n: 0 });
  assert.equal(checkRewrite(CLIP_REPO_URL, true).ok, false);
  assert.equal(withAddress(`x ${CLIP_REPO_URL} y`, false), 'x y');
  assert.equal(withAddress('x', true), `x ${CLIP_REPO_URL}`);
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

test('studio-clip-3: the time left while recording, rounded up, and a Before / After\'s still part not waited for', async () => {
  const { recLeftMs, leftClock } = await import('../src/shell/clip-model.ts');
  assert.equal(recLeftMs({ totalMs: 8000, elapsedMs: 0 }), 8000);
  assert.equal(recLeftMs({ totalMs: 8000, elapsedMs: 3200 }), 4800);
  assert.equal(recLeftMs({ totalMs: 8000, elapsedMs: 9000 }), 0);
  // A Before / After of 10 s: its 2 s still part is made before recording starts, so 8 s are left at the start.
  assert.equal(recLeftMs({ totalMs: 10000, stillMs: 2000, elapsedMs: 0 }), 8000);
  assert.equal(leftClock(8000), '0:08');
  assert.equal(leftClock(4800), '0:05');
  assert.equal(leftClock(1), '0:01');
  assert.equal(leftClock(0), '0:00');
  assert.equal(leftClock(61000), '1:01');
});

test('studio-clip-3: Post on X… opens X\'s compose page with the post (X\'s count unchanged, nothing else in it)', async () => {
  const { xComposeUrl, X_COMPOSE } = await import('../src/shell/clip-model.ts');
  const post = 'Paused my game at 0:05 and told Claude “bring the boss in”. Before → After 👇 https://github.com/kumodeck/game-studio';
  const u = new URL(xComposeUrl(post));
  assert.equal(`${u.origin}${u.pathname}`, X_COMPOSE);
  assert.equal(u.searchParams.get('text'), post);
  assert.deepEqual([...u.searchParams.keys()], ['text']);
});
