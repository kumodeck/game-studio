// The web demo's front page as built (2026-10-29, the SEO pass): src/hosts/browser/index.html with its words already
// in the HTML, one page per language — index.html (English) and ja/index.html (Japanese).
//
// WHY the words in the HTML: the page used to be empty headings that lp.js filled in. A search engine that doesn't run
// scripts (and a link preview, and a reader with scripts off) saw only the title line. Now the build writes the same
// words lp.js would (strings.js, the one place they live), and lp.js still sets them, so nothing changes on screen.
// WHY a page for Japanese (ja/) and not only ?lang=ja: a search engine lists each language at its own address
// (hreflang); ?lang=ja was the English file turned Japanese by a script, so it had no Japanese of its own to list.
// ja/index.html is the same file one folder down: <base href="../"> keeps every relative address (the editor, the
// docs, games.json) pointing where the English page's do, and data-lang="ja" tells lp.js to stay in Japanese.
// ?lang=ja on the English page still works as before (the editor's and older links use it).
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/** strings.js's words ({ en, ja }), read the way the page reads them (it sets window.DEMO_LIST_TEXT). */
export function readLpText(file) {
  const sandbox = { window: {} };
  runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: file });
  const text = sandbox.window.DEMO_LIST_TEXT;
  if (!text?.en || !text?.ja) throw new Error(`${file}: no DEMO_LIST_TEXT.en / .ja`);
  return text;
}

/** The ids lp.js fills, and the key in strings.js each one takes (the same list as lp.js's). */
const FILL = {
  brand: 'brand', title: 'title', lead: 'lead', installLabel: 'installLabel', installNote: 'installNote', tryTitle: 'tryTitle',
  tryLead: 'tryLead', phoneNote: 'phoneNote', loading: 'loading', full: 'full', line: 'line', f1Title: 'f1Title', f1: 'f1',
  f2Title: 'f2Title', f2: 'f2', f3Title: 'f3Title', f3: 'f3', engines: 'engines', kdTitle: 'kdTitle', kd: 'kd', kdLink: 'kdLink',
  foot: 'foot', license: 'license', gh: 'github', docs: 'docs', repo: 'repoLink', copy: 'copy', open: 'open',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The front page for one language.
 * template: src/hosts/browser/index.html. lang: 'en' / 'ja'. T: strings.js's words for it.
 * install: the one install line. repo, kumodeck: addresses (repo may be null). first: the first sample
 * ({ id, title, thumb }), shown before the editor loads. head: the tags from scripts/seo.mjs headTags().
 * dir: where the page is from the site's root ('' or 'ja/').
 */
export function lpPage(template, { lang, T, install, repo, kumodeck, first, head, dir = '' }) {
  let html = template;
  const must = (re, to, what) => {
    if (!re.test(html)) throw new Error(`src/hosts/browser/index.html: no ${what}: update scripts/web-demo-lp.mjs`);
    html = html.replace(re, to);
  };
  must(/<html lang="en">/, `<html lang="${lang}"${dir ? ` data-lang="${lang}"` : ''}>`, '<html lang="en">');
  must(/<title>[^<]*<\/title>/, `<title>${esc(T.pageTitle)}</title>`, '<title>');
  // <base> before any address in <head> (the icons the build adds, the stylesheet); a page one folder down only.
  const base = dir ? `\n  <base href="${'../'.repeat(dir.split('/').length - 1)}" />` : '';
  must(/(<meta name="viewport"[^>]*>)/, `$1${base}`, 'viewport meta');
  must(/<\/title>/, (m) => `${m}\n${head}`, '</title>');
  // The words: an element with that id and no tags inside gets the text (the h1 has the English line already).
  for (const [id, key] of Object.entries(FILL)) {
    if (T[key] == null) throw new Error(`strings.js ${lang}: no "${key}"`);
    must(new RegExp(`(<(\\w+)\\b[^>]*\\sid="${id}"[^>]*>)[^<]*(</\\2>)`), `$1${esc(T[key]).replace(/\$/g, '$$$$')}$3`, `#${id}`);
  }
  if (install) must(/(<code id="cmd">)(<\/code>)/, `$1${esc(install).replace(/\$/g, '$$$$')}$2`, '#cmd');
  // Addresses lp.js sets from games.json, written here too (the same values: build-web-demo.mjs writes both).
  const setHref = (id, href) => must(new RegExp(`(\\sid="${id}")`), `$1 href="${esc(href)}"`, `#${id}`);
  if (repo) {
    setHref('gh', repo);
    setHref('repo', repo);
    setHref('license', `${repo}/blob/main/LICENSE`);
  }
  if (kumodeck) setHref('kdLink', kumodeck);
  const editor = first ? `studio/?game=${encodeURIComponent(first.id)}${lang === 'en' ? '' : `&lang=${lang}`}` : null;
  if (editor) {
    setHref('open', editor);
    setHref('full', editor);
  }
  if (dir) {
    // This language's own pages: the brand goes back to this page, Docs to this language's docs.
    must(/(class="brand" href=")\.\/(")/, `$1${dir}$2`, 'the brand link');
    must(/(id="docs" href=")docs\/(")/, `$1docs/${dir}$2`, 'the docs link');
  }
  // The picture under the editor until it loads: the first sample's, named (lp.js names the next one the same way).
  if (first?.thumb) must(/<img class="poster" id="poster" alt="" \/>/, `<img class="poster" id="poster" src="${esc(first.thumb)}" alt="${esc(T.posterAlt.replace('{title}', first.title))}" />`, 'the poster');
  return html;
}
