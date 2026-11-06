// The strip's Turn button dragged (src/bridge/turn-drag.ts; decided 2026-11-06 after a first-run walk of v0.1.82: a
// straight pull of 3D's Turn button stayed at "Turn 0°").
import test from 'node:test';
import assert from 'node:assert/strict';
import { TURN_SNAP, turnPick, turnStep, type TurnDrag } from '../src/bridge/turn-drag.ts';

const deg = (r: number) => (r * 180) / Math.PI;

test('small steps add up past the snap: 80 px in 16 steps of ~1.8° turns the object, not 0°', () => {
  const s: TurnDrag = { total: 0, applied: 0 };
  let r = 0; // the object's own angle (sign +1: it follows the screen turn)
  for (let i = 0; i < 16; i++) r += turnStep(s, -0.032, { snap: true, r0: 0, sign: 1 });
  assert.ok(deg(r) < -25, `turned ${deg(r).toFixed(1)}°`);
});

test('the old per-step snap would have held it: each step alone stays within ±3° of 0°', () => {
  // The same steps measured one at a time against the object's angle (the v0.1.82 way): always put back.
  let r = 0;
  for (let i = 0; i < 16; i++) {
    r += -0.032;
    const t = Math.round(r / TURN_SNAP) * TURN_SNAP;
    if (Math.abs(t - r) <= (3 * Math.PI) / 180) r = t;
  }
  assert.equal(Math.abs(deg(r)) < 1e-9, true);
});

test('the total still lands on 15° steps within ±3°, and Shift (snap off) does not', () => {
  const s: TurnDrag = { total: 0, applied: 0 };
  let r = 0;
  const want = (16 * Math.PI) / 180; // 16°: lands on 15°
  for (let i = 0; i < 8; i++) r += turnStep(s, want / 8, { snap: true, r0: 0, sign: 1 });
  assert.ok(Math.abs(deg(r) - 15) < 1e-6, `snapped to ${deg(r)}`);
  const f: TurnDrag = { total: 0, applied: 0 };
  let q = 0;
  for (let i = 0; i < 8; i++) q += turnStep(f, want / 8, { snap: false, r0: 0, sign: 1 });
  assert.ok(Math.abs(deg(q) - 16) < 1e-6);
});

test('the snap is on the object angle: a start at 10° with sign −1 lands on 0° / 15° of the object', () => {
  const s: TurnDrag = { total: 0, applied: 0 };
  const r0 = (10 * Math.PI) / 180;
  let screen = 0;
  for (let i = 0; i < 4; i++) screen += turnStep(s, (-4 / 4) * (Math.PI / 180), { snap: true, r0, sign: -1 }); // object +4° → 14° → 15°
  const obj = r0 - screen;
  assert.ok(Math.abs(deg(obj) - 15) < 1e-6, `object at ${deg(obj)}`);
});

test('3D: a straight pull turns; an arc still wins where it turns more; 2D reads the arc only', () => {
  // Under the middle, a pull to the right turns the negative way (as an arc there does).
  assert.ok(turnPick(0.001, 5, 0.01, true) < -0.04);
  assert.ok(turnPick(0.001, 5, 0.01, false) > 0.04);
  assert.equal(turnPick(-0.2, 5, 0.01, true), -0.2);
  assert.equal(turnPick(0.001, 5, 0, true), 0.001);
});
