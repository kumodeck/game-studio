// The web demo's one rule about other origins (scripts/build-web-demo.mjs): no CDN. What a sample's page loads from
// jsDelivr is copied into the demo's vendor/ and the page points there. This file holds the parts that only rewrite
// text, so a test can check them without building the whole demo (which fetches from jsDelivr the first time).

/** A jsDelivr npm URL: [1] package@version (with its @scope), [2] the path in it. */
export const CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^/@]+@[^/]+)\/(.*)$/;

/** The folder in vendor/ and the file in it for a jsDelivr npm URL's package@version and path. */
export const vendorOf = (pkgAt, path) => `${pkgAt}/${path}`;

/**
 * A page's classic `<script src="https://cdn.jsdelivr.net/npm/…">` tags, pointed at `<up>vendor/…`.
 * Returns the new HTML and the CDN URLs to copy as they are.
 *
 * Fixed 2026-11-07: Marble Rain loads Phaser as a global build from a pinned CDN URL (what an AI writes for "a Phaser
 * game"), and the build stopped with "marble-rain/index.html still loads from a CDN": only an import map's URLs were
 * pointed at vendor/. The sample itself keeps its CDN tag (it is what `--starter` copies into a person's folder); only
 * the demo's copy changes. A classic script's file is copied without reading it for imports: a UMD build imports
 * nothing, and a minified one is full of text that a simple import search would misread.
 * Another origin (not jsDelivr's npm path) is left as it is, so the build's "still loads from a CDN" check catches it.
 */
export function classicScriptsToVendor(html, up) {
  const urls = [];
  const out = html.replace(/(<script\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>\s*<\/script>)/gi, (all, a, url, b) => {
    const c = CDN.exec(url);
    if (!c) return all;
    urls.push(url);
    return `${a}${up}vendor/${vendorOf(c[1], c[2])}${b}`;
  });
  return { html: out, urls };
}
