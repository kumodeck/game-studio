// UI stages 2–3 in the game page (studio-ui-edit-2, 2026-10-22; CONTRACT.md §1.11):
// what the UI layer does besides moving and resizing — the game's screens, sample values, an element's text / size /
// colours, a button's looks, and the theme's CSS variables. The editor (editor.ts) hands it every studio:ui/* message.
//
// The rule of the whole editor holds: nothing here is the game's code. Everything is undone at the end of editing
// (end(): Play in the same page shows the game as its code makes it, and a reload forgets it anyway), EXCEPT `set` and
// the theme: those are the person's layout, like a moved title, so they stay for Play — the loader (studio-placement.js)
// gives the same look to the game from placement.json.
//
// Screens (stage 2): containers marked data-studio-screen="title|play|pause|over|…". Showing one = the others get
// display: none !important, and the chosen one loses its `hidden` and, when its CSS still hides it, gets the display
// its own rules give it (the last rule of the page that matches it with another display; else block). The old
// attribute / inline values are kept and put back. The game's time stays frozen: its code never runs for this.
//
// Looks (stage 3): one style sheet in the game page (#studio-ui-edit), written again from the state on each change:
//   - the person's colours as the loader writes them (a plain rule for the normal look, !important for a state's), so
//     what the editor shows is what the game will show;
//   - a button's look shown on request ("Hover" on the card): the page's :hover / :active / :disabled rules that touch
//     that button, copied with the pseudo-class turned into [data-studio-state~="hover"] (CSS cannot be told "this is
//     hovered"), and the attribute on the button. Never the real `disabled`: a disabled button takes no pointer, and the
//     person must still be able to drag it;
//   - no transitions on marked elements while this sheet is up (a 0.2 s colour fade would make the card read the colour
//     halfway).
// The text and its size go on the text itself (uiTextPart, shared with the loader); the colour of a text inside the
// element too (inline); the colour of an element that is its own text (a button) and the fill in the sheet, inline only
// when the game's own normal rule is more specific than one attribute (the same test as the loader's).
import type { BridgeToShell, ShellToBridge, UiPropName, UiProps, UiScreenInfo, UiState, UiStyleSet, UiThemeVar } from '../contract.ts';
import { uiTextNode, uiTextPart } from '../loader/studio-placement.js';
import { mergeThemeVars } from './code-theme.ts';

export interface UiExtrasDeps {
  win: Window;
  post(msg: BridgeToShell): void;
  /** The UI layer's list changed (another screen is shown): the editor lists it again. */
  relist(): void;
  /**
   * studio-canvas-ui stage 2 (2026-10-24): the screens of the UI the game draws in its canvas (codeUi `screen`) and the
   * one it draws now — one list with the HTML screens (the same id is one screen: data-studio-screen="over" and
   * codeUi('retry', { screen: 'over' }) are the same "Game over"). Absent / [] = the HTML screens alone, as before.
   */
  more?(): { screens: UiScreenInfo[]; current: string | null } | null;
  /**
   * studio-canvas-ui-3 (2026-10-24): the theme of the UI the game draws in its canvas (codeTheme, code-theme.ts) — one
   * Theme with the CSS variables (the same name = one row). Absent / [] = the CSS variables alone, as before.
   */
  moreTheme?(): UiThemeVar[];
}

export interface UiExtras {
  /** Editing starts: tell the shell the screens and the theme (only when the game has any). */
  begin(): void;
  /** Editing ends (Play, the end): screens, samples and looks shown back as the game makes them; set / theme stay. */
  end(): void;
  /** A studio:ui/* message from the shell; false = not one of ours. */
  handle(msg: ShellToBridge): boolean;
  /** The props of a UI element for the card (null = no such element drawn). */
  props(key: string): UiProps | null;
  /** The HTML screen on screen now (the one shown, else the one the game draws; null = none). */
  screenNow(): string | null;
}

const KEY = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;
const THEME_NAME = /^--[A-Za-z0-9_-]{1,60}$/;
const STATES: UiState[] = ['hover', 'active', 'disabled'];
const PSEUDO: Record<UiState, RegExp> = { hover: /:hover\b/g, active: /:active\b/g, disabled: /:disabled\b/g };
const PSEUDO_CSS: Record<UiState, string> = { hover: ':hover', active: ':active', disabled: ':disabled' };

/** "rgb(255, 246, 216)" → "#fff6d8" (an alpha below 1 keeps the rgba() form: the colour field cannot show it). */
export function hexColor(c: string): string {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(c.trim());
  if (!m) return c.trim();
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (a < 1) return `rgba(${Math.round(+m[1]!)}, ${Math.round(+m[2]!)}, ${Math.round(+m[3]!)}, ${Math.round(a * 1000) / 1000})`;
  return '#' + [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(+v!))).toString(16).padStart(2, '0')).join('');
}
const clear = (c: string) => /^rgba\([^)]*,\s*0\)$/.test(c.replace(/\s+/g, ' ')) || c === 'transparent';

/** Split a selector list at its top-level commas (":is(a, b)" stays one). */
function splitSelectors(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

export function createUiExtras(deps: UiExtrasDeps): UiExtras {
  const { win } = deps;
  const doc = win.document;

  // ---- the page's style rules (same-origin sheets only; a cross-origin one cannot be read and is skipped) ----
  const styleRules = (): CSSStyleRule[] => {
    const out: CSSStyleRule[] = [];
    const walk = (list: CSSRuleList) => {
      for (const r of Array.from(list)) {
        if ((r as CSSStyleRule).selectorText !== undefined && (r as CSSStyleRule).style) out.push(r as CSSStyleRule);
        else if ((r as CSSMediaRule).media && (r as CSSMediaRule).cssRules) {
          if (win.matchMedia((r as CSSMediaRule).media.mediaText || 'all').matches) walk((r as CSSMediaRule).cssRules);
        } else if ((r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
      }
    };
    for (const sh of Array.from(doc.styleSheets)) {
      if ((sh.ownerNode as Element | null)?.id === 'studio-ui-edit' || (sh.ownerNode as Element | null)?.id === 'studio-edit-layer') continue;
      try {
        walk(sh.cssRules);
      } catch {
        /* cross-origin: not readable */
      }
    }
    return out;
  };
  const matches = (el: Element, sel: string) => {
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  };

  // ---------------------------------------------------------------- screens
  const screenEls = () => Array.from(doc.querySelectorAll<HTMLElement>('[data-studio-screen]')).filter((e) => KEY.test(e.dataset.studioScreen || ''));
  const drawn = (e: Element) => e.getClientRects().length > 0 && win.getComputedStyle(e).visibility !== 'hidden';
  let forced: string | null = null;
  const kept = new Map<HTMLElement, { hidden: string | null; style: Array<[string, string, string]> }>();
  const keep = (e: HTMLElement, props: string[]) => {
    if (!kept.has(e)) kept.set(e, { hidden: e.getAttribute('hidden'), style: props.map((p) => [p, e.style.getPropertyValue(p), e.style.getPropertyPriority(p)]) });
  };
  const putBack = () => {
    for (const [e, k] of kept) {
      if (k.hidden === null) e.removeAttribute('hidden');
      else e.setAttribute('hidden', k.hidden);
      for (const [p, v, pr] of k.style) {
        if (v) e.style.setProperty(p, v, pr);
        else e.style.removeProperty(p);
      }
      if (!e.getAttribute('style')) e.removeAttribute('style');
    }
    kept.clear();
  };
  /** The display the page's own CSS gives this container when shown (not `none`), else block. */
  const ownDisplay = (e: HTMLElement): string => {
    let d = '';
    for (const r of styleRules()) {
      const v = r.style.getPropertyValue('display');
      if (v && v !== 'none' && matches(e, r.selectorText)) d = v;
    }
    return d || 'block';
  };
  const showScreen = (id: string | null) => {
    putBack();
    forced = id;
    if (id === null) return;
    for (const e of screenEls()) {
      keep(e, ['display', 'visibility', 'opacity']);
      if (e.dataset.studioScreen !== id) {
        e.style.setProperty('display', 'none', 'important');
        continue;
      }
      e.removeAttribute('hidden');
      if (win.getComputedStyle(e).display === 'none') e.style.setProperty('display', ownDisplay(e), 'important');
      const cs = win.getComputedStyle(e);
      if (cs.visibility === 'hidden') e.style.setProperty('visibility', 'visible', 'important');
      if (cs.opacity === '0') e.style.setProperty('opacity', '1', 'important');
    }
  };
  const screens = (): UiScreenInfo[] => {
    const seen = new Set<string>();
    const out: UiScreenInfo[] = [];
    for (const e of screenEls()) {
      const id = e.dataset.studioScreen!;
      if (seen.has(id)) continue;
      seen.add(id);
      const label = (e.dataset.studioScreenLabel || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      out.push(label ? { id, label } : { id });
    }
    return out;
  };
  const current = (): string | null => forced ?? screenEls().find(drawn)?.dataset.studioScreen ?? null;
  const postScreens = () => {
    const list = screens();
    const more = deps.more?.();
    // The canvas UI's screens after the HTML ones (stage 2): a canvas-only screen joins the menu; the same id is one.
    // Only one screen in all (the canvas's alone) = no menu, as a game with no screens.
    if (more) for (const s of more.screens) if (!list.some((x) => x.id === s.id)) list.push(s);
    const htmlCount = screens().length;
    if (list.length && (htmlCount || list.length > 1)) deps.post({ type: 'studio:ui/screens', screens: list, current: current() ?? more?.current ?? null, forced: forced !== null });
  };

  // ---------------------------------------------------------------- elements
  const byKey = (key: string): HTMLElement[] => (KEY.test(key) ? Array.from(doc.querySelectorAll<HTMLElement>(`[data-studio-key="${key}"]`)) : []);
  const first = (key: string) => byKey(key).find((e) => e.getClientRects().length) || null;
  const isButton = (e: HTMLElement) => {
    const tag = e.tagName.toLowerCase();
    return tag === 'button' || e.getAttribute('role') === 'button' || (tag === 'input' && /^(button|submit|reset)$/.test((e as HTMLInputElement).type));
  };
  /** Where a sample value goes: the element's data-studio-value (a score's number), else its text. */
  const sampleTarget = (e: HTMLElement): { el: HTMLElement; value: boolean } | null => {
    const v = e.matches('[data-studio-value]') ? e : e.querySelector<HTMLElement>('[data-studio-value]');
    if (v) return { el: v, value: true };
    const p = uiTextPart(e) as HTMLElement | null;
    return p ? { el: p, value: false } : null;
  };

  // The person's values (key → name or "@hover.color" → value) and the game's own, read once before the first change.
  const sets = new Map<string, Map<string, string | number>>();
  const was = new Map<string, Map<string, string | number>>();
  // Inline values this file wrote over, to put back when a value goes back to the game's (null).
  const inlineWas = new Map<HTMLElement, Map<string, string>>();
  const samples = new Map<string, { el: HTMLElement; node: Text | null; old: string }>();
  let shown: { key: string; state: UiState } | null = null;

  const readNow = (e: HTMLElement): UiStyleSet => {
    const part = uiTextPart(e) as HTMLElement | null;
    const out: UiStyleSet = {};
    if (part) {
      const n = uiTextNode(part) as Text | null;
      if (n) out.text = n.data.replace(/\s+/g, ' ').trim();
      out.fontSize = Math.round(parseFloat(win.getComputedStyle(part).fontSize) * 10) / 10;
      out.color = hexColor(win.getComputedStyle(part).color);
    } else if (isButton(e)) out.color = hexColor(win.getComputedStyle(e).color);
    const bg = win.getComputedStyle(e).backgroundColor;
    if (!clear(bg)) out.background = hexColor(bg);
    return out;
  };
  /** The game's own value of one field (`name` or "@hover.color"), read the first time it is asked. */
  const wasOf = (key: string, path: string): string | number | undefined => {
    const m = was.get(key) || new Map<string, string | number>();
    was.set(key, m);
    if (!m.has(path)) {
      const e = first(key);
      if (!e) return undefined;
      const [st, name] = path.startsWith('@') ? (path.slice(1).split('.') as [UiState, UiPropName]) : [null, path as UiPropName];
      let v: string | number | undefined;
      if (st) {
        // The state's look as the game draws it: shown without the person's own colours for that state.
        const keepShown = shown;
        const own = sets.get(key);
        const saved = own ? new Map(own) : null;
        if (own) for (const k of [...own.keys()]) if (k.startsWith(`@${st}.`)) own.delete(k);
        shown = { key, state: st };
        paint();
        v = readNow(e)[name as 'color' | 'background'];
        if (own && saved) for (const [k, x] of saved) own.set(k, x);
        shown = keepShown;
        paint();
      } else v = readNow(e)[name];
      if (v !== undefined) m.set(path, v);
    }
    return m.get(path);
  };
  const setInline = (e: HTMLElement, prop: string, v: string | null) => {
    const m = inlineWas.get(e) || new Map<string, string>();
    inlineWas.set(e, m);
    if (!m.has(prop)) m.set(prop, e.style.getPropertyValue(prop));
    if (v === null) {
      const old = m.get(prop) || '';
      if (old) e.style.setProperty(prop, old);
      else e.style.removeProperty(prop);
    } else e.style.setProperty(prop, v);
  };

  let sheet: HTMLStyleElement | null = null;
  // While editing only: no transitions on marked elements (Play shows the game's own, with its fades).
  let editingNow = false;
  /** The style sheet (see the top): the person's colours, the shown state, no transitions. */
  const paint = () => {
    const rules: string[] = [];
    for (const [key, m] of sets) {
      const sel = `[data-studio-key="${key}"]`;
      const e = first(key);
      const part = e ? (uiTextPart(e) as HTMLElement | null) : null;
      if (m.has('background')) rules.push(`${sel}{background-color:${m.get('background')}}`);
      if (m.has('color') && part === e) rules.push(`${sel}{color:${m.get('color')}}`);
      for (const st of STATES) {
        const on = `${sel}${PSEUDO_CSS[st]},${sel}[data-studio-state~="${st}"]`;
        const bg = m.get(`@${st}.background`), c = m.get(`@${st}.color`);
        if (bg !== undefined) rules.push(`${on}{background-color:${bg}!important}`);
        if (c !== undefined) rules.push(`${sel}${PSEUDO_CSS[st]},${sel}${PSEUDO_CSS[st]} *,${sel}[data-studio-state~="${st}"],${sel}[data-studio-state~="${st}"] *{color:${c}!important}`);
      }
    }
    // A shown state: the page's own rules for it, copied onto the attribute.
    for (const e of Array.from(doc.querySelectorAll<HTMLElement>('[data-studio-state]'))) delete e.dataset.studioState;
    if (shown) {
      const els = byKey(shown.key);
      for (const e of els) e.dataset.studioState = shown.state;
      const re = PSEUDO[shown.state];
      for (const r of styleRules()) {
        if (!r.selectorText.includes(PSEUDO_CSS[shown.state])) continue;
        const sels = splitSelectors(r.selectorText).filter((s) => {
          re.lastIndex = 0;
          if (!re.test(s)) return false;
          const base = s.replace(re, '') || '*';
          return els.some((e) => matches(e, base) || !!e.querySelector(base));
        });
        if (sels.length) rules.push(`${sels.map((s) => s.replace(re, `[data-studio-state~="${shown!.state}"]`)).join(',')}{${r.style.cssText}}`);
      }
    }
    if (!rules.length && !shown && !editingNow) {
      sheet?.remove();
      sheet = null;
      return;
    }
    if (!sheet || !sheet.isConnected) {
      sheet = doc.createElement('style');
      sheet.id = 'studio-ui-edit';
      (doc.head || doc.documentElement).appendChild(sheet);
    }
    sheet.textContent = [...(editingNow ? ['[data-studio-key],[data-studio-key] *{transition:none!important}'] : []), ...rules].join('\n');
  };

  /** One field of one element: the person's value, or (null) the game's own again. */
  const setProp = (key: string, name: UiPropName, value: string | number | null, state?: UiState) => {
    const els = byKey(key);
    if (!els.length) return;
    const path = state ? `@${state}.${name}` : name;
    if (state && name !== 'color' && name !== 'background') return;
    wasOf(key, path); // read before the first change
    const m = sets.get(key) || new Map<string, string | number>();
    sets.set(key, m);
    if (value === null) m.delete(path);
    else m.set(path, value);
    if (!m.size) sets.delete(key);
    for (const e of els) {
      const part = uiTextPart(e) as HTMLElement | null;
      if (state) continue; // states are the sheet's
      if (name === 'text' && part) {
        const n = uiTextNode(part) as Text | null;
        if (!n) continue;
        // A sample in the same text goes: the words typed are the real ones now.
        const sm = samples.get(key);
        if (sm && sm.node === n) {
          n.data = sm.old;
          samples.delete(key);
        }
        const old = was.get(key)?.get('text');
        const words = value === null ? (typeof old === 'string' ? old : n.data.trim()) : String(value).slice(0, 200);
        const sp = /^(\s*)[\s\S]*?(\s*)$/.exec(n.data);
        n.data = (sp?.[1] ?? '') + words + (sp?.[2] ?? '');
      } else if (name === 'fontSize' && part) setInline(part, 'font-size', value === null ? null : `${Number(value)}px`);
      else if (name === 'color' && part && part !== e) setInline(part, 'color', value === null ? null : String(value));
    }
    paint();
    // The game's normal rule more specific than one attribute: the value inline (as the loader does).
    for (const e of els) {
      const part = uiTextPart(e) as HTMLElement | null;
      const check = (prop: 'color' | 'background-color', v: string | number | undefined) => {
        if (v === undefined) return setInline(e, prop, null);
        const now = hexColor(win.getComputedStyle(e).getPropertyValue(prop));
        if (now !== hexColor(cssColor(String(v)))) setInline(e, prop, String(v));
      };
      if (!state && name === 'background') check('background-color', sets.get(key)?.get('background'));
      if (!state && name === 'color' && part === e) check('color', sets.get(key)?.get('color'));
    }
  };
  const probe = doc.createElement('i');
  const cssColor = (c: string) => {
    probe.style.color = '';
    probe.style.color = c;
    probe.style.display = 'none';
    doc.documentElement.appendChild(probe);
    const v = win.getComputedStyle(probe).color;
    probe.remove();
    return v;
  };

  const sample = (key: string, text: string | null) => {
    const e = first(key);
    if (!e) return;
    const old = samples.get(key);
    if (old) {
      if (old.node) old.node.data = old.old;
      else old.el.textContent = old.old;
      samples.delete(key);
    }
    if (text === null) return;
    const t = sampleTarget(e);
    if (!t) return;
    const words = text.slice(0, 200);
    if (t.value) {
      samples.set(key, { el: t.el, node: null, old: t.el.textContent || '' });
      t.el.textContent = words;
    } else {
      const n = uiTextNode(t.el) as Text | null;
      if (!n) return;
      samples.set(key, { el: t.el, node: n, old: n.data });
      const sp = /^(\s*)[\s\S]*?(\s*)$/.exec(n.data);
      n.data = (sp?.[1] ?? '') + words + (sp?.[2] ?? '');
    }
  };

  const props = (key: string): UiProps | null => {
    const e = first(key);
    if (!e) return null;
    const now = readNow(e);
    const part = uiTextPart(e);
    const st = shown && shown.key === key ? shown.state : null;
    // A look shown: its game's own colours read first, so this answer already carries them.
    if (st) for (const n of ['color', 'background'] as const) wasOf(key, `@${st}.${n}`);
    const w: UiStyleSet = {};
    for (const n of ['text', 'fontSize', 'color', 'background'] as const) {
      const v = wasOf(key, n);
      if (v !== undefined) (w as Record<string, unknown>)[n] = v;
    }
    for (const s of STATES) {
      const o: Record<string, unknown> = {};
      for (const n of ['color', 'background'] as const) if (was.get(key)?.has(`@${s}.${n}`)) o[n] = was.get(key)!.get(`@${s}.${n}`);
      if (Object.keys(o).length) (w as Record<string, unknown>)[`@${s}`] = o;
    }
    const t = sampleTarget(e);
    const hint = (e.dataset.studioSample || t?.el.dataset.studioSample || '').slice(0, 200);
    return {
      key,
      state: st,
      button: isButton(e),
      text: part ? now.text ?? null : null,
      fontSize: part ? now.fontSize ?? null : null,
      color: now.color ?? null,
      background: now.background ?? null,
      was: w,
      sample: t ? { now: samples.get(key) ? (samples.get(key)!.node ? samples.get(key)!.node!.data.trim() : samples.get(key)!.el.textContent) : null, value: t.value, ...(hint ? { hint } : {}) } : null,
    };
  };
  const postProps = (key: string) => {
    const p = props(key);
    if (p) deps.post({ type: 'studio:ui/props', props: p });
  };

  // ---------------------------------------------------------------- theme
  const themeWas = new Map<string, string>();
  const themeVars = (): UiThemeVar[] => {
    const names: string[] = [];
    for (const r of styleRules()) {
      if (!splitSelectors(r.selectorText).some((s) => s === ':root' || s === 'html')) continue;
      for (let i = 0; i < r.style.length; i++) {
        const n = r.style[i]!;
        if (n.startsWith('--') && THEME_NAME.test(n) && !names.includes(n)) names.push(n);
      }
    }
    const cs = win.getComputedStyle(doc.documentElement);
    const out: UiThemeVar[] = [];
    for (const name of names.slice(0, 100)) {
      const value = cs.getPropertyValue(name).trim();
      if (!value) continue;
      if (!themeWas.has(name)) themeWas.set(name, value);
      const type = /font|family|typeface/i.test(name) ? 'font' : (win as Window & { CSS?: typeof CSS }).CSS?.supports?.('color', value) && !/^[\d.]+$/.test(value) ? 'color' : null;
      if (!type) continue;
      out.push({ name, type, value: type === 'color' ? hexColor(cssColor(value)) : value, was: type === 'color' ? hexColor(cssColor(themeWas.get(name)!)) : themeWas.get(name)! });
    }
    return out;
  };
  const postTheme = () => {
    const vars = mergeThemeVars(themeVars(), deps.moreTheme?.() ?? []);
    if (vars.length) deps.post({ type: 'studio:ui/theme', vars });
  };
  const setTheme = (name: string, value: string | null) => {
    if (!THEME_NAME.test(name)) return;
    if (!themeWas.has(name)) themeVars();
    if (value === null) doc.documentElement.style.removeProperty(name);
    else if (!/[;{}<>\\]/.test(value)) doc.documentElement.style.setProperty(name, value.slice(0, 200));
  };

  return {
    begin() {
      editingNow = true;
      if (forced !== null) showScreen(forced);
      paint();
      postScreens();
      postTheme();
    },
    end() {
      editingNow = false;
      for (const k of [...samples.keys()]) sample(k, null);
      shown = null;
      putBack();
      paint();
    },
    props,
    screenNow: () => current(),
    handle(msg) {
      switch (msg.type) {
        case 'studio:ui/screen':
          showScreen(typeof msg.id === 'string' && KEY.test(msg.id) ? msg.id : null);
          shown = null;
          paint();
          postScreens();
          deps.relist();
          return true;
        case 'studio:ui/sample':
          sample(msg.key, typeof msg.text === 'string' ? msg.text : null);
          postProps(msg.key);
          return true;
        case 'studio:ui/set':
          if (msg.name === 'text' || msg.name === 'fontSize' || msg.name === 'color' || msg.name === 'background') {
            const v = msg.value === null ? null : msg.name === 'fontSize' ? Math.max(1, Math.min(500, Number(msg.value) || 0)) : String(msg.value);
            setProp(msg.key, msg.name, v, msg.state && STATES.includes(msg.state) ? msg.state : undefined);
          }
          if (!msg.quiet) postProps(msg.key);
          return true;
        case 'studio:ui/state':
          shown = msg.key && msg.state && STATES.includes(msg.state) ? { key: msg.key, state: msg.state } : null;
          paint();
          if (msg.key) postProps(msg.key);
          return true;
        case 'studio:ui/theme-set':
          setTheme(msg.name, typeof msg.value === 'string' ? msg.value : null);
          if (!msg.quiet) postTheme();
          return true;
        case 'studio:ui/props-get':
          postProps(msg.key);
          return true;
        default:
          return false;
      }
    },
  };
}
