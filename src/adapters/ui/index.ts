// The built-in DOM UI adapter as the bridge sees it (UI stage 1, 2026-10-19): the port in adapter.js through the
// same 2D base as every 2D game (adapterFromPort2D: picking, finger offset, handles, undo-exact setPose). Kind
// 'dom-ui'; no turning (the port lists every element rotatable: false). Resizing keeps the element's middle where it
// is — done where the element is placed (the loader's placeUi, shared with the game), not here, so the saved offset
// means the same on every window size. (A first version corrected the resize gesture here and saved the correction in
// `p`: reopened in a window of another size, a title centred with translate(-50%, -50%) and grown to 121 % came back
// 7.6 px off — its box had another height there. test/studio-ui-layer.browser.mjs keeps it.)
// The UI seat (CONTRACT.md §1.1): the bridge asks the game's own studio.registerUI() ports first, then this one.
import type { Port2D, StudioAdapter } from '../../contract.ts';
import type { Core } from '../../core/index.ts';
import { adapterFromPort2D } from '../../core/port2d.ts';
import { createUiPort } from './adapter.js';

/** A UI-seat adapter from any Port2D (the built-in DOM one, or a game's registerUI port). */
export function uiAdapterFromPort(port: Port2D, core: Core, win: Window): StudioAdapter {
  return adapterFromPort2D(port, core, win);
}

/**
 * The built-in DOM UI adapter, or null when the page has no usable [data-studio-key] (then the bridge and the editor
 * behave exactly as before UI stage 1). `skip`: keys the world adapter already lists (a DOM board game's pieces).
 */
export function findDomUi(core: Core, win: Window, skip?: () => Set<string>): StudioAdapter | null {
  if (!win.document.querySelector('[data-studio-key]')) return null;
  const port = createUiPort(win, { skip }) as Port2D;
  if (!port.objects().length) return null;
  return uiAdapterFromPort(port, core, win);
}
