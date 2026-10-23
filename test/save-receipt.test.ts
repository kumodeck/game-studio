// The line after Save (plan step 6, src/shell/save-receipt.ts): what was kept by name, then whether it is in the game.
// Run: node --experimental-strip-types --no-warnings --test test/save-receipt.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { receipt, savedList, type SavedThing } from '../src/shell/save-receipt.ts';
import { translate } from '../src/shell/i18n.ts';

const en = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
const ja = (k: string, v?: Record<string, string | number>) => translate('ja', k, v);
const vars = (lang: 'en' | 'ja') => {
  const ai = translate(lang, 'ai.name.claude');
  return { ai, Ai: ai, ai2: translate(lang, 'ai.name2.claude') };
};
const gate: SavedThing[] = [{ kind: 'moved', name: 'gate' }, { kind: 'motion', name: 'gate’s motion' }];

test('what was kept, by the objects\' names', () => {
  assert.equal(savedList(gate, 2, en), 'moved gate · gate’s motion');
  assert.equal(savedList([{ kind: 'moved', name: 'gate' }, { kind: 'motion', name: 'gate の動き' }], 2, ja), 'gate を動かした · gate の動き');
});

test('more than 3: the first 3 and "N more"', () => {
  const five: SavedThing[] = ['gate', 'ship', 'ring', 'orb', 'hex'].map((name) => ({ kind: 'moved', name }));
  assert.equal(savedList(five, 5, en), 'moved gate · moved ship · moved ring · 2 more');
  assert.equal(savedList(five, 5, ja), 'gate を動かした · ship を動かした · ring を動かした · ほか 2');
});

test('changes with no name of their own are in "N more", so the count matches Save · N', () => {
  assert.equal(savedList(gate, 4, en), 'moved gate · gate’s motion · 2 more');
  assert.equal(savedList([], 3, en), '3 changes');
  assert.equal(savedList([], 1, ja), '変更 1 個');
});

test('the same words twice are said once (a motion on gate, kept in the Library under its name)', () => {
  assert.equal(savedList([...gate, { kind: 'motion', name: 'gate’s motion' }], 2, en), 'moved gate · gate’s motion');
});

test('pressed → putting it in the code → in the game; nobody there → the fact', () => {
  const r = (phase: string, lang: 'en' | 'ja' = 'en') => receipt({ phase, things: gate, total: 2, vars: vars(lang), t: lang === 'en' ? en : ja });
  assert.deepEqual(r('seen'), { head: 'Saved: moved gate · gate’s motion', sub: 'Claude is putting it in the code…' });
  assert.deepEqual(r('working', 'ja'), { head: '保存しました: gate を動かした · gate’s motion', sub: 'Claude がコードに入れています…' });
  assert.deepEqual(r('done'), { head: 'In the game (2)', sub: '', play: true });
  assert.equal(r('done', 'ja')?.head, 'ゲームに入りました（2 個）');
  assert.deepEqual(r('away'), { head: 'Saved. Claude puts it in the code when it opens', sub: 'moved gate · gate’s motion' });
  assert.equal(r('nudge', 'ja')?.head, '保存しました。Claude が開いたら、コードに入れます');
  // Not a promise while nobody is there: no "putting it in", no "in the game".
  assert.doesNotMatch(JSON.stringify(r('away')), /putting|In the game/);
  // Failed, asking, undone…: the editor's usual words.
  for (const ph of ['failed', 'asking', 'undone', 'waiting']) assert.equal(r(ph), null, ph);
});
