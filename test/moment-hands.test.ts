// This moment's values, the editor page's side (pause-edit stage 2, 2026-10-28; CONTRACT.md §1.14, §3.6): the AI's
// `--do moment.set` and `--do list`'s `moment` (shell/ai-hands.ts), the op as the CLI and the file read it
// (schema/hands.mjs, server/hands-cli.mjs), ⌘Z (undo.ts `moment-value`, dropped at Resume), the moment's list words
// (shell/moment-values.ts) and the request ✦ Have Claude make this moment editable sends (`intent: 'moment-values'`).
// The game page's side is test/moment-values.test.ts; the real editor is test/studio-pause.browser.mjs --only values.
// Run: node --experimental-strip-types --no-warnings --test test/moment-hands.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiHands, type HandsDeps } from '../src/shell/ai-hands.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { translate } from '../src/shell/i18n.ts';
import { applyHandsToFile, readHandsInput } from '../src/schema/hands.mjs';
import { handsInput } from '../src/server/hands-cli.mjs';
import { normalizeRequestInput } from '../src/schema/handoff.mjs';
import { handoffLine } from '../src/server/ai-watch.mjs';
import { momentNumber, momentOf, momentStep, unitText } from '../src/shell/moment-values.ts';
import type { MomentValue } from '../src/contract.ts';

/** A paused moment of Neon Run with its codeMoment delivered: the stand-ins act as main.ts does (one undo change). */
function moment(o: { paused?: boolean; values?: MomentValue[] | null } = {}) {
  const undo = new UndoStack();
  const lines: string[] = [];
  const calls: string[] = [];
  let paused = o.paused ?? true;
  let vals: MomentValue[] | null = o.values !== undefined ? o.values : [
    { id: 'score', name: 'Score', v: 12480, unit: '', round: 0, set: true },
    { id: 'timeLeft', name: 'Time left', v: 18.4, unit: 's', min: 0, set: true },
    { id: 'hp', name: 'Health', v: 3, unit: '', min: 0, max: 5, step: 1, set: true },
    { id: 'wave', name: 'Wave', v: null, text: 'boss', unit: '', set: false },
  ];
  const d = {
    t: (k: string, v?: Record<string, string | number>) => translate('en', k, v),
    ready: () => true,
    playing: () => true,
    moment: () => paused,
    stopPlay: async () => void calls.push('stopPlay'),
    toWorld: () => undefined,
    dim: () => '3d',
    item: () => undefined,
    label: (k: string) => k,
    keys: () => [],
    list: () => ({ objects: [], motions: [], levels: [] }),
    codeMotions: () => [],
    codePlaces: () => [],
    codeAvoids: () => [],
    lib: () => null,
    libNames: () => [],
    place: () => null,
    placeIds: () => [],
    momentValues: async () => vals && vals.map((x) => ({ ...x })),
    momentSet: async (id: string, v: number) => {
      calls.push(`set ${id} ${v}`);
      const x = vals?.find((y) => y.id === id);
      if (!x) return { ok: false, error: 'none' };
      const to = Math.max(x.min ?? -Infinity, Math.min(x.max ?? Infinity, v));
      undo.push({ changes: [{ kind: 'moment-value', key: id, from: x.v!, to }] });
      x.v = to;
      return { ok: true, v: to };
    },
    levels: { active: () => false, current: () => '', ids: () => [], label: () => '', add: async () => null, go: async () => false, rename: () => false, nameNew: () => false },
    undoBegin: () => undo.begin(),
    undoEnd: (w: string) => !!undo.end(w),
    done: (w: string, can: boolean) => void lines.push(can ? w : `${w} (no undo)`),
  } as unknown as HandsDeps;
  return { d, undo, lines, calls, resume: () => (paused = false), set: (v: MomentValue[] | null) => (vals = v) };
}

test('--do moment.set while paused: set as the knob does, one ⌘Z step, the AI\'s words with the value and its unit', async () => {
  const m = moment();
  const r = await createAiHands(m.d).run({ id: '1', by: 'claude', ops: [{ do: 'moment.set', id: 'timeLeft', v: 5 }] });
  assert.deepEqual(r.results.map((x) => [x.ok, x.said]), [[true, 'set "Time left" (timeLeft) to 5 for this moment (it was 18.4) — the game drew one frame with it; ▶ Resume goes on from there, and it is not in the scene (not counted on Save)']]);
  assert.deepEqual(m.calls, ['set timeLeft 5'], 'no stopPlay: the moment stays');
  assert.equal(m.undo.size, 1);
  assert.deepEqual(m.undo.peekUndo()?.changes, [{ kind: 'moment-value', key: 'timeLeft', from: 18.4, to: 5 }]);
  assert.deepEqual(m.lines, ['Claude set Time left to 5 s for this moment']);
  // Inside its range: the value it now has is what the AI is told.
  const hp = await createAiHands(m.d).run({ id: '2', ops: [{ do: 'moment.set', id: 'hp', v: 9 }] });
  assert.match(hp.results[0]!.said!, /^set "Health" \(hp\) to 5 for this moment \(it was 3\)/);
});

test('--do moment.set when not paused: "the game is not paused" at once — the person stays in ▶ Play', async () => {
  const m = moment({ paused: false });
  const t0 = Date.now();
  const r = await createAiHands(m.d).run({ id: '1', ops: [{ do: 'moment.set', id: 'timeLeft', v: 5 }] });
  assert.deepEqual(r.results, [{ do: 'moment.set', ok: false, error: 'the game is not paused' }]);
  assert.deepEqual(m.calls, []);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(m.undo.size, 0);
});

test('--do moment.set: an unknown id names the ids; no codeMoment says what to write; a value shown only is refused by the page', async () => {
  const m = moment();
  const hands = createAiHands(m.d);
  const r = await hands.run({ id: '1', ops: [{ do: 'moment.set', id: 'lives', v: 1 }] });
  assert.equal(r.results[0]!.error, 'the game\'s codeMoment() has no "lives" (it has: "score", "timeLeft", "hp", "wave")');
  m.set(null);
  const none = await hands.run({ id: '2', ops: [{ do: 'moment.set', id: 'score', v: 1 }] });
  assert.match(none.results[0]!.error!, /^the game has no codeMoment\(\) \(SKILL\.md "This moment"/);
  assert.equal(m.undo.size, 0);
});

test('--do list: `moment` (id, name, the value now, set) and `paused`; null when the game has none', async () => {
  const m = moment();
  const r = await createAiHands(m.d).run({ id: '1', ops: [{ do: 'list' }] });
  const l = r.results[0]!.list as { moment: unknown; paused: boolean };
  assert.equal(l.paused, true);
  assert.deepEqual(l.moment, [
    { id: 'score', name: 'Score', v: 12480, set: true },
    { id: 'timeLeft', name: 'Time left', v: 18.4, set: true, unit: 's', min: 0 },
    { id: 'hp', name: 'Health', v: 3, set: true, min: 0, max: 5, step: 1 },
    { id: 'wave', name: 'Wave', v: null, set: false, text: 'boss' },
  ]);
  m.set(null);
  const none = await createAiHands(m.d).run({ id: '2', ops: [{ do: 'list' }] });
  assert.equal((none.results[0]!.list as { moment: unknown }).moment, null);
});

test('the op as read: id and a number v (the CLI\'s --v 5 is a number); no editor open: "the game is not paused"', () => {
  const ok = readHandsInput({ do: 'moment.set', id: 'timeLeft', v: 5 });
  assert.ok(ok.ok);
  assert.deepEqual(ok.ops, [{ do: 'moment.set', id: 'timeLeft', v: 5 }]);
  assert.deepEqual(readHandsInput(handsInput({ do: 'moment.set', doFields: { id: 'timeLeft', v: '5' } })).ops, [{ do: 'moment.set', id: 'timeLeft', v: 5 }]);
  const bad = readHandsInput({ do: 'moment.set', id: '9 lives', v: 'five' });
  assert.ok(!bad.ok);
  assert.deepEqual(bad.errors, ['op (moment.set): "id" must be a value\'s id in the game\'s codeMoment({ values }) ("timeLeft": --do list gives them under "moment")', 'op (moment.set): "v" must be a number (the value for this moment: 5)']);
  assert.ok(!readHandsInput({ do: 'moment.set', id: 'hp' }).ok, 'needs v');
  const file = applyHandsToFile(null, readHandsInput({ do: 'moment.set', id: 'hp', v: 1 }).ops);
  assert.match(file.results[0]!.error, /^the game is not paused/);
});

test('⌘Z: a value back and on again; Resume takes the moment\'s values out of the history (placed things\' steps stay)', () => {
  const u = new UndoStack();
  u.push({ changes: [{ kind: 'pose', key: 'gate', from: { p: [0, 0, -12] }, to: { p: [0, 0, -8] } }] });
  u.push({ changes: [{ kind: 'moment-value', key: 'timeLeft', from: 18.4, to: 5 }] });
  u.push({ changes: [{ kind: 'moment-value', key: 'hp', from: 3, to: 1 }] });
  assert.equal(u.undo()?.changes[0]!.kind, 'moment-value');
  assert.equal(u.dropMoment(), 2);
  assert.equal(u.size, 1);
  assert.equal(u.canRedo, false);
});

test('the moment\'s list writes a value as the game shows it', () => {
  assert.equal(momentNumber(12480.6, { round: 0 }), '12481');
  assert.equal(momentNumber(18.437, {}), '18.44');
  assert.equal(momentNumber(18.437, { round: 1 }), '18.4');
  assert.equal(momentNumber(3, { step: 1 }), '3');
  assert.equal(momentStep({ round: 0 }), 1);
  assert.equal(momentStep({ step: 0.5, round: 0 }), 0.5);
  assert.equal(momentStep({}), undefined);
  assert.equal(momentOf({ max: 5, unit: '' }), ' / 5');
  assert.equal(momentOf({ max: 60, unit: 's' }), '');
  assert.equal(momentOf({ unit: '' }), '');
  assert.equal(unitText((k) => translate('ja', k), 's'), ' 秒');
  assert.equal(unitText((k) => translate('en', k), 'hp'), ' hp');
});

test('the words: "This moment", the one line with no codeMoment (no number named), ✦ and its draft — English and Japanese', () => {
  const en = (k: string) => translate('en', k, { ai: 'Claude' });
  // The Japanese words carry \u200b where a line may break (the list keeps words whole): read without them.
  const ja = (k: string) => translate('ja', k, { ai: 'Claude ' }).replace(/\u200b/g, '');
  assert.equal(en('moment.values'), 'This moment');
  assert.equal(en('moment.noValues'), 'The game’s numbers, like the score, aren’t shown here yet.');
  assert.equal(en('moment.valuesAsk'), 'Have Claude make this moment editable');
  assert.equal(ja('moment.values'), 'この瞬間');
  assert.equal(ja('moment.noValues'), 'スコアなどのゲームの数は、まだここに出ません。');
  assert.equal(ja('moment.valuesAsk'), 'Claude にこの瞬間を編集できるようにしてもらう');
  assert.equal(ja('moment.valuesDraft'), 'この瞬間を編集できるようにして');
  // No word the screen must not say (10/23–10/24: code, hook, state, snapshot).
  for (const k of ['moment.values', 'moment.noValues', 'moment.valuesAsk', 'moment.valuesDraft', 'moment.valueOnly', 'moment.valueBroken']) {
    assert.doesNotMatch(en(k), /code|hook|state|snapshot/i, k);
    assert.doesNotMatch(ja(k), /コード|口|状態|スナップショット/, k);
  }
});

test('✦ Have Claude make this moment editable: the paused request keeps `intent: "moment-values"`; the AI\'s line says what to do', () => {
  const r = normalizeRequestInput({ kind: 'play', text: 'Make this moment editable', paused: true, intent: 'moment-values' });
  assert.ok(r.ok);
  assert.equal(r.value.intent, 'moment-values');
  // Not paused, or another intent: dropped (the words still go).
  assert.equal(normalizeRequestInput({ kind: 'play', text: 'x', intent: 'moment-values' }).value.intent, undefined);
  assert.equal(normalizeRequestInput({ kind: 'play', text: 'x', paused: true, intent: 'ui-code' }).value.intent, undefined);
  const line = handoffLine({ kind: 'play', text: 'Make this moment editable', paused: true, intent: 'moment-values' }, '.studio/requests/20261028-101500-123-play-ab12.json');
  assert.equal(line, 'studio: request play .studio/requests/20261028-101500-123-play-ab12.json "Make this moment editable" (paused, chat .studio/chat/20261028-101500-123-play-ab12.json, make this moment\'s values editable: codeMoment, SKILL.md "This moment")');
});
