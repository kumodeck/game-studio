// The names a person reads in the list (src/shell/names.ts, polish pass 2026-10-16, play test stumble 8):
// no `path:` keys, no "No name", no two rows with the same name.
// Run: node --experimental-strip-types --no-warnings --test test/names.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { displayName, fileStem } from '../src/shell/names.ts';

const t = (k: string) => ({ 'noname.kind.shape': 'Unnamed shape', 'noname.kind.picture': 'Unnamed picture', 'noname.kind.object': 'Unnamed object' } as Record<string, string>)[k] ?? k;
const item = (key: string, label: string, extra: Record<string, unknown> = {}) => ({ key, label, kinds: ['object'], ...extra });

test('a named object reads as its name', () => {
  assert.equal(displayName(item('crate-4', 'crate-4'), t), 'crate-4');
  assert.equal(displayName(item('tree', 'tree'), t), 'tree');
});

test('the second object with the same name reads "tree 2", not "tree" again', () => {
  assert.equal(displayName(item('tree#2', 'tree'), t), 'tree 2');
  assert.equal(displayName(item('tree#1', 'tree'), t), 'tree');
  // A label that is not the key's base name is left as it is.
  assert.equal(displayName(item('enemy#2', 'Goblin'), t), 'Goblin');
});

test('an unnamed object is called by its picture file, else by its kind — never by its tree path', () => {
  assert.equal(displayName(item('path:6', 'sprite (no name)', { unstable: true, kinds: ['sprite'], group: 'http://127.0.0.1:5173/assets/big_rock.svg?v=2' }), t), 'big rock');
  assert.equal(displayName(item('path:8', 'path:8', { unstable: true, kinds: ['box', 'object'] }), t), 'Unnamed shape');
  assert.equal(displayName(item('path:1', 'graphics (no name)', { unstable: true, kinds: ['graphics'] }), t), 'Unnamed shape');
  assert.equal(displayName(item('path:2', 'x', { unstable: true, kinds: ['weird'] }), t), 'Unnamed object');
  for (const it of [item('path:6', 'path:6', { unstable: true, kinds: ['sprite'] })]) assert.doesNotMatch(displayName(it, t), /path:|No name/);
});

test('fileStem reads only picture and model files', () => {
  assert.equal(fileStem('assets/tree.svg'), 'tree');
  assert.equal(fileStem('shape:1234abcd:5678'), null);
  assert.equal(fileStem(undefined), null);
  assert.equal(fileStem('models/old%20boat.glb#x'), 'old boat');
});
