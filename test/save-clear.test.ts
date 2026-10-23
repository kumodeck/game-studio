// The two asks of a try of v0.1.8 (2026-10-21), without a browser:
//   ① the AI line ends with "More in Claude" / "More in Codex" / "More in your AI" when the AI did or said something
//      (ai-flow.ts moreIn; which AI: src/server/which-ai.mjs);
//   ② Save says where the change goes. First on the button ("Save to game · 3"); since a try of v0.1.9 ("'Save to
//      game' — I don't get what that means", 2026-10-21) the button says "Save" and the tooltip says it in one sentence
//      (i18n.ts; the web demo says what its own Save does). Play's "not in the game yet" became a strip, then Play's own window ("Save and play / Try without saving"): unsaved-guard.test.ts.
// The screen test (and its photos) is test/save-clear-shots.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moreIn, type AiPhase } from '../src/shell/ai-flow.ts';
import { setExtraText, translate } from '../src/shell/i18n.ts';
import { DEMO_TEXT } from '../src/hosts/browser/text.ts';
import { agentFromEnv, whichAi } from '../src/server/which-ai.mjs';

test('① the words follow the AI: Claude, Codex, or "your AI" when the editor cannot tell', () => {
  assert.equal(translate('en', moreIn('done', 'claude', false)!), 'More in Claude');
  assert.equal(translate('en', moreIn('done', 'codex', false)!), 'More in Codex');
  assert.equal(translate('en', moreIn('done', undefined, false)!), 'More in your AI');
  assert.equal(translate('ja', moreIn('done', 'claude', false)!), '詳しくは Claude で');
  assert.equal(translate('ja', moreIn('failed', 'codex', false)!), '詳しくは Codex で');
  assert.equal(translate('ja', moreIn('asking', undefined, false)!), '詳しくはお使いの AI で');
});

test('① only when the AI did or said something, never in the web demo', () => {
  const all: AiPhase[] = ['none', 'waiting', 'nudge', 'sent', 'seen', 'away', 'received', 'working', 'asking', 'updating', 'done', 'failed', 'undone', 'redone'];
  assert.deepEqual(all.filter((p) => moreIn(p, 'claude', false)), ['asking', 'done', 'failed']);
  for (const p of all) assert.equal(moreIn(p, 'claude', true), null, `${p}: offline host`);
});

test('① short enough for one line on a phone', () => {
  for (const lang of ['en', 'ja'] as const) for (const k of ['ai.more.claude', 'ai.more.codex', 'ai.more.any']) {
    assert.ok([...translate(lang, k)].length <= 16, `${lang} ${k}: ${translate(lang, k)}`);
  }
});

test('① which AI: the wake hook says Claude; else the environment the editor was started in', () => {
  assert.equal(agentFromEnv({ CLAUDECODE: '1' }), 'claude');
  assert.equal(agentFromEnv({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }), 'claude');
  assert.equal(agentFromEnv({ CODEX_SANDBOX: 'seatbelt' }), 'codex');
  assert.equal(agentFromEnv({ CODEX_THREAD_ID: 'abc' }), 'codex');
  assert.equal(agentFromEnv({ CODEX_HOME: '~/.codex' }), undefined, 'CODEX_HOME is a profile setting');
  assert.equal(agentFromEnv({ CLAUDECODE: '1', CODEX_SANDBOX: 'seatbelt' }), 'claude');
  assert.equal(agentFromEnv({ PATH: '/usr/bin' }), undefined);
  assert.equal(whichAi({ wake: true, env: 'codex' }), 'claude');
  assert.equal(whichAi({ wake: false, env: 'codex' }), 'codex');
  assert.equal(whichAi({ wake: false, env: undefined }), undefined);
});

test('② Save says where the change goes, in one sentence', () => {
  assert.equal(translate('en', 'btn.save'), 'Save');
  assert.equal(translate('ja', 'btn.save'), '保存');
  // studio-words-plan (2026-10-23; glossary rule 7): no anxious parenthesis — "(the game outside the editor changes too)" went.
  assert.equal(translate('ja', 'save.unsavedTip'), '保存すると、あなたの AI がゲームのコードに入れます');
  assert.equal(translate('en', 'save.unsavedTip'), 'Save, and your AI puts it in the game’s code');
  // One sentence: one full stop at most (ja: none inside the parentheses either).
  assert.ok((translate('ja', 'save.unsavedTip').match(/。/g) || []).length <= 1);
  assert.ok(!/\. /.test(translate('en', 'save.unsavedTip')));
  // The confirm box before a loss (unsaved-guard.ts, 10/21) keeps its words.
  assert.equal(translate('en', 'guard.title', { n: 3 }), 'You have 3 unsaved changes');
  assert.equal(translate('ja', 'guard.save'), '保存して続ける');
});

// Last in the file: setExtraText cannot be undone, and the tests above read the editor's own words.
test('② the web demo: the same "Save", and a tooltip with no AI or game in it', () => {
  for (const lang of ['en', 'ja'] as const) setExtraText(lang, DEMO_TEXT[lang]);
  assert.equal(translate('en', 'btn.save'), 'Save');
  assert.equal(translate('ja', 'btn.save'), '保存');
  assert.doesNotMatch(translate('en', 'save.unsavedTip'), /AI|game/);
  assert.doesNotMatch(translate('ja', 'save.unsavedTip'), /AI|ゲーム/);
  // ▶ Play's window (unsaved-guard.ts kind 'play') has no second line since plan step 6: nothing about an AI to say.
});
