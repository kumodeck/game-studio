// The editor inside the demo site's front page (index.html, `studio/?game=<id>&embed=1` in an iframe).
//
// WHY (2026-10-19, "the studio screen goes inside the demo site's front page"): the page around the editor
// scrolls, the editor does not. Chrome hands a key it doesn't use to the frame around it, so an arrow, Space or
// Page Down pressed in the editor (or in the game inside it) scrolled the front page away from under the person:
// the shell only takes the arrows while something is selected, and Space only while editing. Here each such key
// is kept in the frame unless something in it uses it (a text field, a list that scrolls, Space on a button).
// Until the editor is first pressed, the wheel over it scrolls the front page (the editor zooms with the wheel, so a
// page scrolled with the mouse over it would get stuck); after that press it is the editor's. See waitForFirstPress().
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

// ----- "the first press is a real press" (the third design review's ②, 2026-10-20) -----
// WHY: the front page used to cover the editor with a clear "Click to use" button until it was clicked. The first
// click on the lighthouse then only took the cover away: nothing got selected, and the person had to click again
// (Product Hunt's first 10 seconds: "pressing does nothing → press again and drag"). Now nothing covers the editor;
// presses go straight in (the first one selects and can drag), and only the wheel is kept for the page until then:
// the game page's input (bridge/input.ts onWheel) reads PAGE_WHEEL on its window and lets the wheel go on to the page.
// The front page (lp.js) hears "in use" from here and says "idle" back when the person presses outside the editor.

/** Set on each window of this editor (and the game frames in it) while the wheel belongs to the front page. */
export const PAGE_WHEEL = '__studioPageWheel';
/** postMessage types between this page and the front page around it (lp.js uses the same strings). */
export const MSG_USED = 'studio:embed/used';
export const MSG_IDLE = 'studio:embed/idle';

let inUse = false;
// Documents, not windows: a frame's contentWindow is the same object before and after its page loads (about:blank →
// the game), so a window seen once would never be watched again with its real page in it.
const watched: Document[] = [];
const setWheelFlag = (doc: Document) => {
  if (doc.defaultView) (doc.defaultView as unknown as Record<string, boolean>)[PAGE_WHEEL] = !inUse;
};

/** Start (or start again) handing the wheel to the front page until the next press anywhere in this editor. */
function setInUse(on: boolean) {
  inUse = on;
  for (let i = watched.length - 1; i >= 0; i--) {
    if (!watched[i].defaultView) watched.splice(i, 1); // its page is gone
    else setWheelFlag(watched[i]);
  }
}

/** Watch a page for the first press (once per page): every frame of the editor counts, the game's above all. */
function waitForFirstPress(doc: Document) {
  const win = doc.defaultView;
  if (!win || watched.includes(doc)) return;
  watched.push(doc);
  setWheelFlag(doc);
  // Capture on the window and never blocking: the press itself goes on to the editor (it selects, it drags).
  win.addEventListener('pointerdown', () => {
    if (inUse) return;
    setInUse(true);
    window.parent.postMessage({ type: MSG_USED }, location.origin);
  }, { capture: true });
  // The wheel: scrolls the front page by hand. WHY not leave it to the browser to hand it up (scroll chaining): tried
  // first (2026-10-20) and the front page did not move — the editor's pages don't scroll, and the wheel stopped in the
  // frames. A list that scrolls itself (the Scene list) keeps its wheel. The game page's input has let it through
  // already (PAGE_WHEEL), so this listener sees it.
  win.addEventListener('wheel', (e) => {
    if (inUse || e.ctrlKey || scrollsItself(e.target as Element | null, Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 'ArrowLeft' : 'ArrowDown')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.parent.innerHeight : 1;
    window.parent.scrollBy(e.deltaX * unit, e.deltaY * unit);
  }, { capture: true, passive: false });
}

/** In the front page's frame: the wheel is the page's until the first press; the page says when it is idle again. */
export function shareWheelUntilPressed(doc: Document) {
  window.addEventListener('message', (e) => {
    if (e.source === window.parent && e.origin === location.origin && e.data?.type === MSG_IDLE) setInUse(false);
  });
  eachDocument(doc, waitForFirstPress);
}

/** `fn` for this document and the document of every frame in it, now and later (frames swap their pages). */
function eachDocument(doc: Document, fn: (doc: Document) => void) {
  fn(doc);
  const hook = (f: HTMLIFrameElement) => {
    const attach = () => {
      try {
        if (f.contentDocument) eachDocument(f.contentDocument, fn);
      } catch {
        // Another origin (never in the demo).
      }
    };
    f.addEventListener('load', attach);
    attach();
  };
  const seen = new WeakSet<HTMLIFrameElement>();
  const all = () => doc.querySelectorAll('iframe').forEach((f) => {
    if (seen.has(f)) return;
    seen.add(f);
    hook(f);
  });
  all();
  new MutationObserver(all).observe(doc.documentElement, { childList: true, subtree: true });
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
