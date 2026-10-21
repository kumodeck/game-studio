// A tap in the game while the editor is still getting ready (first-click pass, 2026-10-20).
//
// WHY: the game draws (the lighthouse is right there) a moment before the editor can pick anything: the bridge waits
// for the scene's objects, then the editor page answers core/ready with core/edit, and only then does input.ts listen.
// On a slow network or GPU that is a second or more, and the only sign is a small grey line in the list ("Finding
// objects you can move…"), away from the game (a phone's list is closed). A click in that moment went to the game and was gone: nothing got
// selected, and the person clicked again (a try of test demo v16: "I click the lighthouse and it isn't selected").
// Decision (design, this pass): don't throw the click away and don't add a "please wait" sign — remember the last
// tap, and when the editor begins, pick what was under it. The editor reads it right after adapter.begin(), while the
// view is still the picture the person tapped on (three.js and 2D both open on the game's own camera there), before
// a saved view or "everything in frame" moves it (editor.ts setEditing).
//
// Only a plain tap counts: the primary pointer, the left button, no modifier, released within the tap slop. A drag or a
// right-click drops it, and a later tap replaces it (the last one is what the person meant). The listeners sit on the game
// window in the capture phase, never block anything (the game still runs and gets its input until the editor begins),
// and go away once the editor has taken the tap.
import { UI } from '../contract.ts';

export interface EarlyTap {
  x: number;
  y: number;
  /** The pointer type ('mouse' / 'touch' / 'pen'): a finger picks with a wider radius. */
  type: string;
}

export interface EarlyTaps {
  /** The last plain tap since the page started (or null), once: listening stops here. */
  take(): EarlyTap | null;
}

export function watchEarlyTaps(win: Window): EarlyTaps {
  let down: (EarlyTap & { id: number }) | null = null;
  let tap: EarlyTap | null = null;
  const opts = { capture: true };
  const onDown = (e: PointerEvent) => {
    tap = null;
    down = e.isPrimary && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
      ? { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType }
      : null;
  };
  const onMove = (e: PointerEvent) => {
    if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) > UI.tapSlopPx) down = null;
  };
  const onUp = (e: PointerEvent) => {
    if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= UI.tapSlopPx) {
      tap = { x: down.x, y: down.y, type: down.type };
    }
    down = null;
  };
  // A release that does not come as a pointerup here (first-click pass 2, input.ts onLost): the capture let go with no
  // button down (when the game captured the press) counts as the release, at the press point.
  const onLost = (e: PointerEvent) => {
    if (down && e.pointerId === down.id && e.buttons === 0) tap = { x: down.x, y: down.y, type: down.type };
    if (down && e.pointerId === down.id) down = null;
  };
  const onCancel = () => (down = null);
  win.addEventListener('pointerdown', onDown, opts);
  win.addEventListener('pointermove', onMove, opts);
  win.addEventListener('pointerup', onUp, opts);
  win.addEventListener('pointercancel', onCancel, opts);
  win.addEventListener('lostpointercapture', onLost, opts);
  let done = false;
  return {
    take() {
      if (done) return null;
      done = true;
      win.removeEventListener('pointerdown', onDown, opts);
      win.removeEventListener('pointermove', onMove, opts);
      win.removeEventListener('pointerup', onUp, opts);
      win.removeEventListener('pointercancel', onCancel, opts);
      win.removeEventListener('lostpointercapture', onLost, opts);
      return tap;
    },
  };
}
