// Unit tests for the library's pure parts: names in code, badges, library.json.
// Run: node --experimental-strip-types --test test/library-data.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetList, candidatesFor, extractRefs, looksLikeAtlas, matchCode, typeOfPath } from '../src/tools/library/refs.ts';
import { assetsOfKey, buildRows, countBadges, filterRows, urlToPath } from '../src/tools/library/marks.ts';
import { addFile, buildLibraryJson, emptyState, pendingCount, setReplace, stateFromFile } from '../src/tools/library/result.ts';

test('extractRefs finds quoted names, CSS url() and HTML attributes, not remote or templated ones', () => {
  const js = `
    const a = 'assets/tree.png';
    loader.load("models/rock.glb?v=2", cb);
    new Audio(\`sfx/pop.mp3\`);
    const cdn = 'https://cdn.example.com/x.png';
    const d = 'data:image/png;base64,AAAA.png';
    const t = \`assets/\${name}.png\`;
    const proto = '//cdn.example.com/y.png';
  `;
  assert.deepEqual(extractRefs(js).sort(), ['assets/tree.png', 'models/rock.glb', 'sfx/pop.mp3'].sort());
  const css = `body { background: url(img/bg.webp) } .x { background-image: url( "img/a b.png" ) }`;
  assert.deepEqual(extractRefs(css).sort(), ['img/a b.png', 'img/bg.webp']);
  const html = `<img src="hero.png"><link rel="preload" href='fonts/ui.woff2'>`;
  assert.deepEqual(extractRefs(html).sort(), ['fonts/ui.woff2', 'hero.png']);
});

test('candidatesFor tries the code file folder, then the root; rejects paths above the root', () => {
  assert.deepEqual(candidatesFor('tree.png', 'src/game.js'), ['src/tree.png', 'tree.png']);
  assert.deepEqual(candidatesFor('/assets/tree.png', 'src/game.js'), ['assets/tree.png']);
  assert.deepEqual(candidatesFor('../assets/t.png?x#y', 'src/game.js'), ['assets/t.png']);
  assert.deepEqual(candidatesFor('../../t.png', 'game.js'), []);
  assert.deepEqual(candidatesFor('img/a%20b.png', 'index.html'), ['img/a b.png']);
});

test('matchCode: hits, unique file-name fallback, missing, and non-asset files', () => {
  const code = [
    { path: 'index.html', text: `<img src="assets/logo.png">` },
    { path: 'game.js', text: `const BASE='assets/'; load('tree.png'); load('assets/gone.png'); fetch('level.json'); load('dup.png')` },
  ];
  const assets = ['assets/logo.png', 'assets/tree.png', 'assets/unused.png', 'a/dup.png', 'b/dup.png'];
  const m = matchCode(code, assets, [...assets, 'level.json', 'game.js', 'index.html']);
  assert.deepEqual(m.refsInCode.get('assets/logo.png'), ['index.html']);
  assert.deepEqual(m.refsInCode.get('assets/tree.png'), ['game.js']);
  assert.equal(m.refsInCode.get('assets/unused.png'), undefined);
  // dup.png exists twice: we do not guess which one, so it is reported missing at its literal path
  assert.deepEqual(m.missing, [{ path: 'assets/gone.png', refsInCode: ['game.js'] }, { path: 'dup.png', refsInCode: ['game.js'] }]);
});

test('typeOfPath and atlas detection', () => {
  assert.equal(typeOfPath('a/B.PNG'), 'image');
  assert.equal(typeOfPath('m.glb'), 'model');
  assert.equal(typeOfPath('s.ogg'), 'sound');
  assert.equal(typeOfPath('f.woff2'), 'font');
  assert.equal(typeOfPath('x.txt'), 'other');
  assert.ok(looksLikeAtlas(JSON.stringify({ frames: {}, meta: { image: 'sheet.png' } })));
  assert.ok(!looksLikeAtlas(JSON.stringify({ level: 1 })));
  assert.ok(!looksLikeAtlas('not json'));
});

test('buildAssetList skips ignored folders, lists atlases, keeps level json out', async () => {
  const fs: Record<string, string> = {
    'index.html': `<script type="module" src="game.js"></script>`,
    'game.js': `Assets.load('assets/hero.json'); new Image().src = 'assets/bg.png'; fetch('assets/level.json')`,
    'assets/hero.json': JSON.stringify({ frames: { a: {} }, meta: { image: 'hero.png' } }),
    'assets/hero.png': 'x',
    'assets/bg.png': 'x',
    'assets/level.json': '{"n":1}',
    'assets/old.png': 'x',
    'node_modules/pkg/logo.png': 'x',
    'dist/bundle.js': `'assets/old.png'`,
  };
  const list = await buildAssetList(Object.keys(fs).map((path) => ({ path, size: fs[path].length })), async (p) => fs[p]);
  assert.deepEqual(list.files.map((f) => [f.path, f.type, f.refsInCode]), [
    ['assets/bg.png', 'image', ['game.js']],
    ['assets/hero.json', 'atlas', ['game.js']],
    // the atlas names its own image: the png is "in code" through the json
    ['assets/hero.png', 'image', ['assets/hero.json']],
    ['assets/old.png', 'image', []],
  ]);
  assert.deepEqual(list.missing, []);
});

test('urlToPath maps same-origin URLs to folder paths and drops the rest', () => {
  const base = 'http://127.0.0.1:5173/';
  assert.equal(urlToPath('http://127.0.0.1:5173/assets/tree.png?v=3', base), 'assets/tree.png');
  assert.equal(urlToPath('/assets/a%20b.png', base), 'assets/a b.png');
  assert.equal(urlToPath('https://cdn.example.com/three.js', base), null);
  assert.equal(urlToPath('data:image/png;base64,AA', base), null);
  assert.equal(urlToPath('http://h/game/assets/x.png', 'http://h/game/index.html'), 'assets/x.png');
  assert.equal(urlToPath('http://h/other/x.png', 'http://h/game/'), null);
});

const base = 'http://127.0.0.1:5173/';
function sampleRows() {
  return buildRows({
    base,
    files: [
      { path: 'assets/tree.png', size: 10, type: 'image', refsInCode: ['game.js'] },
      { path: 'assets/rock.glb', size: 20, type: 'model', refsInCode: ['game.js'] },
      { path: 'assets/win.mp3', size: 5, type: 'sound', refsInCode: ['game.js'] },
      { path: 'assets/old.png', size: 7, type: 'image', refsInCode: [] },
      { path: 'assets/dyn.png', size: 7, type: 'image', refsInCode: [] },
    ],
    missing: [{ path: 'assets/gone.png', refsInCode: ['game.js'] }],
    loads: [
      { url: base + 'assets/tree.png', how: 'image', t: 1, ok: true },
      { url: base + 'assets/rock.glb', how: 'fetch', t: 2, ok: true },
      { url: base + 'assets/dyn.png?x=1', how: 'image', t: 3, ok: true },
      { url: base + 'assets/404.ogg', how: 'audio', t: 4, ok: false },
      // The studio's own result file before the first save: a normal 404, not a missing asset.
      { url: base + 'placement.json', how: 'fetch', t: 5, ok: false },
      { url: 'https://cdn.example.com/three.module.js', how: 'script', t: 0, ok: true },
    ],
    uses: {
      'tree-01': [{ url: base + 'assets/tree.png', how: 'texture', sure: true }],
      'tree-02': [{ url: base + 'assets/tree.png', how: 'texture', sure: true }],
      rock: [{ url: base + 'assets/rock.glb', how: 'model', sure: false }],
    },
  });
}

test('buildRows gives each asset exactly one badge from the three sources', () => {
  const rows = sampleRows();
  const badge = Object.fromEntries(rows.map((r) => [r.path, r.badge]));
  assert.deepEqual(badge, {
    'assets/404.ogg': 'missing', // load failed, no file
    'assets/dyn.png': 'used', // not in code, but loaded (name built at runtime)
    'assets/gone.png': 'missing', // in code, no file
    'assets/old.png': 'unused',
    'assets/rock.glb': 'used',
    'assets/tree.png': 'used',
    'assets/win.mp3': 'codeOnly', // in code, not played this time
  });
  const tree = rows.find((r) => r.path === 'assets/tree.png')!;
  assert.deepEqual(tree.usedBy.map((u) => u.key), ['tree-01', 'tree-02']);
  assert.equal(rows.find((r) => r.path === 'assets/rock.glb')!.usedBy[0].sure, false);
  assert.deepEqual(countBadges(rows), { used: 3, codeOnly: 1, unused: 1, missing: 2 });
  assert.deepEqual(assetsOfKey(rows, 'rock').map((r) => r.path), ['assets/rock.glb']);
});

test('filterRows by type, badge and name', () => {
  const rows = sampleRows();
  assert.deepEqual(filterRows(rows, { type: 'image' }).map((r) => r.path), ['assets/dyn.png', 'assets/gone.png', 'assets/old.png', 'assets/tree.png']);
  assert.deepEqual(filterRows(rows, { badge: 'unused' }).map((r) => r.path), ['assets/old.png']);
  assert.deepEqual(filterRows(rows, { q: 'TRE' }).map((r) => r.path), ['assets/tree.png']);
  assert.equal(filterRows(rows, { type: 'all', badge: 'all', q: '' }).length, rows.length);
});

test('library.json: replace carries usedBy, added files and targets are not unused, stable order', () => {
  const rows = sampleRows();
  const s = emptyState();
  setReplace(s, 'assets/tree.png', 'assets/old.png'); // reuse an unused file
  addFile(s, 'assets/new-rock.glb', { key: 'added-1', p: [1, 0, 2], r: 0, s: 1 });
  addFile(s, 'assets/new-rock.glb'); // same file twice = one entry, place kept
  const json = buildLibraryJson(s, rows);
  assert.deepEqual(json, {
    version: 1,
    tool: 'library',
    replace: [{ from: 'assets/tree.png', to: 'assets/old.png', usedBy: ['tree-01', 'tree-02'] }],
    added: [{ file: 'assets/new-rock.glb', place: { key: 'added-1', p: [1, 0, 2], r: 0, s: 1 } }],
    unused: [], // old.png is now a replacement target
  });
  setReplace(s, 'assets/tree.png', 'assets/tree.png'); // same file = clear
  assert.deepEqual(buildLibraryJson(s, rows).unused, ['assets/old.png']);
});

test('state round-trips through the saved file and counts pending changes', () => {
  const rows = sampleRows();
  const s = emptyState();
  setReplace(s, 'assets/tree.png', 'assets/dyn.png');
  addFile(s, 'assets/x.png');
  const saved = stateFromFile(JSON.parse(JSON.stringify(buildLibraryJson(s, rows))));
  assert.equal(pendingCount(s, saved), 0);
  setReplace(s, 'assets/rock.glb', 'assets/x.glb');
  setReplace(s, 'assets/tree.png', null);
  assert.equal(pendingCount(s, saved), 2);
  assert.deepEqual(stateFromFile({ replace: [{ from: 1 }], added: 'x' }), emptyState());
  assert.deepEqual(stateFromFile(null), emptyState());
});

test('normalizeList accepts the contract shape and the early server shape', async () => {
  const { normalizeList } = await import('../src/tools/library/marks.ts');
  const contract = { files: [{ path: 'a.png', size: 1, type: 'image', refsInCode: ['g.js'] }], missing: [{ path: 'b.png', refsInCode: ['g.js'] }] };
  assert.deepEqual(normalizeList(contract), contract);
  assert.deepEqual(normalizeList({ assets: [{ path: 's.wav', size: 2, type: 'audio', refsInCode: [] }], missing: [{ ref: './x/../b.png?v=1', in: ['g.js'] }], truncated: false }), {
    files: [{ path: 's.wav', size: 2, type: 'sound', refsInCode: [] }],
    missing: [{ path: 'b.png', refsInCode: ['g.js'] }],
  });
  assert.deepEqual(normalizeList(null), { files: [], missing: [] });
});

test('buildAssetList does not read the studio result files as code', async () => {
  const fs: Record<string, string> = {
    'game.js': `load('assets/a.png')`,
    'assets/a.png': 'x',
    'assets/old.png': 'x',
    'library.json': JSON.stringify({ version: 1, tool: 'library', replace: [], added: [], unused: ['assets/old.png'] }),
  };
  const list = await buildAssetList(Object.keys(fs).map((path) => ({ path, size: 1 })), async (p) => fs[p]);
  assert.deepEqual(list.files.map((f) => [f.path, f.refsInCode]), [['assets/a.png', ['game.js']], ['assets/old.png', []]]);
});

test('the studio\'s own files are never listed as missing assets', () => {
  assert.ok(!sampleRows().some((r) => r.path === 'placement.json'));
});
