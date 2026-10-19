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
import { tipText } from './keymap.ts';
import { displayName } from './names.ts';
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
  copy(): void;
  remove(): void;
  /** Phone layout (no Shift key, no box: the hints say so). */
  phone(): boolean;
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
   * Files picked in the Library while it is open ("use the Library", 2026-10-18): the chip names them with the
   * objects, and the words are sent about both. Absent / empty = objects only.
   */
  assets?(): string[];
  /** The card's "Show in Library →": the Library with this pick's detail. Absent = no Library in this build. */
  showInLibrary?(): void;
  /** Ask the AI to name these objects (the "no name" warning). */
  askName(keys: string[]): Promise<boolean>;
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
}

const DEG = 180 / Math.PI;

export function createPlacementPanel(d: PlacementPanelDeps): PlacementPanel {
  const el = h('div', { class: 'placement' });
  const card = h('section', { class: 'card', 'aria-live': 'polite', dataset: { part: 'card' } });
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
  const listScroll = h('div', { class: 'list-scroll' }, noName, list);
  el.append(listTools, listScroll);
  let noNameSent = false;
  const renderNoName = () => {
    const keys = d.items().filter((i) => i.unstable).map((i) => i.key);
    noName.replaceChildren();
    noName.hidden = !keys.length;
    if (!keys.length) return;
    // Grey words, then one text button. After the press the row says it was asked (and stays until the names land).
    noName.append(h('span', { class: 'noname-text', text: noNameSent ? d.t('ask.nameSent') : d.t('noname.row', { n: keys.length }) }));
    if (noNameSent) return;
    noName.append(h('button', { type: 'button', class: 'link noname-act', dataset: { action: 'ask-name-all' }, onclick: async () => {
      noNameSent = await d.askName(keys);
      renderNoName();
    } }, h('span', { text: d.t(keys.length === 1 ? 'noname.act1' : 'noname.act') })));
  };
  const expanded = new Set<string>();
  const thumbs = new Map<string, HTMLImageElement[]>();
  let inputs: Array<{ input: HTMLInputElement; read: (p: Pose) => number; show: (v: number) => string }> = [];

  const thumbImg = (key: string) => {
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
  let cardKey: string | null = null;
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
  const askEl = h('form', { class: 'ask-box', dataset: { part: 'ask' } }, h('span', { class: 'ask-spark', 'aria-hidden': 'true' }, icon('spark')), askChip, askInput,
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
    const files = d.assets?.() || [];
    const items = d.items();
    const first = items.find((i) => i.key === keys[0]);
    const k = keys.length || files.length ? [...[...keys].sort(), ...files].join(',') : null;
    // "Sent to your AI" belongs to what it was sent about.
    if (k !== askKey) askNote = '';
    askKey = k;
    const noObj = !keys.length || !first;
    const whole = noObj && !files.length;
    const n = (noObj ? 0 : keys.length) + files.length;
    const ph = whole ? d.t('ask.game') : n > 1 ? d.t('ask.chipMany') : d.t('ask.chipOne');
    askChip.hidden = whole;
    // The shown name, never the key: an unnamed object's key is `path:3/2`, which means nothing to a person (U4).
    // A file picked in the Library is named by its file name ("boss.glb"); objects and files together, by how many.
    const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
    const firstName = noObj ? (files.length ? fileName(files[0]!) : '') : displayName(first, d.t);
    askChip.textContent = whole ? '' : n === 1 ? firstName : noObj ? d.t('ask.files', { n }) : files.length ? d.t('ask.picked', { n }) : d.t('ops.manyShort', { n });
    askChip.title = files.length ? [...(noObj ? [] : keys.map((key) => { const it = items.find((i) => i.key === key); return it ? displayName(it, d.t) : key; })), ...files].join('\n') : '';
    askInput.placeholder = ph;
    // Read aloud as one sentence ("Ask your AI about “crate-4”…").
    askInput.setAttribute('aria-label', whole ? ph : n > 1 ? d.t('ask.many', { n }) : d.t(noObj ? 'ask.oneFile' : 'ask.one', { name: firstName }));
    askEl.classList.toggle('whole', whole);
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
    return h('button', { type: 'button', class: 'link-btn', dataset: { action: 'select-kind' }, title: d.t('ops.selectKind', { n: kind.length }),
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

  /** The card's head: picture(s) · name over a grey second line · copy · delete. */
  const head = (pics: HTMLElement, name: string, sub: string | null, cls = '') =>
    h('div', { class: `card-head ${cls}`.trim() }, pics,
      h('div', { class: 'head-text' }, h('strong', { text: name }), h('div', { class: 'key', text: sub || '' })),
      actionRow());

  const renderGroupCard = (keys: string[]) => {
    const items = d.items();
    const members = keys.map((k) => items.find((i) => i.key === k)).filter((i): i is Item => !!i);
    const names = members.slice(0, 6).map((m) => displayName(m, d.t)).join(', ') + (members.length > 6 ? ' …' : '');
    cardKey = 'group:' + [...keys].sort().join(',');
    // What the strip does with several is told once, on the heading's tooltip.
    const h0 = head(h('div', { class: 'stack' }, ...members.slice(0, 3).map((m) => thumbImg(m.key))), d.t('ops.many', { n: members.length }), names, 'group-head');
    h0.title = d.t('ops.groupHint');
    card.append(h0);
    const body = h('div', { class: 'card-body' });
    if (members.some((m) => m.movable === false)) body.append(h('p', { class: 'muted note-line', text: d.t('ops.lockedSkipped') }));
    const lr = groupLayerRow(keys);
    if (lr) body.append(lr);
    // While "Select" is on, its "Done" is the way out.
    if (!d.multi()) body.append(h('button', { type: 'button', class: 'link-btn', dataset: { action: 'select-none' }, text: d.t('ops.selectNone'), onclick: () => d.selectMany([], '') }));
    card.append(body);
  };

  const renderCard = () => {
    card.replaceChildren();
    inputs = [];
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
    const h0 = head(thumbImg(key), shown, !it.unstable && !/#\d+$/.test(key) && it.label !== key ? key : null);
    const sub = h0.querySelector('.key') as HTMLElement;
    card.append(h0);
    const body = h('div', { class: 'card-body' });
    // Phone: no numbers on the card (design review wave 1, W1-11 / N6, 2026-10-17). The head's second line used to be
    // "-24.00, 6.63, -20.00 · 0°", raw numbers that a finger cannot edit there; the card is the name, copy, delete and
    // "…" (which still opens the fields). The second line stays empty; whoever needs numbers reads them on a PC.
    if (d.phone()) sub.textContent = '';
    animate();
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
    fields.append(h('span', { class: 'f-l', text: d.t('placement.pos') }));
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
    fine.append(fields);
    if (it.scalable && typeof it.defaultScale === 'number') {
      const target = it.defaultScale;
      fine.append(h('button', { type: 'button', class: 'link-btn', dataset: { action: 'reset-size' }, text: `${d.t('placement.resetSize')} ×${target}`, onclick: () => {
        const cur = d.pose(key);
        if (cur) d.setPose(key, { ...structuredClone(cur), s: target });
      } }));
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
    if (it.unstable) {
      // A name is something the AI gives in code. Grey, not yellow: a missing
      // name is a thing to improve, not a fault.
      body.append(h('p', { class: 'warn note-line' },
        h('span', { class: 'pill', title: d.t('placement.unstable'), text: d.t('noname.tag') }), ' ',
        h('button', { type: 'button', class: 'name-ask link-btn', dataset: { action: 'ask-name' }, text: d.t('ask.name'), onclick: async (e: Event) => {
          const b = e.currentTarget as HTMLButtonElement;
          b.disabled = true;
          const ok = await d.askName(d.selectedKeys().filter((k) => d.items().find((i) => i.key === k)?.unstable));
          askNote = ok ? d.t('ask.nameSent') : d.t('ask.fail');
          renderAsk();
          renderCard();
        } })));
    }
    if (it.copyOf) body.append(h('p', { class: 'muted copy-note note-line', text: d.t(it.ghost ? 'ops.ghostNote' : 'ops.copyNote', { from: it.copyOf }) }));
    // 7. The way to this object in the Library ("use the Library", 2026-10-18: "when I pick something in the game, I
    // want to go straight to its page in the Library"); its file is the Assets row above.
    if (d.showInLibrary) body.append(h('button', { type: 'button', class: 'link-btn lib-link', dataset: { action: 'show-in-library' }, text: d.t('card.showInLibrary'), onclick: () => d.showInLibrary!() }));
    const kl = kindLink(key);
    if (kl) body.append(kl);
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
    let pre = names[0] || '';
    for (const n of names) while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
    pre = pre.replace(/[\s#:_.-]+$/, '');
    return pre.length >= 2 ? pre : names[0] || '';
  };
  const nameOf = (it: Item) => h('span', { class: it.unstable ? 'name unnamed' : 'name', title: it.unstable ? d.t('placement.unstable') : undefined, text: displayName(it, d.t) });
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
    if (!n) return;
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
    listTools.append(h('span', { class: 'list-title', text: d.t('list.title') }), b);
    if (on && d.phone()) listTools.append(h('span', { class: 'muted list-hint', text: d.t('ops.multiOnPhone') }));
    el.classList.toggle('picking', on);
  };

  const renderList = () => {
    renderListTools();
    list.replaceChildren();
    // Keep the card's picture registered (it is drawn before the list): before,
    // clearing everything here left the card's thumbnail empty when the
    // picture arrived after the card (new copies, first selection).
    for (const [k, arr] of thumbs) thumbs.set(k, arr.filter((img) => img.isConnected && !list.contains(img)));
    dragging = null;
    if (d.items().some(hasLayer)) {
      list.classList.add('by-layer');
      list.dataset.order = 'front-first';
      renderLayerList(layerBlocks(d.items()), d.items().filter((i) => !hasLayer(i)));
      return;
    }
    list.classList.remove('by-layer');
    delete list.dataset.order;
    const groups = new Map<string, Item[]>();
    for (const it of d.items()) {
      const g = it.group || `key:${it.key}`;
      const arr = groups.get(g) || [];
      arr.push(it);
      groups.set(g, arr);
    }
    const sel = d.selected();
    for (const [g, members] of groups) {
      const first = members[0]!;
      const many = members.length > 1;
      const open = expanded.has(g) || (many && members.some((m) => m.key === sel || inGroup(m.key)));
      const allIn = many && members.every((m) => d.group().includes(m.key));
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
        many ? h('span', { class: 'name', text: kindName(members) }) : nameOf(first),
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
          const sub = h('li', { role: 'option', class: 'obj sub', 'aria-selected': String(m.key === sel || inGroup(m.key)), dataset: { key: m.key } },
            nameOf(m), m.unstable ? noNamePill(m) : null, m.copyOf ? copyTag(m) : null);
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
