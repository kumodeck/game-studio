/**
 * assetsOf(object): which files an object is made of — for the asset library ("this tree uses tree.png").
 *
 * AssetRef = { url, how: 'texture' | 'model' | 'sound', sure }
 *   - `userData.studioAsset` (a string or an array) on the object or a descendant: the author's mark, always sure
 *   - models: the URL three's loader produced this subtree from (boot.js tags Loader results on r186+, sure), or the
 *     download-order guess (boot.js guessModel, r170 and older, NOT sure — the library shows it as "estimated")
 *   - textures: the image a material's map was loaded from (HTMLImageElement.src, or an ImageBitmap traced back to its
 *     fetch). Textures embedded in a .glb have no file of their own; they are covered by the model entry.
 *     Canvas / data textures are generated in code and have no file — skipped.
 *   - sounds: three Audio / PositionalAudio in the subtree whose buffer came from a loader (r186+)
 * URLs on the game's own origin are returned relative to the game's folder ("assets/tree.png"), so they line up
 * with the file list of the folder; anything else stays absolute.
 */

const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap', 'matcap', 'gradientMap', 'clearcoatMap', 'sheenColorMap', 'transmissionMap'];

const EXT_HOW = [
  [/\.(glb|gltf|fbx|obj|stl|ply|3ds|dae|vrm)(\?|#|$)/i, 'model'],
  [/\.(mp3|ogg|wav|m4a|aac|flac|opus)(\?|#|$)/i, 'sound'],
  [/\.(json|atlas)(\?|#|$)/i, 'atlas']
];
function howOf(url) {
  for (const [re, how] of EXT_HOW) if (re.test(url)) return how;
  return 'texture';
}

export function relativeUrl(url, baseUri) {
  try {
    const u = new URL(url, baseUri);
    const dir = new URL('.', baseUri);
    if (u.origin === dir.origin && u.pathname.startsWith(dir.pathname)) return decodeURI(u.pathname.slice(dir.pathname.length)) + u.search;
    return u.href;
  } catch {
    return String(url);
  }
}

function imageUrl(img, boot) {
  if (!img) return null;
  const known = boot.urlOf.get(img);
  if (known) return known;
  if (typeof img.src === 'string' && img.src && !img.src.startsWith('blob:') && !img.src.startsWith('data:')) return img.src;
  return null;
}

export function assetsOf(object, boot, baseUri) {
  const out = new Map(); // url → ref (first wins, a sure ref upgrades a guess)
  const put = (url, how, sure) => {
    // blob: / data: URLs are bytes embedded in another file (a texture inside a .glb) — there is no file to list
    if (!url || /^(blob|data):/i.test(url)) return;
    const rel = relativeUrl(url, baseUri);
    const prev = out.get(rel);
    if (!prev || (!prev.sure && sure)) out.set(rel, { url: rel, how, sure });
  };
  const models = new Set();
  // Ancestors first: the object may be a child of a loaded glTF scene (e.g. one node of a level file).
  for (let p = object; p; p = p.parent) {
    const u = boot.urlOf.get(p);
    if (u) put(u, howOf(u), true), models.add(u);
    else if (boot.guessOf.has(p)) put(boot.guessOf.get(p), 'model', false), models.add(boot.guessOf.get(p));
  }
  object.traverse((o) => {
    const ud = o.userData || {};
    const marks = Array.isArray(ud.studioAsset) ? ud.studioAsset : ud.studioAsset ? [ud.studioAsset] : [];
    for (const m of marks) put(new URL(String(m), baseUri).href, howOf(String(m)), true);
    const own = boot.urlOf.get(o);
    if (own) put(own, howOf(own), true), models.add(own);
    if (o.geometry) {
      const gu = boot.urlOf.get(o.geometry);
      if (gu) put(gu, 'model', true), models.add(gu);
      else if (boot.guessOf.has(o.geometry)) put(boot.guessOf.get(o.geometry), 'model', false), models.add(boot.guessOf.get(o.geometry));
    }
    if (o.isAudio && o.buffer) {
      const su = boot.urlOf.get(o.buffer);
      if (su) put(su, 'sound', true);
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mat of mats) {
      for (const k of MAPS) {
        const tex = mat[k];
        if (!tex || !tex.isTexture) continue;
        const tagged = boot.urlOf.get(tex);
        const img = tex.source ? tex.source.data : tex.image;
        const u = tagged || imageUrl(img, boot);
        // A texture inside a model file (glTF tags them with userData.mimeType) is part of that model.
        if (!u && tex.userData && tex.userData.mimeType && models.size) continue;
        if (u) put(u, 'texture', true);
      }
    }
  });
  return [...out.values()];
}
