// The editor inside the demo site's front page (index.html, `studio/?game=<id>&embed=1` in an iframe).
//
// WHY (2026-10-19, "the studio screen goes inside the demo site's front page"): the page around the editor
// scrolls, the editor does not. Chrome hands a key it doesn't use to the frame around it, so an arrow, Space or
// Page Down pressed in the editor (or in the game inside it) scrolled the front page away from under the person:
// the shell only takes the arrows while something is selected, and Space only while editing. Here each such key
// is kept in the frame unless something in it uses it (a text field, a list that scrolls, Space on a button).
// The front page also covers the editor with a "Click to use" layer until it is clicked (index.html), so the wheel
// scrolls the page until then; this file is for the keys after that click.
//
// Only the demo's embedded editor does this: the full-size editor (no embed=1) and the local studio are unchanged.

/** True when this editor page was opened inside the front page (`embed=1`). */
export const isEmbedded = (search: string) => new URLSearchParams(search).get('embed') === '1' && window.parent !== window;

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown', 'Home', 'End']);
const guarded = new WeakSet<Window>();

/** Can `el` (or a box around it) scroll itself with this key? Then the key is its own, not the page's. */
function scrollsItself(el: Element | null, key: string): boolean {
  const across = key === 'ArrowLeft' || key === 'ArrowRight';
  for (let e = el; e; e = e.parentElement) {
    const view = e.ownerDocument.defaultView;
    if (!view || e === e.ownerDocument.documentElement || e === e.ownerDocument.body) break;
    const s = view.getComputedStyle(e);
    const overflow = across ? s.overflowX : s.overflowY;
    if (!/(auto|scroll)/.test(overflow)) continue;
    if (across ? e.scrollWidth > e.clientWidth + 1 : e.scrollHeight > e.clientHeight + 1) return true;
  }
  return false;
}

/** Keep the page-scrolling keys pressed in `win` from scrolling the page around the editor. Once per window. */
export function holdPageScroll(win: Window) {
  if (guarded.has(win)) return;
  guarded.add(win);
  win.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !SCROLL_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as Element | null;
    if (t?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable=false])')) return;
    // Space presses a focused button or link (and doesn't scroll anything there).
    if (e.key === ' ' && t?.closest?.('button, a, summary, [role=button], [role=option]')) return;
    if (scrollsItself(t, e.key)) return;
    e.preventDefault();
  });
}

/**
 * holdPageScroll() for this window and every frame in it, now and later: the shell swaps in a new game frame after
 * the AI's change and between Edit and Play, and each new page in a frame is a new window.
 */
export function holdPageScrollEverywhere(doc: Document) {
  if (doc.defaultView) holdPageScroll(doc.defaultView);
  const hook = (f: HTMLIFrameElement) => {
    if (f.dataset.scrollHeld) return;
    f.dataset.scrollHeld = '1';
    const attach = () => {
      try {
        if (f.contentWindow && f.contentDocument) holdPageScrollEverywhere(f.contentDocument);
      } catch {
        // Another origin (never in the demo): its keys are its own business.
      }
    };
    f.addEventListener('load', attach);
    attach();
  };
  doc.querySelectorAll('iframe').forEach(hook);
  new MutationObserver(() => doc.querySelectorAll('iframe').forEach(hook)).observe(doc.documentElement, { childList: true, subtree: true });
}
