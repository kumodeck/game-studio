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
  type EditLayer,
  type FlyKey,
  type MotionKey,
  type GameConfig,
  type Inset,
  type GameToolInfo,
  type Item,
  type AiAgent,
  type CodeAvoidInfo,
  type CodeMotionInfo,
  type CodePlaceInfo,
  type PlacementPlace,
  type Lang,
  type PlacementFile,
  type Pose,
  type SelfCheckResult,
  type ShellContext,
  type ShellToBridge,
  type ShellTool,
  type StudioHost,
  type StudioRequestInput,
  type RequestMotion,
  type RequestPlace,
  type StudioStatus,
  type LibraryFileUse,
  type LevelInfo,
  type ShellPart,
  type StripTool,
  type StudioShellApi,
  type ToolId,
  type UiPrefs,
} from '../contract.ts';
import { keyStep } from '../core/keys.ts';
import { validateLibrary, validatePlacement } from '../schema/index.ts';
import { filesOfObject, filesOfObjects, libraryAct, libraryFile, libraryHoldStill, libraryParts, libraryPickedFiles, libraryRedraw, libraryShowPick, libraryTool, openAsset } from '../tools/library/index.ts';
import { DRAG_FILE } from '../tools/library/panel.ts';
import { createLibraryObjects, DRAG_OBJECT } from './library-objects.ts';
import { motionsPlayHere } from './play-here.ts';
import { createLibraryMotions } from './library-motions.ts';
import { createMotionDrag } from './motion-drag.ts';
import { createMotionTool } from './motion-tool.ts';
import { rulesFor } from '../core/rules.ts';
import { samePose } from './placement-model.ts';
import { h, safeImageSrc } from './dom.ts';
import { detectLang, setAiName, setExtraText, translate } from './i18n.ts';
import { NEXT_STEPS, renderNextSteps, type StepId } from './next-steps.ts';
import { statusCovers } from '../schema/handoff.mjs';
import { aiBusy, aiPhase, moreIn, reloadDecision, type AiPhase } from './ai-flow.ts';
import { aiNameKey, aiPresence, presenceSure, QUIET_WORK_MS, UNSEEN_MS, type AiPresence } from './ai-presence.ts';
import { bounces, saveLoud } from './save-loud.ts';
import { askView as questionView } from './ai-ask.ts';
import { playLine, playWords } from './play-ask.ts';
import { LINE_FADE_MS, LINE_GRACE_MS, lineFades, lineKey, lineStayMs } from './line-fade.ts';
import { renderSettings } from './settings-page.ts';
import { DEFAULT_UI, effectiveTheme, normalizeUi } from './ui-prefs.ts';
import { dropTarget, hasLayer, layerTarget, type LayerOp } from './layers.ts';
import { createPlacementPanel } from './placement-panel.ts';
import { createTimeline } from './timeline-wire.ts';
import { libCounted } from './timeline-model.ts';
import { createMotionAsk } from './motion-ask.ts';
import { CODE_LEN, motionLibrary } from './motion-library.ts';
import { attachWorld, roundLib } from './motion-model.ts';
import { icon, setButton } from './icons.ts';
import { receipt, type SavedThing } from './save-receipt.ts';
import { createCodePlaceWire } from './code-place-wire.ts';
import { createKeepOutWire } from './keep-out-wire.ts';
import { createPalette, type PaletteRow } from './palette.ts';
import { fitPicture } from './thumb-fit.ts';
import { PlacementModel } from './placement-model.ts';
import { UndoStack, poseChange, sharedMotion, type Change, type UndoEntry } from './undo.ts';
import { createAiHands } from './ai-hands.ts';
import { MOTION_SAMPLES, RuleCompare, gapText, motionGap, timeText } from './to-rule.ts';
import { copyKey, groupLayerMoves, groupLayerPossible, sameKind } from './edit-ops.ts';
import { displayName, forgetNames, noteItems, useGivenNames, useNameLang } from './names.ts';
import { keyOf, tipText } from './keymap.ts';
import { installTooltips } from './tooltip.ts';
import { createShortcutSheet } from './shortcuts.ts';
import { createContextMenu, type MenuEntry } from './context-menu.ts';
import { Levels, worldOf, type WorldPart } from './levels.ts';
import { checkNoteId } from './check-note.ts';
import { createLevelSwitch, makeRows } from './level-switch.ts';
import { contextRows, type CtxPlace } from './context-rows.ts';
import { bigChanges, createSafeSave } from './safe-save.ts';
import { createUnsavedGuard, lostBy, playAsks, type GuardOp } from './unsaved-guard.ts';
import { createLayerSwitch } from './layer-switch.ts';
import { uiAsPlacement, uiEntries, withUi } from './ui-layer.ts';
import { createUiWire } from './ui-wire.ts';
import { barPress, FOLD_DRAG, gripEnd, readFold, writeFold } from './sheet-fold.ts';

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
/** Camera up / down steps, shares of the game's height: ⌘K a tenth, E / Q a twentieth (the same as bridge/input.ts). */
const RISE_STEP = 0.1;
const RISE_KEY_STEP = 0.05;
/** 1–4: the same tools in the 3D strip's order (basics pass, 2026-10-18; bridge/handles.ts TOOL_NUMBERS). 2 is Height: nothing in 2D. */
const STRIP_NUMBERS: Record<string, StripTool> = { '1': 'move', '2': 'lift', '3': 'rotate', '4': 'scale' };
/** A / 5: the strip's Motion button (studio-motion-tool; the same as the game page's bridge/handles.ts MOTION_KEYS). */
const MOTION_KEYS = new Set(['a', '5']);
const STRIP_ICONS: Record<StripTool, string> = { move: 'toolMove', lift: 'toolLift', rotate: 'toolRotate', scale: 'toolScale' };
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function start(host: StudioHost) {
  let lang: Lang = detectLang(location.search, navigator.language || 'en');
  useNameLang(() => lang);
  const t = (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);

  // ----- state -----
  let phase: Phase = 'loading';
  let gameUrl = '';
  let gameOrigin = location.origin;
  let bridgeAlive = false;
  let editing = false;
  let dim: Dim = '3d';
  // UI stage 1 (2026-10-19): the game's layers when it has a UI (core/ready `layers`; null = no UI — the editor is
  // exactly as before), the one edited now, and the world's own dim (`dim` is the edited layer's: '2d' on the UI).
  // `worldItems` / `uiItems`: each layer's last list (`items` is the edited one's). `uiSeen`: the UI's list came at
  // least once; until then the saved file's `ui` (`fileUi`) is written back as it was (fileNow).
  let editLayers: EditLayer[] | null = null;
  let editLayer: EditLayer = 'world';
  let worldDim: Dim = '3d';
  let worldItems: Item[] = [];
  // The game's code motions, code layouts and keep-out conditions (studio-code-base, 2026-10-24; bridge code-lists.ts):
  // sent after each world list, empty for a game without them (a new list empties them first).
  let codeMotionList: CodeMotionInfo[] = [];
  let codePlaceList: CodePlaceInfo[] = [];
  let codeAvoidList: CodeAvoidInfo[] = [];
  let uiItems: Item[] = [];
  let uiSeen = false;
  let fileUi: PlacementFile['ui'];
  // The game's UI shown (faded) while the world is edited: the eye next to World | UI, ⇧U, ⌘K (layer-switch.ts).
  // Hidden by default (a try of the editor, 2026-10-20, "the UI is always there, in the way"); kept for this visit only, so every
  // opening starts with the world clear. A new game page (reload, Play and back) starts hidden in the bridge, so
  // core/ready sends it again when on.
  let uiPeek = false;
  let fileUiView: PlacementFile['uiView'];
  /** The edit camera can go up / down (core/ready `rise`: 3D adapters with view.rise). */
  let canRise = false;
  // Drop to floor (End): the 3D adapter can set things on the surface below (snap to surfaces, 2026-10-19).
  let canDrop = false;
  // The game's loader runs every motion in the edit page (core/ready `motionHere`, play-here.ts).
  let motionHere = false;
  /** It can fly with W A S D (core/ready `fly`: 3D adapters with view.fly; camera-wasd 2026-10-18). */
  let canFly = false;
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
  // ⌘C remembers the selection here; ⌘V duplicates what is remembered (basics pass, 2026-10-18). Only keys: the
  // copies are made by the adapter next to the originals, exactly as ⌘D, so paste = "duplicate what I copied".
  // Not the system clipboard: an object of a running game cannot travel to another app, and a text there would
  // only surprise. A key whose object is gone by then (deleted, or the AI removed it) is skipped.
  let clip: string[] = [];
  // "Use the Library" (2026-10-18). `filePick`: the files picked in the open Library (its panel tells us), named by the
  // ask box's chip next to the picked objects. `addingToScene`: copies asked for by the Library's "Add to scene", whose
  // answer (placement/added) brings the Scene up with them picked.
  let filePick: string[] = [];
  const addingToScene = new Set<string>();
  /**
   * The game objects each code level's page listed (studio-fix-0146, 2026-10-24), by the code level it builds
   * (levels.build; '' = a game without levels yet): key → the last Item seen. WHY: a New level hides every object but
   * the ground (PlacementModel.blankKeep), and a hidden object leaves the game's list, so the Library had nothing to
   * place there — "Build it by hand" could only be filmed on a Duplicate (x-motion-0145). The Library lists what is
   * here but not in the list ("Not in this level", absentItems) and a click or a drop puts it in (placeHere). By the
   * code level, not one map: two levels share keys ("tree-1" in Meadow and in Summit are different trees), and a
   * New level is built from the one it was made from, so its page has the same keys as that one.
   */
  const seenByBuild = new Map<string, Map<string, Item>>();
  const buildNow = () => (levels.active ? levels.build(levels.current) : '');
  function rememberItems(list: Item[]) {
    const b = buildNow();
    let m = seenByBuild.get(b);
    if (!m) seenByBuild.set(b, (m = new Map()));
    for (const it of list) if (!it.copyOf && !it.ghost) m.set(it.key, it);
  }
  let check: SelfCheckResult | null = null;
  // ?tool=library opens on the Library (studio.mjs --tool library).
  let tool: ToolId = new URLSearchParams(location.search).get('tool') === 'library' ? 'library' : 'placement';
  let page: 'tool' | 'next' | 'settings' = 'tool';
  // Scene ('placement') and Library ('library') are the left column's two rows ("one Library", a try of the editor, 2026-10-18):
  // the Scene is the game with its object list; the Library holds every object and every file in one grid
  // (library-objects.ts + tools/library). Plan 1's third place — the objects' own "Grid" shelf, `objView` — is gone.
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
  // The bottom folded to the ask bar alone (phone / side window; sheet-fold.ts): kept in this browser.
  const handStore = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  let fold = readFold(handStore);
  let toast = '';
  let toastTimer = 0;
  const thumbs = new Map<string, string>();
  // Pictures kept from the game page before a reload (▶ Play → Edit, the AI's change): still shown, asked for again,
  // and replaced when the new one comes (Ive review 3 ⑥, 2026-10-20 — the list showed empty squares after Edit until
  // every picture was drawn again: `thumbs` was cleared on a reload). A key the new game no longer has keeps an unused
  // entry; one that now names another object (a tree path) shows the old picture until its new one comes.
  const staleThumbs = new Set<string>();
  const needsThumb = (k: string) => !thumbs.has(k) || staleThumbs.has(k);
  // The Library's tiles: their own pictures, twice the tile's size on screen (Ive review 3 ⑧), apart from the list's
  // 96 px ones so a game with hundreds of objects does not draw every list row at 384 px. Kept and replaced like the
  // list's (`bigStale`). `bigShown`: asked for since the last reload.
  const bigThumbs = new Map<string, string>();
  const bigStale = new Set<string>();
  const bigShown = new Set<string>();
  const bigRaw = new Map<string, string>();
  // The last raw picture the game sent per object (before cropping, thumb-fit.ts).
  const thumbAsked = new Map<string, string>();
  // One model per layer (ui-layer.ts says why the UI's is a PlacementModel too); `model` is the edited layer's, so
  // every move, undo and card below works on whichever layer is on.
  // `let`: a game with levels gets a fresh world model per level shown (levels.ts says why).
  let worldModel = new PlacementModel();
  const uiModel = new PlacementModel();
  // Levels (2026-10-22): the level list and the levels not on screen; inactive for a game with one level.
  const levels = new Levels();
  // The opened file's top world part, for the level on screen when the game first says it has levels.
  let startWorld: WorldPart | undefined;
  let model = worldModel;
  // Names given in the editor (Rename, F2) show everywhere an object's name does (names.ts displayName).
  useGivenNames((k) => worldModel.nameOf(k));
  const undo = new UndoStack();
  undo.layerNow = () => (editLayer === 'ui' ? 'ui' : undefined);
  // Motions (motion-gui, then the timeline: studio-timeline 2026-10-22; timeline-wire.ts): the card's Motion row, the
  // timeline plate at the foot of the game, the path in 3D, auto key. The world's only, 3D, while editing the Scene.
  const timeline = createTimeline({
    // A getter (integrate3, 2026-10-22): a game with levels gets a fresh worldModel per level (useLevelModel), so the
    // timeline must read the one on screen now, not the first one it was given.
    get store() {
      return worldModel.motion;
    },
    // The Library's motions: one for the whole file, across levels (studio-motion-triggers, motion-library.ts).
    lib: motionLibrary,
    others: () => levels.list.filter((e) => e.id !== levels.current).map((e) => (e.world.motion ||= {})),
    undo,
    send: (m) => send(m),
    dim: () => dim,
    usable: () => editing && !playing && editLayer === 'world' && dim === '3d' && tool === 'placement' && page === 'tool',
    picked: () => (editing && editLayer === 'world' && group.length <= 1 ? selected : null),
    // studio-motion-focus: the rows are the picked objects; a click in the game while "+ Link an object" is open links.
    group: () => (editing && editLayer === 'world' ? group.slice() : []),
    reselect: (k) => selectObject(k),
    // Rule motions (studio-code-knobs): the game page's codeMotion() list (knobs, round, the ◇'s knob).
    codeMotions: () => codeMotionList,
    told: (text) => showToast(phone() ? t('hands.undoTouch', { text }) : t('hands.undo', { text, key: keyOf('undo', isMac()) }), 6000),
    place: (k) => worldModel.pose(k),
    order: () => worldItems.map((i) => i.key),
    label: (k) => {
      const it = worldItems.find((i) => i.key === k);
      return it ? displayName(it, t) : k;
    },
    select: (k) => selectObject(k, true),
    changed: () => {
      if (tool === 'placement' && page === 'tool') placementPanel.render();
      renderButtons();
    },
    layout: () => placeTimeline(),
    numbers: () => {
      if (tool === 'placement' && page === 'tool' && selected) placementPanel.updateNumbers();
    },
    narrow: () => phone(),
    t: (k, v) => t(k, v),
    seen: (id) => hintSeen(id),
    markSeen: (id) => markHint(id),
    // ✦ Ask AI on a motion (studio-motion-panel, motion-ask.ts): the chat box with the "object · motion" chip.
    ask: host.offline ? undefined : (k, m) => askMotion(k, m),
    // ✦ Turn into a rule… (studio-code-torule): the same chip, the draft "Turn into a close rule", the request's intent.
    toRule: host.offline ? undefined : (k, m) => {
      askMotion(k, m, t('toRule.draft'));
      toRuleAsk = { key: k, use: m.use };
    },
    compare: (name) => {
      const hand = ruleCompare.motion(name, !!motionLibrary.get(name)?.code);
      if (!hand) return null;
      const g = ruleCompare.motionGapOf(name);
      return { hand, on: ruleCompare.show, gap: g ? t('toRule.maxMotion', { gap: gapText(g.d, worldDim, unitWord) }) : null, at: g ? t('toRule.atTime', { t: timeText(g.t) }) : null };
    },
    compareShow: (on) => setCompareShown(on),
    remeasure: (name) => void remeasureMotion(name),
  });
  // ----- ✦ Turn into a rule (studio-code-torule, 2026-10-24; shell/to-rule.ts) -----
  // What the AI swapped in for the hand's shape, and the hand's shape itself, until Save: the comparison on the card,
  // the timeline and in the game.
  const ruleCompare = new RuleCompare();
  /**
   * The ✦ press the chat box's words are for: the hand-placed objects picked then (sorted keys), or the motion (its object
   * and Library motion). The request gets `intent: 'to-code'` only while the screen still shows that (motion-ask.ts's rule).
   */
  let toRuleAsk: { keys: string } | { key: string; use: string } | null = null;
  const unitWord = (u: string) => t(`hands.unit.${u}`);
  const levelNow = () => (levels.active ? levels.current : '');
  let measureId = 0;
  /** A rule motion's offsets over `len` seconds (`per` places), as the game page runs it — null when it does not answer. */
  function ruleSamples(code: string, knobs: Record<string, number>, len: number, per: number): Promise<MotionKey[] | null> {
    return new Promise((resolve) => {
      // Ids of their own (timeline-wire's "Make editable points" counts from 1): an answer is never taken for the other's.
      const id = 1_000_000 + ++measureId;
      const off = ctx.on('studio:timeline/code-points', (m) => {
        if (m.id !== id) return;
        off();
        clearTimeout(timer);
        resolve(m.keys ?? null);
      });
      const timer = window.setTimeout(() => (off(), resolve(null)), 3000);
      send({ type: 'studio:timeline/code-points', id, code, knobs, len, per });
    });
  }
  /** A compared rule motion's knob turned: its largest gap again, for the line. */
  async function remeasureMotion(name: string) {
    const l = motionLibrary.get(name);
    const hand = ruleCompare.motion(name, !!l?.code);
    const info = l?.code ? codeMotionList.find((c) => c.code === l.code) : undefined;
    if (!l?.code || !hand || !info) return;
    const knobs = Object.fromEntries(Object.entries(info.knobs).map(([n, k]) => [n, l.knobs?.[n]?.v ?? k.v]));
    const pts = await ruleSamples(l.code, knobs, info.round && info.round > 0 ? info.round : CODE_LEN, MOTION_SAMPLES);
    ruleCompare.setMotionGap(name, pts?.length ? motionGap(hand, pts).max : null);
    timeline.compared();
  }
  /** The comparison changed (a swap, Save, the switch): the card, the guide, the timeline and the game's marks again. */
  function compareChanged() {
    codePlaces.guide(true);
    timeline.compared();
    if (tool === 'placement' && page === 'tool') placementPanel.render();
  }
  function setCompareShown(on: boolean) {
    ruleCompare.show = on;
    compareChanged();
  }
  /** ✦ Turn into a rule on the card: several hand-placed world objects, none of them a rule's own already. */
  function toRuleFor(keys: string[]): (() => void) | null {
    if (host.offline || editLayer !== 'world' || keys.length < 2) return null;
    const its = keys.map((k) => items.find((i) => i.key === k));
    if (its.some((i) => !i || i.kinds.includes('ui') || i.backdrop || i.held === 'ground' || i.movable === false || codePlaces.layoutOf(i.key))) return null;
    return () => {
      toRuleAsk = { keys: [...keys].sort().join('\n') };
      focusAsk(t('toRule.draft'));
    };
  }
  /** The request's `intent` (and whether its motion carries its points): only while the screen is what ✦ was pressed on. */
  function toRuleNow(keys: string[]): 'objects' | 'motion' | null {
    const a = toRuleAsk;
    if (!a) return null;
    if ('keys' in a) {
      if ([...keys].sort().join('\n') === a.keys && !libraryShown()) return 'objects';
    } else {
      const at = motionAsk.now();
      if (at && at.key === a.key && at.use === a.use && !libraryShown()) return 'motion';
    }
    toRuleAsk = null;
    return null;
  }
  // The motion the chat box is about (studio-motion-panel): set by ✦ Ask AI, gone once the screen shows something else.
  const motionAsk = createMotionAsk({
    picked: () => (editLayer === 'world' && group.length <= 1 ? selected : null),
    shown: (k) => timeline.shownName(k),
  });
  /**
   * Hints closed for good (studio-motion-flow: the timeline's first-time steps). Kept in this browser AND in the game's
   * ui prefs (.studio/ui/prefs.json `seen`): the studio opens on a free port, so the browser's storage alone would
   * forget it on the next run; the prefs alone would show it again in every new game on this machine.
   */
  // The one line when it opens (renderSheet): seen in this game once something was picked. `prefsLoaded`: the game's
  // prefs have been read (until then nobody knows whether this game has seen it).
  const INTRO_SEEN = 'open-line';
  let prefsLoaded = false;
  function hintSeen(id: string): boolean {
    if (uiPrefs.seen?.includes(id)) return true;
    try {
      return handStore?.getItem(`studio.seen.${id}`) === '1';
    } catch {
      return false;
    }
  }
  function markHint(id: string) {
    try {
      handStore?.setItem(`studio.seen.${id}`, '1');
    } catch {
      /* private window: the prefs still keep it */
    }
    if (!uiPrefs.seen?.includes(id)) changeUi({ ...uiPrefs, seen: [...(uiPrefs.seen ?? []), id] });
  }
  const listeners = new Map<string, Set<(m: BridgeToShell) => void>>();
  let placementRestored = false;
  // The same for the UI layer's first list of each page (UI stage 1): set false by loadGame().
  let uiRestored = false;
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
  // `saved` / `savedTotal` (plan step 6): what a Save kept, by name, for the line after it (save-receipt.ts).
  let pending: { kind: StudioRequestInput['kind'] | 'saved'; id?: string; at: number; sent: number; text?: string; saved?: SavedThing[]; savedTotal?: number } | null = null;
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
  // ai-presence.ts's clock: when this page last saw a heartbeat (null = never), and since when it has been visible
  // without a break (a hidden tab's polls stop: coming back must not read as a minute of silence).
  let lastWatching: number | null = null;
  let visibleSince = Date.now();
  // The presence's line is open (toggleOpenHelp).
  let helpOpen = false;
  // Which AI is behind the editor (host.status().agent, which-ai.mjs): the line's "More in Claude" (ai-flow.ts moreIn).
  let aiAgent: AiAgent | undefined;
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
  // Undo / Redo presses, so the same "Back to before" after Undo → Redo → Undo is a new line (line-fade.ts lineKey).
  let aiAfterTurn = 0;
  let undoBusy = false;
  // The finished line goes by itself (line-fade.ts, 2026-10-20: "this line is always there, it's in the way"). `lineShown`: the key of
  // the finished line on screen, whose timer runs; `lineGone`: the key of the one that faded — the next poll draws the
  // same line again and it must stay gone until there is something new (or the person calls it back with the top
  // bar's "● AI" or ⌘K). `lineLeft`: when the pointer / keyboard last left it (LINE_GRACE_MS more after that).
  let lineShown = '';
  let lineGone = '';
  /**
   * PC with the motion timeline open (studio-fix-0142, ④ of the fourth first-run check, 2026-10-24): a finished AI line
   * ("✓ In the game (1)", "Made the change") is a chip just left of the ask field (shell.css .ai-tuck), not a row above it. That row floated over the
   * middle of the game, right where the picked object's strip and the object itself are (neon-ja-34: over the gate's
   * strip; 45: over the picked ship). A press on the chip shows the whole line again (`aiTuckOpen` = that line's key)
   * until the next line. What is still going on (working, asking, failed, kept as a note) is never tucked: it may need
   * the person, and fix-0140 ④ already made the field one row there.
   */
  let aiTuckOpen = '';
  const aiTuck = h('button', { type: 'button', class: 'ai-tuck', hidden: true, dataset: { part: 'ai-tuck', action: 'ai-tuck' },
    onclick: () => ((aiTuckOpen = lineShown), renderAiLine()) });
  let lineFading = false;
  let lineTimer = 0;
  let lineLeft = 0;
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
  // The code's own poses (`was`) at the same moments as aiBefore / aiBase (play-after-ai, 2026-10-21): an object the
  // PERSON moved without saving stands at its code's pose on the new page of a game without the loader — that is not
  // the AI moving it. Before, every such object got the violet "AI moved" mark after any AI change.
  let aiBeforeCode: Map<string, Pose> | null = null;
  let aiBaseCode: Map<string, Pose> | null = null;
  let aiMarks = new Map<string, 'moved' | 'added'>();
  // The marks as sent to the game (again on every edit start: a reload makes a new game page).
  let aiMarksMsg: { keys: string[]; label?: string } = { keys: [] };
  // What was last sent as marks (sendMarks), and whether the line showed the AI's question (the ask field answers it).
  let askLit = '';
  let wasAsking = false;
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
  // Where you are, always in one line: ▣ Studio / <the game> / Scene / <the level> ⌄ (level-menu2, 2026-10-23; a hands-on try:
  // "game name, scene, level name"). A game with levels shows the one on screen; a game without them "Level 1 ⌄"
  // while its world is edited (level-switch.ts says why). Both slots are filled by renderLevelCrumb().
  const levelSlot = h('span', { class: 'level-crumb', hidden: true, dataset: { part: 'level-crumb' } });
  const levelAddSlot = h('span', { class: 'level-add-slot', hidden: true });
  // The line after New level / Duplicate (renderLevelMade), under the top bar's left end.
  const levelNote = h('div', { class: 'level-made', role: 'status', hidden: true, dataset: { part: 'level-made' } });
  /**
   * A level made by New level / Duplicate that ⌘Z can still take back: its id and name, the level shown before (`back`),
   * and — when it was the game's second level (`started`: the game had none before) — the game's one level (`single`)
   * and its model, to go back to a game with one level exactly as it was.
   */
  let levelMade: { id: string; name: string; back: string; started: boolean; single: LevelInfo | null; model: PlacementModel } | null = null;
  const brand = h('div', { class: 'brand', dataset: { part: 'brand' } },
    h('span', { class: 'mark', 'aria-hidden': 'true' }, icon('mark')), h('span', { class: 'app' }), h('span', { class: 'sep', 'aria-hidden': 'true', text: '/' }),
    h('strong', { class: 'title' }), h('span', { class: 'sep here-sep', 'aria-hidden': 'true', text: '/' }), h('span', { class: 'here' }), levelSlot, levelAddSlot, h('span', { class: 'adapter' }), langBtn);
  // One "Save" (play test 10/16: "Hand to AI" meant nothing to people; "Save"
  // does). "Save · 3" (⌘S) while there are changes not saved; pressing it
  // writes placement.json and hands it to the AI, as Save always did. Then
  // "✓ Saved" in the same place until the next change. The quiet writes in
  // between are a draft only (so closing the tab loses nothing) and are never
  // shown: two different "saved" on one screen read as a contradiction.
  const saveState = h('span', { class: 'save-state', dataset: { part: 'save-state' } });
  // Undo / redo: always here, on PC and phone, dimmed while there is nothing to undo / redo (basics pass,
  // 2026-10-18 — from a try of the editor: "undo and redo are needed: keyboard shortcuts AND buttons"). Before, PC had only ⌘Z and
  // the ⌘K rows, and phones showed Undo only once there was something to undo (Redo never): a button that comes
  // and goes moves its neighbours, and a person who does not know ⌘Z had no way to find it. Tooltips name what
  // they would change and the key ("Undo: move lighthouse  ⌘Z"). Phone: 44 × 44.
  // "✓ Saved" sits LEFT of Undo / Redo: the bar's right group is aligned to the right, so whatever comes and goes
  // must be left of what stays (with Undo first, the first change pushed Undo 80 px left under the mouse).
  // History: Save itself was here until 2026-10-20 (it moved into the game, then on 2026-10-21 beside ▶ Play: topSave
  // below). A web demo bug of 2026-10-16 is why nothing may slide under the finger after Save: Save vanished, Undo slid
  // into its spot, and a second tap on "Save" pressed Undo — "saving does not work". The Save keeps its place for a
  // moment after the press for the same reason (SAVE_DONE_MS).
  // The ONE Save (a try of v0.1.9, 2026-10-21: "why are there two buttons that do the same thing?"; save-loud.ts). Its way here:
  //   - 2026-10-20 "people won't notice they have to press Save — show a Save button in the game view once something
  //     changed, bottom right, in a colour that stands out": a Save in the game's bottom-right corner (save-fab);
  //   - 2026-10-21 B "make it show at Play too": a second, orange "Save to game" beside ▶ Play — the brief was misread,
  //     so v0.1.9 had the same press twice, and "Save to game" read as a different action;
  //   - now: only the one beside ▶ Play. Play is where a person goes to try the change, so that is where the eye
  //     already is, and it is the one place that is on screen in Edit AND in Play, on a PC, in the side window and on
  //     a phone (the game's corner is under the dock, the card and the list sheet there, and gone while playing).
  // What it is:
  //   - shown only while something is not saved: "Save · 3  ⌘S" (the key on PC and in the side window; a phone has
  //     none); pressing it = Save as always (handOff: the big changes said in words first, then placement.json to the
  //     AI); in the web demo the same (saved in the browser). The word is "Save" on every width — where the change
  //     goes is the tooltip's one sentence;
  //   - KUMO's orange (shell.css .top-save — rule 2's one exception) and one bounce when a change first appears;
  //   - pressed: "✓ Saved" in its place for a moment (SAVE_DONE_MS), then gone, and the quiet "✓ Saved" left of Undo
  //     takes over. Play is right of it and the top bar's right group is aligned right, so Play never moves.
  //   - data-action="save": screen tests read "the first visible [data-action=save]" as the count-carrying Save.
  const topSave = mk(saveBtns, 'save', () => {
    if (topSave.dataset.state === 'done') return;
    void handOff();
  }, { class: 'top-save', hidden: true, dataset: { action: 'save', part: 'save' } });
  // (The strip over the game while playing — "This change isn't in the game yet  [Save]  ×", 2026-10-21 B — went the
  // same day: ▶ Play with changes not saved now asks first, "Save and play / Try without saving" (togglePlay, a try of
  // the editor: "let them choose with buttons"), so once in Play the person has already chosen. Save beside Play stays.)
  const footer = h('div', { class: 'actions', dataset: { part: 'footer' } },
    saveState, mk(undoBtns, 'undo', doUndo, { class: 'icon-btn' }), mk(redoBtns, 'redo', doRedo, { class: 'icon-btn' }));
  // Is the AI there? Said in words next to the ask field, before typing (ai-presence.ts, a hands-on review 2026-10-23). It
  // replaced the top bar's grey "● AI" (2026-10-16 → 10-23), which nobody could read: a dot far from the field, about
  // someone the person may not know is involved. Its hidden second job (press it to bring back the AI's faded reply,
  // 2026-10-20) moved to the field itself: focusing the field brings the reply back (and ⌘K still lists it).
  // One button: pressing it opens one line of what is true and what to do (openHelp below), in every state.
  // Inside the field on a wide bar; on a narrow one (phone, the side window, < PRESENCE_ROOM px left) on its own line above.
  const presence = h('button', { type: 'button', class: 'presence', dataset: { part: 'presence', action: 'ai-presence' }, onclick: () => toggleOpenHelp() },
    h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'p-text' }), h('span', { class: 'p-how' }));
  // Ask while playing on a narrow screen (a phone, the side window; Ive review 3 ④, 2026-10-20): ✦ left of Edit opens
  // the field over the game. The game page's own corner mark sat on the game's words at its foot ("Tap or click the
  // water to sail · WASD works too" in Lantern Cove), and a game's foot is where games put words; the top bar is the
  // editor's own. Moved, not added: the game page draws no corner mark then (play/on `mark: false`), except in full
  // screen where this bar is gone. Undo / Redo step away while playing there (they are disabled in Play anyway) so the
  // bar keeps its room. ✦ is the editor's "ask your AI" sign (the ask field's spark), violet as the AI's hand.
  const playAskBtn = btn('play-ask', () => postGame({ type: 'studio:play/open' }), { class: 'icon-btn play-ask', hidden: true, dataset: { action: 'play-ask', part: 'play-ask' } });
  // Pause while playing (2026-10-22, bridge/play-pause.ts) on the same narrow screens: ❚❚ left of ✦, for the same reason
  // (the game page draws nothing in its corner there). Pressed again while paused (it shows ▶ then), it resumes.
  const playPauseBtn = btn('play-pause', () => postGame({ type: 'studio:play/pause' }), { class: 'icon-btn play-pause', hidden: true, dataset: { action: 'play-pause', part: 'play-pause' } });
  // Play is the only white button on screen, so it is never looked for.
  // Play's ▾ (fast switch, 2026-10-22): Play now goes on in the page on screen, from the layout, and Edit comes back
  // to it without loading — so a game's score, enemies and timers carry on from the last Play's. "Play from the start"
  // is the old Play (a new page), for when they should start again. Here and in ⌘K; a phone has it in ⌘K only (the bar
  // has no room for one more button there, shell.css). One capsule with Play (a split button), so it reads as Play's own.
  const playMoreBtn = btn('play-more', () => openPlayMenu(), { class: 'play-more', dataset: { action: 'play-more', part: 'play-more' }, 'aria-haspopup': 'menu' });
  playMoreBtn.append(icon('chevronDown'));
  const playSplit = h('div', { class: 'play-split' }, mk(playBtns, 'play', () => void togglePlay(), { class: 'play' }), playMoreBtn);
  const topActions = h('div', { class: 'top-actions', dataset: { part: 'top-actions' } }, playPauseBtn, playAskBtn, topSave, playSplit);
  function openPlayMenu() {
    const r = playMoreBtn.getBoundingClientRect();
    ctxMenu.show([{ id: 'play-fresh', label: t('pal.playFresh'), run: () => void togglePlay(true) }], r.right, r.bottom + 4, { place: 'play', label: t('pal.playFresh') });
    // Right-aligned under ▾: the menu's right edge on the button's.
    const m = ctxMenu.el.getBoundingClientRect();
    ctxMenu.el.style.left = `${Math.max(8, Math.round(r.right - m.width))}px`;
  }
  // Pressed with the mouse (or a finger): let go of the focus, so Edit / Play keeps no orange ring (the third design
  // review's ⑩, 2026-10-20). WHY a ring at all after a click: the focus stayed on the button, and the keys pressed next
  // (W A S D in the game, P) went to it — Chrome then shows :focus-visible as if it had been reached with Tab.
  // From the keyboard (Tab then Enter / Space: detail 0) it keeps the focus and the ring, as it should.
  for (const b of playBtns) b.addEventListener('click', (e) => {
    if (e.detail > 0) b.blur();
  });
  // The side window next to a chat (a try on 2026-10-19: "it's hard to use from the sidebar"): one quiet icon at the right of
  // the top bar opens this same editor in a large window — the link with its pass (host.largeLink: the server's pass
  // is a cookie of THIS browser, a bare location.href in another browser got "Missing pass"), plus this page's own
  // query (?ui=off …). Asking the AI and saving work there as here: it is the same server and folder. Shown only in
  // the side window (shell.css [data-fit="side"]): a phone has no larger window, a PC already is one.
  // The link is fetched on the press and handed straight to window.open (the press's activation lasts the fetch);
  // nothing keeps it. A window that could not open → the link is copied, and one line says so.
  const openLarge = async () => {
    const link = (host.largeLink ? await host.largeLink().catch(() => null) : null) || location.href;
    const u = new URL(link, location.href);
    for (const [k, v] of new URLSearchParams(location.search)) if (k !== 't' && !u.searchParams.has(k)) u.searchParams.set(k, v);
    const w = window.open(u.href, '_blank');
    if (w) {
      try {
        w.opener = null;
      } catch {
        /* another origin's window: nothing to cut */
      }
      showToast(t('large.opened'), 5000);
      return;
    }
    const copied = await navigator.clipboard?.writeText(u.href).then(() => true, () => false);
    showToast(t(copied ? 'large.copied' : 'large.failed'), 6000);
  };
  const largeBtn = btn('open-large', () => void openLarge(), { class: 'icon-btn large-btn' });
  // The web demo has no AI to show the state of (W1-6): no "● AI" at all.
  const header = h('header', { class: 'top', dataset: { part: 'header' } }, brand, toolsRow, h('div', { class: 'top-right' }, footer, largeBtn, topActions));
  // World | UI (UI stage 1, layer-switch.ts): the top bar's middle on PC, over the game on a phone (renderAll).
  const layerSwitch = createLayerSwitch((l) => setEditLayer(l), () => setUiPeek(!uiPeek));
  layerSwitch.el.hidden = true;
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
  // (Plan 1's "Grid" button that sat here is gone with the objects' shelf, "one Library" 2026-10-18: Multi-select is
  // back in the head, the Library is the switch's other side.)
  const headTools = h('div', { class: 'side-head-tools' }, sheetMore);
  // The side window's list sheet opens LOW — about four rows, the game keeps at least half the window above it
  // (a try on 2026-10-19: the game was the top quarter, the picked object a speck) — and this grip at its top pulls it up
  // (and back down) for a longer list.
  // A click on it FOLDS the bottom to the ask bar alone, and so does a drag down past the low sheet (sheet-fold.ts; a try
  // of v0.1.7 in the Claude app's side window, 2026-10-21: "the bottom menu has to be able to be minimised" — the grip
  // was there, but a click only switched low ↔ tall and nobody found that). ▴ at the bar's left opens it again, at
  // the height it had. The phone's sheet has the same grip (its old drawn bar, .side::before, is gone): a click or a
  // pull down folds; it does not grow taller (its height is the phone's own, shell.css).
  // The height lives in --studio-sheet-h on the shell; the new inset is sent when the drag ends, so the view slides
  // the picked object over the sheet once, not on every pixel of the drag.
  const sheetGrip = h('div', { class: 'sheet-grip', role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0', dataset: { action: 'sheet-grip' } });
  {
    let from: { y: number; h: number; id: number; moved: boolean } | null = null;
    const tall = () => Math.round(window.innerHeight * 0.72);
    const setH = (px: number | null) => {
      if (px === null) {
        app.style.removeProperty('--studio-sheet-h');
        delete app.dataset.pull;
      } else {
        app.style.setProperty('--studio-sheet-h', `${Math.round(px)}px`);
        app.dataset.pull = 'up';
      }
    };
    sheetGrip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      from = { y: e.clientY, h: side.offsetHeight, id: e.pointerId, moved: false };
      sheetGrip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    sheetGrip.addEventListener('pointermove', (e) => {
      if (!from || e.pointerId !== from.id) return;
      const dy = from.y - e.clientY;
      if (!from.moved && Math.abs(dy) < 4) return;
      from.moved = true;
      // (CSS clamps it: never under the low sheet, never over the top bar.) The phone's sheet keeps its own height.
      // Over the card or the motion (the grip sits on the dock then, renderSheet) there is no list to resize: a pull
      // down still folds (gripEnd), a pull up does nothing.
      if (sideWin() && side.contains(sheetGrip)) setH(from.h + dy);
    });
    const end = (e: PointerEvent) => {
      if (!from || e.pointerId !== from.id) return;
      const f = from;
      from = null;
      const onDock = !side.contains(sheetGrip);
      const to = onDock ? (!f.moved || f.y - e.clientY <= -FOLD_DRAG ? 'fold' : 'tall') : gripEnd({ moved: f.moved, fromH: f.h, dy: f.y - e.clientY, nowH: side.offsetHeight });
      if (to === 'fold') {
        // Pulled down: the sheet unfolds at the height it was pulled from, not at the drag's last pixel.
        if (f.moved && !onDock) setH(f.h > lowH() + 2 && sideWin() ? f.h : null);
        foldBottom(false);
        return;
      }
      // Dragged down to the low sheet (CSS held it there): the low sheet again, which follows the window's size.
      if (to === 'low') setH(null);
      requestAnimationFrame(() => {
        sendInset();
        thumbsSoon(false);
      });
    };
    // The low sheet's height (the pull-up's CSS floor), read with the pull taken off for a moment.
    const lowH = () => {
      const pull = app.style.getPropertyValue('--studio-sheet-h');
      if (!pull) return side.offsetHeight;
      app.style.removeProperty('--studio-sheet-h');
      const h = side.offsetHeight;
      app.style.setProperty('--studio-sheet-h', pull);
      return h;
    };
    sheetGrip.addEventListener('pointerup', end);
    sheetGrip.addEventListener('pointercancel', end);
    // Keys: Enter / Space fold (as a click); ↑ pulls it tall (side window); ↓ takes a tall sheet low, a low one folds.
    sheetGrip.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      if (e.key === 'ArrowUp') {
        if (sideWin()) setH(tall());
      } else if (e.key === 'ArrowDown' && app.dataset.pull === 'up') setH(null);
      else {
        foldBottom(true);
        return;
      }
      requestAnimationFrame(() => sendInset());
    });
  }
  // (Named: the grip is the column's first child now, and renderAll puts the Scene | Library switch back in here.)
  const sideHead = h('div', { class: 'side-head' }, tabs, headTools);
  const side = h('aside', { class: 'side', dataset: { part: 'side' } }, sheetGrip, sideHead, status, panel,
    h('div', { class: 'side-foot' }, noNameSlot, paletteFoot));
  // Phone: the list opens from the ask bar's left end, as a sheet from the bottom. While the list or the card is up this
  // button is ▾ and folds the whole bottom (sheet-fold.ts barPress: the list, the card and the AI's line — before
  // 2026-10-21 it closed the list only, and the card stood on over half the game); folded, it is ▴ and opens the list
  // (and the card) again.
  const sheetBtn = btn('sheet', () => {
    const act = barPress({ fold: fold && phone(), open: sheetOpen || cardUpNarrow() });
    if (act === 'fold') {
      foldBottom(false);
      return;
    }
    if (act === 'unfold') {
      setFold(false);
      // Something picked: ▴ brings the sheet back on its card (the sheet shows one thing at a time since plan step 7;
      // its Scene tab is one press away). Nothing picked: the list, as before.
      if (group.length > 1 || selected) {
        sheetOpen = false;
        renderAll(true);
        return;
      }
    }
    sheetOpen = true;
    page = 'tool';
    // From the Library the list button brings the Scene's list (the game and its list).
    if (sheetOpen && tool === 'library') tool = 'placement';
    renderAll(true);
  }, { class: 'icon-btn' });
  /** Fold / unfold, kept in this browser (sheet-fold.ts). No render: the caller renders. */
  function setFold(on: boolean) {
    fold = on;
    writeFold(handStore, on);
  }
  /** Fold the bottom to the ask bar (the grip, ▾). From the keyboard the focus goes to ▴, the way back. */
  function foldBottom(byKey: boolean) {
    if (!phone()) return;
    setFold(true);
    sheetOpen = false;
    // Look / Ideas live in the sheet: folding it leaves them for the Scene.
    if (page !== 'tool') page = 'tool';
    renderAll(true);
    if (byKey) sheetBtn.focus();
  }
  /** The picked object's card stands over the bar (phone / side window; not over the Library, which hides it). */
  const cardUpNarrow = () => phone() && tool !== 'library' && !placementPanel.cardEl.hidden && cardSlot.contains(placementPanel.cardEl);
  /** The bar's left button: ▴ folded; ▾ with the list or the card up; the list icon with nothing up. */
  function renderSheetBtn() {
    const folded = fold && phone();
    const open = !folded && (sheetOpen || cardUpNarrow());
    const want = folded ? 'up' : open ? 'down' : 'list';
    if (sheetBtn.dataset.state !== want) {
      sheetBtn.dataset.state = want;
      setButton(sheetBtn, folded ? 'chevronUp' : open ? 'chevronDown' : 'list', folded ? t('sheet.unfold') : open ? t('sheet.fold') : t('btn.list'), false);
    }
    sheetBtn.setAttribute('aria-expanded', String(open));
  }
  /**
   * The one line and the sheet's tabs (plan step 7; introLine and sheetTabs say why). Called wherever the pick, the
   * sheet or the timeline may have changed: renderAll, placeTimeline, the two selection paths and the game's own pick.
   * Idempotent: it moves elements only when they are not where they should be (a ResizeObserver on the dock calls back).
   */
  function renderSheet() {
    const picked = group.length > 1 || !!selected;
    // ---- the one line ----
    // "This game": the game folder's ui prefs (.studio/ui/prefs.json `seen`), not this browser's storage — the studio
    // opens on a free port, so the browser alone would show it again each run, and another game on this machine is a
    // new first time (hintSeen keeps both; this one wants the game's only). Waits for the prefs (prefsLoaded) so a
    // game that has seen it does not flash it while they load. No AI behind the web demo (host.offline): the line
    // would promise one, so it is not shown there.
    if (picked && prefsLoaded && !uiPrefs.seen?.includes(INTRO_SEEN)) changeUi({ ...uiPrefs, seen: [...(uiPrefs.seen ?? []), INTRO_SEEN] });
    const intro = !host.offline && prefsLoaded && !uiPrefs.seen?.includes(INTRO_SEEN) && !picked && editing && !playing && tool === 'placement' && page === 'tool';
    if (introLine.hidden === intro) introLine.hidden = !intro;
    if (intro && introLine.textContent !== t('intro.line')) introLine.textContent = t('intro.line');
    // ---- the sheet's tabs (phone / side window, something picked, the bottom not folded) ----
    const shown = phone() && picked && editing && !playing && tool === 'placement' && page === 'tool' && !fold;
    const motionOn = shown && timeline.isOpen() && !timeline.el.hidden;
    // The Motion tab only for an object that has a motion: making one is the strip's Motion (the plan's "one way in",
    // motion-card.ts), so an empty Motion tab would be a second door with nothing behind it.
    // (Or the timeline already open on it: "Make a motion" opens it before the first point exists.)
    const hasMotion = motionOn || (shown && editLayer === 'world' && group.length <= 1 && !!selected && !!timeline.shownName(selected));
    // The timeline opened from elsewhere (the strip's Motion, the card's Motion row) while the list was up: the motion
    // takes the sheet, the list steps back (one thing at a time).
    if (motionOn && sheetOpen) {
      sheetOpen = false;
      app.dataset.sheet = 'closed';
    }
    const on: '' | 'scene' | 'pick' | 'motion' = !shown ? '' : motionOn ? 'motion' : sheetOpen ? 'scene' : 'pick';
    if (on) app.dataset.sheetTab = on;
    else delete app.dataset.sheetTab;
    sheetTabs.hidden = !on;
    // The tabs (and the grip) head whichever plate is up: the list sheet for the Scene, the dock for the card / motion.
    const home = on === 'scene' ? side : dock;
    const before = on === 'scene' ? sideHead : dock.querySelector(':scope > .timeline') ?? cardSlot;
    if (on && (sheetTabs.parentElement !== home || sheetTabs.nextSibling !== before)) home.insertBefore(sheetTabs, before);
    const gripHome = on && on !== 'scene' ? dock : side;
    if (sheetGrip.parentElement !== gripHome) gripHome.insertBefore(sheetGrip, on && on !== 'scene' ? sheetTabs : gripHome.firstChild);
    if (!on) return;
    const pickName = group.length > 1 ? t('undo.n', { n: group.length }) : (() => {
      const it = items.find((i) => i.key === selected);
      return it ? displayName(it, t) : selected || '';
    })();
    const want: Array<['scene' | 'pick' | 'motion', string]> = [['scene', t('tool.placement')], ['pick', pickName]];
    if (hasMotion) want.push(['motion', t('motion.label')]);
    const sig = `${on}|${want.map((w) => w.join(':')).join('|')}|${lang}`;
    if (sheetTabs.dataset.sig === sig) return;
    sheetTabs.dataset.sig = sig;
    sheetTabs.setAttribute('aria-label', t('sheet.tabs'));
    sheetTabs.replaceChildren(...want.map(([id, label]) => h('button', { type: 'button', role: 'tab', class: 'sheet-tab', 'aria-selected': String(on === id), dataset: { tab: id }, title: label,
      onclick: () => pickSheetTab(id) }, h('span', { class: 'label', text: label }))));
  }
  /** A tab pressed: the list (Scene), the card, or the motion's timeline — one at a time. */
  function pickSheetTab(id: 'scene' | 'pick' | 'motion') {
    sheetOpen = id === 'scene';
    if (id === 'motion') timeline.setOpen(true);
    else if (timeline.isOpen()) timeline.setOpen(false);
    renderAll(true);
  }
  /** A page the person asked for in the sheet (Look, Ideas, the Library, the Scene): it unfolds. */
  const unfoldFor = () => {
    if (fold && phone()) setFold(false);
  };
  // News over the ask bar, one card, one place: a toast (copy failed…), the
  // AI line (handed over → picked up → done, with "Show" / "Reload"), the ask
  // box's own note and "playing".
  // The first-run tips that sat here ("1/4 Click an object…" → "2/4 drag it" → …,
  // intro.ts) were removed on 2026-10-17 after a try of the web demo: "I don't
  // need this". The editor should open on the game alone. Don't bring back a
  // step-by-step tour here without asking.
  const playNote = h('p', { class: 'play-note', hidden: true });
  // "How to open" (and what each presence means): one line the person opened with the presence words, and closes. It
  // replaced "Call your AI" (2026-10-19 → 10-23), which copied a word to the clipboard without saying why — the
  // quietest "nothing happened" of all. The word ("look") is still there, as a chip that copies on a press and says so.
  const openHelp = h('div', { class: 'ai-open-help', dataset: { part: 'ai-open' }, hidden: true });
  const caption = h('div', { class: 'ai-caption', hidden: true }, toastEl, aiLine, openHelp, playNote);
  // The narrow bar's line for the presence words (above the field; the field keeps its whole width for the words).
  const presenceRow = h('div', { class: 'presence-row', hidden: true });
  // The web demo (host.offline) has nothing in the ask box's place: the slot stays empty and hidden (see renderAll).
  const askSlot = h('div', { class: 'ask-slot', hidden: !!host.offline });
  const bar = h('div', { class: 'bar', dataset: { part: 'bar' } }, sheetBtn, askSlot);
  // Phone: the picked object's card sits right above the ask bar (thumb's reach).
  const cardSlot = h('div', { class: 'card-slot' });
  // What this tool is, in ONE line under the game, over the ask field (plan step 7, 2026-10-23; a try of the editor that day: "the
  // experience makes no sense at all" — the screen never said what the tool is for, plan 01-journey #1). Shown only
  // until the first pick, then never again in this game (renderSheet). Not a tour: the step-by-step tips were taken out
  // on 2026-10-17 ("I don't need this", see the caption's comment) and this is not them coming back — one line, no
  // steps, nothing to press. The words were picked for the plan's "decide 1" and kept after a wording check.
  const introLine = h('p', { class: 'intro-line', dataset: { part: 'intro-line' }, hidden: true });
  // Phone / side window: the one sheet's tabs — Scene | <the picked object> | Motion (plan step 7; a try in the side window, 10/21: "it's
  // too hard to use from the Claude sidebar — the bottom menu has to be able to be minimised"). Before, the foot was
  // four blocks stacked over the game: the AI's reply, "● Claude is watching", the card and the field (shots
  // now-ja-35-side-pick). Now the sheet shows ONE of the list, the card or the motion, the field at its foot; the
  // reply floats over the game's top and the presence is a dot in the field. renderSheet says which tab is on.
  const sheetTabs = h('div', { class: 'sheet-tabs', role: 'tablist', dataset: { part: 'sheet-tabs' }, hidden: true });
  const dock = h('section', { class: 'ask-strip dock' }, caption, cardSlot, h('div', { class: 'palette-slot' }), introLine, presenceRow, bar);
  // (introLine over presenceRow: the presence words on a narrow PC bar belong to the field, so they stay on it.)
  const stage = h('div', { class: 'stage', dataset: { part: 'stage' } }, iframe, scrim, assetsPage, inspector, dock, levelNote);
  const app = h('div', { class: 'shell', dataset: { part: 'app' } }, header, side, stage);
  document.getElementById('app')!.replaceWith(app);
  panel.append(toolEl);
  // Every shortcut in one sheet over the game (? / the ⌘K row), the game dimmed behind it like ⌘K; and the
  // buttons' own tooltips with their key (basics pass, 2026-10-18).
  const keysScrim = h('div', { class: 'scrim keys-scrim', hidden: true, onpointerdown: () => keySheet.hide() });
  let keysFocus: HTMLElement | null = null;
  const keySheet = createShortcutSheet({
    t: (k) => t(k),
    mac: isMac,
    dim: () => dim,
    hasUi: () => !!editLayers && editLayers.length > 1,
    hasLevels: () => levels.active,
    playing: () => playing && !host.offline,
    changed: (on) => {
      keysScrim.hidden = !on;
      app.dataset.keys = on ? 'open' : 'closed';
      // Back to where the keys were typed (the list, a button), so the next key works there as before.
      if (on) keysFocus = document.activeElement as HTMLElement | null;
      else if (keysFocus?.isConnected) keysFocus.focus({ preventScroll: true });
    },
  });
  stage.append(keysScrim, keySheet.el);
  // The window ⌘K's Editor view / Ideas for your AI open in on PC (studio-card-doors; renderAll fills it).
  const pagePlate = h('div', { class: 'page-window-plate' });
  const pageWin = h('div', { class: 'page-window', hidden: true, role: 'dialog', dataset: { part: 'page-window' } }, pagePlate);
  pageWin.addEventListener('pointerdown', (e) => {
    if (e.target === pageWin) switchTool(tool);
  });
  stage.append(pageWin);
  // The place's menu (right-click / long press; context-menu.ts): over everything, the game frame included.
  const ctxMenu = createContextMenu({
    phone: () => phone(),
    changed: (on, place) => {
      app.dataset.menu = on ? place || 'open' : 'closed';
      // The phone's camera ↑↓ step aside while a menu is up (sendInset).
      sendInset();
      // The strip's Motion button looks pressed while its menu is up.
      motionTool.sync();
    },
  });
  app.append(ctxMenu.catcher, ctxMenu.el);
  // The level in the top bar's path (level-switch.ts); what its rows do is below (goLevel and the rest).
  const levelSwitch = createLevelSwitch({
    t,
    levels,
    keyOf: (id) => (phone() ? '' : keyOf(id, isMac())),
    // Under the crumb from its left edge, for a finger too; where there is no room below, above it — never over it
    // (a menu moved up to fit covered the crumb that says which level it is about).
    openMenu: (entries, head) => {
      ctxMenu.show(entries, head.left, head.bottom + 2, { place: 'levels', label: t('level.menu') });
      const m = ctxMenu.el.getBoundingClientRect();
      if (m.top < head.bottom && m.bottom > head.top) ctxMenu.el.style.top = `${Math.max(8, Math.round(head.top - m.height - 4))}px`;
    },
    go: (id) => void goLevel(id),
    blank: () => void addLevel('blank'),
    copy: () => void addLevel('copy'),
    rename: (id, label) => levelsChanged(levels.rename(id, label)),
    move: (id, by) => levelsChanged(levels.move(id, by)),
    remove: (id) => {
      const next = levels.remove(id);
      if (next) void goLevel(next, false);
      else levelsChanged(next === '');
    },
  });
  // UI stages 2–3 (2026-10-22, ui-wire.ts): the screens' head of the UI list, the card's look rows, the Theme fold.
  const uiWire = createUiWire({
    t,
    send: (m) => send(m),
    push: (e) => undo.push(e),
    changed: () => renderButtons(),
    render: () => tool === 'placement' && page === 'tool' && placementPanel.render(),
    onUi: () => editLayer === 'ui',
    // The same place as the levels' menu: under the head, never over it.
    openMenu: (entries, head) => {
      ctxMenu.show(entries, head.left, head.bottom + 2, { place: 'screens', label: t('uiScreen.list') });
      const m = ctxMenu.el.getBoundingClientRect();
      if (m.top < head.bottom && m.bottom > head.top) ctxMenu.el.style.top = `${Math.max(8, Math.round(head.top - m.height - 4))}px`;
    },
  });
  installTooltips(app);
  // A Library tile dragged onto the Scene row = its "Add to scene" ("use the Library", 2026-10-18). The row is the
  // drop target because the Library covers the game on PC (the game is not on screen to drop on); while a tile is
  // dragged the row says so (grey, like a hover: orange stays the pick). Touch has no drag of this kind: the tile's
  // detail and its long-press menu have the same "Add to scene".
  const dragType = (e: DragEvent) => {
    const ts = e.dataTransfer?.types || [];
    return ts.includes(DRAG_OBJECT) ? DRAG_OBJECT : ts.includes(DRAG_FILE) ? DRAG_FILE : null;
  };
  const sceneRow = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>('[data-tool="placement"]') ?? null;
  document.addEventListener('dragstart', (e) => {
    if (dragType(e)) app.dataset.drag = 'library';
  });
  const dragDone = () => {
    delete app.dataset.drag;
    tabs.querySelector('.drop-on')?.classList.remove('drop-on');
  };
  document.addEventListener('dragend', dragDone);
  tabs.addEventListener('dragover', (e) => {
    const row = sceneRow(e);
    if (!row || !dragType(e) || !editing) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    row.classList.add('drop-on');
    row.title = t('lib.dropScene');
  });
  tabs.addEventListener('dragleave', (e) => {
    const row = sceneRow(e);
    if (row && !row.contains(e.relatedTarget as Node | null)) row.classList.remove('drop-on');
  });
  tabs.addEventListener('drop', (e) => {
    const type = dragType(e);
    if (!sceneRow(e) || !type) return;
    e.preventDefault();
    const v = e.dataTransfer!.getData(type);
    dragDone();
    if (type === DRAG_OBJECT) {
      // The dropped tile's kind, picked or not (a drag is about what is in the hand).
      if (items.some((i) => i.key === v && copyable(i))) addToScene([v]);
      // A "Not in this level" tile (studio-fix-0146): it goes into this level.
      else if (v) placeHere([v]);
    } else if (v) {
      const p = libraryPickedFiles();
      fileUse.add?.(p.includes(v) ? p : [v]);
    }
  });
  // A click on the bare desk drops the pick, the same as a tap on nothing in the game (bridge/input.ts; a web demo try
  // 2026-10-18: "I want to click an empty spot to deselect, and I can't"). Bare = the surface itself, not a row, a
  // button, the card or a field on it: the 8 px margin round the game plate, the empty part of the list column under
  // the rows, the top bar's empty middle, and the see-through gap between the card and the ask bar (phone; a finger
  // there is mostly moved onto the ask field by the browser, a mouse is not). `click`, not pointerdown: a press that ends somewhere else (a drag out
  // of the list) is not a click on nothing.
  // The Library's own empty space (around and between the tiles) is bare too: the same click drops the objects' pick there.
  const BARE = '.shell, .top, .top-right, .side, .side-head, .side-foot, .panel, .placement, .tool-body, .list-scroll, .objects, .stage, .dock, .card-slot, .assets-page .gsl, .assets-page .gsl-grid';
  app.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (!t || !t.matches(BARE) || !editing || playing || !(selected || group.length)) return;
    selectObject(null);
  });
  // The news card shows when one of its lines has something to say.
  // Shown = not hidden AND drawn: the ask box's "Sent to your AI" note keeps its text but shell.css hides it once the AI
  // line takes over (.shell[data-ai] .ask-note); counted as shown, it left an empty frosted card after the AI's line
  // faded (line-fade.ts, 2026-10-20).
  const captionShows = (c: Element) => !(c as HTMLElement).hidden && (!c.classList.contains('toast') || c.classList.contains('on')) && getComputedStyle(c).display !== 'none';
  const updateCaption = () => {
    const any = [...caption.children].some(captionShows);
    if (caption.hidden === any) caption.hidden = !any;
    // Folded, the AI's line is not shown (shell.css): a dot on ▴ says it has something to read (sheet-fold.ts).
    const news = fold && phone() && !aiLine.hidden && !!aiLine.textContent?.trim();
    if ((sheetBtn.dataset.news === 'on') !== news) {
      if (news) sheetBtn.dataset.news = 'on';
      else delete sheetBtn.dataset.news;
    }
  };
  new MutationObserver(updateCaption).observe(caption, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });

  const phone = () => window.innerWidth <= UI.phoneMaxWidth;
  // The side window next to a chat (the Claude app's browser pane, ~360–480 wide): the phone layout, but a desktop
  // window driven by a mouse, under the chat app's own toolbar at its foot. Told from a phone by the pointer, not
  // the size (a 400×900 pane and a 390×844 phone are the same size). It gets the mouse's sizes (rows 32, strip 28
  // instead of a finger's 44), a lower list sheet the game keeps half the window over, a grip to pull the sheet up,
  // its 48 px foot left to the chat app's toolbar, and "Open large" (a try on 2026-10-19).
  const sideWin = () => phone() && !!window.matchMedia?.('(pointer: fine)').matches;
  // Strip button size sent to the game: the person's choice, but never below
  // 44 px on a phone (a 28 px button is right for a mouse, small for a finger).
  // The side window keeps the mouse's size (its strip and ↑↓ took a finger's 44 px over a game 400 px wide).
  const handlePx = () => (phone() && !sideWin() ? Math.max(UI.handlePxPhone, uiPrefs.handleSize) : uiPrefs.handleSize);
  // What the floating panels cover, so the tool strip and "bring into view" stay clear of them.
  let insetSent = '';
  const sendInset = () => {
    const sr = stage.getBoundingClientRect();
    const inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
    // The bar and, on a phone, the card above it (the news card comes and goes: not counted).
    // (Folded, the card is hidden by CSS but not [hidden]: it does not count.)
    // (cardSlot.offsetHeight: the Scene / Motion tab hides the card slot by CSS — plan step 7 — and a slot not drawn
    // measures top 0, which made the list sheet's foot padding the whole window.)
    let top = phone() && !(fold && phone()) && !placementPanel.cardEl.hidden && cardSlot.contains(placementPanel.cardEl) && cardSlot.offsetHeight > 0 ? cardSlot.getBoundingClientRect().top : bar.getBoundingClientRect().top;
    // Plan step 7: the sheet's grip and tabs head the dock's plate over the card / the motion — they cover the game too.
    if (phone() && dock.contains(sheetGrip) && sheetGrip.offsetParent) top = Math.min(top, sheetGrip.getBoundingClientRect().top);
    if (!dock.hidden && dock.offsetParent) inset.bottom = Math.max(0, Math.round(sr.bottom - top + 8));
    // The phone's list sheet pads its foot by what the bar and the card cover (shell.css --studio-cover):
    // the card's height differs (2D Layer row, the open numbers), so it is measured, not guessed.
    if (phone() && !dock.hidden && dock.offsetParent) {
      const cover = `${Math.max(0, Math.round(window.innerHeight - top))}px`;
      if (app.style.getPropertyValue('--studio-cover') !== cover) app.style.setProperty('--studio-cover', cover);
    }
    // A phone's list sheet, and its Assets sheet, cover the lower part of the game.
    // (Its final height, not its rect: it may still be sliding up.)
    // (The sheet's own gap to the window's foot: 8, 48 in the side window.)
    const sideFoot = parseFloat(getComputedStyle(side).bottom) || 8;
    if (phone() && (sheetOpen || page !== 'tool') && !playing) inset.bottom = Math.max(inset.bottom, Math.round(sr.bottom - (window.innerHeight - sideFoot - side.offsetHeight) + 8));
    if (phone() && tool === 'library' && !assetsPage.hidden) inset.bottom = Math.max(inset.bottom, Math.round(sr.bottom - assetsPage.getBoundingClientRect().top));
    // Phone: the camera's ↑↓ only with nothing else up (the second design review's ⑧, 2026-10-19). With the card, a
    // sheet (the list, the Library, Look / Ideas) or a menu up they were a third thing stacked at the foot: the tool's
    // hint line cut ↑, the card pushed them 72 px up, and they floated over the Library. Gone then, back after; PC keeps
    // them (a 28 px box in the corner that nothing covers).
    if (phone()) {
      const cardUp = !fold && !placementPanel.cardEl.hidden && cardSlot.contains(placementPanel.cardEl);
      const sheetUp = (sheetOpen || page !== 'tool') && !playing;
      const libraryUp = tool === 'library' && !assetsPage.hidden;
      const menuUp = !!app.dataset.menu && app.dataset.menu !== 'closed';
      // Something picked, the bottom folded (studio-fix-0139, 2026-10-23): the card is gone but the pick's strip is
      // still over the game, and the ↑↓ came back beside it — "the ↑↓ show even while something is picked". The rule is
      // the pick, not the card: ↑↓ only with nothing picked (E / Q are the same: they fly only with nothing picked).
      const pickUp = !!selected || group.length > 0;
      if (cardUp || sheetUp || libraryUp || menuUp || pickUp) inset.camera = false;
    }
    const card = placementPanel.cardEl;
    if (!phone() && !card.hidden && card.isConnected && card.offsetParent) {
      const cr = card.getBoundingClientRect();
      inset.right = Math.max(0, Math.round(sr.right - cr.left + 8));
      inset.rightTo = Math.round(cr.bottom - sr.top + 8);
    }
    // studio-fix-0143 (⑨ B, a review of 2026-10-24): the timeline plate is up — the bridge then keeps every size when it
    // shows a pick (a slide, no pull back), and asks an open plate to fold to its line first (core/plate-fold).
    if (!timeline.el.hidden && timeline.isOpen()) inset.plate = timeline.isSlim() ? 'slim' : 'open';
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const k = JSON.stringify([inset, theme, handlePx()]);
    if (k === insetSent) return;
    insetSent = k;
    send({ type: 'studio:core/ui', handlePx: handlePx(), inset, theme });
  };
  new ResizeObserver(() => {
    sendInset();
    // fix-0141 (⑪ of the first-run check, 2026-10-24): the Library's grid leaves room for the dock as tall as it is now
    // (shell.css .gsl-grid). It left a fixed 96 px, and the dock with the AI's line and presence over the field is three
    // rows: the last row of tiles (neon's second motion, Lantern Cove's three lighthouses) sat under it, names covered.
    const dh = `${Math.round(dock.offsetHeight)}px`;
    if (app.style.getPropertyValue('--dock-h') !== dh) app.style.setProperty('--dock-h', dh);
  }).observe(dock);
  /**
   * Where the timeline plate goes (studio-timeline): PC, at the foot of the game across its width, the ask bar lifted
   * over it (--tl-h); a phone / the side window, in the dock right above the picked object's card (one stack at the
   * thumb's reach, as the card itself). Shown only while the timeline can be used (timeline-wire.ts usable).
   */
  function placeTimeline() {
    const el = timeline.el;
    if (phone()) {
      if (el.parentElement !== dock || el.nextSibling !== cardSlot) dock.insertBefore(el, cardSlot);
    } else if (el.parentElement !== stage) stage.append(el);
    timeline.render();
    renderSheet();
    const on = !el.hidden;
    const was = app.dataset.timeline;
    app.dataset.timeline = on ? 'open' : 'closed';
    // fix-0140 ④: the AI field is one row or two depending on the timeline (renderPresence) — redrawn when it opens / closes.
    if (was !== undefined && was !== app.dataset.timeline) (renderPresence(), renderAiLine());
    const hgt = on && !phone() ? `${el.offsetHeight}px` : '0px';
    if (app.style.getPropertyValue('--tl-h') !== hgt) app.style.setProperty('--tl-h', hgt);
    sendInset();
  }
  new ResizeObserver(() => placeTimeline()).observe(timeline.el);

  // The game's code layouts on the card, in the list and in the game (studio-code-knobs, 2026-10-24; code-place-wire.ts):
  // the card's Layout and its knobs, a drag that turns a knob, "Manually overridden", "Place individually".
  const codePlaces = createCodePlaceWire({
    t,
    list: () => codePlaceList,
    store: () => worldModel.places,
    codePoses: (poses) => worldModel.codePoses(poses),
    pose: (k) => worldModel.pose(k),
    dim: () => worldDim,
    send: (m) => send(m),
    commit: (id, from, to) => setPlace(id, from, to),
    changed: (card) => {
      if (card) placementPanel.render();
      renderButtons();
    },
    told: (text) => showToast(phone() ? t('hands.undoTouch', { text }) : t('hands.undo', { text, key: keyOf('undo', isMac()) }), 6000),
    selected: () => (editLayer === 'world' ? selected : null),
    group: () => (editLayer === 'world' ? group : []),
    editing: () => editing && !playing && editLayer === 'world',
    // ✦ Turn into a rule (studio-code-torule): the hand objects a layout replaced, while its `from` still names them.
    compare: (id) => ruleCompare.place(levelNow(), id, worldModel.places.get(id)?.from),
    compareOn: () => ruleCompare.show,
    setCompareOn: (on) => setCompareShown(on),
    guided: (force) => keepOut.sync(force),
  });
  // Keep-out areas under a rule layout's block (studio-code-keepout, 2026-10-24; keep-out-wire.ts): the list, the boxes
  // drawn on the ground (bridge/keep-out.ts), the conditions' knobs and ◇, "✦ Describe with text".
  const keepOut = createKeepOutWire({
    t,
    list: () => codePlaceList,
    avoids: () => codeAvoidList,
    store: () => worldModel.places,
    send: (m) => send(m),
    commit: (id, from, to) => setPlace(id, from, to),
    layout: (ids) => codePlaces.layout(ids),
    changed: (card) => {
      if (card) placementPanel.render();
      renderButtons();
    },
    told: (text) => showToast(phone() ? t('hands.undoTouch', { text }) : t('hands.undo', { text, key: keyOf('undo', isMac()) }), 6000),
    selected: () => (editLayer === 'world' && group.length <= 1 ? selected : null),
    editing: () => editing && !playing && editLayer === 'world',
    ask: host.offline ? undefined : (id) => {
      keepOutAsk = selected ? { id, key: selected } : null;
      focusAsk();
    },
    menu: (at, rows) => {
      const r = at.getBoundingClientRect();
      ctxMenu.show(rows, r.right, r.bottom + 4, { place: 'card', label: t('keepout.title') });
      const m = ctxMenu.el.getBoundingClientRect();
      ctxMenu.el.style.left = `${Math.max(8, Math.round(r.right - m.width))}px`;
    },
  });
  // "✦ Describe with text" was pressed for this layout while this object was picked: the ask is about its keep-out areas
  // (the chips "crystal ×12" "Keep-out areas", `places` + `intent: 'avoid'` in the request) until the pick moves on.
  let keepOutAsk: { id: string; key: string } | null = null;
  const keepOutAskNow = () => {
    if (keepOutAsk && (editLayer !== 'world' || selected !== keepOutAsk.key || !codePlaces.layoutOf(keepOutAsk.key))) keepOutAsk = null;
    return keepOutAsk;
  };
  /** The card's rule block for `k`: the layout's (code-place-wire.ts), then its keep-out areas / "Inside a keep-out area". */
  function ruleCard(k: string) {
    const c = codePlaces.card(k);
    if (!c) return null;
    if (!c.numbers) {
      const b = keepOut.block(k);
      if (b) c.els.push(b);
    } else {
      const line = keepOut.pinnedLine(k);
      if (line && c.els[0]) c.els[0].append(line);
    }
    return c;
  }
  /** One change of a code layout's `places` entry: one undo step, laid out in the game (studio-code-base's setPlace). */
  function setPlace(id: string, from: PlacementPlace | null, to: PlacementPlace | null) {
    worldModel.places.set(id, to);
    const now = worldModel.places.get(id);
    if (JSON.stringify(from) === JSON.stringify(now)) return void placesChanged();
    undo.push({ changes: [{ kind: 'code-place', key: id, from, to: now }] });
    placesChanged(swapsHand(from, now));
  }
  /**
   * A layout took the place of hand-placed objects, or gave it back (`from`: the AI's place.code --replace, its ⌘Z): only
   * the game's loader hides / shows those, so the game reads the draft again then (as every change did before).
   */
  const swapsHand = (a: PlacementPlace | null, b: PlacementPlace | null) => JSON.stringify(a?.from ?? null) !== JSON.stringify(b?.from ?? null);

  // ----- tools -----
  const placementPanel = createPlacementPanel({
    t,
    uiHead: () => uiWire.head(),
    uiLook: (k) => uiWire.look(k),
    uiFoot: () => uiWire.foot(),
    // A mouse over a row, the card or the ask chip lights those objects in the game (a hands-on try, 2026-10-19).
    hover: (keys) => {
      if (!editing) return;
      send({ type: 'studio:placement/hover', keys });
      // …and the violet rings of their code layout (studio-code-knobs: a row of the list tells a rule's object).
      if (editLayer === 'world') codePlaces.hover(keys);
    },
    items: () => items,
    selected: () => selected,
    // With the timeline open, the numbers are how the object stands at the time line (its place + its motion).
    pose: (k) => (editLayer === 'world' ? timeline.shownPose(k) : model.pose(k)),
    dim: () => dim,
    thumb: (k) => thumbs.get(k) || null,
    select: (k, add) => (add || multi ? toggleSelect(k) : selectObject(k, true)),
    selectMany: (keys, primary) => selectMany(keys, primary),
    group: () => group,
    multi: () => multi,
    setMulti: (on) => setMulti(on),
    rename: (k, name) => renameObject(k, name),
    copy: () => copySelection(),
    remove: () => removeSelection(),
    shortcutOf: (what) => shortcutText(what),
    phone: () => phone(),
    setPose: (k, pose) => {
      // The timeline open with auto key on: a typed number is a key at the time line (timeline-wire.ts).
      const shown = editLayer === 'world' ? timeline.shownPose(k) : undefined;
      if (shown && timeline.card(k, pose, shown)) return;
      if (editLayer === 'world') pose = timeline.placeFor(k, pose);
      // An object of a code layout (studio-code-knobs): a number typed is its pin (one put by hand), never a move.
      if (editLayer === 'world' && codePlaces.setPose(k, pose)) return;
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
      if (editLayer === 'world' && timeline.card(k, pose, from, !end)) return;
      if (editLayer === 'world') (pose = timeline.placeFor(k, pose)), (from = timeline.placeFor(k, from));
      // A code layout's object (studio-code-knobs): live to the game, then its pin (one undo step).
      if (editLayer === 'world' && codePlaces.layoutOf(k)) {
        send({ type: 'studio:placement/pose', key: k, pose });
        if (end) codePlaces.setPose(k, pose);
        else (worldModel.codePoses([{ key: k, pose }]), placementPanel.updateNumbers());
        return;
      }
      if (!end) {
        model.moved(k, pose);
        send({ type: 'studio:placement/pose', key: k, pose });
        placementPanel.updateNumbers();
        return;
      }
      if (!undo.push(poseChange(k, from, pose))) model.moved(k, from);
      applyPose(k, pose);
    },
    // While the AI waits for an answer, the field answers it (hands-on test 2026-10-19).
    ask: (keys, text, files) => {
      if (answering()) return answerAi(text);
      // ✦ Turn into a rule (studio-code-torule): the words were for the hand's shape on screen — the AI swaps a rule in.
      const toRule = toRuleNow(keys);
      if (toRule) toRuleAsk = null;
      return askAi({ kind: 'ask', text, objects: requestObjects(keys), ...(files.length ? { assets: files } : {}), ...requestMotions(toRule === 'motion'), ...(toRule ? { intent: 'to-code' as const } : requestPlaces()) });
    },
    answering: () => answering(),
    // The field's one placeholder (studio-words-plan, 2026-10-23): "Ask Claude…" whether or not Claude is there — the
    // presence words beside the field say that (it was "Write a note for Claude…" when unsure, a second wording).
    askGame: () => t('ask.game', host.offline ? {} : aiVars()),
    askName: (keys) => askAi({ kind: 'name', text: '', objects: requestObjects(keys) }),
    nameDraft: host.offline ? undefined : (keys) => nameDraft(keys),
    // Only while the Library is on screen: back in the Scene the words are about what is picked there.
    assets: () => (libraryShown() ? filePick : []),
    // …or, in the Scene, the motion "Ask AI" was pressed on (the chip reads "crate · Hop", motion-ask.ts).
    motions: () => (libraryShown() ? libraryMotions.picked() : motionAsk.now() ? [motionAsk.now()!.name] : []),
    // "✦ Describe with text" under keep-out areas (studio-code-keepout): the chips "crystal ×12" "Keep-out areas".
    askTopic: () => {
      const at = libraryShown() ? null : keepOutAskNow();
      return at ? { chip: keepOut.chip(at.id), tag: t('keepout.chip'), ph: t('keepout.askPh') } : null;
    },
    showInLibrary: libraryTool ? () => showInLibrary() : undefined,
    unhold: (keys) => send({ type: 'studio:placement/unhold', keys }),
    // The card's ⋯ (studio-card-doors): the same menu plate as right-click, opened under the button, its right edge on
    // the button's (the card sits at the game's right edge).
    cardMenu: (at, rows) => {
      const r = at.getBoundingClientRect();
      ctxMenu.show(rows.map((x) => ({ id: x.id, label: x.label, run: () => x.run() })), r.right, r.bottom + 4, { place: 'card', label: rows.map((x) => x.label).join(' · ') });
      const m = ctxMenu.el.getBoundingClientRect();
      ctxMenu.el.style.left = `${Math.max(8, Math.round(r.right - m.width))}px`;
    },
    // ⌘] / ⇧⌘[ … (Ctrl elsewhere), from the one table (keymap.ts).
    shortcut: (op) => keyOf(op, isMac()),
    // studio-motion-delete (2026-10-24): the Motion row's right-click / ⋯ menu — the ⋯'s plate like cardMenu's (under it,
    // right edges together), a right-click's at the pointer; it holds Delete back (that key deletes the OBJECT).
    // A code layout's object (studio-code-knobs): the card's Layout and knobs, or "Manually overridden"; the list's tag.
    layout: (k) => (editLayer === 'world' ? ruleCard(k) : null),
    ruleTag: (k) => (editLayer === 'world' ? codePlaces.listTag(k) : null),
    ruleRows: (k) => (editLayer === 'world' ? codePlaces.rows(k) : []),
    // ✦ Turn into a rule (studio-code-torule): several hand-placed objects picked → the draft in the chat box.
    toRule: (keys) => toRuleFor(keys),
    // …and the hand objects a rule layout took the place of are not listed while it does (they are hidden in the game).
    replaced: (k) => editLayer === 'world' && codePlaceList.some((p) => worldModel.places.get(p.id)?.from?.includes(k) && !p.keys.includes(k)),
    motion: (k) => timeline.cardRow(k, {
      menu: (at, entries) => {
        const o = { place: 'card-motion', label: t('motion.label'), holdDelete: true };
        if (!(at instanceof HTMLElement)) return ctxMenu.show(entries, at.x, at.y, o);
        const r = at.getBoundingClientRect();
        ctxMenu.show(entries, r.right, r.bottom + 4, o);
        const m = ctxMenu.el.getBoundingClientRect();
        ctxMenu.el.style.left = `${Math.max(8, Math.round(r.right - m.width))}px`;
      },
      say: (text) => showToast(text),
      undoKey: keyOf('undo', isMac()),
    }),
  });

  // ----- the objects in the Library (library-objects.ts, "one Library" 2026-10-18) -----
  // Object → files, read once per game page (and again after the object list changes: copies use their original's
  // files). Cleared in loadGame and on every new object list.
  let usesP: Promise<Map<string, string[]>> | null = null;
  // The last answer of usesP, kept while a new one is read: what requests name as each object's files.
  let usesNow: Map<string, string[]> | null = null;
  let usesTimer = 0;
  const readUses = () => (usesP ||= filesOfObjects(ctx).then((m) => {
    usesNow = m;
    return m;
  }));
  const libraryObjects = createLibraryObjects({
    t,
    items: () => items,
    selected: () => selected,
    group: () => group,
    multi: () => multi,
    setMulti: (on) => setMulti(on),
    thumb: (k) => bigThumbs.get(k) || thumbs.get(k) || null,
    sharp: (k) => bigThumbs.has(k) && !bigStale.has(k),
    wantThumbs: (keys, px) => {
      if (!uiPrefs.show.thumbs || playing) return;
      const ask = keys.filter((k) => !bigShown.has(k));
      for (const k of ask) bigShown.add(k);
      if (ask.length) send({ type: 'studio:placement/thumbs', keys: ask, size: px });
    },
    pose: (k) => model.pose(k),
    dim: () => dim,
    // No camera move (focus false) and no page switch: the Library stays until "Show in game →" or the Scene row.
    select: (k, add) => (add ? toggleSelect(k) : selectObject(k)),
    selectMany: (keys, primary) => selectMany(keys, primary),
    clear: () => {
      if (selected || group.length) selectObject(null);
    },
    copy: () => copySelection(),
    remove: () => removeSelection(),
    showInGame: () => showPickInGame(),
    openFile: (path) => openAsset(path, ctx),
    uses: () => readUses(),
    askName: (keys) => askAi({ kind: 'name', text: '', objects: requestObjects(keys) }),
    nameDraft: host.offline ? undefined : (keys) => nameDraft(keys),
    changed: () => renderShelf(),
    addToScene: () => addToScene(),
    absent: () => absentItems(),
    placeHere: (keys) => placeHere(keys),
    // The cursor in the ask box: its chip already names the pick (the web demo has no ask box).
    askAi: host.offline ? undefined : () => focusAsk(),
  });
  /** A thing a motion can go on: a world object, not the ground / sky (a drop, the strip's Motion button). */
  function motionable(k: string): boolean {
    const it = worldItems.find((i) => i.key === k);
    return !!it && !it.backdrop && it.held !== 'ground';
  }
  // A Library motion picked up and dropped on an object in the game (studio-motion-flow, motion-drag.ts).
  const motionDrag = createMotionDrag({
    t,
    app,
    frame: () => iframe,
    send: (m) => send(m),
    target: (k) => (motionable(k) ? displayName(worldItems.find((i) => i.key === k)!, t) : null),
    drop: (k, name) => attachAndShow(k, name),
    can: () => editing && !playing && dim === '3d',
  });
  /**
   * After an attach from outside the Scene (a drop, the Library's detail): the Scene, the object picked, the timeline
   * open on the motion with "✓ attached · When does it move?" (studio-motion-flow: the next thing to decide, on screen).
   */
  function attachAndShow(key: string, name: string) {
    if (!timeline.attach(key, name)) return;
    toScene();
    // No camera move: the object was just in sight (a drop), or the person left the camera where they want it.
    selectObject(key);
    timeline.show(key, name, true);
    renderShelf();
  }
  function toScene() {
    if (editLayer !== 'world') setEditLayer('world');
    if (tool === 'placement' && page === 'tool' && !(phone() && sheetOpen)) return;
    tool = 'placement';
    page = 'tool';
    if (phone()) sheetOpen = false;
    renderAll(true);
  }
  // "+ New motion" with nothing picked: the next object picked in the Scene gets it (one line says so; it lapses with
  // the line, MAKE_WAIT_MS, so a pick much later is just a pick).
  let makeOnPick = 0;
  const MAKE_WAIT_MS = 12000;
  function newMotion() {
    const key = editLayer === 'world' && group.length <= 1 ? selected : null;
    toScene();
    if (key) {
      makeOnPick = 0;
      selectObject(key);
      timeline.make(key);
      return;
    }
    makeOnPick = Date.now() + MAKE_WAIT_MS;
    showToast(t('motion.pickFirst'), MAKE_WAIT_MS);
  }
  // The Library's motions (studio-motion-triggers, library-motions.ts): the "Motion" filter, attach, the ask's motions.
  const libraryMotions = createLibraryMotions({
    t,
    list: () => motionLibrary.list(),
    usage: (name) => timeline.usage(name),
    items: () => worldItems,
    picked: () => (editLayer === 'world' && group.length <= 1 ? selected : null),
    multi: () => multi,
    attach: (key, name) => attachAndShow(key, name),
    create: () => newMotion(),
    holdable: (tile, name) => motionDrag.bind(tile, name),
    duplicate: (name) => timeline.duplicateLib(name),
    remove: (name) => timeline.deleteLib(name),
    rename: (name, to) => timeline.renameLib(name, to),
    askAi: host.offline ? undefined : () => focusAsk(),
    changed: () => (renderShelf(), placementPanel.render()),
  });

  // The strip's Motion button (studio-motion-tool, motion-tool.ts): what it shows, and its press — the timeline on the
  // pick's motion, or the small menu (make one by showing it / use a saved one). The same target rule as a drop.
  const motionTool = createMotionTool({
    t,
    send: (m) => send(m),
    target: () => {
      if (!editing || playing || dim !== '3d' || editLayer !== 'world' || group.length > 1 || !selected || libraryShown()) return null;
      return motionable(selected) ? selected : null;
    },
    several: () => editing && !playing && dim === '3d' && editLayer === 'world' && group.length > 1 && !libraryShown() && group.some((k) => motionable(k)),
    motions: (k) => {
      const names = (timeline.motionOf(k)?.clips ?? []).map((c) => c.name);
      const first = timeline.clipName(k);
      return first ? [first, ...names.filter((n) => n !== first)] : names;
    },
    library: () => motionLibrary.list(),
    room: (k) => timeline.room(k),
    keyText: () => keyOf('motion', isMac()),
    make: (k) => (timeline.make(k), renderShelf()),
    attach: (k, name) => attachAndShow(k, name),
    open: (k, name) => timeline.show(k, name),
    menu: (entries, x, y, o, avoid) => {
      ctxMenu.show(entries, x, y, { ...o, floor: menuFloor() });
      // Never over the button it came from (a menu moved to fit the window): above the button, else under it.
      const r = ctxMenu.el.getBoundingClientRect();
      if (avoid && r.top < avoid.bottom && r.bottom > avoid.top) {
        const above = avoid.top - r.height - 6;
        ctxMenu.el.style.top = `${Math.round(above >= 8 ? above : avoid.bottom + 6)}px`;
      }
    },
    menuOpen: () => ctxMenu.isOpen() && app.dataset.menu === 'motion',
    frame: () => iframe,
  });

  /**
   * "✦ Describe with text" under a layout's keep-out areas (studio-code-keepout): the layout and its areas, and what the
   * words are for — so "not within 5 m of the player" reaches the AI as a keep-out condition of THAT layout.
   */
  function requestPlaces(): { places?: RequestPlace[]; intent?: 'avoid' } {
    const at = libraryShown() ? null : keepOutAskNow();
    const p = at ? keepOut.request(at.id) : null;
    return p ? { places: [p], intent: 'avoid' } : {};
  }

  /**
   * The motions picked in the Library, for an ask (studio-motion-triggers): each with its length and what it is on now
   * (`on`: keys with when / until), so "make this crate Hop when the player walks up" reaches the AI with both names.
   */
  function requestMotions(points = false): { motions?: RequestMotion[] } {
    const at = libraryShown() ? null : motionAsk.now();
    if (!libraryShown() && !at) return {};
    const out: RequestMotion[] = [];
    for (const name of at ? [at.use] : libraryMotions.picked()) {
      const m = motionLibrary.get(name);
      // ✦ Turn into a rule…: its points go too — the shape on screen, saved or not, is what the AI fits a rule to.
      if (m) out.push({ name, len: m.len, ...(m.repeat ? { repeat: m.repeat } : {}), on: timeline.usage(name), ...(points && m.keys?.p?.length ? { keys: { p: structuredClone(m.keys.p) } } : {}) });
    }
    return out.length ? { motions: out } : {};
  }

  /**
   * The Library's "Add to scene" (2026-10-18; also its tiles' menu and a tile dropped on the Scene row): one copy of
   * each picked kind ("pine ×3" adds ONE pine), placed in the middle of what the camera sees (copy `at: 'view'`), then
   * the Scene with the copies picked — the camera stays (the copy is where it looks). One undo step, like Duplicate.
   * Locked objects are left out (targets()).
   */
  function addToScene(keys = targets()) {
    if (!keys.length || !editing) return;
    const seen = new Set<string>();
    const one = keys.filter((k) => {
      const g = items.find((i) => i.key === k)?.group || `key:${k}`;
      if (seen.has(g)) return false;
      seen.add(g);
      return true;
    });
    // The Scene first, so the bridge knows what the game frame really shows when it places the copy: a phone's
    // Library sheet covered most of it (its inset), and "the middle of what is seen" was then a strip of sky (the
    // first phone run, 2026-10-18, put the copy off screen). core/ui (renderAll → sendInset) goes before the copy.
    if (tool !== 'placement' || page !== 'tool' || (phone() && sheetOpen)) {
      tool = 'placement';
      page = 'tool';
      if (phone()) sheetOpen = false;
      renderAll(true);
    }
    for (const k of copySelection(one, 'view')) addingToScene.add(k);
  }

  /**
   * The Library's "Not in this level" (studio-fix-0146): game objects this level's page has but does not show — a New
   * level hid them (blankKeep), or the person deleted them here — in the order the game listed them. Only in a game with
   * levels and on the world layer: "not in this level" means nothing in a game with one level, where a deleted thing is
   * simply deleted (⌘Z brings it back).
   */
  function absentItems(): Item[] {
    if (!levels.active || editLayer !== 'world' || !editing) return [];
    const here = new Set(worldItems.map((i) => i.key));
    return [...(seenByBuild.get(buildNow())?.values() || [])].filter((it) => !here.has(it.key) && worldModel.isRemoved(it.key) && !worldModel.isCopy(it.key));
  }
  /**
   * Put these "Not in this level" objects in the level on screen (a click on the tile, or a drop on the Scene row): shown
   * again in the middle of the view (the bridge, placement/restore at 'view'), picked, one undo step, one change per
   * object on "Save · n". Save writes them out of the level's `removed` and at their new place (`objects`), so the AI
   * keeps them in this level only — the other levels' files are not touched (the same rule as any edit of a level).
   */
  function placeHere(keys: string[]) {
    const absent = new Map(absentItems().map((i) => [i.key, i]));
    const list = keys.filter((k) => absent.has(k));
    if (!list.length) return;
    if (tool !== 'placement' || page !== 'tool' || (phone() && sheetOpen)) {
      tool = 'placement';
      page = 'tool';
      if (phone()) sheetOpen = false;
      renderAll(true);
    }
    for (const k of list) worldModel.unremove(k);
    undo.push({ changes: list.map((k) => ({ kind: 'place' as const, key: k })) });
    send({ type: 'studio:placement/restore', keys: list, at: 'view' });
    // namesOf reads the game's list, which has not got them back yet: the name from the remembered Item.
    showToast(t('lib.added', { name: list.length === 1 ? displayName(absent.get(list[0]!)!, t) : t('undo.n', { n: list.length }) }), 2500);
    renderButtons();
  }

  /** The Scene's "Show in Library →" (card, menu, ⌘K): the Library with the pick's detail, the camera untouched. */
  function showInLibrary() {
    if (!libraryTool) return;
    switchTool('library');
    libraryShowPick();
  }

  // The Library's files as things to use (contract LibraryFileUse). "Add to scene" on a file is the AI's work (a new
  // object is code): the ask box gets the words with the files' chip, and Enter sends them — the same box, the same
  // key as every other request. The web demo has no AI: no add (the Library dims it and says why), no ask.
  const fileUse: LibraryFileUse = {
    picked: (paths) => {
      filePick = paths.slice();
      placementPanel.renderAsk();
    },
    add: host.offline ? undefined : (paths) => {
      filePick = paths.slice();
      focusAsk(t(paths.length > 1 ? 'lib.addFilesText' : 'lib.addFileText'));
    },
    ask: host.offline ? undefined : (paths) => {
      filePick = paths.slice();
      focusAsk();
    },
  };
  /** The Library → the game with the pick ("Show in game →" on its detail, and its tiles' menus). */
  function showPickInGame() {
    tool = 'placement';
    page = 'tool';
    if (phone()) sheetOpen = false;
    renderAll(true);
    // Now the game is on screen: bring the selection into view (a slide only, never a new camera angle; W1).
    send({ type: 'studio:placement/select', key: selected, focus: true, keys: group.length > 1 ? group.slice() : undefined });
  }
  /** The Library is on screen (it hides the game: no blind key moves there). */
  const libraryShown = () => tool === 'library' && page === 'tool' && !playing;
  const renderShelf = () => {
    if (tool === 'library') libraryRedraw();
  };

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
  // A pick shows / drops the card without a renderAll: the bar's left button follows (▾ with the card up, the list icon without).
  new MutationObserver(() => renderSheetBtn()).observe(placementPanel.cardEl, { attributes: true, attributeFilter: ['hidden'] });
  // The card: over the game's top right corner on PC, above the ask bar on a phone.
  const placeCard = () => {
    const want = phone() ? cardSlot : inspector;
    if (placementPanel.cardEl.parentElement !== want) want.append(placementPanel.cardEl);
  };

  // ----- the ⌘K list (palette.ts) -----
  const askInput = placementPanel.askEl.querySelector('input') as HTMLInputElement;
  // A short notice shown in the field's place (showToast). Typing (or a click into the field) ends it at once.
  const askNews = h('span', { class: 'ask-news', role: 'status', 'aria-live': 'polite', hidden: true });
  askInput.addEventListener('input', hideNews);
  // The AI's faded reply comes back when the person goes to the field (it was the top bar's "● AI" until 2026-10-23,
  // where nobody found it): the field is where the AI lives, and its Undo is right there. ⌘K lists it too.
  askInput.addEventListener('focus', () => {
    if (lineRecallable()) recallLine();
  });
  // The presence words move inside / above the field as the bar's width changes (renderPresence).
  new ResizeObserver(() => renderPresence()).observe(askSlot);
  askInput.addEventListener('focus', hideNews);
  new ResizeObserver(() => placeNews()).observe(askInput);
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
    // ⌘K / "…" opens on the game's own actions (design review 2, item ④ — asked for in review 1 too): Play, then what
    // works on the pick (Duplicate, Delete, Copy, Show in Library). Gone from its top: the made-up sentences "Add 3
    // more of … in a row" / "Make … glow" (the AI is reached by typing: then the first row is "Ask your AI: “…”", see
    // palette.ts) and "Fit the editor / Change how the editor looks / Add a tool" (they live on the Ideas page,
    // "Ideas for your AI…" below). Asking to name the unnamed objects stays — a real action — after the actions.
    // Actions, with their keys.
    const mac = isMac();
    const act = (id: string, label: string, ic: string, run: () => void, hint?: string, words?: string) =>
      rows.push({ id, section: 'actions', label, icon: ic, hint, words, data: { action: id }, run });
    act('play', playing ? t('btn.edit') : t('pal.play'), playing ? 'stop' : 'play', () => void togglePlay(), !playing || host.offline ? 'P' : undefined, t('btn.play'));
    // The old Play, a new page (fast switch, 2026-10-22: Play's ▾ says why).
    act('play-fresh', t('pal.playFresh'), 'play', () => void togglePlay(true), undefined, t('pal.playFresh.words'));
    if (keys.length && editing) {
      act('copy', t('ops.copy'), 'copy', () => copySelection(), shortcutText('copy'), 'duplicate clone 複製');
      act('remove', t('ops.remove'), 'trash', () => removeSelection(), shortcutText('remove'), 'delete remove 削除');
      // Copy / paste have no button of their own: Duplicate on the card is the same thing in one press. Here so the
      // keys can be found by searching "copy" / "paste".
      act('clip-copy', t('keys.copy'), 'copy', clipCopy, keyOf('copy', mac), 'copy コピー');
    }
    if (clip.length && editing) act('paste', t('keys.paste'), 'copy', clipPaste, keyOf('paste', mac), 'paste 貼り付け');
    // The pick in the Library, and its file there ("use the Library", 2026-10-18); in the Library, Add to scene.
    if (keys.length && libraryTool && !libraryShown()) {
      act('show-in-library', t('pal.showInLibrary'), 'grid', () => showInLibrary(), undefined, t('pal.libraryUseWords'));
      const src = keys.length === 1 ? usesNow?.get(keys[0]!) || [] : [];
      if (src[0]) act('show-file-in-library', t('pal.showFileInLibrary', { file: src[0].slice(src[0].lastIndexOf('/') + 1) }), 'grid', () => openAsset(src[0]!, ctx), undefined, t('pal.libraryUseWords'));
    }
    if (dirtyCount() > 0) act('save', t('btn.save'), 'check', () => void handOff(), keyOf('save', mac), 'save 保存');
    // The timeline (studio-timeline, 2026-10-22): open / fold it from here too (the card's Motion row is the other door).
    if (editing && !playing && dim === '3d' && editLayer === 'world') act('timeline', t(timeline.isOpen() ? 'tl.fold' : 'tl.open'), 'play', () => timeline.toggle(), undefined, 'timeline keyframe animation motion animate key タイムライン キーフレーム アニメーション 動き');
    // Levels (level-crumb, 2026-10-22): the crumb's menu, the level before / after with their keys, or "+ Level".
    if (levels.active && editing && !playing) {
      const words = t('level.pal.words');
      act('levels', t('level.pal.open', { name: levels.labelOf(levels.current) }), 'chevronDown', () => levelSwitch.open(), undefined, words);
      const prev = levels.step(-1), next = levels.step(1);
      if (prev) act('level-prev', t('level.pal.prev', { name: levels.labelOf(prev) }), 'chevronUp', () => void goLevel(prev), keyOf('levelPrev', mac), words);
      if (next) act('level-next', t('level.pal.next', { name: levels.labelOf(next) }), 'chevronDown', () => void goLevel(next), keyOf('levelNext', mac), words);
    } else if (levelAddable()) act('level-add', t('level.pal.add'), 'chevronDown', () => openLevelFresh(), undefined, t('level.pal.words'));
    if (tool === 'library') act('scene', t('pal.scene'), 'cube', () => switchTool('placement'), undefined, t('tool.placement'));
    else act('assets', t('pal.assets'), 'grid', () => switchTool('library'), undefined, `${t('tool.library')} ${t('pal.libraryWords')}`);
    // World ⇄ UI (UI stage 1): only in a game with both.
    if (editLayers && editLayers.length > 1 && editing && !playing) {
      const to: EditLayer = editLayer === 'ui' ? 'world' : 'ui';
      act('edit-layer', t(`uiLayer.pal.${to}`), to === 'ui' ? 'uiLayer' : 'cube', () => setEditLayer(to), keyOf('layer', mac), 'ui hud title layer world UI ワールド 画面');
      if (editLayer === 'world') act('ui-peek', t(uiPeek ? 'uiPeek.pal.hide' : 'uiPeek.pal.show'), uiPeek ? 'eyeOff' : 'eye', () => setUiPeek(!uiPeek), keyOf('uiPeek', mac), 'ui hud show hide peek eye 見る 隠す 表示');
    }
    if (undo.canUndo || levelMade) act('undo', t('btn.undo'), 'undo', doUndo, keyOf('undo', mac), `${describe(undo.peekUndo())} undo 元に戻す`);
    // The AI's change, undone from here too: its line fades by itself (line-fade.ts) and this row is always there while
    // the change can be taken back (also on a phone, where the top bar has no "● AI").
    {
      const ph = currentPhase();
      if (lastChange && host.undoAi && !playing && !undoBusy) {
        if (ph === 'done' || ph === 'redone') act('ai-undo', t('ai.undo'), 'undo', () => void undoAiChange(false), undefined, t('pal.aiUndo.words'));
        else if (ph === 'undone' && lastChange.redo) act('ai-redo', t('ai.redoPal'), 'redo', () => void undoAiChange(true), undefined, t('pal.aiUndo.words'));
      }
      if (lineRecallable()) act('ai-recall', t('ai.recall'), 'spark', () => recallLine(), undefined, t('pal.aiUndo.words'));
    }
    if (undo.canRedo) act('redo', t('btn.redo'), 'redo', doRedo, keyOf('redo', mac), `${describe(undo.peekRedo())} redo やり直す`);
    if (keys.length) act('deselect', t('ops.selectNone'), 'close', () => selectObject(null), keyOf('deselect', mac), 'deselect unselect none 選択解除');
    if (keys.length && editing && libraryShown() && targets().length) act('add-to-scene', t('lib.addToScene'), 'copy', () => addToScene(), undefined, 'add scene place 足す 置く');
    // The strip's tools (with something picked): the chosen one is marked with a check, its key on the right.
    if (keys.length && editing) {
      for (const k of (dim === '3d' ? ['move', 'lift', 'rotate', 'scale'] : ['move', 'rotate', 'scale']) as StripTool[]) {
        const key = Object.keys(STRIP_KEYS).find((c) => STRIP_KEYS[c] === k)!.toUpperCase();
        act(`tool-${k}`, t(`pal.tool.${k}`), stripTool === k ? 'check' : STRIP_ICONS[k], () => setStripTool(k), key, `${t('pal.tool.words')} ${keyOf(k, mac)}`);
      }
      // The strip's Motion button (studio-motion-tool): the same press, from here (the menu opens at the button).
      if (motionTool.target()) act('tool-motion', motionTool.words(), 'toolMotion', () => pressMotion(), keyOf('motion', mac), `${t('pal.tool.motion.words')} ${t('pal.tool.words')}`);
    }
    // Drop to floor (End; snap to surfaces, 2026-10-19): what is picked, set on the surface under it.
    if (keys.length && editing && dim === '3d' && canDrop) act('drop', t('keys.drop'), 'chevronDown', () => dropToFloor(), keyOf('drop', mac), t('pal.drop.words'));
    if (uiPrefs.show.frame) act('frame', t('btn.frame'), 'frame', () => send({ type: 'studio:core/view', view: { action: 'frameAll' } }), 'F');
    // Back to the picture the editor opened on (3D: the game's own camera, polish pass) after looking around or
    // after the first pick's glide; one press, any time (speed pass, 2026-10-17). Always listed: 2D opens on "all".
    if (editing) act('home', t('pal.home'), 'opening', () => goHome(), keyOf('home', mac), t('pal.home.words'));
    // Camera up / down (play test 2026-10-18): the one place their words and keys are written (the ↑↓ buttons on the
    // game carry the same as tooltips). E / Q with nothing picked; with something picked E / Q turn it, so Space+E / Q.
    if (editing && canRise) {
      const pre = keys.length ? 'Space+' : '';
      act('camera-up', t('pal.cameraUp'), 'chevronUp', () => riseCamera(RISE_STEP), pre + 'E', t('pal.camera.words'));
      act('camera-down', t('pal.cameraDown'), 'chevronDown', () => riseCamera(-RISE_STEP), pre + 'Q', t('pal.camera.words'));
    }
    // Fly (W A S D; camera-wasd 2026-10-18): a row so "wasd" / "fly" finds the rule. Its key says when (as Camera up's
    // Space+E): WASD with nothing picked, the right button + WASD with a pick. Run = the ? sheet, whose row carries the
    // same rule in words (keys.fly.note — the one place it is written). Not on a phone (no keyboard there; the row
    // only explains keys). Its id is not camera-* so the Camera up / down rows stay a pair (studio-camera-up looks them up).
    if (editing && canFly && !phone()) act('fly', t('keys.fly'), 'keyboard', () => keySheet.show(), keys.length ? t('keys.fly.picked') : 'WASD', `${t('keys.fly.note')} ${t('pal.fly.words')}`);
    if (items.length) act('select-all', t('pal.selectAll'), 'hand', () => selectMany(items.map((i) => i.key), selected ?? items[0]!.key), shortcutText('all'));
    act('multi', multi ? t('ops.multiDone') : t('pal.multi'), 'hand', () => setMulti(!multi), undefined, t('ops.multi'));
    // "Show all" of the keys: the one sheet with every shortcut (also the ? key).
    act('shortcuts', t('keys.title'), 'keyboard', () => keySheet.show(), '?', 'keyboard shortcuts keys help hotkeys ショートカット キー 一覧');
    act('settings', t('pal.look'), 'look', () => openSettings(), undefined, `${t('btn.settings')} ${t('ui.theme')} ${t('ui.lang')}`);
    act('lang', t('pal.lang'), 'globe', () => setLang(lang === 'en' ? 'ja' : 'en'), undefined, 'language 言葉 English 日本語');
    if (uiPrefs.show.next) act('next', t('pal.ideas'), 'spark', () => openNext(), undefined, t('btn.next'));
    // Ask your AI to name what has no name (a real request, after the actions; review 2 ④).
    const unnamed = items.filter((i) => i.unstable).map((i) => i.key);
    if (unnamed.length) {
      rows.push({ id: 'name', section: 'ask', label: t('pal.ex.name'), icon: 'spark', hint: String(unnamed.length), data: { action: 'pal-name' },
        // A draft in the box (studio-card-doors, 2026-10-23; the ✦ rule): it sent a request at once before. The web demo
        // has no AI and no box: the old send stays its only way (askAi says why it cannot).
        run: () => (host.offline ? void askAi({ kind: 'name', text: '', objects: requestObjects(unnamed) }) : nameDraft(unnamed)) });
    }
    // A phone's "All actions" prints no keys (no keyboard there; review 2 ④). Counts stay.
    if (phone()) for (const r of rows) if (r.section === 'actions') r.hint = undefined;
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

  // ----- the place's menu: right-click, or a long press on a phone (context menu, 2026-10-18) -----
  // context-rows.ts says what each place lists; context-menu.ts draws it. Here: which place was pressed, picking it
  // first when it was not picked (as other 3D / 2D tools do — never moving the camera), and what each row does. Every
  // row is an action the editor already has (the card's Duplicate, ⌘C, ⌘K's rows…), so its key and its undo are the same.

  /** The keys a press on this list row / Library tile is about: the row's object, or every member of a "name ×N" row. */
  function keysOfEl(el: HTMLElement): string[] {
    const g = el.dataset.group;
    if (g) return items.filter((i) => (i.group || `key:${i.key}`) === g).map((i) => i.key);
    return el.dataset.key && items.some((i) => i.key === el.dataset.key) ? [el.dataset.key] : [];
  }
  /** Pick `keys` unless they are all picked already (then the whole selection stays, as a right-click in other tools). */
  function pickForMenu(keys: string[]) {
    const now = group.length ? group : selected ? [selected] : [];
    if (!keys.length || keys.every((k) => now.includes(k))) return;
    // No camera move (focus false), in the list and in the Library alike.
    if (keys.length === 1) selectObject(keys[0]!);
    else selectMany(keys, keys[0]!);
  }
  /**
   * ✦ Ask AI on `key`'s motion: picked (no camera move), the chip names both, the cursor in the chat box. Nothing is sent.
   * `draft`: words put in first (✦ Turn into a rule…'s "Turn into a close rule").
   */
  function askMotion(key: string, m: { name: string; use: string }, draft?: string) {
    if (selected !== key || group.length > 1) selectObject(key);
    motionAsk.set(key, m);
    toRuleAsk = null;
    focusAsk(draft);
  }
  /**
   * Rename in place (studio-uniforms, 2026-10-23; the menu's Rename, F2): the name shows everywhere at once, one undo
   * step, one Save count; placement.json's `names` carries it and the AI renames the object in the code on Save.
   * History: "Rename…" typed "Rename it to " into the AI box — a plain row writing in the box, the thing a hands-on try
   * found senseless. '' = back to the game's own name. Only a named world object (an unnamed one is "✦ Ask AI to name
   * it…": its name must first exist in the code).
   */
  function renameObject(key: string, name: string): boolean {
    const it = items.find((i) => i.key === key);
    if (!it || it.unstable || editLayer !== 'world') return false;
    const v = name.trim() === it.label ? '' : name.trim();
    const from = worldModel.rename(key, v || null);
    if (!undo.push({ changes: [{ kind: 'name', key, from, to: v || null }] })) return false;
    renderAll();
    keepSoon();
    return true;
  }
  /** F2 / the menu's Rename: the one picked, named world object's card name becomes a field. */
  function startRename() {
    const it = selected && group.length <= 1 ? items.find((i) => i.key === selected) : undefined;
    if (!it || it.unstable || !editing || playing || editLayer !== 'world' || host.offline) return false;
    if (tool !== 'placement' || page !== 'tool') switchTool('placement');
    placementPanel.startRename(it.key);
    return true;
  }
  /**
   * ✦ "Ask AI to name it…" (the menu, the card, the Library's detail; studio-uniforms): those objects picked (the chip
   * names them) and a draft in the box — nothing sent. It sent a request at once before, the one ✦ that did.
   */
  function nameDraft(keys: string[]) {
    if (host.offline) return;
    if (keys.length === 1 && selected !== keys[0]) selectObject(keys[0]!);
    else if (keys.length > 1) selectMany(keys, keys[0]!);
    focusAsk(t(keys.length > 1 ? 'ctx.nameTextMany' : 'ctx.nameText'));
  }
  /** The ask box with the cursor in it (the menus' "Ask your AI…"); `text` is put in first, never sent. */
  function focusAsk(text?: string) {
    if (host.offline) return;
    if (phone() && sheetOpen) {
      sheetOpen = false;
      renderAll(true);
    }
    placementPanel.renderAsk();
    if (text !== undefined) {
      askInput.value = text;
      askInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    askInput.focus({ preventScroll: true });
    const end = askInput.value.length;
    askInput.setSelectionRange?.(end, end);
  }

  /** Open the menu of `place` at the page point (x, y). The pick is already what the menu is about. */
  function openMenu(place: CtxPlace, x: number, y: number, o: { touch?: boolean; keyboard?: boolean; path?: string } = {}) {
    if (playing && place !== 'libFile') return;
    const mac = isMac();
    const picked = group.length ? group.slice() : selected ? [selected] : [];
    const its = picked.map((k) => items.find((i) => i.key === k)).filter((i): i is Item => !!i);
    const movable = targets();
    // 2D draw order: which moves can still happen (the card's Layer buttons ask the same question).
    let layers: Partial<Record<LayerOp, boolean>> | undefined;
    if (dim === '2d' && its.some((i) => hasLayer(i))) {
      layers = {};
      for (const op of ['forward', 'backward', 'toFront', 'toBack'] as LayerOp[]) {
        layers[op] = its.length > 1 ? groupLayerPossible(items, picked, op) : its[0]!.movable !== false && layerTarget(items, its[0]!.key, op) !== null;
      }
    }
    const file = place === 'libFile' && o.path ? libraryFile(o.path) : null;
    const rows = contextRows(place, {
      dim, offline: !!host.offline, editing: editing && !playing,
      picked: its.length, movable: movable.length, unnamed: its.filter((i) => i.unstable).length, held: its.filter((i) => i.held === 'ground').length, anyPicked: picked.length > 0,
      items: items.length, clip: clip.filter((c) => items.some((i) => i.key === c)).length,
      canUndo: undo.canUndo, canRedo: undo.canRedo, layers, users: file?.users ?? 0, exists: file?.exists, compact: phone(),
      // Drop follows the Height tool's rule (bridge/hold.ts canLift): a held ground no, a pillar the game slides yes.
      droppable: dim === '3d' && canDrop ? its.filter((i) => i.liftable !== false && (i.movable !== false || i.held === 'game')).length : undefined,
      ui: editLayer === 'ui' || undefined,
      // studio-motion-panel: the one picked object's motion (3D world: the timeline's), for "Ask your AI about “Hop”…".
      motion: !host.offline && its.length === 1 && editLayer === 'world' && dim === '3d' ? timeline.shownName(its[0]!.key) ?? undefined : undefined,
    });
    // A file's menu works on the picked files when the pressed one is among them ("Add 3 to scene"), else on it alone.
    const files = () => {
      const p = libraryPickedFiles();
      return o.path && p.includes(o.path) ? p : o.path ? [o.path] : [];
    };
    const name = its.length > 1 ? t('ops.manyShort', { n: its.length }) : its[0] ? displayName(its[0], t) : '';
    const run: Record<string, () => void> = {
      ask: () => focusAsk(),
      askMotion: () => its.length === 1 && timeline.askAbout(its[0]!.key),
      name: () => nameDraft(its.filter((i) => i.unstable).map((i) => i.key)),
      rename: () => void startRename(),
      duplicate: () => copySelection(),
      paste: () => clipPaste(),
      remove: () => removeSelection(),
      selectAll: () => items.length && selectMany(items.map((i) => i.key), selected ?? items[0]!.key),
      deselect: () => selectObject(null),
      frame: () => send({ type: 'studio:core/view', view: { action: 'frameAll' } }),
      home: () => goHome(),
      showInGame: () => showPickInGame(),
      replace: () => libraryAct('replace', o.path),
      addToScene: () => addToScene(),
      addFile: () => fileUse.add?.(files()),
      askFile: () => fileUse.ask?.(files()),
      showInLibrary: () => showInLibrary(),
      drop: () => dropToFloor(),
    };
    for (const op of ['forward', 'backward', 'toFront', 'toBack'] as LayerOp[]) {
      run[`layer-${op}`] = () => (group.length > 1 ? reorderGroup(op) : selected && reorder(selected, op));
    }
    const entries: MenuEntry[] = rows.map((r) => ('sep' in r ? r : {
      id: r.id,
      // A ✦ row says what it is about: the object by its name ("Ask AI to change the ship…"), the game, or the motion.
      label: r.id === 'askMotion' && its[0] ? t(r.label, { name: timeline.shownName(its[0].key) ?? '' }) : r.id === 'addFile' && files().length > 1 ? `${t(r.label)} (${files().length})` : t(r.label, { name, n: its.length }),
      key: r.key ? keyOf(r.key, mac) : '',
      disabled: r.disabled,
      ai: r.ai,
      run: run[r.id] ?? (() => undefined),
    }));
    // A code layout's object (studio-code-knobs): "Place individually" / "Reset to rule", in a group of their own before
    // the last group (Delete stays last).
    const rr = place === 'object' && its.length === 1 && editLayer === 'world' ? codePlaces.rows(its[0]!.key) : [];
    if (rr.length) {
      let at = entries.length;
      for (let i = entries.length - 1; i >= 0; i--) if ('sep' in entries[i]!) {
        at = i;
        break;
      }
      entries.splice(at, 0, { sep: true }, ...rr.map((r) => ({ id: r.id, label: r.label, key: '', run: r.run })));
    }
    if (!entries.length) return;
    // A phone: the menu never covers the card or the ask box (review 2 ②): its bottom stays 8 px above the higher of
    // the two (the card sits on the ask bar when something is picked).
    ctxMenu.show(entries, x, y, { place, touch: o.touch, keyboard: o.keyboard, floor: menuFloor(), label: place === 'object' && name ? t('ctx.menu', { name }) : place === 'scene' ? t('ctx.menuScene') : undefined });
  }

  /** A phone: the y a menu's bottom stays above (the higher of the card and the ask box), else undefined (the window). */
  function menuFloor(): number | undefined {
    if (!phone()) return undefined;
    const card = placementPanel.cardEl;
    const tops = [bar, card.hidden || !card.isConnected ? null : card].filter((e): e is HTMLElement => !!e && !!e.offsetParent).map((e) => e.getBoundingClientRect().top).filter((v) => v > 0);
    return tops.length ? Math.min(...tops) : undefined;
  }

  /** What a press at this element of the editor page opens: a list row, a Library tile, or the list's empty part. */
  function menuFor(target: Element | null): { place: CtxPlace; el: HTMLElement } | null {
    if (!target || !editing && tool !== 'library') return null;
    const row = target.closest<HTMLElement>('.objects .obj[data-key]');
    if (row && placementPanel.el.contains(row)) return { place: 'object', el: row };
    const tile = target.closest<HTMLElement>('.assets-page .lib-object[data-key]');
    if (tile) return { place: 'libObject', el: tile };
    const file = target.closest<HTMLElement>('.assets-page .gsl-tile[data-kind="file"][data-path]');
    if (file) return { place: 'libFile', el: file };
    // The list's empty part (under the rows) is the scene, as the game's empty part is.
    const list = target.closest<HTMLElement>('.list-scroll');
    if (list && tool === 'placement' && page === 'tool' && placementPanel.el.contains(list)) return { place: 'scene', el: list };
    return null;
  }
  /** Pick what the pressed element stands for (unless it is picked), then open its menu. */
  function menuAt(m: { place: CtxPlace; el: HTMLElement }, x: number, y: number, o: { touch?: boolean; keyboard?: boolean } = {}) {
    // In the Library the pick shows its detail without scrolling the page to it (a phone sheet jumped to its top
    // under the finger); the menu's "Details" brings it into view.
    if (m.place === 'object') pickForMenu(keysOfEl(m.el));
    else if (m.place === 'libObject') libraryHoldStill(() => pickForMenu(keysOfEl(m.el)));
    let path: string | undefined;
    if (m.place === 'libFile') {
      path = m.el.dataset.path!;
      // A file is "picked" by opening its detail (one thing open in the Library at a time).
      libraryHoldStill(() => libraryAct('open', path));
    }
    openMenu(m.place, x, y, { ...o, path });
  }

  // The browser's own right-click menu never shows in the editor (it offered Back / Reload / Inspect over the game's
  // tools), except in a field, where Cut / Copy / Paste / spelling belong to the text.
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    e.preventDefault();
    cancelPress();
    // The card's Motion row opens its own menu (motion-card.ts, studio-motion-delete): not the pick's over the game.
    if (t?.closest?.('[data-part="motion-row"]')) return;
    // The same press's contextmenu after a long press opened the menu already (Android sends one).
    if (ctxMenu.justOpened() || ctxMenu.el.contains(t)) return;
    // Shift+F10 / the menu key: no pointer (0, 0 or no pointer type); the menu opens at the element.
    const keyboard = (e as PointerEvent).pointerType === '' || (!e.clientX && !e.clientY);
    const m = menuFor(t);
    if (!m) {
      // The menu key with the focus on no row (a button, the page): the pick's menu, or the scene's, over the game.
      if (keyboard && editing && !playing && !libraryShown()) {
        const g = iframe.getBoundingClientRect();
        openMenu(selected || group.length ? 'object' : 'scene', g.left + g.width / 2, g.top + g.height / 2, { keyboard });
      }
      return;
    }
    const r = m.el.getBoundingClientRect();
    menuAt(m, keyboard ? r.left + 12 : e.clientX, keyboard ? r.bottom : e.clientY, { keyboard });
  }, true);
  // The click that ends a long press (and the Mac's Control-click) must not also press the row under the finger.
  document.addEventListener('click', (e) => {
    if (ctxMenu.justOpened() && !ctxMenu.el.contains(e.target as Node)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  // A long press on a phone (touch / pen; the mouse has its right button): UI.longPressMs held still on a row or tile.
  // The 2D list's drag grip, a "×N" row's ▸ and a sound's ▶ keep their own presses.
  let press: { id: number; x: number; y: number; m: { place: CtxPlace; el: HTMLElement }; timer: number } | null = null;
  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }
  document.addEventListener('pointerdown', (e) => {
    cancelPress();
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    const t = e.target as Element | null;
    if (t?.closest?.('.grip, .expand, .gsl-play, input, textarea, select')) return;
    const m = menuFor(t);
    if (!m || m.place === 'scene') return;
    const at = { id: e.pointerId, x: e.clientX, y: e.clientY, m };
    press = { ...at, timer: window.setTimeout(() => {
      press = null;
      menuAt(at.m, at.x, at.y, { touch: true });
    }, UI.longPressMs) };
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > UI.tapSlopPx) cancelPress();
  }, true);
  for (const ev of ['pointerup', 'pointercancel'] as const) document.addEventListener(ev, (e) => {
    if (press && e.pointerId === press.id) cancelPress();
  }, true);
  document.addEventListener('scroll', () => cancelPress(), { capture: true, passive: true });

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
    // The AI's change (ai-hands.ts): its own words, with its name — "Undo: Claude took “Row” off Blue pillar".
    if (e.ai) return e.ai;
    const name = (k: string) => {
      const it = items.find((i) => i.key === k);
      return it ? displayName(it, t) : k;
    };
    // A drag that makes a motion pushes two changes in one step: the Library motion (`motion-lib`, key = the motion's
    // name) and the object's clip (`motion`, key = the object). They are one edit to one object — counting them apart
    // read "Undo: change 2 objects" for one ship (studio-fix-0139, 2026-10-23). So the three motion kinds count as one
    // kind, and the name comes from the objects; a Library-only change (no object) names the motion itself.
    const libOnly = (k: string) => k === 'motion-lib' || k === 'motion-rename';
    const kinds = new Set(e.changes.map((c) => (libOnly(c.kind) ? 'motion' : c.kind)));
    const what = kinds.size > 1 ? 'edit' : kinds.has('add') ? 'copy' : kinds.has('remove') ? 'remove' : kinds.has('motion') ? 'motion'
      : kinds.has('ui-set') ? 'look' : kinds.has('ui-theme') ? 'theme' : kinds.has('name') ? 'rename' : 'move';
    const onObjects = e.changes.filter((c) => !libOnly(c.kind));
    const keys = [...new Set((onObjects.length ? onObjects : e.changes).map((c) => c.key))];
    // Several objects' motion at once (studio-fix-0142 ⑭): a linked motion is one motion to the person — named by its
    // name ("change gate’s motion", the motion's name being "gate’s motion"); else "change the motion of 2 objects",
    // not "change 2 objects’s motion" (undo.n inside undo.motion's possessive).
    if (what === 'motion' && keys.length > 1) {
      const shared = sharedMotion(e.changes);
      return shared ? t('undo.motionNamed', { name: shared }) : t('undo.motionN', { n: keys.length });
    }
    return t(`undo.${what}`, { name: keys.length === 1 ? name(keys[0]!) : t('undo.n', { n: keys.length }) });
  }

  // ----- several at once, copy, delete (CONTRACT.md §1.8) -----
  function shortcutText(what: 'copy' | 'remove' | 'all'): string {
    return keyOf(what === 'copy' ? 'duplicate' : what === 'all' ? 'selectAll' : 'remove', isMac());
  }
  function clipCopy() {
    clip = targets();
    if (clip.length) showToast(t('keys.copied', { name: namesOf(clip), key: keyOf('paste', isMac()) }), 2500);
  }
  function clipPaste() {
    const keys = clip.filter((c) => items.some((i) => i.key === c && copyable(i)));
    if (keys.length) copySelection(keys);
    else showToast(t(clip.length ? 'keys.pasteGone' : 'keys.pasteEmpty', { key: keyOf('copy', isMac()) }), 2500);
  }
  /** "lighthouse" or "3 objects", for the short notes (copied…). */
  const namesOf = (keys: string[]) => {
    const it = keys.length === 1 ? items.find((i) => i.key === keys[0]) : undefined;
    return it ? displayName(it, t) : t('undo.n', { n: keys.length });
  };
  /** What the actions work on: the selection (locked objects left out). */
  /**
   * Can be copied / deleted / pasted: not locked by the game's rules. An object the game moves by itself (Item.held
   * 'game', bridge/hold.ts) has no move tool but is still a thing to copy or delete (a hands-on try, 2026-10-19).
   */
  function copyable(i: Item | undefined): boolean {
    return !!i && (i.movable !== false || i.held === 'game');
  }
  const targets = () => (group.length ? group : selected ? [selected] : [])
    .filter((k) => copyable(items.find((i) => i.key === k)));

  function sendSelection(focus = false) {
    send({ type: 'studio:placement/select', key: selected, focus, keys: group.length > 1 ? group.slice() : undefined });
    codePlaces.guide();
    if (tool === 'placement' && page === 'tool') placementPanel.render();
    else placementPanel.renderAsk();
    renderShelf();
    renderSheet();
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
    renderShelf();
  }

  /** Every key in use, so a new copy never takes one (deleted copies included: redo brings them back). */
  const takenKeys = () => new Set([...items.map((i) => i.key), ...model.copiesEver()]);

  /**
   * Duplicate `keys` (the selection for ⌘D / the card's Duplicate; what ⌘C remembered for ⌘V). `at: 'view'`: in the
   * middle of what the camera sees (the Library's "Add to scene"). Returns the new copies' keys.
   */
  function copySelection(keys = targets(), at?: 'view'): string[] {
    // The UI layer moves and resizes only (UI stage 1; new UI is placed in stage 3).
    if (!keys.length || !editing || editLayer === 'ui') return [];
    const taken = takenKeys();
    const reqs = keys.map((from) => {
      const it = items.find((i) => i.key === from);
      const key = copyKey(from, taken, it?.kinds?.[0]);
      taken.add(key);
      pendingCopies.add(key);
      return { key, from };
    });
    send({ type: 'studio:placement/copy', items: reqs, ...(at ? { at } : {}) });
    return reqs.map((r) => r.key);
  }

  /** Delete `keys` (the selection; the AI's object.delete names one). */
  function removeSelection(keys = targets()) {
    if (!keys.length || !editing || editLayer === 'ui') return;
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
    // A step of the other layer (UI stage 1): that layer first, so what goes back is seen. The bridge takes the
    // switch before the poses that follow (messages keep their order).
    const want: EditLayer = e.layer === 'ui' ? 'ui' : 'world';
    if (editLayers && want !== editLayer) setEditLayer(want);
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
      } else if (c.kind === 'motion' || c.kind === 'motion-lib' || c.kind === 'motion-rename') timeline.apply(c, dir);
      else if (c.kind === 'ui-set' || c.kind === 'ui-theme') uiWire.apply(c, dir);
      else if (c.kind === 'name') worldModel.rename(c.key, dir === 'undo' ? c.from : c.to);
      // A code layout's changes (studio-code-base): the game lays it out again from the draft.
      else if (c.kind === 'code-place') {
        worldModel.places.set(c.key, dir === 'undo' ? c.from : c.to);
        placesChanged(swapsHand(c.from, c.to));
      }
      // Put in this level from the Library (placeHere): undo hides it again, redo shows it again.
      else if (c.kind === 'place') {
        if (dir === 'undo') {
          model.remove(c.key);
          removes.push(c.key);
        } else {
          model.unremove(c.key);
          restores.push(c.key);
        }
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
    // A name back or again (Rename): every place that shows it is drawn again, and the draft follows.
    if (list.some((c) => c.kind === 'name')) {
      renderAll();
      keepSoon();
    }
    // What came back is selected; what went away is not.
    const gone = new Set(list.filter((c) => ((c.kind === 'add') !== (dir === 'redo') && (c.kind === 'add' || c.kind === 'remove')) || (c.kind === 'place' && dir === 'undo')).map((c) => c.key));
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
    // The Library → the game ("Show in game →"): the Scene with the object picked.
    selectObject: (k) => {
      switchTool('placement');
      selectObject(k, true);
    },
    // The Library → the game: a file's "Show in game →" picks every object that uses the file.
    selectObjects: (keys) => {
      switchTool('placement');
      const known = keys.filter((k) => items.some((i) => i.key === k));
      if (known.length === 1) selectObject(known[0]!, true);
      else if (known.length) selectMany(known, known[0]!);
    },
    // The objects, for the Library's one grid (no `showObjects`: the Library narrows to a file's objects itself).
    objects: libraryObjects,
    motions: libraryMotions,
    switchTool: (id) => switchTool(id),
    changed: () => renderButtons(),
    phone,
    ask: (r) => askAi(r),
    files: fileUse,
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
    // The Library is the world's objects and files: opening it from the UI layer goes back to the world (UI stage 1).
    if (id === 'library' && editLayer === 'ui') setEditLayer('world');
    page = 'tool';
    if (id === tool && (mounted || id === 'placement')) {
      renderAll();
      return;
    }
    tool = id;
    // Files picked in the Library belong to that visit: the next one starts with none (its panel tells us again).
    filePick = [];
    // Phone: the Library is its own sheet; the scene list closes behind it. The Scene from the Library sheet (its
    // head's switch) opens the Scene's list sheet over the game.
    if (phone()) {
      sheetOpen = id === 'placement';
      unfoldFor();
    }
    // The objects' files may have changed while the Library was away (copies, the AI's change): read them again.
    if (id === 'library') {
      usesP = null;
      libraryObjects.refreshUses();
    }
    renderAll(true);
  }

  function openSettings() {
    page = 'settings';
    if (phone()) sheetOpen = true;
    unfoldFor();
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
    playMoreBtn.hidden = !uiPrefs.show.play;
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
    unfoldFor();
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
      // The files it is drawn with (the Library's "Asset" row), so "make this enemy the boss" names its model too.
      const files = usesNow?.get(k);
      // An unnamed object's label is its tree path ("path:7"): send the name the person sees instead (names.ts, guessed
      // from its shape, colour and place, "Black pillar by the road (left, 3rd)"), the AI's hint for the name to give it
      // and the words the person will use for it (a hands-on try, 2026-10-19).
      const label = it?.unstable ? displayName(it, t) : it?.label;
      return { key: k, label, pose: model.pose(k), unstable: it?.unstable || undefined, ...(files?.length ? { files: files.slice() } : {}) };
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
    // Each object's files go with it (requestObjects). Not read yet (the Library was never opened in this game page):
    // read them now, but never hold the request up for more than a second — the words matter, the files are a hint.
    if (r.objects?.length && !usesNow && !host.offline) {
      await Promise.race([readUses().catch(() => null), new Promise((ok) => window.setTimeout(ok, 1000))]);
      const keys = r.objects.map((o) => o.key);
      r = { ...r, objects: requestObjects(keys) };
    }
    const view = r.kind === 'ask' && editLayer === 'world' ? askView() : undefined;
    const res = await host.request({ ...r, lang, dim: worldDim, unsaved: dirtyCount() || undefined, ...(view ? { view } : {}), ...(editLayer === 'ui' && r.objects?.length ? { layer: 'ui' as const } : {}) }).catch((e) => ({ ok: false, error: (e as Error).message, id: undefined, at: undefined } as { ok: boolean; error?: string; id?: string; at?: number; watching?: boolean; seen?: string; undo?: boolean }));
    if (!res.ok) {
      showToast(t('ask.fail'));
      return false;
    }
    handedOver(r.kind, res.id, res.at, r.kind === 'ask' || r.kind === 'answer' || r.kind === 'play' ? r.text : undefined, res);
    return true;
  }

  /** The AI asked something and waits: the ask field and the line's buttons answer it. */
  function answering(): boolean {
    return !host.offline && currentPhase() === 'asking';
  }

  /** The person's answer to the AI's question (a choice button or their own words), as a request like any other. */
  function answerAi(text: string): Promise<boolean> {
    const st = aiStatus;
    const about = (st?.about ?? []).filter((k) => items.some((i) => i.key === k));
    return askAi({ kind: 'answer', text, ...(st?.request ? { to: st.request } : {}), ...(st?.note ? { question: st.note } : {}),
      ...(about.length ? { objects: requestObjects(about) } : {}) });
  }

  /** The one word the skill knows ("look", or its translation), copied by the chip in "How to open". */
  async function copyWord() {
    const word = t('ai.callText');
    const ok = await (navigator.clipboard?.writeText(word).then(() => true, () => false) ?? Promise.resolve(false));
    showToast(ok ? t('ai.called') : t('ai.callFail'));
  }

  /** Is the AI there (ai-presence.ts)? */
  function currentPresence(): AiPresence {
    return aiPresence({ now: Date.now(), watching: aiWatching, agent: aiAgent, phase: currentPhase(), statusTime: aiTime, lastWatching, visibleSince });
  }
  /** The AI's name for the words: {ai} / {Ai} (a sentence's start, English) / {ai2} (its second mention). */
  function aiVars(): Record<string, string> {
    const k = aiNameKey(aiAgent);
    const ai = t(`ai.name.${k}`);
    return { ai, Ai: ai.charAt(0).toUpperCase() + ai.slice(1), ai2: t(`ai.name2.${k}`), word: t('ai.callText') };
  }

  // Room the field's own words keep beside the presence words (px): spark, send and ~20 characters of placeholder.
  // Less than that and the words get their own line above (a first try inside a 600 px field cut the Japanese
  // placeholder in half — 2026-10-23).
  const PRESENCE_ROOM = 330;
  let lastPresence: AiPresence | null = null;
  // Whether the presence WORDS fit beside the field, as last measured with the words showing (fix-0140 ④): while they
  // are only the dot, the pill is 44 px and would always "fit", so the answer is kept from the last time it was words.
  let wordsNarrow = false;
  function renderPresence() {
    if (host.offline) {
      presence.hidden = true;
      presenceRow.hidden = true;
      return;
    }
    const p = currentPresence();
    const v = aiVars();
    presence.dataset.state = p;
    presence.classList.toggle('sure', presenceSure(p));
    (presence.querySelector('.p-text') as HTMLElement).textContent = t(`ai.p.${p}`, v);
    // "How to open" only where opening is the thing to do; the green states read alone.
    const how = p === 'away' || p === 'unsure';
    const howEl = presence.querySelector('.p-how') as HTMLElement;
    howEl.textContent = how ? t('ai.p.how') : '';
    howEl.hidden = !how;
    presence.setAttribute('aria-expanded', helpOpen ? 'true' : 'false');
    presence.title = t('ai.p.tip');
    // Where: inside the field on a wide bar, on its own line above on a narrow one. offsetWidth 0 = not laid out yet
    // (a hidden bar): leave it where it is.
    // A phone / the side window (plan step 7, 2026-10-23): back inside the field, as ONLY its dot (shell.css; green =
    // watching, grey = not sure / away) — its own line above the field was one of the four blocks stacked at the foot
    // (a try in the side window, 10/21: "too hard to use from the Claude sidebar"). A press on the dot opens the same one line of what is
    // true and what to do (openHelp), so the words are one press away; the button's name carries them for a reader.
    // PC with the motion timeline open (fix-0140 ④ of the first-run check, 2026-10-23): the words' own line above the
    // field made the AI bar two rows tall, and with a path shown it covered the path's handles and the lower half of the
    // area box (PC 1280, Japanese — the words do not fit beside the Japanese field). While the timeline is open the bar
    // is one row: when the words would need a line of their own, they are the dot inside the field (as on a phone; a
    // press on it opens the same line of what is true). English fits beside the field and keeps its words.
    const box = placementPanel.askEl;
    const w = box.offsetWidth;
    if (!presence.classList.contains('dot-only') && w > 0) wordsNarrow = w < presence.offsetWidth + PRESENCE_ROOM;
    const tlOpen = !phone() && app.dataset.timeline === 'open';
    const dotOnly = phone() || (tlOpen && wordsNarrow);
    const narrow = !dotOnly && wordsNarrow;
    const want = narrow ? presenceRow : box;
    if (presence.parentElement !== want) {
      if (want === box) box.insertBefore(presence, box.querySelector('.ask-kbd'));
      else presenceRow.append(presence);
    }
    presence.classList.toggle('dot-only', dotOnly);
    if (dotOnly) presence.setAttribute('aria-label', how ? `${t(`ai.p.${p}`, v)} · ${t('ai.p.how')}` : t(`ai.p.${p}`, v));
    else presence.removeAttribute('aria-label');
    presenceRow.hidden = !narrow || askSlot.hidden;
    renderOpenHelp(p, v);
    // The placeholder says the other half ("kept as a note for Claude"): drawn again when the state changes by time.
    if (p !== lastPresence) {
      lastPresence = p;
      placementPanel.renderAsk();
    }
  }

  /** The line the presence words open: what is true now, and what to do (its chip copies the word). */
  function toggleOpenHelp(on = !helpOpen) {
    helpOpen = on;
    renderPresence();
  }
  function renderOpenHelp(p: AiPresence, v: Record<string, string>) {
    openHelp.hidden = !helpOpen;
    if (!helpOpen) return;
    const key = p === 'watching' || p === 'working' ? `ai.open.${p}` : `ai.open.${aiNameKey(aiAgent)}`;
    const sig = `${key}|${lang}|${v.ai}`;
    if (openHelp.dataset.sig === sig) return;
    openHelp.dataset.sig = sig;
    // The word as a chip where the step says to type it (Codex, an unknown AI): copies on a press, and says so.
    const word = key === 'ai.open.codex' || key === 'ai.open.any';
    openHelp.replaceChildren(h('span', { class: 'ai-text', text: t(key, v) }),
      ...(word ? [h('button', { type: 'button', class: 'link', dataset: { action: 'ai-copy-word' }, onclick: () => void copyWord() }, h('span', { text: t('ai.open.copy', v) }))] : []),
      h('button', { type: 'button', class: 'link icon-only', dataset: { action: 'ai-open-close' }, title: t('ai.open.close'), 'aria-label': t('ai.open.close'), onclick: () => toggleOpenHelp(false) }, icon('close')));
  }

  // The objects the AI's question is about glow in the scene (instead of the AI's change marks) while it asks.
  function marksNow(): { keys: string[]; label?: string } {
    const v = currentPhase() === 'asking' ? aiStatus?.about?.filter((k) => items.some((i) => i.key === k)) : undefined;
    return v?.length ? { keys: v, label: t('ai.askTag') } : aiMarksMsg;
  }
  function sendMarks(force = false) {
    const m = marksNow();
    const sig = JSON.stringify(m);
    if (!force && sig === askLit) return;
    askLit = sig;
    send({ type: 'studio:placement/marks', ...m });
  }

  function handedOver(kind: NonNullable<typeof pending>['kind'], id?: string, at?: number, text?: string, info?: { watching?: boolean; seen?: string; undo?: boolean }) {
    // A new request: the marks of the AI's previous change are history now.
    aiReloadFor = null;
    aiBase = null;
    aiBaseCode = null;
    aiAfter = null;
    lastChange = null;
    // The host's answer says at once whether an AI watches (no 20 s of not knowing).
    if (info?.watching !== undefined) aiWatching = info.watching;
    if (aiWatching) lastWatching = Date.now();
    if (info?.seen) aiSeen = info.seen;
    if (id && info?.undo && !changeFrom) changeFrom = id;
    if (aiMarks.size) {
      aiMarks = new Map();
      placementPanel.markRows();
      aiMarksMsg = { keys: [] };
      sendMarks(true);
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
    // Keep the keyboard where it was: the line is drawn again on every poll, and a focused button replaced by its twin
    // drops the focus to the page (the line would then fade under someone tabbing through it).
    const focused = aiLine.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.action : undefined;
    aiLine.replaceChildren();
    aiLine.className = 'ai-line';
    const ph = currentPhase();
    const busy = aiBusy(ph);
    // The violet light round the input (shell.css) follows this, and so does the AI dot.
    app.dataset.ai = busy ? 'busy' : ph;
    aiLine.classList.add(ph);
    const covered = pending ? statusCovers({ id: pending.id ?? '', at: pending.at }, aiStatus, aiTime) : false;
    // "More in Claude" at the end of the grey row when the AI did or said something (ai-flow.ts moreIn, 2026-10-21). Its
    // own span that never shrinks: what was asked is the part cut with "…" when the row is too long (shell.css .has-more).
    const moreKey = moreIn(ph, aiAgent, !!host.offline);
    const two = (head: string, sub?: string) => {
      const say = h('span', { class: 'ai-text two' }, h('span', { class: 'ai-head', text: head }));
      if (moreKey) {
        say.append(h('span', { class: 'ai-sub has-more' }, ...(sub ? [h('span', { class: 'ai-said', text: sub }), h('span', { class: 'ai-dot', 'aria-hidden': 'true', text: '·' })] : []),
          h('span', { class: 'ai-more', dataset: { part: 'ai-more', agent: aiAgent ?? 'any' }, text: t(moreKey) })));
      } else if (sub) say.append(h('span', { class: 'ai-sub', text: sub }));
      aiLine.append(say);
    };
    // What was asked, small and grey under what is happening (verganti review): one glance says what and why.
    const asked = pending?.text ? t('ai.asked', { text: pending.text }).replace(/\s*→\s*$/, '') : '';
    const note = aiStatus?.note;
    const link = (action: string, ic: string, label: string, run: () => void, title?: string) =>
      aiLine.append(h('button', { type: 'button', class: 'link', dataset: { action }, title: title || label, disabled: undoBusy, onclick: run }, icon(ic), h('span', { text: label })));
    // A Save (plan step 6, save-receipt.ts): what was kept by name → "Claude is putting it in the code…" → "✓ In the
    // game (3) ▶ Play" + Undo AI change. A `sent` with no sign of the AI after UNSEEN_MS is the "no AI" fact, as below.
    const rc = pending?.kind === 'saved' && pending.saved
      ? receipt({ phase: ph === 'sent' && Date.now() - (pending.sent ?? 0) >= UNSEEN_MS ? 'away' : ph, things: pending.saved, total: pending.savedTotal ?? 0, vars: aiVars(), t })
      : null;
    if (rc) {
      if (ph === 'done') aiLine.classList.add('saved-in');
      two(rc.head, rc.sub);
      if (ph === 'done') aiLine.querySelector('.ai-head')?.prepend(icon('check'));
      if (rc.play && !playing) link('ai-play', 'play', t('btn.play'), () => void togglePlay());
      if (ph === 'done' && lastChange && host.undoAi && !playing) link('ai-undo', 'undo', t('ai.undo'), () => void undoAiChange(false));
    } else if (ph === 'waiting' && pending) {
      // Hosts that cannot tell whether an AI watches (and the offline demo): the old line.
      aiLine.append(h('span', { class: 'ai-text', text: pending.text ? t('ai.waitingAsk', { text: pending.text }) : pending.kind === 'saved' ? t('ai.waitingSaved') : t('ai.waiting', { what: t(`ai.what.${pending.kind}`) }) }));
    } else if (ph === 'seen' || (ph === 'sent' && Date.now() - (pending?.sent ?? 0) < UNSEEN_MS)) {
      // The AI has it: "Claude is on it" (ai presence, a hands-on review 2026-10-23), then "Done". `sent` (a heartbeat, not yet
      // shown to the AI) says the same for UNSEEN_MS; after that the fact below, not a hanging "on it".
      two(t('ai.onIt', aiVars()), asked || (pending?.kind === 'saved' ? t('ai.savedSub') : ''));
    } else if (ph === 'away' || ph === 'nudge' || ph === 'sent') {
      // Nothing can wake the AI right now (hands-on test 2026-10-19; ai presence 2026-10-23). The fact, not a promise:
      // "Kept as a note for Claude. Nothing in the game changes until Claude reads it." — it was "Your request is in.
      // It goes into the game the next time your AI runs.", which read as "I asked and nothing happened". What was
      // asked stays under it (proof the note exists). "How to open" is the presence words right under this line (no
      // second button here: two "How to open" a finger apart read as two different things).
      // In Claude Code the plugin's hooks wake the AI, so this is rare there (ai-wake.mjs).
      two(t('ai.kept', aiVars()), asked || (pending?.kind === 'saved' ? t('ai.savedSub') : ''));
    } else if (ph === 'received' || ph === 'working') {
      // Its own words while it works; none: "Claude is on it". Quiet for QUIET_WORK_MS: how long, so silence looks alive.
      const quiet = aiTime != null ? Date.now() - aiTime : 0;
      const still = quiet >= QUIET_WORK_MS ? t('ai.still', { n: Math.floor(quiet / 60_000) }) : '';
      two(note ? `${note.replace(/[.…]+$/, '')}…` : t('ai.onIt', aiVars()), [covered ? asked : '', still].filter(Boolean).join(' · '));
    } else if (ph === 'asking') {
      // The AI's question, answered here (hands-on test 2026-10-19; ai-ask.ts): the question, what it is
      // about lit in the scene, now → after side by side, its answers as buttons; the ask field takes their own words.
      const v = questionView(aiStatus, (k) => ({ was: model.original(k), now: model.pose(k) }), dim, { turn: t('ai.cmp.turn'), size: t('ai.cmp.size') });
      two(note || t('ai.asking'), note ? t('ai.asking') : t('ai.askingSub'));
      const lit = v ? v.about.filter((k) => items.some((i) => i.key === k)) : [];
      if (v?.compare) {
        aiLine.append(h('div', { class: 'ai-compare', dataset: { part: 'ai-compare' } },
          h('span', { class: 'was' }, h('span', { class: 'k', text: t('ai.before') }), h('span', { class: 'v', text: v.compare.before })),
          h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }),
          h('span', { class: 'now' }, h('span', { class: 'k', text: t('ai.after') }), h('span', { class: 'v', text: v.compare.after }))));
      }
      // The answers, then "Show it in the scene" at the end of the same row (on its own row it took a whole line in the
      // side window and on a phone).
      const row = h('div', { class: 'ai-choices', role: 'group', 'aria-label': t('ai.asking') },
        ...(v?.choices ?? []).map((c, i) => h('button', { type: 'button', class: i === 0 ? 'choice primary' : 'choice', dataset: { action: 'ai-answer' }, onclick: () => void answerAi(c) }, c)));
      if (lit.length) {
        row.append(h('button', { type: 'button', class: 'choice icon-only', dataset: { action: 'ai-ask-show' }, title: t('ai.askShow'), 'aria-label': t('ai.askShow'),
          onclick: () => {
            switchTool('placement');
            if (lit.length === 1) selectObject(lit[0]!, true);
            else selectMany(lit, lit[0]!);
          } }, icon('eye')));
      }
      if (row.childNodes.length) aiLine.append(row);
    } else if (ph === 'updating') {
      two(note || t('ai.updating'), t('ai.updating'));
    } else if (ph === 'done' || ph === 'failed') {
      const s = aiStatus!;
      const n = typeof s.changed === 'number' ? s.changed : 0;
      const count = ph === 'failed' ? t('ai.failed') : n === 1 ? t('ai.done1') : n > 1 ? t('ai.doneN', { n }) : t('ai.done');
      // The AI's one-line reply first (its note), then the count, then "More in Claude".
      // fix-0141 (J1 ⑤ and ⑩ of the first-run check, 2026-10-24): the second row was "“what you asked” · 3 objects ch…",
      // cut by Undo AI change and 👁 (English, 1280) — and what was asked says the same as the AI's own words above it, so
      // it is gone here (it stays while the AI works). And with the AI's words and nothing counted, the product's "Done"
      // after them read as "Done" twice ("Made the change · Done"): the AI's words are the done, the row is only
      // "More in Claude". A change in code that Undo AI change cannot take back (no count) leaves what changed to
      // "More in Claude" — the AI's chat says it in full.
      two(s.note || count, s.note && (ph === 'failed' || n > 0) ? count : '');
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
        link('ai-reload', 'undo', t('ai.reload'), () => void confirmLoss('reload').then((go) => {
          if (!go) return;
          aiReloadFor = aiStatus?.at ?? null;
          void softReload('ai');
        }));
      }
    } else if (ph === 'undone' || ph === 'redone') {
      two(t(ph === 'undone' ? 'ai.undone' : 'ai.redone'), ph === 'undone' ? t('ai.undoneSub') : '');
      if (lastChange && host.undoAi && !playing) {
        if (ph === 'undone' && lastChange.redo) link('ai-redo', 'redo', t('ai.redo'), () => void undoAiChange(true));
        else if (ph === 'redone') link('ai-undo', 'undo', t('ai.undo'), () => void undoAiChange(false));
      }
    }
    aiLine.hidden = !aiLine.childNodes.length;
    fadeLine(ph);
    tuckAiLine(ph);
    if (focused && !aiLine.hidden) (aiLine.querySelector(`[data-action="${focused}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
    sendMarks();
    // The ask field becomes the answer field while the AI asks (and goes back after).
    if ((ph === 'asking') !== wasAsking) {
      wasAsking = ph === 'asking';
      placementPanel.renderAsk();
    }
    renderPresence();
    // The whole line on hover (it is cut to one line).
    aiLine.title = aiLine.hidden ? '' : aiLine.textContent || '';
    sendPlayLine();
  }

  /**
   * A finished line (done / undone / redone) stays lineStayMs, longer while the pointer or keyboard is in it, then
   * fades and stays gone across polls (lineGone). Every other phase shows as long as it is true (line-fade.ts).
   */
  function fadeLine(ph: AiPhase) {
    if (!lineFades(ph) || aiLine.hidden) {
      clearTimeout(lineTimer);
      lineShown = '';
      lineFading = false;
      caption.classList.remove('fading');
      return;
    }
    const key = lineKey(ph, aiStatus?.at, aiStatus?.note, aiAfterTurn);
    if (key === lineGone) {
      aiLine.hidden = true;
      caption.classList.remove('fading');
      return;
    }
    if (key !== lineShown) {
      lineShown = key;
      lineFading = false;
      clearTimeout(lineTimer);
      lineTimer = window.setTimeout(lineDue, lineStayMs(aiLine.textContent || ''));
    }
    // A poll during the fade draws the line again: keep it fading.
    aiLine.classList.toggle('fading', lineFading);
    caption.classList.toggle('fading', lineFading && onlyLine());
  }
  /** ④ (studio-fix-0142): a finished line as a chip beside the ask field while the timeline is open on PC (`aiTuck` above). */
  function tuckAiLine(ph: AiPhase) {
    const tuck = !phone() && app.dataset.timeline === 'open' && !aiLine.hidden && lineFades(ph) && !!lineShown && aiTuckOpen !== lineShown;
    aiLine.classList.toggle('tucked', tuck);
    aiTuck.hidden = !tuck;
    if (!tuck) return;
    const box = placementPanel.askEl;
    if (aiTuck.parentElement !== box) box.insertBefore(aiTuck, box.querySelector('.ask-input'));
    const head = aiLine.querySelector('.ai-head')?.textContent?.trim() || aiLine.textContent?.trim() || '';
    if (aiTuck.dataset.text !== head) {
      aiTuck.dataset.text = head;
      aiTuck.replaceChildren(h('span', { class: 'ai-tuck-dot', 'aria-hidden': 'true' }), ...(ph === 'done' ? [icon('check')] : []), h('span', { class: 'ai-tuck-w', text: head }));
    }
    aiTuck.title = aiLine.textContent?.trim() || head;
  }
  /** The caption shows nothing but the AI line (then the whole frosted card fades with it, not just its text). */
  function onlyLine(): boolean {
    return ![...caption.children].some((c) => c !== aiLine && captionShows(c));
  }
  function lineDue() {
    if (aiLine.matches(':hover, :focus-within') || Date.now() - lineLeft < LINE_GRACE_MS) {
      lineTimer = window.setTimeout(lineDue, 500);
      return;
    }
    lineFading = true;
    aiLine.classList.add('fading');
    if (onlyLine()) caption.classList.add('fading');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    lineTimer = window.setTimeout(() => {
      lineGone = lineShown;
      lineShown = '';
      lineFading = false;
      renderAiLine();
    }, reduce ? 0 : LINE_FADE_MS);
  }
  // In the line = it stays. Coming back during the fade stops it.
  const lineHeld = () => {
    if (!lineFading) return;
    lineFading = false;
    aiLine.classList.remove('fading');
    caption.classList.remove('fading');
    clearTimeout(lineTimer);
    lineTimer = window.setTimeout(lineDue, LINE_GRACE_MS);
  };
  const lineLeaves = () => {
    lineLeft = Date.now();
  };
  aiLine.addEventListener('pointerenter', lineHeld);
  aiLine.addEventListener('focusin', lineHeld);
  aiLine.addEventListener('pointerleave', lineLeaves);
  aiLine.addEventListener('focusout', lineLeaves);
  /** The faded line is still the current one (nothing newer): "● AI" / ⌘K can bring it back. */
  function lineRecallable(): boolean {
    const ph = currentPhase();
    return !!lineGone && lineFades(ph) && lineKey(ph, aiStatus?.at, aiStatus?.note, aiAfterTurn) === lineGone;
  }
  function recallLine() {
    if (!lineRecallable()) return;
    lineGone = '';
    lineShown = '';
    // Folded (phone / side window), shell.css hides the AI's line: "Show your AI's last reply" from ⌘K drew it there
    // unseen — the press did nothing to look at, and its Undo could not be reached (test-fix, 2026-10-21). Asking for
    // the line is a person's own press, so it unfolds, as opening a page in the sheet does (sheet-fold.ts). Only the
    // fold: the list stays as it was (closed), so the line shows over the bar with the card, not under a sheet.
    if (fold && phone()) {
      unfoldFor();
      renderAll(true);
      return;
    }
    renderAiLine();
  }

  // ----- ask while playing (§3.5; bridge/play-ask.ts draws it in the game page, full screen too) -----
  // `playSince`: when this Play began; only a request made since then has a line over the game (an earlier "done"
  // from the editor is not news to someone playing). `playSig`: the last line sent, so a poll that changes nothing
  // sends nothing.
  let playSince = 0;
  let playSig = '';
  // The game page answered play/hello with an AI behind the host: the ask field is there. `playMark`: what play/on last
  // said about the corner mark (sent again when the layout changes, renderPlayAsk).
  let playAskOn = false;
  let playMark: boolean | null = null;
  let playNow: ReturnType<typeof playLine> = null;
  // The game page is paused (play/paused): the phone's ❚❚ shows ▶. ✦ stays where it is (the buttons must not shift under
  // the finger that pressed ❚❚); pressed while paused it takes the person to the chat's field.
  let playPaused = false;
  // P pressed while playing before the game page said play/hello (P right after Play, as in walk #14): the pause is
  // sent when it does, so that P is not lost. Cleared whenever a new Play or Edit starts.
  let pauseSoon = false;
  /** P while playing: the game page's pause (play-ask.ts: pause, or resume when paused — the same as its ❚❚). */
  function pressPause() {
    if (playAskOn) postGame({ type: 'studio:play/pause' });
    else pauseSoon = !pauseSoon;
  }
  function renderPlayAsk() {
    const show = playing && playAskOn && phone();
    playAskBtn.hidden = !show;
    playPauseBtn.hidden = !show;
    if (show) setButton(playPauseBtn, playPaused ? 'play' : 'pause', playPaused ? t('play.resume') : t('play.pause'), false, playPaused ? t('play.resumeTip') : t('play.pauseTip'));
    if (playing && playAskOn && playMark !== !phone()) {
      playMark = !phone();
      postGame({ type: 'studio:play/on', lang, words: playWords(t), mark: playMark, config: gameConfig, handlePx: handlePx() });
    }
    if (!show) return;
    setButton(playAskBtn, 'spark', t('play.ask'), false, t('play.askTip'));
    // The AI's state on the ✦ while the corner mark is not drawn: a pulse while it looks / fixes, a ring while a fix
    // waits for Reload (the corner mark's dot did both).
    const st = playNow?.state;
    playAskBtn.dataset.state = st === 'looking' || st === 'fixing' ? 'busy' : st === 'fixed' ? 'ready' : '';
  }
  function postGame(m: ShellToBridge) {
    try {
      iframe.contentWindow?.postMessage(m, gameOrigin);
    } catch {
      /* the frame is changing */
    }
  }
  function sendPlayLine(force = false) {
    if (!playing || host.offline) return;
    const mine = !!pending && pending.sent >= playSince;
    const v = mine ? playLine({ phase: currentPhase(), status: aiStatus, asked: pending?.text,
      codeChanged: code === undefined || loadedCode === undefined ? undefined : code !== loadedCode, agent: aiAgent, t }) : null;
    const sig = JSON.stringify(v);
    if (!force && sig === playSig) return;
    playSig = sig;
    playNow = v;
    postGame({ type: 'studio:play/state', state: v });
    renderPlayAsk();
  }

  /**
   * "Undo AI change" / "Redo": the host puts the game's files back (one
   * press, at once, whether or not the AI still watches) and tells the AI.
   * Then the game reloads behind the old picture like after any change.
   */
  async function undoAiChange(redo: boolean) {
    const to = redo ? lastChange?.redo : lastChange?.from;
    if (!host.undoAi || !lastChange || !to || undoBusy) return;
    // The files change first, then the game reloads: ask before either (a game tool's data, unsaved-guard.ts).
    if (!(await confirmLoss('reload'))) return;
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
    aiAfterTurn++;
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
  // The files' signature whose reload was asked about (unsaved game tool data): not asked again for the same change.
  let heldFor: string | undefined;
  async function pollStatus() {
    clearTimeout(pollTimer);
    if (document.visibilityState !== 'hidden') {
      const r = await host.status().catch(() => null);
      if (r) {
        aiStatus = r.status;
        aiTime = r.time;
        if (r.watching !== undefined) aiWatching = r.watching;
        if (aiWatching) lastWatching = Date.now();
        if (r.seen) aiSeen = r.seen;
        aiAgent = r.agent;
        // Every string's {ai} (i18n.ts setAiName): the AI's own name once the status says who it is.
        setAiName(aiNameKey(aiAgent));
        if (r.code !== code) {
          code = r.code;
          codeSince = Date.now();
        }
        // The first answer after the game was opened is what the game in the frame was built from.
        if (loadedCode === undefined) loadedCode = code;
      }
      const go = reloadDecision({ code, loadedCode, stableMs: Date.now() - codeSince, phase: currentPhase(), playing, reloading: !!swapping });
      if (go === 'now' && lostNow('reload') > 0) {
        // The AI's change would reload the game page and lose a game tool's unsaved data: ask once per change. Cancel
        // keeps the old page until the person saves (then the next poll reloads by itself) or the AI changes it again.
        if (heldFor !== code) {
          heldFor = code;
          const at = aiStatus?.state === 'done' || aiStatus?.state === 'failed' ? aiStatus.at ?? null : undefined;
          void confirmLoss('reload').then((ok) => {
            if (!ok || swapping || playing) return;
            if (at !== undefined) aiReloadFor = at;
            void softReload('ai');
          });
        }
      } else if (go === 'now') {
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
    if (document.visibilityState !== 'visible') return;
    visibleSince = Date.now();
    void pollStatus();
  });

  // ----- bridge messaging -----
  function send(m: ShellToBridge) {
    if (!bridgeAlive || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(m, gameOrigin);
  }

  /** Edit the world or the UI (UI stage 1): the bridge swaps the adapter and answers with that layer's list. */
  function setEditLayer(l: EditLayer) {
    if (!editLayers || !editLayers.includes(l) || l === editLayer || playing) return;
    useLayer(l);
    send({ type: 'studio:core/layer', layer: l });
    renderAll();
  }
  /** Show / hide the game's UI while the world is edited (the bridge's style sheet; nothing saved). */
  function setUiPeek(on: boolean) {
    if (!editLayers || editLayers.length < 2) return;
    uiPeek = on;
    send({ type: 'studio:core/ui-peek', on });
    renderAll();
  }
  /** The shell's side of a switch: that layer's model and list, nothing picked, no tool chosen. */
  function useLayer(l: EditLayer) {
    // A button's look shown on the UI goes back to normal when the UI is left.
    if (l !== 'ui') uiWire.picked(null);
    editLayer = l;
    model = l === 'ui' ? uiModel : worldModel;
    items = l === 'ui' ? uiItems : worldItems;
    selected = null;
    group = [];
    stripTool = null;
  }

  function applyPose(key: string, pose: Pose) {
    model.moved(key, pose);
    send({ type: 'studio:placement/pose', key, pose });
    // The timeline open: the game shows this place + the object's motion at the time line, not the bare place.
    if (editLayer === 'world') timeline.refresh();
    placementPanel.updateNumbers();
    renderButtons();
  }

  function selectObject(key: string | null, focus = false) {
    selected = key;
    group = key ? [key] : [];
    // The card first, then the selection: "bring into view" must already know what the card covers.
    if (tool === 'placement' && page === 'tool') placementPanel.render();
    else placementPanel.renderAsk();
    renderShelf();
    renderSheet();
    sendInset();
    send({ type: 'studio:placement/select', key, focus });
    codePlaces.guide();
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
      if (!needsThumb(it.key) || thumbsAsked.has(it.key)) continue;
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
    for (const row of placementPanel.el.querySelectorAll<HTMLElement>('.obj[data-key], .noname[data-key]')) {
      const r = row.getBoundingClientRect();
      if (!r.height || r.bottom < box.top || r.top > box.bottom) continue;
      const k = row.dataset.key!;
      // Not drawn yet and not already moved to the front for this view.
      if (needsThumb(k) && !visibleShown.has(k)) keys.push(k);
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
    // The strip's Motion button follows the pick, its motions and the layer (deduplicated: most messages change nothing;
    // a new game page has none, so it is told again).
    if (m.type === 'studio:core/hello' || m.type === 'studio:core/ready') motionTool.reset();
    motionTool.sync();
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
    if (timeline.onMessage(m)) return;
    if (m.type === 'studio:placement/at-is') return motionDrag.answer(m.id, m.key);
    // UI stages 2–3: the screens, an element's look, the theme (ui-wire.ts).
    if (uiWire.handle(m)) return;
    if (m.type === 'studio:placement/motion-press') return motionTool.press(m.key, m, m.touch, m.keyboard);
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
      case 'studio:core/ready': {
        // ▶ Play in the same page (fast switch): the page's editor put its tools away for Play (editing: false). Nothing
        // about the page changed; the shell is in Play already (togglePlay). Back in Edit, editing: true comes as usual.
        if (playing && playHere && !m.editing) {
          // The page put its screens, samples and button looks back for Play (ui-extras.ts end).
          uiWire.pageReset();
          break;
        }
        // UI stage 1: which layers the game has (none listed = no UI: as before) and which one the bridge edits now.
        // A new game page (a reload, Play and back) always starts on the world.
        editLayers = m.layers && m.layers.length ? m.layers.slice() : null;
        const lay: EditLayer = m.layer === 'ui' && editLayers ? 'ui' : 'world';
        if (lay !== editLayer) useLayer(lay);
        if (lay === 'world') worldDim = m.dim;
        // A game that is all HTML (a UI and no world): the file says 2d with no objects (ui-layer.ts).
        if (editLayers && !editLayers.includes('world')) worldDim = worldModel.dim = '2d';
        dim = m.dim;
        canRise = !!m.rise;
        canFly = !!m.fly;
        canDrop = !!m.drop;
        motionHere = !!m.motionHere;
        // A new game page starts with its UI hidden over the world: say so again when it was shown (setUiPeek).
        if (uiPeek && editLayers && editLayers.length > 1) send({ type: 'studio:core/ui-peek', on: true });
        adapterInfo = `${m.kind}${m.version ? ' ' + m.version : ''}`;
        editing = m.editing;
        phase = 'ready';
        if (!m.editing && !playing) {
          send({ type: 'studio:core/lang', lang });
          if (multi) send({ type: 'studio:placement/multi', on: true });
          send({ type: 'studio:core/ui', handlePx: handlePx(), theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' });
          send({ type: 'studio:core/config', config: gameConfig });
          send({ type: 'studio:core/edit', on: true, viewState: keptView() });
          insetSent = '';
          sendInset();
        }
        renderAll();
        break;
      }
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
      // ⑨ B (studio-fix-0143): a list pick under the open plate — fold it to its line; the wire then asks to reveal.
      case 'studio:core/plate-fold':
        if (m.key === selected) timeline.slimFor(m.key);
        break;
      case 'studio:core/key':
        shortcut({ key: m.key, ctrl: m.ctrl, meta: m.meta, shift: m.shift, fromGame: true });
        break;
      case 'studio:core/error':
        // Say what to do, not only what broke (polish pass 2026-10-16). Long enough to read.
        showToast(t('status.adapterError', { msg: m.message }), 8000);
        break;
      // Ask while playing (§3.5): the game page can take a request; say whether an AI can get one (never offline).
      case 'studio:play/hello':
        if (playing && !host.offline) {
          playAskOn = true;
          playMark = !phone();
          postGame({ type: 'studio:play/on', lang, words: playWords(t), mark: playMark, config: gameConfig, handlePx: handlePx() });
          sendPlayLine(true);
          renderPlayAsk();
          // After play/on: the pause needs the overlay that play/on builds (play-ask.ts pauseNow).
          if (pauseSoon) {
            pauseSoon = false;
            postGame({ type: 'studio:play/pause' });
          }
        }
        break;
      case 'studio:play/ask':
        if (playing && !host.offline) {
          void askAi({ kind: 'play', text: m.text, ...(m.shot ? { shot: m.shot } : {}), ...(m.view ? { view: m.view } : {}), ...(m.near ? { near: m.near } : {}),
            ...(m.logs ? { logs: m.logs } : {}), ...(m.fullscreen ? { fullscreen: true } : {}), ...(m.size ? { size: m.size } : {}),
            // From the chat over a paused game (2026-10-22): the talk so far, and the id of its first message.
            ...(m.paused ? { paused: true } : {}), ...(m.chat ? { chat: m.chat } : {}), ...(m.history?.length ? { history: m.history } : {}) })
            .then((ok) => postGame({ type: 'studio:play/sent', ok, ...(ok && pending?.id ? { id: pending.id } : {}) }));
        }
        break;
      case 'studio:play/paused':
        playPaused = playing && m.on;
        // On the shell too (screen tests read it: P while playing pauses, plan step 2).
        if (playPaused) app.dataset.paused = 'on';
        else delete app.dataset.paused;
        renderPlayAsk();
        break;
      case 'studio:play/answer':
        if (playing && !host.offline) void answerAi(m.text).then((ok) => postGame({ type: 'studio:play/sent', ok }));
        break;
      case 'studio:play/reload':
        // The person chose to see the fix: the game opens again from its new code, still in Play.
        if (playing) loadGame();
        break;
      case 'studio:core/levels': {
        // Levels (2026-10-22): the game said its levels. The first time (a file without levels), the opened file's
        // world part is the level on screen's. A page that built another level than the one restored (it ignored
        // the URL) gets that level's model, before its objects are listed.
        const was = levels.current;
        if (levels.fromGame(m.levels, m.current, startWorld)) {
          startWorld = undefined;
          if (was && was !== levels.current) useLevelModel(levels.current);
          // The AI built the New level in the code (it is the code's now): nothing more to hide on its page.
          else if (worldModel.blankKeep && !levels.isBlank()) worldModel.blankKeep = null;
          renderAll();
        }
        break;
      }
      case 'studio:core/game-error':
        if (!gameError) gameError = { message: m.message, where: m.where };
        if (playing) showToast(t('status.gameErrorToast', { msg: m.message }), 8000);
        renderStatus();
        break;
      // The game's code (studio-code-base, 2026-10-24): what the AI's --do motion.code / place.* find, and the knobs the AI
      // has written into the code since (the file's v = the code's v) leave the file without counting as a change.
      case 'studio:code-motions':
        codeMotionList = m.list;
        if (motionLibrary.settle(m.list)) (renderAll(), keepSoon());
        // A rule motion's knobs and strip read the list (studio-code-knobs): the timeline shows them now.
        timeline.render();
        break;
      case 'studio:code-places':
        codePlaceList = m.list;
        codeAvoidList = m.avoids;
        if (worldModel.places.settle(m.list)) keepSoon();
        // Where the rule put them is the code's place, not a move (studio-code-knobs: placement-model.ts codePoses).
        codePlaces.poses(worldItems.map((i) => ({ key: i.key, pose: i.pose })));
        renderAll();
        codePlaces.guide(true);
        break;
      // A code layout laid out again in place (studio-code-knobs; bridge/code-place.ts): where its objects stand now.
      case 'studio:place/poses':
        codePlaces.poses(m.poses);
        if (selected && m.poses.some((x) => x.key === selected)) placementPanel.updateNumbers();
        break;
      // A drag of a layout's object in the game turned its knob (live, then one undo step).
      case 'studio:place/knob':
        codePlaces.knob(m);
        if (m.end) keepSoon();
        break;
      // Keep-out areas in the game (studio-code-keepout; bridge/keep-out.ts): a box drawn / dragged, a ◇ turned, the
      // objects put by hand that stand in an area, "+ Draw a box" stopped there.
      case 'studio:place/avoid-box':
        keepOut.box(m);
        if (m.end) keepSoon();
        break;
      case 'studio:place/avoid-knob':
        keepOut.knob(m);
        if (m.end) keepSoon();
        break;
      case 'studio:place/avoid-inside':
        keepOut.inside(m);
        break;
      case 'studio:place/avoid-draw':
        keepOut.stopDraw();
        break;
      case 'studio:placement/items': {
        // UI stage 1: the UI layer's list feeds its own model; nothing of the world's below (the AI's marks, copies,
        // the frame swap) is about it. Its saved places go to the UI layer by name, whichever layer is on.
        if (m.layer === 'ui') {
          uiSeen = true;
          uiItems = m.items;
          uiWire.noteItems(m.items);
          // A new page: the looks and the theme the editor holds go back on it too (UI stage 3), before the moves.
          if (!uiRestored) uiWire.replay();
          // A new page's UI shows the UI as its code makes it: the moves made before (saved or not) go back, as for the world below.
          const uiLost = uiRestored ? null : uiModel.notShown(m.items);
          uiRestored = true;
          for (const a of uiModel.setItems(m.items, '2d')) send({ type: 'studio:placement/pose', key: a.key, pose: a.pose, layer: 'ui' });
          for (const a of uiLost?.poses || []) {
            uiModel.moved(a.key, a.pose);
            send({ type: 'studio:placement/pose', key: a.key, pose: a.pose, layer: 'ui' });
          }
          // As for the world below: a new `was` goes to the draft.
          if (uiLost?.code.length) keepSoon();
          if (editLayer === 'ui') {
            items = m.items;
            itemsSeen = true;
            if (selected && !items.some((i) => i.key === selected)) selected = null;
            group = group.filter((k) => items.some((i) => i.key === k));
            renderAll();
          }
          break;
        }
        worldItems = m.items;
        // The code's lists come right after (the bridge sends them only for a game that has code motions / layouts).
        codeMotionList = [];
        codePlaceList = [];
        codeAvoidList = [];
        rememberItems(m.items);
        // The world's list while the shell has just switched to the UI (sent before the bridge got the switch): kept
        // in the world's model only.
        if (editLayer === 'ui') {
          for (const a of worldModel.setItems(m.items, worldDim)) send({ type: 'studio:placement/pose', key: a.key, pose: a.pose, layer: 'world' });
          break;
        }
        // First list after "Reload the game" (AI done): what moved or is new
        // compared with what was on screen before the reload. Raw adapter
        // poses (the game's code as the AI left it), before the model's.
        // A page after the AI's change (its draft may have been tidied away by the AI: keepNow `again`, below).
        const afterAi = !!aiBefore;
        if (aiBefore) {
          const before = aiBefore;
          const beforeCode = aiBeforeCode;
          aiBefore = aiBeforeCode = null;
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
            else if (!samePose({ ...it.pose, z: undefined }, { ...was, z: undefined }, dim)) {
              // At its old code's pose: the person's unsaved move is not shown yet (it is pushed back below), not the AI's.
              const code0 = beforeCode?.get(it.key);
              if (!code0 || !samePose({ ...it.pose, z: undefined }, { ...code0, z: undefined }, dim)) aiMarks.set(it.key, 'moved');
            }
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
        // The guessed names of unnamed objects (names.ts) read from this list.
        noteItems(items);
        // New objects (copies, the AI's change): their files are read again for the Library (or when it opens next).
        usesP = null;
        if (libraryShown()) libraryObjects.refreshUses();
        // Elsewhere too, a moment later (copies and the AI's change come in bursts): the Scene's menu offers "Show its
        // asset in Library" and every request names each object's files, both from usesNow.
        else {
          clearTimeout(usesTimer);
          usesTimer = window.setTimeout(() => void readUses().catch(() => undefined), 1200);
        }
        if (marksNow().keys.length) sendMarks(true);
        // The first list of a NEW page (Play → Edit, the AI's reload): what of the arrangement it does not show, saved
        // or not (placement-model.ts notShown; a try of the editor, 2026-10-21: "Play without Save reset everything"). Read before
        // setItems, which takes the new page's draw order as the model's.
        const lost = placementRestored ? null : worldModel.notShown(m.items);
        const apply = worldModel.setItems(items, worldDim);
        // Continue from the last save: push saved poses the game does not show.
        if (!placementRestored || apply.length) {
          placementRestored = true;
          for (const a of apply) send({ type: 'studio:placement/pose', key: a.key, pose: a.pose });
        }
        if (lost) {
          if (lost.copies.length) send({ type: 'studio:placement/copy', items: lost.copies });
          if (lost.removes.length) send({ type: 'studio:placement/remove', keys: lost.removes });
          for (const a of lost.poses) {
            worldModel.moved(a.key, a.pose);
            send({ type: 'studio:placement/pose', key: a.key, pose: a.pose });
          }
          // The new code moved things (their `was` is new): the draft must say so before Play, whose bridge puts a move
          // only on an object standing at the draft's `was` (togglePlay writes it too; this is for a tab closed first).
          if (lost.code.length) keepSoon();
        }
        // After the AI's change, the unsaved arrangement goes to disk again even if it is what was written last: the AI
        // may have taken placement.json away while it worked (see keepNow), and a closed tab must not lose the moves.
        if (afterAi && placementDirty() > 0) void keepNow(true);
        // ... and the saved copies and deletions the AI has not put in the code yet.
        const fe = model.takeFileEdits();
        if (fe.copies.length) send({ type: 'studio:placement/copy', items: fe.copies });
        if (fe.removes.length) send({ type: 'studio:placement/remove', keys: fe.removes });
        if (selected && !items.some((i) => i.key === selected)) selected = null;
        group = group.filter((k) => items.some((i) => i.key === k));
        // A changed object's old picture is stale: shown until its new one comes (⑥), asked for again.
        for (const k of aiMarks.keys()) {
          if (thumbs.has(k)) staleThumbs.add(k);
          if (bigThumbs.has(k)) bigStale.add(k);
          bigShown.delete(k);
        }
        requestThumbs();
        renderAll();
        // A list (a new page, a copy, a removal): the timeline shows the moving ones at the time line again.
        timeline.refresh(true);
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
        // "+ Link an object" open on the timeline (studio-motion-focus): the click links that object; the pick stays.
        if (editLayer === 'world' && timeline.linkPick(m.key)) break;
        uiWire.picked(m.key);
        selected = m.key;
        group = m.keys && m.keys.length ? m.keys.slice() : m.key ? [m.key] : [];
        // With the Library on screen the game is hidden, so this is only the game's echo of a pick made in the
        // Library: stay there (going to the Scene here was the try's "pressing an object throws me back to the
        // game", 10/18). A pick made in the game itself (the Scene) still lands on the Scene.
        if (libraryShown()) {
          placementPanel.renderAsk();
          renderShelf();
        } else if (tool !== 'placement') switchTool('placement');
        else if (page === 'tool') placementPanel.render();
        else placementPanel.renderAsk();
        timeline.untouch();
        timeline.render();
        renderSheet();
        sendInset();
        // The violet rings of the pick's code layout (studio-code-knobs), or none.
        codePlaces.guide();
        // "+ New motion" was pressed with nothing picked (studio-motion-flow): this pick is the object it was for.
        if (makeOnPick && m.key && group.length <= 1 && editLayer === 'world' && !libraryShown()) {
          const ok = Date.now() < makeOnPick;
          makeOnPick = 0;
          if (ok) timeline.make(m.key);
        }
        break;
      case 'studio:placement/moved': {
        // The game's echo of a pose the shell set (undo, a typed number): that pose is a place, as it always was.
        const hand = editLayer === 'world' && !m.set;
        if (hand) timeline.untouch();
        // The timeline open with auto key on: the move is a key at the time line, the place stays (timeline-wire.ts).
        if (hand && timeline.moved(m.key, m.pose, !!m.end, m.from)) {
          if (m.key === selected) placementPanel.updateNumbers();
          renderButtons();
          break;
        }
        // Otherwise the place moves; with the timeline open, what the game shows is the place + the motion now.
        if (hand) (m.pose = timeline.placeFor(m.key, m.pose)), m.from && (m.from = timeline.placeFor(m.key, m.from));
        // An object of a code layout (studio-code-knobs): ⌥-dragged (or a turn / a resize) = just this one by hand, its
        // pin (one undo step); never an `objects` entry of its own.
        if (hand && codePlaces.moved(m.key, m.pose, !!m.end)) {
          if (m.key === selected) placementPanel.updateNumbers();
          renderButtons();
          break;
        }
        model.moved(m.key, m.pose);
        if (m.end && m.from) undo.push(poseChange(m.key, m.from, m.pose));
        if (m.end && hand) timeline.refresh();
        // A tip forward / sideways adds the card's Tilt row: draw the card again when that changes.
        if (m.key === selected && m.end && !!m.pose.t !== !!m.from?.t && tool === 'placement' && page === 'tool') placementPanel.render();
        else if (m.key === selected) placementPanel.updateNumbers();
        renderButtons();
        break;
      }
      case 'studio:placement/moved-group': {
        // The timeline: those that record become keys (one undo step with the others' moves), the rest move their place.
        const tl0 = editLayer === 'world' ? timeline.movedGroup(m.poses, !!m.end) : { rest: m.poses, changes: [] };
        // A code layout's objects among them (studio-code-knobs): their pins, in the same undo step.
        const cp = editLayer === 'world' ? codePlaces.groupMoved(tl0.rest, !!m.end) : { rest: tl0.rest, changes: [] };
        const tl = { rest: cp.rest, changes: [...tl0.changes, ...cp.changes] };
        for (const e of tl.rest) model.moved(e.key, e.pose);
        if (m.end) {
          undo.push({ changes: [...tl.rest.filter((e) => e.from).map((e) => ({ kind: 'pose' as const, key: e.key, from: e.from!, to: e.pose })), ...tl.changes] });
          emit('moved', { keys: m.poses.map((e) => e.key) });
          if (editLayer === 'world') timeline.refresh();
        }
        renderButtons();
        break;
      }
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
        // The Library's "Add to scene": now the Scene, with the copies picked (the bridge picks them; its
        // placement/selected comes next and lands on the Scene). The camera stays: the copies are where it looks.
        const added = m.items.filter((a) => addingToScene.delete(a.key));
        for (const k of m.failed) addingToScene.delete(k);
        if (added.length) {
          if (tool !== 'placement' || page !== 'tool') {
            tool = 'placement';
            page = 'tool';
            if (phone()) sheetOpen = false;
            renderAll(true);
          }
          showToast(t('lib.added', { name: namesOf(added.map((a) => a.key)) }), 2500);
        }
        renderButtons();
        break;
      }
      case 'studio:placement/tool':
        stripTool = m.tool;
        break;
      case 'studio:placement/menu':
        stripMenu = !!m.open;
        break;
      case 'studio:placement/context': {
        // A right-click / long press on the game (bridge/input.ts): the pick is already what it is about (the bridge
        // picked an object that was not picked, and its placement/selected came first). The point is the game page's.
        if (!editing || playing || libraryShown()) break;
        const r = iframe.getBoundingClientRect();
        cancelPress();
        openMenu(m.key ? 'object' : 'scene', r.left + m.x, r.top + m.y, { touch: m.touch });
        break;
      }
      case 'studio:placement/thumb':
        if (m.src && (m.size || 96) > 96) {
          // A Library tile's own picture (⑧): cropped at its own size; the list takes it too while it has none.
          const key = m.key, raw = m.src;
          bigRaw.set(key, raw);
          void fitPicture(raw, m.size).then((src) => {
            if (bigRaw.get(key) !== raw) return;
            bigThumbs.set(key, src);
            bigStale.delete(key);
            libraryObjects.updateThumb(key);
            if (!thumbs.has(key)) {
              thumbs.set(key, src);
              staleThumbs.add(key);
              placementPanel.updateThumb(key);
            }
          });
        } else if (m.src) {
          // Cropped to the object first (thumb-fit.ts, W1-11): the lighthouse filled its tile instead of being an "i".
          // `thumbAsked` keeps the newest: a picture that arrives while an older one is still being cropped wins.
          const key = m.key, raw = m.src;
          thumbAsked.set(key, raw);
          void fitPicture(raw).then((src) => {
            if (thumbAsked.get(key) !== raw) return;
            thumbs.set(key, src);
            staleThumbs.delete(key);
            placementPanel.updateThumb(key);
            libraryObjects.updateThumb(key);
          });
        }
        break;
    }
  }

  // ----- actions -----
  function doUndo() {
    // Nothing else left to undo right after New level / Duplicate: ⌘Z takes the level back (addLevel).
    if (!undo.canUndo && levelMade) return unmakeLevel();
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
  /** Placement changes not saved, both layers (the UI's is 0 for a game without one). */
  // A Library motion that an object's changed motion uses is counted with that object (timeline-model.ts libCounted:
  // one drag that makes a motion = Save · 1, studio-motion-line).
  const placementDirty = () => worldModel.dirty() + uiModel.dirty() + uiWire.model.dirty() + levels.dirtyElsewhere()
    + libCounted(motionLibrary.changedNames(), worldModel.motion.changedKeys(), (k) => (worldModel.motion.get(k)?.clips ?? []).map((c) => c.use ?? c.name)).length;
  /**
   * placement.json as it would be written now: the world's file plus the UI's `ui` (ui-layer.ts withUi; nothing is
   * added for a game without a UI, so its file keeps its bytes). Before the UI's list has come, the saved `ui` as it was.
   */
  const fileNow = (): PlacementFile => {
    // UI stages 2–3: each element's look and screen with its move, and the theme (ui-wire.ts; nothing for a game without them).
    const f = levels.compose(withUi(worldModel.result(), uiWire.entries(uiSeen ? uiEntries(uiModel.result()) : fileUi ?? {}),
      uiSeen ? [iframe.clientWidth, iframe.clientHeight] : fileUiView ?? null, uiWire.model.themeResult()));
    // The Library's motions sit at the top, also with levels (studio-motion-triggers). Absent with none: same bytes.
    const motions = motionLibrary.result((m) => roundLib(m, dim));
    return motions ? { ...f, motions } : f;
  };
  const dirtyCount = () => placementDirty() + Object.values(tools).reduce((n, tl) => n + (tl ? tl.dirty() : 0), 0) + toolsDirty();

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
    if ((placementDirty() > 0 || written.placement !== undefined) && sigOf(fileNow()) !== written.placement) return true;
    return Object.values(tools).some((tl) => tl && tl.dirty() > 0 && sigOf(tl.result()) !== written[tl.id]);
  };
  function keepSoon() {
    clearTimeout(keepTimer);
    if (!unwritten()) return;
    keepTimer = window.setTimeout(() => void keepNow(), 700);
  }
  /**
   * Write what changed, quietly. `again`: write the placement draft even when it is what was written last, if there are
   * unsaved changes (▶ Play reads it from disk).
   *
   * WHY `again` (play-after-ai, 2026-10-21, "after asking the AI, Play showed only the AI's change, not my moves"): "the
   * same as written last" says what THIS page wrote, not what is on disk now. The AI works in the same folder and the
   * skill has it take applied entries out of placement.json and delete the file when it is empty, so after an AI change
   * the draft can be gone while the editor still holds the moves (it pushes them to its own pages from memory). Play then
   * read no draft and opened at the code's layout. Unsaved changes are the editor's, so they are written again before
   * Play; with nothing unsaved the file is left as the AI left it (a saved arrangement is the AI's to apply and tidy).
   */
  async function keepNow(again = false): Promise<void> {
    clearTimeout(keepTimer);
    if (keeping) await keeping;
    keeping = (async () => {
      const jobs: Array<Promise<string | null>> = [];
      const file = fileNow();
      if ((placementDirty() > 0 || written.placement !== undefined) && (sigOf(file) !== written.placement || (again && placementDirty() > 0))) {
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

  // ----- before unsaved changes are lost (a try of the editor, 2026-10-21: "people forget Save — show a window when edits would be lost") -----
  // unsaved-guard.ts says what each kind of step loses; here are the steps. A new game page (Play, Reload game, the AI's
  // reload, Undo AI change) asks only for a game tool's data; leaving the page also for the Save itself (local studio).
  const lostNow = (op: GuardOp) => lostBy(op, { offline: !!host.offline, kept: dirtyCount() - toolsDirty(), tools: toolsDirty() });
  let guard: ReturnType<typeof createUnsavedGuard> | null = null;
  const guardWindow = () => (guard ||= createUnsavedGuard({ mount: app, t }));
  // True once the person chose to leave (Don't save, or after Save): the browser's own question must not come second.
  let leaving = false;
  /** Ask before `op` loses something; true = go on (saved first when asked to), false = stay as you are. */
  async function confirmLoss(op: GuardOp): Promise<boolean> {
    const n = lostNow(op);
    if (n <= 0) return true;
    const a = await guardWindow().ask(n);
    if (a === 'cancel') return false;
    // Save and continue: only once the save went through (a failed save, or Cancel on "Check before you save", stays).
    if (a === 'save' && !(await handOff())) return false;
    if (op === 'leave') leaving = true;
    return true;
  }
  // Closing the tab, reloading, the browser's Back: only the browser's own question can be had (its words, not ours).
  window.addEventListener('beforeunload', (e) => {
    if (leaving || lostNow('leave') <= 0) return;
    e.preventDefault();
    // Older Chrome / Safari need returnValue set.
    e.returnValue = '';
  });
  // A link of this page that opens another page in this tab (the web demo's "← Samples", "Back to the original look"
  // on the Look page): our window instead of the browser's, and the draft written first (it waits 0.7 s after a change).
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const to = new URL(a.href, location.href);
    if (to.protocol !== 'http:' && to.protocol !== 'https:') return;
    // Same page, only a #part: nothing leaves.
    if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search) return;
    if (lostNow('leave') <= 0 && !unwritten()) return;
    e.preventDefault();
    void (async () => {
      if (!(await confirmLoss('leave'))) return;
      await keepNow();
      leaving = true;
      location.href = to.href;
    })();
  });

  let safeSave: ReturnType<typeof createSafeSave> | null = null;
  /** Save (⌘S): the files with a `saved` request, handed to the AI. */
  async function handOff(): Promise<boolean> {
    // Big changes to big things are said in words first (safe-save.ts; the road of that try that went up 16 m).
    // The world's objects, whichever layer is edited (merge of 2026-10-19: with UI stage 1 `model` / `items` / `dim` are
    // the edited layer's, and a road raised before switching to the UI must still be told).
    const big = bigChanges(worldItems, worldModel.changedKeys(), (k) => worldModel.savedPose(k), (k) => worldModel.pose(k), worldDim, t, (it) => displayName(it, t));
    if (big.length) {
      const a = await (safeSave ||= createSafeSave({ mount: stage, t })).ask(big);
      if (a === 'cancel') return false;
      if (a === 'putBack') {
        const onWorld = editLayer === 'world';
        // A world step pushed while the UI is edited: the one history marks it as the world's (undo.ts layerNow).
        const layerNow = undo.layerNow;
        undo.layerNow = () => undefined;
        try {
          for (const k of new Set(big.map((b) => b.key))) {
            const from = worldModel.pose(k), to = worldModel.savedPose(k);
            if (!from || !to || !undo.push(poseChange(k, from, to))) continue;
            if (onWorld) applyPose(k, to);
            else (worldModel.moved(k, to), send({ type: 'studio:placement/pose', key: k, pose: to, layer: 'world' }));
          }
        } finally {
          undo.layerNow = layerNow;
        }
        renderButtons();
      }
    }
    clearTimeout(keepTimer);
    if (keeping) await keeping;
    const jobs: Array<Promise<string | null>> = [];
    let placementHanded = false;
    // What this Save keeps, by name, read now: markSaved() below forgets it (plan step 6, save-receipt.ts).
    const keptThings = savedThings();
    const keptTotal = placementDirty();
    if (placementDirty() > 0 || placementRestored) {
      const file = fileNow();
      const v = validatePlacement(file);
      if (!v.ok) {
        showToast(t('save.fail', { error: v.errors.join('; ') }));
        return false;
      }
      if (placementDirty() > 0) {
        const sig = sigOf(file);
        jobs.push(host.save('placement', v.value).then((r) => {
          if (!r.ok) return r.error || 'placement';
          worldModel.markSaved();
          uiModel.markSaved();
          uiWire.model.markSaved();
          levels.markSaved();
          // Saved with its levels: taking "Make Level 2" back now would leave the file and the editor apart.
          if (levelMade) {
            levelMade = null;
            renderLevelMade();
          }
          motionLibrary.markSaved();
          // ✦ Turn into a rule (studio-code-torule): the AI takes the hand's shape out of the code now — nothing to compare.
          if (ruleCompare.any()) {
            ruleCompare.clear();
            compareChanged();
          }
          written.placement = sig;
          // The host keeps every hand-off as a request (§3.4): wait for the AI's pick-up like any ask.
          handedOver('saved', r.request, r.at, undefined, r);
          if (pending) {
            pending.saved = keptThings;
            pending.savedTotal = keptTotal;
            renderAiLine();
          }
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
        return false;
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
    if (!errors.length && jobs.length) {
      savedOnce = true;
      saveDoneUntil = Date.now() + SAVE_DONE_MS;
    }
    if (!errors.length) emit('saved', null);
    renderButtons();
    return !errors.length;
  }

  /**
   * The world's objects a Save keeps, by the names the list shows (plan step 6): "moved gate" for a place / turn / size,
   * "gate’s motion" for an object's motion, and each changed Library motion by its own name. Renamed / deleted ones and
   * the UI layer have no "moved" words: they are counted in "N more" (save-receipt.ts savedList).
   */
  function savedThings(): SavedThing[] {
    const out: SavedThing[] = [];
    const nameOf = (k: string) => {
      const it = worldItems.find((i) => i.key === k);
      return it ? displayName(it, t) : '';
    };
    const motionKeys = new Set(worldModel.motion.changedKeys());
    for (const k of worldModel.changedKeys()) {
      if (motionKeys.has(k)) continue;
      const from = worldModel.savedPose(k), to = worldModel.pose(k);
      const name = nameOf(k);
      if (name && from && to) out.push({ kind: 'moved', name });
    }
    for (const k of motionKeys) {
      const name = nameOf(k);
      if (name) out.push({ kind: 'motion', name: t('motion.firstName', { name }) });
    }
    for (const n of motionLibrary.changedNames()) out.push({ kind: 'motion', name: n });
    // A code layout's knobs (studio-code-knobs; the plan's receipt "Saved: hex Gap → 4 m"), said as what changed.
    for (const w of codePlaces.savedWords()) out.push({ kind: 'motion', name: w });
    return out;
  }

  function goHome() {
    send({ type: 'studio:core/view', view: { action: 'home' } });
  }

  let playing = false;
  // ▶ Play in the same page (fast switch, 2026-10-22; togglePlay): the page on screen is the edit page playing, and
  // where each object stood when Play started (for "Put in layout" while paused). False after any new page (loadGame).
  let playHere = false;
  let playFrom: Map<string, Pose> | null = null;
  // The first error the game's page threw since it was (re)loaded (studio:core/game-error), shown in the status line.
  let gameError: { message: string; where?: string } | null = null;
  // Play: the game as the editor shows it (every change is kept as a draft and goes along); what was written waits
  // first, so a game that reads placement.json at start (studio-placement.js) gets the latest one.
  // With changes not saved, Play asks first (a try of the editor, 2026-10-21: "when 'this change isn't in the game yet',
  // some people want to save and some want to try without saving — let them choose with buttons"): the window of
  // unsaved-guard.ts, "You have 3 unsaved changes" — Save and play (Enter) · Try without saving · Cancel (Esc, outside).
  //   - Save and play = Save as always (handOff: "Check before you save" for big changes comes first and is obeyed —
  //     its Cancel, or a failed save, stays in Edit), then Play;
  //   - Try without saving = what Play did before: the changes stay, in Play and back in Edit, and so does Save · N;
  //   - Cancel = Edit as it was. The button, P and the ⌘K list all come here.
  // It replaced the strip over the game while playing (the person has chosen; Play says nothing more) and the separate
  // "a game tool's data would be lost" question at Play (its count is one more line of this window).
  async function playChoice(): Promise<boolean> {
    const n = dirtyCount();
    if (!playAsks(n, playing)) return true;
    const a = await guardWindow().ask(n, { kind: 'play', tools: toolsDirty() });
    if (a === 'cancel') return false;
    if (a === 'save') return handOff();
    return true;
  }
  /**
   * ▶ Play / Edit. Since the fast switch (2026-10-22; a try of the editor: "every time I play and go back to edit it loads again —
   * tedious"), both happen in the page on screen when its editor is up (canPlayHere): no new page, no loading. The game
   * starts from the edit layout and Edit comes back to it (bridge/play-switch.ts says why, and what does not go back).
   * `fresh`: "Play from the start" (⌘K, Play's ▾) — a new Play page, as Play always opened: the score, the enemies,
   * the timers start again. From Play it opens the game again from its start, still in Play.
   */
  async function togglePlay(fresh = false) {
    if (fresh && playing) {
      loadGame();
      return;
    }
    if (!(await playChoice())) return;
    if (!playing) await keepNow(true);
    if (swapping) finishSwap();
    playing = !playing;
    if (playing) playSince = Date.now();
    palette.close();
    if (playing && !fresh && canPlayHere()) playInPage();
    else if (!playing && playHere) editInPage();
    else loadGame();
  }
  /**
   * Can ▶ Play happen in the page on screen? Its editor is up and has listed its objects (a page still loading, one
   * with no adapter, a level being opened: a new page as before), and its motions can play there (play-here.ts: always
   * with the game's loader's play hook, `motionHere`; without it, those the editor's own runner plays).
   */
  function canPlayHere(): boolean {
    if (!bridgeAlive || phase !== 'ready' || !editing || swapping) return false;
    return motionsPlayHere(worldModel.result().motion, motionHere);
  }
  /** Play in the page on screen (see togglePlay). */
  function playInPage() {
    playHere = true;
    // What "Put in layout" in a pause changes (play-move.ts): compared back in Edit (editInPage).
    playFrom = new Map(worldItems.map((i) => [i.key, structuredClone(worldModel.pose(i.key) || i.pose)]));
    // A Play page says hello again and starts unpaused — the same here.
    playAskOn = false;
    playPaused = false;
    pauseSoon = false;
    playMark = null;
    editing = false;
    phase = 'playing';
    // The timeline open at a time other than 0 shows each moving object at its place + its clip there: back to the
    // places first (refresh() sends the places once the timeline is not usable — `playing` above), or Play would start
    // from that moment and Edit would come back to it. Its ▶ preview stops, as a new page stopped it (loadGame).
    timeline.reset();
    timeline.refresh(true);
    // `motions`: the Library's, for the clips that use one by name (as placement.json's `motions` on a Play page).
    send({ type: 'studio:core/play', on: true, motion: worldModel.result().motion, motions: motionLibrary.result((m) => roundLib(m, dim)) });
    renderAll();
  }
  /** Back to Edit in the same page: the layout, the camera, the pick, the timeline as they were. */
  function editInPage() {
    playHere = false;
    const from = playFrom;
    playFrom = null;
    playAskOn = false;
    playPaused = false;
    pauseSoon = false;
    playMark = null;
    // 'ready' at once: the page answers with core/ready (editing) and its list within a frame or two, and a
    // "loading" in between would be the flash this change takes away.
    phase = 'ready';
    send({ type: 'studio:core/play', on: false, viewState: keptView() });
    // "Put in layout" while paused moved the model: the page puts things back where Play found them, then these.
    let kept = 0;
    for (const i of worldItems) {
      const now = worldModel.pose(i.key);
      const was = from?.get(i.key);
      if (now && was && !samePose(now, was, worldDim)) {
        send({ type: 'studio:placement/pose', key: i.key, pose: now });
        kept++;
      }
    }
    // Edit is the scene from before Play (studio-edit-restore, 2026-10-23: "Edit came back in the middle of the game").
    // The one thing of the play that stays is what the person put in the layout themselves: said, so it is no surprise.
    if (kept) showToast(kept === 1 ? t('play.keptOne') : t('play.keptN', { n: kept }), 6000);
    // The stage is the game's size with the side panel again: the corners the panels cover, sent again.
    insetSent = '';
    sendInset();
    renderAll();
    // A change of the files while playing (the AI's fix) reloads softly now (pollStatus → softReload).
    pollSoon();
  }
  /** The edit camera kept for the next page (core/view-state), or undefined. */
  function keptView(): unknown {
    const vs = store.get(VIEW_KEY);
    try {
      return vs ? JSON.parse(vs) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Reload the game without a flash (AI feel, 2026-10-16): the new game opens
   * in a second frame under the one on screen; the old frame (a still
   * picture: the editor pauses the game) stays on top until the new game has
   * listed its objects and drawn them with the kept poses, then fades out.
   * The camera (view state) and the selection carry over. `why`: 'ai' and
   * 'redo' compare what changed and mark it violet; 'undo' clears the marks.
   */
  async function softReload(why: 'ai' | 'undo' | 'redo' | 'draft') {
    if (swapping || playing) return;
    await keepNow();
    // 'draft' (studio-code-base): the game reads the editor's draft again — a code layout's knobs, pins or keep-out
    // areas changed, which only the game's loader can lay out. Not an AI change: its marks and "AI changed" stay as they are.
    if (why === 'draft') {
      // (nothing of the AI's to note)
    } else if (why === 'undo') {
      aiBefore = null;
      aiBase = null;
      aiBeforeCode = aiBaseCode = null;
      setAiMarks(new Map());
    } else {
      const keep = why === 'ai' && !!aiBase;
      aiBefore = keep && aiBase ? aiBase : new Map(worldItems.map((i) => [i.key, structuredClone(worldModel.pose(i.key) || i.pose)]));
      aiBeforeCode = keep && aiBaseCode ? aiBaseCode : new Map(worldItems.flatMap((i) => {
        const w = worldModel.original(i.key);
        return w ? [[i.key, structuredClone(w)] as [string, Pose]] : [];
      }));
      const busy = why === 'ai' && aiBusy(currentPhase());
      aiBase = busy ? aiBefore : null;
      aiBaseCode = busy ? aiBeforeCode : null;
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
  // A code layout changed (studio-code-base, 2026-10-24: a knob, a hand-placed one, a keep-out area, or its ⌘Z). Since
  // studio-code-knobs (the same day; the first step's report: "turning a layout's number reloads the game — change it in
  // place") the game page lays it out again where it stands (studio:place/layout → bridge/code-place.ts, the loader's own
  // relayCodePlace): the same objects move, a new count makes / takes out objects and lists them again. A page that is
  // opening or playing gets the draft when it opens (the loader reads it), so nothing is sent then.
  // `reload`: a change the page cannot make in place (hand-placed objects hidden / shown again: swapsHand) — read the
  // draft again, once for a burst of changes, after a page that is still opening.
  let placesTimer = 0;
  function placesChanged(reload = false) {
    renderAll();
    keepSoon();
    if (reload) {
      clearTimeout(placesTimer);
      placesTimer = window.setTimeout(function again() {
        if (swapping || playing) return void (placesTimer = window.setTimeout(again, 200));
        void softReload('draft');
      }, 60);
      return;
    }
    if (swapping || playing || !editing) return;
    codePlaces.layout();
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
    sendMarks(true);
  }

  // ----- levels (2026-10-22; levels.ts, level-switch.ts) -----
  /** A fresh world model for level `id` (the editor's layer goes back to the world, as on any new game page). */
  function useLevelModel(id: string) {
    worldModel = new PlacementModel();
    worldModel.restore(levels.viewOf(id));
    // A New level the code does not build yet: only the ground / sky show, whatever the game moves or makes
    // (studio-blank-level, 2026-10-23: on NEON DASH "New level" left all 61 things on screen and in the list).
    if (levels.isBlank(id)) worldModel.blankKeep = keptInBlank;
    if (editLayer !== 'ui') model = worldModel;
  }
  /**
   * Show level `id`: the one on screen is kept (its layout and unsaved count, `keep`; false after it was deleted),
   * the draft written (so the game's loader reads the new level's layout too), and the game opened on `id`. Like
   * "Reload game" it asks first when a game tool's data would be lost. ⌘Z starts empty: a step of another level
   * would change what is not on screen.
   */
  async function goLevel(id: string, keep = true) {
    if (!id || !levels.has(id)) return;
    if (!(await confirmLoss('reload'))) return levelsChanged(true);
    // Another level shown: the level just made is not the last step any more (addLevel arms it again after its own goLevel).
    if (levelMade) {
      levelMade = null;
      renderLevelMade();
    }
    if (keep) levels.stash(worldModel.result(), worldModel.dirty());
    levels.current = id;
    useLevelModel(id);
    undo.clear();
    selected = null;
    group = [];
    await keepNow();
    loadGame();
    renderAll();
  }
  /** A rename / move / delete that keeps the level on screen: the crumb and the Save count again, the draft soon. */
  function levelsChanged(changed: boolean) {
    if (!changed) return;
    if (levelMade) {
      levelMade = null;
      renderLevelMade();
    }
    renderAll();
    keepSoon();
  }
  /** The top bar's level, after "Scene": the crumb (a game with levels; plain words while playing), or "Level 1 ⌄". */
  function renderLevelCrumb() {
    const crumb = levelSwitch.render(!playing);
    levelSlot.hidden = !crumb;
    if (!crumb) levelSlot.replaceChildren();
    else if (crumb.parentElement !== levelSlot) levelSlot.replaceChildren(h('span', { class: 'sep', 'aria-hidden': 'true', text: '/' }), crumb);
    const add = levelAddable();
    levelAddSlot.hidden = !add;
    // Where the level's name is once there are two (Studio / Game / Scene / Level 1 ⌄): nothing jumps when Level 2 opens.
    levelAddSlot.replaceChildren(...(add ? [h('span', { class: 'sep', 'aria-hidden': 'true', text: '/' }), levelSwitch.addButton(oneLevelName(), () => openLevelFresh())] : []));
  }
  /**
   * "Level 1 ⌄" shows in a game without levels while its world is edited in the Scene. A game that never says its levels
   * needs the AI for it (its code must build a level by id), so not without one (host.offline).
   */
  function levelAddable(): boolean {
    return !levels.active && editing && !playing && page === 'tool' && tool === 'placement' && editLayer === 'world' && (!!levels.single || !host.offline);
  }
  /** The name of a game's one level: its code's, else "Level 1" (what it is called once a second one is made). */
  function oneLevelName(): string {
    return levels.single?.label || t('level.first');
  }
  /**
   * The menu of a game without levels (level-menu2, 2026-10-23): the one level (✓), then New level and Duplicate — the
   * same rows as a game with levels (level-switch.ts makeRows). History: "+ Level" typed a request into the AI box
   * (studio-uniforms: "it makes no sense"); v0.1.25's menu had a line on what happens, "Make Level 2 — a copy of this
   * one" and ✦ "Ask AI for a different kind of level…"; a hands-on try (10/23): "New (blank) and Duplicate are enough —
   * make it new, then ask the AI". Only a game whose code already builds a level by id gets it in the web demo
   * (levelAddable).
   */
  function levelFreshEntries(): MenuEntry[] {
    return [
      { id: 'level-one', label: oneLevelName(), checked: true, run: () => {} },
      { sep: true },
      ...makeRows({ t, blank: () => void addLevel('blank'), copy: () => void addLevel('copy') }),
    ];
  }
  /** The menu of a game without levels: under its "Level 1 ⌄" (⌘K's "Levels…" too); a phone, which has no such button, at the top. */
  function openLevelFresh() {
    const b = levelAddSlot.querySelector('button');
    if (b && b.offsetParent) return levelSwitch.openAt(levelFreshEntries(), b);
    ctxMenu.show(levelFreshEntries(), window.innerWidth / 2, 56, { place: 'levels', touch: phone(), label: t('level.menu'), floor: menuFloor() });
  }
  /**
   * The ground / sky that a New level keeps (PlacementModel.blank): the objects the editor holds still as the scene's
   * base (`backdrop`, held 'ground' — adapters/three/ground.js, a 2D game's background at the back of its list).
   * Tried on NEON DASH-like runners (level-menu2): the road and the sky stay, the pillars and the orb go; lights and the
   * camera are never listed, so they stay too.
   */
  function keepInBlank(k: string): boolean {
    const it = worldItems.find((i) => i.key === k);
    return !!it && keptInBlank(it);
  }
  /** The same test on a listed object (a blank level's page, PlacementModel.blankKeep). */
  function keptInBlank(it: Item): boolean {
    return !!it.backdrop || it.held === 'ground';
  }
  /**
   * New level ('blank') or Duplicate ('copy'): made right after the one on screen and opened, one change on "Save · n";
   * Save hands it to the AI like a moved object (the code's switch is the AI's: placement.json `levels`, `from`).
   * In a game without levels, what is on screen becomes Level 1 first (levels.ts start()). It can be taken back while
   * nothing else was done on the new level — ⌘Z, or the line's Undo on a phone — not after Save or another level
   * change (levelMade = null then).
   */
  async function addLevel(kind: 'blank' | 'copy') {
    const started = !levels.active;
    const single = levels.single;
    const before = worldModel;
    const back = levels.current;
    const blank = kind === 'blank' ? { world: worldModel.blank(keepInBlank), name: (n: number) => t('level.nth', { n }) } : undefined;
    const id = started ? levels.start(worldModel.result(), t('level.first'), blank)
      : blank ? levels.blank(blank.world, blank.name) : levels.copy(worldModel.result());
    if (!id) return;
    // The game's one level now has an id: what its page listed is that level's (seenByBuild, the Library's "Not in this level").
    if (started && seenByBuild.has('') && levels.list[0]) seenByBuild.set(levels.build(levels.list[0].id), seenByBuild.get('')!);
    await goLevel(id);
    if (levels.current !== id) return;
    levelMade = { id, name: levels.labelOf(id), back: started ? '' : back, started, single, model: before };
    renderLevelMade();
    renderButtons();
  }
  /**
   * ⌘Z right after New level / Duplicate: the level goes again. The game's second level: back to a game with one level,
   * as it was (its own model: the unsaved moves come back too); otherwise back to the level shown before.
   */
  function unmakeLevel() {
    const made = levelMade;
    levelMade = null;
    renderLevelMade();
    if (!made) return renderButtons();
    if (!made.started) {
      if (!levels.unadd(made.id)) return renderButtons();
      // keep = false: the level on screen is the one just taken out (its layout goes with it).
      return void goLevel(made.back, false);
    }
    if (!levels.unstart(made.single)) return renderButtons();
    worldModel = made.model;
    if (editLayer !== 'ui') model = worldModel;
    undo.clear();
    selected = null;
    group = [];
    void keepNow().then(() => {
      loadGame();
      renderAll();
    });
  }
  /**
   * The line after New level / Duplicate (level-menu2, 2026-10-23: one short line — "Level 2 made. ⌘Z to undo."; v0.1.25
   * said what it was a copy of and what Save does, three sentences): the new level can look just like the last one,
   * so the line says where you are. It stays until the first change on the new level, a level change, Save or ×; not a
   * toast that times out.
   * fix-0141 (C4 of the first-run check, 2026-10-24): "Level 2 made · Undo" everywhere — the Undo is a button on PC too.
   * It was "Level 2 made. ⌘Z to undo." with no button (only the phone had one), and a first-time maker reads the line
   * as the way back, not the top ↶ or a key. The key is the button's tooltip and the line's (level.made, the old words).
   */
  function renderLevelMade() {
    const on = !!levelMade && !playing && levels.active && !undo.canUndo;
    levelNote.hidden = !on;
    if (!on) {
      levelNote.title = '';
      return levelNote.replaceChildren();
    }
    const key = phone() ? '' : keyOf('undo', isMac());
    levelNote.title = key ? t('level.made', { name: levelMade!.name, key }) : '';
    levelNote.replaceChildren(
      h('span', { class: 'level-made-text', text: t('level.madeTouch', { name: levelMade!.name }) }),
      h('button', { type: 'button', class: 'link-btn', dataset: { action: 'level-made-undo' }, text: t('btn.undo'), title: key ? `${t('btn.undo')} (${key})` : t('btn.undo'), onclick: () => unmakeLevel() }),
      h('button', { type: 'button', class: 'level-made-close', dataset: { action: 'level-made-close' }, 'aria-label': t('level.madeClose'), title: t('level.madeClose'), onclick: () => {
        levelNote.hidden = true;
      } }, icon('close')),
    );
  }

  /** The game page's address: the editor's (`?studio=edit`) or Play's, on the level shown. */
  function gameSrc(): string {
    const u = new URL(gameUrl, location.href);
    const [k, v] = LOCAL_PATHS.editFlag.split('=') as [string, string];
    if (playing) u.searchParams.delete(k);
    else u.searchParams.set(k, v);
    if (gameOrigin !== location.origin) u.searchParams.set(LOCAL_PATHS.parentParam, location.origin);
    // A game with levels opens on the level shown (edit and Play alike; bridge/levels.ts reads these).
    if (levels.active && levels.current) {
      u.searchParams.set(LOCAL_PATHS.levelParam, levels.current);
      u.searchParams.set(LOCAL_PATHS.buildParam, levels.build(levels.current));
    }
    return u.href;
  }

  function loadGame(soft = false) {
    playHere = false;
    playFrom = null;
    bridgeAlive = false;
    timeline.reset();
    // A new game page asks again (play/hello), and starts unpaused.
    playAskOn = false;
    playPaused = false;
    pauseSoon = false;
    playMark = null;
    // Unnamed objects are named again from where they stand in the new game (names.ts).
    forgetNames();
    gameError = null;
    filesCache.clear();
    usesP = null;
    if (!soft) usesNow = null;
    filePick = [];
    addingToScene.clear();
    editing = false;
    // A soft reload keeps the list, the selection and the pictures on screen
    // until the new game answers (no flash of an empty list).
    if (!soft) {
      items = [];
      itemsSeen = false;
      selected = null;
      group = [];
      // The pictures stay (⑥): the new game's come in their place, one by one.
      for (const k of thumbs.keys()) staleThumbs.add(k);
      for (const k of bigThumbs.keys()) bigStale.add(k);
    }
    check = null;
    thumbsAsked.clear();
    visibleShown.clear();
    bigShown.clear();
    placementRestored = false;
    uiRestored = false;
    uiWire.pageReset();
    // What the game in the frame is built from (the host's signature of the files).
    loadedCode = code;
    gameTools = [];
    activeTool = null;
    toolDirty.clear();
    renderToolsRow();
    if (!soft) phase = playing ? 'playing' : 'loading';
    iframe.src = gameSrc();
    renderAll();
  }

  function shortcut(e: { key: string; ctrl: boolean; meta: boolean; shift: boolean; fromGame?: boolean }): boolean {
    const mod = e.ctrl || e.meta;
    const k = e.key.toLowerCase();
    // "You have 3 unsaved changes" is open: its own keys only (unsaved-guard.ts), nothing from the game frame either.
    if (guard?.open) return true;
    // The shortcut sheet: Esc or ? again closes it first (from the game frame too).
    if (keySheet.isOpen() && !mod && (k === 'escape' || k === '?')) {
      keySheet.hide();
      return true;
    }
    // "+ Draw a box" on (studio-code-keepout): Esc stops it first (the pick stays).
    if (!mod && k === 'escape' && keepOut.stopDraw()) return true;
    // The timeline's keys (K sets a key; Delete / ⌘C / ⌘V / Space / ← → when the plate was the last thing pressed).
    if (timeline.onKey(e)) return true;
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
    // F2: rename the picked object in place (its card's name becomes a field).
    if (!mod && e.key === 'F2') return startRename();
    if (mod && k === 'd' && !e.shift) {
      if (editing) copySelection();
      return true;
    }
    // ⌘C / ⌘V: copy the selection, paste = duplicates of it next to the originals (see `clip`). A text selected on
    // the page (a name on the card, the AI's line) keeps the browser's own copy.
    if (mod && k === 'c' && !e.shift) {
      if (!editing || !targets().length || (!e.fromGame && String(window.getSelection?.() || ''))) return false;
      clipCopy();
      return true;
    }
    if (mod && k === 'v' && !e.shift) {
      if (!editing) return false;
      clipPaste();
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
    // Levels (level-crumb, 2026-10-22): [ the level before, ] the next one, as the menu's rows say. Plain keys, no
    // ⌘: ⌘[ / ⌘] are the 2D layers' (below), and "[ ]" read as "back / forward" the same way. No wrapping round.
    if (!mod && (k === '[' || k === ']') && levels.active && editing && !playing) {
      const id = levels.step(k === '[' ? -1 : 1);
      if (id) void goLevel(id);
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
    // U: World ⇄ UI (UI stage 1), only in a game with both layers.
    if (!mod && k === 'u' && !e.shift && editing && editLayers && editLayers.length > 1) {
      setEditLayer(editLayer === 'ui' ? 'world' : 'ui');
      return true;
    }
    // ⇧U: the game's UI shown / hidden over the world (only while the world is edited: on the UI it is always shown).
    if (!mod && k === 'u' && e.shift && editing && !playing && editLayer === 'world' && editLayers && editLayers.length > 1) {
      setUiPeek(!uiPeek);
      return true;
    }
    // P has ONE meaning per moment (plan step 2, 2026-10-23, first-run walk #14): in Edit it plays; while playing it
    // pauses and resumes, and nothing else — wherever the focus is. Before, P while playing went back to Edit when the
    // focus was outside the game (right after "Try without saving", say) and paused when it was inside, and nothing
    // on screen said which: the person pressed P to stop and was taken out of the game. Back to Edit = the top bar's
    // Edit button (it no longer shows a P). The browser-only web demo has no pause (no AI to talk to, host.offline):
    // there P is still Play ⇄ Edit, its only meaning there.
    if (!mod && k === 'p' && !e.shift) {
      if (playing && !host.offline) pressPause();
      else void togglePlay();
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
    // The menu key / Shift+F10 pressed in the game frame (the bridge keeps the browser's own menu there): the menu of
    // the pick, or of the scene, in the middle of the game. In the editor page the browser sends `contextmenu` itself.
    if (e.fromGame && !mod && editing && !playing && (k === 'contextmenu' || (k === 'f10' && e.shift))) {
      const r = iframe.getBoundingClientRect();
      openMenu(selected || group.length ? 'object' : 'scene', r.left + r.width / 2, r.top + r.height / 2, { keyboard: true });
      return true;
    }
    // ?: every shortcut in one sheet (Shift+/ on US keyboards; the key reads '?' on every layout that has it).
    if (!mod && k === '?') {
      keySheet.show();
      return true;
    }
    if (e.fromGame || mod) return false; // the bridge already handled steps/escape
    // The Library hides the game: keys that move or turn the selection there (arrows, R, M / H / T / S) would
    // change an object nobody can see. Escape still drops the selection (below); Delete and ⌘D / ⌘Z work as on the
    // detail's buttons. (Before "one Library" the Assets page let arrows move the hidden pick.)
    const blind = libraryShown();
    // R: the next turn axis (3D; the game frame handles it itself when it has focus).
    if (k === 'r' && !e.shift && selected && editing && dim === '3d' && !blind) {
      send({ type: 'studio:placement/axis', axis: 'next' });
      return true;
    }
    // M / H / T / S: the strip's tools (the game frame handles them itself when it has focus).
    const strip = !e.shift && selected && editing && !blind ? (STRIP_KEYS[k] ?? STRIP_NUMBERS[k]) : undefined;
    if (strip && !(strip === 'lift' && dim !== '3d')) {
      setStripTool(strip);
      return true;
    }
    // A / 5: the strip's Motion button (studio-motion-tool), as a press on it.
    if (!e.shift && MOTION_KEYS.has(k) && selected && editing && !blind && motionTool.target()) {
      pressMotion();
      return true;
    }
    if (k === 'escape') {
      // First the strip's open choices, then the chosen tool, then the pick (the same order as in the game).
      if (stripMenu) closeStripMenu();
      else if (stripTool) setStripTool(null);
      else selectObject(null);
      return true;
    }
    if (!selected || !editing || blind) return false;
    const s = keyStep(e.key, e.shift, dim);
    if (!s) return false;
    send({ type: 'studio:placement/step', key: selected, ...s, hold: false, keys: group.length > 1 ? group.slice() : undefined });
    return true;
  }

  /** Drop to floor (End, ⌘K, the place's menu): the step the End key sends, for what is picked. */
  function dropToFloor() {
    if (!selected || !editing || !canDrop) return;
    send({ type: 'studio:placement/step', key: selected, op: 'drop', hold: false, keys: group.length > 1 ? group.slice() : undefined });
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
  /** The Motion button pressed from the editor page (A / 5, ⌘K): the game page answers with the button's place (motion-press). */
  function pressMotion() {
    send({ type: 'studio:placement/motion', ...motionTool.state(), press: true });
  }
  function setStripTool(k: StripTool | null) {
    stripTool = k;
    send({ type: 'studio:placement/tool', tool: k });
  }
  /** Camera up (> 0) / down by this share of the game's height (input.ts has the same steps for the game's own keys). */
  const riseCamera = (by: number) => send({ type: 'studio:core/view', view: { action: 'rise', by } });
  // Space held with the shell focused: a drag in the game looks around even with a tool chosen.
  let spaceDown = false;
  const spaceLook = (on: boolean) => {
    if (on === spaceDown) return;
    spaceDown = on;
    send({ type: 'studio:placement/look', on });
  };
  // Fly keys held with the editor page focused (camera-wasd 2026-10-18; bridge/input.ts has the rules and the motion):
  // W A S D with nothing picked, E / Q with nothing picked or Space held. The whole held set goes to the game each
  // time it changes; the game moves the camera every frame until it gets [].
  const FLY_CODES: Record<string, FlyKey> = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyE: 'e', KeyQ: 'q' };
  const flyKeys = new Set<FlyKey>();
  let flyShift = false;
  const flySend = () => send({ type: 'studio:core/fly', keys: [...flyKeys], fast: flyShift });
  const flyClear = () => {
    if (!flyKeys.size) return;
    flyKeys.clear();
    flySend();
  };
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') spaceLook(false);
    const fk = FLY_CODES[e.code];
    if (fk && flyKeys.delete(fk)) {
      flyShift = e.shiftKey;
      flySend();
    } else if (e.key === 'Shift' && flyKeys.size) {
      flyShift = false;
      flySend();
    }
  });
  window.addEventListener('blur', () => {
    spaceLook(false);
    flyClear();
  });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (typing && !(e.ctrlKey || e.metaKey)) return;
    // Typing in a field (the ask box, ⌘K's search, a number on the card, a rename): the field keeps ⌘Z, ⌘A, ⌘C, ⌘V,
    // ⌘X, ⌘Y and Delete for its own text (basics pass, 2026-10-18 — ⌘A used to select every object instead of the
    // words). Only ⌘S (save) and ⌘K (all actions) still reach the editor; ⌘D only stops the browser's bookmark.
    // The ask box once it is empty (studio-fix-0139, 2026-10-23: "after typing in the ask box, ⌘Z doesn't undo the
    // scene"): a sent request clears the box and the focus stays in it, so ⌘Z / ⌘⇧Z / ⌘Y found no words to undo and
    // did nothing — the scene's undo worked only after clicking out. An empty box has nothing of its own to undo:
    // those reach the editor. With words in it, the box keeps them (the basics pass's rule above).
    const askEmpty = typing && (e.target as HTMLElement).classList.contains('ask-input') && !(e.target as HTMLInputElement).value;
    if (typing) {
      const k = e.key.toLowerCase();
      if (k === 'd') e.preventDefault();
      if (k !== 's' && k !== 'k' && !(askEmpty && (k === 'z' || k === 'y'))) return;
    }
    // Space on a focused button presses it; only take Space when nothing that types or presses has focus.
    if (e.key === ' ' && editing && !e.ctrlKey && !e.metaKey && !(e.target as HTMLElement | null)?.closest?.('button, a, [role=option], [role=button]')) {
      spaceLook(true);
      e.preventDefault();
      return;
    }
    const kl = e.key.toLowerCase();
    // Fly (W A S D, E / Q; nothing picked, or Space+E / Q): held keys go to the game, which moves while they are down.
    // ⌘ / Ctrl / ⌥ = a shortcut instead (and a Mac drops keyups while ⌘ is down, so the held ones stop here). Not
    // while the Library hides the game (integrate1: the Library's rule, no blind key moves there).
    const fk = FLY_CODES[e.code];
    if (canFly && (e.ctrlKey || e.metaKey || e.altKey)) flyClear();
    else if (canFly && !typing && !e.isComposing && editing && !playing && !libraryShown() && (e.key === 'Shift' ? flyKeys.size > 0 : !!fk)) {
      if (e.key === 'Shift') {
        flyShift = true;
        flySend();
        return;
      }
      if (flyKeys.has(fk!) || !selected || ((fk === 'e' || fk === 'q') && spaceDown)) {
        if (!flyKeys.has(fk!)) {
          flyKeys.add(fk!);
          flyShift = e.shiftKey;
          flySend();
        }
        e.preventDefault();
        return;
      }
    }
    // E / Q steps for adapters that can rise but not fly (before camera-wasd, every 3D one): camera up / down, as in
    // the game (nothing picked, or Space held).
    if (!typing && (kl === 'e' || kl === 'q') && editing && canRise && !canFly && !libraryShown() && !e.ctrlKey && !e.metaKey && !e.altKey && (!selected || spaceDown)) {
      riseCamera((kl === 'e' ? 1 : -1) * (e.shiftKey ? RISE_KEY_STEP / 5 : RISE_KEY_STEP));
      e.preventDefault();
      return;
    }
    if (e.repeat && selected && !libraryShown()) {
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
  //
  // A notice that fits on one line goes INSIDE the ask bar, where its placeholder is ("Added sea-stack-2 to the scene"),
  // not on a plate stacked over it (the second design review's ⑧, 2026-10-19: on a phone the foot then held the plate,
  // the card and the bar; PC the same). Only while the field is empty and not being typed in, and while the bar is on
  // screen; anything longer (an error, Save's "what next") or a bar in use keeps the news plate above it, as before.
  function showToast(text: string, ms = 3500) {
    toast = text;
    clearTimeout(toastTimer);
    hideNews();
    if (newsInBar(text)) {
      toastEl.classList.remove('on');
      toastTimer = window.setTimeout(hideNews, ms);
      return;
    }
    toastEl.textContent = toast;
    toastEl.classList.add('on');
    toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), ms);
  }
  // Over the field itself (left of the send button, right of the chip): the same box the placeholder fills. From the
  // boxes on screen, not offsetLeft (on a phone the field and the notice are placed against different parents), and
  // again whenever the field changes size: the chip of the new pick is filled in just after the notice comes up.
  function placeNews() {
    if (askNews.hidden) return;
    const ir = askInput.getBoundingClientRect();
    const pr = (askNews.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    askNews.style.left = `${Math.round(ir.left - (pr?.left ?? 0))}px`;
    askNews.style.width = `${Math.round(ir.width)}px`;
  }
  function hideNews() {
    if (askNews.hidden) return;
    askNews.hidden = true;
    placementPanel.askEl.classList.remove('has-news');
  }
  function newsInBar(text: string): boolean {
    const box = placementPanel.askEl;
    if (!box.isConnected || !box.offsetParent || askSlot.hidden || askInput.value || document.activeElement === askInput) return false;
    if (askNews.parentElement !== box) box.append(askNews);
    askNews.textContent = text;
    askNews.hidden = false;
    placeNews();
    if (askNews.scrollWidth > askInput.offsetWidth + 1) {
      askNews.hidden = true;
      return false;
    }
    box.classList.add('has-news');
    return true;
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
        h('button', { type: 'button', class: 'link', dataset: { action: 'reload-game' }, text: t('btn.reloadGame'), onclick: () => void confirmLoss('reload').then((go) => go && loadGame()) }));
    } else if (phase === 'loading') line('info', t('status.loading'));
    else if (phase === 'waiting') line('info', t('status.waiting'));
    else if (phase === 'ready' && !itemsSeen) line('info', t('status.items'));
    else if (phase === 'no-adapter') line('warn', h('strong', { text: t('status.noAdapter') }), h('span', { text: ' ' + t('status.noAdapterHint') }));
    else if (check && !check.ok) {
      // One plain grey line at the top of the list, not a yellow box (Ive review N1, 2026-10-17). The editor still
      // works; only one promise of the adapter is off, so it is a note, not an alarm. The check's own details
      // (`render()`, `setPose`, `set()`…) are words for the AI: they go to it through host.reportCheck (local:
      // .studio/check.md) and are never shown here. test/i18n-words.test.mjs keeps code words out of these lines.
      // Not when the move test hit something the game moves itself, the ground / sky, or a hidden object (check-note.ts).
      const first = checkNoteId(check, worldItems, levels.isBlank());
      if (first) line('note', `${t('check.' + first)} ${t('status.checkFail')}`);
    }
    status.hidden = !status.childNodes.length;
    app.dataset.items = itemsSeen ? 'seen' : 'waiting';
    // While playing, the side panel steps away (shell.css): play = the game only.
    app.dataset.playing = playing ? 'on' : 'off';
    if (!playing) delete app.dataset.paused;
  }

  // The Save says "✓ Saved" this long after a press that went through, then goes (see topSave).
  const SAVE_DONE_MS = 1200;
  let saveDoneUntil = 0;
  let saveTimer = 0;
  // The count at the last render: the Save bounces once when it goes 0 → 1 or more (save-loud.ts bounces).
  let prevUnsaved = 0;
  function renderButtons() {
    motionTool.sync();
    const n = dirtyCount();
    // Undo / redo say what they would change and their key: "Undo: move lighthouse  ⌘Z" (tooltip.ts shows the key
    // apart). With nothing to undo they stay where they are, dimmed, and say so ("Nothing to undo  ⌘Z").
    const mac = isMac();
    const nextUndo = describe(undo.peekUndo()) || (levelMade ? t('level.undoMade', { name: levelMade.name }) : '');
    const nextRedo = describe(undo.peekRedo());
    // The UI layer's rows also get the dot for a changed look (UI stage 3).
    unsavedKeys = editLayer === 'ui' ? new Set([...model.changedKeys(), ...uiWire.model.changedKeys()]) : model.changedKeys();
    placementPanel.markRows();
    for (const b of undoBtns) {
      setButton(b, 'undo', t('btn.undo'), false, tipText(nextUndo ? `${t('btn.undo')}: ${nextUndo}` : t('keys.nothingUndo'), keyOf('undo', mac)));
      // While playing, undo/redo would change a game the person cannot see as edited.
      b.disabled = playing || !(undo.canUndo || levelMade);
    }
    // The "Level 2 made" line goes with the first change on the new level (renderLevelMade).
    if (levelMade && !levelNote.hidden && undo.canUndo) renderLevelMade();
    for (const b of redoBtns) {
      setButton(b, 'redo', t('btn.redo'), false, tipText(nextRedo ? `${t('btn.redo')}: ${nextRedo}` : t('keys.nothingRedo'), keyOf('redo', mac)));
      b.disabled = playing || !undo.canRedo;
    }
    const done = n === 0 && Date.now() < saveDoneUntil;
    // "✓ Saved": only after Save, until the next change (the draft writes are not shown). Not while the Save itself
    // still says "✓ Saved" (done): the two sit in the same bar now, and one "✓ Saved" twice read as two things.
    if (n > 0) savedOnce = false;
    saveState.replaceChildren(icon('check'), h('span', { text: t('btn.saved') }));
    saveState.title = t('save.savedTip');
    saveState.hidden = !savedOnce || n > 0 || playing || done;
    const loud = saveLoud({ n, playing });
    for (const b of saveBtns) {
      // "Save · 3  ⌘S": only while there is something not saved (or "✓ Saved" for a moment after the press).
      if (done) setButton(b, 'check', t('btn.saved'), true, t('save.savedTip'));
      else {
        // Plain "Save" (a try of v0.1.9, 2026-10-21: "'Save to game' — I don't get what that means"); the tooltip says where it goes.
        setButton(b, null, t('btn.save'), true, tipText(t('save.unsavedTip'), keyOf('save', mac)));
        if (n) b.append(h('span', { class: 'n', text: `· ${n}` }));
        // The key on the button itself (PC and the side window: a keyboard is there); a phone has none.
        if (!phone() || sideWin()) b.append(h('kbd', { text: mac ? '⌘S' : 'Ctrl S' }));
      }
      b.dataset.state = done ? 'done' : '';
      b.hidden = !loud.top && !done;
      b.dataset.unsaved = String(n);
    }
    if (done) {
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => renderButtons(), saveDoneUntil - Date.now() + 20);
    }
    // C (a try of the editor, 2026-10-21): one small bounce when a change first appears — it rises in, overshoots 6 % and
    // settles. A script animation, not a CSS one switched on by an attribute: taking such an attribute off again (the
    // first try, a timer at 700 ms) changed the animation back to studio-rise, which then ran a SECOND time — the Save
    // moved twice and the screen test caught it 6 px low. animate() runs once and leaves nothing behind. .48 s = two
    // of rule 6's arrivals (shell.css .top-save). Reduced motion: no bounce (bounces()). data-bumps counts them, for the
    // screen test ("once, not on every change").
    if (bounces(prevUnsaved, n, playing, matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      topSave.dataset.bumps = String(Number(topSave.dataset.bumps || 0) + 1);
      topSave.animate?.([
        { opacity: 0, transform: 'translateY(6px) scale(.985)' },
        { opacity: 1, transform: 'translateY(-3px) scale(1.06)', offset: 0.45 },
        { transform: 'scale(.985)', offset: 0.75 },
        { transform: 'none' },
      ], { duration: 480, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
    prevUnsaved = n;
    for (const b of playBtns) {
      // Edit shows no P (plan step 2): while playing P pauses (see shortcut()), except in the web demo with no pause.
      const pKeys = !playing || host.offline;
      setButton(b, playing ? 'stop' : 'play', playing ? t('btn.edit') : t('btn.play'), true, tipText(playing ? t('btn.edit') : t('btn.play'), pKeys ? keyOf('play', mac) : ''));
      if (!phone() && pKeys) b.append(h('kbd', { text: 'P' }));
    }
    playMoreBtn.title = t('pal.playFresh');
    playMoreBtn.setAttribute('aria-label', t('pal.playFresh'));
    keepSoon();
  }

  let lastPage = '';
  function renderAll(remount = false) {
    motionTool.sync();
    // The violet rings of the picked object's code layout (studio-code-knobs): sent only when the pick or its layout changed.
    codePlaces.guide();
    document.documentElement.lang = lang;
    keySheet.render();
    app.dataset.layout = phone() ? 'phone' : 'pc';
    renderPlayAsk();
    app.dataset.fit = sideWin() ? 'side' : 'full';
    setButton(largeBtn, 'openLarge', t('large.open'), false, t('large.tip'));
    sheetGrip.setAttribute('aria-label', t('sheet.grip'));
    sheetGrip.title = t('sheet.grip');
    app.dataset.sheet = sheetOpen ? 'open' : 'closed';
    // Folded (phone / side window only; PC has no sheet to fold): shell.css hides the sheet, the card and the AI's line.
    if (fold && phone()) app.dataset.fold = 'min';
    else delete app.dataset.fold;
    app.dataset.view = tool; // not data-tool: the Scene / Assets rows carry data-tool
    app.dataset.page = page;
    // The Library takes the game's place: the card steps away.
    app.dataset.shelf = tool === 'library' ? 'on' : 'off';
    // ▣ Studio / <the game> / <where you are>. While playing that is "Playing", not "Scene" (the second design review's
    // ⑪, 2026-10-19: the bar said Scene over a game you could not edit).
    (header.querySelector('.title') as HTMLElement).textContent = gameName || t('app.title');
    (header.querySelector('.app') as HTMLElement).textContent = t('app.brand');
    const sceneWord = (id: ToolId) => (id === 'placement' && editLayer === 'ui' ? t('uiLayer.ui') : t('tool.' + id));
    (header.querySelector('.here') as HTMLElement).textContent = playing ? t('status.playingShort') : page === 'settings' ? t('btn.settings') : page === 'next' ? t('btn.next') : sceneWord(tool);
    renderLevelCrumb();
    // (Playing with changes not saved: v0.1.7–0.1.8 had a quiet "· unsaved changes" after "Playing" here. Since the
    // second look of 2026-10-21 (B) the orange Save beside Play, and ▶ Play asks first — Save and play / Try without
    // saving — so nothing more is said once playing: togglePlay, save-loud.ts.)
    // World | UI (UI stage 1): only for a game with both layers, while the game is being edited in the Scene.
    app.dataset.editLayer = editLayer;
    const showSwitch = !!editLayers && editLayers.length > 1 && editing && !playing && tool === 'placement' && page === 'tool';
    layerSwitch.el.hidden = !showSwitch;
    if (showSwitch) {
      layerSwitch.render(editLayer, phone(), t, keyOf('layer', isMac()), uiPeek, keyOf('uiPeek', isMac()));
      const home = phone() ? stage : header;
      if (layerSwitch.el.parentElement !== home) home.append(layerSwitch.el);
    }
    (header.querySelector('.adapter') as HTMLElement).textContent = adapterInfo;
    langBtn.textContent = t('btn.lang');
    // Scene / Library: two rows, a 16 px icon and the name. The grey word for what is in it ("objects in this level" /
    // "objects & assets", tool.*.sub) is gone (studio-card-doors, 2026-10-23: two small lines more to read on the first
    // screen, saying what the names already say). Only the Library has a count — everything in it; the Scene's
    // objects are counted in its list (a "15" on both rows read as two different 15s).
    tabs.replaceChildren();
    for (const id of ['placement', 'library'] as ToolId[]) {
      // The Library holds the world's objects (the UI's HTML elements are not Library objects), its motions and its files:
      // counted as All and the grid's headings count them (studio-library-shelf, 2026-10-23; the UI plan 5 #2 — the
      // motions were missing here, so the row said 9 and All said 11).
      const n = id === 'placement' ? 0 : (editLayer === 'ui' ? worldItems : items).length + libraryMotions.count() + libraryCount;
      tabs.append(h('button', { type: 'button', role: 'tab', class: 'nav-row', 'aria-selected': String(tool === id && page === 'tool'), dataset: { tool: id }, onclick: () => switchTool(id) },
        icon(id === 'placement' ? (editLayer === 'ui' ? 'uiLayer' : 'cube') : 'grid'), h('span', { class: 'label', text: sceneWord(id) }),
        n ? h('span', { class: 'n', text: String(n) }) : null));
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
    // The phone's list button (renderSheetBtn; again at the end, once the card is placed). A language change redraws it.
    delete sheetBtn.dataset.state;
    renderSheetBtn();
    updateCaption();
    renderStatus();
    renderButtons();
    renderPresence();
    // The ask box lives in the bar at the bottom of the game whatever the tool or page.
    // The web demo (no AI behind it, host.offline) has no ask box (design review wave 1, W1-6 / N2, 2026-10-17: the most
    // visible part of the screen was a box that did nothing when used) and nothing in its place. W1-6 first put one grey
    // line there, "In Claude Code, your AI makes the changes you type here. Get Game Studio →"; it was taken out after a try
    // on 2026-10-18 ("what is this for? I'm already using Game Studio — get what?"). The demo's top line alone says it
    // isn't connected to an AI (src/hosts/browser/text.ts). Don't put a pitch or a link back down here without asking.
    if (!host.offline && placementPanel.askEl.parentElement !== askSlot) askSlot.append(placementPanel.askEl);
    // The AI's reply (and the news card's other lines): over the game's top on a phone / the side window (plan step 7:
    // it was the top block of the stack at the foot, over the card), in the dock over the field on PC. It still fades
    // by itself (line-fade.ts) and focusing the field brings it back.
    const capHome = phone() ? stage : dock;
    if (caption.parentElement !== capHome) {
      if (capHome === dock) dock.prepend(caption);
      else stage.insertBefore(caption, dock.nextSibling);
    }
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
    // The Scene | Library switch: the left column on PC; on a phone, the head of the sheet that is open (the list
    // sheet's, or the Library's: it has no list sheet under it).
    const lib = tool === 'library' ? libraryParts() : null;
    const tabsHome = phone() && page === 'tool' && lib ? lib.head : null;
    if (tabsHome) {
      if (tabs.parentElement !== tabsHome) tabsHome.prepend(tabs);
    } else if (tabs.parentElement !== sideHead) sideHead.prepend(tabs);
    // The Look page and the Ideas page: a window over the game on PC (studio-card-doors, 2026-10-23; the plan's rule
    // "one way in": they are ⌘K's, and opening them took the left column away from the scene list — the list, the pick
    // and the game went out of sight for a setting). Esc / ‹ Close / a press beside the plate close it (switchTool).
    // A phone keeps them in its sheet (the sheet already is a plate over the game).
    const winPage = page !== 'tool' && !phone();
    pageWin.hidden = !winPage;
    if (!winPage) pagePlate.replaceChildren();
    const pageEl = winPage ? pagePlate : toolEl;
    if (page === 'settings') {
      renderSettings(pageEl, { t, prefs: () => uiPrefs, change: changeUi, back: () => switchTool(tool), phone, lang: () => lang, setLang,
        aiLookOff: aiLook && !safeUi ? (() => { const u = new URL(location.href); u.searchParams.set('ui', 'off'); return u.href; })() : null });
    } else if (page === 'next') {
      renderNextSteps(pageEl, {
        host, lang: () => lang, t, back: () => switchTool(tool),
        // ✦ (studio-card-doors, 2026-10-23; the ✦ rule): "Ask Claude…" puts the idea in the ask box and closes the
        // page — the person sends it. It sent a next-step request at once before. The web demo has no box: the old send.
        send: (step, text) => askAi({ kind: 'next-step', step, text }),
        draft: host.offline ? undefined : (text) => {
          switchTool(tool);
          focusAsk(text);
        },
      }, nextOpen, (id) => {
        nextOpen = id;
        renderAll();
      });
    }
    if (page !== 'tool' && !winPage) {
      // (a phone's page fills the sheet: no list under it)
    } else if (!phone() && lib) {
      // The Library is open: the left column holds its filters and nothing else. The object list is not here next to
      // the grid, so a click in the column never leaves the Library for the game (the bug found in a try on 10/18).
      const f = lib.filters;
      // The list stays in the page, hidden (not shown, not pressable): its pictures and marks are ready when the game
      // view comes back, and scripts (.studio/ui/, the tests) that wait for its rows keep working.
      placementPanel.el.hidden = true;
      if (toolEl.firstChild !== f || toolEl.lastChild !== placementPanel.el || toolEl.childNodes.length !== 2) toolEl.replaceChildren(f, placementPanel.el);
      placementPanel.render();
    } else {
      placementPanel.el.hidden = false;
      if (toolEl.firstChild !== placementPanel.el || toolEl.childNodes.length !== 1) toolEl.replaceChildren(placementPanel.el);
      placementPanel.render();
    }
    renderShelf();
    renderSheetBtn();
    // Rows may have come into view without a scroll (a kind opened, the sheet opened).
    thumbsSoon(false);
    placeTimeline();
  }

  let lastLayout = `${phone()}${sideWin()}`;
  window.addEventListener('resize', () => {
    if (`${phone()}${sideWin()}` !== lastLayout) {
      lastLayout = `${phone()}${sideWin()}`;
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
  // ----- the AI's hands (studio-ai-hands, 2026-10-24; ai-hands.ts, CONTRACT.md §3.6) -----
  // `studio.mjs <game> --do …` from the AI: the editor's own edits, on the object the AI names, ONE ⌘Z for the job, and
  // a line saying the AI did it. WHY (a request, 2026-10-24): the AI asked the person to click through the editor for it.
  const aiHands = createAiHands({
    t,
    // The new page's own list (a level opened, a reload clears `items`): ops never land on the list of the page before.
    ready: () => bridgeAlive && editing && !swapping && (editLayer === 'world' ? items.length > 0 : worldItems.length > 0),
    playing: () => playing,
    stopPlay: async () => {
      if (playing) await togglePlay();
    },
    toWorld: () => {
      if (editLayers && editLayer !== 'world') setEditLayer('world');
    },
    dim: () => worldDim,
    item: (k) => worldItems.find((i) => i.key === k),
    label: (k) => {
      const it = worldItems.find((i) => i.key === k);
      return it ? displayName(it, t) : k;
    },
    keys: () => worldItems.map((i) => i.key),
    pose: (k) => worldModel.pose(k),
    // As the card's numbers do (setPose above), on the place itself: the timeline open or not, the AI moves where it stands.
    setPose: (k, pose) => {
      const from = worldModel.pose(k);
      if (from && undo.push(poseChange(k, from, pose))) applyPose(k, pose);
    },
    rename: (k, to) => renameObject(k, to),
    duplicate: async (k) => {
      const [copy] = copySelection([k]);
      if (!copy) return null;
      // The copy is the game page's to make (placement/added, which also pushes its undo change into the AI's group).
      for (const end = Date.now() + 5000; pendingCopies.has(copy) && Date.now() < end;) await new Promise((r) => setTimeout(r, 50));
      return worldModel.isCopy(copy) ? copy : null;
    },
    remove: (k) => removeSelection([k]),
    ground: (k) => new Promise<boolean>((resolve) => {
      if (!canDrop) return resolve(false);
      const off = ctx.on('studio:placement/moved', (m) => {
        if (m.key !== k || !m.end) return;
        off();
        clearTimeout(timer);
        resolve(true);
      });
      const timer = window.setTimeout(() => (off(), resolve(false)), 3000);
      send({ type: 'studio:placement/step', key: k, op: 'drop', hold: false });
    }),
    motionOf: (k) => timeline.motionOf(k),
    rawClips: (k) => worldModel.motion.get(k)?.clips ?? [],
    lib: (n) => motionLibrary.get(n),
    libNames: () => motionLibrary.list().map((m) => m.name),
    usage: (n) => timeline.usage(n).length,
    attach: (k, n) => timeline.attach(k, n),
    detach: (k, c) => timeline.detach(k, c),
    deleteLib: (n) => timeline.deleteLib(n),
    renameLib: (a, b) => timeline.renameLib(a, b),
    make: (k, m, o) => timeline.handsMake(k, m, o),
    clipSet: (k, c, o) => timeline.handsClipSet(k, c, o),
    libSet: (n, o) => timeline.handsLibSet(n, o),
    // Code motions and code layouts (studio-code-base, 2026-10-24): the game page's lists, and the level's layout changes.
    codeMotions: () => codeMotionList,
    codePlaces: () => codePlaceList,
    codeAvoids: () => codeAvoidList,
    reloadGame: async () => {
      clearTimeout(placesTimer);
      await softReload('draft');
      for (const end = Date.now() + 15_000; Date.now() < end;) {
        await new Promise((r) => setTimeout(r, 150));
        // The code's lists come right after the page's first list (their own messages): one more beat for them.
        if (!swapping && bridgeAlive && editing && worldItems.length) return (await new Promise((r) => setTimeout(r, 150)), true);
      }
      return false;
    },
    place: (id) => worldModel.places.get(id),
    placeIds: () => worldModel.places.ids(),
    setPlace: (id, e) => {
      const before = worldModel.places.get(id);
      setPlace(id, before, e);
      // A keep-out area the AI added or changed (place.avoid): its row glows violet on the card (studio-code-keepout).
      keepOut.aiChanged(id, before, worldModel.places.get(id));
    },
    // ✦ Turn into a rule (studio-code-torule): the rule's shape from the game page, and what the swap replaced.
    ruleSamples: (code, knobs, len, per) => ruleSamples(code, knobs, len, per),
    swapped: (x) => {
      if (x.kind === 'motion') {
        ruleCompare.setMotion(x.name, x.hand, x.gap);
        timeline.compared();
        return;
      }
      ruleCompare.setPlace(levelNow(), x.id, x.spots);
      // The rule's objects lit violet, as the AI's other changes are (the person sees what came in).
      const keys = codePlaceList.find((p) => p.id === x.id)?.keys ?? [];
      if (keys.length) setAiMarks(new Map(keys.map((k) => [k, 'added' as const])));
      // The person was looking at the hand objects (✦ on their card): the card turns to the rule's farthest one, its
      // "Max deviation" and the game's orange marks in view at once.
      const looking = [selected, ...group].some((k) => !!k && x.spots.some((s) => s.key === k));
      if (looking && x.gap && keys.includes(`${x.id}-${x.gap.n}`)) selectObject(`${x.id}-${x.gap.n}`);
      compareChanged();
    },
    levels: {
      active: () => levels.active,
      current: () => levels.current,
      ids: () => levels.list.map((e) => e.id),
      label: (id) => levels.labelOf(id),
      add: async (kind) => {
        const was = levels.active ? levels.current : '';
        await addLevel(kind);
        return levels.active && levels.current !== was ? levels.current : null;
      },
      go: async (id) => {
        await goLevel(id);
        return levels.current === id;
      },
      rename: (id, to) => {
        const ok = levels.rename(id, to);
        levelsChanged(ok);
        return ok;
      },
      // Not levelsChanged (that ends "just made"): the AI's "Duplicate as Night cove" stays one ⌘Z away, name and all.
      nameNew: (id, to) => {
        const ok = levels.rename(id, to);
        if (ok && levelMade?.id === id) {
          levelMade.name = levels.labelOf(id);
          renderLevelMade();
        }
        renderAll();
        keepSoon();
        return ok;
      },
    },
    save: () => handOff(),
    // After the answer is on its way (the CLI waits for it): the editor page itself, or the game behind the old picture.
    reload: (whole) => void window.setTimeout(() => (whole ? location.reload() : void softReload('ai')), whole ? 800 : 0),
    list: () => ({
      from: 'the editor',
      level: levels.active ? { id: levels.current, name: levels.labelOf(levels.current) } : undefined,
      objects: worldItems.map((i) => {
        const ms = (timeline.motionOf(i.key)?.clips ?? []).map((c) => c.name);
        // `p` (studio-code-torule): where it stands in the editor now, saved or not — what "turn the lamps into a rule"
        // fits a rule to (centimetres / whole pixels: the rule's knobs are rounder than that anyway).
        const ps = worldModel.pose(i.key);
        const p = ps ? ps.p.map((v) => (worldDim === '2d' ? Math.round(v) : Math.round(v * 100) / 100)) : undefined;
        return { key: i.key, name: displayName(i, t), ...(p ? { p } : {}), ...(ms.length ? { motions: ms } : {}), ...(i.unstable ? { unstable: true } : {}), ...(i.backdrop || i.held === 'ground' ? { ground: true } : {}) };
      }),
      // A motion of points with its points (`keys.p`, studio-code-torule): "turn the ship's motion into a rule" fits them.
      motions: motionLibrary.list().map((m) => ({ name: m.name, len: m.len, repeat: m.repeat ?? 'once', on: timeline.usage(m.name).map((u) => u.key),
        ...(!m.code && m.keys?.p?.length ? { keys: { p: m.keys.p.map((k) => ({ t: k.t, v: k.v.slice() })) } } : {}) })),
      ...(levels.active ? { levels: levels.list.map((e) => ({ id: e.id, name: levels.labelOf(e.id) })) } : {}),
    }),
    undoBegin: () => undo.begin(),
    undoEnd: (words) => {
      const e = undo.end(words);
      renderButtons();
      return !!e;
    },
    done: (words, undoable) => {
      renderAll();
      keepSoon();
      // Who changed it, and the way back, in one line where the person's eyes are (the ask bar's notice).
      const line = !undoable ? words : phone() ? t('hands.undoTouch', { text: words }) : t('hands.undo', { text: words, key: keyOf('undo', isMac()) });
      showToast(line, 8000);
    },
  });

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
    nameOf: (k) => {
      const it = items.find((i) => i.key === k);
      return it ? displayName(it, t) : k;
    },
    selected: () => selected,
    actions: {
      undo: () => doUndo(),
      redo: () => doRedo(),
      save: async () => void (await handOff()),
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
  // The timeline's state for the screen tests (test/studio-timeline.browser.mjs): what is open, the time, the picked
  // keys. Not part of studioShell (no promise to .studio/ui/ scripts).
  (window as unknown as { __studioTimeline: typeof timeline }).__studioTimeline = timeline;

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
      prefsLoaded = true;
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
      const saved = v && v.ok ? v.value : null;
      // The Library's motions first: reading each level's clips below asks it for the motion each clip is.
      motionLibrary.restore(saved);
      levels.load(saved);
      for (const e of levels.list) if (e.world.motion) e.world.motion = attachWorld(e.world.motion, motionLibrary, saved?.dim ?? dim);
      if (levels.active) {
        worldModel.restore(levels.viewOf(levels.current, saved));
        if (levels.isBlank()) worldModel.blankKeep = keptInBlank;
      }
      else (worldModel.restore(saved), (startWorld = saved ? worldOf(saved) : undefined));
      uiModel.restore(uiAsPlacement(saved));
      uiWire.restore(saved);
      fileUi = saved?.ui;
      fileUiView = saved?.uiView;
      if (tools.library?.restore) tools.library.restore(await host.load('library').catch(() => null));
      // The left column's "Assets  4".
      void host.listAssets().then((r) => {
        libraryCount = r.files.length;
        renderAll();
      }, () => undefined);
      loadGame();
      void pollStatus();
      // The AI's hands (ai-hands.ts): jobs from `studio.mjs --do` from now on (they wait for the game to be listed).
      host.hands?.((job) => aiHands.run(job));
    } catch (e) {
      showToast((e as Error).message);
    }
  })();
}
