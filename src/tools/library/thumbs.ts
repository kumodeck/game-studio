// Library: thumbnails drawn by the SHELL page (not by the game).
//
// Images are shown as they are (<img>, also for SVG: an <img> never runs a
// script inside the SVG, while inline SVG or <object> would). 3D models are
// rendered once into a small picture with the shell's own copy of three.js,
// loaded from a CDN on first use. It is a separate copy from the game's on
// purpose: the game may pin any three version, may not use three at all
// (PixiJS games still have .glb files), and must not be disturbed by the
// studio's rendering.
//
// The `+esm` builds are used because GLTFLoader imports the bare name
// 'three'; the CDN rewrites it to the matching core URL, so loader and core
// are the same instance without an import map on the shell page.

const THREE_VERSION = '0.186.1';
const THREE_CORE = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/+esm`;
const THREE_GLTF = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/loaders/GLTFLoader.js/+esm`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the CDN copy of three is untyped here
type Any = any;

let threeP: Promise<{ THREE: Any; GLTFLoader: Any }> | null = null;
function loadThree() {
  threeP ??= Promise.all([import(THREE_CORE), import(THREE_GLTF)]).then(([THREE, g]) => ({ THREE, GLTFLoader: g.GLTFLoader }));
  // A failed load (offline, blocked by policy) should not be cached forever.
  threeP.catch(() => { threeP = null; });
  return threeP;
}

// One renderer for every thumbnail, and one model at a time: WebGL contexts
// are limited (browsers drop the oldest after ~16) and a long list of models
// would otherwise create one context each.
let renderer: Any = null;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<string | null>>();

function disposeTree(root: Any) {
  root.traverse((o: Any) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m) as Any[]) if (v?.isTexture) v.dispose();
      m.dispose?.();
    }
  });
}

async function renderModel(url: string, size: number): Promise<string | null> {
  const { THREE, GLTFLoader } = await loadThree();
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(3, 5, 4);
  scene.add(sun, model);

  // Frame the model from a 3/4 view above, whatever its size or offset.
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius > 0 && Number.isFinite(sphere.radius) ? sphere.radius : 1;
  const camera = new THREE.PerspectiveCamera(35, 1, r / 100, r * 100);
  const dist = r / Math.sin((35 / 2) * (Math.PI / 180));
  camera.position.copy(sphere.center).add(new THREE.Vector3(0.6, 0.45, 0.65).normalize().multiplyScalar(dist * 1.05));
  camera.lookAt(sphere.center);

  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const data = renderer.domElement.toDataURL('image/png');
  disposeTree(model);
  return data;
}

/**
 * PNG data URL of a .glb/.gltf, or null when it cannot be drawn (no WebGL,
 * CDN unreachable, broken file). The caller shows a type icon instead.
 */
export function modelThumb(url: string, size = 128): Promise<string | null> {
  const id = `${size}|${url}`;
  let p = cache.get(id);
  if (!p) {
    p = queue.then(() => renderModel(url, size)).catch(() => null);
    queue = p;
    cache.set(id, p);
  }
  return p;
}

/** Image an atlas json points to (meta.image, relative to the json), or null. */
export async function atlasImageUrl(jsonUrl: string): Promise<string | null> {
  try {
    const j = await (await fetch(jsonUrl)).json();
    const img = j?.meta?.image;
    return typeof img === 'string' && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(img) ? new URL(img, jsonUrl).href : null;
  } catch {
    return null;
  }
}

let fontN = 0;
/**
 * Load a font file under a generated family name and return that name.
 * The family is never the file name (file names are untrusted text and
 * would end up inside a CSS value).
 */
export async function fontFamily(url: string): Promise<string | null> {
  try {
    const family = `gsl-font-${++fontN}`;
    const face = new FontFace(family, `url(${JSON.stringify(url)})`);
    await face.load();
    (document.fonts as Any).add(face);
    return family;
  } catch {
    return null;
  }
}

/** Forget cached thumbnails of one file (after it was replaced on disk) or all. */
export function forgetThumbs(url?: string) {
  if (!url) return cache.clear();
  for (const k of [...cache.keys()]) if (k.endsWith(`|${url}`)) cache.delete(k);
}
