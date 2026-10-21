// The picture and the UI that go with a request made while playing (CONTRACT.md §3.5; 2026-10-20: "I asked the AI
// while playing and it ignored the UI on screen").
//
// WHY this file: the first picture (2026-10-20) drew only the page's canvases. A game's HUD, title, buttons and score
// are usually HTML over the canvas, so the AI got a picture without them and could not tell what the person was
// looking at when they said "make the score bigger" or "this button is in the way". `shootPage` is a screenshot of
// the page as the player sees it: canvases AND the HTML over them, painted into one canvas. One picture is all that
// goes (a UI list in words was tried the same day and taken out: "a screenshot is enough").
//
// WHY a small painter of our own, not the usual ways:
// - the browser's own screen capture (getDisplayMedia) asks the person every time with a dialog — in the middle of a
//   run; the brief says no dialog;
// - there is no library here (the bridge is one file that goes into every game page);
// - the SVG <foreignObject> route loads asynchronously, drops the game's style sheets unless each one is copied in,
//   and in some browsers marks the canvas unreadable (then there is no picture at all).
// The painter draws what HUDs are made of — boxes with a background colour, a border and round corners, text in its
// font and colour, images from the game's own site — in the page's painting order (in-flow first, then positioned
// boxes by z-index), synchronously, at the moment Enter is pressed.
// NOT drawn (the AI sees the UI's place and words, not its finish): CSS gradients, shadows and glows (text-shadow,
// box-shadow), CSS background images, inline SVG, rotations (a turned box is drawn upright in its bounds), pictures
// from another site (drawing one would make the whole picture unreadable), what is typed in a game's input field
// (its value is not text in the page), anything inside a shadow root or an iframe.
//
// The editor's own parts (the ask overlay, the tool strip) are never drawn: `skip` names them.

/** Widest picture sent (px). Enough to read a sign in the game; a 1024 px JPEG is ~100-250 KB. */
export const SHOT_W = 1024;
/** Text the painter draws at most (characters): a long credits page would otherwise take long frames to paint. */
const PAINT_CHARS = 4000;


// ---------------------------------------------------------------------------
// The page (browser only)
// ---------------------------------------------------------------------------

type Win = Window & typeof globalThis;

const isTransparent = (c: string) => !c || c === 'transparent' || /rgba\([^)]*,\s*0(\.0+)?\)$/.test(c) || /\/\s*0(\.0+)?\)$/.test(c);
const sameSite = (win: Win, src: string) => {
  if (!src) return false;
  if (/^(data|blob):/.test(src)) return true;
  try {
    return new URL(src, win.location.href).origin === win.location.origin;
  } catch {
    return false;
  }
};
const shown = (cs: CSSStyleDeclaration) => cs.display !== 'none' && cs.visibility !== 'hidden' && cs.visibility !== 'collapse';
const onScreen = (r: DOMRect, vw: number, vh: number) => r.width >= 1 && r.height >= 1 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;

/**
 * The game as the player sees it — canvases and the HTML UI over them — scaled to SHOT_W at most, as a JPEG. null when
 * nothing could be drawn (an empty page) or the browser refuses (a canvas with pictures from another site).
 */
export function shootPage(win: Win, skip: (el: Element) => boolean): string | null {
  const doc = win.document;
  const vw = win.innerWidth, vh = win.innerHeight;
  if (!vw || !vh) return null;
  const k = Math.min(1, SHOT_W / vw);
  const out = doc.createElement('canvas');
  out.width = Math.round(vw * k);
  out.height = Math.round(vh * k);
  const g = out.getContext('2d');
  if (!g) return null;
  g.scale(k, k);
  // The page's own colour under everything (CSS gives the body's to the whole page when the root has none).
  const rootBg = [doc.documentElement, doc.body].map((e) => (e ? win.getComputedStyle(e).backgroundColor : '')).find((c) => !isTransparent(c));
  g.fillStyle = rootBg || '#000';
  g.fillRect(0, 0, vw, vh);
  let drawn = 0;
  let chars = 0;
  const range = doc.createRange();

  // Positioned boxes are painted after the flow, lowest z-index first (CSS painting order, simplified: a box with
  // z-index auto takes its parent's).
  const later: Array<{ el: Element; z: number; order: number; alpha: number }> = [];
  let order = 0;

  const box = (el: Element, cs: CSSStyleDeclaration, r: DOMRect, alpha: number) => {
    const bg = cs.backgroundColor;
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const bc = cs.borderTopColor;
    const paintBg = !isTransparent(bg);
    const paintBorder = bw > 0 && cs.borderTopStyle !== 'none' && !isTransparent(bc);
    if (!paintBg && !paintBorder) return;
    const rad = Math.min(r.width / 2, r.height / 2, cs.borderTopLeftRadius.endsWith('%') ? (parseFloat(cs.borderTopLeftRadius) / 100) * r.width : parseFloat(cs.borderTopLeftRadius) || 0);
    g.globalAlpha = alpha;
    g.beginPath();
    if (rad > 0 && typeof g.roundRect === 'function') g.roundRect(r.left, r.top, r.width, r.height, rad);
    else g.rect(r.left, r.top, r.width, r.height);
    if (paintBg) {
      g.fillStyle = bg;
      g.fill();
    }
    if (paintBorder) {
      g.lineWidth = bw;
      g.strokeStyle = bc;
      g.stroke();
    }
    drawn++;
  };

  const text = (node: Text, cs: CSSStyleDeclaration, alpha: number) => {
    const raw = node.data;
    if (!raw.trim() || chars > PAINT_CHARS) return;
    const tt = cs.textTransform;
    const show = (s: string) => (tt === 'uppercase' ? s.toUpperCase() : tt === 'lowercase' ? s.toLowerCase() : s);
    g.globalAlpha = alpha;
    g.fillStyle = cs.color;
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    g.textBaseline = 'middle';
    const ls = parseFloat(cs.letterSpacing);
    if ('letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = Number.isFinite(ls) ? `${ls}px` : '0px';
    // Word by word, each where the browser laid it out (wrapped lines, centred text and all); a word the browser broke
    // over two lines (no spaces: Japanese) letter by letter.
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) && chars <= PAINT_CHARS) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = range.getClientRects();
      if (rects.length === 1) {
        const q = rects[0]!;
        if (onScreen(q, vw, vh)) g.fillText(show(m[0]), q.left, q.top + q.height / 2);
        chars += m[0].length;
        continue;
      }
      let i = m.index;
      for (const ch of m[0]) {
        range.setStart(node, i);
        range.setEnd(node, i + ch.length);
        const q = range.getClientRects()[0];
        if (q && onScreen(q, vw, vh)) g.fillText(show(ch), q.left, q.top + q.height / 2);
        i += ch.length;
        chars++;
      }
    }
    drawn++;
  };

  const paint = (el: Element, alpha: number, z: number, top: boolean) => {
    if (skip(el)) return;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none') return;
    const a = alpha * (Number(cs.opacity) || (cs.opacity === '0' ? 0 : 1));
    if (a <= 0.01) return;
    const positioned = cs.position !== 'static';
    const zi = cs.zIndex === 'auto' ? z : Number(cs.zIndex) || 0;
    if (positioned && !top) {
      later.push({ el, z: zi, order: order++, alpha });
      return;
    }
    const tag = el.tagName;
    const r = el.getBoundingClientRect();
    const visible = cs.visibility === 'visible' && onScreen(r, vw, vh);
    if (visible && el !== doc.documentElement && el !== doc.body) box(el, cs, r, a);
    if (visible && tag === 'CANVAS') {
      try {
        g.globalAlpha = a;
        g.drawImage(el as HTMLCanvasElement, r.left, r.top, r.width, r.height);
        drawn++;
      } catch {
        /* this one cannot be read; the others still can */
      }
      return;
    }
    if (visible && (tag === 'IMG' || tag === 'VIDEO')) {
      const m = el as HTMLImageElement & HTMLVideoElement;
      const src = tag === 'IMG' ? m.currentSrc || m.src : m.currentSrc || m.src;
      // Only the game's own pictures: one from another site would make the whole picture unreadable.
      const ready = tag === 'IMG' ? m.complete && m.naturalWidth > 0 : m.readyState >= 2;
      if (ready && sameSite(win, src)) {
        try {
          g.globalAlpha = a;
          g.drawImage(m, r.left, r.top, r.width, r.height);
          drawn++;
        } catch {
          /* not drawable */
        }
      }
      return;
    }
    if (tag === 'SVG' || tag === 'svg' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'IFRAME') return;
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3) {
        if (shown(cs)) text(c as Text, cs, a);
      } else if (c.nodeType === 1) paint(c as Element, a, zi, false);
    }
  };

  paint(doc.documentElement, 1, 0, true);
  while (later.length) {
    later.sort((x, y) => x.z - y.z || x.order - y.order);
    const next = later.shift()!;
    paint(next.el, next.alpha, next.z, true);
  }
  g.globalAlpha = 1;
  if (!drawn) return null;
  try {
    return out.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}
