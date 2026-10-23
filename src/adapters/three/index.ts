// The built-in three.js adapter as the bridge sees it (an AdapterProbe).
//
// boot.js does the early work (discovery through __THREE_DEVTOOLS__, holding
// frames, learning the player's camera from renderer.render, load records);
// it is imported first by src/bridge/main.ts so it runs before any game code.
// adapter.js builds the adapter once a scene has been rendered. This file
// answers the bridge's synchronous "found an adapter yet?" and fits adapter.js
// to the contract (CONTRACT.md §1.1).
//
// WHY a translation layer: adapter.js was written against the first draft of
// the port, where screen points were NDC (-1..1) and view deltas fractions of
// the canvas. Contract v1 uses viewport CSS px everywhere, because only the
// adapter knows the canvas rectangle. Converting here keeps adapter.js and its
// own tests unchanged; folding the conversion into adapter.js later is fine.
import type { AdapterProbe, StudioAdapter } from '../../contract.ts';
import { createThreeAdapter } from './adapter.js';
import { project, rayFromCamera, rayPlaneY, viewProjOf } from './math.js';

interface BootState {
  scenes: Array<{ traverse(cb: () => void): void }>;
  renderers: Array<{ domElement?: HTMLCanvasElement }>;
  lastCamera: WeakMap<object, unknown>;
  readyCamera: unknown;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- adapter.js is plain JS */
type Raw = any;

/** Wrap adapter.js (NDC-based) into the contract's px-based StudioAdapter. */
export function fitThreeAdapter(raw: Raw, canvas: HTMLCanvasElement): StudioAdapter {
  const rect = () => canvas.getBoundingClientRect();
  const ndc = (x: number, y: number): [number, number] => {
    const r = rect();
    return [((x - r.left) / Math.max(1, r.width)) * 2 - 1, 1 - ((y - r.top) / Math.max(1, r.height)) * 2];
  };
  const poseNow = (key: string) => raw.list().find((i: Raw) => i.key === key)?.pose;
  const pose = (key: string, p: Raw) => p || poseNow(key);
  return {
    kind: 'three',
    dim: '3d',
    version: (globalThis as Raw).__THREE__ ? String((globalThis as Raw).__THREE__) : undefined,
    list: () => raw.list(),
    begin: () => raw.begin(),
    end: () => raw.end(),
    watch: (on, whole) => raw.watch(on, whole),
    // adapter.js repaints from its own loop whenever something changed.
    render: () => {},
    pickNear: (x, y, radius) => raw.pickNear(...ndc(x, y), radius),
    anchor(key) {
      const a = raw.anchor(key);
      if (!a) return null;
      const r = rect();
      const [x0, y0, x1, y1] = a.rectPx || [];
      const has = a.rectPx && Number.isFinite(x0);
      const vw = innerWidth, vh = innerHeight;
      const [cx, cy] = a.centerPx;
      return {
        center: [cx, cy],
        rect: has ? { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) } : undefined,
        liftPx: a.liftPx,
        size: has ? Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) : Math.min(r.width, r.height) / 10,
        pose: a.pose,
        visible: !!a.front && cx > -vw && cy > -vh && cx < 2 * vw && cy < 2 * vh,
      };
    },
    grab: (key, x, y) => raw.grab(key, ...ndc(x, y)),
    drag: (key, x, y) => pose(key, raw.drag(key, ...ndc(x, y))),
    // Contract: d is clockwise on screen. Seen from the edit camera (always
    // above the ground, pitch 8–85°), clockwise = negative rotation.y.
    rotate: (key, d) => pose(key, raw.rotate(key, -d)),
    // The axis and sign are worked out in adapter.js from the edit camera (d stays screen clockwise).
    turn: (key, d, axis) => pose(key, raw.turn(key, d, axis)),
    foot: (key) => raw.foot(key),
    middle: (key) => raw.middle(key),
    coverage: (key) => raw.coverage(key),
    scale: (key, f) => pose(key, raw.scale(key, f)),
    nudgeY: (key, dy) => pose(key, raw.nudgeY(key, dy)),
    // Snap to surfaces (surface.js, bridge/snap.ts): heights are world metres, as nudgeY moves by.
    rest: (key, skip) => raw.rest(key, skip),
    drop: (key, skip) => pose(key, raw.drop(key, skip)),
    setSnap: (s) => raw.setSnap(s),
    setPose: (key, p) => raw.setPose(key, p),
    capture: (key, o) => raw.capture(key, o),
    silhouette: (keys) => raw.silhouette(keys),
    clone: (key, newKey) => raw.clone(key, newKey),
    remove: (key) => raw.remove(key),
    putBack: (key) => raw.putBack(key),
    assetsOf: (key) => raw.assetsOf(key),
    player: () => raw.player(),
    // For game tools: the edit camera's ray onto a horizontal plane, and the
    // way back. Only while editing (the edit camera exists then).
    toGround(x, y, groundY = 0) {
      const cam = raw.view.camera;
      if (!cam) return null;
      const hit = rayPlaneY(rayFromCamera(cam, ...ndc(x, y)), groundY);
      return hit ? [hit[0], hit[1], hit[2]] : null;
    },
    toScreen(p) {
      const cam = raw.view.camera;
      if (!cam) return null;
      cam.updateMatrixWorld?.(true);
      const c = project(viewProjOf(cam), [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]);
      if (!(c[3] > 0)) return null;
      const r = rect();
      return [r.left + ((c[0] + 1) / 2) * r.width, r.top + ((1 - c[1]) / 2) * r.height];
    },
    view: {
      orbit: (dx, dy) => void raw.view.orbit(dx / Math.max(1, rect().width), dy / Math.max(1, rect().height)),
      pan: (dx, dy) => void raw.view.pan(dx / Math.max(1, rect().width), dy / Math.max(1, rect().height)),
      rise: (dy) => void raw.view.rise(dy / Math.max(1, rect().height)),
      fly: (right, up, fwd) => void raw.view.fly(right, up, fwd),
      look: (dx, dy) => void raw.view.look(dx / Math.max(1, rect().width), dy / Math.max(1, rect().height)),
      zoom: (f, x, y) => void (x === undefined || y === undefined ? raw.view.zoom(f) : raw.view.zoom(f, ...ndc(x, y))),
      frameAll: () => void raw.view.frameAll(),
      focus: (key) => void raw.view.focus(key),
      state: () => raw.view.state(),
      restore: (s) => void raw.view.restore(s),
      home: (opts) => void raw.view.home(opts),
      settle: (key, done) => !!raw.view.settle(key, done),
    },
  };
}

let built: StudioAdapter | null = null;
let builtFor: unknown = null;

/** The scene the player looks at: rendered with a camera, with the most objects (same rule as whenThreeReady). */
function mainScene(boot: BootState) {
  let best = null;
  let bestN = -1;
  for (const s of boot.scenes) {
    if (!boot.lastCamera.has(s) && !boot.readyCamera) continue;
    let n = 0;
    s.traverse(() => n++);
    if (n > bestN) {
      best = s;
      bestN = n;
    }
  }
  return best;
}

export const threeProbe: AdapterProbe = {
  kind: 'three',
  install() {
    // boot.js already installed its hooks when the edit script started.
  },
  found() {
    const boot = (globalThis as unknown as { __studioThree?: BootState }).__studioThree;
    if (!boot) return null;
    const scene = mainScene(boot);
    const renderer = boot.renderers.find((r) => r.domElement && r.domElement.isConnected) || boot.renderers[0];
    if (!scene || !renderer) return null;
    if (built && builtFor === scene) return built;
    built = fitThreeAdapter(createThreeAdapter({ scene, renderer, camera: undefined }), (renderer as Raw).domElement);
    builtFor = scene;
    return built;
  },
};
