// "World | UI" (UI stage 1, 2026-10-19; design §2.3, §4): what the editor moves now — the game's world (3D / 2D
// objects) or its UI (HTML marked data-studio-key). Shown only when the bridge says the game has both layers
// (core/ready `layers`); a game without data-studio-key never sees it, and nothing moves to make room for it.
//
// Where: PC — the middle of the top bar, which is empty (a switch of what the GAME's surface does, so not in the
// left column, whose Scene / Library rows choose what the column shows and which is hidden while the Library is
// open). Phone — icons only (cube = World, a framed screen = UI), floating at the top middle of the game: the phone
// top bar is full (title, Undo, Redo, Play). Key: U (free in keymap.ts; Tab moves the browser's focus).
// Which one is on is said three ways besides the switch, never by a banner: the card's "UI" tag, the brightness
// (the bridge dims the world 15 % while the UI is edited and hides the UI while the world is — the eye below), and the
// list (the UI's elements instead of the scene).
//
// The eye (a try of the editor, 2026-10-20, "the UI is always there, in the way"): while the world is edited the game's UI is
// hidden (bridge editor.ts paintLayers), and an eye with a slash sits just right of the switch — the small sign that
// something is hidden, and the one press that shows it again (faded, as a reference to place things around; clicks
// still go through it to the world). ⇧U does the same (U itself switches the layer). On the UI layer there is nothing
// to hide, so the eye is not drawn. It hangs off the switch's right edge (absolute), so the switch stays exactly in
// the middle of the bar and does not jump when the eye comes and goes. PC: the eye and a short word ("UI hidden");
// phone: the eye alone, a finger's 44 px.
import type { EditLayer } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface LayerSwitch {
  el: HTMLElement;
  /**
   * Draw it for `on`; `compact` = the phone's icons-only form. `peek`: the game's UI is shown while the world is
   * edited (the eye); `peekKey` its key.
   */
  render(on: EditLayer, compact: boolean, t: (k: string) => string, key: string, peek: boolean, peekKey: string): void;
}

export function createLayerSwitch(choose: (l: EditLayer) => void, togglePeek: () => void): LayerSwitch {
  const el = h('div', { class: 'layer-switch', role: 'radiogroup', dataset: { part: 'layer-switch' } });
  const btns = (['world', 'ui'] as const).map((l) => h('button', { type: 'button', role: 'radio', dataset: { layer: l }, onclick: () => choose(l) }));
  // Not a radio of the group: a toggle of its own (aria-pressed), outside the switch's box (shell.css .ui-peek).
  const eye = h('button', { type: 'button', class: 'ui-peek', dataset: { part: 'ui-peek' }, onclick: () => togglePeek() });
  el.append(...btns, eye);
  return {
    el,
    render(on, compact, t, key, peek, peekKey) {
      eye.hidden = on !== 'world';
      eye.setAttribute('aria-pressed', String(peek));
      eye.dataset.peek = peek ? 'on' : 'off';
      eye.replaceChildren(icon(peek ? 'eye' : 'eyeOff'));
      if (!compact) eye.append(h('span', { class: 'label', text: t(peek ? 'uiPeek.shown' : 'uiPeek.hidden') }));
      eye.setAttribute('aria-label', t('uiPeek.name'));
      eye.title = `${t(peek ? 'uiPeek.hide' : 'uiPeek.show')}  ${peekKey}`;
      el.setAttribute('aria-label', t('uiLayer.switch'));
      el.dataset.compact = compact ? 'on' : 'off';
      for (const b of btns) {
        const l = b.dataset.layer as EditLayer;
        const name = t(`uiLayer.${l}`);
        b.replaceChildren(icon(l === 'world' ? 'cube' : 'uiLayer'));
        if (!compact) b.append(h('span', { class: 'label', text: name }));
        b.setAttribute('aria-checked', String(l === on));
        b.setAttribute('aria-label', name);
        b.title = `${t(`uiLayer.${l}.tip`)}  ${key}`;
      }
    },
  };
}
