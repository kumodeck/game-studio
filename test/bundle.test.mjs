// The zero-dependency bundler: supported forms work, unsupported forms fail
// at build time with the file name (not later inside someone's game).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { bundle } from '../scripts/bundle.mjs';

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'studio-bundle-'));
  for (const [name, src] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), src);
  }
  return dir;
}

test('iife: types stripped, named/namespace/re-exports wired, entry runs once', () => {
  const dir = project({
    'main.ts': `import { add, type Num } from './lib/math.ts';\nimport * as m from './lib/math.ts';\nimport type { Other } from './lib/types.ts';\nexport { twice as double } from './lib/math.ts';\nconst n: Num = add(2, 3);\nglobalThis.out = [n, m.twice(4), m.K];`,
    'lib/math.ts': `export type Num = number;\nexport const K: number = 7;\nexport function add(a: number, b: number): number { return a + b; }\nexport function twice(a: number) { return add(a, a); }`,
    'lib/types.ts': `export interface Other { a: string }`,
  });
  const { code, files } = bundle(join(dir, 'main.ts'), { format: 'iife' });
  assert.equal(files.length, 2, 'type-only module is not bundled');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(code, ctx);
  assert.equal(JSON.stringify(ctx.out), "[5,8,7]");
});

test('esm: entry exports re-exported and node: built-ins hoisted', async () => {
  const dir = project({
    'srv.ts': `import { join } from 'node:path';\nexport function p(a: string): string { return join(a, 'b'); }\nexport * from './x.ts';`,
    'x.ts': `export const X = 1;`,
  });
  const { code } = bundle(join(dir, 'srv.ts'), { format: 'esm' });
  const out = join(dir, 'out.mjs');
  writeFileSync(out, code);
  const mod = await import(out);
  assert.equal(mod.p('a'), join('a', 'b'));
  assert.ok(code.startsWith("\nimport * as __node_0 from 'node:path';") || code.includes("import * as __node_0 from 'node:path';"));
});

for (const [name, src, re] of [
  ['bare import', `import x from 'three';`, /bare import|default import/],
  ['default export', `export default 1;`, /default export/],
  ['missing extension', `import { a } from './a';`, /explicit/],
  ['enum', `enum E { A }`, /cannot be erased/],
  ['node in browser', `import { readFileSync } from 'node:fs';`, /browser bundle/],
]) {
  test(`fails loudly: ${name}`, () => {
    const dir = project({ 'main.ts': src, 'a.ts': 'export const a = 1;' });
    assert.throws(() => bundle(join(dir, 'main.ts'), { format: 'iife' }), re);
  });
}

test('side-effect import followed by a named import', () => {
  const dir = project({
    'main.ts': `import './boot.js';\nimport { b } from './b.ts';\nglobalThis.out = [globalThis.booted, b];`,
    'boot.js': `(function () { globalThis.booted = 1; })();`,
    'b.ts': `export const b = 2;`,
  });
  const ctx = {};
  ctx.globalThis = ctx;
  vm.runInNewContext(bundle(join(dir, 'main.ts'), { format: 'iife' }).code, ctx);
  assert.equal(JSON.stringify(ctx.out), '[1,2]');
});

test('fails on import cycles', () => {
  const dir = project({ 'a.ts': `import { b } from './b.ts';\nexport const a = 1;`, 'b.ts': `import { a } from './a.ts';\nexport const b = 2;` });
  assert.throws(() => bundle(join(dir, 'a.ts'), { format: 'iife' }), /cycle/);
});
