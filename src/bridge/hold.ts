// Objects the editor holds still (Item.held), as one more StudioAdapter layer like the game rules (core/rules.ts).
//
// WHY (a hands-on try of 2026-10-19, items 4 and 5):
// - "Just trying things out, the road (the ground) ended up 16 m up, and I could save it like that." A 3D ground,
//   road or sky (Item.backdrop, adapters/three/ground.js) is held from the start: no tool works on it until the
//   person presses "Make movable" on its card or its menu — one more step, on purpose (`freed`).
// - "This game moves the pillars toward you every frame and puts them back at random, so a place I set is not
//   kept." What the game changed during the first moments of play (bridge/observe.ts) is held as 'game': only that
//   part is off (the game would undo it every frame) — its place, its height, its turn or its size — and the rest
//   stays editable: the values that last, as suggested in that try.
//
// WHY a layer and not only flags: the flags hide the tool strip's buttons, but steps also come from keys, the ⌘K
// list and game tools. Refusing grab / drag / nudgeY / rotate / scale here covers every way in at once. setPose
// stays open: undo, redo and loading a saved file must restore poses exactly (the same rule as core/rules.ts).
// The AI can always move a held object in the code; this only keeps a stray drag from doing it.
import type { Dim, Item, Pose, StudioAdapter } from '../contract.ts';

/** What the game itself changed while the editor watched (observe.ts): place (3D x / z), height (3D y), turn, size. */
export interface Driven {
  move: boolean;
  lift: boolean;
  turn: boolean;
  size: boolean;
}

/**
 * The Height tool can act on it. Before 2026-10-19 that was "liftable and movable" everywhere (a locked object has
 * neither); a pillar the game slides along the road is not movable but keeps its height, so held 'game' looks at
 * `liftable` alone. Everything else keeps the old rule.
 */
export const canLift = (i: Pick<Item, 'liftable' | 'movable' | 'held'> | undefined): boolean => !!i && i.liftable !== false && (i.movable !== false || i.held === 'game');

export interface HoldState {
  /** Grounds the person made movable ("Make movable"), for this session. */
  freed: Set<string>;
  /** Objects the game moves by itself, found when editing started. */
  driven: Map<string, Driven>;
  /** Copies being put next to their original right now (editor.ts copy): that first step is the editor's, not a drag. */
  placing: Set<string>;
}

export const createHoldState = (): HoldState => ({ freed: new Set(), driven: new Map(), placing: new Set() });

/** The item as the editor shows it: `held` set, and the tools it cannot take turned off. */
export function holdItem(it: Item, s: HoldState, dim: Dim): Item {
  // A copy of something the game moves (⌘D, paste, Add to scene) is held like its original (e2e-016, 2026-10-20): a
  // pillar's copy was free to place, then the AI added it to the game's pillars and the game moved it every frame,
  // so the place set in the editor did not stick — the very thing the original's note warns about.
  // While the editor puts a fresh copy beside its original (`placing`) it is not held, or the copy of a falling star
  // stayed exactly on the star (studio-edit-ops canvas-stars).
  const d = s.driven.get(it.key) ?? (it.copyOf && !s.placing?.has(it.key) ? s.driven.get(it.copyOf) : undefined);
  // The game's own motion wins over "ground": a road the game scrolls is not kept where it is put either.
  if (d && (d.move || d.lift || d.turn || d.size)) {
    return {
      ...it,
      held: 'game',
      driven: (['move', 'lift', 'turn', 'size'] as const).filter((k) => d[k]),
      movable: it.movable !== false && !d.move,
      liftable: it.liftable !== false && it.movable !== false && !d.lift,
      rotatable: it.rotatable && !d.turn,
      scalable: it.scalable && !d.size,
    };
  }
  // 3D only: in 2D the ground already cannot be dragged (input.ts grabbable) and a 2D backdrop is about draw order.
  if (dim === '3d' && it.backdrop && !s.freed.has(it.key)) {
    return { ...it, held: 'ground', movable: false, liftable: false, rotatable: false, scalable: false };
  }
  return it;
}

/** The layer: list()/begin() carry `held`; edits of what is held do nothing (they return the current pose). */
export function withHold(inner: StudioAdapter, s: HoldState): StudioAdapter {
  let cache = new Map<string, Item>();
  const decorate = (list: Item[]) => {
    const out = list.map((i) => holdItem(i, s, inner.dim));
    cache = new Map(out.map((i) => [i.key, i]));
    return out;
  };
  const itemOf = (key: string) => cache.get(key) ?? decorate(inner.list()).find((i) => i.key === key);
  const now = (key: string): Pose => inner.anchor(key)?.pose ?? itemOf(key)?.pose ?? { p: [0, 0, 0] };
  const held: StudioAdapter = {
    ...inner,
    list: () => decorate(inner.list()),
    begin: () => decorate(inner.begin()),
    grab: (key, x, y) => (itemOf(key)?.movable === false ? false : inner.grab(key, x, y)),
    drag: (key, x, y) => (itemOf(key)?.movable === false ? now(key) : inner.drag(key, x, y)),
    rotate: (key, d) => (itemOf(key)?.rotatable === false ? now(key) : inner.rotate(key, d)),
    scale: (key, f) => (itemOf(key)?.scalable === false ? now(key) : inner.scale(key, f)),
  };
  if (inner.nudgeY) {
    const nudge = inner.nudgeY.bind(inner);
    held.nudgeY = (key, dy) => (canLift(itemOf(key)) ? nudge(key, dy) : now(key));
  }
  // Drop to floor (End, snap to surfaces 2026-10-19) changes the height only, so it follows the Height tool's rule:
  // a held ground is not dropped onto whatever lies under it, a pillar the game slides still can be. Merged with
  // the hold layer when the branches were merged (2026-10-19) — without this the spread above let End move a held road.
  if (inner.drop) {
    const drop = inner.drop.bind(inner);
    held.drop = (key, skip) => (canLift(itemOf(key)) ? drop(key, skip) : now(key));
  }
  return held;
}
