// The placement tool's panel: the selected object (with editable numbers)
// and the object list (thumbnail and name; objects of the same group shown
// once as "name ×N", expandable).
//
// 2D adapters that report a draw order (Item.layer) get a "Layer" row on the
// card (to back / backward / forward / to front) and the list switches to draw
// order, front on top, one row per object (no "×N" groups: each object has its
// own place), reorderable by dragging the grip with a mouse or a finger.
//
// Rebrand 2026-10-16 ("one list, one card, one input"): the panel is split in
// two places. The LIST (`el`) is the left column, 28 px rows with a 16 px
// picture. The CARD (`cardEl`) floats over the game's top right corner on PC
// (272 px) and sits right above the ask bar on a phone (56 px: picture, name,
// the numbers in one mono line, copy, delete, "…" for the fields), only while
// something is picked. The card, top to bottom: picture · name · copy ·
// delete, then the numbers — no longer folded under "Exact values" on PC
// (hidden one level down, nobody used them) —, the 2D layer row, the game's
// rules, the files it uses, notes. The ask box ("… ask your AI") is built
// here too but lives in the bar at the bottom of the game (main.ts), where it
// is also the ⌘K list (palette.ts).
//
// Several selected (CONTRACT.md §1.8): the card says how many and keeps the
// ask box, the actions and the layer row (they work on all of them); the
// numbers are for one object only. Above the list, "Select several" switches
// presses (in the game and in the list) to add / take out instead of
// replacing; the heading of a "name ×N" group selects the whole group.
import type { Dim, Item, Pose } from '../contract.ts';
import { h, safeImageSrc } from './dom.ts';
import { hasLayer, layerBlocks, layerTarget, siblingsOf, type LayerOp } from './layers.ts';
import { groupLayerPossible, sameKind } from './edit-ops.ts';
import { icon, setButton } from './icons.ts';
import { afterKnob, knobHeld } from './knob.ts';
import { tipText } from './keymap.ts';
import { displayName, isGuessed, nameParts } from './names.ts';
import { toneThumb } from './thumb-tone.ts';

export interface PlacementPanelDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  items(): Item[];
  selected(): string | null;
  pose(key: string): Pose | undefined;
  dim(): Dim;
  thumb(key: string): string | null;
  /** Press on a row: `add` (Shift, or "Select several" mode) adds / takes out instead of replacing. */
  select(key: string, add?: boolean): void;
  selectMany(keys: string[], primary: string): void;
  /** The whole selection (more than one = several selected). */
  group(): string[];
  multi(): boolean;
  setMulti(on: boolean): void;
  /**
   * Rename `key` in place (studio-uniforms, 2026-10-23: the card's name turns into a field — F2, or the menu's Rename);
   * '' = back to the game's own name. Absent = no rename here.
   */
  rename?(key: string, name: string): void;
  copy(): void;
  remove(): void;
  /** Phone layout (no Shift key, no box: the hints say so). */
  phone(): boolean;
  /**
   * UI stage 2 (2026-10-22, ui-screens.ts): the UI list's head in a game with screens ("Title ⌄  1 of 4"); null (or
   * absent) = "On screen" as before.
   */
  uiHead?(): HTMLElement | null;
  /**
   * studio-canvas-ui stage 2 (2026-10-24): the list's one line when it is empty on the UI layer of a game whose UI is
   * drawn in its picture ("No selectable UI yet"); null = nothing (the world's empty list, as before). The why and the
   * ✦ are said once, in the line over the ask field (ui-missing.ts), not here.
   */
  emptyNote?(): string | null;
  /** UI stages 2–3 (ui-card.ts): a UI element's look rows, under its offset and size. Absent = none. */
  uiLook?(key: string): HTMLElement[];
  /** UI stage 3 (ui-theme.ts): the Theme fold under the UI list; null = a game without theme variables. */
  uiFoot?(): HTMLElement | null;
  /** "⌘D", "⌫"… for tooltips. */
  shortcutOf(what: 'copy' | 'remove' | 'all'): string;
  /** A number was typed: apply as one undo step. */
  setPose(key: string, pose: Pose): void;
  /** Change the draw order (one undo step). `to` = a LayerOp or a front-first drop index among the siblings. */
  reorder(key: string, to: LayerOp | number): void;
  /** Shortcut text for the layer buttons' tooltips, e.g. "⌘]" or "Ctrl+]". */
  shortcut(op: LayerOp): string;
  /**
   * The objects the card is about. One today; a multi-selection (edit-ops)
   * returns them all and the ask box says "the 4 you picked".
   */
  selectedKeys(): string[];
  /** Hand the person's words about these objects (and files) to the AI (host.request). Resolves true when kept. */
  ask(keys: string[], text: string, files: string[]): Promise<boolean>;
  /**
   * The AI asked the person something and waits (2026-10-19): the field answers it ("Answer your AI…", no chip;
   * `ask` then sends an answer). Absent = never.
   */
  answering?(): boolean;
  /** The whole-game placeholder, by whether the AI is there (main.ts, ai-presence.ts). Absent: "Ask your AI…". */
  askGame?(): string;
  /**
   * Files picked in the Library while it is open ("use the Library", 2026-10-18): the chip names them with the
   * objects, and the words are sent about both. Absent / empty = objects only.
   */
  assets?(): string[];
  /** Motions picked in the Library (studio-motion-triggers): the chip names them with the objects and files. */
  motions?(): string[];
  /**
   * What a button said the ask is about (studio-code-keepout: a layout's "✦ Describe with text"): the chip reads `chip`
   * ("crystal ×12") with a second, violet chip `tag` ("Keep-out areas"), and the field shows `ph` as its example.
   * null = the ordinary chip.
   */
  askTopic?(): { chip: string; tag?: string; ph: string; pic?: string; tip?: string } | null;
  /** The card's "Show in Library →": the Library with this pick's detail. Absent = no Library in this build. */
  showInLibrary?(): void;
  /** Ask the AI to name these objects (the "no name" warning). */
  askName(keys: string[]): Promise<boolean>;
  /**
   * ✦ "Ask AI to name it…" on one object's card (studio-uniforms, 2026-10-23): a draft in the AI box, nothing sent —
   * like every ✦ (the card's button sent at once before; one ✦ that sends teaches that the rule is soft). Absent = askName.
   */
  nameDraft?(keys: string[]): void;
  /** The mouse is over these objects' row, the card or the chip (light them in the game); [] = it left. */
  hover?(keys: string[]): void;
  /**
   * The asset files this object uses (Scene → Assets link, "Assets:
   * tree.png" on the card). Absent = no Assets tool in this build.
   */
  files?(key: string): Promise<Array<{ path: string; name: string; src?: string }>>;
  /** Open one file's detail in Assets. */
  openFile?(path: string): void;
  /** The game's rules for this object, as short words ("Grid 1", "45° steps"), each with the knob it binds. */
  rules?(key: string): Array<{ text: string; k: 'pos' | 'rot' | 'size' }>;
  /** Moved / copied / reordered since the last save (a dot on its row). */
  unsaved?(key: string): boolean;
  /** What the AI's last change did to this object, seen after reloading the game. */
  aiMark?(key: string): 'moved' | 'added' | null;
  /**
   * Drag on a number's label: `end` false = live (no undo step), true = the
   * drag is over, record one undo step from `from`.
   */
  scrub?(key: string, pose: Pose, end: boolean, from: Pose): void;
  /**
   * "Unlock" on a held ground / road / sky (Item.held 'ground', bridge/hold.ts). Not on the card any more
   * (studio-card-doors, 2026-10-23): the one way is the pressable word in the line under the strip (bridge/handles.ts).
   * Kept for a .studio/ui/ script that calls it.
   */
  unhold?(keys: string[]): void;
  /**
   * The card's ⋯ (studio-card-doors, 2026-10-23): opens the rows at the button (main.ts draws them with the context
   * menu). Absent = no ⋯, and the rows are not shown at all.
   */
  cardMenu?(at: HTMLElement, rows: Array<{ id: string; label: string; run(): void }>): void;
  /**
   * The Motion row under Size (motion-gui, 2026-10-22; since studio-timeline the same day: the object's motions and
   * the button that opens the timeline, timeline-wire.ts cardRow). Absent = no row (the UI layer, a build without it).
   */
  motion?: (key: string) => HTMLElement[];
  /**
   * An object a code layout of the game put (studio-code-knobs, 2026-10-24; code-place-wire.ts): the card's Layout block
   * (the rule's kind and count, its knobs, "Convert to coordinates") — `numbers` false = in place of Position / Rotation /
   * Size, which the rule decides; true = above the object's own numbers (one put by hand). null / absent = an ordinary object.
   * `after` = under the numbers (studio-hand-marks: one placed by hand has its rule's block there).
   */
  layout?: (key: string) => { els: HTMLElement[]; numbers: boolean; after?: HTMLElement[] } | null;
  /**
   * The list: a code layout's objects under one heading with its tag ("hex ×4 [Rule]"). null / absent = as before.
   * `hand` (studio-to-coords, 2026-10-24): this one is placed by hand outside its rule (⌥) — its row's tag "Placed by hand"
   * (studio-hand-marks: picked, the hand alone and "Back to rule"), and "✋ 2" on the heading, so a lamp left out of its
   * row is seen with the row folded.
   */
  ruleTag?: (key: string) => { group: string; tag: string; tip: string; hand?: { tag: string; tip: string; reset: string; run(): void } } | null;
  /** The card's ⋯ rows for a code layout's object ("Convert to coordinates", "Reset to rule"). [] / absent = none. */
  ruleRows?: (key: string) => Array<{ id: string; label: string; run(): void }>;
  /**
   * ✦ Turn into a rule (studio-code-torule, 2026-10-24; need 3, the plan's picture n3-place): several hand-placed objects
   * picked → the chat box gets their chip and the draft "Turn into a close rule" (nothing is sent: the person sends it,
   * or adds "6 m apart" first). null / absent = not for these (one object, a rule's own objects, the UI, no AI here).
   */
  toRule?: (keys: string[]) => (() => void) | null;
  /**
   * studio-code-torule: a hand-placed object a rule layout took the place of (`places[id].from`, hidden in the game until
   * the AI takes it out of the code): not in the list, so the list says what the game shows (one "Street lamps ×6 [Rule]",
   * not that and the hidden "lamp ×6"). ⌘Z of the swap brings the row back. Absent = none.
   */
  replaced?: (key: string) => boolean;
}

export interface PlacementPanel {
  /** The object list (left column / phone sheet). */
  el: HTMLElement;
  /** The picked object's card (floating over the game). */
  cardEl: HTMLElement;
  /** "Ask your AI to name the N without a name" (the left column's foot). */
  noNameEl: HTMLElement;
  /** The list's head ("Objects" ··· "Multi-select"): narrow screens move it into the sheet's one head row (main.ts). */
  listToolsEl: HTMLElement;
  /** The ask box (form): the shell puts it in the strip under the game. */
  askEl: HTMLElement;
  /** Its one-line note (examples, "handed to your AI"): the shell puts it in the strip's caption. */
  askNoteEl: HTMLElement;
  /** Refresh the ask box for the current selection (any tool, any page). */
  renderAsk(): void;
  render(): void;
  /** Cheap update while dragging: numbers only. */
  updateNumbers(): void;
  /** Redraw the rows' marks (unsaved dot, "AI") without rebuilding the list. */
  markRows(): void;
  updateThumb(key: string): void;
  /** Rename in place: the card's name of `key` becomes a field (F2, the menu's Rename). */
  startRename(key: string): void;
  isRenaming(): boolean;
}

const DEG = 180 / Math.PI;

/**
 * The ask chip's short form of a shown name: the guessed name's place and count dropped ("Black pillar by the
 * road (left, 3rd)" → "Black pillar"; the same in Japanese); other names as they are (CSS cuts what is long).
 */
export function shortName(name: string): string {
  const s = nameParts(name).base.replace(/^道路わきの/, '').replace(/ by the road$/, '');
  return s.trim() || name;
}

export function createPlacementPanel(d: PlacementPanelDeps): PlacementPanel {
  const el = h('div', { class: 'placement' });
  const card = h('section', { class: 'card', 'aria-live': 'polite', dataset: { part: 'card' } });
  // A mouse over the card lights what it is about in the game; over a list row, that row's objects (renderList).
  const hoverLights = (el: HTMLElement, keys: () => string[]) => {
    el.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && d.hover?.(keys()));
    el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && d.hover?.([]));
  };
  hoverLights(card, () => d.group().length > 1 ? d.group() : d.selectedKeys());
  // "102 objects have no name · Name them": the FIRST row of the list, grey, with one text button on the right
  // (supervision 2026-10-17, U4/W1-8: "in the list, its first row, not above it: the list keeps its shape; no yellow,
  // no frame"). It was a foot row of the column ("✦ Ask your AI to name it 102"), which a person with 102 unnamed
  // rows never scrolled to, and which read as a request already made. 2D games list "graphics (no name)" rows too.
  const noName = h('div', { class: 'noname', dataset: { part: 'noname' }, hidden: true });
  const list = h('ul', { class: 'objects', role: 'listbox', 'aria-label': d.t('btn.list'), 'aria-multiselectable': 'true' });
  // The list's head: its name and count on the left, "Select" on the right
  // (the way lists on phones and Macs enter picking several: a word at the
  // top right that turns into "Done"). Phones have no Shift key; on PC the
  // mode also lets a mouse drag from an empty spot draw a box.
  const listTools = h('div', { class: 'list-tools', dataset: { part: 'list-tools' } });
  // The how-to paragraph and the colour key under the list went (rebrand):
  // a one-line first hint over the ask bar says it once (main.ts), and the
  // editor's colours have one meaning each (orange = you, violet = the AI).
  // The UI list's foot (the Theme fold, UI stage 3): scrolls with the list, after its last row.
  const listFoot = h('div', { class: 'list-foot', dataset: { part: 'list-foot' } });
  const listScroll = h('div', { class: 'list-scroll' }, noName, list, listFoot);
  // A mouse over a row lights its object (a "name ×N" heading: all of them) in the game; leaving the list puts it out.
  let hoverRow: Element | null = null;
  list.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const row = (e.target as HTMLElement).closest('li.obj');
    if (row === hoverRow) return;
    hoverRow = row;
    if (!row) return d.hover?.([]);
    const g = (row as HTMLElement).dataset.group, key = (row as HTMLElement).dataset.key;
    d.hover?.(g ? d.items().filter((i) => (i.group || `key:${i.key}`) === g).map((i) => i.key) : key ? [key] : []);
  });
  list.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    hoverRow = null;
    d.hover?.([]);
  });
  el.append(listTools, listScroll);
  let noNameSent = false;
  // Narrow screens (the side window next to a chat, phones; a try on 2026-10-19 with an AI-written runner): the unnamed
  // objects fold into this ONE row — "Unnamed objects 36 · Ask AI to name them" — instead of 36 rows that all read
  // "Unnamed group" under a heading that says the same (the list was nothing but that line; which one is which was
  // anybody's guess). ▸ opens them, each as a picture and where it stands (x · z), not the same name again; the
  // picked one shows under the folded row too. PC keeps its rows: its column is tall enough to scroll them.
  // FOLD_MIN: one or two unnamed objects read fine as rows; the fold is for "nothing but unnamed".
  const FOLD_MIN = 3;
  let foldOpen = false;
  const folding = () => d.phone() && !d.items().some(hasLayer) && d.items().filter((i) => i.unstable).length >= FOLD_MIN;
  /**
   * The list's "Ask AI to name them" (studio-card-doors, 2026-10-23; the ✦ rule of studio-uniforms): a draft in the AI
   * box with those objects picked — nothing sent until the person sends. It sent a request at once before (the plan's
   * inventory, item 4: "a button that sends at once" next to ✦ rows that only draft). No draft here (the web demo):
   * the old send.
   */
  const askNames = async (keys: string[]) => {
    if (d.nameDraft) return d.nameDraft(keys);
    noNameSent = await d.askName(keys);
    renderNoName();
  };
  const renderNoName = () => {
    const keys = d.items().filter((i) => i.unstable).map((i) => i.key);
    noName.replaceChildren();
    noName.hidden = !keys.length;
    noName.classList.toggle('fold', folding());
    // The folded row's picture is its first object's: main.ts asks the game for the pictures of rows with a key.
    if (folding() && keys.length) noName.dataset.key = keys[0]!;
    else delete noName.dataset.key;
    if (!keys.length) return;
    if (folding()) {
      noName.append(
        h('button', { type: 'button', class: 'expand', 'aria-expanded': String(foldOpen), 'aria-label': d.t(foldOpen ? 'ops.collapse' : 'ops.expand'), dataset: { action: 'noname-fold' },
          onclick: () => ((foldOpen = !foldOpen), renderNoName(), renderList()) }, icon('chevronRight')),
        thumbImg(keys[0]!),
        h('span', { class: 'noname-text', text: noNameSent ? d.t('ask.nameSent') : d.t('noname.fold') }),
      );
      if (!noNameSent) noName.append(h('span', { class: 'count n mono', text: String(keys.length) }));
      if (!noNameSent) noName.append(h('button', { type: 'button', class: 'link noname-act', dataset: { action: 'ask-name-all' }, onclick: () => askNames(keys) }, h('span', { text: d.t('noname.askAi') })));
      return;
    }
    // Grey words, then one text button. After the press the row says it was asked (and stays until the names land).
    noName.append(h('span', { class: 'noname-text', text: noNameSent ? d.t('ask.nameSent') : d.t('noname.row', { n: keys.length }) }));
    if (noNameSent) return;
    noName.append(h('button', { type: 'button', class: 'link noname-act', dataset: { action: 'ask-name-all' }, title: d.t('noname.whyPlain'), onclick: () => askNames(keys) }, h('span', { text: d.t(keys.length === 1 ? 'noname.act1' : 'noname.act') })));
  };
  // The folded row opens and closes from anywhere on it (its ▸ and "Ask AI to name them" are buttons of their own).
  noName.addEventListener('click', (e) => {
    if (!noName.classList.contains('fold') || (e.target as HTMLElement).closest('button')) return;
    foldOpen = !foldOpen;
    renderNoName();
    renderList();
  });
  const expanded = new Set<string>();
  const thumbs = new Map<string, HTMLImageElement[]>();
  let inputs: Array<{ input: HTMLInputElement; read: (p: Pose) => number; show: (v: number) => string }> = [];

  const thumbImg = (key: string): HTMLElement => {
    // A UI element (UI stage 1): the small drawing of its kind — text, button, picture — instead of a picture of it.
    // HTML is not in the canvas the pictures are cut from, so the box would stay empty.
    const it = d.items().find((i) => i.key === key);
    if (it?.kinds.includes('ui')) {
      const k = it.kinds.includes('button') ? 'uiButton' : it.kinds.includes('image') ? 'uiImage' : it.kinds.includes('bar') ? 'uiBar' : 'uiText';
      return h('span', { class: 'thumb ui-kind', dataset: { kind: k } }, icon(k));
    }
    const img = h('img', { class: 'thumb', alt: '', width: 32, height: 32 });
    const src = safeImageSrc(d.thumb(key));
    if (src) (img.src = src), toneThumb(img, src);
    else img.classList.add('empty');
    const arr = thumbs.get(key) || [];
    arr.push(img);
    thumbs.set(key, arr);
    return img;
  };

  // The ask box is built once and lives in the strip under the game (design
  // pass "apple"). Before, it was rebuilt inside the card on every pick, which
  // needed a saved draft and caret; one lasting element keeps both by itself.
  // With nothing picked it asks about the whole game ("make it night"): the
  // AI is there to talk to from the first screen, not only after a pick
  // (verganti review, 2026-10-16; the request carries no objects).
  let askNote = '';
  let fineOpen = false;
  // The card minimized to its name (a try of the editor, 2026-10-20: "the card sometimes gets in the way while working; I want a
  // minimize button"). One line — picture and name — and the same button opens it again. Kept across picks (it is
  // about the person's way of working, not about one object) and across reloads, in this browser only: a preference
  // of the hand, not of the game, so it does not go in the game's .studio/ui.json. Storage can be missing or throw
  // (a private window, blocked site data): then it lasts until the page closes.
  const MIN_KEY = 'studio.cardMin';
  let cardMin = false;
  try {
    cardMin = localStorage.getItem(MIN_KEY) === '1';
  } catch {
    /* no storage: start open */
  }
  const minBtn = h('button', { type: 'button', class: 'icon-btn card-min', dataset: { action: 'card-min', part: 'card-min' } });
  // The arrow points where the card goes: PC's card hangs from the top (folds up ↑, opens ↓); the phone's stands on
  // the ask bar (folds down ↓, opens ↑).
  const renderMin = () => {
    card.dataset.min = cardMin ? 'on' : 'off';
    const up = d.phone() ? cardMin : !cardMin;
    setButton(minBtn, up ? 'chevronUp' : 'chevronDown', d.t(cardMin ? 'card.open' : 'card.min'), false);
    minBtn.setAttribute('aria-expanded', String(!cardMin));
  };
  minBtn.addEventListener('click', () => {
    cardMin = !cardMin;
    try {
      localStorage.setItem(MIN_KEY, cardMin ? '1' : '0');
    } catch {
      /* no storage: this page only */
    }
    renderMin();
  });
  let cardKey: string | null = null;
  /** A ✦ button (studio-uniforms): the AI's spark and violet; its press only puts a draft in the AI box. */
  const aiButton = (label: string, cls: string, action: string, run: () => void) =>
    h('button', { type: 'button', class: `${cls} ai`, dataset: { action }, onclick: run }, h('span', { class: 'ai-spark', 'aria-hidden': 'true' }, icon('spark')), label);
  // Rename in place (startRename): the object whose card name is a field, and that field — the same element across
  // redraws of the card (any render while typing), so what is typed and the focus stay (level-switch.ts does the same).
  let renameKey: string | null = null;
  let nameField: HTMLInputElement | null = null;
  function startRename(key: string) {
    if (!d.rename) return;
    renameKey = key;
    nameField = null;
    renderCard();
  }
  /** The field in place of the card's name; Enter keeps, Esc puts the old name back, leaving it keeps (as Finder). */
  function nameInput(key: string, shown: string): HTMLInputElement {
    if (nameField && renameKey === key) return nameField;
    const input = (nameField = h('input', { type: 'text', class: 'name-edit', value: shown, maxlength: '120', 'aria-label': d.t('ctx.renameLabel'), dataset: { part: 'name-edit' } }) as HTMLInputElement);
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      renameKey = null;
      nameField = null;
      const v = input.value.trim();
      if (keep && v !== shown) d.rename!(key, v);
      renderCard();
    };
    input.addEventListener('keydown', (e) => {
      // The editor's keys (⌘Z, Delete, arrows, F2…) must not act on the scene while typing a name.
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => setTimeout(() => input.isConnected && document.activeElement !== input && finish(true), 0));
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return input;
  }
  let askKey: string | null = null;
  let lastCard: string | null = null;
  const askInput = h('input', { type: 'text', class: 'ask-input', enterkeyhint: 'send', autocomplete: 'off', maxlength: 500 });
  const askSend = h('button', { type: 'submit', class: 'primary ask-send', dataset: { action: 'ask-ai' } });
  // Examples until something was sent, then "handed to your AI".
  const askNoteEl = h('p', { class: 'ask-note hint', role: 'status' });
  // No ✦ inside the field (mari review): the placeholder already says "ask
  // your AI", and ✦ now means one thing only, "Ideas" next to the field.
  // ✦ [chip: what it is about] [field] [send]. The chip (orange: your pick)
  // says what the words will be about before a word is typed.
  const askChip = h('span', { class: 'ask-chip', hidden: true });
  hoverLights(askChip, () => d.selectedKeys());
  // The second chip of a button's topic ("Keep-out areas"): violet, what the words will be turned into (a rule).
  const askTag = h('span', { class: 'ask-chip topic', hidden: true, dataset: { part: 'ask-topic' } });
  const askEl = h('form', { class: 'ask-box', dataset: { part: 'ask' } }, h('span', { class: 'ask-spark', 'aria-hidden': 'true' }, icon('spark')), askChip, askTag, askInput,
    h('kbd', { class: 'ask-kbd', 'aria-hidden': 'true', text: /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K' }), askSend);
  askEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const keys = d.selectedKeys();
    const files = d.assets?.() || [];
    const text = askInput.value.trim();
    if (!text) {
      askInput.focus();
      return;
    }
    askSend.disabled = true;
    const ok = await d.ask(keys, text, files);
    askSend.disabled = false;
    if (ok) {
      askInput.value = '';
      askNote = d.t('ask.sent');
    } else askNote = d.t('ask.fail');
    renderAsk();
  });
  askInput.addEventListener('input', () => {
    askSend.disabled = !askInput.value.trim();
  });
  // Enter sends from the field; with Escape the field lets go (so arrow keys
  // move the object again) without clearing what was typed.
  askInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') askInput.blur();
  });

  const renderAsk = () => {
    const keys = d.selectedKeys();
    // Files and motions picked in the Library are named by the chip together (a motion by its name, "Hop").
    const fileName = (p: string) => (p.startsWith('\u0000') ? p.slice(1) : p.slice(p.lastIndexOf('/') + 1));
    const picks = [...(d.assets?.() || []), ...(d.motions?.() || []).map((m) => `\u0000${m}`)];
    const files = picks;
    const items = d.items();
    const first = items.find((i) => i.key === keys[0]);
    const k = keys.length || files.length ? [...[...keys].sort(), ...files].join(',') : null;
    // "Sent to your AI" belongs to what it was sent about.
    if (k !== askKey) askNote = '';
    askKey = k;
    const noObj = !keys.length || !first;
    const answer = !!d.answering?.();
    const whole = (noObj && !files.length) || answer;
    const n = (noObj ? 0 : keys.length) + files.length;
    // One placeholder whatever is picked (studio-words-plan, 2026-10-23): the chip beside it says what the ask is about.
    const ph = answer ? d.t('ask.answer') : (d.askGame?.() ?? d.t('ask.game'));
    askChip.hidden = whole;
    // The shown name, never the key: an unnamed object's key is `path:3/2`, which means nothing to a person (U4).
    // A file picked in the Library is named by its file name ("boss.glb"); objects and files together, by how many.
    const firstName = noObj ? (files.length ? fileName(files[0]!) : '') : displayName(first, d.t);
    // The chip stays small (a hands-on try, 2026-10-19: "the object's name in the chat box is in the way" — "Unnamed group"
    // took half the field). One object: its short name ("Black pillar", without "by the road" and "(left, 3rd)": the card
    // above says those, and the game lights it); several: only how many ("×4"). The whole names are its tooltip and
    // the field's label read aloud, so what goes to the AI stays clear; a mouse over it lights them in the game.
    // One object and one motion (the timeline's ✦ Ask AI, or a Library motion with an object picked; studio-motion-panel,
    // a review of 2026-10-22): both names, "crate · Hop" — what the words are about, read in one go, instead of "×2".
    const motionOnly = picks.filter((p) => p.startsWith('\u0000'));
    const pair = !whole && !noObj && keys.length === 1 && files.length === 1 && motionOnly.length === 1;
    askChip.textContent = whole ? '' : pair ? `${shortName(firstName)} · ${fileName(motionOnly[0]!)}` : n === 1 ? (noObj ? firstName : shortName(firstName)) : d.t('ask.chipN', { n });
    askChip.classList.toggle('motion', pair);
    // …and the field says what such words look like: when it starts, how fast (the strip's old "When? (for your AI)").
    if (pair && !answer) askInput.placeholder = d.t('ask.motion');
    const allNames = [...(noObj ? [] : keys.map((key) => { const it = items.find((i) => i.key === key); return it ? displayName(it, d.t) : key; })), ...files.map(fileName)];
    askChip.title = whole ? '' : allNames.slice(0, 12).join('\n') + (allNames.length > 12 ? '\n…' : '');
    if (!pair || answer) askInput.placeholder = ph;
    // Read aloud as one sentence ("Ask your AI about “crate-4”…").
    askInput.setAttribute('aria-label', whole ? ph : pair ? d.t('ask.one', { name: askChip.textContent ?? '' }) : n > 1 ? d.t('ask.many', { n }) : d.t(noObj ? 'ask.oneFile' : 'ask.one', { name: firstName }));
    askEl.classList.toggle('whole', whole);
    // A button's topic (a layout's keep-out areas): its own two chips and example, over the object's chip.
    const topic = answer ? null : d.askTopic?.() ?? null;
    askTag.hidden = !topic || !topic.tag;
    askChip.classList.toggle('with-pic', !!topic?.pic);
    if (topic) {
      askEl.classList.remove('whole');
      askChip.hidden = false;
      // A place on the game's screen (studio-canvas-ui stage 2: "Here (bottom left)"): its small picture before the words.
      askChip.replaceChildren(...(topic.pic ? [h('img', { class: 'ask-chip-pic', src: topic.pic, alt: '', dataset: { part: 'ask-chip-pic' } })] : []), topic.chip);
      if (topic.tip) askChip.title = topic.tip;
      askTag.textContent = topic.tag ?? '';
      askInput.placeholder = topic.ph;
      askInput.setAttribute('aria-label', topic.tag ? `${topic.chip} · ${topic.tag}` : topic.chip);
    }
    // A round arrow, as in message apps: grey until there is something to send.
    setButton(askSend, 'send', d.t('ask.send'), false);
    askSend.disabled = !askInput.value.trim();
    // The examples stay even with nothing picked: they say what kind of thing
    // can be asked before the box can be used.
    // Only news ("handed to your AI") is shown: the examples are in the ⌘K list now.
    askNoteEl.textContent = askNote;
    askNoteEl.classList.toggle('hint', !askNote);
    askNoteEl.hidden = !askNote;
  };

  /** Copy / Delete: two 28 px icon buttons at the card head's right end (the words are the tooltip and the label read aloud). */
  const actionRow = () => {
    // .card-actions (the place the AI-partner card keeps for these buttons) holding the edit-ops row.
    const row = h('div', { class: 'card-actions edit-ops', dataset: { part: 'edit-ops' } });
    const copy = h('button', { type: 'button', class: 'icon-btn', dataset: { action: 'copy' }, onclick: () => d.copy() });
    // Tooltip = the name and its key (tooltip.ts sets the key apart); the longer how-to stays for screen readers.
    setButton(copy, 'copy', d.t('ops.copy'), false, tipText(d.t('ops.copy'), d.shortcutOf('copy')));
    copy.setAttribute('aria-description', d.t('ops.copyHint'));
    const del = h('button', { type: 'button', class: 'icon-btn', dataset: { action: 'remove' }, onclick: () => d.remove() });
    setButton(del, 'trash', d.t('ops.remove'), false, tipText(d.t('ops.remove'), d.shortcutOf('remove')));
    del.setAttribute('aria-description', d.t('ops.removeHint'));
    row.append(copy, del);
    return row;
  };
  /** "All 4 of this kind": a quiet line under the fields, only when there are more of the same kind. */
  const kindLink = (key: string) => {
    const kind = sameKind(d.items(), key);
    if (kind.length < 2) return null;
    // No title: the link's words are the whole of it (a tooltip of the same words was noise, the second design review ⑪).
    return h('button', { type: 'button', class: 'link-btn', dataset: { action: 'select-kind' },
      text: d.t('ops.selectKind', { n: kind.length }), onclick: () => d.selectMany(kind, key) });
  };

  /**
   * The layer row (2D): "Layer" and one segmented control of four arrows
   * (to back, backward, forward, to front), then where it is ("3 / 8" from
   * the front). The words are in the tooltip with the shortcut.
   */
  const layerRow = (disabled: (op: LayerOp) => boolean, act: (op: LayerOp) => void, pos?: string, posTip?: string) => {
    const seg = h('div', { class: 'seg layer-seg', role: 'group', 'aria-label': d.t('layer.title') });
    for (const op of ['toBack', 'backward', 'forward', 'toFront'] as LayerOp[]) {
      const b = h('button', { type: 'button', class: 'layer-btn', dataset: { action: `layer-${op}` }, disabled: disabled(op), onclick: () => act(op) });
      setButton(b, op, d.t(`layer.${op}`), false, tipText(d.t(`layer.${op}`), d.shortcut(op)));
      seg.append(b);
    }
    return h('div', { class: 'f-row layer-row', dataset: { part: 'layer' } },
      h('span', { class: 'f-l', text: d.t('layer.title') }), seg,
      pos ? h('span', { class: 'layer-pos mono', title: posTip, text: pos }) : null);
  };

  /** Layer buttons for a whole selection (2D): the block moves together. */
  const groupLayerRow = (keys: string[]) => {
    const items = d.items();
    if (!keys.some((k) => hasLayer(items.find((i) => i.key === k)))) return null;
    return layerRow((op) => !groupLayerPossible(items, keys, op), (op) => d.reorder(keys[0]!, op));
  };

  /**
   * The card's head: picture(s) · name over a grey second line · copy · delete. `ui` (UI stage 1): an element of the
   * game's UI layer — a small "UI" tag after the name, and no copy / delete (UI stage 3 places new UI; until then a
   * copy of a title would be a promise the AI cannot keep from a moved offset alone).
   */
  // The minimize button ends every head (one object, several, a UI element), always at its right end.
  // The "UI" tag sits beside the name, not inside it: inside, a long name's "…" cut the tag off with it (Ive review 3 ⑤).
  const head = (pics: HTMLElement, name: string, sub: string | null, cls = '', ui = false, more: HTMLElement | null = null) =>
    h('div', { class: `card-head ${cls}`.trim() }, pics,
      h('div', { class: 'head-text' }, h('div', { class: 'head-name' }, h('strong', { text: name }), ui ? h('span', { class: 'tag ui-tag', dataset: { part: 'ui-tag' }, text: d.t('uiLayer.tag') }) : null), h('div', { class: 'key', text: sub || '' })),
      ui ? null : actionRow(), more, minBtn);
  /**
   * The card's ⋯ (studio-card-doors, 2026-10-23; the plan's "a card holds the name and the numbers"): "Show in Library"
   * and "Select all N like this" were two link lines under the numbers on every card — the card read as a page of
   * links. They are one press further now, in the menu this button opens. Outside .card-actions so a locked road (whose
   * copy / delete are hidden) keeps it. null = nothing to list (no Library in this build, no others of its kind).
   */
  const moreRows = (it: Item, key: string) => {
    const rows: Array<{ id: string; label: string; run(): void }> = [];
    if (d.showInLibrary && !it.kinds.includes('ui')) rows.push({ id: 'show-in-library', label: d.t('card.showInLibrary').replace(/\s*→$/, ''), run: () => d.showInLibrary!() });
    const kind = sameKind(d.items(), key);
    if (kind.length > 1) rows.push({ id: 'select-kind', label: d.t('ops.selectKind', { n: kind.length }), run: () => d.selectMany(kind, key) });
    // A code layout's object (studio-code-knobs): the same as its card's buttons, where the other ways are.
    rows.push(...(d.ruleRows?.(key) ?? []));
    return rows;
  };
  // A phone has a ⋯ on its card already (the numbers' fold, `fine`): the rows go in there as links (moreLinks), not
  // behind a second ⋯ beside it.
  const moreBtn = (it: Item, key: string) => {
    if (!d.cardMenu || d.phone()) return null;
    const rows = moreRows(it, key);
    if (!rows.length) return null;
    const b = h('button', { type: 'button', class: 'icon-btn card-more', dataset: { action: 'card-more' }, 'aria-haspopup': 'menu', onclick: () => d.cardMenu!(b, rows) });
    // Its name is what it holds ("Show in Library · Select all 4 like this"): no new word for a "More" (the glossary keeps
    // ⋯ from being an entrance whose contents cannot be told).
    setButton(b, 'more', rows.map((r) => r.label).join(' · '), false);
    return b;
  };

  const renderGroupCard = (keys: string[]) => {
    const items = d.items();
    const members = keys.map((k) => items.find((i) => i.key === k)).filter((i): i is Item => !!i);
    const names = members.slice(0, 6).map((m) => displayName(m, d.t)).join(', ') + (members.length > 6 ? ' …' : '');
    cardKey = 'group:' + [...keys].sort().join(',');
    // What the strip does with several is told once, on the heading's tooltip.
    const h0 = head(h('div', { class: 'stack' }, ...members.slice(0, 3).map((m) => thumbImg(m.key))), d.t('ops.many', { n: members.length }), names, 'group-head');
    h0.title = d.t('ops.groupHint');
    // While "Select" is on, its "Done" is the way out.
    // Phone / side window: "Deselect" is a ✕ in the head, after copy and delete (a try of v0.1.7 in the Claude app's side
    // window, 2026-10-21: as a link under the head it took a whole row of its own, with empty room over it, between the
    // list and the ask bar). PC keeps the link under the head (shell.css shows one or the other by layout).
    if (!d.multi()) {
      const x = h('button', { type: 'button', class: 'icon-btn card-x', dataset: { action: 'select-none' }, onclick: () => d.selectMany([], '') });
      setButton(x, 'close', d.t('ops.selectNone'), false, tipText(d.t('ops.selectNone'), 'Esc'));
      h0.querySelector('.card-actions')?.append(x);
    }
    card.append(h0);
    const body = h('div', { class: 'card-body' });
    if (members.some((m) => m.movable === false)) body.append(h('p', { class: 'muted note-line', text: d.t('ops.lockedSkipped') }));
    const lr = groupLayerRow(keys);
    if (lr) body.append(lr);
    // ✦ Turn into a rule: the hand-placed ones picked together are what a rule could put (a row of lamps by hand).
    const toRule = d.toRule?.(keys);
    if (toRule) {
      const b = aiButton(d.t('toRule.place'), 'to-rule link-btn', 'to-rule', toRule);
      b.title = d.t('toRule.placeTip', { n: members.length });
      b.dataset.part = 'to-rule';
      body.append(b);
    }
    if (!d.multi()) body.append(h('button', { type: 'button', class: 'link-btn', dataset: { action: 'select-none' }, text: d.t('ops.selectNone'), onclick: () => d.selectMany([], '') }));
    card.append(body);
  };

  // studio-fix-0168: a knob on the card being dragged (a rule's Count) is not drawn again under the pointer — that dropped
  // the drag at +1 — the card is drawn once when it is let go (knob.ts knobHeld / afterKnob).
  let cardWaits = false;
  const renderCard = () => {
    if (knobHeld(card)) {
      if (!cardWaits) (cardWaits = true, afterKnob(() => ((cardWaits = false), renderCard())));
      return;
    }
    card.replaceChildren();
    inputs = [];
    renderMin();
    const key = d.selected();
    const sel = d.group();
    // The card appears with a short rise when the selection changes (not on
    // every re-render): the one motion that says "this is what you picked".
    const animate = () => {
      if (cardKey !== lastCard) {
        lastCard = cardKey;
        card.classList.remove('enter');
        void card.offsetWidth;
        card.classList.add('enter');
      }
    };
    card.classList.toggle('many', !!key && sel.length > 1);
    if (key && sel.length > 1) {
      card.hidden = false;
      renderGroupCard(sel);
      animate();
      return;
    }
    const it = key ? d.items().find((i) => i.key === key) : undefined;
    if (!key || !it) {
      cardKey = null;
      lastCard = null;
      // Nothing picked: no card at all (the game is the whole picture).
      card.hidden = true;
      return;
    }
    card.hidden = false;
    cardKey = key;
    // 1. Head: the second line is the key when the name differs, else the file it is drawn with (filled in below).
    // Never a tree path (`path:6`) or `tree#2` there: internal words (polish pass, play test stumble 8). The key a
    // person may need (to tell the AI) is a real name, so it shows only when the label differs from a named key.
    const shown = displayName(it, d.t);
    // A guessed name on two lines: what it is, then (grey) which one — "Black pillar by the road" / "left, 3rd". On one line
    // the 272 px card cut it to "Black pillar by the road (le…", the very part that tells it from the 19 others (2026-10-19).
    const parts = isGuessed(it) ? nameParts(shown) : { base: shown, where: '' };
    // UI (Ive review 3 ⑤): the name is the key in words ("Title card"); the grey second line is what it says ("Glow
    // Garden Tap the lanterns…"), when that is not just the name again (a "Score" that reads "Score").
    const ui = it.kinds.includes('ui');
    const uiText = ui && it.label.trim().toLowerCase() !== shown.toLowerCase() ? it.label : null;
    const h0 = head(thumbImg(key), parts.base, ui ? uiText : parts.where || (!it.unstable && !/#\d+$/.test(key) && it.label !== key ? key : null), '', ui, moreBtn(it, key));
    h0.title = parts.where ? shown : '';
    let refocus: HTMLInputElement | null = null;
    if (renameKey === key && !ui) {
      const again = !!nameField;
      const f = nameInput(key, shown);
      h0.querySelector('.head-name strong')?.replaceWith(f);
      // Drawn again while typing: the card was emptied (which blurs the field); the focus goes back at once, before the
      // blur's check runs (a blur that stays is the person leaving the field: the name is kept then).
      if (again) refocus = f;
    }
    else if (renameKey && renameKey !== key) (renameKey = null), (nameField = null);
    const sub = h0.querySelector('.key') as HTMLElement;
    card.append(h0);
    refocus?.focus({ preventScroll: true });
    const body = h('div', { class: 'card-body' });
    // Phone: no numbers on the card (design review wave 1, W1-11 / N6, 2026-10-17). The head's second line used to be
    // "-24.00, 6.63, -20.00 · 0°", raw numbers that a finger cannot edit there; the card is the name, copy, delete and
    // "…" (which still opens the fields). The second line stays empty; whoever needs numbers reads them on a PC.
    // A UI element's text stays (Ive review 3 ⑤): it is words, not numbers, and the name alone ("Title card") does not say
    // which title.
    if (d.phone() && !parts.where && !uiText) sub.textContent = '';
    animate();
    // Held by the editor (bridge/hold.ts; a hands-on try of 2026-10-19, items 4 and 5). A ground / road / sky:
    // why it does not move, and the one button that frees it (the "one more step" asked for). What the game moves by
    // itself: the tester's own words for it, so the person knows a new spot will not last before trying one.
    /** The line on what a name is good for, and the button that asks the AI for one (an object without a name). */
    const nameNote = () => {
      // A name is something the AI gives in code. Grey, not yellow: a missing
      // name is a thing to improve, not a fault.
      // One line on what a name is good for, then the button (a hands-on try, 2026-10-19: the "Unnamed" pill said what
      // was missing, not why to fix it). "A guessed name" only when the editor made one up (names.ts), not for a file's.
      const guessed = isGuessed(it);
      body.append(h('p', { class: 'warn note-line noname-why', dataset: { part: 'noname-why' } },
        h('span', { class: 'why-text', text: d.t(guessed ? 'noname.why' : 'noname.whyPlain') }), ' ',
        d.nameDraft ? aiButton(d.t('ctx.nameAsk'), 'name-ask link-btn', 'ask-name', () => d.nameDraft!(d.selectedKeys().filter((k) => d.items().find((i) => i.key === k)?.unstable)))
        : h('button', { type: 'button', class: 'name-ask link-btn', dataset: { action: 'ask-name' }, text: d.t('ask.name'), onclick: async (e: Event) => {
          const b = e.currentTarget as HTMLButtonElement;
          b.disabled = true;
          const ok = await d.askName(d.selectedKeys().filter((k) => d.items().find((i) => i.key === k)?.unstable));
          askNote = ok ? d.t('ask.nameSent') : d.t('ask.fail');
          renderAsk();
          renderCard();
        } })));
    };
    // studio-card-doors (2026-10-23; the plan's rule "the why, once, in one line"): the card said why in a paragraph
    // ("Ground, road, or sky…" + "Unlock"; "Your game moves this while playing…") while the line under the strip said the
    // same — two places, and the road had three ways to unlock (the card, right-click, the line). Now the line under
    // the strip is the one place (bridge/handles.ts), and its "Unlock" the one way; the card is the name (and numbers).
    if (it.held === 'ground') {
      (h0.querySelector('.card-actions') as HTMLElement).hidden = true;
      return;
    }
    if (it.held === 'game') {
      // No "Set where it starts" link any more (studio-move-plain, 2026-10-23): Move already sets it (hold.ts).
      // Place held: no number fields (they would set a place the game undoes); height / turn / size stay on the strip.
      if (it.movable === false) {
        if (it.unstable) (card.append(body), nameNote());
        return;
      }
    }
    // Game rules (.studio/studio.json): a locked object has no strip and no
    // number fields; a kind with a default size gets a one-click reset.
    if (it.movable === false) {
      (h0.querySelector('.card-actions') as HTMLElement).hidden = true;
      card.append(body);
      body.append(h('p', { class: 'muted note-line', text: d.t('placement.locked') }));
      return;
    }
    // 2. Numbers, always open on PC (the phone folds them under "…").
    const fine = h('details', { class: 'fine', dataset: { part: 'fine' } }, h('summary', { 'aria-label': d.t('placement.fine'), title: d.t('placement.fine') }, icon('more')));
    fine.open = !d.phone() || fineOpen;
    fine.addEventListener('toggle', () => {
      if (d.phone()) fineOpen = fine.open;
    });
    const dim = d.dim();
    const axes = dim === '3d' ? ['x', 'y', 'z'] : ['x', 'y'];
    // Values read the same way everywhere: "2.00" (3D metres), "120" (2D px), "52°", "1.00".
    // A text field (not type=number) so the angle can carry its "°"; what is typed is read with parseFloat.
    const num = (label: string, read: (p: Pose) => number, write: (p: Pose, v: number) => Pose, step: string, axis?: string, show: (v: number) => string = (v) => String(Math.round(v * 1000) / 1000)) => {
      const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: false, 'aria-label': label, dataset: { inc: step } }); // not data-step: the Ideas rows carry data-step
      input.addEventListener('focus', () => input.select());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
      input.addEventListener('change', () => {
        const v = parseFloat(input.value.replace(',', '.'));
        const cur = d.pose(key);
        if (!cur || !Number.isFinite(v)) return;
        d.setPose(key, write(structuredClone(cur), v));
      });
      inputs.push({ input, read, show });
      // The letter is a handle for the number: drag it left / right and the
      // object moves in the game while the finger is down (one undo step when
      // it lets go). Typing stays for an exact value. `per` = units per pixel
      // (Shift = ten times finer). The whole field shows the ↔ cursor.
      const grab = h('span', { class: d.scrub ? 'scrub' : '', text: axis ? axis.toUpperCase() : '', title: d.scrub ? d.t('placement.scrub') : undefined, dataset: axis ? { axis } : {} });
      if (d.scrub) {
        const per = step === '1' ? 1 : step === '0.1' ? 0.01 : 0.005;
        let drag: { x: number; v: number; from: Pose; moved: boolean } | null = null;
        grab.addEventListener('pointerdown', (e) => {
          const cur = d.pose(key);
          if (!cur || (e.pointerType === 'mouse' && e.button !== 0)) return;
          e.preventDefault();
          grab.setPointerCapture(e.pointerId);
          drag = { x: e.clientX, v: read(cur), from: structuredClone(cur), moved: false };
          grab.classList.add('on');
        });
        const valueAt = (dr: { x: number; v: number }, e: PointerEvent) => {
          const v = dr.v + (e.clientX - dr.x) * per * (e.shiftKey ? 0.1 : 1);
          return Math.round(v / (per / 10)) * (per / 10);
        };
        grab.addEventListener('pointermove', (e) => {
          if (!drag) return;
          if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return;
          drag.moved = true;
          d.scrub!(key, write(structuredClone(drag.from), valueAt(drag, e)), false, drag.from);
        });
        const finish = (e: PointerEvent, keep: boolean) => {
          if (!drag) return;
          const dr = drag;
          drag = null;
          grab.classList.remove('on');
          if (!dr.moved) {
            if (keep) input.focus();
            return;
          }
          d.scrub!(key, keep ? write(structuredClone(dr.from), valueAt(dr, e)) : dr.from, true, dr.from);
        };
        grab.addEventListener('pointerup', (e) => finish(e, true));
        grab.addEventListener('pointercancel', (e) => finish(e, false));
      }
      return h('label', { class: `num${axis ? '' : ' wide'}` }, grab, input);
    };
    const fields = h('div', { class: 'fields' });
    // A code layout's object (studio-code-knobs): its Layout (the rule's numbers) where Position was, or "Manually
    // overridden" over its own numbers. The phone shows it too, folded like the numbers.
    const rule = d.layout?.(key) ?? null;
    // In the numbers' place: on a phone under "…" with them (the phone card is name, copy, delete and "…": W1-11).
    if (rule) fine.append(...rule.els);
    if (rule && !rule.numbers) {
      if (d.motion && dim === '3d') fields.append(...d.motion(key));
      if (fields.childElementCount) fine.append(fields);
      if (d.cardMenu && d.phone()) for (const r of moreRows(it, key)) fine.append(h('button', { type: 'button', class: 'link-btn', dataset: { action: r.id }, text: r.label, onclick: () => r.run() }));
      body.append(fine);
      card.append(body);
      return;
    }
    // A UI element's numbers are its offset from where the game's CSS puts it (UI stage 1), in px.
    fields.append(h('span', { class: 'f-l', text: d.t(it.kinds.includes('ui') ? 'uiLayer.offset' : 'placement.pos') }));
    const posCells = h('div', { class: `f-cells n${axes.length}` });
    // One decimal (W1-11 / D1): "-24.0" fits three to a row of the 272 px card; "-24.00" was cut to "-24.0(".
    const metres = (v: number) => v.toFixed(1);
    const px = (v: number) => String(Math.round(v * 10) / 10);
    axes.forEach((a, i) => posCells.append(num(a, (p) => p.p[i] ?? 0, (p, v) => ((p.p[i] = v), p), dim === '3d' ? '0.1' : '1', a, dim === '3d' ? metres : px)));
    fields.append(posCells);
    if (it.rotatable) {
      fields.append(h('span', { class: 'f-l', text: d.t('placement.rot') }),
        h('div', { class: 'f-cells' }, num('°', (p) => (p.r ?? 0) * DEG, (p, v) => ((p.r = v / DEG), p), '1', undefined, (v) => `${Math.round(v * 10) / 10}°`)));
    }
    // 3D tilt (tipped forward / sideways with the strip's turn button): shown once the object has one.
    const p0 = d.pose(key);
    if (dim === '3d' && it.rotatable && p0?.t) {
      const tilt = (i: 0 | 1) => (p: Pose, v: number) => {
        const t: [number, number] = p.t ? [p.t[0], p.t[1]] : [0, 0];
        t[i] = v / DEG;
        p.t = t;
        return p;
      };
      const deg = (v: number) => `${Math.round(v * 10) / 10}°`;
      fields.append(h('span', { class: 'f-l', text: d.t('placement.tilt') }),
        h('div', { class: 'f-cells n2' }, num('x°', (p) => (p.t?.[0] ?? 0) * DEG, tilt(0), '1', 'x', deg), num('z°', (p) => (p.t?.[1] ?? 0) * DEG, tilt(1), '1', 'z', deg)));
    }
    if (it.scalable) {
      fields.append(h('span', { class: 'f-l', text: d.t('placement.scale') }),
        h('div', { class: 'f-cells' }, num('×', (p) => (Array.isArray(p.s) ? p.s[0] ?? 1 : p.s ?? 1), (p, v) => {
          if (!(v > 0)) return p;
          if (Array.isArray(p.s)) {
            const k = v / (p.s[0] || 1);
            p.s = p.s.map((c) => c * k);
          } else p.s = v;
          return p;
        }, '0.1', undefined, (v) => v.toFixed(2))));
    }
    // Motion (motion-gui, 2026-10-22): how it moves by itself, one more property under its size. 3D only in stage 1
    // (design.md §5: 2D has the same file shape, its card comes next); never for a UI element.
    if (d.motion && dim === '3d' && !it.kinds.includes('ui')) fields.append(...d.motion(key));
    fine.append(fields);
    // One placed by hand (studio-hand-marks): its rule's block under its numbers (the knobs, "✋ 2 placed by hand").
    if (rule?.after) fine.append(...rule.after);
    // A UI element's text, size, colours, states and sample values (UI stages 2–3): under its numbers, in the same fold.
    if (d.uiLook && it.kinds.includes('ui')) fine.append(...d.uiLook(key));
    if (it.scalable && typeof it.defaultScale === 'number') {
      const target = it.defaultScale;
      fine.append(h('button', { type: 'button', class: 'link-btn', dataset: { action: 'reset-size' }, text: `${d.t('placement.resetSize')} ×${target}`, onclick: () => {
        const cur = d.pose(key);
        if (cur) d.setPose(key, { ...structuredClone(cur), s: target });
      } }));
    }
    if (d.cardMenu && d.phone()) {
      for (const r of moreRows(it, key)) fine.append(h('button', { type: 'button', class: 'link-btn', dataset: { action: r.id }, text: r.label, onclick: () => r.run() }));
    }
    body.append(fine);
    // 3. Layer (2D). On a phone (and any window up to UI.phoneMaxWidth: the side window at 400) it goes INSIDE "…"
    // (design review wave 1 merge, 2026-10-17; the review's "what to cut" 6 and D13): the phone card is name, copy,
    // delete and "…" only. The row under the 56 px card made it ~100 px and the object list above it read 2 rows
    // at 400×600 (test/studio-narrow wants 4). Draw order stays one press away: "…", and dragging a row's grip in
    // the list. Before: the row stayed on the folded card ("draw order is a main 2D move", narrow pass 10-17).
    const layerAt = d.phone() ? fine : body;
    if (hasLayer(it) && it.backdrop) {
      // Ground / background: stays at the back (play test 2026-10-16), said in one line.
      layerAt.append(h('p', { class: 'muted layer-fixed note-line', dataset: { part: 'layer' }, text: d.t('layer.backdrop') }));
    } else if (hasLayer(it)) {
      const items = d.items();
      const sib = siblingsOf(items, key);
      const pos = sib.findIndex((s) => s.key === key);
      // "3 / 8" from the front, so the person sees where it is at a glance.
      const at = sib.length > 1 ? `${sib.length - pos} / ${sib.length}` : undefined;
      layerAt.append(layerRow((op) => layerTarget(items, key, op) === null, (op) => d.reorder(key, op), at, at && d.t('layer.posTip', { i: sib.length - pos, n: sib.length })));
    }
    // 4. The game's rules for this object, said where the hand is: "Grid 1 · 45° steps".
    const rules = d.rules?.(key) || [];
    if (rules.length) body.append(h('div', { class: 'rules-row', dataset: { part: 'rules' } }, ...rules.map((r) => h('span', { class: 'pill rule', text: r.text, dataset: { k: r.k } }))));
    // 5. The files this object is drawn with (Scene → Assets): pressing one opens it in Assets.
    if (d.files) {
      const filesRow = h('div', { class: 'f-row assets-row', dataset: { part: 'assets' }, hidden: true });
      body.append(filesRow);
      const forKey = key;
      void d.files(key).then((files) => {
        if (cardKey !== forKey || !files.length) return;
        if (!d.phone() && !sub.textContent) sub.textContent = files[0]!.name;
        filesRow.append(h('span', { class: 'f-l', text: d.t('card.assets') }));
        const cells = h('div', { class: 'f-files' });
        for (const f of files.slice(0, 2)) {
          const b = h('button', { type: 'button', class: 'asset-link', dataset: { action: 'open-asset', path: f.path }, title: `${d.t('card.assetOpen')}: ${f.path}`, onclick: () => d.openFile?.(f.path) });
          if (f.src) {
            const img = h('img', { class: 'thumb', alt: '', width: 16, height: 16 });
            img.src = f.src;
            b.append(img);
          }
          b.append(h('span', { class: 'label', text: f.name }), icon('chevronRight'));
          cells.append(b);
        }
        if (files.length > 2) cells.append(h('span', { class: 'muted more-files', title: files.slice(2).map((f) => f.path).join('\n'), text: `+${files.length - 2}` }));
        filesRow.append(cells);
        filesRow.hidden = false;
      });
    }
    // 6. Notes: no name, a copy, "all of this kind".
    // merge of 2026-10-19: the name line is a function so the card of an object the game moves (held 'game', which ends
    // early) shows it too — the unnamed pillars of the runner are both at once (fb-names + fb-safe).
    if (it.unstable) nameNote();
    // A copy: no line on the card (the third design review, 5-2, 2026-10-20). "Copy of barrel · Save to keep it" said
    // what the list's "duplicate" tag (its tooltip has these words) and the "Save · 1" in the game's corner already
    // say. A see-through stand-in keeps its line: why it is see-through is said nowhere else.
    if (it.copyOf && it.ghost) body.append(h('p', { class: 'muted copy-note note-line', text: d.t('ops.ghostNote', { from: it.copyOf }) }));
    // 7. The way to this object in the Library ("use the Library", 2026-10-18: "when I pick something in the game, I
    // want to go straight to its page in the Library"); its file is the Assets row above.
    // (Not for a UI element: HTML is not a Library object.)
    // (In the card's ⋯ since studio-card-doors: moreBtn. A build without cardMenu keeps the old link lines.)
    if (!d.cardMenu) {
      if (d.showInLibrary && !it.kinds.includes('ui')) body.append(h('button', { type: 'button', class: 'link-btn lib-link', dataset: { action: 'show-in-library' }, text: d.t('card.showInLibrary'), onclick: () => d.showInLibrary!() }));
      const kl = kindLink(key);
      if (kl) body.append(kl);
    }
    card.append(body);
    updateNumbers();
  };

  // (The phone's numbers line in the card head, "2.00, 0.00, 2.00 · 52°", is gone: W1-11.)
  const updateNumbers = () => {
    const key = d.selected();
    const p = key ? d.pose(key) : undefined;
    if (!p) return;
    for (const { input, read, show } of inputs) {
      if (document.activeElement === input) continue; // do not fight the user's typing
      input.value = show(read(p));
    }
  };

  // ----- draw-order list (2D layers) -----
  // Drag by the grip only: dragging a row itself would fight scrolling the
  // list with a finger. The grip has touch-action: none, so a finger on it
  // drags instead of scrolling.
  let dragging: { key: string; layer: string; row: HTMLElement; mark: HTMLElement; y0: number; moved: boolean } | null = null;
  const dropIndex = (y: number) => {
    // Front-first index among the dragged object's siblings, the dragged row left out.
    const rows = Array.from(list.querySelectorAll<HTMLElement>(`li.obj[data-layer]`)).filter((r) => r.dataset.layer === dragging!.layer && r.dataset.key !== dragging!.key);
    let i = 0;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (y > b.top + b.height / 2) i++;
    }
    return { i, rows };
  };
  const showMark = (y: number) => {
    const { i, rows } = dropIndex(y);
    const lr = list.getBoundingClientRect();
    let top: number;
    if (!rows.length) top = dragging!.row.getBoundingClientRect().top;
    else if (i < rows.length) top = rows[i]!.getBoundingClientRect().top - 1;
    else top = rows[rows.length - 1]!.getBoundingClientRect().bottom + 1;
    dragging!.mark.style.top = `${top - lr.top + list.scrollTop}px`;
    dragging!.mark.hidden = false;
  };
  const grip = (it: Item) => {
    const g = h('span', { class: 'grip', role: 'button', 'aria-label': d.t('layer.drag'), title: d.t('layer.drag'), dataset: { grip: it.key } }, icon('grip'));
    g.addEventListener('click', (e) => e.stopPropagation());
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      g.setPointerCapture(e.pointerId);
      const row = g.closest('li') as HTMLElement;
      const mark = h('div', { class: 'drop-mark', hidden: true });
      list.append(mark);
      dragging = { key: it.key, layer: it.layer!, row, mark, y0: e.clientY, moved: false };
      row.classList.add('dragging');
    });
    g.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (Math.abs(e.clientY - dragging.y0) > 4) dragging.moved = true;
      if (dragging.moved) showMark(e.clientY);
    });
    const finish = (e: PointerEvent, drop: boolean) => {
      if (!dragging) return;
      const dr = dragging;
      dragging = null;
      dr.row.classList.remove('dragging');
      dr.mark.remove();
      if (!drop || !dr.moved) return;
      dragging = dr; // dropIndex reads it
      const { i } = dropIndex(e.clientY);
      dragging = null;
      d.reorder(dr.key, i);
    };
    g.addEventListener('pointerup', (e) => finish(e, true));
    g.addEventListener('pointercancel', (e) => finish(e, false));
    return g;
  };

  const renderLayerList = (blocks: ReturnType<typeof layerBlocks>, rest: Item[]) => {
    const sel = d.selected();
    const many = blocks.length > 1;
    for (const b of blocks) {
      // The heading of a list selects everything in it.
      if (many) {
        const keys = b.rows.map((r) => r.item.key);
        list.append(h('li', { class: 'layer-head', role: 'presentation', title: d.t('ops.selectAllOf'), dataset: { layerHead: b.layer }, text: b.layer, onclick: () => keys.length && d.selectMany(keys, keys[0]!) }));
      }
      b.rows.forEach(({ item: it, depth }) => {
        const sib = siblingsOf(d.items(), it.key).length;
        const row = h('li', { role: 'option', class: 'obj', 'aria-selected': String(it.key === sel), dataset: { key: it.key, layer: it.layer! } },
          // Locked by the game's rules (.studio/studio.json): listed, but its order stays.
          // Ground / background (Item.backdrop) stays at the back: no grip either.
          sib > 1 && it.movable !== false && !it.backdrop ? grip(it) : h('span', { class: 'grip off', 'aria-hidden': 'true' }),
          thumbImg(it.key),
          nameOf(it),
          it.unstable ? noNamePill(it) : null,
        );
        // 22 px per level: a sub row's picture starts under the name above (24 px picture − 2).
        if (depth) row.style.paddingLeft = `${8 + depth * 22}px`;
        if (inGroup(it.key)) row.setAttribute('aria-selected', 'true');
        if (it.copyOf) row.append(copyTag(it));
        row.addEventListener('click', (e) => d.select(it.key, e.shiftKey));
        list.append(row);
      });
    }
    for (const it of rest) {
      const row = h('li', { role: 'option', class: 'obj', 'aria-selected': String(it.key === sel || inGroup(it.key)), dataset: { key: it.key } },
        thumbImg(it.key), nameOf(it), it.unstable ? noNamePill(it) : null, it.copyOf ? copyTag(it) : null);
      row.addEventListener('click', (e) => d.select(it.key, e.shiftKey));
      list.append(row);
    }
    markRows();
    revealSelected();
  };

  // "no name" in the list (rebrand): the row's name is a grey italic "No
  // name" and the key it goes by sits at the right end, in mono; one way to
  // say it (before: the key as the name AND a "No name" pill). The class
  // stays badge-warn for .studio/ui/ CSS written against it.
  // Polish pass (2026-10-16, play test stumble 8): the key at the right end (`path:6`) was an internal word in
  // plain sight. The name now says what the object is (names.ts); the key moved to the tooltip. Kept as a
  // function (and the class) for .studio/ui/ CSS written against it, but it draws nothing.
  const noNamePill = (_it?: Item): HTMLElement | null => null;
  // The shared start of the members' names ("crate-1", "crate-2" → "crate"), else the first one's.
  const kindName = (members: Item[]) => {
    const names = members.map((m) => displayName(m, d.t));
    // Guessed names of one kind share their first part ("Black pillar by the road"): that is the heading.
    const bases = new Set(members.map((m) => (isGuessed(m) ? nameParts(displayName(m, d.t)).base : '')));
    if (bases.size === 1 && !bases.has('')) return [...bases][0]!;
    let pre = names[0] || '';
    for (const n of names) while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
    pre = pre.replace(/[\s#:_.（(-]+$/, '');
    return pre.length >= 2 ? pre : names[0] || '';
  };
  // Where a folded unnamed object stands, the clue that tells one from another: 3D "x −2.0 · z −14.0" (the ground's
  // two axes, the height says little), 2D "x 120 · y 40". "−" not "-" (the numbers on the card read the same way).
  const whereOf = (key: string) => {
    const p = d.pose(key)?.p;
    if (!p) return d.t('noname.tag');
    const n = (v: number | undefined, digits: number) => (v ?? 0).toFixed(digits).replace('-', '\u2212');
    return d.dim() === '3d' ? `x ${n(p[0], 1)} · z ${n(p[2], 1)}` : `x ${n(p[0], 0)} · y ${n(p[1], 0)}`;
  };
  // A UI row's tooltip is what it says (its name is its key in words, names.ts uiName).
  const nameOf = (it: Item) => h('span', { class: it.unstable ? 'name unnamed' : 'name', title: it.unstable ? d.t('placement.unstable') : it.kinds.includes('ui') ? it.label : undefined, text: displayName(it, d.t) });
  // Keep the picked row in view inside the list (PC and phone). Before the
  // tool-modes pass (10/16) a phone scrolled the sheet to its top on a new
  // pick, because the card was then inside the sheet; the card now stands on
  // the ask bar, outside it, so the top of the sheet is only the tabs — and
  // the picked row (e.g. crate-4, 4th in its kind) stayed below the fold.
  const revealSelected = () => {
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const inGroup = (k: string) => d.group().length > 1 && d.group().includes(k);
  // State that used to be invisible, drawn on the rows: what the AI's last
  // change touched ("AI", seen after the game is reloaded), and what was
  // changed here but not saved yet (a small dot at the row's end). The Save
  // button's count said "2", but not which two.
  const rowMarks = (keys: string[]) => {
    const out: HTMLElement[] = [];
    const ai = keys.map((k) => d.aiMark?.(k)).find(Boolean);
    // Violet = the AI's hand, a dot like your own (orange) pick's.
    if (ai) out.push(h('span', { class: 'tag ai', title: d.t(ai === 'added' ? 'ai.markAdded' : 'ai.markMoved'), 'aria-label': d.t('ai.mark') }));
    if (keys.some((k) => d.unsaved?.(k))) out.push(h('span', { class: 'unsaved-dot', title: d.t('placement.unsaved'), 'aria-label': d.t('placement.unsaved') }));
    return out;
  };
  /** (Re)draw the marks on every row; cheap, so it runs after each change, not only on a full render. */
  const markRows = () => {
    const items = d.items();
    for (const row of list.querySelectorAll<HTMLElement>('li.obj')) {
      for (const old of row.querySelectorAll(':scope > .tag.ai, :scope > .unsaved-dot')) old.remove();
      const g = row.dataset.group;
      const keys = g ? items.filter((i) => (i.group || `key:${i.key}`) === g).map((i) => i.key) : [row.dataset.key!];
      // Before the grip (2D lists keep it last, at the right end).
      const grip = row.querySelector(':scope > .grip');
      for (const m of rowMarks(keys)) row.insertBefore(m, grip && grip === row.lastElementChild ? grip : null);
    }
  };
  const copyTag = (it: Item) => h('span', { class: `tag${it.ghost ? ' ghost' : ''}`, title: d.t(it.ghost ? 'ops.ghostNote' : 'ops.copyNote', { from: it.copyOf || '' }), text: d.t(it.ghost ? 'ops.ghostTag' : 'ops.copyTag') });

  const renderListTools = () => {
    listTools.replaceChildren();
    const n = d.items().length;
    if (!n) {
      // The UI layer with nothing selectable yet: its head as usual ("On screen", or the screen's menu).
      if (d.emptyNote?.()) listTools.append(d.uiHead?.() ?? h('span', { class: 'list-title', text: d.t('list.titleUi') }));
      return;
    }
    const on = d.multi();
    // Head: "Objects  13" ··· "Select" / "Done". The long how-to sentences
    // that sat here (Shift+click, box, ⌘A) are the button's tooltip; with
    // the mode on, one short line says what a press does now.
    // PC: while picking, "press to add, again to remove" is the Done button's
    // tooltip (the round marks already show it; Ive-view review, "still to
    // cut"). Phones have no hover, so they keep the one line.
    const b = h('button', { type: 'button', class: 'small toggle', dataset: { action: 'multi' }, 'aria-pressed': String(on),
      text: on ? d.t('ops.multiDone') : d.t('ops.multi'),
      title: on ? (d.phone() ? '' : d.t('ops.multiOn')) : `${d.t('ops.multiHint')} ${d.phone() ? '' : d.t('ops.multiOff', { all: d.shortcutOf('all') })}`.trim(),
      onclick: () => d.setMulti(!on) });
    // "In this scene" is the world's; the UI's list is "On screen" (Ive review 3 ⑤: titles and scores are not in a scene).
    const uiList = d.items().every((i) => i.kinds.includes('ui'));
    // A game with levels keeps this title: the level is named (and switched) in the top bar's path since level-crumb
    // (2026-10-22); for a few hours it was this head ("Meadow ⌄ 1 of 3"), which nobody found.
    // A game with screens (UI stage 2): the UI list's head names the screen shown, and opens the screens' menu.
    const head = uiList ? d.uiHead?.() ?? null : null;
    // "Multi-select" on a phone only (studio-card-doors, 2026-10-23): a PC has Shift+click and the box drag, and the
    // button was one more word at the top of the list. A PC that turned it on another way (⌘K) still sees "Done".
    listTools.append(head || h('span', { class: 'list-title', text: d.t(uiList ? 'list.titleUi' : 'list.title') }));
    if (d.phone() || on) listTools.append(b);
    if (on && d.phone()) listTools.append(h('span', { class: 'muted list-hint', text: d.t('ops.multiOnPhone') }));
    el.classList.toggle('picking', on);
  };

  const renderList = () => {
    renderListTools();
    const items = d.items();
    const foot = items.length && items.every((i) => i.kinds.includes('ui')) ? d.uiFoot?.() ?? null : null;
    listFoot.replaceChildren(...(foot ? [foot] : []));
    list.replaceChildren();
    // Keep the card's picture registered (it is drawn before the list): before,
    // clearing everything here left the card's thumbnail empty when the
    // picture arrived after the card (new copies, first selection).
    for (const [k, arr] of thumbs) thumbs.set(k, arr.filter((img) => img.isConnected && !list.contains(img)));
    dragging = null;
    const empty = items.length ? null : d.emptyNote?.() ?? null;
    if (empty) {
      list.append(h('li', { class: 'muted list-empty', dataset: { part: 'ui-empty' }, text: empty }));
      return;
    }
    if (d.items().some(hasLayer)) {
      list.classList.add('by-layer');
      list.dataset.order = 'front-first';
      renderLayerList(layerBlocks(d.items()), d.items().filter((i) => !hasLayer(i)));
      return;
    }
    list.classList.remove('by-layer');
    delete list.dataset.order;
    const sel = d.selected();
    // Folded unnamed objects (renderNoName): only the picked one, or all of them with ▸ open, as rows of a picture
    // and a place. Their own name would be the same line again.
    const fold = folding();
    if (fold) {
      for (const it of d.items().filter((i) => i.unstable && (foldOpen || i.key === sel || inGroup(i.key)))) {
        // Its guessed name when it has one ("Black pillar by the road (left, 3rd)", names.ts, 2026-10-19), else where it stands.
        const named = isGuessed(it);
        const sub = h('li', { role: 'option', class: 'obj sub unnamed-row', 'aria-selected': String(it.key === sel || inGroup(it.key)), dataset: { key: it.key }, title: named ? whereOf(it.key) : displayName(it, d.t) },
          thumbImg(it.key), named ? h('span', { class: 'name unnamed', text: displayName(it, d.t) }) : h('span', { class: 'name where mono', text: whereOf(it.key) }), it.copyOf ? copyTag(it) : null);
        sub.addEventListener('click', (e) => d.select(it.key, e.shiftKey));
        list.append(sub);
      }
    }
    /**
     * The tag of objects placed by hand outside their rule (studio-to-coords; studio-hand-marks, the hand-marks plan §4): on
     * a heading "✋ 2" (how many of its objects), on an object's own row "✋ Placed by hand" — picked, "✋" and "Back to
     * rule" (the row is too narrow for both words; CSS swaps them, so a pick that only marks the rows swaps them too).
     */
    const handMark = (members: Item[], own = false): HTMLElement | null => {
      const hs = members.map((m) => hands.get(m.key)).filter((x): x is NonNullable<typeof x> => !!x);
      if (!hs.length) return null;
      const w = hs[0]!;
      const heading = !own && members.length > 1;
      const pill = h('span', { class: 'pill hand-tag', title: w.tip, dataset: { part: 'list-hand-tag', ...(heading ? { n: String(hs.length) } : {}) } },
        icon('hand'), h('span', { text: heading ? String(hs.length) : w.tag }));
      if (heading) return pill;
      const back = h('button', { type: 'button', class: 'link-btn hand-reset', dataset: { part: 'list-rule-reset' }, title: w.tip, onclick: (e: Event) => {
        e.stopPropagation();
        w.run();
      } }, w.reset);
      return h('span', { class: 'hand-mark' }, pill, back);
    };
    const groups = new Map<string, Item[]>();
    // A code layout's objects share one heading (studio-code-knobs: "hex ×4 [Rule]"), whatever the adapter groups by.
    const tags = new Map<string, { tag: string; tip: string }>();
    // The objects put by hand apart from their rule (studio-to-coords): their mark and way back, by key.
    const hands = new Map<string, NonNullable<NonNullable<ReturnType<NonNullable<PlacementPanelDeps['ruleTag']>>>['hand']>>();
    for (const it of d.items()) {
      if (fold && it.unstable) continue;
      if (d.replaced?.(it.key)) continue;
      const rt = d.ruleTag?.(it.key) ?? null;
      if (rt) tags.set(rt.group, { tag: rt.tag, tip: rt.tip });
      if (rt?.hand) hands.set(it.key, rt.hand);
      const g = rt?.group || it.group || `key:${it.key}`;
      const arr = groups.get(g) || [];
      arr.push(it);
      groups.set(g, arr);
    }
    for (const [g, members] of groups) {
      const first = members[0]!;
      const many = members.length > 1;
      const open = expanded.has(g) || (many && members.some((m) => m.key === sel || inGroup(m.key)));
      const allIn = many && members.every((m) => d.group().includes(m.key));
      const heading = many ? kindName(members) : '';
      // A "name ×N" heading: pressing it selects the whole group (move, turn,
      // copy or delete all of them); the ▸ / ▾ button only opens or closes it.
      const toggle = many ? h('button', {
        type: 'button', class: 'expand', 'aria-expanded': String(open), 'aria-label': d.t(open ? 'ops.collapse' : 'ops.expand'),
        dataset: { expand: g },
        onclick: (e: Event) => {
          e.stopPropagation();
          if (open) expanded.delete(g);
          else expanded.add(g);
          renderList();
        },
      }, icon('chevronRight')) : null;
      const row = h('li', { role: 'option', class: `obj${many ? ' group-row' : ''}`, 'aria-selected': String(many ? allIn : first.key === sel || inGroup(first.key)), dataset: { key: first.key, ...(many ? { group: g } : {}) }, title: many ? d.t('ops.selectGroup', { n: members.length }) : undefined },
        toggle,
        thumbImg(first.key),
        // `group` is an id (often a texture URL), not a name: show the first object's label.
        // A group is named by its kind ("crate ×4" → "crate"), not by its first member.
        many ? h('span', { class: 'name', text: heading }) : nameOf(first),
        tags.has(g) ? h('span', { class: 'pill rule-tag', title: tags.get(g)!.tip, text: tags.get(g)!.tag }) : null,
        handMark(members),
        many ? h('span', { class: 'count n mono', text: String(members.length) }) : null,
        !many && first.unstable ? noNamePill(first) : null,
        !many && first.copyOf ? copyTag(first) : null,
      );
      row.addEventListener('click', (e) => {
        if (many) {
          expanded.add(g);
          const keys = members.map((m) => m.key);
          if (e.shiftKey || d.multi()) d.selectMany([...new Set([...d.group(), ...keys])], keys[0]!);
          else d.selectMany(keys, keys[0]!);
        } else d.select(first.key, e.shiftKey);
      });
      list.append(row);
      if (many && open) {
        for (const m of members) {
          // Under a heading of guessed names, only which one ("left, 3rd"): the heading says what they are.
          const mp = isGuessed(m) ? nameParts(displayName(m, d.t)) : null;
          const label = mp && mp.where && mp.base === heading ? h('span', { class: 'name unnamed', title: displayName(m, d.t), text: mp.where }) : nameOf(m);
          const sub = h('li', { role: 'option', class: 'obj sub', 'aria-selected': String(m.key === sel || inGroup(m.key)), dataset: { key: m.key } },
            label, m.unstable ? noNamePill(m) : null, m.copyOf ? copyTag(m) : null, handMark([m], true));
          sub.addEventListener('click', (e) => {
            e.stopPropagation();
            d.select(m.key, e.shiftKey);
          });
          list.append(sub);
        }
      }
    }
    markRows();
    revealSelected();
  };

  return {
    el,
    cardEl: card,
    noNameEl: noName,
    listToolsEl: listTools,
    askEl,
    askNoteEl,
    renderAsk,
    startRename,
    isRenaming: () => renameKey !== null,
    render() {
      renderCard();
      renderNoName();
      renderList();
      renderAsk();
    },
    updateNumbers,
    markRows,
    updateThumb(key) {
      const src = safeImageSrc(d.thumb(key));
      for (const img of thumbs.get(key) || []) {
        if (src) {
          img.src = src;
          toneThumb(img, src);
          img.classList.remove('empty');
        }
      }
    },
  };
}

/**
 * The card's line for an object the game changes by itself (Item.held 'game'): the tester's own words when the game
 * moves it ("This object is moved by the game — its place is not kept when you save", 2026-10-19), else what the game
 * changes; then what can still be changed, so the person knows what is worth trying.
 */
export function heldGameText(it: Pick<Item, 'driven' | 'movable' | 'rotatable' | 'scalable' | 'startSpot'>, dim: Dim, t: (k: string, v?: Record<string, string | number>) => string): string {
  // Move / Height set where it starts (hold.ts startSpot): what a move does now, not that it won't stick.
  if (it.startSpot) return t('hold.gameStart');
  const driven = new Set(it.driven ?? []);
  const parts = (['move', 'lift', 'turn', 'size'] as const).filter((k) => k !== 'lift' || dim === '3d');
  const words = (ks: readonly string[]) => listOf(ks.map((k) => t(`hold.part.${k}`)), t);
  const free = parts.filter((k) => !driven.has(k) && (k === 'move' ? it.movable !== false : k === 'turn' ? it.rotatable : k === 'size' ? it.scalable : true));
  const head = driven.has('move') ? t('hold.game') : t('hold.gameParts', { what: words(parts.filter((k) => driven.has(k))) });
  // Japanese sentences follow each other without a space.
  return free.length ? `${head}${head.endsWith('。') ? '' : ' '}${t('hold.still', { what: words(free) })}` : head;
}

/** "a, b, and c" in English, the list mark in Japanese (i18n hold.and / hold.sep). */
function listOf(xs: string[], t: (k: string) => string): string {
  if (xs.length < 2) return xs[0] ?? '';
  const sep = t('hold.sep');
  return xs.slice(0, -1).join(sep) + t(xs.length > 2 ? 'hold.and3' : 'hold.and') + xs[xs.length - 1];
}
