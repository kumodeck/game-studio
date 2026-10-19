// Camera up / down: two small buttons, ↑ over ↓, in the game's bottom-right corner (3D only, while editing).
//
// Play test 2026-10-18: "I can't raise the camera; it's needed." Looking around had orbit (turn round a point), pan
// (slide over the ground: the height never changes) and zoom (along the line of sight), so there was no way to
// just go up — over a wall, above a roof, down to the water. What it does: the camera goes straight up or down,
// looking the same way (adapter view.rise). It only moves when the person asks (the first-wave rule: the view is
// theirs, the tool never moves it by itself).
//
// The ways to do it (input.ts does the gestures; this file only draws the buttons and tells which was pressed):
//   - a click / tap on ↑ or ↓: one step (a tenth of the game's height);
//   - holding it: keeps going (after RISE_HOLD_MS) until let go;
//   - dragging up / down on it (mouse or finger): the camera follows the drag, like a slider;
//   - E / Q (up / down) with nothing picked, or while looking around (Space held, right / middle / ⌥ drag) — the
//     keys 3D tools use for this (Unity, Unreal, Godot: right button + Q / E). With something picked and no
//     look-around held, Q / E keep turning it (the old keys: never taken away);
//   - ⌘K "Camera up" / "Camera down" (the editor page), the one place where the words and the keys are written.
// WHY buttons on the game and not a key alone: a key is found only by people who already know it; a phone has no
// keys; and two fingers already pan and pinch, so a two-finger "up" would take panning forward away.
// WHY its own small shadow root (not in handles.ts with the strip): the strip follows the picked object and is
// gone with nothing picked; these stay in one corner, always. Same glass, same sizes, same theme as the strip.
import { UI, type Inset, type Lang } from '../contract.ts';

export type RiseDir = 'up' | 'down';

/** Tooltips / labels. `picked`: with something picked, E / Q turn it, so the key named is Space + E / Q. */
export const RISE_LABELS: Record<Lang, (dir: RiseDir, picked: boolean) => string> = {
  en: (d, p) => `${d === 'up' ? 'Camera up' : 'Camera down'} (${p ? 'Space+' : ''}${d === 'up' ? 'E' : 'Q'})`,
  ja: (d, p) => `${d === 'up' ? 'カメラを上げる' : 'カメラを下げる'}（${p ? 'Space+' : ''}${d === 'up' ? 'E' : 'Q'}）`,
};

export interface RiseButtons {
  /** Which button the event hit (composedPath: the root is open), or null. */
  fromEvent(e: Event): RiseDir | null;
  setInset(inset: Inset): void;
  setTheme(theme: 'dark' | 'light'): void;
  /** Button size in px (the strip's size: 28 with a mouse, 44 for a finger). */
  setSize(px: number): void;
  setLabels(lang: Lang, picked: boolean): void;
  /** The button held right now (drawn pressed), or null. */
  setActive(dir: RiseDir | null): void;
  destroy(): void;
}

const ICONS: Record<RiseDir, string> = {
  up: '<path d="M7 14.5 12 9.5l5 5"/>',
  down: '<path d="M7 9.5 12 14.5l5-5"/>',
};
/** Gap to the game's edges and to the shell's panels (the hint line's 12). */
const EDGE = 12;
const CSS = `
:host { all: initial; }
.cam { position: fixed; display: grid; gap: 0; padding: 2px; border-radius: 12px; z-index: 2147483646; pointer-events: none;
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); }
button { pointer-events: auto; width: var(--h, ${UI.handlePx}px); height: var(--h, ${UI.handlePx}px); border-radius: 10px; border: 0; padding: 0;
  background: transparent; color: #a1a1a6; display: grid; place-items: center; cursor: ns-resize; touch-action: none; -webkit-tap-highlight-color: transparent;
  transition: background-color .16s cubic-bezier(.2,.8,.2,1), color .16s cubic-bezier(.2,.8,.2,1); }
button:hover { color: #f5f5f7; background: rgba(255,255,255,.07); }
button.on { color: #f5f5f7; background: rgba(255,255,255,.14); transition-duration: 0s; }
button:focus-visible { outline: 2px solid #ff6b1a; outline-offset: 1px; }
svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8px; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.big svg { width: 20px; height: 20px; }
.big { border-radius: 14px; background: rgba(42, 42, 46, .92); box-shadow: 0 0 0 1px rgba(255,255,255,.08); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.big button { border-radius: 12px; }
.light { background: rgba(251,251,253,.8); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.7), 0 1px 1px rgba(0,0,0,.04), 0 10px 32px rgba(0,0,0,.13);
  backdrop-filter: blur(30px) saturate(1.25); -webkit-backdrop-filter: blur(30px) saturate(1.25); }
.light.big { background: rgba(255,255,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.08); }
.light button { color: #6e6e73; }
.light button:hover { color: #1d1d1f; background: rgba(0,0,0,.045); }
.light button.on { color: #1d1d1f; background: rgba(0,0,0,.08); }
@media (pointer: coarse) { button:hover { background: transparent; } }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

export function createRiseButtons(doc: Document): RiseButtons {
  const win = doc.defaultView!;
  const host = doc.createElement('div');
  host.setAttribute('data-studio-ui', ''); // as the strip's host: never taken for a game element
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const box = doc.createElement('div');
  box.className = 'cam';
  box.setAttribute('role', 'group');
  const buttons = {} as Record<RiseDir, HTMLButtonElement>;
  for (const dir of ['up', 'down'] as RiseDir[]) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.rise = dir;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[dir]}</svg>`; // static markup only
    buttons[dir] = b;
    box.append(b);
  }
  root.append(style, box);
  (doc.body || doc.documentElement).appendChild(host);

  let inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
  let size: number = UI.handlePx;
  /** Bottom-right of the part of the game the shell's panels leave free (the right inset only reaches down to rightTo). */
  const position = () => {
    const h = box.offsetHeight || size * 2 + 4;
    const top = win.innerHeight - inset.bottom - EDGE - h;
    const right = inset.rightTo === undefined || top < inset.rightTo ? inset.right : 0;
    box.style.right = `${right + EDGE}px`;
    box.style.top = `${Math.max(inset.top + EDGE, top)}px`;
  };
  const onResize = () => position();
  win.addEventListener('resize', onResize);
  position();

  return {
    fromEvent(e) {
      for (const n of e.composedPath()) {
        const d = (n as HTMLElement).dataset?.rise;
        if (d === 'up' || d === 'down') return d;
        if (n === host) return null;
      }
      return null;
    },
    setInset(i) {
      inset = i;
      position();
    },
    setTheme(theme) {
      box.classList.toggle('light', theme === 'light');
    },
    setSize(px) {
      size = px;
      box.style.setProperty('--h', `${px}px`);
      box.classList.toggle('big', px >= 40);
      position();
    },
    setLabels(lang, picked) {
      for (const dir of ['up', 'down'] as RiseDir[]) {
        const text = (RISE_LABELS[lang] || RISE_LABELS.en)(dir, picked);
        buttons[dir].title = text;
        buttons[dir].setAttribute('aria-label', text);
      }
    },
    setActive(dir) {
      for (const d of ['up', 'down'] as RiseDir[]) buttons[d].classList.toggle('on', d === dir);
    },
    destroy() {
      win.removeEventListener('resize', onResize);
      host.remove();
    },
  };
}
