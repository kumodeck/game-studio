// The shell page. Entries: shell/local.ts (studio-shell.js, the local server)
// and hosts/browser/main.ts (the browser-only web demo); each passes its own
// StudioHost to start().
//
// The shell owns everything shared between tools: the game frame, the
// connection to the bridge, selection, undo/redo for placement, keeping the
// results as you go and handing them to the AI, the language, the Scene /
// Assets switch, the ⌘K list and the Ideas / Look pages. Layout (rebrand
// 2026-10-16, see the DOM section): the game edge to edge; the list on the
// left (a sheet on a phone); the picked object's card and the ask bar float
// over the game and tell the bridge what they cover (core/ui inset). The tool
// strip and the outlines are drawn inside the game page by the bridge.
import {
  LOCAL_PATHS,
  UI,
  isStudioMessage,
  type BridgeToShell,
  type Dim,
  type GameConfig,
  type Inset,
  type GameToolInfo,
  type Item,
  type Lang,
  type Pose,
  type SelfCheckResult,
  type ShellContext,
  type ShellToBridge,
  type ShellTool,
  type StudioHost,
  type StudioRequestInput,
  type StudioStatus,
  type ShellPart,
  type StripTool,
  type StudioShellApi,
  type ToolId,
  type UiPrefs,
} from '../contract.ts';
import { keyStep } from '../core/keys.ts';
import { validateLibrary, validatePlacement } from '../schema/index.ts';
import { filesOfObject, libraryTool, openAsset } from '../tools/library/index.ts';
import { rulesFor } from '../core/rules.ts';
import { samePose } from './placement-model.ts';
import { h, safeImageSrc } from './dom.ts';
import { detectLang, setExtraText, translate } from './i18n.ts';
import { AI_STEPS, NEXT_STEPS, renderNextSteps, type StepId } from './next-steps.ts';
import { statusCovers } from '../schema/handoff.mjs';
import { aiBusy, aiPhase, reloadDecision, type AiPhase } from './ai-flow.ts';
import { renderSettings } from './settings-page.ts';
import { DEFAULT_UI, effectiveTheme, normalizeUi } from './ui-prefs.ts';
import { dropTarget, hasLayer, layerTarget, type LayerOp } from './layers.ts';
import { createPlacementPanel } from './placement-panel.ts';
import { icon, setButton } from './icons.ts';
import { createPalette, type PaletteRow } from './palette.ts';
import { fitPicture } from './thumb-fit.ts';
import { PlacementModel } from './placement-model.ts';
import { UndoStack, poseChange, type Change, type UndoEntry } from './undo.ts';
import { copyKey, groupLayerMoves, sameKind } from './edit-ops.ts';
import { displayName } from './names.ts';

type Phase = 'loading' | 'waiting' | 'no-adapter' | 'ready' | 'playing';

const VIEW_KEY = 'game-studio:view';
const store = {
  get(k: string): string | null {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* private mode: the view just resets on reload */
    }
  },
};

// ⌘ on Apple keyboards, Ctrl elsewhere (both work on every system).
/** The strip's tool keys (lower case, as shortcut() reads them) — the same as the game page's (bridge/handles.ts TOOL_KEYS). */
const STRIP_KEYS: Record<string, StripTool> = { m: 'move', h: 'lift', t: 'rotate', s: 'scale' };
const STRIP_ICONS: Record<StripTool, string> = { move: 'toolMove', lift: 'toolLift', rotate: 'toolRotate', scale: 'toolScale' };
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function start(host: StudioHost) {
  let lang: Lang = detectLang(location.search, navigator.language || 'en');
  const t = (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);

  // ----- state -----
  let phase: Phase = 'loading';
  let gameUrl = '';
  let gameOrigin = location.origin;
  let bridgeAlive = false;
  let editing = false;
  let dim: Dim = '3d';
  let adapterInfo = '';
  let items: Item[] = [];
  let selected: string | null = null;
  // Several objects at once (CONTRACT.md §1.8): the whole selection, `selected`
  // included. `multi` = "Select several" mode (a press adds / takes out).
  let group: string[] = [];
  let multi = false;
  // The tool strip's chosen tool in the game (placement/tool from the bridge): Escape drops it first, ⌘K shows it.
  let stripTool: StripTool | null = null;
  // The strip's choices (the ▾ on turn / size) are open in the game (placement/menu): a press in this page or Escape
  // closes them first (tool options, 2026-10-18). The game frame closes them itself for presses and keys inside it.
  let stripMenu = false;
  // Stand-in copies were explained once this session (adapters without clone()).
  let ghostTold = false;
  // Copies asked for with ⌘D / Copy whose answer (placement/added) has not come yet: those make a new undo step.
  const pendingCopies = new Set<string>();
  let check: SelfCheckResult | null = null;
  // ?tool=library opens on the Library (studio.mjs --tool library).
  let tool: ToolId = new URLSearchParams(location.search).get('tool') === 'library' ? 'library' : 'placement';
  let page: 'tool' | 'next' | 'settings' = 'tool';
  // How the person likes the editor (.studio/ui.json) and what the AI set up
  // for this game (.studio/studio.json, .studio/tools.js).
  let uiPrefs: UiPrefs = { ...DEFAULT_UI, show: { ...DEFAULT_UI.show } };
  let uiSaveTimer = 0;
  // ?ui=off: the original look — no saved prefs, no .studio/ui/ css/js, and
  // nothing written back. The way back when a rewrite went wrong.
  const safeUi = new URLSearchParams(location.search).get('ui') === 'off';
  let gameConfig: GameConfig | null = null;
  let gameTools: GameToolInfo[] = [];
  let activeTool: string | null = null;
  const toolDirty = new Map<string, number>();
  let toolDataWaiter: ((items: Array<{ id: string; data: unknown }>) => void) | null = null;
  let nextOpen: StepId | null = null;
  let sheetOpen = false;
  let toast = '';
  let toastTimer = 0;
  const thumbs = new Map<string, string>();
  // The last raw picture the game sent per object (before cropping, thumb-fit.ts).
  const thumbAsked = new Map<string, string>();
  const model = new PlacementModel();
  const undo = new UndoStack();
  const listeners = new Map<string, Set<(m: BridgeToShell) => void>>();
  let placementRestored = false;
  // itemsSeen: the game has answered with its object list at least once. Before
  // that the card said "No movable objects found", which read as "broken"
  // while the game was still starting (UI/UX review 2026-10-16, journey view).
  let itemsSeen = false;
  // The game's name for the title (host.open: the page <title> or the folder name).
  let gameName = '';
  // Hand-offs to the AI (CONTRACT.md §3.4). `pending` = the latest request
  // this page handed over; `aiStatus` = what the agent last wrote back. The
  // line under the status says which: waiting → "say 'look'" → got it → done.
  // `text`: the person's own words, shown back in the line ('"make it glow"
  // handed to your AI…', then '"make it glow" → done'): what was asked and what
  // the AI did read side by side (verganti review 2026-10-16).
  let pending: { kind: StudioRequestInput['kind'] | 'saved'; id?: string; at: number; sent: number; text?: string } | null = null;
  let aiStatus: StudioStatus | null = null;
  // The "done" status the person reloaded for: its line then shows what changed instead of "Reload".
  let aiReloadFor: string | null = null;
  let aiTime: number | null = null;
  const openedAt = Date.now();
  // AI feel (2026-10-16, ai-flow.ts). `aiWatching`: is an AI's watch running
  // right now (`studio.mjs --watch`; undefined = this host cannot tell, then
  // the old "say look after 20 s" line); `aiSeen`: the last request the watch
  // showed the AI. `code`: the game files' signature from the host, `codeSince`
  // since when it is unchanged, `loadedCode` what it was when the game in the
  // frame was opened: when they differ the game reloads by itself (no "Reload"
  // button to find). The reload happens in a second frame BEHIND the one on
  // screen (`swapping` = the old frame), which goes only once the new game has
  // drawn its objects: no flash of black or of an empty list.
  let aiWatching: boolean | undefined;
  let aiSeen: string | undefined;
  let code: string | undefined;
  let codeSince = 0;
  let loadedCode: string | undefined;
  let swapping: HTMLIFrameElement | null = null;
  let swapTimer = 0;
  // The selection to give back to the new game after a reload.
  let keepSel: { selected: string | null; group: string[] } | null = null;
  // "Undo AI change": `changeFrom` = the first request since the last change
  // shown that the host kept a snapshot for; when the change is shown it
  // becomes `lastChange.from` (Undo puts the files back to it; `redo` = the
  // snapshot of the AI's version, made by the host when undoing). `aiAfter`:
  // the line says "back to before" / "your AI's change is back".
  let changeFrom: string | null = null;
  let lastChange: { from: string; redo: string | null } | null = null;
  let aiAfter: 'undone' | 'redone' | null = null;
  let undoBusy = false;
  // What the AI's last change did, made visible (the AI line said "made 3
  // changes", but not where). When the person presses "Reload the game"
  // after the AI is done, the poses on screen are kept; the first object
  // list of the new game is compared with them, and the objects that moved
  // or are new get an "AI" mark in the list and a "Show the N it changed"
  // button that selects them (outlined in the game).
  let aiBefore: Map<string, Pose> | null = null;
  // The poses from before the FIRST reload of an AI change that was still under way (agent-solid pass 2026-10-17):
  // a later reload of the same change compares with these, not with the half-done game, so three new lighthouses
  // stay "AI added 3" (a real run said "AI moved 3": the AI had moved its own new lighthouses after the first
  // reload). Cleared by a new request and by any reload once the AI is no longer working.
  let aiBase: Map<string, Pose> | null = null;
  let aiMarks = new Map<string, 'moved' | 'added'>();
  // The marks as sent to the game (again on every edit start: a reload makes a new game page).
  let aiMarksMsg: { keys: string[]; label?: string } = { keys: [] };
  let aiGone = 0;
  // Files per object for the card's "Assets: …" line, asked once per game load.
  const filesCache = new Map<string, Promise<Array<{ path: string; name: string; src?: string }>>>();

  // ----- DOM -----
  // Rebrand 2026-10-16 ("one list, one card, one input"; the design is in the
  // README's "Look" section). The game is the subject: it runs edge to edge
  // and the tools are three things only.
  //
  //   ┌ top bar 44: ▣ Studio / Crate Yard / Scene ······ ✓ Saved · ● AI · [▶ Play P] ┐
  //   │ left column 248   │ game, edge to edge                  ┌ card 272 ┐       │
  //   │  ▢ Scene       8  │                                     │ crate-4  │       │
  //   │  ▦ Assets      4  │        (crate-4)                    │ X Y Z    │       │
  //   │  ─────────────    │         [▣]   ← orange outline      └──────────┘       │
  //   │  ground           │        [✥ ↕ ⟳ ⤢] ← the tool strip (in the game)        │
  //   │  crate        4   │                                                        │
  //   │  ✦ name them  1   │      ┌ ✦ [crate-4] ask your AI…            ↑ ┐         │
  //   │  ⌘K all actions   │      └ the ask bar = the ⌘K list ────────────┘         │
  //
  // Colour carries two meanings only: orange = your hand (what you picked),
  // violet = the AI's hand (what it changed, the ask bar's spark). The rest is
  // four steps of grey, so nothing competes with the game's own colours.
  // What went, and why, is in the README ("What was taken out"): the always-on
  // Save button (now "Save · 3" only while something is not saved), Show all / View / Ideas / Undo / Redo buttons
  // (⌘K, and the phone keeps Undo in its top bar), the Scene | Assets tabs
  // (two rows of the left column), the four round handles (one strip), the
  // folded numbers (always shown) and the how-to paragraph (one first hint).
  // `let`: a reload after the AI's change swaps in a new frame (softReload).
  const makeFrame = () => h('iframe', { class: 'game', title: 'Game', allow: 'autoplay; fullscreen; gamepad; accelerometer; gyroscope' }) as HTMLIFrameElement;
  let iframe = makeFrame();
  // The ⌘K list dims the game behind it: one thing to look at.
  const scrim = h('div', { class: 'scrim', hidden: true, onpointerdown: () => palette.close() });
  // Assets take the game's place (PC) or rise as a sheet (phone): the same
  // left column, the other of its two places.
  const assetsPage = h('section', { class: 'assets-page', hidden: true, dataset: { part: 'assets-page' } });
  // The picked object's card floats over the game's top right corner (PC).
  const inspector = h('div', { class: 'inspector', dataset: { part: 'inspector' } });
  const status = h('div', { class: 'status', role: 'status', dataset: { part: 'status' } });
  const panel = h('div', { class: 'panel', dataset: { part: 'panel' } });
  const toolEl = h('div', { class: 'tool-body' });
  const toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  const aiLine = h('div', { class: 'ai-line', role: 'status', 'aria-live': 'polite', dataset: { part: 'ai' }, hidden: true });

  const btn = (key: string, onclick: () => void, extra: Record<string, unknown> = {}) =>
    h('button', { type: 'button', dataset: { action: key }, onclick, ...extra });
  // Scene | Assets: two rows at the top of the left column (were tabs: tabs
  // read as two separate screens; rows read as two views of one place, and
  // switching works with the same hand as picking from the list).
  const tabs = h('nav', { class: 'tabs', role: 'tablist', dataset: { part: 'tabs' } });
  const undoBtns: HTMLButtonElement[] = [];
  const redoBtns: HTMLButtonElement[] = [];
  const saveBtns: HTMLButtonElement[] = [];
  const playBtns: HTMLButtonElement[] = [];
  const mk = (arr: HTMLButtonElement[], key: string, fn: () => void, extra: Record<string, unknown> = {}) => {
    const b = btn(key, fn, extra);
    arr.push(b);
    return b;
  };
  function setLang(next: Lang) {
    lang = next;
    send({ type: 'studio:core/lang', lang });
    changeUi({ ...uiPrefs, lang });
    renderAll(true);
  }
  // Hidden by default (show.lang); the Look page and ⌘K have the language.
  const langBtn = btn('lang', () => setLang(lang === 'en' ? 'ja' : 'en'));
  langBtn.classList.add('link', 'lang');
  const toolsRow = h('div', { class: 'game-tools', role: 'toolbar', dataset: { part: 'tools' } });
  // Buttons added by .studio/ui/shell.js (studioShell.addButton), kept across re-renders.
  const customTools: HTMLButtonElement[] = [];
  // Where you are, always in one line: ▣ Studio / <the game> / Scene.
  const brand = h('div', { class: 'brand', dataset: { part: 'brand' } },
    h('span', { class: 'mark', 'aria-hidden': 'true' }, icon('mark')), h('span', { class: 'app' }), h('span', { class: 'sep', 'aria-hidden': 'true', text: '/' }),
    h('strong', { class: 'title' }), h('span', { class: 'sep here-sep', 'aria-hidden': 'true', text: '/' }), h('span', { class: 'here' }), h('span', { class: 'adapter' }), langBtn);
  // One "Save" (play test 10/16: "Hand to AI" meant nothing to people; "Save"
  // does). "Save · 3" (⌘S) while there are changes not saved; pressing it
  // writes placement.json and hands it to the AI, as Save always did. Then
  // "✓ Saved" in the same place until the next change. The quiet writes in
  // between are a draft only (so closing the tab loses nothing) and are never
  // shown: two different "saved" on one screen read as a contradiction.
  const saveState = h('span', { class: 'save-state', dataset: { part: 'save-state' } });
  // Undo / redo: phones show Undo here once there is something to undo (no
  // keyboard there); on PC they are ⌘Z / ⇧⌘Z and rows of the ⌘K list.
  // "✓ Saved" sits right after Save, in the slot Save leaves, and keeps Save's
  // width (renderButtons): nothing next to it moves when Save goes away.
  // WHY (web demo bug, 2026-10-16): it used to sit left of Undo, so on phones
  // Save vanished and Undo slid right into the spot under the finger. A second
  // tap on "Save" (people tap again when the first one seems to do little)
  // pressed Undo: the object jumped back, "Save · 1" came back, and the next
  // draft write kept the undone place — "saving does not work".
  const footer = h('div', { class: 'actions', dataset: { part: 'footer' } },
    mk(undoBtns, 'undo', doUndo, { class: 'icon-btn' }), mk(redoBtns, 'redo', doRedo, { class: 'icon-btn' }), mk(saveBtns, 'save', () => void handOff()), saveState);
  // Is the AI there? Grey until it writes back in this session, green after,
  // violet while it works. (The editor cannot see the AI's window; this is
  // only what the AI told it, so it never claims more.)
  const peer = h('span', { class: 'peer', dataset: { part: 'peer' } }, h('span', { class: 'dot' }), h('span', { class: 'label', text: 'AI' }));
  // Play is the only white button on screen, so it is never looked for.
  const topActions = h('div', { class: 'top-actions', dataset: { part: 'top-actions' } }, mk(playBtns, 'play', togglePlay, { class: 'play' }));
  // The web demo has no AI to show the state of (W1-6): no "● AI" at all.
  const header = h('header', { class: 'top', dataset: { part: 'header' } }, brand, toolsRow, h('div', { class: 'top-right' }, footer, host.offline ? null : peer, topActions));
  // The column's foot: "✦ Ask your AI to name them  1" and "⌘K All actions".
  const noNameSlot = h('div', { class: 'noname-slot' });
  // Phone: the sheet closes so the ⌘K list rises from the ask bar alone.
  const openPalette = () => {
    if (phone() && sheetOpen) {
      sheetOpen = false;
      renderAll(true);
    }
    palette.open();
  };
  const paletteFoot = h('button', { type: 'button', class: 'foot-row', dataset: { action: 'palette' }, onclick: openPalette },
    h('kbd', { text: isMac() ? '⌘K' : 'Ctrl K' }), h('span', { class: 'label' }));
  // Narrow screens (a phone, the side window next to a chat): the sheet's head is ONE row —
  // [Scene 15 | Assets 1] ··· Multi-select  … — and everything under it is the list.
  // WHY (a try in the side window next to a chat, ~400×590, 2026-10-17): with an object picked, the sheet stacked
  // Scene and Assets as two 44 px rows, "Objects ··· Multi-select", "All actions" at its foot,
  // then the picked object's card and the ask bar over the foot; the list was left ONE row
  // (sea-arch) — "the object list becomes impossible to follow". Now the two rows are one
  // segmented switch, the list's own head moves up beside it (renderAll moves listToolsEl here
  // and back), and "All actions" becomes this "…" (the same ⌘K list, same press). PC keeps its
  // column as it was: .side-head is `display: contents` there and these tools are hidden.
  const sheetMore = h('button', { type: 'button', class: 'icon-btn sheet-more', dataset: { action: 'palette' }, onclick: openPalette }, icon('more'));
  const headTools = h('div', { class: 'side-head-tools' }, sheetMore);
  const side = h('aside', { class: 'side', dataset: { part: 'side' } }, h('div', { class: 'side-head' }, tabs, headTools), status, panel,
    h('div', { class: 'side-foot' }, noNameSlot, paletteFoot));
  // Phone: the list opens from the ask bar's left end, as a sheet from the bottom.
  const sheetBtn = btn('sheet', () => {
    sheetOpen = !sheetOpen;
    page = 'tool';
    if (sheetOpen && tool === 'library') tool = 'placement';
    renderAll(true);
  }, { class: 'icon-btn' });
  // News over the ask bar, one card, one place: a toast (copy failed…), the
  // AI line (handed over → picked up → done, with "Show" / "Reload"), the ask
  // box's own note and "playing".
  // The first-run tips that sat here ("1/4 Click an object…" → "2/4 drag it" → …,
  // intro.ts) were removed on 2026-10-17 after a try of the web demo: "I don't
  // need this". The editor should open on the game alone. Don't bring back a
  // step-by-step tour here without asking.
  const playNote = h('p', { class: 'play-note', hidden: true });
  const caption = h('div', { class: 'ai-caption', hidden: true }, toastEl, aiLine, playNote);
  const askSlot = h('div', { class: 'ask-slot' });
  // The web demo's line in the ask box's place (W1-6); its words are set in renderAll (language).
  const offlineLine = h('p', { class: 'offline-line', dataset: { part: 'offline-line' } }, h('span', { class: 'label' }),
    host.getUrl ? h('a', { href: host.getUrl, target: '_blank', rel: 'noopener noreferrer' }) : document.createDocumentFragment());
  const bar = h('div', { class: 'bar', dataset: { part: 'bar' } }, sheetBtn, askSlot);
  // Phone: the picked object's card sits right above the ask bar (thumb's reach).
  const cardSlot = h('div', { class: 'card-slot' });
  const dock = h('section', { class: 'ask-strip dock' }, caption, cardSlot, h('div', { class: 'palette-slot' }), bar);
  const stage = h('div', { class: 'stage', dataset: { part: 'stage' } }, iframe, scrim, assetsPage, inspector, dock);
  const app = h('div', { class: 'shell', dataset: { part: 'app' } }, header, side, stage);
  document.getElementById('app')!.replaceWith(app);
  panel.append(toolEl);
  // A click on the bare desk drops the pick, the same as a tap on nothing in the game (bridge/input.ts; a web demo try
  // 2026-10-18: "I want to click an empty spot to deselect, and I can't"). Bare = the surface itself, not a row, a
  // button, the card or a field on it: the 8 px margin round the game plate, the empty part of the list column under
  // the rows, the top bar's empty middle, and the see-through gap between the card and the ask bar (phone; a finger
  // there is mostly moved onto the ask field by the browser, a mouse is not). `click`, not pointerdown: a press that ends somewhere else (a drag out
  // of the list) is not a click on nothing.
  const BARE = '.shell, .top, .top-right, .side, .side-head, .side-foot, .panel, .placement, .tool-body, .list-scroll, .objects, .stage, .dock, .card-slot';
  app.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (!t || !t.matches(BARE) || !editing || playing || !(selected || group.length)) return;
    selectObject(null);
  });
  // The news card shows when one of its lines has something to say.
  const updateCaption = () => {
    const any = [...caption.children].some((c) => !(c as HTMLElement).hidden && (!(c as HTMLElement).classList.contains('toast') || (c as HTMLElement).classList.contains('on')));
    if (caption.hidden === any) caption.hidden = !any;
  };
  new MutationObserver(updateCaption).observe(caption, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });

  const phone = () => window.innerWidth <= UI.phoneMaxWidth;
  // Strip button size sent to the game: the person's choice, but never below
  // 44 px on a phone (a 28 px button is right for a mouse, small for a finger).
  const handlePx = () => (phone() ? Math.max(UI.handlePxPhone, uiPrefs.handleSize) : uiPrefs.handleSize);
  // What the floating panels cover, so the tool strip and "bring into view" stay clear of them.
  let insetSent = '';
  const sendInset = () => {
    const sr = stage.getBoundingClientRect();
    const inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
    // The bar and, on a phone, the card above it (the news card comes and goes: not counted).
    const top = phone() && !placementPanel.cardEl.hidden && cardSlot.contains(placementPanel.cardEl) ? cardSlot.getBoundingClientRect().top : bar.getBoundingClientRect().top;
    if (!dock.hidden && dock.offsetParent) inset.bottom = Math.max(0, Math.round(sr.bottom - top + 8));
    // The phone's list sheet pads its foot by what the bar and the card cover (shell.css --studio-cover):
    // the card's height differs (2D Layer row, the open numbers), so it is measured, not guessed.
    if (phone() && !dock.hidden && dock.offsetParent) {
      const cover = `${Math.max(0, Math.round(window.innerHeight - top))}px`;
      if (app.style.getPropertyValue('--studio-cover') !== cover) app.style.setProperty('--studio-cover', cover);
    }
    // A phone's list sheet, and its Assets sheet, cover the lower part of the game.
    // (Its final height, not its rect: it may still be sliding up.)
    if (phone() && (sheetOpen || page !== 'tool') && !playing) inset.bottom = Math.max(inset.bottom, Math.round(sr.bottom - (window.innerHeight - side.offsetHeight) + 8));
    if (phone() && tool === 'library' && !assetsPage.hidden) inset.bottom = Math.max(inset.bottom, Math.round(sr.bottom - assetsPage.getBoundingClientRect().top));
    const card = placementPanel.cardEl;
    if (!phone() && !card.hidden && card.isConnected && card.offsetParent) {
      const cr = card.getBoundingClientRect();
      inset.right = Math.max(0, Math.round(sr.right - cr.left + 8));
      inset.rightTo = Math.round(cr.bottom - sr.top + 8);
    }
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const k = JSON.stringify([inset, theme, handlePx()]);
    if (k === insetSent) return;
    insetSent = k;
    send({ type: 'studio:core/ui', handlePx: handlePx(), inset, theme });
  };
  new ResizeObserver(() => sendInset()).observe(dock);

  // ----- tools -----
  const placementPanel = createPlacementPanel({
    t,
    items: () => items,
    selected: () => selected,
    pose: (k) => model.pose(k),
    dim: () => dim,
    thumb: (k) => thumbs.get(k) || null,
    select: (k, add) => (add || multi ? toggleSelect(k) : selectObject(k, true)),
    selectMany: (keys, primary) => selectMany(keys, primary),
    group: () => group,
    multi: () => multi,
    setMulti: (on) => setMulti(on),
    copy: () => copySelection(),
    remove: () => removeSelection(),
    shortcutOf: (what) => shortcutText(what),
    phone: () => phone(),
    setPose: (k, pose) => {
      const from = model.pose(k);
      if (!from) return;
      if (undo.push(poseChange(k, from, pose))) applyPose(k, pose);
    },
    reorder: (k, to) => (group.length > 1 && typeof to === 'string' ? reorderGroup(to) : reorder(k, to)),
    // Every picked key (edit-ops multi-select): the ask box then says "the 4 you picked".
    selectedKeys: () => (group.length > 1 ? group.slice() : selected ? [selected] : []),
    files: libraryTool ? (k) => {
      if (!filesCache.has(k)) filesCache.set(k, filesOfObject(k, ctx));
      return filesCache.get(k)!;
    } : undefined,
    openFile: (path) => openAsset(path, ctx),
    rules: (k) => ruleWords(k),
    unsaved: (k) => unsavedKeys.has(k),
    aiMark: (k) => aiMarks.get(k) ?? null,
    // Dragging a number's label: live moves go straight to the game (no undo
    // step), the end of the drag is one undo step, like a handle drag.
    scrub: (k, pose, end, from) => {
      if (!end) {
        model.moved(k, pose);
        send({ type: 'studio:placement/pose', key: k, pose });
        placementPanel.updateNumbers();
        return;
      }
      if (!undo.push(poseChange(k, from, pose))) model.moved(k, from);
      applyPose(k, pose);
    },
    ask: (keys, text) => askAi({ kind: 'ask', text, objects: requestObjects(keys) }),
    askName: (keys) => askAi({ kind: 'name', text: '', objects: requestObjects(keys) }),
    shortcut: (op) => {
      // ⌘ on Apple keyboards, Ctrl elsewhere (both work on every system).
      const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      const key = op === 'toFront' || op === 'forward' ? ']' : '[';
      const shift = op === 'toFront' || op === 'toBack';
      return mac ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
    },
  });

  /**
   * Change the draw order of one object (2D layers): one setPose with a new
   * z, recorded as ONE undo step like any other change. The bridge answers
   * with the whole list (the siblings' z shift too).
   */
  function reorder(key: string, to: LayerOp | number): boolean {
    const it = items.find((i) => i.key === key);
    const from = model.pose(key);
    if (!hasLayer(it) || it.movable === false || !from || from.z === undefined) return false;
    const z = typeof to === 'number' ? dropTarget(items, key, to) : layerTarget(items, key, to);
    if (z === null) return false;
    const next = { ...structuredClone(from), z };
    if (undo.push(poseChange(key, from, next))) applyPose(key, next);
    return true;
  }

  /** Layer buttons / shortcuts with several selected: the whole selection moves as one block (one undo step). */
  function reorderGroup(op: LayerOp): boolean {
    const moves = groupLayerMoves(items, group, op);
    if (!moves.length) return false;
    const changes: Change[] = [];
    // Each move's "from" is the z right before it (the simulation's order), so undo replays them backwards.
    const sim = items.map((i) => ({ ...i, pose: { ...i.pose } }));
    for (const m of moves) {
      const from = model.pose(m.key);
      if (!from) continue;
      const it = sim.find((i) => i.key === m.key)!;
      const z0 = it.pose.z!;
      // Shift the simulated siblings the way the adapter will.
      for (const o of sim) {
        if (o.layer !== it.layer || o === it || o.pose.z === undefined) continue;
        if (z0 < m.z && o.pose.z > z0 && o.pose.z <= m.z) o.pose.z--;
        else if (z0 > m.z && o.pose.z >= m.z && o.pose.z < z0) o.pose.z++;
      }
      it.pose.z = m.z;
      changes.push({ kind: 'pose', key: m.key, from: { ...structuredClone(from), z: z0 }, to: { ...structuredClone(from), z: m.z } });
    }
    if (!undo.push({ changes })) return false;
    for (const c of changes) if (c.kind === 'pose') applyPose(c.key, c.to);
    return true;
  }

  caption.insertBefore(placementPanel.askNoteEl, playNote);
  // The "no name" row now lives at the top of the list (placement-panel.ts); the slot stays for .studio/ui/ looks.
  // The card grows when its file row arrives: what it covers is sent again.
  new ResizeObserver(() => sendInset()).observe(placementPanel.cardEl);
  // The card: over the game's top right corner on PC, above the ask bar on a phone.
  const placeCard = () => {
    const want = phone() ? cardSlot : inspector;
    if (placementPanel.cardEl.parentElement !== want) want.append(placementPanel.cardEl);
  };

  // ----- the ⌘K list (palette.ts) -----
  const askInput = placementPanel.askEl.querySelector('input') as HTMLInputElement;
  const palette = createPalette({
    t,
    input: askInput,
    rows: () => paletteRows(),
    ask: () => (placementPanel.askEl as HTMLFormElement).requestSubmit(),
    changed: (on, typed) => {
      // Suggestions while typing leave the game in view (only ⌘K dims it).
      scrim.hidden = !on || !!typed;
      app.dataset.palette = on ? (typed ? 'suggest' : 'open') : 'closed';
    },
  });
  (dock.querySelector('.palette-slot') as HTMLElement).append(palette.el);

  /** Every row the ⌘K list can show right now. */
  function paletteRows(): PaletteRow[] {
    const rows: PaletteRow[] = [];
    const keys = group.length > 1 ? group.slice() : selected ? [selected] : [];
    const first = items.find((i) => i.key === keys[0]);
    const about = keys.length > 1 ? t('ops.manyShort', { n: keys.length }) : first && displayName(first, t);
    // Ask your AI: examples for what is picked, then the AI's own steps.
    const ask = (text: string) => () => void askAi({ kind: 'ask', text, objects: requestObjects(keys) }).then((ok) => ok && placementPanel.renderAsk());
    if (about) {
      for (const ex of ['pal.ex.row', 'pal.ex.glow']) {
        const text = t(ex, { name: about });
        rows.push({ id: ex, section: 'ask', label: text, icon: 'spark', run: ask(text) });
      }
    } else {
      const text = t('pal.ex.night');
      rows.push({ id: 'pal.ex.night', section: 'ask', label: text, icon: 'spark', run: ask(text) });
    }
    const unnamed = items.filter((i) => i.unstable).map((i) => i.key);
    if (unnamed.length) {
      rows.push({ id: 'name', section: 'ask', label: t('pal.ex.name'), icon: 'spark', hint: String(unnamed.length), data: { action: 'pal-name' },
        run: () => void askAi({ kind: 'name', text: '', objects: requestObjects(unnamed) }) });
    }
    if (uiPrefs.show.next) for (const id of AI_STEPS) rows.push({ id: `step-${id}`, section: 'ask', label: t(`next.${id}`), icon: 'spark', words: t(`next.${id}.desc`), data: { step: id }, run: () => openNext(id) });
    // Actions, with their keys.
    const mod = isMac() ? '⌘' : 'Ctrl+';
    const act = (id: string, label: string, ic: string, run: () => void, hint?: string, words?: string) =>
      rows.push({ id, section: 'actions', label, icon: ic, hint, words, data: { action: id }, run });
    if (dirtyCount() > 0) act('save', t('btn.save'), 'check', () => void handOff(), `${mod}S`, 'save 保存');
    act('play', playing ? t('btn.edit') : t('pal.play'), playing ? 'stop' : 'play', togglePlay, 'P', t('btn.play'));
    if (tool === 'library') act('scene', t('pal.scene'), 'cube', () => switchTool('placement'), undefined, t('tool.placement'));
    else act('assets', t('pal.assets'), 'grid', () => switchTool('library'), undefined, t('tool.library'));
    if (undo.canUndo) act('undo', t('btn.undo'), 'undo', doUndo, `${mod}Z`, describe(undo.peekUndo()));
    if (undo.canRedo) act('redo', t('btn.redo'), 'redo', doRedo, isMac() ? '⇧⌘Z' : 'Ctrl+Y', describe(undo.peekRedo()));
    if (keys.length && editing) {
      act('copy', t('ops.copy'), 'copy', () => copySelection(), shortcutText('copy'));
      act('remove', t('ops.remove'), 'trash', () => removeSelection(), shortcutText('remove'));
    }
    // The strip's tools (with something picked): the chosen one is marked with a check, its key on the right.
    if (keys.length && editing) {
      for (const k of (dim === '3d' ? ['move', 'lift', 'rotate', 'scale'] : ['move', 'rotate', 'scale']) as StripTool[]) {
        const key = Object.keys(STRIP_KEYS).find((c) => STRIP_KEYS[c] === k)!.toUpperCase();
        act(`tool-${k}`, t(`pal.tool.${k}`), stripTool === k ? 'check' : STRIP_ICONS[k], () => setStripTool(k), key, t('pal.tool.words'));
      }
    }
    if (uiPrefs.show.frame) act('frame', t('btn.frame'), 'frame', () => send({ type: 'studio:core/view', view: { action: 'frameAll' } }), 'F');
    // Back to the picture the editor opened on (3D: the game's own camera, polish pass) after looking around or
    // after the first pick's glide; one press, any time (speed pass, 2026-10-17). Always listed: 2D opens on "all".
    if (editing) act('home', t('pal.home'), 'opening', () => goHome(), isMac() ? '⇧F' : 'Shift+F', t('pal.home.words'));
    if (items.length) act('select-all', t('pal.selectAll'), 'hand', () => selectMany(items.map((i) => i.key), selected ?? items[0]!.key), shortcutText('all'));
    act('multi', multi ? t('ops.multiDone') : t('pal.multi'), 'hand', () => setMulti(!multi), undefined, t('ops.multi'));
    act('settings', t('pal.look'), 'look', () => openSettings(), undefined, `${t('btn.settings')} ${t('ui.theme')} ${t('ui.lang')}`);
    act('lang', t('pal.lang'), 'globe', () => setLang(lang === 'en' ? 'ja' : 'en'), undefined, 'language 言葉 English 日本語');
    if (uiPrefs.show.next) act('next', t('pal.ideas'), 'spark', () => openNext(), undefined, t('btn.next'));
    // With KUMODeck (optional): the same steps as the Ideas page.
    if (uiPrefs.show.next) for (const id of NEXT_STEPS) rows.push({ id: `step-${id}`, section: 'kumodeck', label: t(`next.${id}`), icon: 'arrowUp', words: t(`next.${id}.desc`), data: { step: id }, run: () => openNext(id) });
    // In the scene: found by name (only when typing).
    const seen = new Set<string>();
    for (const it of items) {
      const g = it.group || `key:${it.key}`;
      if (seen.has(g)) continue;
      seen.add(g);
      const members = items.filter((i) => (i.group || `key:${i.key}`) === g);
      rows.push({ id: `obj-${it.key}`, section: 'objects', label: displayName(it, t), thumb: safeImageSrc(thumbs.get(it.key)), hint: members.length > 1 ? t('pal.count', { n: members.length }) : undefined,
        words: members.map((m) => `${m.label} ${m.key}`).join(' '), data: { key: it.key },
        run: () => {
          switchTool('placement');
          if (members.length > 1) selectMany(members.map((m) => m.key), it.key);
          else selectObject(it.key, true);
        } });
    }
    return rows;
  }

  /**
   * The game's rules for one object (.studio/studio.json), in short words for
   * the card: "Grid 1", "45° steps", "Height fixed". Nothing without a config.
   */
  function ruleWords(key: string): Array<{ text: string; k: 'pos' | 'rot' | 'size' }> {
    const it = items.find((i) => i.key === key);
    if (!it || !gameConfig) return [];
    const r = rulesFor(it, gameConfig);
    const out: Array<{ text: string; k: 'pos' | 'rot' | 'size' }> = [];
    if (r.locked) return out; // the card already says "Locked by this game's settings"
    // `k` = which knob the rule binds (its colour on the pill; shell.css "Feel pass").
    if (r.grid !== undefined) out.push({ k: 'pos', text: t('rule.grid', { g: Array.isArray(r.grid) ? r.grid.join(' × ') : r.grid }) });
    if (typeof r.angle === 'number' && r.angle > 0 && it.rotatable) out.push({ k: 'rot', text: t('rule.angle', { a: r.angle }) });
    if (r.lockHeight && dim === '3d') out.push({ k: 'pos', text: t('rule.height') });
    if (!r.rotate) out.push({ k: 'rot', text: t('rule.noTurn') });
    if (!r.scale) out.push({ k: 'size', text: t('rule.noSize') });
    else if (r.scaleMin || r.scaleMax) out.push({ k: 'size', text: t('rule.size', { min: r.scaleMin ?? '–', max: r.scaleMax ?? '–' }) });
    return out;
  }
  let unsavedKeys = new Set<string>();
  // Files in Assets, for the left column's count (filled once the folder is listed).
  let libraryCount = 0;

  /** Undo / Redo tooltips name what they would change: "Undo: move house". */
  function describe(e: UndoEntry | null): string {
    if (!e) return '';
    const name = (k: string) => {
      const it = items.find((i) => i.key === k);
      return it ? displayName(it, t) : k;
    };
    const kinds = new Set(e.changes.map((c) => c.kind));
    const what = kinds.size > 1 ? 'edit' : kinds.has('add') ? 'copy' : kinds.has('remove') ? 'remove' : 'move';
    const keys = [...new Set(e.changes.map((c) => c.key))];
    return t(`undo.${what}`, { name: keys.length === 1 ? name(keys[0]!) : t('undo.n', { n: keys.length }) });
  }

  // ----- several at once, copy, delete (CONTRACT.md §1.8) -----
  function shortcutText(what: 'copy' | 'remove' | 'all'): string {
    if (what === 'remove') return isMac() ? '⌫' : 'Delete';
    const k = what === 'copy' ? 'D' : 'A';
    return isMac() ? `⌘${k}` : `Ctrl+${k}`;
  }
  /** What the actions work on: the selection (locked objects left out). */
  const targets = () => (group.length ? group : selected ? [selected] : [])
    .filter((k) => items.find((i) => i.key === k)?.movable !== false);

  function sendSelection(focus = false) {
    send({ type: 'studio:placement/select', key: selected, focus, keys: group.length > 1 ? group.slice() : undefined });
    if (tool === 'placement' && page === 'tool') placementPanel.render();
    else placementPanel.renderAsk();
    sendInset();
    emit('selected', selected);
  }
  function selectMany(keys: string[], primary: string | null) {
    const known = new Set(items.map((i) => i.key));
    group = [...new Set(keys)].filter((k) => known.has(k));
    selected = primary && group.includes(primary) ? primary : (group[group.length - 1] ?? null);
    if (group.length === 1) {
      selectObject(group[0]!, true);
      return;
    }
    sendSelection();
  }
  function toggleSelect(key: string) {
    const base = group.length ? group : selected ? [selected] : [];
    if (base.includes(key)) selectMany(base.filter((k) => k !== key), base.filter((k) => k !== key).pop() ?? null);
    else selectMany([...base, key], key);
  }
  function setMulti(on: boolean) {
    multi = on;
    send({ type: 'studio:placement/multi', on });
    if (tool === 'placement' && page === 'tool') placementPanel.render();
  }

  /** Every key in use, so a new copy never takes one (deleted copies included: redo brings them back). */
  const takenKeys = () => new Set([...items.map((i) => i.key), ...model.copiesEver()]);

  function copySelection() {
    const keys = targets();
    if (!keys.length || !editing) return;
    const taken = takenKeys();
    const reqs = keys.map((from) => {
      const it = items.find((i) => i.key === from);
      const key = copyKey(from, taken, it?.kinds?.[0]);
      taken.add(key);
      pendingCopies.add(key);
      return { key, from };
    });
    send({ type: 'studio:placement/copy', items: reqs });
  }

  function removeSelection() {
    const keys = targets();
    if (!keys.length || !editing) return;
    for (const k of keys) model.remove(k);
    undo.push({ changes: keys.map((k) => ({ kind: 'remove', key: k })) });
    group = [];
    selected = null;
    send({ type: 'studio:placement/remove', keys });
    sendSelection();
    renderButtons();
  }

  /** Apply one undo entry backwards (undo) or forwards (redo). */
  function applyEntry(e: UndoEntry, dir: 'undo' | 'redo') {
    const list = dir === 'undo' ? e.changes.slice().reverse() : e.changes;
    const copies: Array<{ key: string; from: string; pose: Pose }> = [];
    const removes: string[] = [];
    const restores: string[] = [];
    const flush = () => {
      if (copies.length) send({ type: 'studio:placement/copy', items: copies.splice(0) });
      if (removes.length) send({ type: 'studio:placement/remove', keys: removes.splice(0) });
      if (restores.length) send({ type: 'studio:placement/restore', keys: restores.splice(0) });
    };
    for (const c of list) {
      if (c.kind === 'pose') {
        flush();
        applyPose(c.key, dir === 'undo' ? c.from : c.to);
      } else if ((c.kind === 'add') === (dir === 'redo')) {
        // redo of a copy, undo of a deletion: the object comes back
        if (c.kind === 'add') {
          model.addCopy(c.key, c.from, c.pose);
          copies.push({ key: c.key, from: c.from, pose: c.pose });
        } else {
          model.unremove(c.key);
          restores.push(c.key);
        }
      } else {
        // undo of a copy, redo of a deletion: the object goes away
        model.remove(c.key);
        removes.push(c.key);
      }
    }
    flush();
    // What came back is selected; what went away is not.
    const gone = new Set(list.filter((c) => (c.kind === 'add') !== (dir === 'redo') && c.kind !== 'pose').map((c) => c.key));
    if (group.some((k) => gone.has(k)) || (selected && gone.has(selected))) {
      group = group.filter((k) => !gone.has(k));
      selected = group.length ? group[group.length - 1]! : null;
      sendSelection();
    }
  }

  const ctx: ShellContext = {
    host,
    get lang() {
      return lang;
    },
    t,
    send: (m) => send(m),
    on(type, cb) {
      const set = listeners.get(type) || new Set();
      set.add(cb as (m: BridgeToShell) => void);
      listeners.set(type, set);
      return () => set.delete(cb as (m: BridgeToShell) => void);
    },
    items: () => items,
    selectObject: (k) => {
      switchTool('placement');
      selectObject(k, true);
    },
    // Assets → Scene: "In the scene: 2" selects every object that uses the file.
    selectObjects: (keys) => {
      switchTool('placement');
      const known = keys.filter((k) => items.some((i) => i.key === k));
      if (known.length === 1) selectObject(known[0]!, true);
      else if (known.length) selectMany(known, known[0]!);
    },
    switchTool: (id) => switchTool(id),
    changed: () => renderButtons(),
    phone,
    ask: (r) => askAi(r),
  };
  const tools: Partial<Record<ToolId, ShellTool>> = {};
  if (libraryTool) tools.library = libraryTool;
  let mounted: ShellTool | null = null;

  /**
   * The left column always lists the scene (or shows the Look / Ideas page);
   * Assets is a page over the game (PC) or a sheet (phone), mounted while the
   * Assets row is the chosen one.
   */
  function mountTool() {
    if (tool !== 'library' || page !== 'tool' && !phone()) {
      if (mounted && tool !== 'library') {
        mounted.unmount();
        mounted = null;
      }
    }
    if (tool === 'library' && !mounted) {
      const tl = tools.library;
      assetsPage.replaceChildren();
      if (!tl) {
        assetsPage.append(h('p', { class: 'muted', text: t('library.missing') }));
        return;
      }
      const mount = h('div', { class: 'tool-mount' });
      assetsPage.append(mount);
      tl.mount(mount, ctx);
      mounted = tl;
    }
  }

  function switchTool(id: ToolId) {
    page = 'tool';
    if (id === tool && (mounted || id === 'placement')) {
      renderAll();
      return;
    }
    tool = id;
    // Phone: Assets is its own sheet; the scene list closes behind it.
    if (phone()) sheetOpen = id === 'placement' ? sheetOpen : false;
    renderAll(true);
  }

  function openSettings() {
    page = 'settings';
    if (phone()) sheetOpen = true;
    renderAll();
    panel.scrollTop = 0;
  }

  /** Apply UI preferences to the page (and the handle size to the game). */
  function applyUi() {
    const root = document.documentElement;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    root.dataset.theme = effectiveTheme(uiPrefs, !!mq?.matches);
    root.style.setProperty('--studio-font', `${uiPrefs.fontSize}px`);
    root.style.setProperty('--studio-panel-w', `${uiPrefs.width}px`);
    root.style.setProperty('--studio-panel-h', `${uiPrefs.height}dvh`);
    app.dataset.panel = uiPrefs.panel;
    app.dataset.thumbs = uiPrefs.show.thumbs ? 'on' : 'off';
    app.dataset.numbers = uiPrefs.show.numbers ? 'on' : 'off';
    app.dataset.help = uiPrefs.show.help ? 'on' : 'off';
    (header.querySelector('.adapter') as HTMLElement).hidden = !uiPrefs.show.adapter;
    for (const b of playBtns) b.hidden = !uiPrefs.show.play;
    langBtn.hidden = !uiPrefs.show.lang;
    // show.frame / show.next now decide whether ⌘K lists Show all / the Ideas (paletteRows).
    insetSent = '';
    sendInset();
  }

  /** A preference changed: apply now, save to .studio/ui.json shortly after (sliders send many). */
  function changeUi(next: UiPrefs) {
    uiPrefs = normalizeUi(next);
    applyUi();
    renderToolsRow();
    if (page === 'settings' && (document.activeElement as HTMLInputElement | null)?.type !== 'range') renderAll();
    clearTimeout(uiSaveTimer);
    if (safeUi) return;
    uiSaveTimer = window.setTimeout(() => {
      void host.saveUi(uiPrefs).then((r) => {
        if (!r.ok) showToast(t('save.fail', { error: r.error || 'ui.json' }));
      });
    }, 300);
  }

  /** Buttons for the game's own tools (.studio/tools.js). */
  function renderToolsRow() {
    toolsRow.replaceChildren();
    toolsRow.hidden = (!gameTools.length || !uiPrefs.show.tools) && !customTools.length;
    if (toolsRow.hidden) return;
    if (!gameTools.length || !uiPrefs.show.tools) {
      toolsRow.append(...customTools);
      return;
    }
    toolsRow.append(h('span', { class: 'label', text: t('tools.title') }));
    for (const g of gameTools) {
      const n = toolDirty.get(g.id) || 0;
      toolsRow.append(h('button', {
        type: 'button', 'aria-pressed': String(activeTool === g.id), dataset: { gameTool: g.id },
        text: `${g.icon ? g.icon + ' ' : ''}${g.label}${n ? ` (${n})` : ''}`,
        onclick: () => send({ type: 'studio:tool/activate', id: activeTool === g.id ? null : g.id }),
      }));
    }
    toolsRow.append(...customTools);
    const on = gameTools.find((g) => g.id === activeTool);
    if (on?.hint) toolsRow.append(h('span', { class: 'tool-hint', text: on.hint }));
  }

  function openNext(step: StepId | null = null) {
    page = 'next';
    nextOpen = step;
    if (phone()) sheetOpen = true;
    renderAll();
    // The sheet keeps the list's scroll; start the page at its title and
    // "← Close" (on the phone they were scrolled out of sight).
    panel.scrollTop = 0;
  }

  // ----- hand-offs to the AI (CONTRACT.md §3.4) -----
  /** Objects for a request: key, name, and the pose the editor shows now (may be unsaved). */
  function requestObjects(keys: string[]) {
    return keys.map((k) => {
      const it = items.find((i) => i.key === k);
      return { key: k, label: it?.label, pose: model.pose(k), unstable: it?.unstable || undefined };
    });
  }

  /**
   * Where the edit camera stands and looks, for an "ask" (contract StudioRequestInput.view): the AI puts new things
   * in sight. 3D only (the three adapter's orbit state, camera.js: eye = target + distance along yaw/pitch); a 2D
   * view is the whole screen already, and an unknown state sends nothing.
   */
  function askView(): StudioRequestInput['view'] {
    if (dim !== '3d') return undefined;
    let st: { target?: unknown; distance?: unknown; yaw?: unknown; pitch?: unknown } | null = null;
    try {
      st = JSON.parse(store.get(VIEW_KEY) || 'null');
    } catch {
      return undefined;
    }
    const tg = st?.target;
    const { distance: d, yaw, pitch } = st || {};
    if (!Array.isArray(tg) || tg.length !== 3 || !tg.every(Number.isFinite) || typeof d !== 'number' || typeof yaw !== 'number' || typeof pitch !== 'number') return undefined;
    const [x, y, z] = tg as [number, number, number];
    const cp = Math.cos(pitch);
    return { eye: [x + d * cp * Math.sin(yaw), y + d * Math.sin(pitch), z + d * cp * Math.cos(yaw)], target: [x, y, z] };
  }

  /** Hand a request to the AI through the host. Never assumes local files: the host decides where it goes. */
  async function askAi(r: Omit<StudioRequestInput, 'lang'>): Promise<boolean> {
    const view = r.kind === 'ask' ? askView() : undefined;
    const res = await host.request({ ...r, lang, dim, unsaved: dirtyCount() || undefined, ...(view ? { view } : {}) }).catch((e) => ({ ok: false, error: (e as Error).message, id: undefined, at: undefined } as { ok: boolean; error?: string; id?: string; at?: number; watching?: boolean; seen?: string; undo?: boolean }));
    if (!res.ok) {
      showToast(t('ask.fail'));
      return false;
    }
    handedOver(r.kind, res.id, res.at, r.kind === 'ask' ? r.text : undefined, res);
    return true;
  }

  function handedOver(kind: NonNullable<typeof pending>['kind'], id?: string, at?: number, text?: string, info?: { watching?: boolean; seen?: string; undo?: boolean }) {
    // A new request: the marks of the AI's previous change are history now.
    aiReloadFor = null;
    aiBase = null;
    aiAfter = null;
    lastChange = null;
    // The host's answer says at once whether an AI watches (no 20 s of not knowing).
    if (info?.watching !== undefined) aiWatching = info.watching;
    if (info?.seen) aiSeen = info.seen;
    if (id && info?.undo && !changeFrom) changeFrom = id;
    if (aiMarks.size) {
      aiMarks = new Map();
      placementPanel.markRows();
      aiMarksMsg = { keys: [] };
      send({ type: 'studio:placement/marks', keys: [] });
    }
    // Offline host (browser-only demo): nobody picks the request up, so the line
    // keeps the person's whole request (cut by CSS, full text on hover) instead of 40 characters.
    pending = { kind, id, at: at ?? Date.now(), sent: Date.now(), text: text ? (!host.offline && text.length > 40 ? text.slice(0, 39) + '…' : text) : undefined };
    renderAiLine();
    pollSoon();
  }

  /** Where the AI is, as ai-flow.ts reads it. */
  function currentPhase(): AiPhase {
    return aiPhase({ now: Date.now(), offline: !!host.offline, pending, status: aiStatus, statusTime: aiTime, openedAt,
      watching: aiWatching, seen: aiSeen, reloading: !!swapping, after: aiAfter });
  }

  function renderAiLine() {
    aiLine.replaceChildren();
    aiLine.className = 'ai-line';
    const ph = currentPhase();
    const busy = aiBusy(ph);
    // The violet light round the input (shell.css) follows this, and so does the AI dot.
    app.dataset.ai = busy ? 'busy' : ph;
    aiLine.classList.add(ph);
    const covered = pending ? statusCovers({ id: pending.id ?? '', at: pending.at }, aiStatus, aiTime) : false;
    const two = (head: string, sub?: string) => {
      const say = h('span', { class: 'ai-text two' }, h('span', { class: 'ai-head', text: head }));
      if (sub) say.append(h('span', { class: 'ai-sub', text: sub }));
      aiLine.append(say);
    };
    // What was asked, small and grey under what is happening (verganti review): one glance says what and why.
    const asked = pending?.text ? t('ai.asked', { text: pending.text }).replace(/\s*→\s*$/, '') : '';
    const note = aiStatus?.note;
    const link = (action: string, ic: string, label: string, run: () => void, title?: string) =>
      aiLine.append(h('button', { type: 'button', class: 'link', dataset: { action }, title: title || label, disabled: undoBusy, onclick: run }, icon(ic), h('span', { text: label })));
    if (ph === 'waiting' && pending) {
      // Hosts that cannot tell whether an AI watches (and the offline demo): the old line.
      aiLine.append(h('span', { class: 'ai-text', text: pending.text ? t('ai.waitingAsk', { text: pending.text }) : pending.kind === 'saved' ? t('ai.waitingSaved') : t('ai.waiting', { what: t(`ai.what.${pending.kind}`) }) }));
    } else if (ph === 'nudge') {
      aiLine.append(h('span', { class: 'ai-text', text: t('ai.nudge') }));
    } else if (ph === 'sent' || ph === 'seen') {
      two(t(ph === 'seen' ? 'ai.seen' : 'ai.sent'), asked || (pending?.kind === 'saved' ? t('ai.savedSub') : ''));
    } else if (ph === 'away') {
      // Nobody watches: say so at once, the one thing to do, and that nothing is lost (play test: 21 s, then a dead end).
      two(t('ai.away'), t('ai.awaySub'));
    } else if (ph === 'received' || ph === 'working') {
      two(note ? `${note.replace(/[.…]+$/, '')}…` : t(`ai.${ph}`), covered ? asked : '');
    } else if (ph === 'asking') {
      // The AI waits for an answer in its own window (dogfood U2): say so, and its question (two lines at most).
      two(t('ai.asking'), note || '');
    } else if (ph === 'updating') {
      two(note || t('ai.updating'), t('ai.updating'));
    } else if (ph === 'done' || ph === 'failed') {
      const s = aiStatus!;
      const n = typeof s.changed === 'number' ? s.changed : 0;
      const count = ph === 'failed' ? t('ai.failed') : n === 1 ? t('ai.done1') : n > 1 ? t('ai.doneN', { n }) : t('ai.done');
      // The AI's one-line reply first (its note), then what you asked and the count.
      two(s.note || count, [covered ? asked : '', s.note ? count : ''].filter(Boolean).join(' · '));
      const aiReloaded = aiReloadFor !== null && aiStatus?.at === aiReloadFor;
      if (ph === 'done' && !playing && aiReloaded) {
        const keys = [...aiMarks.keys()].filter((k) => items.some((i) => i.key === k));
        // "Show the 3 it changed": selects them (they already glow violet in the game).
        if (keys.length) {
          aiLine.append(h('button', { type: 'button', class: 'link icon-only', dataset: { action: 'ai-show' }, title: t('ai.show', { n: keys.length }), 'aria-label': t('ai.show', { n: keys.length }),
            onclick: () => {
              switchTool('placement');
              if (keys.length === 1) selectObject(keys[0]!, true);
              else selectMany(keys, keys[0]!);
            } }, icon('eye')));
        } else if (itemsSeen && !lastChange) aiLine.append(h('span', { class: 'ai-same', text: aiGone ? t('ai.gone', { n: aiGone }) : t('ai.samePlaces') }));
      }
      if (lastChange && host.undoAi && !playing) link('ai-undo', 'undo', t('ai.undo'), () => void undoAiChange(false));
      // A host that cannot tell when the game's files changed: the old button.
      else if (ph === 'done' && !playing && code === undefined && !aiReloaded) {
        link('ai-reload', 'undo', t('ai.reload'), () => {
          aiReloadFor = aiStatus?.at ?? null;
          void softReload('ai');
        });
      }
    } else if (ph === 'undone' || ph === 'redone') {
      two(t(ph === 'undone' ? 'ai.undone' : 'ai.redone'), ph === 'undone' ? t('ai.undoneSub') : '');
      if (lastChange && host.undoAi && !playing) {
        if (ph === 'undone' && lastChange.redo) link('ai-redo', 'redo', t('ai.redo'), () => void undoAiChange(true));
        else if (ph === 'redone') link('ai-undo', 'undo', t('ai.undo'), () => void undoAiChange(false));
      }
    }
    aiLine.hidden = !aiLine.childNodes.length;
    renderPeer();
    // The whole line on hover (it is cut to one line).
    aiLine.title = aiLine.hidden ? '' : aiLine.textContent || '';
  }

  /**
   * "Undo AI change" / "Redo": the host puts the game's files back (one
   * press, at once, whether or not the AI still watches) and tells the AI.
   * Then the game reloads behind the old picture like after any change.
   */
  async function undoAiChange(redo: boolean) {
    const to = redo ? lastChange?.redo : lastChange?.from;
    if (!host.undoAi || !lastChange || !to || undoBusy) return;
    undoBusy = true;
    renderAiLine();
    const res = await host.undoAi(to, { redo }).catch((e) => ({ ok: false, error: (e as Error).message, redo: null }));
    undoBusy = false;
    if (!res.ok) {
      showToast(t('ai.undoFail'));
      renderAiLine();
      return;
    }
    if (!redo) lastChange.redo = res.redo ?? null;
    aiAfter = redo ? 'redone' : 'undone';
    // The files' new signature first, so the reload below does not trigger a second one.
    const st = await host.status().catch(() => null);
    if (st?.code) {
      code = st.code;
      codeSince = Date.now();
    }
    // Redo shows the AI's change glowing again; Undo clears the glow.
    void softReload(redo ? 'redo' : 'undo');
  }

  // Status polling: often while the AI has a request or is working (the line
  // and the light follow within a second), every 3 s otherwise (the game's
  // files are compared too: a change made in the person's own code editor
  // also shows by itself); paused while the tab is hidden. Plain polling
  // works the same against the local server and a hosted one.
  let pollTimer = 0;
  async function pollStatus() {
    clearTimeout(pollTimer);
    if (document.visibilityState !== 'hidden') {
      const r = await host.status().catch(() => null);
      if (r) {
        aiStatus = r.status;
        aiTime = r.time;
        if (r.watching !== undefined) aiWatching = r.watching;
        if (r.seen) aiSeen = r.seen;
        if (r.code !== code) {
          code = r.code;
          codeSince = Date.now();
        }
        // The first answer after the game was opened is what the game in the frame was built from.
        if (loadedCode === undefined) loadedCode = code;
      }
      const go = reloadDecision({ code, loadedCode, stableMs: Date.now() - codeSince, phase: currentPhase(), playing, reloading: !!swapping });
      if (go === 'now') {
        if (aiStatus?.state === 'done' || aiStatus?.state === 'failed') aiReloadFor = aiStatus.at ?? null;
        void softReload('ai');
      }
      renderAiLine();
    }
    const ph = currentPhase();
    const wait = aiBusy(ph) ? 700 : ph === 'away' || ph === 'waiting' || ph === 'nudge' || ph === 'asking' ? 1500 : 3000;
    pollTimer = window.setTimeout(() => void pollStatus(), wait);
  }
  function pollSoon() {
    clearTimeout(pollTimer);
    // Soon: a watching AI's "got it" shows within a second of Enter.
    pollTimer = window.setTimeout(() => void pollStatus(), 400);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pollStatus();
  });

  // ----- bridge messaging -----
  function send(m: ShellToBridge) {
    if (!bridgeAlive || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(m, gameOrigin);
  }

  function applyPose(key: string, pose: Pose) {
    model.moved(key, pose);
    send({ type: 'studio:placement/pose', key, pose });
    placementPanel.updateNumbers();
    renderButtons();
  }

  function selectObject(key: string | null, focus = false) {
    selected = key;
    group = key ? [key] : [];
    // The card first, then the selection: "bring into view" must already know what the card covers.
    if (tool === 'placement' && page === 'tool') placementPanel.render();
    else placementPanel.renderAsk();
    sendInset();
    send({ type: 'studio:placement/select', key, focus });
  }

  // Thumbnails asked for (answered or not), so a scroll never asks twice. Cleared with `thumbs` on reload.
  const thumbsAsked = new Set<string>();
  /**
   * The list's pictures. Everything is asked once, in the background (one per
   * kind first: that is what a closed list shows), and then — on every render
   * and scroll of the list — the rows in view are asked for again, which the
   * bridge puts at the FRONT of its queue (tool-modes pass, 10/16). Before:
   * the first 200 in list order only, so with hundreds of objects the rows
   * further down never got a picture (ive-finish.md §7).
   */
  function requestThumbs() {
    const seen = new Set<string>();
    const first: string[] = [];
    const rest: string[] = [];
    for (const it of items) {
      if (thumbs.has(it.key) || thumbsAsked.has(it.key)) continue;
      const g = it.group || it.key;
      (seen.has(g) ? rest : first).push(it.key);
      seen.add(g);
    }
    const keys = [...first, ...rest];
    for (const k of keys) thumbsAsked.add(k);
    // In parts of 500 (the bridge's cap per message), the first part last so it ends up first in the queue.
    for (let i = Math.floor((keys.length - 1) / 500) * 500; i >= 0 && keys.length; i -= 500) send({ type: 'studio:placement/thumbs', keys: keys.slice(i, i + 500), size: 96 });
    requestVisibleThumbs();
  }
  const visibleShown = new Set<string>();
  function requestVisibleThumbs() {
    if (!uiPrefs.show.thumbs || playing) return;
    const box = (placementPanel.el.closest('.panel') as HTMLElement | null)?.getBoundingClientRect();
    if (!box || !box.height) return;
    const keys: string[] = [];
    for (const row of placementPanel.el.querySelectorAll<HTMLElement>('.obj[data-key]')) {
      const r = row.getBoundingClientRect();
      if (!r.height || r.bottom < box.top || r.top > box.bottom) continue;
      const k = row.dataset.key!;
      // Not drawn yet and not already moved to the front for this view.
      if (!thumbs.has(k) && !visibleShown.has(k)) keys.push(k);
    }
    if (!keys.length) return;
    for (const k of keys) visibleShown.add(k);
    send({ type: 'studio:placement/thumbs', keys, size: 96 });
  }
  // Scrolling the list (the PC column or the phone sheet) asks for the rows that came into view, once a frame.
  let thumbFrame = 0;
  let thumbsScrolled = false;
  const thumbsSoon = (scrolled: boolean) => {
    thumbsScrolled ||= scrolled;
    if (thumbFrame) return;
    thumbFrame = requestAnimationFrame(() => {
      thumbFrame = 0;
      // After a scroll, a row scrolled past and back is moved to the front again if it still has no picture.
      if (thumbsScrolled) visibleShown.clear();
      thumbsScrolled = false;
      requestVisibleThumbs();
    });
  };
  document.addEventListener('scroll', (e) => {
    if (e.target instanceof Element && e.target.contains(placementPanel.el)) thumbsSoon(true);
  }, { capture: true, passive: true });
  // Opening a kind (▸) shows its rows without a scroll; so does a pick that re-renders the list.
  placementPanel.el.addEventListener('click', () => thumbsSoon(false));

  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== iframe.contentWindow || ev.origin !== gameOrigin) return;
    if (!isStudioMessage(ev.data)) return;
    const m = ev.data as BridgeToShell;
    onBridge(m);
    for (const cb of listeners.get(m.type) || []) {
      try {
        cb(m);
      } catch (e) {
        console.error('[studio] tool listener failed', e);
      }
    }
  });

  // Events for .studio/ui/shell.js (studioShell.on).
  const shellEvents = new Map<string, Set<(d: unknown) => void>>();
  const emit = (ev: string, detail: unknown) => {
    for (const cb of shellEvents.get(ev) || []) {
      try {
        cb(detail);
      } catch (e) {
        console.warn('[studio] .studio/ui/shell.js listener failed:', e);
      }
    }
  };

  function onBridge(m: BridgeToShell) {
    if (m.type === 'studio:placement/selected') emit('selected', m.key);
    else if (m.type === 'studio:placement/items') emit('items', m.items);
    else if (m.type === 'studio:placement/moved' && m.end) emit('moved', { key: m.key, pose: m.pose });
    switch (m.type) {
      case 'studio:core/hello':
        bridgeAlive = true;
        if (phase === 'loading') phase = 'waiting';
        renderStatus();
        break;
      case 'studio:core/wait':
        if (m.reason === 'no-adapter' && check && !check.ok) phase = 'no-adapter';
        renderStatus();
        break;
      case 'studio:core/check':
        check = m.result;
        if (!m.result.checks.find((c) => c.id === 'adapter-found')?.ok) phase = 'no-adapter';
        // Report both outcomes: "check ok" tells the agent its adapter works.
        void host.reportCheck(m.result);
        // A change that broke the game: show what is there now instead of the old picture.
        if (swapping && !m.result.ok) finishSwap();
        renderStatus();
        break;
      case 'studio:core/ready':
        dim = m.dim;
        adapterInfo = `${m.kind}${m.version ? ' ' + m.version : ''}`;
        editing = m.editing;
        phase = 'ready';
        if (!m.editing && !playing) {
          send({ type: 'studio:core/lang', lang });
          if (multi) send({ type: 'studio:placement/multi', on: true });
          send({ type: 'studio:core/ui', handlePx: handlePx(), theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' });
          send({ type: 'studio:core/config', config: gameConfig });
          const vs = store.get(VIEW_KEY);
          let viewState: unknown;
          try {
            viewState = vs ? JSON.parse(vs) : undefined;
          } catch {
            viewState = undefined;
          }
          send({ type: 'studio:core/edit', on: true, viewState });
          insetSent = '';
          sendInset();
        }
        renderAll();
        break;
      case 'studio:tool/list':
        gameTools = m.tools;
        for (const g of gameTools) {
          void host.loadData(g.id).then((data) => send({ type: 'studio:tool/restore', id: g.id, data }));
        }
        renderToolsRow();
        break;
      case 'studio:tool/state':
        toolDirty.set(m.id, m.dirty);
        if (m.active) activeTool = m.id;
        else if (activeTool === m.id) activeTool = null;
        renderToolsRow();
        renderButtons();
        break;
      case 'studio:tool/data':
        toolDataWaiter?.(m.items);
        toolDataWaiter = null;
        break;
      case 'studio:core/view-state':
        store.set(VIEW_KEY, JSON.stringify(m.state));
        break;
      case 'studio:core/key':
        shortcut({ key: m.key, ctrl: m.ctrl, meta: m.meta, shift: m.shift, fromGame: true });
        break;
      case 'studio:core/error':
        // Say what to do, not only what broke (polish pass 2026-10-16). Long enough to read.
        showToast(t('status.adapterError', { msg: m.message }), 8000);
        break;
      case 'studio:core/game-error':
        if (!gameError) gameError = { message: m.message, where: m.where };
        if (playing) showToast(t('status.gameErrorToast', { msg: m.message }), 8000);
        renderStatus();
        break;
      case 'studio:placement/items': {
        // First list after "Reload the game" (AI done): what moved or is new
        // compared with what was on screen before the reload. Raw adapter
        // poses (the game's code as the AI left it), before the model's.
        if (aiBefore) {
          const before = aiBefore;
          aiBefore = null;
          aiMarks = new Map();
          const now0 = new Set(m.items.map((i) => i.key));
          // An object without a name gets a new path key when the AI adds things before it in the
          // tree (path:8 → path:11): same place as one that is gone = the same object, not a new one.
          const goneAt = [...before.entries()].filter(([k]) => !now0.has(k)).map(([, p]) => p);
          let renamed = 0;
          for (const it of m.items) {
            const was = before.get(it.key);
            if (!was && it.unstable && goneAt.some((p) => samePose({ ...it.pose, z: undefined }, { ...p, z: undefined }, dim))) {
              renamed++;
              continue;
            }
            if (!was) aiMarks.set(it.key, 'added');
            else if (!samePose({ ...it.pose, z: undefined }, { ...was, z: undefined }, dim)) aiMarks.set(it.key, 'moved');
          }
          const now = new Set(m.items.map((i) => i.key));
          aiGone = Math.max(0, [...before.keys()].filter((k) => !now.has(k)).length - renamed);
          // The same marks in the game: violet outlines and one tag ("AI added 3"). Sent below, with the poses.
          const marks = [...aiMarks.entries()];
          const added = marks.filter(([, v]) => v === 'added').length;
          const label = !marks.length ? undefined : added === marks.length ? t('ai.tagAdded', { n: added }) : added === 0 ? t('ai.tagMoved', { n: marks.length }) : t('ai.tagChanged', { n: marks.length });
          aiMarksMsg = { keys: marks.map(([k]) => k), label };
          placementPanel.markRows();
          renderAiLine();
        }
        items = m.items;
        itemsSeen = true;
        if (aiMarksMsg.keys.length) send({ type: 'studio:placement/marks', ...aiMarksMsg });
        const apply = model.setItems(items, dim);
        // Continue from the last save: push saved poses the game does not show.
        if (!placementRestored || apply.length) {
          placementRestored = true;
          for (const a of apply) send({ type: 'studio:placement/pose', key: a.key, pose: a.pose });
        }
        // ... and the saved copies and deletions the AI has not put in the code yet.
        const fe = model.takeFileEdits();
        if (fe.copies.length) send({ type: 'studio:placement/copy', items: fe.copies });
        if (fe.removes.length) send({ type: 'studio:placement/remove', keys: fe.removes });
        if (selected && !items.some((i) => i.key === selected)) selected = null;
        group = group.filter((k) => items.some((i) => i.key === k));
        // A changed object's old picture is stale: ask again.
        for (const k of aiMarks.keys()) thumbs.delete(k);
        requestThumbs();
        renderAll();
        if (swapping) {
          // The selection the person had, in the new game (focus: false = the camera stays put).
          const ks = keepSel;
          keepSel = null;
          const g = (ks?.group || []).filter((k) => items.some((i) => i.key === k));
          if (g.length > 1) selectMany(g, ks?.selected && g.includes(ks.selected) ? ks.selected : g[0]!);
          else if (ks?.selected && items.some((i) => i.key === ks.selected)) send({ type: 'studio:placement/select', key: ks.selected, focus: false });
          // Two frames for the new game to draw with the kept poses and marks, then the old picture goes.
          requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(finishSwap, 120)));
        }
        break;
      }
      case 'studio:placement/selected':
        selected = m.key;
        group = m.keys && m.keys.length ? m.keys.slice() : m.key ? [m.key] : [];
        if (tool !== 'placement') switchTool('placement');
        else if (page === 'tool') placementPanel.render();
        else placementPanel.renderAsk();
        break;
      case 'studio:placement/moved':
        model.moved(m.key, m.pose);
        if (m.end && m.from) undo.push(poseChange(m.key, m.from, m.pose));
        // A tip forward / sideways adds the card's Tilt row: draw the card again when that changes.
        if (m.key === selected && m.end && !!m.pose.t !== !!m.from?.t && tool === 'placement' && page === 'tool') placementPanel.render();
        else if (m.key === selected) placementPanel.updateNumbers();
        renderButtons();
        break;
      case 'studio:placement/moved-group':
        for (const e of m.poses) model.moved(e.key, e.pose);
        if (m.end) {
          undo.push({ changes: m.poses.filter((e) => e.from).map((e) => ({ kind: 'pose', key: e.key, from: e.from!, to: e.pose })) });
          emit('moved', { keys: m.poses.map((e) => e.key) });
        }
        renderButtons();
        break;
      case 'studio:placement/added': {
        // New copies (from ⌘D / the Copy button): one undo step for all.
        // Copies the shell asked for again (redo, reopening) are already in the model.
        const fresh = m.items.filter((a) => pendingCopies.has(a.key));
        for (const a of m.items) {
          pendingCopies.delete(a.key);
          if (!model.isCopy(a.key)) model.addCopy(a.key, a.from, a.pose, a.key);
          else model.moved(a.key, a.pose);
        }
        for (const k of m.failed) pendingCopies.delete(k);
        if (fresh.length) undo.push({ changes: fresh.map((a) => ({ kind: 'add', key: a.key, from: a.from, pose: a.pose })) });
        if (m.items.some((a) => a.ghost) && !ghostTold) {
          ghostTold = true;
          showToast(t('copy.ghost'), 6000);
        }
        if (m.failed.length) showToast(t('copy.failed', { n: m.failed.length }));
        renderButtons();
        break;
      }
      case 'studio:placement/tool':
        stripTool = m.tool;
        break;
      case 'studio:placement/menu':
        stripMenu = !!m.open;
        break;
      case 'studio:placement/thumb':
        if (m.src) {
          // Cropped to the object first (thumb-fit.ts, W1-11): the lighthouse filled its tile instead of being an "i".
          // `thumbAsked` keeps the newest: a picture that arrives while an older one is still being cropped wins.
          const key = m.key, raw = m.src;
          thumbAsked.set(key, raw);
          void fitPicture(raw).then((src) => {
            if (thumbAsked.get(key) !== raw) return;
            thumbs.set(key, src);
            placementPanel.updateThumb(key);
          });
        }
        break;
    }
  }

  // ----- actions -----
  function doUndo() {
    const e = undo.undo();
    if (e) applyEntry(e, 'undo');
    renderButtons();
  }
  function doRedo() {
    const e = undo.redo();
    if (e) applyEntry(e, 'redo');
    renderButtons();
  }
  const toolsDirty = () => [...toolDirty.values()].reduce((a, b) => a + b, 0);
  const dirtyCount = () => model.dirty() + Object.values(tools).reduce((n, tl) => n + (tl ? tl.dirty() : 0), 0) + toolsDirty();

  // ----- the draft and Save (rebrand 2026-10-16, play test the same day) -----
  // Every change is written to placement.json (and library.json) as a DRAFT,
  // ~0.7 s after the last one, WITHOUT telling the AI (host.save with
  // handoff: false: no request record, no stdout line, so a watching AI is
  // not woken by every drag). The draft is never shown: it is there so that
  // closing the tab loses nothing. SAVE ("Save · 3" in the top bar, ⌘S)
  // writes the same file with a `saved` request (§3.4), exactly as Save
  // always did, and only then does "✓ Saved" appear. WHY two writes: an AI
  // that starts rewriting code halfway through an arrangement is worse than
  // one that waits for Save. WHY the draft is hidden: the first build showed
  // "Saved" for the draft and a "Hand to AI" button next to it; the play test
  // found "Hand to AI" meaningless and two kinds of saved confusing.
  // `dirtyCount()` = changes not saved yet; `written` = what the draft holds.
  const written: Record<string, string> = {};
  // True after a Save that went through, until the next change: "✓ Saved" shows.
  let savedOnce = false;
  let keepTimer = 0;
  let keeping: Promise<void> | null = null;
  const sigOf = (v: unknown) => JSON.stringify(v);
  const unwritten = () => {
    // The same test as keepNow(): nothing changed since the page opened = nothing to write.
    if ((model.dirty() > 0 || written.placement !== undefined) && sigOf(model.result()) !== written.placement) return true;
    return Object.values(tools).some((tl) => tl && tl.dirty() > 0 && sigOf(tl.result()) !== written[tl.id]);
  };
  function keepSoon() {
    clearTimeout(keepTimer);
    if (!unwritten()) return;
    keepTimer = window.setTimeout(() => void keepNow(), 700);
  }
  /** Write what changed, quietly. */
  async function keepNow(): Promise<void> {
    clearTimeout(keepTimer);
    if (keeping) await keeping;
    keeping = (async () => {
      const jobs: Array<Promise<string | null>> = [];
      const file = model.result();
      if ((model.dirty() > 0 || written.placement !== undefined) && sigOf(file) !== written.placement) {
        const v = validatePlacement(file);
        if (!v.ok) {
          showToast(t('save.fail', { error: v.errors.join('; ') }));
          return;
        }
        const sig = sigOf(file);
        jobs.push(host.save('placement', v.value, { handoff: false }).then((r) => {
          if (!r.ok) return r.error || 'placement';
          written.placement = sig;
          return null;
        }));
      }
      for (const tl of Object.values(tools)) {
        if (!tl || tl.dirty() === 0) continue;
        const res = tl.result();
        if (!res || sigOf(res) === written[tl.id]) continue;
        const v = validateLibrary(res);
        if (!v.ok) continue;
        const sig = sigOf(res);
        jobs.push(host.save(tl.id, v.value, { handoff: false }).then((r) => {
          if (!r.ok) return r.error || tl.id;
          written[tl.id] = sig;
          return null;
        }));
      }
      const errors = (await Promise.all(jobs)).filter(Boolean);
      if (errors.length) showToast(t('save.fail', { error: errors.join('; ') }), 3500);
    })();
    try {
      await keeping;
    } finally {
      keeping = null;
      renderButtons();
    }
  }
  // Leaving the page: what is left goes out at once.
  window.addEventListener('pagehide', () => {
    if (unwritten()) void keepNow();
  });

  /** Save (⌘S): the files with a `saved` request, handed to the AI. */
  async function handOff() {
    clearTimeout(keepTimer);
    if (keeping) await keeping;
    const jobs: Array<Promise<string | null>> = [];
    let placementHanded = false;
    if (model.dirty() > 0 || placementRestored) {
      const file = model.result();
      const v = validatePlacement(file);
      if (!v.ok) {
        showToast(t('save.fail', { error: v.errors.join('; ') }));
        return;
      }
      if (model.dirty() > 0) {
        const sig = sigOf(file);
        jobs.push(host.save('placement', v.value).then((r) => {
          if (!r.ok) return r.error || 'placement';
          model.markSaved();
          written.placement = sig;
          // The host keeps every hand-off as a request (§3.4): wait for the AI's pick-up like any ask.
          handedOver('saved', r.request, r.at, undefined, r);
          placementHanded = true;
          return null;
        }));
      }
    }
    for (const tl of Object.values(tools)) {
      if (!tl || tl.dirty() === 0) continue;
      const res = tl.result();
      if (!res) continue;
      const v = validateLibrary(res);
      if (!v.ok) {
        showToast(t('save.fail', { error: v.errors.join('; ') }));
        return;
      }
      const sig = sigOf(res);
      jobs.push(host.save(tl.id, v.value).then((r) => {
        if (!r.ok) return r.error || tl.id;
        written[tl.id] = sig;
        tl.saved();
        return null;
      }));
    }
    // Game tools' data (.studio/data/<id>.json): ask the game page for it.
    if (toolsDirty() > 0) {
      const got = await new Promise<Array<{ id: string; data: unknown }>>((resolve) => {
        toolDataWaiter = resolve;
        send({ type: 'studio:tool/collect' });
        window.setTimeout(() => resolve([]), 3000);
      });
      const done: string[] = [];
      for (const it of got) {
        jobs.push(host.saveData(it.id, it.data).then((r) => {
          if (!r.ok) return r.error || it.id;
          done.push(it.id);
          return null;
        }));
      }
      await Promise.all(jobs);
      if (done.length) send({ type: 'studio:tool/saved', ids: done });
    }
    const errors = (await Promise.all(jobs)).filter(Boolean);
    // A handed layout is followed by the AI line ("Handed to your AI…" →
    // after 20 s "say 'look'"); only a hand-off the AI line does not cover
    // (the Library, a game tool's data) gets the toast, in the same words.
    if (errors.length) showToast(t('save.fail', { error: errors.join('; ') }), 3500);
    else if (!placementHanded && jobs.length) showToast(t('save.ok', { file: 'placement.json' }), 6000);
    if (!errors.length && jobs.length) savedOnce = true;
    if (!errors.length) emit('saved', null);
    renderButtons();
  }

  function goHome() {
    send({ type: 'studio:core/view', view: { action: 'home' } });
  }

  let playing = false;
  // The first error the game's page threw since it was (re)loaded (studio:core/game-error), shown in the status line.
  let gameError: { message: string; where?: string } | null = null;
  // Play: the game as its code is now. Nothing to confirm (every change is
  // already kept); what was written waits first, so a game that reads
  // placement.json at start (studio-placement.js) gets the latest one.
  async function togglePlay() {
    if (!playing) await keepNow();
    if (swapping) finishSwap();
    playing = !playing;
    palette.close();
    loadGame();
  }

  /**
   * Reload the game without a flash (AI feel, 2026-10-16): the new game opens
   * in a second frame under the one on screen; the old frame (a still
   * picture: the editor pauses the game) stays on top until the new game has
   * listed its objects and drawn them with the kept poses, then fades out.
   * The camera (view state) and the selection carry over. `why`: 'ai' and
   * 'redo' compare what changed and mark it violet; 'undo' clears the marks.
   */
  async function softReload(why: 'ai' | 'undo' | 'redo') {
    if (swapping || playing) return;
    await keepNow();
    if (why === 'undo') {
      aiBefore = null;
      aiBase = null;
      setAiMarks(new Map());
    } else {
      aiBefore = why === 'ai' && aiBase ? aiBase : new Map(items.map((i) => [i.key, structuredClone(model.pose(i.key) || i.pose)]));
      aiBase = why === 'ai' && aiBusy(currentPhase()) ? aiBefore : null;
    }
    if (why === 'ai' && changeFrom) {
      lastChange = { from: changeFrom, redo: null };
      changeFrom = null;
    }
    keepSel = { selected, group: group.slice() };
    const old = iframe;
    const next = makeFrame();
    old.classList.add('leaving');
    old.parentElement?.insertBefore(next, old);
    iframe = next;
    swapping = old;
    // A game that never answers (broken by the change) still replaces the old picture.
    swapTimer = window.setTimeout(finishSwap, 10_000);
    loadGame(true);
    renderAiLine();
  }
  function finishSwap() {
    clearTimeout(swapTimer);
    const old = swapping;
    swapping = null;
    if (old) {
      old.classList.add('gone');
      window.setTimeout(() => old.remove(), 240);
    }
    renderAiLine();
  }
  function setAiMarks(marks: Map<string, 'moved' | 'added'>) {
    aiMarks = marks;
    placementPanel.markRows();
    const list = [...marks.entries()];
    const added = list.filter(([, v]) => v === 'added').length;
    const label = !list.length ? undefined : added === list.length ? t('ai.tagAdded', { n: added }) : added === 0 ? t('ai.tagMoved', { n: list.length }) : t('ai.tagChanged', { n: list.length });
    aiMarksMsg = { keys: list.map(([k]) => k), label };
    send({ type: 'studio:placement/marks', ...aiMarksMsg });
  }

  function loadGame(soft = false) {
    bridgeAlive = false;
    gameError = null;
    filesCache.clear();
    editing = false;
    // A soft reload keeps the list, the selection and the pictures on screen
    // until the new game answers (no flash of an empty list).
    if (!soft) {
      items = [];
      itemsSeen = false;
      selected = null;
      group = [];
      thumbs.clear();
    }
    check = null;
    thumbsAsked.clear();
    visibleShown.clear();
    placementRestored = false;
    // What the game in the frame is built from (the host's signature of the files).
    loadedCode = code;
    gameTools = [];
    activeTool = null;
    toolDirty.clear();
    renderToolsRow();
    if (!soft) phase = playing ? 'playing' : 'loading';
    const u = new URL(gameUrl, location.href);
    const [k, v] = LOCAL_PATHS.editFlag.split('=') as [string, string];
    if (playing) u.searchParams.delete(k);
    else u.searchParams.set(k, v);
    if (gameOrigin !== location.origin) u.searchParams.set(LOCAL_PATHS.parentParam, location.origin);
    iframe.src = u.href;
    renderAll();
  }

  function shortcut(e: { key: string; ctrl: boolean; meta: boolean; shift: boolean; fromGame?: boolean }): boolean {
    const mod = e.ctrl || e.meta;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      if (e.shift) doRedo();
      else doUndo();
      return true;
    }
    if (mod && k === 'y') {
      doRedo();
      return true;
    }
    if (mod && k === 's') {
      void handOff();
      return true;
    }
    // ⌘K / Ctrl+K: the one list of everything (from the game frame too).
    if (mod && k === 'k') {
      palette.open();
      return true;
    }
    // ⌘D copy (also stops the browser's "bookmark this page"), ⌘A select all.
    if (mod && k === 'd' && !e.shift) {
      if (editing) copySelection();
      return true;
    }
    if (mod && k === 'a' && editing && tool === 'placement') {
      const keys = items.map((i) => i.key);
      if (keys.length) selectMany(keys, selected && keys.includes(selected) ? selected : keys[0]!);
      return true;
    }
    if (!mod && (k === 'delete' || k === 'backspace') && editing && (selected || group.length)) {
      removeSelection();
      return true;
    }
    // Layers (2D): ⌘] forward, ⌘[ backward, ⇧⌘] to front, ⇧⌘[ to back (Ctrl
    // elsewhere), like drawing apps. With Shift the key reads '}' / '{' on
    // most layouts. Always swallowed while editing so ⌘[ never navigates back.
    if (mod && (k === ']' || k === '[' || k === '}' || k === '{')) {
      const front = k === ']' || k === '}';
      const all = e.shift || k === '}' || k === '{';
      if (selected && editing) reorder(selected, front ? (all ? 'toFront' : 'forward') : all ? 'toBack' : 'backward');
      return true;
    }
    // P plays / goes back to editing, F shows the whole scene (single keys,
    // never while typing: the keydown handler below lets fields keep them).
    if (!mod && k === 'p' && !e.shift) {
      void togglePlay();
      return true;
    }
    if (!mod && k === 'f' && !e.shift && editing) {
      send({ type: 'studio:core/view', view: { action: 'frameAll' } });
      return true;
    }
    // ⇧F: back to the opening view (the ⌘K row "Back to the opening view").
    if (!mod && k === 'f' && e.shift && editing) {
      goHome();
      return true;
    }
    // Esc closes the open page (Ideas, Editor view) before anything else (design review wave 1, W1-3 / N7, 2026-10-17): it used
    // to do nothing there, so people reached for ⌘K instead. In Ideas with one idea open, Esc goes back to the ideas.
    // Also from the game frame (the bridge may have dropped a tool as well; the page still closes).
    if (!mod && k === 'escape' && page !== 'tool') {
      if (page === 'next' && nextOpen) openNext(null);
      else switchTool(tool);
      return true;
    }
    if (e.fromGame || mod) return false; // the bridge already handled steps/escape
    // R: the next turn axis (3D; the game frame handles it itself when it has focus).
    if (k === 'r' && !e.shift && selected && editing && dim === '3d') {
      send({ type: 'studio:placement/axis', axis: 'next' });
      return true;
    }
    // M / H / T / S: the strip's tools (the game frame handles them itself when it has focus).
    const strip = !e.shift && selected && editing ? STRIP_KEYS[k] : undefined;
    if (strip && !(strip === 'lift' && dim !== '3d')) {
      setStripTool(strip);
      return true;
    }
    if (k === 'escape') {
      // First the strip's open choices, then the chosen tool, then the pick (the same order as in the game).
      if (stripMenu) closeStripMenu();
      else if (stripTool) setStripTool(null);
      else selectObject(null);
      return true;
    }
    if (!selected || !editing) return false;
    const s = keyStep(e.key, e.shift, dim);
    if (!s) return false;
    send({ type: 'studio:placement/step', key: selected, ...s, hold: false, keys: group.length > 1 ? group.slice() : undefined });
    return true;
  }

  function closeStripMenu() {
    stripMenu = false;
    send({ type: 'studio:placement/menu', open: false });
  }
  // A press anywhere in the editor page (the list, the card, the ask box) is "outside" the strip's choices.
  // Capture, so a control that stops the press still closes them; presses inside the game frame never reach here.
  document.addEventListener('pointerdown', () => {
    if (stripMenu) closeStripMenu();
  }, true);
  function setStripTool(k: StripTool | null) {
    stripTool = k;
    send({ type: 'studio:placement/tool', tool: k });
  }
  // Space held with the shell focused: a drag in the game looks around even with a tool chosen.
  let spaceDown = false;
  const spaceLook = (on: boolean) => {
    if (on === spaceDown) return;
    spaceDown = on;
    send({ type: 'studio:placement/look', on });
  };
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') spaceLook(false);
  });
  window.addEventListener('blur', () => spaceLook(false));

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (typing && !(e.ctrlKey || e.metaKey)) return;
    // Space on a focused button presses it; only take Space when nothing that types or presses has focus.
    if (e.key === ' ' && editing && !e.ctrlKey && !e.metaKey && !(e.target as HTMLElement | null)?.closest?.('button, a, [role=option], [role=button]')) {
      spaceLook(true);
      e.preventDefault();
      return;
    }
    if (typing && e.key.toLowerCase() === 'z') return; // native undo inside the field
    if (e.repeat && selected) {
      const s = keyStep(e.key, e.shiftKey, dim);
      if (s && !e.ctrlKey && !e.metaKey) {
        send({ type: 'studio:placement/step', key: selected, ...s, hold: true, keys: group.length > 1 ? group.slice() : undefined });
        e.preventDefault();
        return;
      }
    }
    if (shortcut({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey })) e.preventDefault();
  });

  // Save gets 6 s: its message says what to do next (go back to the AI), which
  // takes longer to read than a plain "done".
  function showToast(text: string, ms = 3500) {
    toast = text;
    toastEl.textContent = toast;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), ms);
  }

  // ----- render -----
  function renderStatus() {
    status.replaceChildren();
    status.className = 'status';
    const line = (cls: string, ...kids: (Node | string)[]) => {
      status.className = `status ${cls}`;
      status.append(...kids);
    };
    playNote.hidden = phase !== 'playing';
    // One word in the caption; the whole sentence is its tooltip (Ive-view review §3).
    playNote.textContent = t('status.playingShort');
    playNote.title = t('status.playing');
    // The game's own error first: it is why nothing else happens (a "Waiting for the game to draw…" that never ends).
    if (gameError && !playing) {
      line('warn', h('strong', { text: t('status.gameError') }), h('span', { class: 'mono', text: ` ${gameError.message}${gameError.where ? ` (${gameError.where})` : ''}` }),
        h('span', { text: ' ' + t('status.gameErrorHint') + ' ' }),
        h('button', { type: 'button', class: 'link', dataset: { action: 'reload-game' }, text: t('btn.reloadGame'), onclick: () => loadGame() }));
    } else if (phase === 'loading') line('info', t('status.loading'));
    else if (phase === 'waiting') line('info', t('status.waiting'));
    else if (phase === 'ready' && !itemsSeen) line('info', t('status.items'));
    else if (phase === 'no-adapter') line('warn', h('strong', { text: t('status.noAdapter') }), h('span', { text: ' ' + t('status.noAdapterHint') }));
    else if (check && !check.ok) {
      // One plain grey line at the top of the list, not a yellow box (Ive review N1, 2026-10-17). The editor still
      // works; only one promise of the adapter is off, so it is a note, not an alarm. The check's own details
      // (`render()`, `setPose`, `set()`…) are words for the AI: they go to it through host.reportCheck (local:
      // .studio/check.md) and are never shown here. test/i18n-words.test.mjs keeps code words out of these lines.
      const first = check.checks.find((c) => !c.ok && !c.skipped);
      if (first) line('note', `${t('check.' + first.id)} ${t('status.checkFail')}`);
    }
    status.hidden = !status.childNodes.length;
    app.dataset.items = itemsSeen ? 'seen' : 'waiting';
    // While playing, the side panel steps away (shell.css): play = the game only.
    app.dataset.playing = playing ? 'on' : 'off';
  }

  let saveSlotW = 0;
  function renderButtons() {
    const n = dirtyCount();
    // Undo / redo say what they would change ("Undo: move house (⌘Z)").
    const mod = isMac() ? '⌘' : 'Ctrl+';
    const nextUndo = describe(undo.peekUndo());
    const nextRedo = describe(undo.peekRedo());
    unsavedKeys = model.changedKeys();
    placementPanel.markRows();
    for (const b of undoBtns) {
      setButton(b, 'undo', t('btn.undo'), false, `${t('btn.undo')}${nextUndo ? ': ' + nextUndo : ''} (${mod}Z)`);
      // While playing, undo/redo would change a game the person cannot see as edited.
      b.disabled = playing || !undo.canUndo;
    }
    for (const b of redoBtns) {
      setButton(b, 'redo', t('btn.redo'), false, `${t('btn.redo')}${nextRedo ? ': ' + nextRedo : ''} (${isMac() ? '⇧⌘Z' : 'Ctrl+Y'})`);
      b.disabled = playing || !undo.canRedo;
    }
    // "✓ Saved": only after Save, until the next change (the draft writes are not shown).
    if (n > 0) savedOnce = false;
    // Save's width while it is still on screen: "✓ Saved" takes the same room (see the footer).
    const shownSave = saveBtns.find((b) => !b.hidden && b.offsetWidth > 0);
    if (shownSave) saveSlotW = shownSave.offsetWidth;
    saveState.replaceChildren(icon('check'), h('span', { text: t('btn.saved') }));
    saveState.title = t('save.savedTip');
    saveState.hidden = !savedOnce || n > 0 || playing;
    saveState.style.minWidth = saveSlotW ? `${saveSlotW}px` : '';
    for (const b of saveBtns) {
      // "Save · 3": only while there is something not saved.
      setButton(b, null, t('btn.save'), true, `${t('save.unsavedTip', { n })} (${mod}S)`);
      if (n) b.append(h('span', { class: 'n', text: `· ${n}` }));
      b.hidden = n === 0 || playing;
      b.dataset.unsaved = String(n);
    }
    for (const b of playBtns) {
      setButton(b, playing ? 'stop' : 'play', playing ? t('btn.edit') : t('btn.play'), true, `${playing ? t('btn.edit') : t('btn.play')} (P)`);
      if (!phone()) b.append(h('kbd', { text: 'P' }));
    }
    keepSoon();
  }

  /** The AI's dot: what it last told the editor (never more). */
  function renderPeer() {
    const st = aiStatus && (aiTime ?? 0) >= openedAt ? aiStatus.state : null;
    // Busy = the AI has a request of yours (ai-flow.ts): the dot pulses and the light runs round the input.
    const busy = aiBusy(currentPhase());
    // With a watch (`studio.mjs --watch`) the dot says whether the AI is watching right now.
    const live = aiWatching !== undefined ? aiWatching : !!st;
    peer.dataset.state = busy ? 'busy' : live ? 'live' : 'idle';
    peer.title = busy ? t('peer.busy') : aiWatching === true ? t('peer.watching') : aiWatching === false ? t('peer.away') : st ? t('peer.live') : t('peer.idle');
    (peer.querySelector('.label') as HTMLElement).textContent = t('peer.label');
  }

  let lastPage = '';
  function renderAll(remount = false) {
    document.documentElement.lang = lang;
    app.dataset.layout = phone() ? 'phone' : 'pc';
    app.dataset.sheet = sheetOpen ? 'open' : 'closed';
    app.dataset.view = tool; // not data-tool: the Scene / Assets rows carry data-tool
    app.dataset.page = page;
    // ▣ Studio / <the game> / <where you are>.
    (header.querySelector('.title') as HTMLElement).textContent = gameName || t('app.title');
    (header.querySelector('.app') as HTMLElement).textContent = t('app.brand');
    (header.querySelector('.here') as HTMLElement).textContent = page === 'settings' ? t('btn.settings') : page === 'next' ? t('btn.next') : t('tool.' + tool);
    (header.querySelector('.adapter') as HTMLElement).textContent = adapterInfo;
    langBtn.textContent = t('btn.lang');
    // Scene / Assets: two rows, a 16 px icon, the name, the count.
    tabs.replaceChildren();
    for (const id of ['placement', 'library'] as ToolId[]) {
      const n = id === 'placement' ? items.length : libraryCount;
      tabs.append(h('button', { type: 'button', role: 'tab', class: 'nav-row', 'aria-selected': String(tool === id && page === 'tool'), dataset: { tool: id }, onclick: () => switchTool(id) },
        icon(id === 'placement' ? 'cube' : 'grid'), h('span', { class: 'label', text: t('tool.' + id) }), n ? h('span', { class: 'n', text: String(n) }) : null));
    }
    (paletteFoot.querySelector('.label') as HTMLElement).textContent = t('foot.palette');
    sheetMore.setAttribute('aria-label', t('foot.palette'));
    sheetMore.title = t('foot.palette');
    // The list's head: up in the sheet's head row on a phone, back over the list on PC (see sheetMore).
    const listTools = placementPanel.listToolsEl;
    if (phone()) {
      if (listTools.parentElement !== headTools) headTools.prepend(listTools);
    } else if (listTools.parentElement === headTools) {
      placementPanel.el.prepend(listTools);
    }
    // The phone's list button: a list icon that turns into a chevron when the sheet is open.
    setButton(sheetBtn, sheetOpen ? 'chevronDown' : 'list', sheetOpen ? t('btn.close') : t('btn.list'), false);
    sheetBtn.setAttribute('aria-expanded', String(sheetOpen));
    renderStatus();
    renderButtons();
    renderPeer();
    // The ask box lives in the bar at the bottom of the game whatever the tool or page.
    // The web demo (no AI behind it, host.offline) shows one grey line in its place instead (design review wave 1, W1-6 / N2,
    // 2026-10-17): the most visible part of the screen was a box that did nothing when used.
    if (host.offline) {
      // One line (the review): a phone's bar fits about 40 characters, so it gets the short words.
      const short = phone();
      (offlineLine.querySelector('.label') as HTMLElement).textContent = (short ? t('offline.askLine.short') : t('offline.askLine')) + (host.getUrl ? ' ' : '');
      const get = offlineLine.querySelector('a');
      if (get) get.textContent = short ? t('offline.get.short') : t('offline.get');
      if (offlineLine.parentElement !== askSlot) askSlot.replaceChildren(offlineLine);
    } else if (placementPanel.askEl.parentElement !== askSlot) askSlot.append(placementPanel.askEl);
    placeCard();
    placementPanel.renderAsk();
    renderAiLine();
    // A new page starts at its top.
    const pageKey = page === 'tool' ? `tool:${tool}` : page;
    if (pageKey !== lastPage) {
      lastPage = pageKey;
      panel.scrollTop = 0;
    }
    // Assets (over the game / a phone sheet).
    if (tool !== 'library' && mounted) {
      mounted.unmount();
      mounted = null;
    }
    if (remount && mounted && tool === 'library') {
      mounted.unmount();
      mounted = null;
    }
    mountTool();
    assetsPage.hidden = tool !== 'library' || playing;
    // The left column: the Look page, the Ideas page, or the scene list.
    if (page === 'settings') {
      renderSettings(toolEl, { t, prefs: () => uiPrefs, change: changeUi, back: () => switchTool(tool), phone, lang: () => lang, setLang,
        aiLookOff: aiLook && !safeUi ? (() => { const u = new URL(location.href); u.searchParams.set('ui', 'off'); return u.href; })() : null });
    } else if (page === 'next') {
      renderNextSteps(toolEl, {
        host, lang: () => lang, t, back: () => switchTool(tool),
        send: (step, text) => askAi({ kind: 'next-step', step, text }),
      }, nextOpen, (id) => {
        nextOpen = id;
        renderAll();
      });
    } else {
      if (toolEl.firstChild !== placementPanel.el || toolEl.childNodes.length !== 1) toolEl.replaceChildren(placementPanel.el);
      placementPanel.render();
    }
    // Rows may have come into view without a scroll (a kind opened, the sheet opened).
    thumbsSoon(false);
    sendInset();
  }

  let lastLayout = phone();
  window.addEventListener('resize', () => {
    if (phone() !== lastLayout) {
      lastLayout = phone();
      renderAll(true);
    }
  });

  // ----- the AI's rewrite of the editor look (.studio/ui/, CONTRACT.md §8) -----
  const parts: Record<ShellPart, HTMLElement> = {
    app, stage, side, header, brand, tabs, tools: toolsRow, 'top-actions': topActions, status, ai: aiLine, panel, footer, bar,
    card: placementPanel.cardEl, ask: placementPanel.askEl, dock, palette: palette.el, 'assets-page': assetsPage,
  };
  // The Look page says when the AI's look (.studio/ui/) is in use and how to
  // open without it (mari review, earlier point G): before, "why did that
  // button go away?" had no answer on screen.
  let aiLook = false;
  const markAiLook = () => {
    if (aiLook) return;
    aiLook = true;
    if (page === 'settings') renderAll();
  };
  const api: StudioShellApi = {
    version: 1,
    part: (name) => parts[name],
    addButton(b) {
      markAiLook();
      const el = h('button', { type: 'button', dataset: { action: `custom-${String(b.id).slice(0, 40)}` }, text: b.label, title: b.title });
      el.addEventListener('click', () => {
        try {
          b.onClick();
        } catch (e) {
          console.warn('[studio] custom button failed:', e);
        }
      });
      const where = b.where || 'top-actions';
      if (where === 'tools') {
        customTools.push(el);
        renderToolsRow();
      } else (where === 'footer' ? footer : where === 'bar' ? bar : topActions).append(el);
      return el;
    },
    hide: (what) => {
      markAiLook();
      changeUi({ ...uiPrefs, show: { ...uiPrefs.show, [what]: false } });
    },
    show: (what) => {
      markAiLook();
      changeUi({ ...uiPrefs, show: { ...uiPrefs.show, [what]: true } });
    },
    prefs: () => structuredClone(uiPrefs),
    setPrefs: (patch) => {
      markAiLook();
      changeUi({ ...uiPrefs, ...patch, show: { ...uiPrefs.show, ...(patch.show || {}) } });
    },
    setText(l, strings) {
      markAiLook();
      setExtraText(l, strings);
      renderAll();
    },
    t: (key) => t(key),
    lang: () => lang,
    items: () => items,
    selected: () => selected,
    actions: {
      undo: () => doUndo(),
      redo: () => doRedo(),
      save: () => handOff(),
      select: (k) => selectObject(k, true),
      switchTool: (id) => switchTool(id),
      frameAll: () => send({ type: 'studio:core/view', view: { action: 'frameAll' } }),
      openSettings: () => openSettings(),
      openNextSteps: () => openNext(),
      activateTool: (id) => send({ type: 'studio:tool/activate', id }),
      copy: () => copySelection(),
      remove: () => removeSelection(),
      selectMany: (keys, primary) => selectMany(keys, primary ?? keys[0] ?? null),
    },
    on(ev, cb) {
      const set = shellEvents.get(ev) || new Set();
      set.add(cb);
      shellEvents.set(ev, set);
      return () => set.delete(cb);
    },
  };
  (window as unknown as { studioShell: StudioShellApi }).studioShell = api;

  /**
   * Load .studio/ui/studio.css and shell.js unless the URL has ?ui=off (the
   * way back when a rewrite went wrong; deleting .studio/ui/ also works).
   */
  function loadCustomUi() {
    if (safeUi) return;
    const urls = host.customUi();
    if (urls.css) {
      const link = h('link', { rel: 'stylesheet', href: urls.css, dataset: { studioCustom: 'css' } });
      // The server answers with a comment when there is no studio.css: rules = the AI's look is in use.
      link.addEventListener('load', () => {
        try {
          if (link.sheet && link.sheet.cssRules.length) markAiLook();
        } catch {
          markAiLook();
        }
      });
      document.head.append(link);
    }
    if (urls.js) {
      const sc = h('script', { src: urls.js, dataset: { studioCustom: 'js' } });
      sc.addEventListener('error', () => console.warn('[studio] .studio/ui/shell.js failed to load'));
      document.body.append(sc);
    }
  }

  // ----- start -----
  applyUi();
  renderAll(true);
  void (async () => {
    try {
      const [opened, placement, ui, config] = await Promise.all([
        host.open(),
        host.load('placement').catch(() => null),
        host.loadUi().catch(() => null),
        host.loadConfig().catch(() => null),
      ]);
      uiPrefs = normalizeUi(safeUi ? null : ui);
      if (uiPrefs.lang && !new URLSearchParams(location.search).get('lang')) lang = uiPrefs.lang;
      gameConfig = config;
      applyUi();
      renderAll(true);
      // After the person's prefs, so the AI's CSS and script have the last word.
      loadCustomUi();
      gameUrl = opened.gameUrl;
      gameOrigin = new URL(opened.origin || opened.gameUrl, location.href).origin;
      if (opened.title) {
        gameName = opened.title;
        document.title = `${opened.title} — ${t('app.title')}`;
        renderAll();
      }
      const v = placement ? validatePlacement(placement) : null;
      model.restore(v && v.ok ? v.value : null);
      if (tools.library?.restore) tools.library.restore(await host.load('library').catch(() => null));
      // The left column's "Assets  4".
      void host.listAssets().then((r) => {
        libraryCount = r.files.length;
        renderAll();
      }, () => undefined);
      loadGame();
      void pollStatus();
    } catch (e) {
      showToast((e as Error).message);
    }
  })();
}
