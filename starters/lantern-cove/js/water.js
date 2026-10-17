// Lantern Cove — the sea.
//
// What makes it read as water (in order of how much each matters):
//   1. a real planar reflection (the scene drawn again from a mirrored camera, half resolution), wobbled by the
//      wave normals — the lighthouse, the boats and the sky all appear upside down in it and shimmer;
//   2. Fresnel: looking down you see INTO the water (the sandy floor, tinted by depth), looking far you see a mirror;
//   3. depth colour: the floor fades with depth (the terrain shader darkens it), the water adds a teal body colour,
//      so the bay is turquoise at the beach and deep in the middle — from one depth texture, no guessing;
//   4. a sun glitter path (HDR specular on small ripples → bloom) and soft foam where the water meets the shore;
//   5. the far sea takes the colour of the sky right above the horizon in that direction (see sky.js).
//
// Waves: 4 long swells (moving the vertices; the JS physics uses the very same sum, so floating things ride the
// waves you see) + 6 short ripples (normals only). Swells calm down in shallow water (depth texture).
import * as THREE from 'three';
import { SKY_GLSL } from './sky.js';

// [dirX, dirZ, wavelength m, amplitude m]. Dusk in a sheltered bay: low, long, lazy.
const SWELLS = [
  [0.8, 0.6, 13, 0.11],
  [-0.45, 0.89, 8, 0.06],
  [0.96, -0.28, 21, 0.13],
  [0.25, 0.97, 5.2, 0.035],
];
const RIPPLES = [
  [0.7, 0.71, 2.3, 0.022], [-0.9, 0.42, 1.6, 0.014], [0.1, -0.99, 1.15, 0.01],
  [-0.4, -0.92, 0.8, 0.0065], [0.98, 0.2, 0.55, 0.0045], [-0.75, 0.66, 0.37, 0.003],
];
const G = 9.81;
const prep = (w) => w.map(([dx, dz, len, amp]) => {
  const l = Math.hypot(dx, dz), k = (2 * Math.PI) / len;
  return { dx: dx / l, dz: dz / l, k, amp, w: Math.sqrt(G * k) }; // deep-water dispersion: long waves travel faster
});
const SW = prep(SWELLS), RP = prep(RIPPLES);

/** Water surface height at (x, z) and time t, before the shallow-water calming (`calm` 0..1 is applied by the caller). */
export function swell(x, z, t) {
  let h = 0;
  for (const s of SW) h += s.amp * Math.sin(s.k * (s.dx * x + s.dz * z) - s.w * t);
  return h;
}
/** How much of the swell survives at a given floor depth (0 on the beach, 1 from 2.5 m down). Same as the shader. */
export const calm = (depth) => { const t = Math.min(1, Math.max(0, depth / 2.5)); return t * t * (3 - 2 * t); };

const f = (v) => v.toFixed(5);
const waveSum = (list, name) => `
vec3 ${name}(vec2 p, float t) { // returns (height, d/dx, d/dz)
  vec3 r = vec3(0.0); float ph;
  ${list.map((s) => `ph = ${f(s.k)} * dot(vec2(${f(s.dx)}, ${f(s.dz)}), p) - ${f(s.w)} * t;
  r += vec3(${f(s.amp)} * sin(ph), ${f(s.amp * s.k)} * cos(ph) * vec2(${f(s.dx)}, ${f(s.dz)}));`).join('\n  ')}
  return r;
}`;

/**
 * @param depthField  from terrain.makeDepthField()
 * @returns { mesh, uniforms }
 */
export function makeWater(renderer, depthField, { sunDir, sunColor }) {
  // Grid denser near the middle of the cove and coarse toward the horizon (|u|² spacing): 1.6 km wide in ~200² cells.
  const n = 200, R = 800;
  const verts = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = (i / n) * 2 - 1, v = (j / n) * 2 - 1;
    verts.push(Math.sign(u) * u * u * R, 0, Math.sign(v) * v * v * R);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.5);

  const reflTarget = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 0 });
  const textureMatrix = new THREE.Matrix4();
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    tRefl: { value: null },
    tDepth: { value: null },
    uDepthBox: { value: new THREE.Vector3() },
    textureMatrix: { value: null },
    uSunDir: { value: null },
    uSunColor: { value: null },
  }]);
  uniforms.tRefl.value = reflTarget.texture;
  uniforms.tDepth.value = depthField.tex;
  uniforms.uDepthBox.value.copy(depthField.box);
  uniforms.textureMatrix.value = textureMatrix;
  uniforms.uSunDir.value = sunDir;
  uniforms.uSunColor.value = sunColor;

  const common = /* glsl */ `
    uniform float uTime; uniform sampler2D tDepth; uniform vec3 uDepthBox;
    float floorAt(vec2 p) {
      vec2 uv = (p - uDepthBox.xy) / uDepthBox.z;
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return -12.0;
      return texture2D(tDepth, uv).r;
    }
    ${waveSum(SW, 'swells')}
    ${waveSum(RP, 'ripples')}`;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: true,
    // Premultiplied "over": the shader outputs what the water ADDS and how much of the floor it HIDES.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vRefl; varying vec3 vWorld; varying float vFloor;
      ${common}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float fl = floorAt(wp.xz);
        float calm = smoothstep(0.0, 2.5, -fl);
        wp.y += swells(wp.xz, uTime).x * calm;
        vWorld = wp.xyz; vFloor = fl;
        vRefl = textureMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tRefl; uniform vec3 uSunColor; uniform float fogDensity;
      varying vec4 vRefl; varying vec3 vWorld; varying float vFloor;
      ${common}
      ${SKY_GLSL}
      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float fl = floorAt(vWorld.xz);
        float depth = max(vWorld.y - fl, 0.0);
        float calm = smoothstep(0.0, 2.5, -fl);
        // Normal: swells (scaled like the vertices) + ripples that fade with distance (they would only shimmer).
        vec3 g = swells(vWorld.xz, uTime) * calm;
        vec3 r = ripples(vWorld.xz, uTime) * (0.35 + 0.65 * calm) / (1.0 + dist * 0.012);
        vec2 slope = g.yz + r.yz;
        vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
        float NdV = max(dot(N, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        // Reflection, offset by the ripples (less in the distance so the far mirror stays calm).
        vec2 off = N.xz * (0.9 / (1.0 + dist * 0.03));
        vec3 refl = texture2DProj(tRefl, vec4(vRefl.xy + off * vRefl.w * 0.12, vRefl.zw)).rgb;
        // Body colour: what light scattered inside the water sends back (teal, lit by the dusk sky).
        vec3 body = vec3(0.012, 0.055, 0.07) + vec3(0.05, 0.11, 0.1) * exp(-depth * 0.35);
        float T = exp(-depth * 0.28); // how much of the floor shows through (by depth)
        vec3 col = F * refl + (1.0 - F) * (1.0 - T) * body;
        float alpha = 1.0 - (1.0 - F) * T;
        // Sun glitter: tight HDR specular on the rippled normal. Clamped so no single pixel can blow the bloom up.
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 1400.0) * 32.0 + pow(max(dot(N, H), 0.0), 160.0) * 0.35;
        col += uSunColor * min(spec, 40.0) * smoothstep(-0.05, 0.1, uSunDir.y);
        // Shore foam: thin moving bands where the floor comes up to the surface, broken by a ripple pattern.
        float shore = 1.0 - smoothstep(0.0, 0.55, depth);
        float bands = 0.5 + 0.5 * sin(depth * 18.0 - uTime * 1.6 + r.x * 60.0);
        float broken = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(vWorld.x * 0.9 + sin(vWorld.z * 0.7) * 2.0 + uTime * 0.3));
        float foam = shore * smoothstep(0.45, 0.95, bands * shore + 0.2 * shore) * (0.35 + 0.65 * broken);
        col = mix(col, vec3(0.85, 0.78, 0.76) * 0.6, foam * 0.55);
        alpha = max(alpha, foam * 0.6);
        // Air: far water takes the sky colour just above the horizon in that direction.
        vec3 air = skyColor(normalize(vec3(-V.x, 0.015, -V.z)));
        float fogF = 1.0 - exp(-pow(fogDensity * dist * 0.8, 2.0));
        col = mix(col, air, fogF); // premultiplied: (col, alpha) → (air, 1)
        alpha = mix(alpha, 1.0, fogF);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sea';
  mesh.userData.studio = false; // the sea is the stage, not a prop
  mesh.renderOrder = 1; // after the opaque world (it is see-through)

  // ---- planar reflection (same maths as three's Reflector, for a horizontal mirror at y = 0) -----------------
  // WHY our own instead of Reflector: the editor wraps renderer.render to learn the game's camera; the mirror pass
  // must use the unwrapped render, or the editor would think the game looks through the upside-down mirror camera.
  const mirrorCam = new THREE.PerspectiveCamera();
  const camPos = new THREE.Vector3(), look = new THREE.Vector3(), target = new THREE.Vector3(), rot = new THREE.Matrix4();
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const N = new THREE.Vector3(0, 1, 0);
  const size = new THREE.Vector2();
  let busy = false;
  mesh.onBeforeRender = (r, scene, camera) => {
    if (busy || !camera.isPerspectiveCamera) return;
    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= 0.01) return; // under water: nothing sensible to mirror
    // Half the drawing-buffer size is plenty: the reflection is wobbled by ripples anyway.
    r.getDrawingBufferSize(size);
    const w = Math.max(64, Math.round(size.x * 0.5)), h = Math.max(64, Math.round(size.y * 0.5));
    if (reflTarget.width !== w || reflTarget.height !== h) reflTarget.setSize(w, h);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    mirrorCam.position.set(camPos.x, -camPos.y, camPos.z);
    target.set(look.x, -look.y, look.z);
    mirrorCam.up.set(0, 1, 0).applyMatrix4(rot).reflect(N);
    mirrorCam.lookAt(target);
    mirrorCam.far = camera.far;
    mirrorCam.updateMatrixWorld();
    mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse).multiply(mesh.matrixWorld);
    // Oblique near plane = the water plane (a little below, so things standing in the water keep their feet).
    plane.setFromNormalAndCoplanarPoint(N, target.set(0, -0.05, 0)).applyMatrix4(mirrorCam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const P = mirrorCam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + P[8]) / P[0];
    q.y = (Math.sign(clip.y) + P[9]) / P[5];
    q.z = -1;
    q.w = (1 + P[10]) / P[14];
    clip.multiplyScalar(2 / clip.dot(q));
    P[2] = clip.x; P[6] = clip.y; P[10] = clip.z + 1; P[14] = clip.w;

    busy = true;
    mesh.visible = false;
    const prevTarget = r.getRenderTarget(), prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false; // the shadows of this frame are already drawn
    r.setRenderTarget(reflTarget);
    r.state.buffers.depth.setMask(true);
    if (r.autoClear === false) r.clear();
    (r.__studioRender || r.render).call(r, scene, mirrorCam);
    r.shadowMap.autoUpdate = prevShadow;
    r.setRenderTarget(prevTarget);
    if (camera.viewport !== undefined) r.state.viewport(camera.viewport);
    mesh.visible = true;
    busy = false;
  };
  return { mesh, uniforms };
}
