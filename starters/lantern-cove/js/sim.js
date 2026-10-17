// Lantern Cove — what moves: floating things on the waves, the sailboat you steer, its wake, the wind.
//
// Rules that keep the editor honest:
//   - the editable group (studioKey) is only moved here for things the PLAYER causes (sailing, bumping into a
//     barrel). Bobbing, pitching and rolling go on its child `bob`, so a frozen frame never leaks into placement.json.
//   - every frame starts from where the group IS (not from a private copy), so whatever the user placed in the
//     editor is where the physics continues from.
//   - something the user lifted out of the water (y > 0.6) stops floating and simply stays where it was put.
import * as THREE from 'three';
import { swell, calm } from './water.js';

const tmp = new THREE.Vector3();

export function makeSim({ scene, props, floorAt }) {
  const floaters = props.all.filter((p) => p.userData.float);
  const state = new Map(); // group → { vx, vz, heave, heaveV, pitch, roll }
  for (const f of floaters) state.set(f, { vx: 0, vz: 0, heave: 0, heaveV: 0, pitch: 0, roll: 0, bob: f.getObjectByName('bob') });
  const sways = props.all.filter((p) => p.userData.sway).map((p) => ({ p, node: p.getObjectByName('sway') }));
  const beam = props.lighthouse.getObjectByName('beam'), blink = props.buoy.getObjectByName('blink'), sail = props.boat.getObjectByName('sail');

  /** Water height the player sees at (x, z): swells, calmed over shallow floors (same as the water shader). */
  const waterAt = (x, z, t) => swell(x, z, t) * calm(-floorAt(x, z));

  // ---- wake: a few flat rings left behind the moving boat --------------------------------------------------
  const wake = new THREE.Group();
  wake.name = 'wake';
  wake.userData.studio = false;
  scene.add(wake);
  const ringGeo = new THREE.RingGeometry(0.75, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 28; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff2e2, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    m.renderOrder = 2;
    wake.add(m);
    rings.push({ m, age: 9 });
  }
  let ringNext = 0, ringClock = 0;
  const puff = (x, z, size) => {
    const r = rings[ringNext++ % rings.length];
    r.age = 0;
    r.size = size;
    r.m.position.set(x, 0.04, z);
    r.m.visible = true;
  };

  // ---- the player's sailboat ---------------------------------------------------------------------------------
  const boat = props.boat;
  const ctl = { thrust: 0, turn: 0, target: null }; // set by input (main.js)
  let heading = boat.rotation.y; // read back every frame (the editor may have turned it)
  let speed = 0;

  // Solid obstacles the boat and floaters slide around: read from the props each frame, so moved rocks still block.
  const solids = () => {
    const out = [];
    for (const p of props.all) {
      const key = p.userData.studioKey;
      if (!p.parent) continue;
      const s = p.scale.x;
      if (key === 'sea-stack') out.push([p.position.x, p.position.z, 3.0 * s]);
      else if (key === 'sea-stack-small') out.push([p.position.x, p.position.z, 2.2 * s]);
      else if (key === 'sea-arch') {
        // The arch stands on two legs, 7 m either side of its middle along its own x axis.
        const c = Math.cos(p.rotation.y), sn = Math.sin(p.rotation.y);
        out.push([p.position.x + 7 * s * c, p.position.z - 7 * s * sn, 2.6 * s], [p.position.x - 7 * s * c, p.position.z + 7 * s * sn, 2.6 * s]);
      }
    }
    return out;
  };

  function step(dt, t) {
    // Wind on the pines (crown only), the lighthouse beam, the buoy light.
    for (const { p, node } of sways) {
      const sw = p.userData.sway;
      node.rotation.z = sw.lean + Math.sin(t * 1.1 + sw.phase) * 0.018 + Math.sin(t * 2.7 + sw.phase * 2) * 0.006;
    }
    if (beam) beam.rotation.y = t * 0.45;
    if (blink) blink.visible = t % 3 < 0.5;

    // Sail the boat (only while it sits in the water).
    const afloat = boat.parent && Math.abs(boat.position.y) < 0.6;
    if (afloat) {
      heading = boat.rotation.y;
      let thrust = ctl.thrust, turn = ctl.turn;
      if (ctl.target) {
        // Tap/drag-to-sail: steer toward the point, slow down when close.
        const dx = ctl.target.x - boat.position.x, dz = ctl.target.z - boat.position.z;
        const want = Math.atan2(dx, dz);
        let d = want - heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        turn = Math.max(-1, Math.min(1, d * 2));
        thrust = Math.min(1, Math.hypot(dx, dz) / 6) * (Math.abs(d) < 1.6 ? 1 : 0.25);
      }
      speed += (thrust * 5.5 - speed * 0.9) * dt; // top speed ≈ 6 m/s, coasts to a stop in a few seconds
      heading += turn * dt * (0.35 + Math.min(1, Math.abs(speed) / 3)) * 0.9;
      boat.rotation.y = heading;
      const st = state.get(boat);
      st.vx = Math.sin(heading) * speed;
      st.vz = Math.cos(heading) * speed;
      // Heel into the turn a little; the sail flexes with speed.
      if (sail) sail.rotation.y = -turn * 0.15 + Math.sin(t * 1.7) * 0.02;
      // Wake rings from the stern.
      ringClock += dt * Math.min(1, Math.abs(speed) / 2);
      if (ringClock > 0.16) {
        ringClock = 0;
        puff(boat.position.x - Math.sin(heading) * 2.6, boat.position.z - Math.cos(heading) * 2.6, 0.7);
      }
    }
    for (const r of rings) {
      if (!r.m.visible) continue;
      r.age += dt;
      const k = r.age / 2.8;
      if (k >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar(r.size + k * 3.2);
      r.m.material.opacity = 0.32 * (1 - k) * (1 - k);
    }

    // Floaters: drift + bump, then ride the waves.
    const obst = solids();
    for (const f of floaters) {
      if (!f.parent) continue; // deleted in the editor
      const s = state.get(f), spec = f.userData.float, bob = s.bob;
      if (Math.abs(f.position.y) > 0.6) { bob.position.y = 0; bob.rotation.set(0, 0, 0); continue; }
      const R = spec.radius * f.scale.x;
      if (f !== boat) { s.vx *= Math.exp(-0.6 * dt); s.vz *= Math.exp(-0.6 * dt); }
      f.position.x += s.vx * dt;
      f.position.z += s.vz * dt;
      // Keep out of the shallows: push back down-slope where the floor comes within the draft.
      const fl = floorAt(f.position.x, f.position.z);
      if (fl > -spec.keel - 0.3) {
        const e = 0.6;
        const gx = floorAt(f.position.x + e, f.position.z) - floorAt(f.position.x - e, f.position.z);
        const gz = floorAt(f.position.x, f.position.z + e) - floorAt(f.position.x, f.position.z - e);
        const gl = Math.hypot(gx, gz) || 1;
        f.position.x -= (gx / gl) * 0.08;
        f.position.z -= (gz / gl) * 0.08;
        s.vx *= 0.5; s.vz *= 0.5;
        if (f === boat) speed *= 0.6;
      }
      for (const [ox, oz, or] of obst) {
        const dx = f.position.x - ox, dz = f.position.z - oz, d = Math.hypot(dx, dz), min = or + R * 0.6;
        if (d < min && d > 1e-4) {
          f.position.x += (dx / d) * (min - d);
          f.position.z += (dz / d) * (min - d);
          if (f === boat) speed *= 0.5;
        }
      }
      // Ride the waves: heave toward the surface (spring + damping), tilt with the local slope.
      const ry = f.rotation.y, fx = Math.sin(ry), fz = Math.cos(ry), L = spec.len * 0.45 * f.scale.x, W = spec.wid * 0.45 * f.scale.x;
      const x = f.position.x, z = f.position.z;
      const hc = waterAt(x, z, t);
      const hf = waterAt(x + fx * L, z + fz * L, t), ha = waterAt(x - fx * L, z - fz * L, t);
      const hr = waterAt(x + fz * W, z - fx * W, t), hl = waterAt(x - fz * W, z + fx * W, t);
      const target = (hc * 2 + hf + ha + hr + hl) / 6;
      s.heaveV += ((target - s.heave) * 30 - s.heaveV * 6) * dt;
      s.heave += s.heaveV * dt;
      const heel = f === boat ? -ctl.turn * Math.min(1, Math.abs(speed) / 4) * 0.12 : 0;
      s.pitch += (-Math.atan2(hf - ha, 2 * L) - s.pitch) * Math.min(1, dt * 4 / spec.mass);
      s.roll += (Math.atan2(hr - hl, 2 * W) + heel - s.roll) * Math.min(1, dt * 4 / spec.mass);
      bob.position.y = s.heave - spec.draft;
      bob.rotation.set(s.pitch, 0, s.roll);
    }
    // Bumps between floaters (circles, pushed apart, momentum shared by mass).
    for (let i = 0; i < floaters.length; i++) for (let j = i + 1; j < floaters.length; j++) {
      const a = floaters[i], b = floaters[j];
      if (!a.parent || !b.parent || Math.abs(a.position.y) > 0.6 || Math.abs(b.position.y) > 0.6) continue;
      const ra = a.userData.float.radius * a.scale.x, rb = b.userData.float.radius * b.scale.x;
      const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z, d = Math.hypot(dx, dz), min = (ra + rb) * 0.7;
      if (d >= min || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, ma = a.userData.float.mass, mb = b.userData.float.mass;
      const push = min - d;
      a.position.x -= nx * push * (mb / (ma + mb)); a.position.z -= nz * push * (mb / (ma + mb));
      b.position.x += nx * push * (ma / (ma + mb)); b.position.z += nz * push * (ma / (ma + mb));
      const sa = state.get(a), sb = state.get(b);
      const rel = (sb.vx - sa.vx) * nx + (sb.vz - sa.vz) * nz;
      if (rel < 0) {
        const jimp = (-1.6 * rel) / (1 / ma + 1 / mb);
        sa.vx -= (jimp / ma) * nx; sa.vz -= (jimp / ma) * nz;
        sb.vx += (jimp / mb) * nx; sb.vz += (jimp / mb) * nz;
        if (a === boat || b === boat) speed *= 0.85;
        const other = a === boat ? b : a;
        puff(other.position.x, other.position.z, 0.5);
      }
    }
  }

  return { step, ctl, boat, speed: () => speed, waterAt, boatPos: () => boat.getWorldPosition(tmp) };
}
