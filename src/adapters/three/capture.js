/**
 * capture(object, size): a square picture of ONE object for the editor's list.
 *
 * Draws with the game's renderer into the corner of the game canvas, copies that corner into a 2D canvas in the
 * same task (WebGL keeps the drawing buffer until the browser composites, so preserveDrawingBuffer is not needed),
 * then lets the editor repaint its view.
 *
 * While drawing:
 *   - scene.onBeforeRender / onAfterRender are emptied. Games use these hooks for camera tricks, e.g. "hide small
 *     things right in front of the camera so they do not block the view" — with a close-up thumbnail camera that
 *     hides exactly the object being photographed (a real bug we hit: the smaller the object, the surer it vanished).
 *   - everything that is not the object (or one of its ancestors) is hidden, except lights, so the picture shows the
 *     object alone in the game's own lighting.
 *   - fog is off (a far object would be a grey square).
 * The camera frames the object's world box from the editor's current viewing direction, slightly from above.
 *
 * Light effects are left out (Ive review 3 ⑧, 2026-10-20): a lighthouse's beams (additive cards reaching far past the
 * tower) made its box several times the tower, so the tower came out a small blurred stroke in the middle of its
 * Library tile. Parts drawn only as light — additive blending, or see-through below 30 % — are hidden while the
 * picture is drawn and are not in the frame. An object that is ONLY light (a glow on its own) keeps them all.
 * (bridge/snap.ts / surface.js has its own, wider rule for what can be stood on; a pane of glass is not light.)
 *
 * See-through background (visual pass 2026-10-16, Ive-view review item 5): the picture used to carry the game's sky
 * (a pale blue square behind every 3D object), so the dark list read as a column of blue tiles and 3D looked
 * different from 2D (whose pictures are see-through, on the shell's checkerboard). The object is now drawn twice,
 * once on black and once on white (scene.background off, the clear colour set), and the alpha of each pixel is
 * worked out from the difference (a pixel of the object is the same on both; empty space is 0 on one and 255 on the
 * other; soft edges fall in between). This works whatever the game's canvas was created with (alpha: false is
 * the three.js default, so "just clear to transparent" would give black).
 */

import { worldBox } from './pick.js';

const DEG = Math.PI / 180;
const ADDITIVE = 2; // THREE.AdditiveBlending

/** Drawn only as light (see the header): every material of the mesh is additive or nearly clear. */
function lightOnly(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.length > 0 && mats.every((m) => !!m && (m.blending === ADDITIVE || (m.transparent && typeof m.opacity === 'number' && m.opacity < 0.3)));
}

export function captureObject({ renderer, scene, render, boot, baseCamera, yaw }, object, size = 128) {
  const canvas = renderer.domElement;
  const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
  const px = Math.max(16, Math.min(size, canvas.width, canvas.height));
  scene.updateMatrixWorld(true);
  const glow = [];
  const walk = (o) => {
    if (!o.visible) return;
    if ((o.isMesh || o.isSkinnedMesh) && o.material && lightOnly(o)) glow.push(o);
    for (const c of o.children) walk(c);
  };
  walk(object);
  for (const g of glow) g.visible = false;
  let box = worldBox(object);
  if (!box) {
    // Only light: draw it as it is.
    for (const g of glow) g.visible = true;
    glow.length = 0;
    box = worldBox(object);
  }
  if (!box) return { ok: false };

  const hidden = [];
  for (let node = object; node && node !== scene && node.parent; node = node.parent) {
    for (const sib of node.parent.children) {
      if (sib === node || sib.isLight || !sib.visible) continue;
      hidden.push(sib);
      sib.visible = false;
    }
  }
  // A stand-in for THREE.Color (this file has no three import): getClearColor() copies into it, setClearColor()
  // copies from it (Color.set takes anything with isColor).
  const clear = { isColor: true, r: 0, g: 0, b: 0, copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; } };
  if (renderer.getClearColor) renderer.getClearColor(clear);
  const saved = { before: scene.onBeforeRender, after: scene.onAfterRender, fog: scene.fog, autoClear: renderer.autoClear, target: renderer.getRenderTarget ? renderer.getRenderTarget() : null,
    background: scene.background, clearAlpha: renderer.getClearAlpha ? renderer.getClearAlpha() : 1 };
  scene.onBeforeRender = () => {};
  scene.onAfterRender = () => {};
  scene.fog = null;

  const cam = baseCamera.clone(false);
  const center = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const radius = Math.max(0.05, Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2);
  const pitch = 22 * DEG;
  let dist = radius * 2.2;
  if (cam.isPerspectiveCamera) {
    cam.fov = 35;
    cam.aspect = 1;
    dist = (radius / Math.sin((35 * DEG) / 2)) * 1.08;
  } else if (cam.isOrthographicCamera) {
    cam.left = cam.bottom = -radius * 1.1;
    cam.right = cam.top = radius * 1.1;
    cam.zoom = 1;
  }
  cam.near = Math.max(0.001, dist - radius * 2);
  cam.far = dist + radius * 2;
  const cp = Math.cos(pitch);
  cam.position.set(center[0] + dist * cp * Math.sin(yaw), center[1] + dist * Math.sin(pitch), center[2] + dist * cp * Math.cos(yaw));
  cam.up.set(0, 1, 0);
  cam.lookAt(center[0], center[1], center[2]);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  let dataUrl = null;
  boot.selfRender++;
  try {
    if (renderer.setRenderTarget) renderer.setRenderTarget(null);
    renderer.autoClear = true;
    const css = px / pr;
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, css, css);
    renderer.setViewport(0, 0, css, css);
    // One picture of the corner on a plain background (0 = black, 1 = white).
    const shoot = (white) => {
      if (renderer.setClearColor) {
        scene.background = null;
        renderer.setClearColor(white ? 0xffffff : 0x000000, 1);
      }
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
      render.call(renderer, scene, cam);
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const g = c.getContext('2d', { willReadFrequently: true });
      // three's viewport origin is bottom-left; canvas rows start at the top
      g.drawImage(canvas, 0, canvas.height - px, px, px, 0, 0, px, px);
      return { c, g };
    };
    const onBlack = shoot(false);
    if (renderer.setClearColor) {
      const onWhite = shoot(true);
      const b = onBlack.g.getImageData(0, 0, px, px);
      const w = onWhite.g.getImageData(0, 0, px, px).data;
      const d = b.data;
      for (let i = 0; i < d.length; i += 4) {
        // white − black is 255 where nothing was drawn, 0 where the object fully covers the pixel.
        const gap = (w[i] - d[i] + w[i + 1] - d[i + 1] + w[i + 2] - d[i + 2]) / 3;
        const a = Math.max(0, Math.min(255, 255 - gap));
        if (a > 0) {
          // On black the colour is premultiplied by alpha: divide it back out.
          const k = 255 / a;
          d[i] = Math.min(255, d[i] * k);
          d[i + 1] = Math.min(255, d[i + 1] * k);
          d[i + 2] = Math.min(255, d[i + 2] * k);
        }
        d[i + 3] = a;
      }
      onBlack.g.putImageData(b, 0, 0);
    }
    dataUrl = onBlack.c.toDataURL('image/png');
  } finally {
    boot.selfRender--;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width / pr, canvas.height / pr);
    if (renderer.setRenderTarget) renderer.setRenderTarget(saved.target);
    renderer.autoClear = saved.autoClear;
    scene.onBeforeRender = saved.before;
    scene.onAfterRender = saved.after;
    scene.fog = saved.fog;
    scene.background = saved.background;
    if (renderer.setClearColor) renderer.setClearColor(clear, saved.clearAlpha);
    for (const h of hidden) h.visible = true;
    for (const g of glow) g.visible = true;
  }
  return { ok: !!dataUrl, dataUrl: dataUrl || undefined };
}
