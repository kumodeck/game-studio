// The UI the editor sees but cannot select yet, in the shell (studio-canvas-ui stage 2, 2026-10-24; the plan's decisions
// 10–11; bridge/ui-found.ts draws the dotted frames and the cross).
//
// A press on the UI layer beside every UI box (on a dotted frame or not) used to do nothing — "is it broken?". Now the
// one line where Studio always speaks (over the ask field, the dock: motion-note.ts's place) says why, once:
//   "This UI can't be selected yet · ✦ Ask Claude to make this UI editable"
// and, when nothing on the UI layer can be selected at all, "This game draws its UI inside the picture · ✦ …".
// The reason is said in this one place only (the map's rule 6): no ✦ in the list, which says "No selectable UI yet".
// The line goes with the next action in the game page (the bridge says `at: null`), Esc, another layer, Play.
//
// ✦ only puts a draft in the box below — "Make this UI editable" and the chip "Here (bottom left)" with a small picture
// of the place pressed (the map's rule 2: the person sends). Sent, the request carries `intent: "ui-code"`, the place
// pressed, the dotted frames and the picture; the AI makes ALL of the game's canvas UI selectable at once (SKILL.md).
import type { BridgeToShell, UiFound } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface UiMissingDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  /** The AI's name for the ✦ words ({ai}). */
  aiVars(): Record<string, string>;
  /** ✦ pressed: the draft in the box below (main.ts focusAsk). Absent = no AI here (the line has no ✦). */
  draft?(text: string): void;
  /** The line went by the shell's own hand (Esc, ✦, another layer): the cross in the game goes too. */
  cleared(): void;
}

/** What a pressed ✦ asks about, until it is sent or the screen shows something else. */
export interface UiAsk {
  pressed: [number, number];
  place: string;
  shot?: string;
  found: UiFound[];
}

export function createUiMissing(d: UiMissingDeps) {
  const el = h('p', { class: 'motion-note ui-missing', role: 'status', 'aria-live': 'polite', hidden: true, dataset: { part: 'ui-missing' } });
  let found: UiFound[] = [];
  let miss: { at: [number, number]; place: string; none: boolean; shot?: string } | null = null;
  let ask: UiAsk | null = null;
  let shownOn = false;

  const draw = () => {
    const on = shownOn && !!miss;
    el.hidden = !on;
    if (!on || !miss) {
      el.replaceChildren();
      return;
    }
    const t = d.t;
    const parts: Node[] = [h('span', { class: 'mn-what', dataset: { part: 'ui-missing-what' }, text: t(miss.none ? 'uiMissing.none' : 'uiMissing.here') })];
    if (d.draft) {
      const m = miss;
      parts.push(h('span', { class: 'mn-dot', 'aria-hidden': 'true', text: '·' }),
        h('button', { type: 'button', class: 'mn-rule', title: t('uiMissing.askTip'), dataset: { action: 'ui-missing-ask', part: 'ui-missing-ask' }, onclick: () => {
          ask = { pressed: m.at, place: m.place, ...(m.shot ? { shot: m.shot } : {}), found: found.slice() };
          hide(true);
          d.draft!(t('uiMissing.draft'));
        } }, icon('spark'), h('span', { text: t('uiMissing.ask', d.aiVars()) })));
    }
    el.replaceChildren(...parts);
  };
  /** The line goes (`tell`: the cross in the game page too). */
  const hide = (tell: boolean) => {
    const had = !!miss;
    miss = null;
    draw();
    if (had && tell) d.cleared();
  };

  return {
    el,
    /** The bridge's ui/found and ui/missing; false = not one of them. */
    handle(m: BridgeToShell): boolean {
      if (m.type === 'studio:ui/found') {
        found = m.found.slice(0, 24);
        return true;
      }
      if (m.type === 'studio:ui/missing') {
        miss = m.at ? { at: m.at, place: m.place ?? 'center', none: !!m.none, ...(m.shot ? { shot: m.shot } : {}) } : null;
        draw();
        return true;
      }
      return false;
    },
    /** Draw for whether the UI layer is edited now (the line is the UI layer's only). */
    render(on: boolean) {
      shownOn = on;
      if (!on && miss) hide(true);
      else draw();
    },
    /** Esc / another action of the shell's own: the line goes, and the cross. */
    hide,
    shown: () => !el.hidden,
    /** The frames now (the AI's `list`). */
    found: () => found.slice(),
    /** The ✦ pressed and not sent yet, or null. */
    ask: () => ask,
    /** The ask box's chip while the ✦'s draft is there: "Here (bottom left)" and the picture. */
    chip(): { chip: string; pic?: string; tip: string } | null {
      if (!ask) return null;
      return { chip: d.t('uiMissing.chip', { place: d.t(`uiPlace.${ask.place}`) }), ...(ask.shot ? { pic: ask.shot } : {}), tip: d.t('uiMissing.chipTip') };
    },
    /** Sent, or the screen shows something else now (a pick, the world, Play): the ✦'s place is no longer what the words are about. */
    drop() {
      ask = null;
    },
  };
}

export type UiMissing = ReturnType<typeof createUiMissing>;
