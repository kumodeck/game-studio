// One thing, one word (studio-words-plan, 2026-10-23). A hands-on look found the motion and level words hard to read, and
// the same thing called 2 to 7 ways (World / Scene, Copy / Duplicate, Undo three ways, "Ask AI" / "Ask your AI" / "Ask
// Claude"). The word list (its "retired words" table) was checked with Gemini on 10-23, and Gemini's words went first.
//
// What this keeps from coming back:
//   - the words the word list retired (World, Auto key, Tracks, cue, "Ask AI", "Copy of"… and their Japanese) in any string a
//     person sees — the shell's tables (en / ja), the Library's, and the game page's (handles.ts, timeline-path.ts).
//     The ⌘K search words (`*.words`) keep old words on purpose: someone may still type "motion" in Japanese, or "stage".
//   - "key" for the timeline's mark: it is a point now, in both languages; "key" stays only for keyboard keys.
//   - an English key without its Japanese (or the other way).
//   - the ask field's words from more than one key, and the AI called anything but its own name.
// Run: node --experimental-strip-types --no-warnings --test test/words-plan.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setAiName, translate } from '../src/shell/i18n.ts';
import { t as libT, type StringKey } from '../src/tools/library/strings.ts';
import { OFF_LINES, HANDLE_LABELS, READOUT_WORDS } from '../src/bridge/handles.ts';
import type { Lang } from '../src/contract.ts';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const I18N = src('../src/shell/i18n.ts');
const LIB = src('../src/tools/library/strings.ts');
const keysIn = (part: string) => [...part.matchAll(/^\s*'?([\w.-]+)'?: ['"`]/gm)].map((m) => m[1]!);
const enKeys = keysIn(I18N.slice(I18N.indexOf('const en = {'), I18N.indexOf('type Key')));
const jaKeys = keysIn(I18N.slice(I18N.indexOf('const ja:'), I18N.indexOf('const TABLES')));
const libEn = keysIn(LIB.slice(LIB.indexOf('const en = {'), LIB.indexOf('export type StringKey')));
const libJa = keysIn(LIB.slice(LIB.indexOf('const ja:'), LIB.indexOf('export function t(')));
// The ⌘K list's search words: old words stay there so a person typing them still finds the action.
const isSearchWords = (k: string) => /(\.words|Words)$/.test(k);

/** Every string a person can see, per language: [where, text]. */
function shown(lang: Lang): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const k of enKeys) if (!isSearchWords(k)) out.push([k, translate(lang, k, { name: 'gate', n: 2, from: 'gate', text: 'x' })]);
  for (const k of libEn) out.push([`library:${k}`, libT(lang, k as StringKey, { n: 2 })]);
  for (const [kind, row] of Object.entries(OFF_LINES[lang])) for (const [h, line] of Object.entries(row)) out.push([`OFF_LINES.${kind}.${h}`, line]);
  for (const [h, line] of Object.entries(HANDLE_LABELS[lang])) out.push([`HANDLE_LABELS.${h}`, line]);
  for (const [h, line] of Object.entries(READOUT_WORDS[lang])) out.push([`READOUT_WORDS.${h}`, line]);
  return out;
}

// The word list's retired words, as of 2026-10-23. The Japanese word for "signal" is NOT here: Gemini kept it as plain
// Japanese — the maker's word was the English "cue".
const JA_RETIRED = ['場面', 'ワールド', 'オブジェクト', '写す', '床に落とす', '取り消し', '自動キー', 'キーフレーム', 'ほかにも',
  '繰り返し', '表示する行', 'ステージ', 'モーション', '保存してゲームへ', '（エディタの外のゲームも変わります）', 'コードで描いた形',
  'まだどの物にも付いていません', '動き出し方', '配置に入れる'];
const EN_RETIRED: RegExp[] = [/\bplacement\b/i, /\badapter\b/i, /\bclips?\b/i, /\bRows\b/, /\bTracks\b/, /\bcues?\b/i, /Auto key/i,
  /Held still/, /Make movable/, /Drop to floor/, /On Game Start/, /On Tap \/ Click/, /When Near/, /After Delay/, /On Key Press/,
  /After Previous Move/, /On Collision/, /On Signal/, /Set Up/, /\bAsk AI\b/, /Ask my AI/, /Drawn in code/, /Not on anything yet/,
  /thing changed/, /Copy of/, /keyframe/i, /Put in layout/];
// Words handed to the AI as they are (the person copies or sends them): the adapter is the AI's word.
const TO_THE_AI = new Set(['status.noAdapterHint', 'status.adapterError']);

test('no retired word in any string a person sees (ja)', () => {
  const bad = shown('ja').filter(([, s]) => JA_RETIRED.some((w) => s.includes(w)));
  assert.deepEqual(bad, [], 'retired words (the word list)');
});

test('no retired word in any string a person sees (en)', () => {
  const bad = shown('en').filter(([k, s]) => !TO_THE_AI.has(k) && EN_RETIRED.some((r) => r.test(s)));
  assert.deepEqual(bad, [], 'retired words (the word list)');
});

// "Key" means the keyboard's key only; the timeline's mark is a point (the word list; Gemini: "keyframe" is a high bar,
// and "When key pressed" already used "key" for the keyboard, in both languages).
// offset.keyTip (studio-offsets): "key 1" — the four choices under a rule drag are chosen with the keyboard's 1–4.
const KEYBOARD = new Set(['tl.sel.deleteTip', 'tl.when.keyPress', 'tl.when.keyTip', 'tl.when.short.key', 'tl.when.key', 'offset.keyTip']);
test('“key” / キー is only ever a keyboard key', () => {
  for (const lang of ['en', 'ja'] as Lang[]) {
    const bad = shown(lang).filter(([k, s]) => !k.startsWith('keys.') && !KEYBOARD.has(k) && !k.startsWith('library:ex')
      && (lang === 'ja' ? /キー(?!ボード)/.test(s) : /\bkeys?\b/i.test(s.replace(/\{\w+\}/g, ''))));
    assert.deepEqual(bad, [], `${lang}: the timeline's mark is a point`);
  }
});

test('every English string has its Japanese, and no Japanese key is left without English', () => {
  const ja = new Set(jaKeys);
  // The two language names are the same in both tables on purpose (each in its own language), and a search-word list.
  const same = new Set(['ui.lang.ja', 'ui.lang.en', 'pal.libraryUseWords']);
  assert.deepEqual(enKeys.filter((k) => !ja.has(k) && !same.has(k)), [], 'English keys with no Japanese');
  const en = new Set(enKeys);
  assert.deepEqual(jaKeys.filter((k) => !en.has(k)), [], 'Japanese keys with no English');
  const lja = new Set(libJa);
  // Sizes are numbers with a unit the same in both.
  assert.deepEqual(libEn.filter((k) => !lja.has(k) && !['bytes', 'kb', 'mb'].includes(k)), [], 'Library: English keys with no Japanese');
});

test('the ask field says one thing, from one key, whatever is picked and whether the AI is there', () => {
  for (const gone of ['ask.gameAi', 'ask.gameKept', 'ask.chipOne', 'ask.chipMany']) assert.ok(!enKeys.includes(gone), `${gone} is back`);
  const panel = src('../src/shell/placement-panel.ts');
  assert.doesNotMatch(panel, /'ask\.chip(One|Many)'/, 'the placeholder uses another key when something is picked');
  const main = src('../src/shell/main.ts');
  const at = main.indexOf('askGame: () =>');
  assert.ok(at > 0, 'main.ts askGame moved: update this test');
  assert.match(main.slice(at, main.indexOf('\n', at)), /t\('ask\.game'/);
});

test('the AI is called by its own name everywhere: Claude / Codex, else your AI', () => {
  try {
    setAiName('claude');
    assert.equal(translate('en', 'ask.game'), 'Ask Claude…');
    assert.equal(translate('ja', 'ask.game'), 'Claude に頼む…');
    assert.equal(translate('en', 'tl.ask'), 'Ask Claude');
    assert.equal(translate('en', 'tl.when.aiHead'), 'Ask Claude to set up');
    assert.equal(translate('en', 'ai.working'), 'Claude is working on it…');
    assert.equal(translate('ja', 'ctx.askObject', { name: 'gate' }), 'gate を変えるよう Claude に頼む…');
    setAiName('codex');
    assert.equal(translate('en', 'pal.ask'), 'Ask Codex');
    setAiName('any');
    assert.equal(translate('en', 'ask.game'), 'Ask your AI…');
    assert.equal(translate('ja', 'ask.game'), 'あなたの AI に頼む…');
    // A caller's own vars still win (main.ts aiVars()).
    assert.equal(translate('en', 'ask.game', { ai: 'Codex' }), 'Ask Codex…');
  } finally {
    setAiName('any');
  }
  // No Japanese "ask the AI" without the name (and no "Ask AI" in English, above). Short tags like (AI) are not a way to ask.
  const bad = shown('ja').filter(([, s]) => /(^|[^I] )AI に頼/.test(s) && !s.includes('あなたの AI'));
  assert.deepEqual(bad.filter(([k]) => !k.startsWith('library:') && !k.startsWith('OFF_LINES')), []);
});

test('“When does it move?” in English is short sentences (Gemini 1023c), Japanese as it was', () => {
  const en = Object.fromEntries(['start', 'click', 'enter', 'key', 'time', 'after'].map((k) => [k, translate('en', `tl.when.${k}`)]));
  assert.deepEqual(en, { start: 'When game starts', click: 'When tapped', enter: 'When player gets near', key: 'When key pressed', time: 'After delay', after: 'After last motion' });
  assert.equal(translate('ja', 'tl.when.start'), 'ゲームが始まったら');
  assert.equal(translate('ja', 'tl.when.cueNow'), '合図を受け取ったら（AI）');
});

test('a new motion is named after its object, in the page’s language', () => {
  assert.equal(translate('ja', 'motion.firstName', { name: '船' }), '船 の動き');
  assert.equal(translate('en', 'motion.firstName', { name: 'ship' }), 'ship’s motion');
  const wire = src('../src/shell/timeline-wire.ts');
  assert.doesNotMatch(wire, /free\('Motion'\)/, 'a new motion is called "Motion" again');
});

test('the pause words: Save new position / Revert (Gemini 1023c), not Undo’s word', () => {
  assert.equal(translate('ja', 'play.toLayout'), '新しい位置を保存');
  assert.equal(translate('ja', 'play.putBack'), '元の位置に戻す');
  assert.equal(translate('en', 'play.putBack'), 'Revert');
  assert.notEqual(translate('ja', 'play.putBack'), translate('ja', 'btn.undo'));
});
