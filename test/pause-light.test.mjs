// pause-light (2026-10-28; △16 of pause-edit walk 1): the three.js boot script finds the game's EffectComposer as it is
// built (src/adapters/three/boot.js §5), so a paused moment can be drawn again the way the game draws it (its bloom,
// tone and grade: adapter.js paintMoment). Here, in a context of its own (node:vm: its own Object.prototype, so the
// catch never reaches this test runner's objects):
//   - a composer is caught (its copyPass its own property, as the assignment makes it), nothing else changes for other
//     objects (reading copyPass is undefined, for…in / JSON / Object.keys see nothing new, a frozen object stays as it
//     was — no throw in sloppy code);
//   - which composer drew last (a game render into its buffers), and who drew the screen last at what size
//     (state.screen: a paused moment keeps the canvas only when the game drew it last).
// The picture itself (the composer's render(0), the game's codeMoment draw, the camera given back) is checked in a real
// browser: test/studio-pause.browser.mjs --only light,lightcode.
// Run: node --test test/pause-light.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const BOOT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/adapters/three/boot.js'), 'utf8');

/** A page of its own with the boot script run in it (only what boot.js reads: no fetch, no rAF — both optional there). */
function page() {
  const ctx = vm.createContext({ setTimeout, queueMicrotask, performance, console, EventTarget, CustomEvent, WeakRef, URLSearchParams });
  vm.runInContext(BOOT, ctx);
  // The game's side, as three's code would be: an EffectComposer as examples/jsm builds it (r150–r186), a renderer that
  // three announces to the devtools hook, and a menu composer that never draws.
  vm.runInContext(`
    class EffectComposer {
      constructor(renderer) {
        this.renderer = renderer;
        this.renderTarget1 = { name: 'rt1' };
        this.renderTarget2 = { name: 'rt2' };
        this.writeBuffer = this.renderTarget1;
        this.readBuffer = this.renderTarget2;
        this.renderToScreen = true;
        this.passes = [];
        this.copyPass = { name: 'copy' };
      }
    }
    var renderer = {
      isWebGLRenderer: true, domElement: { width: 800, height: 500 }, target: null, drawn: 0,
      setSize() {}, getRenderTarget() { return this.target; }, setRenderTarget(t) { this.target = t; },
      render() { this.drawn++; },
    };
    __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent('observe', { detail: renderer }));
    var composer = new EffectComposer(renderer);
    var menu = new EffectComposer(renderer);
  `, ctx);
  return ctx;
}

test('the composer is caught as it is built; copyPass stays its own property', () => {
  const ctx = page();
  const r = vm.runInContext(`({ found: __studioThree.composers(), composer, menu,
    own: Object.prototype.hasOwnProperty.call(composer, 'copyPass'), keys: Object.keys(composer), copy: composer.copyPass.name })`, ctx);
  assert.equal(r.found.length, 2);
  assert.equal(r.found[0], r.composer);
  assert.equal(r.found[1], r.menu);
  assert.equal(r.own, true);
  assert.ok(r.keys.includes('copyPass'), 'enumerable, as an assignment makes it');
  assert.equal(r.copy, 'copy');
});

test('every other object is as it was: nothing to read, to list or to send', () => {
  const ctx = page();
  // As JSON: arrays made in the other context have its Array.prototype (deepStrictEqual compares prototypes).
  const r = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const o = { a: 1 };
    const listed = []; for (const k in o) listed.push(k);
    const frozen = Object.freeze({ b: 2 }); frozen.copyPass = 7; // sloppy code: no throw, nothing set
    const later = {}; later.copyPass = 3; // any object given copyPass simply has it
    return { read: o.copyPass, listed, json: JSON.stringify(o), keys: Object.keys(o), frozen: frozen.copyPass, later: later.copyPass,
      laterOwn: Object.keys(later), protoListed: Object.keys(Object.prototype) };
  })())`, ctx));
  assert.equal('read' in r, false, 'undefined (left out of the JSON)');
  assert.deepEqual(r.listed, ['a']);
  assert.equal(r.json, '{"a":1}');
  assert.deepEqual(r.keys, ['a']);
  assert.equal('frozen' in r, false, 'nothing set on a frozen object');
  assert.equal(r.later, 3);
  assert.deepEqual(r.laterOwn, ['copyPass']);
  assert.deepEqual(r.protoListed, []);
});

test('which composer drew last (a game render into its buffers), and who drew the screen at what size', () => {
  const ctx = page();
  const r = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const st = __studioThree;
    const before = { at: st.composerAt.get(composer) || 0, screen: st.screen };
    // The game's frame: its RenderPass draws into the composer's read buffer, the last pass onto the screen.
    renderer.setRenderTarget(composer.readBuffer); renderer.render({}, {});
    renderer.setRenderTarget(null); renderer.render({}, {});
    const game = { at: st.composerAt.get(composer) || 0, menu: st.composerAt.get(menu) || 0, screen: Object.assign({}, st.screen) };
    // The editor's own draw onto the screen (selfRender): the screen is the editor's now.
    st.selfRender++; renderer.render({}, {}); st.selfRender--;
    // A game render while the editor holds it: skipped, it draws nothing (the screen stays the editor's).
    st.held = true; renderer.render({}, {}); st.held = false;
    return { before, game, studio: Object.assign({}, st.screen), drawn: renderer.drawn };
  })())`, ctx));
  assert.deepEqual(r.before, { at: 0, screen: null });
  assert.ok(r.game.at > 0, 'the composer that drew');
  assert.equal(r.game.menu, 0, 'a composer that never drew');
  assert.deepEqual(r.game.screen, { by: 'game', w: 800, h: 500 });
  assert.deepEqual(r.studio, { by: 'studio', w: 800, h: 500 });
  assert.equal(r.drawn, 3, 'the held render was skipped');
});
