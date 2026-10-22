// The five kinds of "Make with AI" as data (src/tools/library/gen-kinds.ts, generate-ui 2026-10-22): the price shown
// before Make matches the local server's (src/server/kumo.mjs, which copies KUMODeck's price table), a sound's request
// carries what KUMODeck expects, and a history line put back in the form ("Again" / "Change") never makes a form
// KUMODeck would refuse. Run: node --experimental-strip-types --test test/generate.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, KINDS, KIND_WORDS, MAX_LEN, formFrom, isSound, priceOf, soundRequest } from '../src/tools/library/gen-kinds.ts';
import type { Form } from '../src/tools/library/gen-kinds.ts';
import type { KumoMade } from '../src/contract.ts';
import { t } from '../src/tools/library/strings.ts';
// @ts-ignore — plain JS module of the local server
import { kumoImagePrice, kumo3dPrice, kumoSoundPrice } from '../src/server/kumo.mjs';

const f = (o: Partial<Form>): Form => ({ ...DEFAULT_FORM, ...o });
const line = (o: Partial<KumoMade>): KumoMade => ({ id: 'j', at: '2026-10-22T00:00:00.000Z', kind: 'sfx', prompt: 'coin', options: {}, path: 'assets/coin.wav', costUsdMicros: 2000, ...o });

test('five kinds, images and 3D first (where they were); the sounds are the three sound kinds', () => {
  assert.deepEqual(KINDS, ['picture', 'model', 'sfx', 'music', 'voice']);
  assert.deepEqual(KINDS.filter(isSound), ['sfx', 'music', 'voice']);
});

test('the price before Make is the local server’s price, for every kind and choice', () => {
  for (const side of [512, 1024, 2048]) {
    assert.equal(priceOf(f({ side })), kumoImagePrice({ width: side, height: side }));
    assert.equal(priceOf(f({ side, quality: 'high' })), kumoImagePrice({ width: side, height: side, quality: 'high' }));
    assert.equal(priceOf(f({ side, quality: 'seamless' })), kumoImagePrice({ width: side, height: side, tiling: 'both' }));
  }
  assert.equal(priceOf(f({ kind: 'model' })), kumo3dPrice({ texture: true }));
  assert.equal(priceOf(f({ kind: 'model', texture: false })), kumo3dPrice({ texture: false }));
  for (const sec of [1, 2, 5]) assert.equal(priceOf(f({ kind: 'sfx', sfxSec: sec })), kumoSoundPrice({ kind: 'sfx', durationSec: sec }));
  for (const sec of [15, 30, 60]) assert.equal(priceOf(f({ kind: 'music', musicSec: sec })), kumoSoundPrice({ kind: 'music', durationSec: sec }));
  const words = 'Welcome to the cove!';
  assert.equal(priceOf(f({ kind: 'voice', prompt: words })), kumoSoundPrice({ kind: 'voice', text: words }));
});

test('a sound’s request: sfx with its length, music with length and loop, a voice line with its voice', () => {
  assert.deepEqual(soundRequest(f({ kind: 'sfx', prompt: ' coin ', sfxSec: 1 })), { kind: 'sfx', prompt: 'coin', durationSec: 1 });
  assert.deepEqual(soundRequest(f({ kind: 'music', prompt: 'harbor', musicSec: 60, loop: false })), { kind: 'music', prompt: 'harbor', durationSec: 60, loop: false });
  assert.deepEqual(soundRequest(f({ kind: 'voice', prompt: 'Hello!', voice: 'warm' })), { kind: 'voice', prompt: 'Hello!', voice: 'warm' });
});

test('Again / Change: a history line puts its kind, words and choices back; the rest of the form stays', () => {
  const start = f({ kind: 'picture', prompt: 'sky', side: 2048, musicSec: 15 });
  assert.deepEqual(formFrom(line({ kind: 'sfx', prompt: 'door creak', options: { durationSec: 5 } }), start), { ...start, kind: 'sfx', prompt: 'door creak', sfxSec: 5 });
  assert.deepEqual(formFrom(line({ kind: 'music', prompt: 'calm', options: { durationSec: 60, loop: false } }), start), { ...start, kind: 'music', prompt: 'calm', musicSec: 60, loop: false });
  assert.deepEqual(formFrom(line({ kind: 'voice', prompt: 'Hi', options: { voice: 'deep' } }), start), { ...start, kind: 'voice', prompt: 'Hi', voice: 'deep' });
  assert.deepEqual(formFrom(line({ kind: 'picture', prompt: 'wall', options: { side: 512, quality: 'seamless' } }), start), { ...start, prompt: 'wall', side: 512, quality: 'seamless' });
  assert.deepEqual(formFrom(line({ kind: 'model', prompt: 'chest', options: { texture: false } }), start), { ...start, kind: 'model', prompt: 'chest', texture: false });
});

test('a hand-edited history line never makes a form KUMODeck refuses', () => {
  const start = f({});
  const bad = formFrom(line({ kind: 'sfx', options: { durationSec: 600 } }), start);
  assert.equal(bad.sfxSec, start.sfxSec);
  assert.equal(formFrom(line({ kind: 'music', options: { durationSec: 1 } }), start).musicSec, start.musicSec);
  assert.equal(formFrom(line({ kind: 'voice', options: { voice: 'robot' } }), start).voice, start.voice);
  assert.equal(formFrom(line({ kind: 'picture', options: { side: 4096, quality: 'ultra' } }), start).side, start.side);
  assert.equal(formFrom(line({ kind: 'voice', prompt: 'a'.repeat(900) }), start).prompt.length, MAX_LEN.voice);
});

test('every kind has its words in English and Japanese, and three examples', () => {
  for (const k of KINDS) {
    const w = KIND_WORDS[k];
    assert.equal(w.examples.length, 3);
    for (const key of [w.chip, w.ph, w.price, w.usual, w.making, ...w.examples]) {
      assert.ok(t('en', key), `${k}: ${key} in English`);
      // "3D" is the same word in both
      if (key !== 'kindModel') assert.notEqual(t('ja', key), t('en', key), `${k}: ${key} in Japanese`);
    }
  }
});
