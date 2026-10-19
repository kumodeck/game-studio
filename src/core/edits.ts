// Copy and delete, for every adapter (CONTRACT.md §1.8).
//
// This is one more StudioAdapter around the found adapter (under the game
// rules layer, so grid snapping and locks apply to copies too). It makes
// copies and deletions work the same way for every engine:
//
// - Adapters with clone() / remove() / putBack() (the built-in three.js
//   adapter, the shipped Pixi and canvas examples) make REAL copies in the
//   engine and really take objects out of the picture.
// - Adapters without them still get both, as stand-ins (WHY: an AI-written
//   adapter for Phaser or a home-made engine should not need new code before
//   the person can lay out five more trees; the AI adds the real objects to
//   the code afterwards anyway):
//     · a copy is a "ghost": an entry in the list with its own pose, drawn by
//       the bridge as a see-through picture of the original. Every operation
//       on it (anchor, drag, rotate, scale) is done by putting the ORIGINAL at
//       the ghost's pose for a moment, asking the adapter, and putting the
//       original back exactly (setPose is exact by contract). So the maths of
//       every adapter (2D parents, 3D ground planes) is reused unchanged.
//     · a deleted object is shrunk to 1/10000 of its size (out of sight, not
//       pickable) and left out of the list; undo sets its old pose back.
//
// Keys never change because of a copy or a deletion: copies get the key the
// shell chose, and deleted objects stay in the engine (hidden) so the
// numbering of the others (tree#2, path:0/3) does not shift while editing.
import type { Anchor, Item, Pose, StudioAdapter } from '../contract.ts';

/** Scale used to make a deleted object vanish when the adapter has no remove(). */
const SHRINK = 1e-4;

interface Ghost {
  /** The real object the stand-in is drawn from (a ghost of a ghost still points at the real one). */
  src: string;
  /** What it is a copy of (may be another ghost). */
  from: string;
  pose: Pose;
}

interface Removed {
  how: 'real' | 'shrink' | 'ghost';
  /** shrink: the pose to put back. */
  pose?: Pose;
}

export interface EditsAdapter extends StudioAdapter {
  /**
   * Make a copy of `from` listed as `key`, at the pose of `from`. Returns
   * whether it is a stand-in, or null when it cannot be made. A key that
   * already exists as a deleted copy (undo of a copy, then redo) is brought
   * back instead.
   */
  make(key: string, from: string): { ghost: boolean } | null;
  removeKeys(keys: string[]): string[];
  restoreKeys(keys: string[]): string[];
  /** Stand-in copies on screen now (for the bridge to draw). */
  ghosts(): Array<{ key: string; src: string; pose: Pose }>;
  /** Copies made in this session (key → from), real and stand-in. */
  copies(): Map<string, string>;
}

const noZ = (p: Pose): Pose => {
  const out: Pose = { p: p.p.slice() };
  if (p.r !== undefined) out.r = p.r;
  if (p.s !== undefined) out.s = Array.isArray(p.s) ? p.s.slice() : p.s;
  if (p.t !== undefined) out.t = [p.t[0], p.t[1]];
  return out;
};

export function withEdits(inner: StudioAdapter): EditsAdapter {
  const canEdit = typeof inner.clone === 'function' && typeof inner.remove === 'function' && typeof inner.putBack === 'function';
  const ghosts = new Map<string, Ghost>();
  const removed = new Map<string, Removed>();
  /** Every copy made this session, key → from (kept while deleted, for redo). */
  const made = new Map<string, string>();

  const rawItem = (key: string): Item | undefined => inner.list().find((i) => i.key === key);
  const poseNow = (key: string): Pose | null => inner.anchor(key)?.pose ?? rawItem(key)?.pose ?? null;

  /**
   * Run `fn` with the real object `src` standing at `pose`, then put it back
   * exactly. A frame is drawn at both steps: adapters that read the screen
   * box from the page (DOM games: getBoundingClientRect) only see a move
   * after the game has drawn it, and the picture must end with the original
   * back in place (stand-ins only, so the extra frames cost nothing elsewhere).
   */
  function probe<T>(src: string, pose: Pose, fn: () => T): T {
    const back = poseNow(src);
    inner.setPose(src, noZ(pose));
    redraw();
    try {
      return fn();
    } finally {
      if (back) inner.setPose(src, back);
      redraw();
    }
  }
  const redraw = () => {
    try {
      inner.render();
    } catch {
      /* the editor's own loop reports render errors */
    }
  };
  const ghostOf = (key: string) => (removed.has(key) ? undefined : ghosts.get(key));

  const list = (): Item[] => {
    const raw = inner.list();
    const byKey = new Map(raw.map((i) => [i.key, i]));
    const out: Item[] = [];
    for (const it of raw) {
      if (removed.has(it.key)) continue;
      const from = made.get(it.key);
      out.push(from ? { ...it, copyOf: from } : it);
    }
    for (const [key, g] of ghosts) {
      if (removed.has(key)) continue;
      const src = byKey.get(g.src);
      if (!src) continue;
      out.push({ ...src, key, label: key, unstable: undefined, layer: undefined, backdrop: undefined, copyOf: g.from, ghost: true, pose: noZ(g.pose) });
    }
    return out;
  };

  const ghostAnchor = (g: Ghost): Anchor | null => {
    const a = probe(g.src, g.pose, () => inner.anchor(g.src));
    return a ? { ...a, pose: noZ(g.pose), rect: a.rect ? { ...a.rect } : undefined } : null;
  };
  /** A pose-changing call on a ghost: done on its original standing at the ghost's pose. */
  const onGhost = (g: Ghost, fn: () => Pose | null | undefined): Pose => {
    const p = probe(g.src, g.pose, fn);
    if (p && Array.isArray(p.p)) g.pose = noZ(p);
    return noZ(g.pose);
  };

  const shrunk = (p: Pose): Pose => ({ ...p, s: Array.isArray(p.s) ? p.s.map(() => SHRINK) : SHRINK });

  const edits: EditsAdapter = {
    ...inner,
    list,
    begin: () => {
      inner.begin();
      return list();
    },
    pickNear(x, y, radius) {
      const keys = inner.pickNear(x, y, radius).filter((k) => !removed.has(k));
      // Stand-ins are drawn over the game, so they come first.
      const hits: string[] = [];
      for (const [key, g] of ghosts) {
        if (removed.has(key)) continue;
        const r = ghostAnchor(g)?.rect;
        if (!r) continue;
        const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
        const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
        if (Math.hypot(dx, dy) <= radius) hits.push(key);
      }
      return [...hits.reverse(), ...keys];
    },
    anchor(key) {
      if (removed.has(key)) return null;
      const g = ghosts.get(key);
      return g ? ghostAnchor(g) : inner.anchor(key);
    },
    grab(key, x, y) {
      const g = ghostOf(key);
      if (g) return probe(g.src, g.pose, () => inner.grab(g.src, x, y));
      return !removed.has(key) && inner.grab(key, x, y);
    },
    drag(key, x, y) {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.drag(g.src, x, y)) : inner.drag(key, x, y);
    },
    rotate(key, d) {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.rotate(g.src, d)) : inner.rotate(key, d);
    },
    turn: inner.turn ? (key, d, axis) => {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.turn!(g.src, d, axis)) : inner.turn!(key, d, axis);
    } : undefined,
    foot: inner.foot ? (key) => (ghosts.has(key) || removed.has(key) ? null : inner.foot!(key)) : undefined,
    middle: inner.middle ? (key) => (ghosts.has(key) || removed.has(key) ? null : inner.middle!(key)) : undefined,
    coverage: inner.coverage ? (key) => (ghosts.has(key) || removed.has(key) ? null : inner.coverage!(key)) : undefined,
    scale(key, f) {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.scale(g.src, f)) : inner.scale(key, f);
    },
    setPose(key, pose) {
      const g = ghosts.get(key);
      if (g) {
        g.pose = noZ(pose);
        return noZ(g.pose);
      }
      if (removed.get(key)?.how === 'shrink') return null;
      return inner.setPose(key, pose);
    },
    async capture(key, opts) {
      const g = ghosts.get(key);
      return inner.capture(g ? g.src : key, opts);
    },
    assetsOf(key) {
      const g = ghosts.get(key);
      return inner.assetsOf(g ? g.src : key);
    },
    view: inner.view,

    make(key, from) {
      if (made.has(key)) {
        // Redo of a copy: it still exists, deleted. Bring it back.
        if (removed.has(key)) edits.restoreKeys([key]);
        return { ghost: ghosts.has(key) };
      }
      if (removed.has(from)) return null;
      const g = ghosts.get(from);
      if (g) {
        // A copy of a stand-in is another stand-in of the same original.
        ghosts.set(key, { src: g.src, from, pose: noZ(g.pose) });
        made.set(key, from);
        return { ghost: true };
      }
      const pose = poseNow(from);
      if (!pose) return null;
      if (canEdit) {
        let ok = false;
        try {
          ok = !!inner.clone!(from, key) && !!rawItem(key);
        } catch (e) {
          console.warn('[studio] clone() failed, showing a stand-in instead:', e);
        }
        if (ok) {
          made.set(key, from);
          return { ghost: false };
        }
      }
      ghosts.set(key, { src: from, from, pose: noZ(pose) });
      made.set(key, from);
      return { ghost: true };
    },

    removeKeys(keys) {
      const done: string[] = [];
      for (const key of keys) {
        if (removed.has(key)) continue;
        if (ghosts.has(key)) {
          removed.set(key, { how: 'ghost' });
          done.push(key);
          continue;
        }
        const pose = poseNow(key);
        if (!pose) continue;
        let real = false;
        if (canEdit) {
          try {
            real = !!inner.remove!(key);
          } catch (e) {
            console.warn('[studio] remove() failed, hiding the object instead:', e);
          }
        }
        if (real) removed.set(key, { how: 'real' });
        else {
          inner.setPose(key, shrunk(pose));
          removed.set(key, { how: 'shrink', pose });
        }
        done.push(key);
      }
      return done;
    },

    restoreKeys(keys) {
      const done: string[] = [];
      for (const key of keys) {
        const r = removed.get(key);
        if (!r) continue;
        removed.delete(key);
        if (r.how === 'real') inner.putBack!(key);
        else if (r.how === 'shrink' && r.pose) inner.setPose(key, r.pose);
        done.push(key);
      }
      return done;
    },

    ghosts() {
      const out: Array<{ key: string; src: string; pose: Pose }> = [];
      for (const [key, g] of ghosts) if (!removed.has(key)) out.push({ key, src: g.src, pose: noZ(g.pose) });
      return out;
    },
    copies: () => new Map(made),
  };
  if (inner.nudgeY) {
    edits.nudgeY = (key, dy) => {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.nudgeY!(g.src, dy)) : inner.nudgeY!(key, dy);
    };
  }
  return edits;
}
