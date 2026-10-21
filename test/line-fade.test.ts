// The AI's finished line goes by itself (src/shell/line-fade.ts, 2026-10-20: "this line is always there, it's in the way").
import test from 'node:test';
import assert from 'node:assert/strict';
import { LINE_MAX_MS, LINE_MIN_MS, lineFades, lineKey, lineStayMs } from '../src/shell/line-fade.ts';
import type { AiPhase } from '../src/shell/ai-flow.ts';

test('only the lines that just report fade; a question, a failure and "on it" stay', () => {
  for (const ph of ['done', 'undone', 'redone'] as AiPhase[]) assert.equal(lineFades(ph), true, ph);
  for (const ph of ['none', 'waiting', 'nudge', 'sent', 'seen', 'away', 'received', 'working', 'asking', 'updating', 'failed'] as AiPhase[]) {
    assert.equal(lineFades(ph), false, ph);
  }
});

test('long enough to read twice: 5 s for a short line, more for the AI\'s own sentence, never over 10 s', () => {
  assert.equal(lineStayMs(''), LINE_MIN_MS);
  assert.equal(lineStayMs('Done.'), LINE_MIN_MS);
  const mid = lineStayMs('柱を道路の真ん中に移しました（ゲームに反映済み）1 個変わりました AI の直しを戻す');
  assert.ok(mid > LINE_MIN_MS && mid < LINE_MAX_MS, String(mid));
  assert.equal(lineStayMs('x'.repeat(2000)), LINE_MAX_MS);
});

test('the same report has the same key (a poll does not bring it back); a new one, or a new Undo press, does not', () => {
  const a = lineKey('done', 1000, 'Moved the pillar');
  assert.equal(lineKey('done', 1000, 'Moved the pillar'), a);
  assert.notEqual(lineKey('done', 2000, 'Moved the pillar'), a);
  assert.notEqual(lineKey('undone', 1000, 'Moved the pillar', 1), lineKey('undone', 1000, 'Moved the pillar', 3));
});
