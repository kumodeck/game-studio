// What search engines and link previews read on the web demo's pages (2026-10-29, the SEO pass: "be found in search").
// build-web-demo.mjs and build-docs.mjs use it; nothing here touches the editor.
//
//   headTags(…)    <meta> / <link> / JSON-LD for one page: description, canonical, hreflang, Open Graph, the X card
//   sitemapXml(…)  sitemap.xml: every page that should be found, each with its other language
//   robotsTxt(…)   robots.txt: everything open, and where the sitemap is
//   siteUrlFrom(…) the site's public address, from --site-url or GAME_STUDIO_SITE_URL
//
// WHY the address is an argument and never written here: the same folder is published wherever KUMODeck hosting puts
// it, and where that is changes (a test address today, maybe a path on another site later). Built without one, every
// page still works: the tags that need a full address (canonical, hreflang, og:url, og:image) and sitemap.xml are
// left out (search engines want them absolute; a relative one is worse than none), and the build says so in one line.
// WHY no FAQPage: the FAQ page's headings are topics ("Node.js", "The demo"), not questions, and structured data must
// say what the page shows. WHY no rating in SoftwareApplication: there are none, and made-up ones are against the
// rules of every search engine. Without one Google shows no rich result for an app, but still reads the rest.

/** The site's address from `--site-url <url>` in argv, else the GAME_STUDIO_SITE_URL environment variable, else null. */
export function siteUrlFrom(argv = process.argv, env = process.env) {
  const i = argv.indexOf('--site-url');
  const raw = i >= 0 ? argv[i + 1] : env.GAME_STUDIO_SITE_URL;
  return raw ? normalizeSite(raw) : null;
}

/** An http(s) address with no query or hash, ending in "/" (pages are joined onto it). Throws on anything else. */
export function normalizeSite(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`--site-url ${raw}: not an address (like https://example.com/game-studio/)`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`--site-url ${raw}: http or https only`);
  if (u.search || u.hash) throw new Error(`--site-url ${raw}: no ?query or #hash`);
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.href;
}

/** A page's full address: `path` is relative to the site's root ('' = the front page, 'docs/ja/play.html'). */
export const pageUrl = (site, path) => (site ? new URL(path, site).href : null);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Open Graph's locale for a language id (en is US English: the docs are written in it, VOICE.md). */
const OG_LOCALE = { en: 'en_US', ja: 'ja_JP' };

/**
 * The <head> tags of one page, as lines indented by two spaces.
 * - site: the site's address or null. path: the page, relative to the site's root.
 * - lang: 'en' / 'ja'. alternates: { en: path, ja: path } of the same page in each language (this one included);
 *   the first language is also x-default (English first, the brief).
 * - title, description: the page's own. siteName: Open Graph's site name. type: 'website' or 'article'.
 * - image: { path, width, height, alt } of the link-preview picture (relative to the site's root), or null.
 * - jsonLd: an object (or a list) for <script type="application/ld+json">, or null.
 * - noindex: true for a page that should not be found on its own. No page passes it today (2026-10-29): every page
 *   of the web demo can be found, as on the published demo. Kept for the day that changes (the editor, the samples).
 */
export function headTags({ site, path, lang, alternates = null, title, description, siteName, type = 'website', image = null, jsonLd = null, noindex = false }) {
  const out = [];
  if (description) out.push(`<meta name="description" content="${esc(description)}" />`);
  if (noindex) out.push('<meta name="robots" content="noindex" />');
  const url = pageUrl(site, path);
  if (url && !noindex) {
    out.push(`<link rel="canonical" href="${esc(url)}" />`);
    if (alternates) {
      const langs = Object.keys(alternates);
      for (const l of langs) out.push(`<link rel="alternate" hreflang="${l}" href="${esc(pageUrl(site, alternates[l]))}" />`);
      out.push(`<link rel="alternate" hreflang="x-default" href="${esc(pageUrl(site, alternates[langs[0]]))}" />`);
    }
  }
  if (!noindex) {
    const img = image && site ? { ...image, url: pageUrl(site, image.path) } : null;
    out.push(`<meta property="og:type" content="${type}" />`);
    out.push(`<meta property="og:site_name" content="${esc(siteName)}" />`);
    out.push(`<meta property="og:title" content="${esc(title)}" />`);
    if (description) out.push(`<meta property="og:description" content="${esc(description)}" />`);
    if (url) out.push(`<meta property="og:url" content="${esc(url)}" />`);
    out.push(`<meta property="og:locale" content="${OG_LOCALE[lang] || lang}" />`);
    for (const l of Object.keys(alternates || {})) if (l !== lang) out.push(`<meta property="og:locale:alternate" content="${OG_LOCALE[l] || l}" />`);
    if (img) {
      out.push(`<meta property="og:image" content="${esc(img.url)}" />`);
      if (img.width) out.push(`<meta property="og:image:width" content="${img.width}" />`, `<meta property="og:image:height" content="${img.height}" />`);
      if (img.alt) out.push(`<meta property="og:image:alt" content="${esc(img.alt)}" />`);
    }
    // X reads og:title / og:description / og:image itself; it only needs to be told the card's size.
    out.push(`<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}" />`);
  }
  if (jsonLd) out.push(jsonLdScript(jsonLd));
  return out.map((l) => `  ${l}`).join('\n');
}

/** JSON-LD in a <script>: "<" is written \u003c so no text in it can close the script early. */
export function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** KUMODeck's own site (the front page's "About KUMODeck" and the README's "Sign in with KUMODeck" go there too). */
export const KUMODECK = 'https://kumodeck.com';
/** Who makes Game Studio: KUMODeck, with the one email address Game Studio gives (support@kumodeck.com). */
export const PUBLISHER = { '@type': 'Organization', name: 'KUMODeck', url: KUMODECK, email: 'support@kumodeck.com' };

/**
 * The front page's structured data: the app (free, MIT, runs where Node.js runs) and the site it is on.
 * Full addresses only when the site's address is known (`@id`s and `url`s are left out otherwise).
 */
export function appLd({ site, path, lang, name, description, version, repo, image = null }) {
  const url = pageUrl(site, path);
  const home = pageUrl(site, '');
  const app = {
    '@type': 'SoftwareApplication',
    ...(home ? { '@id': `${home}#app` } : {}),
    name,
    description,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Game editor',
    // It runs in the browser on the person's own computer, started by Node.js 22.13+ (README "Install").
    operatingSystem: 'Windows, macOS, Linux',
    softwareRequirements: 'Node.js 22.13 or later; Claude Code or Codex',
    softwareVersion: version,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
    license: 'https://opensource.org/licenses/MIT',
    inLanguage: ['en', 'ja'],
    publisher: PUBLISHER,
    ...(repo ? { downloadUrl: repo, sameAs: [repo] } : {}),
    ...(url ? { url } : {}),
    ...(image && site ? { image: pageUrl(site, image.path), screenshot: pageUrl(site, image.path) } : {}),
  };
  const website = {
    '@type': 'WebSite',
    ...(home ? { '@id': `${home}#site`, url: home } : {}),
    name,
    inLanguage: lang,
    publisher: PUBLISHER,
  };
  return { '@context': 'https://schema.org', '@graph': [app, website] };
}

/**
 * A docs page's structured data: the page (TechArticle about the app) and, with the site's address, its breadcrumb
 * (Game Studio › Docs › the page), which Google shows in place of the address.
 * crumbs: [{ name, path }] from the front page down to this page.
 */
export function docLd({ site, path, lang, title, description, crumbs }) {
  const url = pageUrl(site, path);
  const home = pageUrl(site, '');
  const article = {
    '@type': 'TechArticle',
    headline: title,
    ...(description ? { description } : {}),
    inLanguage: lang,
    publisher: PUBLISHER,
    ...(url ? { url, mainEntityOfPage: url } : {}),
    ...(home ? { about: { '@id': `${home}#app` }, isPartOf: { '@id': `${home}#site` } } : {}),
  };
  const graph = [article];
  if (site) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: pageUrl(site, c.path) })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * sitemap.xml for `entries`: [{ path, alternates: { en, ja } }]. Each address is listed with its languages
 * (xhtml:link, the same pairs as the pages' hreflang), so a search engine finds both from either. Needs the site's
 * address (a sitemap holds full addresses only). No <lastmod>: the build doesn't know when a page's words last changed,
 * and a build date on every page would be a wrong one.
 */
export function sitemapXml(site, entries) {
  if (!site) throw new Error('sitemapXml: needs the site address');
  const rows = entries.map((e) => {
    const langs = Object.keys(e.alternates || {});
    const alt = langs.map((l) => `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(pageUrl(site, e.alternates[l]))}" />`).join('');
    const def = langs.length ? `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(pageUrl(site, e.alternates[langs[0]]))}" />` : '';
    return `  <url>\n    <loc>${esc(pageUrl(site, e.path))}</loc>${alt}${def}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join('\n')}\n</urlset>\n`;
}

/**
 * robots.txt: every page open (the editor's scripts and the samples' files too: a search engine that draws the front
 * page needs them for the editor in its frame). The Sitemap line only with the site's address.
 * A robots.txt is read only at the root of a host: published under a path (example.com/game-studio/), this file is not
 * the one search engines read; that host's own robots.txt should list the sitemap instead.
 */
export function robotsTxt(site) {
  return `# KUMODeck Game Studio (built by scripts/build-web-demo.mjs)\nUser-agent: *\nAllow: /\n${site ? `\nSitemap: ${pageUrl(site, 'sitemap.xml')}\n` : ''}`;
}
