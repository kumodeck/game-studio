// The sample shelf's samples and their "Try" (decided 2026-11-06), without a browser:
//   - every shelf sample's starter.json has `try`: the thing to move, the second to pause at, the words to ask (en, ja);
//   - the thing to move is a name the game really gives an editable thing;
//   - the stand-in AI (test/ai-feel/fake-agent.mjs, shelfFix) answers each sample's ask with one change, and the
//     changed files still parse;
//   - Big Swell is a starter of the agreed shape: first on the shelf, no asset files, three.js from the CDN, and the
//     web demo has its Japanese line.
//
//   node --test test/shelf-try.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStarters, starterFiles } from '../src/server/starters.mjs';
import { SHELF_FIXES, shelfFix } from './ai-feel/fake-agent.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The shelf's samples that exist today (the others come with the shelf's later stages). Neon Run is still an example
// (the shelf screen lists it); its `try` lives in its own starter.json.
const SAMPLES = {
  'big-swell': 'starters/big-swell', 'lantern-cove': 'starters/lantern-cove', 'firefly-ruins': 'starters/firefly-ruins',
  'domino-spiral': 'starters/domino-spiral', 'marble-rain': 'starters/marble-rain', 'three-neon-boss': 'examples/three-neon-boss',
};
// The asks that point at a spot (`"mark": true`: the person draws a ◎ before asking; decided 2026-11-06). Every other
// sample's ask is about the whole scene and has no `mark`.
const MARKED = new Set(['marble-rain']);
const meta = (dir) => JSON.parse(readFileSync(join(PKG, dir, 'starter.json'), 'utf8'));
// The ask in a language: English in starter.json, the others in strings.json (the package keeps non-English text in
// translation files only).
const ask = (dir, lang) => (lang === 'en' ? meta(dir).try?.ask?.en : JSON.parse(readFileSync(join(PKG, dir, 'strings.json'), 'utf8'))[lang]?.try?.ask);
/** Every .js and .html file of a game, as one text (to look for a name). */
function code(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'studio-placement.js' || e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/\.(m?js|html)$/.test(e.name)) out.push(readFileSync(join(d, e.name), 'utf8'));
    }
  };
  walk(dir);
  return out.join('\n');
}
/** A copy of a sample, as `--starter` makes it (only the game's files), in a fresh folder. */
async function copyOf(dir) {
  const to = mkdtempSync(join(tmpdir(), 'studio-shelf-try-'));
  for (const f of await starterFiles(join(PKG, dir))) cpSync(join(PKG, dir, f), join(to, f));
  return to;
}

for (const [id, dir] of Object.entries(SAMPLES)) {
  test(`${id}: starter.json has the Try (move, pauseAt, ask in en; strings.json in ja)`, () => {
    const t = meta(dir).try;
    assert.ok(t && typeof t === 'object', 'no "try"');
    assert.equal(typeof t.move, 'string');
    assert.ok(Number.isFinite(t.pauseAt) && t.pauseAt > 0 && t.pauseAt < 20, `pauseAt ${t.pauseAt}`);
    for (const lang of ['en', 'ja']) assert.ok(typeof ask(dir, lang) === 'string' && ask(dir, lang).trim().length > 3, `ask in ${lang}`);
    assert.match(t.ask.en, /^[A-Z].*\.$/, 'one English sentence');
    assert.deepEqual(Object.keys(t.ask), ['en'], 'only English in starter.json');
    if (MARKED.has(id)) assert.equal(t.mark, true, 'the ask points at a spot (◎)');
    else assert.equal(t.mark, undefined, 'no ◎ for an ask about the whole scene');
    // The name of the thing to move is a name the game gives (a quoted string in its code).
    // A numbered name (Marble Rain's `pin-1-2`) is made by a template in a loop (`pin-${row}-${n}`): its stem is enough.
    const src = code(join(PKG, dir));
    const stem = /^([a-z]+)(?:-\d+)+$/.exec(t.move)?.[1];
    assert.ok(new RegExp(`['"]${t.move}['"]`).test(src) || (stem && src.includes(`\`${stem}-\${`)), `"${t.move}" is not a name in the game's code`);
  });

  test(`${id}: the stand-in AI answers its ask with one change, and the code still parses`, async () => {
    const folder = await copyOf(dir);
    try {
      assert.equal(SHELF_FIXES.filter((r) => r.is(folder)).map((r) => r.id).join(','), id, 'exactly its own row knows it');
      const before = Object.fromEntries((await starterFiles(folder)).map((f) => [f, readFileSync(join(folder, f), 'utf8')]));
      for (const lang of ['en', 'ja']) {
        // Back to the sample as shipped before the second language (each answer starts from the same code).
        if (lang === 'ja') for (const f of Object.keys(before)) cpSync(join(PKG, dir, f), join(folder, f));
        // A marked ask comes with the person's ◎ (a point in the middle of the frame, as the editor sends it).
        const marks = MARKED.has(id) ? [{ n: 1, kind: 'point', screen: [0.5, 0.3] }] : undefined;
        const r = shelfFix(folder, { lang, ask: ask(dir, lang), marks });
        assert.ok(r && r.files?.length && r.note, 'an answer');
        assert.equal(/[ぁ-んァ-ン一-龯]/.test(r.note), lang === 'ja', `the note in ${lang}: ${r.note}`);
        for (const f of r.files) {
          assert.notEqual(readFileSync(join(folder, f), 'utf8'), before[f], `${f} changed`);
          const c = spawnSync(process.execPath, ['--check', join(folder, f)], { encoding: 'utf8' });
          assert.equal(c.status, 0, `${f} parses: ${c.stderr}`);
        }
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
}

test('big-swell: the waves twice as tall = WAVE_HEIGHT 1.0 → 2.0, nothing else', async () => {
  const folder = await copyOf(SAMPLES['big-swell']);
  try {
    const was = readFileSync(join(folder, 'game.js'), 'utf8');
    assert.match(was, /const WAVE_HEIGHT = 1\.0;/);
    shelfFix(folder, { lang: 'en' });
    const now = readFileSync(join(folder, 'game.js'), 'utf8');
    assert.equal(now, was.replace('const WAVE_HEIGHT = 1.0;', 'const WAVE_HEIGHT = 2.0;'));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('any other game: shelfFix answers nothing (the paused chat reply stays)', async () => {
  const folder = await copyOf('examples/three-crates');
  try {
    assert.equal(shelfFix(folder, { lang: 'en' }), null);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('big-swell is a starter of the agreed shape, first on the shelf', async () => {
  const list = await readStarters(join(PKG, 'starters'));
  assert.equal(list[0].id, 'big-swell');
  assert.equal(list[0].dim, '3d');
  assert.equal(meta('starters/big-swell').order, 0);
  assert.ok(list[0].thumb && existsSync(list[0].thumb), 'thumb.png');
  // 640×400 (the PNG header's width and height).
  const png = readFileSync(join(PKG, 'starters/big-swell/thumb.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [640, 400]);
  // No asset files: the game's files only (pictures and sound are made by code). Neither starter.json, thumb.png,
  // README.md nor strings.json goes into a game.
  assert.deepEqual(await starterFiles(join(PKG, 'starters/big-swell')), ['game.js', 'index.html', 'studio-placement.js']);
  // three.js from the CDN, the same version as the other starters.
  const html = readFileSync(join(PKG, 'starters/big-swell/index.html'), 'utf8');
  const cove = readFileSync(join(PKG, 'starters/lantern-cove/index.html'), 'utf8');
  const three = (s) => /cdn\.jsdelivr\.net\/npm\/three@([\d.]+)\//.exec(s)?.[1];
  assert.ok(three(html), 'three from jsDelivr');
  assert.equal(three(html), three(cove));
});

test('big-swell: the phone rule (below ~45 fps → pixel ratio 1), as Lantern Cove', () => {
  const src = readFileSync(join(PKG, 'starters/big-swell/game.js'), 'utf8');
  assert.match(src, /function setQuality\(q\)/);
  assert.match(src, /setPixelRatio\(q === 'low' \? 1 :/);
  assert.match(src, /setQuality\(slowSum \/ slowN > 1 \/ 45 \? 'low' : 'high'\)/);
});

test('the newer starters keep their Japanese blurb in strings.json (not copied into the game)', async () => {
  for (const id of ['domino-spiral', 'marble-rain']) {
    const ja = JSON.parse(readFileSync(join(PKG, 'starters', id, 'strings.json'), 'utf8')).ja;
    assert.ok(typeof ja?.blurb === 'string' && /[ぁ-んァ-ン一-龯]/.test(ja.blurb), `${id}: ja.blurb`);
    assert.ok(!(await starterFiles(join(PKG, 'starters', id))).includes('strings.json'), `${id}: strings.json stays out of the game`);
  }
});

test('the web demo has a Japanese line for every starter', async () => {
  const words = readFileSync(join(PKG, 'src/hosts/browser/strings.js'), 'utf8');
  // A starter that stands for an example ("from", Neon Run) is listed by the demo under the example's id (--also).
  for (const s of await readStarters(join(PKG, 'starters'))) {
    const id = s.dir.startsWith(join(PKG, 'examples')) ? s.dir.split(/[\\/]/).pop() : s.id;
    assert.match(words, new RegExp(`'${id}': '`), id);
  }
});
