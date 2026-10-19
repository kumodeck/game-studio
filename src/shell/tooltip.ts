// The editor's own tooltip for buttons: the name, and the key in grey after it ("Undo: move lighthouse  ⌘Z").
// Basics pass, 2026-10-18 (buttons AND shortcuts for the basic actions). WHY not the browser's `title` bubble: it comes after
// ~1 s, in the system's font, and cannot set the key apart — the key is the part people come to learn. The `title`
// stays on the button (screen readers, a page without this script); while the mouse is over it the title is
// lent to this tip and given back on leave, so the two never show at once.
//
// Which: every `button[title]` / `summary[title]` of the editor page (the game frame's strip keeps its own titles).
// The key is what follows the LAST double space of the title (keymap.ts tipText writes it that way).
// Mouse only: a touch has no hover, and a tip under a finger would cover what it presses.
// Look: the glass of rule 1 (shell.css), 11 px, one line, 6 px under the button (above it near the bottom edge).
// Timing: 450 ms the first time, then at once while moving along a bar (the macOS way), gone on press.

const SEL = 'button[title], summary[title]';

export function installTooltips(root: HTMLElement): { el: HTMLElement; hide(): void } {
  const el = document.createElement('div');
  el.className = 'tip';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  const text = document.createElement('span');
  const kbd = document.createElement('kbd');
  el.append(text, kbd);
  root.append(el);

  let target: HTMLElement | null = null;
  let timer = 0;
  // Until this time a new tip shows at once (the last one was just hidden).
  let warmUntil = 0;
  const watch = new MutationObserver(() => {
    // The button was re-rendered while hovered (renderButtons after ⌘Z): take its new title too.
    if (!target) return;
    if (target.hasAttribute('title')) lend(target);
    fill();
  });

  const lend = (b: HTMLElement) => {
    b.dataset.tip = b.getAttribute('title') || '';
    b.removeAttribute('title');
  };
  const giveBack = (b: HTMLElement) => {
    if (b.dataset.tip !== undefined && !b.hasAttribute('title')) b.setAttribute('title', b.dataset.tip);
    delete b.dataset.tip;
  };
  function fill() {
    if (!target) return;
    const tip = target.dataset.tip || '';
    const at = tip.lastIndexOf('  ');
    text.textContent = at > 0 ? tip.slice(0, at) : tip;
    kbd.textContent = at > 0 ? tip.slice(at + 2) : '';
    kbd.hidden = !kbd.textContent;
    if (!el.hidden) place();
  }
  function place() {
    if (!target) return;
    const r = target.getBoundingClientRect();
    const w = el.offsetWidth, hh = el.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 6 + hh <= innerHeight - 8;
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(below ? r.bottom + 6 : r.top - 6 - hh)}px`;
  }
  function show() {
    if (!target || !target.isConnected || !target.dataset.tip) return;
    fill();
    el.hidden = false;
    place();
  }
  function hide() {
    clearTimeout(timer);
    watch.disconnect();
    if (target) giveBack(target);
    if (!el.hidden) warmUntil = performance.now() + 600;
    target = null;
    el.hidden = true;
  }

  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const b = (e.target as HTMLElement | null)?.closest?.(SEL) as HTMLElement | null;
    const cur = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
    if (cur && cur === target) return;
    if (!b || !root.contains(b)) return hide();
    hide();
    target = b;
    lend(b);
    watch.observe(b, { attributes: true, attributeFilter: ['title'] });
    if (performance.now() < warmUntil) show();
    else timer = window.setTimeout(show, 450);
  });
  root.addEventListener('pointerout', (e) => {
    if (!target) return;
    const to = e.relatedTarget as Node | null;
    if (to && target.contains(to)) return;
    hide();
  });
  // A press, a key that changes the page, a scroll: the tip goes (it would point at something that moved).
  root.addEventListener('pointerdown', () => hide(), true);
  window.addEventListener('scroll', () => hide(), true);
  window.addEventListener('blur', () => hide());
  return { el, hide };
}
