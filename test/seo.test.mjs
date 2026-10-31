// What search engines and link previews read on the web demo (2026-10-29, the SEO pass; scripts/seo.mjs,
// scripts/web-demo-lp.mjs, build-docs.mjs). No browser and no network: the docs are built into a temporary folder, the
// front page is made from its template, and the tags are read back out of the HTML.
//   - every docs page: one <title> of its own (no doubled name), its description, Open Graph, JSON-LD that parses
//   - with the site's address: canonical = the page itself, hreflang both ways (en ↔ ja, x-default = en), a breadcrumb,
//     sitemap.xml lists every page once; without it: none of those (they need a full address), nothing broken
//   - the front page: its words are in the HTML (no script needed), the Japanese page is its own, its addresses lead
//     where the English page's do
//   - the site's address is never written in the scripts: it comes from --site-url or GAME_STUDIO_SITE_URL only
//   - no page is kept out of search (2026-10-29): the build writes no robots noindex, on the editor and the samples too
//     (test/web-demo-lp.browser.mjs looks at a whole built folder); headTags still writes it when asked
//   - the product line (2026-10-29): the front page's title line, the README's first sentence and VOICE.md say the same
//     words, and nothing in the product says it turns your AI "into a game studio" any more
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildDocs } from '../scripts/build-docs.mjs';
import { appLd, headTags, normalizeSite, robotsTxt, siteUrlFrom, sitemapXml } from '../scripts/seo.mjs';
import { lpPage, readLpText } from '../scripts/web-demo-lp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://example.com/game-studio/';
const SOCIAL = {
  en: { path: 'social-en.jpg', width: 1200, height: 630, alt: 'en picture' },
  ja: { path: 'social-ja.jpg', width: 1200, height: 630, alt: 'ja picture' },
};
const root = mkdtempSync(join(tmpdir(), 'seo-'));
const withSite = buildDocs(join(root, 'site/docs'), { version: '0.0.0', repo: 'https://example.invalid/repo', home: true, site: SITE, sitePath: 'docs/', social: SOCIAL });
const noSite = buildDocs(join(root, 'plain/docs'), { version: '0.0.0', repo: null, home: true });
test.after(() => rmSync(root, { recursive: true, force: true }));

const pagesOf = (dir) => readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.html')).map((f) => ({ f, html: readFileSync(join(dir, f), 'utf8') }));
const one = (html, re, what) => {
  const all = [...html.matchAll(new RegExp(re, 'g'))];
  assert.equal(all.length, 1, `${what}: ${all.length} found`);
  return all[0][1];
};
const ldOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const alternatesOf = (html) => Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([\w-]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]));

test('every docs page: its own title and description, Open Graph, JSON-LD', () => {
  const pages = pagesOf(join(root, 'site/docs'));
  assert.equal(pages.length, withSite.pages);
  const titles = new Set();
  for (const { f, html } of pages) {
    const title = one(html, '<title>([^<]+)</title>', `${f} title`);
    assert.ok(!titles.has(title), `${f}: the title "${title}" is another page's too`);
    titles.add(title);
    // The old title said the site's name twice ("Game Studio docs · Game Studio Docs").
    assert.ok((title.match(/Game Studio|ゲームスタジオ/g) || []).length <= 1, `${f}: ${title}`);
    const desc = one(html, '<meta name="description" content="([^"]+)"', `${f} description`);
    // About what fits under a search result: 40–200 letters in English, 20–120 in Japanese (a letter says more).
    const [lo, hi] = f.startsWith('ja/') ? [20, 120] : [40, 200];
    assert.ok(desc.length >= lo && desc.length <= hi, `${f}: description of ${desc.length} characters`);
    for (const p of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image', 'og:locale', 'og:site_name']) one(html, `<meta property="${p}" content="([^"]+)"`, `${f} ${p}`);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
    const ld = ldOf(html);
    assert.equal(ld.length, 1, `${f}: JSON-LD`);
    assert.equal(ld[0]['@context'], 'https://schema.org');
    const types = ld[0]['@graph'].map((n) => n['@type']);
    assert.deepEqual(types, ['TechArticle', 'BreadcrumbList'], f);
  }
});

test('with the site address: canonical is the page itself, hreflang pairs both ways, a breadcrumb', () => {
  for (const { f, html } of pagesOf(join(root, 'site/docs'))) {
    const canonical = one(html, '<link rel="canonical" href="([^"]+)"', `${f} canonical`);
    const expect = SITE + 'docs/' + f.replace(/(^|\/)index\.html$/, '$1');
    assert.equal(canonical, expect, f);
    assert.equal(one(html, '<meta property="og:url" content="([^"]+)"', f), canonical);
    const alt = alternatesOf(html);
    assert.deepEqual(Object.keys(alt).sort(), ['en', 'ja', 'x-default'], f);
    assert.equal(alt[f.startsWith('ja/') ? 'ja' : 'en'], canonical, `${f}: hreflang of its own language is itself`);
    assert.equal(alt['x-default'], alt.en);
    // The other language's page says the same pair back.
    const other = f.startsWith('ja/') ? f.slice(3) : `ja/${f}`;
    assert.deepEqual(alternatesOf(readFileSync(join(root, 'site/docs', other), 'utf8')), alt, `${f} ↔ ${other}`);
    const crumbs = ldOf(html)[0]['@graph'][1].itemListElement;
    assert.equal(crumbs[0].item, SITE + (f.startsWith('ja/') ? 'ja/' : ''), `${f}: the breadcrumb starts at the front page`);
    assert.equal(crumbs[crumbs.length - 1].item, canonical, `${f}: the breadcrumb ends at the page`);
    assert.equal(one(html, '<meta property="og:image" content="([^"]+)"', f), SITE + `social-${f.startsWith('ja/') ? 'ja' : 'en'}.jpg`);
  }
});

test('without the site address: no canonical, hreflang, og:url or picture; the rest is there', () => {
  for (const { f, html } of pagesOf(join(root, 'plain/docs'))) {
    assert.doesNotMatch(html, /rel="canonical"|hreflang="(en|ja|x-default)" href="http|og:url|og:image|BreadcrumbList/, f);
    one(html, '<meta name="description" content="([^"]+)"', f);
    one(html, '<meta property="og:title" content="([^"]+)"', f);
    assert.match(html, /<meta name="twitter:card" content="summary"/);
    assert.equal(ldOf(html)[0]['@graph'][0]['@type'], 'TechArticle');
  }
});

test('sitemap.xml: every page once, full addresses with their other language; robots.txt points at it', () => {
  const entries = [{ path: '', alternates: { en: '', ja: 'ja/' } }, { path: 'ja/', alternates: { en: '', ja: 'ja/' } }, ...withSite.entries];
  const xml = sitemapXml(SITE, entries);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, withSite.pages + 2);
  assert.equal(new Set(locs).size, locs.length, 'no address twice');
  for (const l of locs) assert.ok(l.startsWith(SITE), l);
  assert.ok(locs.includes(SITE + 'docs/') && locs.includes(SITE + 'docs/ja/codex.html'));
  assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
  assert.throws(() => sitemapXml(null, entries), /site address/);
  assert.match(robotsTxt(SITE), /^User-agent: \*\nAllow: \/\n\nSitemap: https:\/\/example\.com\/game-studio\/sitemap\.xml\n$/m);
  assert.doesNotMatch(robotsTxt(null), /Sitemap|Disallow/);
});

test('the site address: --site-url or GAME_STUDIO_SITE_URL, http(s), ends in /', () => {
  assert.equal(siteUrlFrom(['node', 'x', '--site-url', 'https://example.com/a'], {}), 'https://example.com/a/');
  assert.equal(siteUrlFrom(['node', 'x'], { GAME_STUDIO_SITE_URL: 'https://example.com' }), 'https://example.com/');
  assert.equal(siteUrlFrom(['node', 'x'], {}), null);
  assert.throws(() => normalizeSite('example.com'), /not an address/);
  assert.throws(() => normalizeSite('ftp://example.com/'), /http or https/);
  assert.throws(() => normalizeSite('https://example.com/?a=1'), /no \?query/);
  // No address is built in: the build scripts never name where the site is published.
  for (const f of ['scripts/seo.mjs', 'scripts/build-web-demo.mjs', 'scripts/build-docs.mjs', 'scripts/web-demo-lp.mjs']) {
    assert.doesNotMatch(readFileSync(join(PKG, f), 'utf8'), /kumodeck\.app/, f);
  }
});

test('no page is kept out of search: the build writes no noindex; headTags writes it only when asked', () => {
  const build = readFileSync(join(PKG, 'scripts/build-web-demo.mjs'), 'utf8');
  assert.doesNotMatch(build, /name="robots"|noindex:\s*true/, 'build-web-demo.mjs');
  assert.doesNotMatch(readFileSync(join(PKG, 'scripts/build-docs.mjs'), 'utf8'), /name="robots"|noindex:\s*true/, 'build-docs.mjs');
  const page = { site: SITE, path: 'studio/', lang: 'en', title: 'T', description: 'D', siteName: 'S' };
  assert.doesNotMatch(headTags(page), /name="robots"/);
  assert.match(headTags({ ...page, noindex: true }), /<meta name="robots" content="noindex" \/>/);
  for (const { f, html } of pagesOf(join(root, 'site/docs'))) assert.doesNotMatch(html, /name="robots"/, f);
});

test('the product line: one sentence in the front page, the README and VOICE.md; no "into a game studio"', () => {
  const T = readLpText(join(PKG, 'src/hosts/browser/strings.js'));
  const readme = readFileSync(join(PKG, 'README.md'), 'utf8');
  const voice = readFileSync(join(PKG, 'docs/VOICE.md'), 'utf8');
  assert.equal(/^\*\*([^*]+)\*\*/m.exec(readme)?.[1], T.en.title, 'README: the first bold sentence');
  assert.equal(/\*\*The product in one line:\*\* \*([^*]+)\*/.exec(voice)?.[1], T.en.title, 'VOICE.md');
  assert.ok(readFileSync(join(PKG, 'src/hosts/browser/index.html'), 'utf8').includes(`<h1 id="title">${T.en.title}</h1>`), 'index.html: the h1 before lp.js');
  // The line said before 2026-10-29, in English and Japanese, and the Codex card's short form of it.
  const OLD = /into a game studio|ゲームスタジオに[。す]|を、ゲームスタジオ/i;
  const files = ['README.md', 'docs/VOICE.md', 'src/hosts/browser/index.html', 'src/hosts/browser/strings.js',
    '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', '.codex-plugin/plugin.json'];
  for (const f of files) assert.doesNotMatch(readFileSync(join(PKG, f), 'utf8'), OLD, f);
  for (const f of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const desc = JSON.parse(readFileSync(join(PKG, f), 'utf8')).description;
    assert.ok(desc.startsWith(T.en.title), `${f}: the description starts with the product line`);
  }
});

test('the front page: its words without a script, English and Japanese pages, the same addresses', () => {
  const T = readLpText(join(PKG, 'src/hosts/browser/strings.js'));
  const template = readFileSync(join(PKG, 'src/hosts/browser/index.html'), 'utf8');
  const install = 'Install it by following https://example.invalid/INSTALL.md';
  const first = { id: 'lantern-cove', title: 'Lantern Cove', thumb: 'thumbs/lantern-cove.png' };
  const make = (lang, dir) => lpPage(template, {
    lang, T: T[lang], install, repo: 'https://example.invalid/repo', kumodeck: 'https://example.invalid/kd', first, dir,
    head: headTags({ site: SITE, path: dir, lang, alternates: { en: '', ja: 'ja/' }, title: T[lang].pageTitle, description: T[lang].description, siteName: 'KUMODeck Game Studio', image: SOCIAL[lang],
      jsonLd: appLd({ site: SITE, path: dir, lang, name: 'KUMODeck Game Studio', description: T[lang].description, version: '0.0.0', repo: 'https://example.invalid/repo', image: SOCIAL[lang] }) }),
  });
  for (const [lang, dir] of [['en', ''], ['ja', 'ja/']]) {
    const html = make(lang, dir);
    const t = T[lang];
    // What it is, what it does, how to install: in the HTML as a search engine without scripts reads it.
    const body = html.slice(html.indexOf('<body>'));
    for (const k of ['title', 'lead', 'installLabel', 'installNote', 'f1Title', 'f1', 'f2Title', 'f2', 'f3Title', 'f3', 'engines', 'kd']) {
      assert.ok(body.includes(t[k].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')), `${lang}: ${k} in the HTML`);
    }
    assert.ok(body.includes(`<code id="cmd">${install}</code>`), `${lang}: the install line`);
    assert.equal(one(html, '<h1[^>]*>([^<]+)</h1>', 'h1'), t.title);
    assert.equal(one(html, '<title>([^<]+)</title>', 'title'), t.pageTitle);
    assert.match(html, new RegExp(`<html lang="${lang}"`));
    // Every picture says what it is (or is marked as decoration, alt="").
    for (const m of body.matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /\salt="/, `${lang}: ${m[0]}`);
    assert.match(body, /<img class="poster" id="poster" src="thumbs\/lantern-cove\.png" alt="[^"]*Lantern Cove[^"]*"/);
    const [app, site] = ldOf(html)[0]['@graph'];
    assert.equal(app['@type'], 'SoftwareApplication');
    assert.deepEqual(app.offers, { '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    assert.equal(app.url, SITE + dir);
    assert.equal(site['@type'], 'WebSite');
    assert.equal(alternatesOf(html).ja, SITE + 'ja/');
    assert.ok(!/(&amp;){2}|&amp;amp;/.test(html), `${lang}: an address escaped twice`);
    if (lang === 'ja') {
      // One folder down: <base> before any address, so the editor, docs and games.json are the English page's.
      const head = html.slice(0, html.indexOf('</head>'));
      assert.ok(head.includes('<base href="../" />') && head.indexOf('<base') < head.indexOf('<title>'), 'ja: <base> first in <head>');
      assert.match(html, /<html lang="ja" data-lang="ja">/);
      assert.match(html, /class="brand" href="ja\/"/);
      assert.match(html, /id="docs" href="docs\/ja\/"/);
      assert.match(html, /id="full" href="studio\/\?game=lantern-cove&amp;lang=ja"/);
    } else {
      assert.doesNotMatch(html, /<base|data-lang=/);
      assert.match(html, /id="full" href="studio\/\?game=lantern-cove"/);
    }
  }
});

test('the docs link to the Japanese front page at ja/, not ?lang=ja', () => {
  const ja = readFileSync(join(root, 'site/docs/ja/index.html'), 'utf8');
  assert.match(ja, /class="brand" href="\.\.\/\.\.\/ja\/"/);
});
