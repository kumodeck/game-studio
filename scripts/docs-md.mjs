// A small Markdown → HTML converter for the public docs (docs/site/, 2026-10-22). build-docs.mjs uses it.
//
// WHY our own (≈150 lines) and not a package: the plugin ships with no dependencies and builds with plain Node
// (scripts/build.mjs, bundle.mjs). The docs use a small, fixed part of Markdown, the part GitHub shows the same way, so
// the same files read well on GitHub and on the demo site:
//   front matter (--- key: value ---), # headings, paragraphs, - and 1. lists (one level, a line indented under an
//   item continues it), > notes, ``` code, | tables |, ![images](src "caption") on a line of their own,
//   and inline `code`, **bold**, *italic*, [links](href), <kbd>keys</kbd> and <br>.
// Everything else is text: < and & are escaped, so a page can never put its own HTML or script on the site.
// Anything new a page needs is added here (and checked by test/docs-site.test.mjs), not written as HTML in the page.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The id of a heading: GitHub's way (lower case, letters and digits of any script, spaces → "-"), so #links match. */
export function slug(text) {
  return text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
}

/** Inline Markdown → HTML. `link(href)` may rewrite a link or an image's address (…/x.md → x.html). */
export function inline(text, link = (h) => h) {
  // Code spans first, kept out of everything else; then the text escaped; then the marks.
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/&lt;kbd&gt;(.+?)&lt;\/kbd&gt;/g, '<kbd>$1</kbd>').replace(/&lt;br\s*\/?&gt;/g, '<br>');
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${esc(link(unesc(src)))}" alt="${alt}" loading="lazy" decoding="async">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
    const h = link(unesc(href));
    const out = /^https?:|^mailto:/.test(h) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${esc(h)}"${out}>${t}</a>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

/**
 * Markdown → { meta, html, headings }.
 * meta: the front matter's keys. headings: [{ level, text, id }] of ## and ### (for "On this page").
 * opts.link(href): rewrites addresses; opts.image(src) → { src, width, height } for a figure's size (no layout shift).
 */
export function render(md, opts = {}) {
  const link = opts.link || ((h) => h);
  const image = opts.image || ((src) => ({ src }));
  const meta = {};
  let lines = md.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    for (const l of lines.slice(1, end)) {
      const m = /^([\w-]+):\s*(.*)$/.exec(l);
      if (m) meta[m[1]] = m[2].trim();
    }
    lines = lines.slice(end + 1);
  }
  const out = [];
  const headings = [];
  const used = new Map();
  let i = 0;
  const para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join('\n'), link)}</p>`);
    para.length = 0;
  };
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { flush(); i++; continue; }
    if ((m = /^```(\w*)/.exec(l))) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<div class="code"><pre><code${m[1] ? ` class="lang-${m[1]}"` : ''}>${esc(body.join('\n'))}</code></pre></div>`);
      continue;
    }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
      flush();
      const level = m[1].length;
      let id = slug(m[2]);
      // The same heading twice gets -1, -2 (GitHub's way).
      const n = used.get(id) || 0;
      used.set(id, n + 1);
      if (n) id += `-${n}`;
      const html = inline(m[2], link);
      if (level === 2 || level === 3) headings.push({ level, text: html.replace(/<[^>]+>/g, ''), id });
      out.push(level === 1 ? `<h1 id="${id}">${html}</h1>` : `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${html}</h${level}>`);
      i++;
      continue;
    }
    if ((m = /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)\s*$/.exec(l))) {
      flush();
      const img = image(m[2]);
      const size = img.width ? ` width="${img.width}" height="${img.height}"` : '';
      out.push(`<figure><img src="${esc(link(img.src))}" alt="${esc(m[1])}"${size} loading="lazy" decoding="async">${m[3] ? `<figcaption>${inline(m[3], link)}</figcaption>` : ''}</figure>`);
      i++;
      continue;
    }
    if (/^>\s?/.test(l)) {
      flush();
      const body = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${render(body.join('\n'), opts).html}</blockquote>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flush();
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(l);
      const rows = [];
      for (i += 2; i < lines.length && /^\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c, link)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c, link)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if ((m = /^(-|\d+\.)\s+/.exec(l))) {
      flush();
      const ordered = m[1] !== '-';
      const items = [];
      while (i < lines.length && (m = /^(-|\d+\.)\s+(.*)$/.exec(lines[i])) && (m[1] !== '-') === ordered) {
        const item = [m[2]];
        for (i++; i < lines.length && /^\s{2,}\S/.test(lines[i]); i++) item.push(lines[i].trim());
        items.push(`<li>${inline(item.join('\n'), link)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    para.push(l);
    i++;
  }
  flush();
  return { meta, html: out.join('\n'), headings };
}
