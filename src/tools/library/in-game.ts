// Library: the part that runs INSIDE the game iframe.
//
// 1. assetsFromScene(): best-effort "object -> files" for engines whose
//    textures remember where they came from. Adapters can call it from their
//    assetsOf(key) so three.js and PixiJS answer the same way.
// 2. previewImage(): show a different picture on the game's textures without
//    saving anything (the "try it on" step of a replace).
//
// Both work on plain engine objects found by duck typing (no import of
// three or pixi): the game's own copy of the engine is the only one inside
// the iframe, and its version is whatever the game pinned.
//
// Preview keeps the ORIGINAL pixel size: the new picture is drawn scaled into
// a canvas of the old image's size. Sprite frames, atlas regions and UVs are
// in the old image's pixels, so a different-size picture would otherwise show
// the wrong region. It is a preview; the real swap is done by the AI in code.
//
// Limits (documented, not hidden): textures decoded to ImageBitmap without a
// URL (three's GLTFLoader, data: URIs) cannot be matched to a file, so they
// are neither listed as "used" here nor previewed.

import type { AssetRef } from '../../contract.ts';

type Any = Record<string, any>;

const TEXTURE_SLOTS = ['map', 'emissiveMap', 'alphaMap', 'aoMap', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'specularMap', 'lightMap', 'displacementMap', 'matcap', 'gradientMap'];

function isThreeObject(o: Any): boolean {
  return !!o && o.isObject3D === true && typeof o.traverse === 'function';
}

function isPixiContainer(o: Any): boolean {
  return !!o && Array.isArray(o.children) && typeof o.addChild === 'function';
}

/** URL of an image-like thing, or '' if it has none (ImageBitmap, canvas). */
function srcOf(img: Any): string {
  if (!img) return '';
  if (typeof img.currentSrc === 'string' && img.currentSrc) return img.currentSrc;
  if (typeof img.src === 'string') return img.src;
  return '';
}

function abs(url: string): string {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

function stripQuery(u: string): string {
  return u.split(/[?#]/)[0];
}

// ---------------------------------------------------------------------------
// three.js
// ---------------------------------------------------------------------------

function threeTextures(root: Any): Any[] {
  const out: Any[] = [];
  root.traverse((o: Any) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const slot of TEXTURE_SLOTS) {
        const t = m[slot];
        if (t && t.isTexture) out.push(t);
      }
      // ShaderMaterial uniforms can hold textures too.
      if (m.uniforms) {
        for (const u of Object.values(m.uniforms) as Any[]) if (u?.value?.isTexture) out.push(u.value);
      }
    }
  });
  return out;
}

/**
 * Textures currently showing a preview -> the URL they were loaded from.
 * While previewed, three's texture.image is a canvas without a URL; without
 * this map the object would stop reporting its file and the replace entry
 * would lose its "usedBy".
 */
const previewedFrom = new WeakMap<object, string>();

/** The URL a three texture was loaded from ('' when unknown). */
function threeTexUrl(t: Any): string {
  // Texture.image is the source's data in r170+; keep both reads for older builds.
  return previewedFrom.get(t) ?? srcOf(t.source?.data ?? t.image);
}

// ---------------------------------------------------------------------------
// PixiJS v8
// ---------------------------------------------------------------------------

function pixiSources(root: Any): Any[] {
  const out: Any[] = [];
  const walk = (o: Any) => {
    const texes: Any[] = [];
    if (o.texture?.source) texes.push(o.texture);
    if (Array.isArray(o.textures)) for (const t of o.textures) texes.push(t?.texture ?? t); // AnimatedSprite
    for (const t of texes) if (t?.source) out.push(t.source);
    for (const c of o.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

/** Pixi's Assets loader writes the URL into source.label (and _sourceOrigin). */
function pixiSourceUrl(s: Any): string {
  const u = (typeof s._sourceOrigin === 'string' && s._sourceOrigin) || (typeof s.label === 'string' && s.label) || srcOf(s.resource);
  return u && /\.[a-z0-9]{2,5}([?#].*)?$/i.test(u) ? u : '';
}

// ---------------------------------------------------------------------------
// object -> files
// ---------------------------------------------------------------------------

/**
 * Files one object (and its children) uses, from what the engine remembers.
 * `marker` = the creator's explicit link (`userData.studioAsset` in three,
 * `obj.studioAsset` in Pixi): a string or a list of strings, always "sure".
 */
export function assetsFromScene(obj: Any): AssetRef[] {
  const out = new Map<string, AssetRef>();
  const put = (url: string, how: AssetRef['how'], sure: boolean) => {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;
    const key = abs(url);
    const prev = out.get(key);
    if (!prev || (!prev.sure && sure)) out.set(key, { url: key, how, sure });
  };
  const marks = (m: unknown) => {
    for (const u of Array.isArray(m) ? m : [m]) {
      if (typeof u === 'string') {
        const how: AssetRef['how'] = /\.(glb|gltf|fbx|obj)$/i.test(stripQuery(u)) ? 'model' : /\.(mp3|ogg|wav|m4a)$/i.test(stripQuery(u)) ? 'sound' : 'texture';
        put(u, how, true);
      }
    }
  };
  if (isThreeObject(obj)) {
    obj.traverse((o: Any) => marks(o.userData?.studioAsset));
    for (const t of threeTextures(obj)) put(threeTexUrl(t), 'texture', true);
  } else if (isPixiContainer(obj)) {
    const walk = (o: Any) => {
      marks(o.studioAsset);
      for (const c of o.children ?? []) walk(c);
    };
    walk(obj);
    for (const s of pixiSources(obj)) put(pixiSourceUrl(s), 'texture', true);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

interface Swapped {
  restore(): void;
}

const active = new Map<string, Swapped[]>(); // from URL (no query) -> swaps to undo

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
}

function sizeOf(img: Any): [number, number] {
  const w = img?.naturalWidth || img?.videoWidth || img?.width || 0;
  const h = img?.naturalHeight || img?.videoHeight || img?.height || 0;
  return [w, h];
}

/** Draw `img` into a w×h canvas (stretched: same pixel grid as the original). */
function fitted(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Show `toUrl` wherever the game draws `fromUrl`. `toUrl = null` puts the
 * original back. Returns how many textures changed (0 = not found: the
 * shell says "this picture is not on screen right now").
 *
 * `roots` = the engine roots the adapter found (three Scenes, Pixi stages).
 */
export async function previewImage(roots: unknown[], fromUrl: string, toUrl: string | null): Promise<number> {
  const from = stripQuery(abs(fromUrl));
  for (const s of active.get(from) ?? []) s.restore();
  active.delete(from);
  if (!toUrl) return 0;

  const img = await loadImage(abs(toUrl));
  const swaps: Swapped[] = [];
  const seen = new Set<unknown>();
  for (const root of roots as Any[]) {
    if (isThreeObject(root)) {
      for (const t of threeTextures(root)) {
        if (seen.has(t) || stripQuery(abs(threeTexUrl(t))) !== from) continue;
        seen.add(t);
        const old = t.image;
        const [w, h] = sizeOf(old);
        previewedFrom.set(t, threeTexUrl(t));
        t.image = fitted(img, w || img.naturalWidth, h || img.naturalHeight);
        t.needsUpdate = true;
        swaps.push({ restore: () => { t.image = old; t.needsUpdate = true; previewedFrom.delete(t); } });
      }
    } else if (isPixiContainer(root)) {
      for (const s of pixiSources(root)) {
        if (seen.has(s) || stripQuery(abs(pixiSourceUrl(s))) !== from) continue;
        seen.add(s);
        const old = s.resource;
        const [w, h] = sizeOf(old);
        s.resource = fitted(img, w || img.naturalWidth, h || img.naturalHeight);
        s.update();
        swaps.push({ restore: () => { s.resource = old; s.update(); } });
      }
    }
  }
  if (swaps.length) active.set(from, swaps);
  return swaps.length;
}

/** Undo every preview (leaving the library tool, or before a reload). */
export function clearPreviews(): void {
  for (const list of active.values()) for (const s of list) s.restore();
  active.clear();
}
