// Structural tests for the QR encoder. Scanning itself was checked once by decoding generated codes
// (versions 1, 4, 8, 10) with an independent reader; these tests pin the parts a refactor could break.
// Run: node --test src/server/qr.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQR, qrToTerminal, qrToSvg } from './qr.mjs';

const version = (m) => (m.length - 17) / 4;

test('picks the smallest version that fits (level M, byte mode)', () => {
  assert.equal(version(encodeQR('hi')), 1);
  assert.equal(version(encodeQR('x'.repeat(14))), 1); // 16 data codewords: 2 header bytes + 14
  assert.equal(version(encodeQR('x'.repeat(15))), 2);
  assert.equal(version(encodeQR('http://192.168.1.23:54321/__studio/?t=' + 'A'.repeat(22))), 4);
  assert.equal(version(encodeQR('q'.repeat(213))), 10);
  assert.throws(() => encodeQR('q'.repeat(214)), /too long/);
});

test('finder patterns, timing patterns and the dark module are in place', () => {
  const m = encodeQR('http://127.0.0.1:1/__studio/?t=x');
  const n = m.length;
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let i = 0; i < 7; i++) {
      assert.equal(m[oy][ox + i], true);
      assert.equal(m[oy + 6][ox + i], true);
      assert.equal(m[oy + i][ox], true);
    }
    for (let i = 1; i <= 5; i++) assert.equal(m[oy + 1][ox + i], false); // light ring
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) assert.equal(m[oy + y][ox + x], true); // 3x3 centre
  }
  for (let i = 8; i < n - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0);
    assert.equal(m[i][6], i % 2 === 0);
  }
  assert.equal(m[n - 8][8], true);
});

test('the two copies of the format information agree and carry level M', () => {
  const m = encodeQR('format check');
  const n = m.length;
  const a = [];
  const b = [];
  for (let i = 0; i <= 5; i++) a.push(m[i][8]);
  a.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i++) a.push(m[8][14 - i]);
  for (let i = 0; i < 8; i++) b.push(m[8][n - 1 - i]);
  for (let i = 8; i < 15; i++) b.push(m[n - 15 + i][8]);
  assert.deepEqual(a, b);
  const bits = a.reduce((acc, bit, i) => acc | ((bit ? 1 : 0) << i), 0) ^ 0x5412;
  assert.equal(bits >>> 13, 0); // error correction level bits 00 = M
});

test('terminal and SVG renderings', () => {
  const m = encodeQR('hi');
  const lines = qrToTerminal(m).split('\n');
  assert.equal(lines.length, Math.ceil((m.length + 4) / 2));
  assert.ok(lines.every((l) => l.endsWith('\x1b[0m')));
  assert.match(qrToSvg(m), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 29 29"/);
});
