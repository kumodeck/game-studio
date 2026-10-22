// Line icons for the shell, drawn here (no icon font, no images from a
// third party). One grid for all of them: 20×20 view box, 1.5 px stroke, round
// ends, `currentColor`, so every icon takes the button's text colour and
// weight and they read as one family next to the system font.
//
// WHY drawn icons instead of the Unicode signs used before (↶ ↷ ⚙ ⋯ ⧉): the
// signs came from whatever font the system picked, at different sizes and
// weights per OS, and sat off the text baseline. A tool that should disappear
// behind the game cannot have its few marks look accidental (design pass
// 2026-10-16, "apple").
//
// Visual pass 2026-10-16 ("visual"): the first set mixed stroke weights
// (1.6 lines, 2.6 dots, 1.0 on the filled ones), square and round corners,
// and marks of different optical size, so a row of them looked drawn by
// three hands. One rule now, the way a Mac pro app's symbol set is built:
//   - 20×20 grid, artwork inside a 14 px live area (3..17), centred;
//   - every line is 1.5 px ON SCREEN (vector-effect: non-scaling-stroke, the
//     width comes from CSS --studio-icon-stroke), whatever size the icon is
//     drawn at, so an 18 px toolbar icon and a 14 px chevron weigh the same
//     as the regular weight of the system font beside them;
//   - round caps and joins; boxes have 1.5 corners, never sharp;
//   - dots are real filled circles (r 1.3), not zero-length strokes (those
//     changed size with the stroke and looked blotchy at 2.6);
//   - filled shapes (play, stop, spark) are filled AND stroked, so their
//     corners round off the same way the lines do.
const NS = 'http://www.w3.org/2000/svg';

/**
 * Artwork per icon, parts joined with "|". A part is SVG path data, or
 * "o cx cy" for a dot (filled circle, r 1.3), or "O cx cy r" for a ring.
 */
const PATHS: Record<string, string> = {
  undo: 'M7 4.5 3.5 8 7 11.5|M3.5 8h8.25a4.25 4.25 0 0 1 0 8.5H9',
  redo: 'M13 4.5 16.5 8 13 11.5|M16.5 8H8.25a4.25 4.25 0 0 0 0 8.5H11',
  // Four rounded corners: "show the whole scene".
  frame: 'M3.5 7.5V5A1.5 1.5 0 0 1 5 3.5h2.5|M12.5 3.5H15A1.5 1.5 0 0 1 16.5 5v2.5|M16.5 12.5V15a1.5 1.5 0 0 1-1.5 1.5h-2.5|M7.5 16.5H5A1.5 1.5 0 0 1 3.5 15v-2.5',
  // The same four corners around a dot: "the picture the game opens on" (back to the opening view, speed pass).
  opening: 'M3.5 7.5V5A1.5 1.5 0 0 1 5 3.5h2.5|M12.5 3.5H15A1.5 1.5 0 0 1 16.5 5v2.5|M16.5 12.5V15a1.5 1.5 0 0 1-1.5 1.5h-2.5|M7.5 16.5H5A1.5 1.5 0 0 1 3.5 15v-2.5|o 10 10',
  // A window with an arrow out of its top-right corner: "open this in a large window" (the side window's Open large).
  openLarge: 'M11.5 3.5h5v5|M16.5 3.5 10 10|M14.5 11.5V15a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5h3.5',
  // Two sliders with their knobs: "how the editor looks".
  look: 'M3.5 6.5h5|M12.5 6.5h4|O 10.5 6.5 2|M3.5 13.5h2|M9.5 13.5h7|O 7.5 13.5 2',
  play: 'M6.5 5.1v9.8a.9.9 0 0 0 1.37.77l8-4.9a.9.9 0 0 0 0-1.54l-8-4.9a.9.9 0 0 0-1.37.77z',
  stop: 'M6.5 5.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  // Pause while playing (2026-10-22): two bars, filled like play / stop.
  pause: 'M6.25 5h2a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1-.75-.75v-8.5A.75.75 0 0 1 6.25 5z|M11.75 5h2a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1-.75-.75v-8.5a.75.75 0 0 1 .75-.75z',
  // Pause-move (2026-10-22): the strip's own Move sign (bridge/handles.ts), four ways out of the middle.
  move: 'M10 3.5v13|M3.5 10h13|M8 5.5l2-2 2 2|M8 14.5l2 2 2-2|M5.5 8l-2 2 2 2|M14.5 8l2 2-2 2',
  // The AI: a four-point spark.
  spark: 'M10 3.5c.55 3.2 2.3 4.95 5.5 5.5-3.2.55-4.95 2.3-5.5 5.5-.55-3.2-2.3-4.95-5.5-5.5 3.2-.55 4.95-2.3 5.5-5.5z',
  more: 'o 5 10|o 10 10|o 15 10',
  list: 'M7.5 5.5h9|M7.5 10h9|M7.5 14.5h9|o 4 5.5|o 4 10|o 4 14.5',
  // Two rounded sheets, the front one whole.
  copy: 'M9 7.5h6A1.5 1.5 0 0 1 16.5 9v6a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 15V9A1.5 1.5 0 0 1 9 7.5z|M12.5 5A1.5 1.5 0 0 0 11 3.5H5A1.5 1.5 0 0 0 3.5 5v6A1.5 1.5 0 0 0 5 12.5',
  trash: 'M3.5 5.5h13|M8 5.5V4.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75V5.5|M5.5 5.5l.75 10.1a1 1 0 0 0 1 .9h5.5a1 1 0 0 0 1-.9l.75-10.1|M8.5 8.5v5|M11.5 8.5v5',
  chevronUp: 'M5.5 12.5 10 8l4.5 4.5',
  chevronDown: 'M5.5 7.5 10 12l4.5-4.5',
  chevronLeft: 'M12 5l-5 5 5 5',
  chevronRight: 'M8 5l5 5-5 5',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  arrowUp: 'M10 15.5v-11|M5.5 9 10 4.5 14.5 9',
  // Layers (2D draw order): a bar = the end of the stack.
  toFront: 'M4.5 3.5h11|M10 16.5v-9|M6 11.5l4-4 4 4',
  forward: 'M10 16v-11|M6 9l4-4 4 4',
  backward: 'M10 4v11|M6 11l4 4 4-4',
  toBack: 'M4.5 16.5h11|M10 3.5v9|M6 8.5l4 4 4-4',
  send: 'M10 16V4.5|M5 9.5 10 4.5l5 5',
  // Rebrand 2026-10-16: the left column's two places and the ⌘K actions.
  // A box seen from a corner: "the scene".
  // The UI layer (UI stage 1): a screen with a title bar and a button — "the things drawn over the game".
  uiLayer: 'M5 4.5h10A1.5 1.5 0 0 1 16.5 6v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 14V6A1.5 1.5 0 0 1 5 4.5z|M6.5 8h5|M6.5 12.5h3.5',
  // A UI element's kind in the list and on the card (UI stage 1): text (a T), a button, a picture.
  uiText: 'M5.5 5h9|M10 5v10.5',
  uiButton: 'M5.5 6.5h9a2.5 2.5 0 0 1 2.5 2.5v2a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 11V9a2.5 2.5 0 0 1 2.5-2.5z|M7.5 10h5',
  uiImage: 'M5 4.5h10A1.5 1.5 0 0 1 16.5 6v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 14V6A1.5 1.5 0 0 1 5 4.5z|M3.5 13l4-4 3 3 2-2 4 4|o 12.5 8',
  cube: 'M10 3.5 16 6.75v6.5L10 16.5 4 13.25v-6.5L10 3.5z|M4 6.75 10 10l6-3.25|M10 10v6.5',
  // Four tiles: "the files".
  grid: 'M4.5 3.5h3.5a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z|M12 3.5h3.5a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z|M4.5 11H8a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1z|M12 11h3.5a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1z',
  eye: 'M2.5 10s2.75-5 7.5-5 7.5 5 7.5 5-2.75 5-7.5 5-7.5-5-7.5-5z|O 10 10 2.25',
  // The eye struck through: "the game's UI is hidden while you edit the world" (layer-switch.ts).
  eyeOff: 'M2.5 10s2.75-5 7.5-5 7.5 5 7.5 5-2.75 5-7.5 5-7.5-5-7.5-5z|O 10 10 2.25|M4 16 16 4',
  plus: 'M10 4.5v11|M4.5 10h11',
  // The plus without its upright: one point fewer on a motion's path (motion-gui, 2026-10-22).
  minus: 'M4.5 10h11',
  // The plus turned 45°: close a note.
  close: 'M6 6l8 8|M14 6l-8 8',
  // The shortcut sheet (⌘K "Keyboard shortcuts"): a key cap with a row of keys and the space bar.
  keyboard: 'M4.5 5.5h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13V7a1.5 1.5 0 0 1 1.5-1.5z|o 6.5 8.5|o 10 8.5|o 13.5 8.5|M7.5 11.75h5',
  swap: 'M4 7h11.5|M12.5 4l3 3-3 3|M16 13H4.5|M7.5 10l-3 3 3 3',
  globe: 'O 10 10 6.5|M3.5 10h13|M10 3.5c-2.2 2.4-2.2 10.6 0 13|M10 3.5c2.2 2.4 2.2 10.6 0 13',
  hand: 'M7 10V5.25a1.25 1.25 0 0 1 2.5 0V9|M9.5 8.5V4.25a1.25 1.25 0 0 1 2.5 0V9|M12 8.75V5.5a1.25 1.25 0 0 1 2.5 0V11a5.5 5.5 0 0 1-5.5 5.5h-.3a4.5 4.5 0 0 1-3.6-1.8L3.3 12.2a1.3 1.3 0 0 1 2-1.6L7 12',
  layers: 'M10 3.5 16.5 7 10 10.5 3.5 7 10 3.5z|M3.5 10.25 10 13.75l6.5-3.5|M3.5 13.5 10 17l6.5-3.5',
  // The studio's mark: two cards (the KUMODeck "deck"), a little apart. The
  // front one filled = the scene you have open; the one behind, a line = the
  // code under it. Simple enough to hold at 16 px.
  mark: 'M8.5 3.5h6A2 2 0 0 1 16.5 5.5v6|M5.5 6.5h6A2 2 0 0 1 13.5 8.5v6a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z',
  // Six dots: "drag me" (list grips).
  grip: 'o 7.5 5.5|o 12.5 5.5|o 7.5 10|o 12.5 10|o 7.5 14.5|o 12.5 14.5',
  // The tool strip's four tools (the same pictures as the strip in the game, on this 20 grid): ⌘K rows.
  toolMove: 'M10 3.5v13|M3.5 10h13|M8 5.5l2-2 2 2|M8 14.5l2 2 2-2|M5.5 8l-2 2 2 2|M14.5 8l2 2-2 2',
  toolLift: 'M10 3.5v13|M7 6.5l3-3 3 3|M7 13.5l3 3 3-3',
  toolRotate: 'M16 10a6 6 0 1 1-1.76-4.24|M14.75 3v3.25H11.5',
  toolScale: 'M4.5 15.5 15.5 4.5|M11 4.5h4.5V9|M4.5 11v4.5H9',
};

/** Icons drawn filled as well as stroked (they read too thin as outlines). */
const FILLED = new Set(['play', 'stop', 'spark', 'pause']);
/** Icons whose LAST part is filled (the mark's front card). */
const LAST_FILLED = new Set(['mark']);

function part(d: string, filled: boolean): SVGElement {
  if (d[0] === 'o' || d[0] === 'O') {
    const [, cx, cy, r] = d.split(' ');
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    if (d[0] === 'o') {
      // A dot: fill only, so its size does not depend on the stroke width.
      c.setAttribute('r', '1.3');
      c.setAttribute('fill', 'currentColor');
      c.setAttribute('stroke', 'none');
    } else {
      c.setAttribute('r', r);
      c.setAttribute('fill', 'none');
    }
    return c;
  }
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', filled ? 'currentColor' : 'none');
  return p;
}

export function icon(name: keyof typeof PATHS | string): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name}`);
  // Stroke colour, caps and joins on the <svg> (inherited by every part); the
  // width comes from CSS (svg.icon { stroke-width: var(--studio-icon-stroke) })
  // so a .studio/ui/studio.css can make every icon bolder in one place.
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const filled = FILLED.has(name);
  const parts = (PATHS[name] || '').split('|');
  for (const [i, d] of parts.entries()) {
    const el = part(d, filled || (LAST_FILLED.has(name) && i === parts.length - 1));
    // The same on-screen line width at every icon size (see the rule above).
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(el);
  }
  return svg;
}

/**
 * Put an icon and a label into a button. `showLabel: false` keeps the label
 * for screen readers and the tooltip only (icon-only toolbar buttons).
 * Re-rendering a button goes through here, so textContent never wipes the icon.
 */
export function setButton(b: HTMLButtonElement, name: string | null, label: string, showLabel = true, tip?: string): void {
  b.replaceChildren();
  if (name) b.append(icon(name));
  if (showLabel) {
    const s = document.createElement('span');
    s.className = 'label';
    s.textContent = label;
    b.append(s);
  }
  b.setAttribute('aria-label', label);
  if (tip !== undefined) b.title = tip;
  else if (!showLabel) b.title = label;
}
