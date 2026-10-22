// The adapter self-check's second look (polish-1022, 2026-10-22; src/bridge/selfcheck.ts worthASecondLook): a check
// that moved the sample and read it back undone is run once more before the editor says anything; "no adapter",
// "no objects" or bad keys are told at once.
// Run: node --experimental-strip-types --no-warnings --test test/selfcheck-second-look.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SECOND_LOOK_MS, worthASecondLook } from '../src/bridge/selfcheck.ts';
import type { SelfCheckResult } from '../src/contract.ts';

const res = (failed: string[]): SelfCheckResult => ({
  ok: failed.length === 0,
  kind: 'three',
  checks: ['adapter-found', 'has-objects', 'keys-valid', 'pose-roundtrip', 'screen-changes', 'anchor-follows', 'restored']
    .map((id) => ({ id, ok: !failed.includes(id) })) as SelfCheckResult['checks'],
});

test('a second look only for the checks that move the sample', () => {
  assert.equal(worthASecondLook(res([])), false, 'all ok: nothing to look at again');
  assert.equal(worthASecondLook(res(['screen-changes'])), true, 'the docs photo case: the picture did not change');
  assert.equal(worthASecondLook(res(['pose-roundtrip'])), true, 'the slowed-CPU case: the move read back undone');
  assert.equal(worthASecondLook(res(['pose-roundtrip', 'screen-changes', 'anchor-follows'])), true);
  assert.equal(worthASecondLook(res(['has-objects'])), false, 'no objects: waiting changes nothing');
  assert.equal(worthASecondLook(res(['keys-valid', 'screen-changes'])), false, 'bad keys are told at once');
  assert.equal(worthASecondLook({ ok: false, kind: null, checks: [{ id: 'adapter-found', ok: false }] } as SelfCheckResult), false);
  assert.ok(SECOND_LOOK_MS >= 500 && SECOND_LOOK_MS <= 3000);
});
