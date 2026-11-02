// pause-ask stage 2 (2026-11-02; src/adapters/three/code-from.js): the game's code line that first added an object,
// read from the stack boot.js keeps — the request's `objects[].from`, a hint for the AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeFromObject, codeFromStack } from '../src/adapters/three/code-from.js';

const O = 'http://localhost:5173';

test('Chrome: the first line that is the game\'s — not Game Studio, not three.js, not a package', () => {
  const stack = [
    'Error: studio:add',
    `    at Object3D.add (${O}/__studio/studio-edit.js:120:9)`,
    `    at Scene.add (${O}/node_modules/.vite/deps/three.js?v=1a2b:7710:12)`,
    `    at spawnBoss (${O}/src/boss.js?t=1730000000:42:13)`,
    `    at update (${O}/src/main.js:88:5)`,
  ].join('\n');
  assert.deepEqual(codeFromStack(stack, O), { file: 'src/boss.js', line: 42 });
});

test('Safari / Firefox form, a local three.module.js, a CDN', () => {
  const ff = [`add@${O}/lib/three.module.js:7710:12`, `makeEnemy@${O}/game/enemy%20one.js:17:3`].join('\n');
  assert.deepEqual(codeFromStack(ff, O), { file: 'game/enemy one.js', line: 17 });
  const cdn = [`    at Scene.add (https://cdn.jsdelivr.net/npm/three/build/three.module.js:7710:12)`, `    at ${O}/main.js:5:1`].join('\n');
  assert.deepEqual(codeFromStack(cdn, O), { file: 'main.js', line: 5 }, 'another origin is never the game\'s');
});

test('nothing of the game\'s: null (the AI searches by the key, as before)', () => {
  assert.equal(codeFromStack(`Error\n    at x (${O}/__studio/studio-edit.js:1:1)`, O), null);
  assert.equal(codeFromStack('', O), null);
  assert.equal(codeFromStack(`    at x (${O}/.studio/tools.js:3:1)`, O), null, 'a hidden folder is not a game file');
});

test('a mesh inside the group the game added: its parent\'s place', () => {
  const group = { parent: null };
  const mesh = { parent: group };
  const added = new WeakMap([[group, { stack: `Error\n    at spawn (${O}/src/boss.js:42:3)` }]]);
  assert.deepEqual(codeFromObject(mesh, added, O), { file: 'src/boss.js', line: 42 });
  assert.equal(codeFromObject({ parent: null }, added, O), null);
});
