// The public docs (docs/site/lang/, 2026-10-22): built into static pages by scripts/build-docs.mjs as the demo site has
// them (docs/ and docs/ja/ under the front page). No browser: the pages are plain files.
//   - every page builds (front matter, pictures found), English and Japanese have the same pages
//   - no broken link or picture (scripts/check-docs-links.mjs), the links out to the front page included
//   - each page links to its other language, and the side list has every page
//   - every picture shots.json makes is used by a page in both languages, and every page's picture is in its media/
//   - the Markdown is turned into HTML with < and & escaped (a page can't put its own HTML on the site)
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildDocs, LANGS, readPages, SITE } from '../scripts/build-docs.mjs';
import { checkLinks } from '../scripts/check-docs-links.mjs';
import { render, slug } from '../scripts/docs-md.mjs';

const root = mkdtempSync(join(tmpdir(), 'docs-site-'));
// The front page's files the docs link to (the real ones come from build-web-demo.mjs).
for (const f of ['index.html', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) writeFileSync(join(root, f), '');
const built = buildDocs(join(root, 'docs'), { version: '0.0.0', repo: 'https://example.invalid/repo', home: true });
test.after(() => rmSync(root, { recursive: true, force: true }));

test('English and Japanese have the same pages, each with its front matter', () => {
  const en = readPages('en').map((p) => p.file);
  const ja = readPages('ja').map((p) => p.file);
  assert.deepEqual(ja.sort(), [...en].sort());
  assert.ok(en.length >= 10, `${en.length} pages`);
  assert.equal(built.pages, en.length * 2);
  for (const l of LANGS) for (const p of readPages(l.id)) assert.match(p.meta['written-for'], /^\d+\.\d+\.\d+$/, `${l.id}/${p.file} written-for`);
});

test('no broken link or picture', () => {
  const { pages, broken } = checkLinks(root);
  assert.equal(pages, built.pages);
  assert.deepEqual(broken, []);
});

test('each page links to its other language and lists every page', () => {
  const en = readPages('en');
  for (const p of en) {
    const name = p.file.replace(/\.md$/, '.html');
    const enHtml = readFileSync(join(root, 'docs', name), 'utf8');
    const jaHtml = readFileSync(join(root, 'docs/ja', name), 'utf8');
    assert.match(enHtml, /class="lang" href="ja\//, `${name}: English → 日本語`);
    assert.match(jaHtml, /class="lang" href="\.\.\//, `${name}: Japanese → English`);
    const side = enHtml.slice(enHtml.indexOf('class="pages"'), enHtml.indexOf('</ol>', enHtml.indexOf('class="pages"')));
    assert.equal([...side.matchAll(/<li><a href=/g)].length, en.length, `${name}: the side list`);
    assert.equal([...side.matchAll(/aria-current="page"/g)].length, 1, `${name}: the side list marks this page`);
    assert.match(jaHtml, /<html lang="ja">/);
  }
});

test('every picture from shots.json is on a page, in both languages', () => {
  const shots = JSON.parse(readFileSync(join(SITE, 'shots.json'), 'utf8'));
  for (const l of LANGS) {
    const md = readPages(l.id).map((p) => p.md).join('\n');
    for (const pic of shots.pictures) assert.ok(md.includes(`(media/${pic.as}.webp`), `${l.id}: ${pic.as}.webp is used`);
    const media = readdirSync(join(SITE, 'lang', l.id, 'media'));
    for (const m of md.matchAll(/\]\(media\/([\w.-]+)/g)) assert.ok(media.includes(m[1]), `lang/${l.id}/media/${m[1]} exists`);
  }
});

test('Markdown: escaped text, headings, links, keys, tables', () => {
  const { html, headings, meta } = render('---\ntitle: T\n---\n# A\n\n## The editor’s link\n\nx <script>alert(1)</script> & <kbd>⌘</kbd> [p](p.md#a) `<b>`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', {
    link: (h) => h.replace(/\.md/, '.html'),
  });
  assert.equal(meta.title, 'T');
  assert.ok(!html.includes('<script>'), html);
  assert.ok(html.includes('&lt;script&gt;') && html.includes('&amp;') && html.includes('<kbd>⌘</kbd>'));
  assert.ok(html.includes('<a href="p.html#a">p</a>') && html.includes('<code>&lt;b&gt;</code>'));
  assert.ok(html.includes('<td>1</td>'));
  assert.deepEqual(headings, [{ level: 2, text: 'The editor’s link', id: 'the-editors-link' }]);
  assert.equal(slug('No World | UI switch?'), 'no-world--ui-switch');
  assert.equal(slug('レベルが出ないとき'), 'レベルが出ないとき');
});
