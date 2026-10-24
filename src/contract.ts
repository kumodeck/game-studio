// KUMODeck Game Studio — the shared contract (types and constants).
//
// Every part of the studio (bridge, shell, adapters, tools, schema, loader,
// local server) imports its shared shapes from this one file so the pieces can
// be built in parallel and still fit together. CONTRACT.md is the prose version
// of the same promises; when the two disagree, fix both in one commit.
//
// Rules for this file:
// - Types and plain constants only. No runtime behaviour beyond tiny pure
//   helpers, so it can be imported from the game iframe, the shell page and
//   the Node server alike.
// - Erasable TypeScript only (no enums, namespaces or parameter properties):
//   the zero-dependency build strips types with Node's built-in stripper.
// - Changing a shape here is a contract change: tell the integrator first and
//   bump CONTRACT_VERSION when an existing field changes meaning.

export const CONTRACT_VERSION = 1;

// ---------------------------------------------------------------------------
// Basic shapes
// ---------------------------------------------------------------------------

export type Dim = '2d' | '3d';
/**
 * Which adapter is talking. 'three' is the built-in three.js adapter; every
 * other value is free text chosen by whoever wrote the adapter (usually the
 * user's AI agent: 'pixi', 'phaser', 'canvas', 'my-engine', ...).
 */
export type AdapterKind = string;
export type ToolId = 'placement' | 'library';
/**
 * What the editor moves right now (UI stage 1, 2026-10-19; CONTRACT.md §1.1): the game's world (three.js / 2D
 * objects, as always) or its UI (HTML elements marked data-studio-key, later also UI drawn in a canvas). One at a
 * time; the top bar switches. Not the same as Item.layer (a 2D draw-order list).
 */
export type EditLayer = 'world' | 'ui';

/**
 * UI stages 2–3 (2026-10-22; CONTRACT.md §1.11): the game's UI screens, what an element says and how it looks.
 * A button's looks other than its normal one: under the pointer (`:hover`), pressed (`:active`), not usable (`:disabled`).
 */
export type UiState = 'hover' | 'active' | 'disabled';
/** What the card can change on a UI element: its main text, that text's size (CSS px) and colour, the box's fill. */
export type UiPropName = 'text' | 'fontSize' | 'color' | 'background';
/** One state's colours (a button's hover / pressed / disabled look): the only props a state has of its own. */
export interface UiStateSet {
  color?: string;
  background?: string;
}
/**
 * placement.json `ui.<key>.set` / `setWas`: what the person changed on the card, and the game's own values (the AI
 * searches the code for those). Every field optional; a state's colours under "@hover" / "@active" / "@disabled".
 */
export interface UiStyleSet {
  text?: string;
  fontSize?: number;
  color?: string;
  background?: string;
  '@hover'?: UiStateSet;
  '@active'?: UiStateSet;
  '@disabled'?: UiStateSet;
}
/** One screen of the game's UI: a container marked data-studio-screen="<id>" (title, play, pause, over, …). */
export interface UiScreenInfo {
  id: string;
  /** data-studio-screen-label, when the game gives one (untrusted text: textContent only). */
  label?: string;
}
/** A UI element as the card shows it (bridge ui-extras.ts → ShellToBridge ui/props). */
export interface UiProps {
  key: string;
  /** The look on screen now (null = the normal one). */
  state: UiState | null;
  /** A button (or role=button): the card offers its states. */
  button: boolean;
  /** Its main text (data-studio-text, else its first text); null = none the card can change (mixed or no text). */
  text: string | null;
  fontSize: number | null;
  color: string | null;
  /** The box's fill; null = none (transparent: the card offers no fill, except for a button). */
  background: string | null;
  /** The game's own values (before any change of the editor's; for setWas and "↺"). */
  was: UiStyleSet;
  /**
   * Sample values ("999,999", a long name: does the text still fit?): null = nothing to put one in. `now` = the sample shown, `hint` = the game's
   * data-studio-sample, `value` = the target is a value the game writes (data-studio-value: a score), not words.
   */
  sample: { now: string | null; hint?: string; value: boolean } | null;
}
/** One CSS variable of the game's theme (:root / html / body), as the theme rows show it. */
export interface UiThemeVar {
  name: string;
  type: 'color' | 'font';
  /** The value now (the editor's, when changed). */
  value: string;
  /** The game's own value. */
  was: string;
}

/**
 * Pose of one movable object, in the object's PARENT space (what you would
 * type into the game code). This is the same shape that is stored per object
 * in placement.json, so undo/redo, messages and the saved file never need to
 * convert between formats.
 *
 * - 3D: p = [x, y, z] in metres; r = rotation around the vertical axis
 *   (three.js `rotation.y`, radians, normalised to (-PI, PI]).
 * - 2D: p = [x, y] in pixels; r = angle in radians, clockwise positive (the
 *   same sign as Pixi's `rotation`).
 * - s = uniform scale as one number. Three numbers are accepted for objects
 *   that were non-uniformly scaled by the game; the editor only ever multiplies
 *   all components by the same factor.
 */
export interface Pose {
  p: number[];
  r?: number;
  s?: number | number[];
  /**
   * 3D, optional: the tilt, [rotation.x, rotation.z] in radians (the object's
   * own Euler angles, the same order as `r` = rotation.y). Present only when
   * the editor tipped the object away from how the game built it ("tip
   * forward / sideways", 2026-10-16); a pose without `t` leaves the game's
   * own x / z rotation as it is, so files and games without tilt behave as
   * before.
   */
  t?: [number, number];
  /**
   * 2D, optional: draw order (layer) among the listed objects that share the
   * object's `Item.layer`, 0 = drawn first (back-most). Only adapters that can
   * reorder report it. setPose with a different z moves the object to that
   * place (the others keep their order relative to each other), so undo is
   * just setPose with the old z. Never written per object to placement.json:
   * the file keeps whole orders instead (PlacementFile.order).
   */
  z?: number;
}

/** The world axis a 3D turn goes around: y = turn, x = tip forward / back, z = tip sideways. */
export type TurnAxis = 'y' | 'x' | 'z';
/**
 * The tool strip's four tools (2026-10-16, play test). Pressing a
 * strip button (or its key: M move, H height, T turn, S size) CHOOSES the
 * tool; it stays pressed, and a drag anywhere on the game then does it to
 * what is picked. Looking around while a tool is chosen: Option / right /
 * middle drag, or Space held; one finger = the tool, two = looking on touch.
 */
export type StripTool = 'move' | 'rotate' | 'lift' | 'scale';
/**
 * Resizing or turning several objects: `spread` ("together") = the whole arrangement as one piece (the gaps grow;
 * the places turn round the middle of the selection), `inplace` ("each in place") = each one on its own spot.
 * The turn uses the same two words since 2026-10-18 (play test: "no turn options with several picked").
 */
export type GroupScaleMode = 'spread' | 'inplace';

/** One movable object as listed by an adapter. */
export interface Item {
  /** Stable id, see KEY_RE and the key order in CONTRACT.md §1.3. */
  key: string;
  /** Human-readable name. Untrusted text from the game: render with textContent only. */
  label: string;
  /** Free-form kind tags, e.g. ['mesh'], ['group'], ['sprite'], ['container']. */
  kinds: string[];
  /**
   * UI stage 2 (2026-10-22): the screen a UI element belongs to (the data-studio-screen of its container); absent =
   * always on screen, and for every world object.
   */
  screen?: string;
  /**
   * Objects that share a group are shown once in the list as "label ×N".
   * Typically the model/texture source or the base name without a numeric suffix.
   */
  group?: string;
  /** true when the key is a tree path (path:0/3/1) and may change when code changes. */
  unstable?: boolean;
  rotatable: boolean;
  scalable: boolean;
  /** false = the move handle is hidden (game rule "locked"). Default true. */
  movable?: boolean;
  /** 3D: false = the height handle is hidden (game rule "lockHeight"). Default true. */
  liftable?: boolean;
  /** Size the game wants for this kind of object (game rule scale.default); the shell offers "reset size". */
  defaultScale?: number;
  /**
   * 2D, optional: id of the sibling list this object is drawn in (usually
   * its parent: 'stage', a container's key). Present = the adapter can change
   * the draw order and `pose.z` is the object's place in that list. Absent
   * (three.js, adapters without order) = the shell shows no layer controls.
   */
  layer?: string;
  /**
   * 2D, with `layer`: the ground or background at the back of its list
   * (play test 2026-10-16: "to back" put a rock behind the ground, where
   * it vanished). Kept at the back: no reorder controls of its own, and "to
   * back" / dragging stop just in front of it. Set by the editor (a name like
   * ground / background, or as wide as the game), only for the run of such
   * objects at the very back of a list that also has other objects.
   * 3D (a hands-on try of 2026-10-19: a stray Height drag lifted the road 16 m and it was saved like that): the
   * three.js adapter sets it too, without `layer`, for a ground, road, sea or sky (a name that says so, or a box far
   * bigger than the rest: adapters/three/ground.js). The editor then holds it still (`held: 'ground'`).
   */
  backdrop?: boolean;
  /**
   * Why the editor holds this object still (set by the editor, bridge/hold.ts; adapters never set it):
   * - 'ground': a 3D ground / road / sky (`backdrop`), so a stray drag cannot lift the road. No tools until the
   *   person presses "Make movable" on its card or its menu (ShellToBridge placement/unhold). The AI can still move it.
   * - 'game': the game itself changed it while the editor watched the first moments of play (bridge/observe.ts),
   *   so a new value would not last: the game sets it again every frame. Only what the game changed is off
   *   (`driven`); the rest stays editable — a pillar the game slides along the road can still be made taller, a boat
   *   that bobs on the waves can still be moved across the water.
   */
  held?: 'ground' | 'game';
  /**
   * With held 'game': what the game changes by itself. move = the place across the ground (3D x / z; 2D x / y),
   * lift = the height (3D y), turn, size.
   */
  driven?: Array<'move' | 'lift' | 'turn' | 'size'>;
  /**
   * With held 'game' when the game moves its place or height: Move and Height work on it — what they set is where it
   * starts, and the game moves it on from there. Its turn and size stay held. Since studio-move-plain (2026-10-23)
   * always so, with no step first; before, the person chose "Set where it starts" from a menu (studio-tool-clear).
   */
  startSpot?: boolean;
  /**
   * With held 'game' while a motion is being recorded (the timeline open with ● on: studio:timeline/recording): every
   * tool works on it as on anything else — a move, a turn, a resize is a point of the motion, not its start spot — and
   * the line under the strip says the game moves it too, so when played the two motions add up (studio-motion-move,
   * 2026-10-23: "I try to make a motion, but moving is limited?"). `startSpot` is absent then.
   */
  meets?: boolean;
  /**
   * Copy made in this edit session (copy / ⌘D, CONTRACT.md §1.8): the key of
   * the object it was copied from. Absent for objects the game itself makes.
   */
  copyOf?: string;
  /**
   * true = the adapter cannot make real copies, so the editor shows a
   * stand-in (a see-through picture of the original) until the AI puts the
   * copy into the code.
   */
  ghost?: boolean;
  /**
   * Optional, objects without a name (`unstable`): what it looks like, so the
   * editor can call it by that ("Black pillar by the road (left, 3rd)", not
   * "Unnamed group"; a hands-on try, 2026-10-19). `size` = its world box
   * ([w, h, d] in 3D, [w, h] in 2D), `c` = the box's middle, `color` = the
   * main part's colour (#rrggbb), `inside` = drawn from the inside (a sky
   * dome). Only a hint for the shown name: keys and the AI never depend on it.
   */
  look?: ItemLook;
  /** Current pose (parent space). */
  pose: Pose;
}

/** Item.look: what an unnamed object looks like (src/shell/names.ts turns it into words). */
export interface ItemLook {
  size: number[];
  c?: number[];
  color?: string;
  inside?: boolean;
}

/**
 * Where the bridge draws the handles for the selected object, in CSS pixels
 * of the game iframe's viewport (the same space as PointerEvent.clientX/Y).
 */
export interface Anchor {
  /** Screen position of the object's pivot. */
  center: [number, number];
  /** Screen-space bounding box, if the adapter can compute one cheaply. */
  rect?: { x: number; y: number; w: number; h: number };
  /** 3D only: how many px above `center` the top of the object is (for the lift handle). */
  liftPx?: number;
  /** Approximate on-screen size in px (max of width/height) of the object. */
  size: number;
  /** Current pose, so the shell can show numbers without another round trip. */
  pose: Pose;
  /** false when the pivot is behind the camera or far off screen: hide the handles. */
  visible: boolean;
}

/** One asset an object uses. */
export interface AssetRef {
  /** Absolute URL as the game loaded it (the shell maps it back to a folder path). */
  url: string;
  how: 'texture' | 'model' | 'sound' | 'atlas' | 'font' | 'other';
  /** false when the link is a guess (e.g. glb matched by load order). Shown as "guessed". */
  sure: boolean;
}

/** One network/media load seen while the game was running (recorded by src/core). */
export interface LoadEntry {
  url: string;
  how: 'fetch' | 'xhr' | 'image' | 'audio' | 'css' | 'script' | 'other';
  /** ms since the edit script started (performance.now()). */
  t: number;
  /** undefined while in flight, then true/false. */
  ok?: boolean;
}

// ---------------------------------------------------------------------------
// Promise 1: the port between the editor and a game (lives in the game iframe)
// ---------------------------------------------------------------------------
//
// The editor never depends on a game library. It talks to ONE fixed port:
//
// - Port2D (small, recommended for every 2D game): list objects, read/write a
//   pose, report where an object is on screen. The user's AI agent writes it
//   for the game at hand (PixiJS, Phaser, plain canvas, a home-made engine),
//   starting from the example adapters shipped with the skill. The base turns
//   a Port2D into a full StudioAdapter (picking, handles, drag maths, view).
// - StudioAdapter (full): what the bridge actually drives. The built-in
//   three.js adapter implements it directly, so three.js games need no
//   adapter code at all. Other 3D engines may implement it too.
//
// Adapters are registered with window.studio.registerAdapter(probe) or
// window.studio.register2D(port), from a file the AI writes at
// `.studio/adapter.js` in the game folder. The host loads that file right
// after the edit script and before any game code (CONTRACT.md §1.4).
//
// After an adapter is found the base runs a self-check (see SelfCheck) and
// tells the shell and the AI what to fix when the adapter does not work.

/**
 * Screen coordinates passed to adapters are CSS pixels in the iframe viewport
 * (PointerEvent.clientX/Y). The bridge never converts to NDC because only the
 * adapter knows which canvas the game renders into and how it is letterboxed.
 */
export interface StudioAdapter {
  kind: AdapterKind;
  dim: Dim;
  /** Library version as reported by the engine (e.g. "170", "8.21.0"), for the shell footer. */
  version?: string;

  // --- placement ---
  /** Movable objects, in tree order. Cheap enough to call after every edit. */
  list(): Item[];
  /**
   * Enter edit mode: time is already frozen by src/core; switch to the edit
   * camera/view and return the list. Must not change any object pose.
   */
  begin(): Item[];
  /** Leave edit mode and restore the game's own camera/view. */
  end(): void;
  /**
   * Optional: while editing, let the game's own frame code run (true) or hold it again (false), with the game's
   * own draws still kept off the screen. The editor uses it once, for a moment, to find what the game moves by
   * itself (bridge/observe.ts). Adapters whose engine holds frames on its own (three.js: boot.js) need it; without
   * it the editor only thaws core.time's requestAnimationFrame.
   * `whole` (▶ Play in the page and back to Edit, bridge/play-switch.ts; studio-edit-restore, 2026-10-23): off also puts
   * the scene's things back as Play found them — what the game added is held out, what it took away is back — and the
   * next on hands those back to the game first (three.js adapter.js holdOut / giveBack).
   */
  watch?(on: boolean, whole?: boolean): void;
  /**
   * Draw one frame of the edit view. Called by the bridge while frozen
   * (the game's own loop is paused, so nothing else draws).
   */
  render(): void;
  /**
   * Keys of objects under the point, best first: visible before hidden,
   * nearest before farther, smaller before larger. The bridge cycles through
   * this list when the same spot is pressed again (to reach objects behind).
   */
  pickNear(x: number, y: number, radiusPx: number): string[];
  /** Handle placement for the object, or null if the key is unknown. */
  anchor(key: string): Anchor | null;
  /** Start a move at screen point (x, y). false = cannot move this object. */
  grab(key: string, x: number, y: number): boolean;
  /**
   * Continue the move. 3D: on the horizontal plane through the grab point.
   * 2D: in the parent's space. Returns the new pose.
   */
  drag(key: string, x: number, y: number): Pose;
  /**
   * Rotate by `d` radians, measured as the finger circles ON SCREEN,
   * clockwise positive (screen y points down). 2D: add d to the angle.
   * 3D: turn around the vertical axis so the object follows the finger as
   * seen by the edit camera (from above that is rotation.y -= d; from below,
   * += d).
   */
  rotate(key: string, d: number): Pose;
  /**
   * 3D, optional: turn by `d` (screen clockwise, as `rotate`) around one
   * world axis — `y` turn, `x` tip forward / back, `z` tip sideways — through
   * the middle of the object's visual box (its bounding box centre), not its
   * origin: an origin at one end of a model made it swing in a wide arc.
   * The position changes with the turn; the pose reports `r` and `t`.
   */
  turn?(key: string, d: number, axis: TurnAxis): Pose;
  /** Multiply the scale by `factor` (> 0). Adapters clamp to a sane range. */
  scale(key: string, factor: number): Pose;
  /**
   * 3D, optional: the bottom middle of the object's visual box, in its
   * parent's space (the same space as `pose.p`). Resizing several objects
   * "together" or "each in place" keeps these feet on the ground.
   */
  foot?(key: string): number[] | null;
  /**
   * 3D, optional: the middle of the object's visual box, in its parent's space (the space of `pose.p`). Several
   * objects tilted "together" turn round the middle of all their boxes (2026-10-18); without it, round the middle
   * of their origins.
   */
  middle?(key: string): number[] | null;
  /**
   * Optional: the share (0–1) of the game's view the object's on-screen box
   * covers, clipped to the view. Absent = the editor uses `anchor().rect`.
   * 3D adapters give it because a projected box drops the corners behind the
   * camera, and a ground that runs on under the camera looks small that way.
   * Used for "huge" (60 % or more): a tap on it is a tap on nothing and a drag
   * on it looks around (CONTRACT.md §2).
   */
  coverage?(key: string): number | null;
  /** 3D only: raise/lower by `dy` units in parent space. */
  nudgeY?(key: string, dy: number): Pose;
  /**
   * 3D, optional — snap to surfaces (2026-10-19, bridge/snap.ts). The height of the object's bottom (its visual box)
   * and of the highest surface under it (a face of any visible mesh, turned up), in the units `nudgeY` moves by;
   * `below` null = nothing under it. `skip`: keys that are not surfaces (the others moving with it); the object
   * itself and its children never are. The height drag stops on `below`, PgDn steps end on it.
   */
  rest?(key: string, skip?: string[]): { bottom: number; below: number | null } | null;
  /** 3D, optional: Drop to floor (End) — the bottom set on the surface under it (`rest().below`); none: unchanged. */
  drop?(key: string, skip?: string[]): Pose;
  /**
   * 3D, optional: snapping for the moves that follow. `on` while a person drags or nudges (the bridge turns it off
   * after, so other callers of drag() are unchanged): a `drag` of an object standing on a surface keeps it standing
   * on whatever is under it. `free`: Ctrl / ⌥ held (no snapping until let go). `skip`: keys moving together.
   */
  setSnap?(s: { on: boolean; free?: boolean; skip?: string[] }): void;
  /** Apply an absolute pose (undo/redo, typed numbers). null if the key is unknown. */
  setPose(key: string, pose: Pose): Pose | null;
  /**
   * Snapshot of one object for the list thumbnail. Must not run the game's
   * onBeforeRender/onAfterRender hooks (they can move or hide objects).
   */
  capture(key: string, opts: { size: number }): Promise<{ ok: boolean; dataUrl?: string }>;

  /** Edit camera (2D: pan/zoom of the view only; never moves the game's stage). */
  view: AdapterView;

  // --- library ---
  /** Assets this object uses, best effort. */
  assetsOf(key: string): AssetRef[];

  // --- for game tools (optional) ---
  /**
   * Screen point → point in the scene. 3D: on the ground plane y = `y`
   * (default 0), as [x, y, z]; 2D: [x, y] in scene (stage) space. null when
   * the point does not hit the ground (sky) or the adapter cannot tell.
   */
  toGround?(x: number, y: number, groundY?: number): number[] | null;
  /** Scene point → screen point (viewport CSS px), or null when behind the camera. */
  toScreen?(p: number[]): [number, number] | null;

  // --- the selection outline (optional) ---
  /**
   * The on-screen shape of these objects, for the outline the editor draws
   * round the selection (and round what the AI changed). `mask` is a canvas
   * whose alpha is the objects' coverage (other pixels transparent), `x`/`y`/
   * `w`/`h` the viewport CSS px it covers (the canvas may have more device
   * pixels). null = this adapter cannot draw objects alone: the editor then
   * outlines the screen box (anchor().rect) instead. Called only when the
   * selection or the view changed, never every frame.
   */
  silhouette?(keys: string[]): { x: number; y: number; w: number; h: number; mask: HTMLCanvasElement } | null;

  // --- copy and delete (optional, CONTRACT.md §1.8; all three or none) ---
  /**
   * Make a copy of `key` in the same parent, at the same pose (2D: drawn
   * right after the original), listed from now on under `newKey`. false =
   * this object cannot be copied (the editor then shows a stand-in).
   */
  clone?(key: string, newKey: string): boolean;
  /**
   * Take the object out of the picture and out of list()/pickNear(), but
   * keep it so putBack() can bring it back exactly (undo). Keys of the other
   * objects must not change.
   */
  remove?(key: string): boolean;
  /** Undo remove(): the object is drawn and listed again, as it was. */
  putBack?(key: string): boolean;

  // --- ask while playing (optional, CONTRACT.md §3.5) ---
  /**
   * 3D: where the PLAYER's camera (the game's own, not the edit camera) stands and looks right now, in world units:
   * `eye` = its position, `target` = 10 units ahead along its view. Called during ▶ Play, when the person asks their
   * AI something, so the request says where they were ("here the character vanishes"). null / left out = unknown
   * (the request then carries the picture and the log only). 2D adapters need none: the editor uses `anchor()` for
   * what is on screen.
   */
  player?(): { eye: [number, number, number]; target: [number, number, number];
    /** What is near the player, nearest first (world distances; `screen` = where in the picture, 0–1). Left out = the
     *  editor measures from list() poses itself. */
    near?: Array<{ key: string; label?: string; d: number; screen?: [number, number] }> } | null;
}

export interface AdapterView {
  /** 3D only: orbit by a screen delta in px. */
  orbit?(dx: number, dy: number): void;
  /** Pan by a screen delta in px. */
  pan(dx: number, dy: number): void;
  /**
   * 3D only, optional: the camera straight up (dy > 0) or down by a screen delta in px, looking the same way — the
   * scene slides down the screen by dy px at the point the camera turns round. pan keeps the height, so without this
   * there was no way up (play test 2026-10-18). Only on the person's own input (the ↑↓ buttons, E / Q, ⌘K); never by
   * itself. Adapters without it: the editor shows no camera up / down.
   */
  rise?(dy: number): void;
  /**
   * 3D only, optional (studio-fix-0143, ⑨ B, a review of 2026-10-24): move the camera across its own picture by a screen
   * delta in px at the point it turns round — along its right and its own up, so nothing gets nearer or farther and
   * every object keeps its size on screen. The editor's one way to move the view while the timeline plate is open
   * ("the camera does not pull back"); pan there carried a near-level camera down the road (the ship 144 → 47 px).
   * Adapters without it (2D: pan already keeps sizes): the editor pans in 2D, and in 3D only sideways.
   */
  slide?(dx: number, dy: number): void;
  /**
   * 3D only, optional: fly (WASD, camera-wasd pass 2026-10-18 — the habit of every 3D engine). Move the camera by
   * `right` / `up` / `fwd`, each in seconds of travel at the adapter's normal speed, which it picks from the scene's
   * size so a small room and a big harbour feel the same (the bridge passes the frame's dt, ×3 with Shift). fwd
   * is level (along the ground the way the camera faces: looking down, W keeps the height — wasd-level 2026-10-19;
   * it followed the line of sight before), right is level, up is straight up. Only on the person's own keys; never by itself. Adapters without
   * it: WASD does nothing and E / Q fall back to rise steps.
   */
  fly?(right: number, up: number, fwd: number): void;
  /** 3D only, optional (with fly): turn the view where the camera stands, by a screen delta in px (right-drag while flying). */
  look?(dx: number, dy: number): void;
  /** Zoom by `factor` (> 1 = closer) around screen point (x, y) if given. */
  zoom(factor: number, x?: number, y?: number): void;
  /** Fit all movable objects in view. */
  frameAll(): void;
  /** Bring one object into view. */
  focus(key: string): void;
  /** Opaque, JSON-safe snapshot of the edit camera (kept across reloads by the shell). */
  state(): unknown;
  /** Restore a snapshot from state(). Unknown shapes are ignored. */
  restore?(state: unknown): void;
  /**
   * Optional: the opening view, used instead of frameAll() when editing starts
   * without a kept view. The three.js adapter stands exactly where the game's
   * camera stands, so the first picture of the editor is the player's picture.
   * Also "Back to the opening view" (⌘K, ⇧F) with `{ glide: true }`: move
   * there smoothly instead of jumping.
   */
  home?(opts?: { glide?: boolean }): void;
  /**
   * Optional: called after each single pick. While the view is still the
   * opening one, glide to an angle made for editing around `key` and return
   * true (call `done` when the glide ends); otherwise do nothing and return
   * false. Once the person moved the view, a pick never moves it.
   */
  settle?(key: string, done?: () => void): boolean;
}

/**
 * How an adapter announces itself. install() runs as soon as the probe is
 * registered — the built-in probes and `.studio/adapter.js` both load before
 * any game code — so it can place engine hooks such as
 * `window.__THREE_DEVTOOLS__` or `globalThis.__PIXI_APP_INIT__`. After the
 * first frame (or studio.ready()) the bridge asks each probe for an adapter.
 * Probes registered by the game folder are asked before the built-in ones, so
 * an AI-written adapter can override the built-in three.js adapter.
 */
export interface AdapterProbe {
  kind: AdapterKind;
  install(ctx: CoreContext): void;
  found(): StudioAdapter | null;
}

// ---------------------------------------------------------------------------
// src/core: shared services inside the game iframe
// ---------------------------------------------------------------------------

export interface TimeControl {
  /** true while the game's frame callbacks are held back. */
  readonly frozen: boolean;
  freeze(): void;
  /** Resume the game's callbacks. Prefer reloading the game after a save instead. */
  thaw(): void;
  /** The real requestAnimationFrame, for the studio's own drawing. */
  raf(cb: (t: number) => void): number;
  cancelRaf(id: number): void;
  /** Resolves after the game has drawn its first frame (or studio.ready() was called). */
  firstFrame(): Promise<void>;
}

export interface LoadLog {
  entries(): LoadEntry[];
  /** Subscribe to new entries; returns an unsubscribe function. */
  on(cb: (e: LoadEntry) => void): () => void;
}

export interface CoreContext {
  time: TimeControl;
  loads: LoadLog;
}

/**
 * The small global API (window.studio, plus window.__gameStudio which always
 * exists even if the game already uses the name `studio`). Only present while
 * the edit script is loaded, so game code must call it as `window.studio?.x()`.
 */
export interface StudioGlobal {
  version: number;
  /** "The scene is fully built": freeze here instead of after the first frame. */
  ready(): void;
  /** For engines without discovery hooks (old three.js): hand over { scene, renderer, camera }. */
  attach(parts: Record<string, unknown>): void;
  /** Register a full adapter probe (advanced; 3D engines other than three.js). */
  registerAdapter(probe: AdapterProbe): void;
  /** Register a small 2D port; the base builds the full adapter from it. */
  register2D(port: Port2D | (() => Port2D | null)): void;
  /**
   * Register a port for the editor's UI layer (CONTRACT.md §1.1, the UI seat; UI stage 1 adds the name and the order
   * only): UI the game draws itself — a Phaser HUD scene's texts, a Pixi UI container, a three.js orthographic HUD —
   * in the same Port2D shape, with p = CSS px offsets on screen. Asked before the built-in DOM UI adapter; the
   * first that answers wins (merging several seats into one list is a later stage).
   */
  registerUI(port: Port2D | (() => Port2D | null)): void;
  /** Shared services, for adapters that want the load log or the real rAF. */
  core: CoreContext;
  /**
   * Fit the editor to this game without changing the editor (CONTRACT.md §7):
   * extra rules in code and game-specific tools. Called from
   * `.studio/tools.js`, which the AI writes for the game.
   */
  extend(ext: GameExtension): void;
  /**
   * Levels (2026-10-22, CONTRACT.md §1.10): the levels the game's code has (ids, or { id, label }), in its order.
   * Returns the level the editor shows now — `id` (its own; may be one made in the editor) and `build` (a level the
   * code has: an editor-made level is built from the one it was copied from) — or null outside the editor, where the
   * game picks its level itself. Optional on the type so `window.studio?.levels?.(…)` reads the same in old builds.
   */
  levels?(list: Array<string | LevelInfo>): LevelPick | null;
}

/** One level as the game names it (studio.levels). `id` matches KEY_RE; `label` is what the person reads. */
export interface LevelInfo {
  id: string;
  label?: string;
}

/** What studio.levels() returns in the editor: the level shown (`id`) and the code's level to build for it. */
export interface LevelPick {
  id: string;
  build: string;
}

// ---------------------------------------------------------------------------
// Fitting the editor to one game (CONTRACT.md §7)
// ---------------------------------------------------------------------------

/** A grid step: one number for every axis, or one per axis ([x, y] / [x, y, z]; 0 = free). */
export type GridStep = number | number[];

/** One rule of `.studio/studio.json`. Matching rules are merged in order (later wins). */
export interface GameRule {
  /** Glob on the key, the label or the group: "crate*", "tree-?", "*". */
  match: string;
  /** Leave the object out of the editor entirely. */
  hidden?: boolean;
  /** Listed and selectable but not movable (no handles). */
  locked?: boolean;
  /** 3D: keep the height; no height handle. */
  lockHeight?: boolean;
  rotate?: boolean;
  scale?: boolean | { default?: number; min?: number; max?: number };
  snap?: { grid?: GridStep; angle?: number };
}

/**
 * `.studio/studio.json`: plain settings the AI writes for one game. Units are
 * the game's own (metres in 3D, scene px in 2D); angles in degrees.
 */
export interface GameConfig {
  version: 1;
  /** Snap every move to this grid and every turn to this angle (degrees). */
  snap?: { grid?: GridStep; angle?: number };
  /** Objects must stay inside this box (parent space; 2 or 3 numbers each). */
  bounds?: { min: number[]; max: number[] };
  rules?: GameRule[];
}

/** What `.studio/tools.js` passes to studio.extend(). */
export interface GameExtension {
  /**
   * Last word on every edit made with handles, keys or tools (not on undo).
   * Return the pose to use (e.g. keep cars on the road, stack crates).
   */
  constrain?(key: string, pose: Pose, item: Item): Pose;
  tools?: GameTool[];
}

export interface GameToolPointer {
  type: 'down' | 'move' | 'up';
  x: number;
  y: number;
  pointerType: string;
  shift: boolean;
}

/** Everything a game tool may use. Poses changed through it are undoable. */
export interface GameToolContext {
  dim: Dim;
  lang: Lang;
  items(): Item[];
  selected(): string | null;
  select(key: string | null): void;
  /** Move an object; one call = one undo step (pass `hold: true` while dragging, then a final call without it). */
  setPose(key: string, pose: Pose, opts?: { hold?: boolean }): Pose | null;
  pickNear(x: number, y: number): string[];
  toGround(x: number, y: number, groundY?: number): number[] | null;
  toScreen(p: number[]): [number, number] | null;
  /** 2D canvas over the game, cleared before every draw(). */
  overlay: CanvasRenderingContext2D;
  /** The tool's data changed: count it as unsaved and redraw. */
  changed(): void;
}

/**
 * A game-specific tool (draw the course, place along a path, paint tiles…).
 * Its data is saved to `.studio/data/<id>.json` with the other results.
 */
export interface GameTool {
  /** /^[a-z0-9][a-z0-9-]{0,39}$/ — also the data file name. */
  id: string;
  label: string | Partial<Record<Lang, string>>;
  /** One character or emoji for the button. */
  icon?: string;
  /** Short help shown while the tool is on. */
  hint?: string | Partial<Record<Lang, string>>;
  activate?(ctx: GameToolContext): void;
  deactivate?(ctx: GameToolContext): void;
  /** Return true when the tool used the pointer (the editor then does nothing with it). */
  pointer?(e: GameToolPointer, ctx: GameToolContext): boolean;
  /** Draw on ctx.overlay; called every frame while the tool is on, and once after changed(). */
  draw?(ctx: GameToolContext): void;
  /** Data to save, or null for nothing. */
  data?(): unknown;
  /** Saved data from last time (or null), given before activate. */
  restore?(data: unknown): void;
  /** Number of unsaved changes (default: counted from changed() calls). */
  dirty?(): number;
  /** The data was saved (reset your own dirty() count here). */
  saved?(): void;
}

/** Tools as the shell sees them. */
export interface GameToolInfo {
  id: string;
  label: string;
  icon?: string;
  hint?: string;
}

/** Tool id pattern (also the file name under .studio/data/). */
export const TOOL_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// ---------------------------------------------------------------------------
// UI preferences (.studio/ui.json): how the person likes the editor to look
// ---------------------------------------------------------------------------

export interface UiPrefs {
  version: 1;
  /** Where the panel sits on a PC-sized window (phones always use the bottom bar). */
  panel: 'right' | 'left' | 'bottom';
  /** Side panel width in px. */
  width: number;
  /** Bottom panel height in % of the window. */
  height: number;
  theme: 'dark' | 'light' | 'auto';
  /** Base text size in px. */
  fontSize: number;
  /** Handle diameter in px. */
  handleSize: number;
  /** Parts of the editor that can be hidden. */
  show: {
    thumbs: boolean;
    numbers: boolean;
    help: boolean;
    adapter: boolean;
    play: boolean;
    frame: boolean;
    lang: boolean;
    next: boolean;
    tools: boolean;
  };
  /** Saved UI language (absent = follow the browser). */
  lang?: Lang;
  /**
   * Hints closed for good (studio-motion-flow, 2026-10-22: "timeline-steps", the timeline's first-time steps). In the
   * game folder like the rest, so a new port or browser does not show them again. Absent = none closed yet.
   */
  seen?: string[];
}

/**
 * The small 2D port. Everything is in the game's own terms; the base does the
 * screen maths. Write it so each method is a few lines of engine calls.
 *
 * Coordinates:
 * - Pose: parent space of the object (what the game code would assign).
 * - Screen: CSS px in the game page's viewport (like PointerEvent.clientX).
 */
export interface Port2D {
  /** Free text shown in the shell footer, e.g. 'pixi', 'phaser', 'canvas'. */
  name: string;
  version?: string;
  /** Movable objects. Leave out UI layers, particles, the background. */
  objects(): Array<{
    key: string;
    label?: string;
    kinds?: string[];
    group?: string;
    unstable?: boolean;
    /** default true */
    rotatable?: boolean;
    /** default true */
    scalable?: boolean;
    /** A UI port (the UI seat): the screen the element is on (Item.screen); absent = always on screen. */
    screen?: string;
  }>;
  /** Current pose (parent space): p = [x, y] px, r = radians clockwise, s = scale. */
  get(key: string): Pose | null;
  /** Apply a pose. The base calls render() afterwards while time is frozen. */
  set(key: string, pose: Pose): void;
  /**
   * Affine map from the object's PARENT space to screen px, as
   * [a, b, c, d, e, f] with screenX = a*x + c*y + e, screenY = b*x + d*y + f
   * (the same order as DOMMatrix / canvas setTransform). Include the canvas
   * position and CSS scaling. The base inverts it to turn a finger move into
   * a parent-space move.
   */
  parentToScreen(key: string): number[] | null;
  /** Screen rectangle of the object (CSS px), used for picking and handles. */
  bounds(key: string): { x: number; y: number; w: number; h: number } | null;
  /** Draw one frame now (the game's own loop is paused by the base). */
  render(): void;
  /**
   * Optional edit camera: show the world shifted by (x, y) screen px and
   * scaled by zoom around the canvas centre, WITHOUT changing object poses
   * (e.g. Pixi: transform app.stage and restore it in end(); Phaser: camera
   * scroll/zoom). Called with {x:0, y:0, zoom:1} to restore the game's view.
   */
  setView?(v: { x: number; y: number; zoom: number }): void;
  /** Optional: pause/resume extra clocks that are not driven by requestAnimationFrame. */
  pause?(): void;
  resume?(): void;
  /** Optional thumbnail as a data:image/png URL. Default: crop of bounds() from the canvas. */
  capture?(key: string, size: number): Promise<string | null>;
  /** Optional: files this object uses (URLs as loaded, or AssetRef). */
  assetsOf?(key: string): Array<string | AssetRef>;
  /** Optional: the canvas the game draws into (default: the largest canvas). */
  canvas?(): HTMLCanvasElement | null;
  /**
   * Optional: the on-screen shape of these objects for the selection outline
   * (StudioAdapter.silhouette, same shape: viewport CSS px + a canvas whose
   * alpha is the coverage). Without it the outline is a rounded box.
   */
  silhouette?(keys: string[]): { x: number; y: number; w: number; h: number; mask: HTMLCanvasElement } | null;
  /**
   * Optional draw order (layers). Both or neither. `parent` names the list
   * the object is drawn in (KEY_RE characters: 'stage', the parent's key…);
   * `index` is its place in that list, 0 = drawn first (back), counting
   * every child the engine draws, listed or not (Pixi getChildIndex, an index
   * into the game's own array, Phaser displayList.getIndex).
   */
  order?(key: string): { parent: string; index: number } | null;
  /**
   * Move the object to `index` in the same list: remove it, then insert it
   * there (Pixi setChildIndex, Array splice, Phaser moveTo). The base only
   * passes the index of another listed object of the same parent.
   */
  setOrder?(key: string, index: number): void;
  /**
   * Optional copy and delete (CONTRACT.md §1.8), all three or none. Without
   * them the editor shows stand-ins (a see-through copy; a deleted object
   * shrunk out of sight) until the AI changes the code.
   * clone: copy `key` into the same parent right after it (same pose) and
   * list the copy under `newKey` (e.g. set its studioKey). remove: hide it
   * and leave it out of objects(); putBack: show and list it again.
   */
  clone?(key: string, newKey: string): boolean;
  remove?(key: string): boolean;
  putBack?(key: string): boolean;
  /**
   * Optional: affine map from SCENE space (the stage/world the game places
   * things in) to screen px, as [a, b, c, d, e, f], including the edit view.
   * Used by game tools (toGround/toScreen). Default: the scene is the canvas's
   * own pixel space, shown through the edit view.
   */
  sceneToScreen?(): number[] | null;
}

/**
 * The self-check the base runs after an adapter is found, so a broken
 * AI-written adapter is caught at once and the AI is told what to fix.
 * The shell shows failures; the host writes them for the AI
 * (local: one stdout line + .studio/check.md).
 */
export type SelfCheckId =
  /** No probe returned an adapter (no engine hook fired, no .studio/adapter.js). */
  | 'adapter-found'
  /** list() returned at least one object. */
  | 'has-objects'
  /** Every key matches KEY_RE and is unique. */
  | 'keys-valid'
  /** setPose then list()/anchor() report the new pose (read-back works). */
  | 'pose-roundtrip'
  /** Moving an object changes the pixels of the game canvas after render(). */
  | 'screen-changes'
  /** anchor()/bounds() of the moved object follow the move on screen. */
  | 'anchor-follows'
  /** Restoring the pose returns the object exactly (the check leaves no trace). */
  | 'restored';

export interface SelfCheckResult {
  ok: boolean;
  kind: AdapterKind | null;
  /** Key of the object used for the move tests, if any. */
  sample?: string;
  /**
   * Keys of listed objects with no mark and no name (`path:` keys, Item.unstable), first 50, and
   * how many there are. The host tells the agent (`studio: unnamed …`) so it can offer once, at the
   * first /arrange, to name them before the person saves with keys that will change (play test 2026-10-16).
   */
  unnamed?: string[];
  unnamedCount?: number;
  checks: Array<{ id: SelfCheckId; ok: boolean; skipped?: boolean; detail?: string }>;
}

// ---------------------------------------------------------------------------
// Promise 2: messages between the bridge (game iframe) and the shell (parent)
// ---------------------------------------------------------------------------

/**
 * Every message is a plain object `{ type: 'studio:<tool>/<verb>', ... }`.
 * `core/*` messages belong to the base (edit mode, view, keys); tool messages
 * use the tool id. Receivers MUST check event.source and event.origin and drop
 * anything else; senders MUST pass an explicit target origin (never '*').
 */
export const MSG_PREFIX = 'studio:';

/** A fly key (WASD + E / Q up / down), by its place on the keyboard (KeyboardEvent.code minus "Key"), lower case. */
export type FlyKey = 'w' | 'a' | 's' | 'd' | 'e' | 'q';

export type ViewAction =
  | { action: 'frameAll' }
  /** Back to the view the editor opened on (adapter view.home, else frameAll). */
  | { action: 'home' }
  | { action: 'focus'; key: string }
  /**
   * Show this object only if a panel covers it (studio-fix-0139, 2026-10-23): no move when its middle is already in the
   * free part of the frame; otherwise the same short pan-only slide as a list pick (bridge/editor.ts focusIfHidden).
   * For PC's timeline plate, which rose over the ship so the drag that makes a motion landed on the ruler.
   */
  | { action: 'reveal'; key: string }
  /**
   * PC's timeline plate closed (fix-0141, 2026-10-24): the view goes back to where it was before the slides made while
   * it was open ('reveal' and list picks), unless the camera was moved since (bridge/editor.ts plateSlides).
   */
  | { action: 'unreveal' }
  | { action: 'zoom'; factor: number }
  | { action: 'orbit'; dx: number; dy: number }
  | { action: 'pan'; dx: number; dy: number }
  /** Camera up (`by` > 0) / down by this share of the game's height (⌘K, E / Q in the editor page); 3D with view.rise. */
  | { action: 'rise'; by: number }
  | { action: 'restore'; state: unknown };

/**
 * Viewport px the shell's floating panels cover on each side. `rightTo`: the
 * right inset only reaches down to this y (the card is in the top right
 * corner; below it the game is free to the edge). `camera: false`: hide the
 * camera up / down buttons for now (a phone with the card, a sheet or a menu
 * up — the second design review's ⑧, 2026-10-19); absent = shown.
 */
export interface Inset { top: number; right: number; bottom: number; left: number; rightTo?: number; camera?: boolean;
  /**
   * The timeline plate is up over the game (studio-fix-0143, ⑨ B, a review of 2026-10-24): 'open' = with its rows,
   * 'slim' = folded to its one line. While it is, a pick the plate hides never pulls the camera back: an 'open' plate is
   * asked to fold first (studio:core/plate-fold), then the view only slides (AdapterView.slide), keeping every size.
   * Absent = no plate.
   */
  plate?: 'open' | 'slim' }

/** shell -> bridge */
export type ShellToBridge =
  | { type: 'studio:core/edit'; on: boolean; viewState?: unknown }
  | { type: 'studio:core/view'; view: ViewAction }
  | { type: 'studio:core/lang'; lang: Lang }
  | { type: 'studio:placement/list' }
  /**
   * Select one object (`key`), or several: `keys` = the whole selection, with
   * `key` the one the card shows (CONTRACT.md §1.8). Handles then move,
   * rotate (around the middle of the selection) and scale all of them.
   */
  | { type: 'studio:placement/select'; key: string | null; focus?: boolean; keys?: string[] }
  /** "Select several" mode: a press in the game adds/removes an object instead of replacing the selection. */
  | { type: 'studio:placement/multi'; on: boolean }
  /**
   * Make copies. Without `pose` the bridge places each copy a little to the
   * side (or, for a copy of a copy, at the same spacing again) and answers
   * with placement/added. With `pose` (redo, reopening) it puts it there.
   * `at: 'view'` (the Library's "Add to scene", 2026-10-18): the copies without a pose go to the middle of what the
   * person sees instead — the free part of the game (what the card and the ask bar leave), on the original's ground
   * in 3D — so the new thing is in sight wherever the original stands (a pine far behind the camera).
   */
  | { type: 'studio:placement/copy'; items: Array<{ key: string; from: string; pose?: Pose }>; at?: 'view' }
  /** Delete objects from the picture (undo: placement/restore). */
  | { type: 'studio:placement/remove'; keys: string[] }
  /**
   * Show deleted objects again (undo of a delete). `at: 'view'` (studio-fix-0146, 2026-10-24: a blank level's Library
   * puts a thing that is not in this level into it): they go to the middle of what the person sees, as the Library's
   * "Add to scene" copies do, become the selection, and their new places come back as placement/moved (`set`).
   */
  | { type: 'studio:placement/restore'; keys: string[]; at?: 'view' }
  /** `layer` (UI stage 1): set it on that layer even when the other one is being edited (saved UI places on open). */
  | { type: 'studio:placement/pose'; key: string; pose: Pose; layer?: EditLayer }
  /**
   * "Make movable" on a held ground / road / sky (Item.held 'ground'): the tools work on it again for this session. (An
   * object the game moves needs none: its Move and Height always set where it starts, studio-move-plain 2026-10-23.)
   */
  | { type: 'studio:placement/unhold'; keys: string[] }
  /**
   * The timeline (studio-timeline, 2026-10-22; CONTRACT.md §1.9): put these objects at these poses — each one's place
   * plus its clip at the playhead's time, worked out by the shell — through the copy/delete layer (no game rules, no
   * snapping) and report nothing: a preview is not an edit. Sent on every scrub / ▶ frame, and with the places when
   * the timeline folds (everything back where it stands).
   */
  // `code` (studio-code-knobs, 2026-10-24): rule motions (codeMotion) of these objects at their time — the shell cannot
  // run the game's at(), so the page adds each one's offsets to that object's pose above (p added, r added, s times).
  | { type: 'studio:timeline/pose'; poses: Array<{ key: string; pose: Pose }>; code?: CodeAt[] }
  /**
   * The picked object's path in 3D (studio-timeline): its place `base` (parent space) and its clip's position keys
   * (offsets from `base`, with `t` and `ease` as in the file), drawn as a curve through the points with a line down
   * to the ground from each; `now` = the playhead's offset (a small ring), `sel` = indexes of the picked keys. `key`
   * null = draw nothing.
   */
  // `making`: the motion is being made step by step (the Motion button's "Make a motion"): the point the object stands
  // on now is not taken by a press — a drag there moves the object, the next step (studio-motion-move, 2026-10-23).
  // `code` (studio-code-knobs): the picked object's rule motion instead of keys — the page samples its at() over one
  // round (none: 4 s) as a violet dotted line, nothing to grab but the ◇ of its `drag` knob (studio:timeline/code-knob).
  // `code.was` (studio-code-torule, ✦ Turn into a rule): the motion of points it replaced, until Save — `pts` its path over
  // the same round (offsets from `base`), `keys` its points: drawn orange beside the violet line (the hand's, to compare).
  | { type: 'studio:timeline/path'; key: string | null; base?: number[]; keys?: MotionKey[]; now?: number[] | null; sel?: number[]; times?: boolean; making?: boolean;
      code?: { code: string; name: string; knobs: Record<string, number>; round: number | null; drag?: string; unit?: string; label?: string; was?: { pts: number[][]; keys: number[][] } } }
  /**
   * studio-code-knobs (2026-10-24): "Convert to coordinates" (it was "Make editable points") — a rule motion's shape as points: the page runs its at()
   * over `len` seconds, `per` points a round, and answers with the keys (studio:timeline/code-points, same `id`).
   */
  | { type: 'studio:timeline/code-points'; id: number; code: string; knobs: Record<string, number>; len: number; per: number }
  /**
   * The game's code layouts laid out again where they stand (studio-code-knobs, 2026-10-24; a layout's knob, a pin, by
   * hand, their ⌘Z): `places` = the level's whole `places` of the draft, `ids` = the layouts to lay out (absent: all).
   * Moved objects come back as studio:place/poses (not the person's moves); made / taken out ones as a new list.
   */
  | { type: 'studio:place/layout'; places: Record<string, PlacementPlace>; ids?: string[] }
  /**
   * The violet rings and dotted line of the code layouts `ids` (the picked object's and the one under the mouse): where
   * the rule puts each of its objects, an empty ring where one is placed by hand. `sel` = the picked object, `places` =
   * the level's `places` of the draft (which ones are put by hand). [] = none.
   * studio-hand-marks (2026-10-24): `places` is always the whole of it while editing (the small hand tags over every object
   * placed by hand show with nothing picked; a pin it did not have spreads its ring), and `lit` = objects the shell lights
   * (the card's "✋ 2 placed by hand" under the mouse): their sand rings bright.
   */
  | { type: 'studio:place/guide'; ids: string[]; sel: string | null; places?: Record<string, PlacementPlace>; compare?: Record<string, PlaceCompareMarks>; lit?: string[] }
  /**
   * studio-offsets (2026-10-24): the four choices under a rule drag (All the same / Zigzag / Ramp / Just this one) are
   * open (`on`) or closed in the editor page: while open, 1–4 and Esc pressed in the game are theirs (not the strip's
   * tools, not "pick nothing"); the game page forwards them as studio:core/key as it does every key.
   */
  | { type: 'studio:place/choices'; on: boolean }
  /**
   * studio-code-keepout (2026-10-24; the plan's step 3): the keep-out areas of the picked object's rule layout `id`
   * painted on the ground (red hatching; a box's edge orange with its corners to drag, a code condition's violet and
   * dashed, its ◇ when it has a knob and a shape), with `entry` = the layout's `places` entry of the draft. `draw` = the
   * card's "+ Draw a box" is on: a drag on the ground draws a box (studio:place/avoid-box, i = -1). null id = none.
   */
  | { type: 'studio:place/avoid'; id: string | null; entry?: PlacementPlace | null; draw?: boolean }
  /**
   * studio-motion-move (2026-10-23): a move / turn / resize is a point of a motion now (the timeline open, ● on, no Try
   * running) — or not any more. While on, a thing the game moves takes every tool as a motion's point (Item.meets),
   * not as its start spot (Item.startSpot).
   */
  | { type: 'studio:timeline/recording'; on: boolean }
  /**
   * studio-motion-triggers (2026-10-22): the picked clip's area ("the player enters an area"), a box in the world with a
   * point in its middle to drag (across the ground; Shift: up / down). null = none drawn.
   */
  | { type: 'studio:timeline/area'; key: string | null; area?: MotionArea | null; label?: string }
  /**
   * One keyboard/button step on the selected object (arrows, Q/E, PageUp/Down,
   * +/-). `hold: true` marks auto-repeat: the bridge folds a run of held steps
   * into one undo step (ends when a non-hold step or another gesture arrives,
   * or after holdDelayMs of silence).
   */
  | { type: 'studio:placement/step'; key: string; op: 'move' | 'rotate' | 'lift' | 'scale' | 'drop'; dx?: number; dy?: number; d?: number; hold?: boolean; keys?: string[] }
  | { type: 'studio:placement/thumbs'; keys: string[]; size: number }
  | { type: 'studio:library/assets' }
  | { type: 'studio:library/preview'; url: string; to: string | null }
  /** The game's settings from .studio/studio.json (or null). Sent before edit on. */
  | { type: 'studio:core/config'; config: GameConfig | null }
  /**
   * UI preferences the bridge uses: the tool strip's button size, and
   * `inset` = viewport px the shell covers with floating panels on each side
   * (the inspector card, the ask bar). The bridge keeps the tool strip and
   * the "bring into view" pan clear of them.
   */
  | { type: 'studio:core/ui'; handlePx: number; inset?: Inset; theme?: 'dark' | 'light' }
  /**
   * What the AI's last change touched (seen after "Reload the game"): drawn
   * in the AI's colour with one tag (`label`, e.g. "AI added 3"). Empty = none.
   */
  | { type: 'studio:placement/marks'; keys: string[]; label?: string }
  /**
   * The mouse is over these objects' row in the list, the card or the ask bar's chip (a hands-on try, 2026-10-19: "light
   * it up when I hover its card"): the game shows them lit, in your colour, softer than the pick. [] = none.
   */
  | { type: 'studio:placement/hover'; keys: string[] }
  /**
   * studio-motion-flow (2026-10-22): a Library motion is held over the game — which object is at this point of the game
   * page (its own px)? Answered by placement/at-is with the same `id` (the same test as a tap; nothing is picked).
   */
  | { type: 'studio:placement/at'; id: number; x: number; y: number }
  /** 3D: the axis the strip's turn button uses (`next` = the R key: y → x → z → y). */
  | { type: 'studio:placement/axis'; axis: TurnAxis | 'next' }
  /** Choose the strip's tool (the M / H / T / S keys and ⌘K when the shell has focus), or none. */
  | { type: 'studio:placement/tool'; tool: StripTool | null }
  /**
   * The strip's Motion button (studio-motion-tool, 2026-10-22): shown after the four tools when the pick can have a
   * motion (`show`: one world object of a 3D game, not the ground / sky), with a dot when it has one (`has`). `label` =
   * its tooltip and the name read aloud, in the editor's words (the shell's i18n: the name of the motion is in it).
   * `open` = its menu is open in the editor page (the button looks pressed). `press` = its key (A / 5) or ⌘K in the
   * editor page: the bridge answers placement/motion-press with the button's place, as for a press on it.
   */
  | { type: 'studio:placement/motion'; show: boolean; has: boolean; label: string; open?: boolean; press?: boolean; off?: boolean }
  /** Space is held in the shell: a drag in the game looks around even with a tool chosen. */
  | { type: 'studio:placement/look'; on: boolean }
  /**
   * The fly keys held in the editor page (W A S D E Q, nothing picked or Space+E / Q; camera-wasd 2026-10-18), all of
   * them each time one goes down or up — [] stops. The bridge moves the camera every frame while any is held (it
   * reads the same keys itself while the game frame has focus). `fast`: Shift.
   */
  | { type: 'studio:core/fly'; keys: FlyKey[]; fast: boolean }
  /**
   * Close the strip's choices (turn axis / size mode): a press anywhere in the editor page, or Escape there,
   * while they are open (tool options, 2026-10-18: "click outside or Esc closes it", also outside the game frame).
   */
  | { type: 'studio:placement/menu'; open: false }
  | { type: 'studio:tool/activate'; id: string | null }
  | { type: 'studio:tool/restore'; id: string; data: unknown }
  /** Ask for the data of tools with unsaved changes (answered by tool/data). */
  | { type: 'studio:tool/collect' }
  | { type: 'studio:tool/saved'; ids: string[] }
  /**
   * Switch what the editor moves (UI stage 1): the bridge drops the pick, swaps the adapter under the same input,
   * and answers with core/ready (`layer`) and the layer's placement/items. Only sent when core/ready listed `layers`.
   */
  | { type: 'studio:core/layer'; layer: EditLayer }
  /**
   * UI stages 2–3 (2026-10-22, CONTRACT.md §1.11; only when core/ready listed `layers`): show one screen of the game's UI
   * (`id` null = as the game shows it); a sample text in an element (null = its own); change a prop (null = the game's
   * own value; `state` = that look's colour); show a button's look; change a theme variable (null = the game's own);
   * ask for an element's props. The bridge answers ui/screens, ui/props, ui/theme. `quiet`: a value the file already holds, given again when
   * editing starts (no ui/props back). Nothing here is the game's code:
   * all of it goes at the end of editing, except `set` and `theme`, which stay as the editor's layout does.
   */
  | { type: 'studio:ui/screen'; id: string | null }
  | { type: 'studio:ui/sample'; key: string; text: string | null }
  | { type: 'studio:ui/set'; key: string; name: UiPropName; value: string | number | null; state?: UiState; quiet?: boolean }
  | { type: 'studio:ui/state'; key: string | null; state: UiState | null }
  | { type: 'studio:ui/theme-set'; name: string; value: string | null; quiet?: boolean }
  | { type: 'studio:ui/props-get'; key: string }
  /**
   * While the world is edited, the game's UI (data-studio-key) is hidden — off the picture and out of the pointer's
   * way — unless `on` (the shell's eye button / ⇧U, a try of the editor, 2026-10-20: "the UI is always there, in the way"). On: shown
   * faded, still not in the pointer's way. Only the editing look: nothing is saved and the game's code is untouched.
   * Only sent when core/ready listed `layers`; the bridge starts with `on` false.
   */
  | { type: 'studio:core/ui-peek'; on: boolean }
  /**
   * ▶ Play and back in the same page (fast switch, 2026-10-22; a try of the editor: "every time I play and go back to edit it loads
   * again — tedious"). Before, Play and Edit each opened the game page again (`?studio=edit` or not), and the edit page
   * took seconds (the adapter, the list, the pictures). Now (bridge/play-switch.ts):
   *   - `on: true`: the edit page becomes Play — the editor puts its tools away (as core/edit off: the game's own
   *     camera and HUD, no handles), the game's frames, clock and sound go on from the edit layout, and the page says
   *     play/hello as a Play page does (ask while playing, pause, move while paused). `motion`: the editor's draft
   *     motions (placement.json `motion`, world part), played from their start as a Play page's loader would, and
   *     `motions` the Library's (placement.json `motions`, for the clips' `use`). Every `when` runs when the game's
   *     loader has its play hook (core/ready `motionHere`, studio-no-reload 2026-10-22).
   *   - `on: false`: the game is held (frames, clock, sound), every object goes back to where Play found it (what the
   *     game moved while playing is not kept: Edit shows the layout), and the editor is up again on `viewState` (the
   *     edit camera): core/ready `editing: true` and the list follow, as on a page that just opened.
   * Only sent to a page whose editor is up. "Play from the start" (⌘K, Play's ▾) still opens a new page, for a game
   * whose score, enemies or timers should start again.
   */
  | { type: 'studio:core/play'; on: boolean; motion?: Record<string, unknown>; motions?: unknown[]; viewState?: unknown }
  /**
   * Ask while playing (§3.5): the editor answers the bridge's play/hello when an AI is behind the host (never in the
   * offline web demo, where nothing is shown). `words`: the overlay's strings in the person's language (the bridge
   * has no strings of its own). `mark: false` (a phone, Ive review 3 ④, 2026-10-20): the editor shows the way in
   * itself (✦ in its top bar, left of Edit) and the game page draws its corner mark only in full screen; sent again
   * when the editor's layout changes. Absent = true.
   */
  | { type: 'studio:play/on'; lang: Lang; words: Record<string, string>; mark?: boolean;
      /**
       * Pause-move (2026-10-22, bridge/play-move.ts): what the editor gives its own editor in Edit, for the one that
       * wakes in the paused game — the game rules (.studio/studio.json: what is locked) and the strip's button size.
       */
      config?: GameConfig | null; handlePx?: number }
  /** The editor's ✦ was pressed (phone): open the field over the game, as ` or the corner mark do. */
  | { type: 'studio:play/open' }
  /** What the AI is doing about the play request, for the small line over the game (shell/play-ask.ts playLine). */
  | { type: 'studio:play/state'; state: PlayLine | null }
  /**
   * Pause while playing (2026-10-22): the editor's ❚❚ was pressed (phone, where the game page draws no corner): pause,
   * or resume when paused — the same as P or the corner's ❚❚.
   */
  | { type: 'studio:play/pause' }
  /**
   * The request was kept (`ok`) or not, so the field can close or say it failed. `id`: the kept request's id (the
   * chat over a paused game names its first one in the messages after it, `chat`).
   */
  | { type: 'studio:play/sent'; ok: boolean; id?: string };

/**
 * The one line over the game while playing (§3.5). `state`: looking = sent, the AI has it; fixing = it works on it;
 * asking = it has a question (`choices` as buttons); fixed / failed = its reply (`text`), `reload` = the game's
 * files changed since this game was opened, so Reload shows the fix; kept = nothing can reach the AI right now.
 */
export interface PlayLine {
  state: 'looking' | 'fixing' | 'asking' | 'fixed' | 'failed' | 'kept';
  text: string;
  /** What the person asked, small under the line. */
  asked?: string;
  /**
   * "More in Claude" / "More in Codex" / "More in your AI" (2026-10-21), already in the person's language: the end of
   * the small row, as on the editor's AI line (shell/ai-flow.ts moreIn decides when). Absent = no words.
   */
  more?: string;
  choices?: string[];
  reload?: boolean;
}

/** One line of the game's console the bridge kept for a play request (§3.5). */
export interface PlayLog {
  level: 'error' | 'warn' | 'log';
  text: string;
  /** Seconds before the request was sent (0.0 = at that moment). */
  ago: number;
}

/** bridge -> shell */
export type BridgeToShell =
  /** The edit script is loaded; adapter may still be null while waiting. */
  | { type: 'studio:core/hello'; contract: number }
  /** Waiting for the first frame / an adapter. `reason` explains a dead end. */
  | { type: 'studio:core/wait'; reason?: 'no-adapter' | 'no-frame' | 'no-objects' }
  /** `rise`: the edit camera can go up / down (3D, adapter view.rise): the editor page lists Camera up / down in ⌘K.
   *  `fly`: it can fly with WASD (adapter view.fly): the editor page sends studio:core/fly for those keys. */
  | { type: 'studio:core/ready'; kind: AdapterKind; dim: Dim; version?: string; editing: boolean; rise?: boolean; fly?: boolean;
      /** `drop`: the adapter can drop to floor (snap to surfaces, adapter drop): End / ⌘K / the menu offer it. */
      drop?: boolean;
      /**
       * `motionHere` (studio-no-reload, 2026-10-22): the game's loader (studio-placement.js with its play hook) runs the
       * draft's motions in this page on core/play — every `when`, the game's playMotion() / cue() included. Absent (no
       * loader, or an older copy): a draft whose clips wait for something opens a new Play page, as before.
       */
      motionHere?: boolean;
      /**
       * UI stage 1: the layers this game has, only when it has a UI (an element marked data-studio-key) — absent,
       * the editor is exactly as before (no switch, no `ui` in placement.json). `layer`: the one being edited now;
       * kind / dim / rise / fly are that layer's adapter's (the UI is 'dom-ui', '2d').
       */
      layers?: EditLayer[]; layer?: EditLayer }
  /**
   * The game's code motions and code layouts (studio-code-base, 2026-10-24; the loader's codeMotion() / codePlace()
   * lists in the game's page), sent with every list of the world's objects: the shell names them, `--do motion.code` /
   * `place.code` find them, and a knob the AI wrote into the code (the file's v = the code's v) is taken out of the file.
   */
  | { type: 'studio:code-motions'; list: CodeMotionInfo[] }
  | { type: 'studio:code-places'; list: CodePlaceInfo[]; avoids: CodeAvoidInfo[] }
  | { type: 'studio:core/view-state'; state: unknown }
  /**
   * A pick from the list (or the like) is under the open timeline plate (studio-fix-0143, ⑨ B, a review of 2026-10-24):
   * the shell folds the plate to its one line, then sends view 'reveal' for `key` — the view slides only if the
   * object's middle is still covered, keeping every size (Inset.plate).
   */
  | { type: 'studio:core/plate-fold'; key: string }
  | { type: 'studio:core/check'; result: SelfCheckResult }
  /** A key pressed while the game iframe has focus (so shortcuts work everywhere). */
  | { type: 'studio:core/key'; key: string; code: string; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }
  | { type: 'studio:core/error'; message: string }
  /** The game's own page threw (an uncaught error or rejection), edit or Play; the first few per page load. */
  | { type: 'studio:core/game-error'; message: string; where?: string }
  /**
   * Levels (2026-10-22, CONTRACT.md §1.10): the game called studio.levels(list) — the levels its code has, in its
   * order — and `current` = the one this page built (an editor-made level: its own id, not the one it was built from).
   * Sent once per game page; a game that never calls studio.levels() never sends it (no level switch, as before).
   */
  | { type: 'studio:core/levels'; levels: LevelInfo[]; current: string }
  /** `layer`: whose objects these are (UI stage 1; absent = the world, as before). */
  | { type: 'studio:placement/items'; items: Item[]; layer?: EditLayer }
  /** UI stage 2: the game's screens and the one on screen (null = none of them is drawn). Sent when editing starts and after ui/screen. */
  | { type: 'studio:ui/screens'; screens: UiScreenInfo[]; current: string | null; forced: boolean }
  /** UI stages 2–3: the picked UI element's props (after a UI pick, ui/props-get, ui/set, ui/state, ui/sample). */
  | { type: 'studio:ui/props'; props: UiProps }
  /** UI stage 3: the game's theme variables (when editing starts and after ui/theme-set); [] = none. */
  | { type: 'studio:ui/theme'; vars: UiThemeVar[] }
  | { type: 'studio:placement/selected'; key: string | null; item?: Item; keys?: string[] }
  /**
   * A pose changed by direct manipulation. One gesture ("one move" = from
   * press to release, or one long-press repeat run) sends many `moved`; only
   * the last has `end: true` and `from` = the pose before the gesture.
   * The shell records exactly one undo step per `end`.
   */
  /** `set` (studio-timeline): the answer to the shell's own placement/pose (undo, a typed number), not a hand's move. */
  /**
   * `alone` (studio-to-coords, 2026-10-24): ⌥ (Ctrl) was held — for a rule layout's object, "just this one by hand" (its
   * pin). Without it a rule's object never leaves its rule: the shell puts it back and says why.
   */
  | { type: 'studio:placement/moved'; key: string; pose: Pose; end?: boolean; from?: Pose; press?: 'move' | 'rotate' | 'lift' | 'scale'; hold?: boolean; set?: boolean; alone?: boolean }
  /**
   * Several objects moved together (a selection of more than one). Same rules
   * as `moved`: only the last message of a gesture has `end: true`, and then
   * every entry carries `from`. The shell records ONE undo step for all.
   */
  | { type: 'studio:placement/moved-group'; poses: Array<{ key: string; pose: Pose; from?: Pose }>; end?: boolean; press?: 'move' | 'rotate' | 'lift' | 'scale'; hold?: boolean; alone?: boolean }
  /**
   * A point of the timeline's path was dragged in the game (studio-timeline): position key `i` of the picked object's
   * clip is now `v` (an offset from its place). `end` false while the finger is down, true once at the release (one
   * undo step for the whole drag).
   */
  | { type: 'studio:timeline/point'; key: string; i: number; v: number[]; end: boolean }
  /**
   * studio-code-knobs (2026-10-24): the ◇ of a rule motion's path dragged — its `drag` knob turned to `v` (live, then
   * `end`); one undo step in the shell.
   */
  | { type: 'studio:timeline/code-knob'; name: string; knob: string; v: number; end: boolean }
  /** The answer to studio:timeline/code-points: the rule motion's shape as position keys (null: it could not run). */
  | { type: 'studio:timeline/code-points'; id: number; keys: MotionKey[] | null }
  /**
   * A code layout's objects moved by its rule in place (studio-code-knobs; studio:place/layout or a drag that turns a
   * knob): where they stand now. Not the person's moves — the editor keeps them as the code's places.
   */
  | { type: 'studio:place/poses'; poses: Array<{ key: string; pose: Pose }> }
  /**
   * A drag of a code layout's object turned its `drag` knob (studio-code-knobs, decision 11 of the plan): `v` live, then
   * `end` (one undo step and one Save count in the shell). `key` = the object dragged. `knobs` (studio-to-coords): every
   * knob the drag turned (Move turns `along` and `side` together) — one undo step for all of them.
   */
  | { type: 'studio:place/knob'; id: string; knob: string; v: number; end: boolean; key: string; knobs?: Record<string, number> }
  /**
   * studio-code-keepout: a keep-out box of layout `id` drawn (i = -1, a new one), moved or resized (i = its place in
   * the file's list) in the game: live, then `end` (one undo step in the shell). The game page has laid the layout out
   * again meanwhile (its objects step out of the box); `out` (at the end) = how many moved; `cancel` = Esc: as before.
   */
  | { type: 'studio:place/avoid-box'; id: string; i: number; p: number[]; size: number[]; end: boolean; out?: number; cancel?: boolean }
  /** studio-code-keepout: the ◇ on a keep-out condition's edge dragged: its knob `knob` turned to `v` (live, then `end`). */
  | { type: 'studio:place/avoid-knob'; id: string; code: string; knob: string; v: number; end: boolean }
  /** studio-code-keepout: the objects of layout `id` put by hand that stand in one of its keep-out areas ([] = none). */
  | { type: 'studio:place/avoid-inside'; id: string; keys: string[] }
  /** studio-code-keepout: "+ Draw a box" stopped in the game (Esc there) before a box was drawn. */
  | { type: 'studio:place/avoid-draw'; id: string; on: false }
  /**
   * A drag that tried to move a rule layout's object a way its rule has no knob for (studio-to-coords, 2026-10-24; the
   * CRYSTAL FIELD try: a lamp dragged away from the road did nothing and said nothing). Nothing moved; the shell says
   * why once the drag ends, with ✦ to ask for that knob. `way`: side / along (Move, a row), move (Move, no knob for
   * it), up / turn / size (Height / Turn / Size), group (several picked: a rule's objects stay where the rule puts them).
   */
  | { type: 'studio:place/held'; id: string; key: string; way: PlaceWay }
  /**
   * studio-offsets (2026-10-24): a drag of a rule's object a way its code has no knob for shifts the whole rule — layout
   * `id`'s `offsets` live, then `end` (one undo step and one Save count in the shell, like place/knob). `key` = the
   * object dragged.
   */
  | { type: 'studio:place/offsets'; id: string; key: string; offsets: PlaceOffset[]; end: boolean }
  /**
   * studio-offsets: a drag of a rule's object ended (after its place/knob or place/offsets end): what the shell needs for
   * the four choices under it (All the same / Zigzag / Ramp / Just this one, decision 1). `way` the drag went; `d` how
   * far the dragged object went that way, in the offset's own number (m, °, a size factor; `move`: [x, z]); `rank` /
   * `row` its place in the rule's frame (row false: not a row — only All the same and Just this one); `did` what the
   * drag did live (the knob, or the offset row it turned); `pose` where the object stands now (Just this one pins it
   * there); `skipped` = how many more objects a keep-out area left out because of it.
   */
  | { type: 'studio:place/dragged'; id: string; key: string; way: OffsetWay; d: number | [number, number]; rank: number; row: boolean;
      did: 'knob' | OffsetHow; knob?: string; pose: Pose; skipped?: number }
  /** studio-motion-triggers: the area's middle dragged in the game (world [x, y, z]); `end` = the drag ended. `size` (studio-timeline-2): a corner dragged — the area's new size (and middle). */
  | { type: 'studio:timeline/area-moved'; key: string; p: number[]; end: boolean; size?: number[] }
  /**
   * studio-timeline-2 (2026-10-22): a handle of a path point dragged in the game — position key `i`'s `in` or `out` is
   * now `h` (an offset from the point); `alone` (Alt): the other handle keeps its own direction (else it lines up).
   */
  | { type: 'studio:timeline/handle'; key: string; i: number; side: 'in' | 'out'; h: number[]; alone: boolean; end: boolean }
  /** studio-timeline-2: the path's line clicked at `t` seconds of the clip: a position key there (the shape kept). */
  | { type: 'studio:timeline/insert'; key: string; t: number }
  /** studio-timeline-2: a point of the path double-clicked: a corner, or smooth again. */
  | { type: 'studio:timeline/corner'; key: string; i: number }
  /** Answer to placement/copy: the copies made (with their poses) and the keys that could not be copied. */
  | { type: 'studio:placement/added'; items: Array<{ key: string; from: string; pose: Pose; ghost?: boolean }>; failed: string[] }
  /** `size`: the side asked for (placement/thumbs), so the editor can tell a Library tile's picture from a list row's. */
  | { type: 'studio:placement/thumb'; key: string; src: string | null; size?: number }
  /** The strip's chosen tool changed (a strip button, a key in the game, Escape). */
  | { type: 'studio:placement/tool'; tool: StripTool | null }
  /** The strip's choices (the ▾ on turn / size) opened or closed: the editor page closes them on a press or Escape. */
  | { type: 'studio:placement/menu'; open: boolean }
  /**
   * A right-click (Mac: also Control-click) or a long press (touch, UI.longPressMs) on the game while editing: the
   * editor page opens its menu for that place (shell/context-menu.ts). `key` = the object under the pointer (null =
   * nothing, or only the ground / background); when it was not picked yet, the bridge picked it first — without
   * moving the camera — and sent `placement/selected` before this. `x` / `y` = the point in the game page's own px.
   */
  | { type: 'studio:placement/context'; key: string | null; x: number; y: number; touch: boolean }
  /**
   * The strip's Motion button pressed (or its keys, A / 5, while the game page has focus): the editor opens the pick's
   * motion on the timeline, or, with none yet, its small menu (new from a template / from the Library) at the button.
   * `x` `y` `w` `h` = the button in the game page's own px (0 × 0 for a key: the menu opens under the strip's place);
   * `touch` = a finger (the menu goes above it).
   */
  | { type: 'studio:placement/motion-press'; key: string; x: number; y: number; w: number; h: number; touch: boolean; keyboard: boolean }
  /** Answer to placement/at: the object at that point (null = nothing there). */
  | { type: 'studio:placement/at-is'; id: number; key: string | null }
  | { type: 'studio:library/assets'; loads: LoadEntry[]; uses: Record<string, AssetRef[]> }
  | { type: 'studio:library/previewed'; url: string; ok: boolean }
  /** Game tools registered by .studio/tools.js. */
  | { type: 'studio:tool/list'; tools: GameToolInfo[] }
  | { type: 'studio:tool/state'; id: string; dirty: number; active: boolean }
  | { type: 'studio:tool/data'; items: Array<{ id: string; data: unknown }> }
  /** ▶ Play: the bridge can take a request while the game runs (§3.5); the editor answers play/on when an AI can get it. */
  | { type: 'studio:play/hello' }
  /**
   * The person asked while playing: their words and the moment, as the bridge saw it. `shot` = a JPEG data URL of the
   * game's canvas (≤ 1024 px wide), `view` = the player's camera (3D, adapter player()), `near` = what is near it
   * (3D: nearest in front of the camera; 2D: on screen, nearest the middle; `screen` = where in the picture, 0–1),
   * `logs` = the game's console errors / warnings and its last lines, `fullscreen` = the game was in full screen.
   * Since 2026-10-20 the picture has the game's HTML UI in it too (bridge/play-shot.ts), not only the canvas.
   */
  | { type: 'studio:play/ask'; text: string; shot?: string; view?: { eye: [number, number, number]; target: [number, number, number] };
      near?: PlayNear[]; logs?: PlayLog[]; fullscreen?: boolean; size?: [number, number];
      /** Pause (2026-10-22): from the chat over a paused game (StudioRequestInput `paused` / `chat` / `history`). */
      paused?: boolean; chat?: string; history?: ChatLine[] }
  /** The game was paused (P, ❚❚) or resumed: the editor's ❚❚ (phone) shows which. */
  | { type: 'studio:play/paused'; on: boolean }
  /** The person's answer to the AI's question, from the line over the game. */
  | { type: 'studio:play/answer'; text: string }
  /** Reload pressed over the game: open the game again (its new code), still playing. */
  | { type: 'studio:play/reload' };

/** One turn of the chat over a paused game, as a request carries the talk so far (pause, 2026-10-22). */
export interface ChatLine {
  who: 'you' | 'ai';
  text: string;
}

/** Something near the player when they asked while playing (§3.5). */
export interface PlayNear {
  key: string;
  label?: string;
  pose?: Pose;
  /** 3D: metres (world units) from the player's camera. */
  d?: number;
  /** Where it is in the picture (0–1 from the top left), when the adapter can tell. */
  screen?: [number, number];
}

export type StudioMessage = ShellToBridge | BridgeToShell;

export function isStudioMessage(x: unknown): x is StudioMessage {
  return !!x && typeof x === 'object' && typeof (x as { type?: unknown }).type === 'string'
    && (x as { type: string }).type.startsWith(MSG_PREFIX);
}

// ---------------------------------------------------------------------------
// Promise 3: the host (where the game lives: local folder now, cloud later)
// ---------------------------------------------------------------------------

export type AssetType = 'image' | 'model' | 'sound' | 'atlas' | 'font' | 'other';

export interface AssetFile {
  /** Folder-relative path with forward slashes, e.g. "assets/tree.png". */
  path: string;
  size: number;
  type: AssetType;
  /** Code files (folder-relative) whose text mentions this file name. */
  refsInCode: string[];
}

/** Names of a referenced file that does not exist ("missing" badge). */
export interface MissingRef {
  path: string;
  refsInCode: string[];
}

/**
 * Hand-offs to the user's AI. The first four are the KUMODeck menu;
 * 'delete-files' is the Library's "Delete" on unused files (the editor never
 * deletes: the AI checks with the creator first, then deletes).
 */
export type NextStepId = 'publish' | 'multiplayer' | 'save-data' | 'ai-assets' | 'delete-files';
/** "Things to ask your AI" that stay inside this game: fit the editor to it, change its look, add a tool. */
export type AiStepId = 'fit' | 'look' | 'tool';

// ---------------------------------------------------------------------------
// Hand-offs to the AI (CONTRACT.md §3.4). One-way from the editor: the person
// talks to the AI in the AI's own window, never in the editor. Every request
// is kept as a record first (local: .studio/requests/<id>.json); the agent
// reads them all when the person says "look", and writes one status back
// (local: .studio/status.json). Normalised by src/schema/handoff.mjs.
// ---------------------------------------------------------------------------

export type StudioRequestKind = 'ask' | 'name' | 'next-step' | 'saved' | 'answer' | 'play';

export interface RequestObject {
  key: string;
  label?: string;
  /** The pose in the editor at the time of the request (may not be saved yet). */
  pose?: Pose;
  unstable?: boolean;
  /**
   * The asset files this object is drawn with (folder paths, the Library's "Asset" row), when the editor knows them
   * ("use the Library", 2026-10-18): "make this enemy the boss" then tells the AI which model the boss is.
   */
  files?: string[];
}

/** What the shell hands to host.request(). */
export interface StudioRequestInput {
  /**
   * ask = the person's words about objects; name = "give these a name"; next-step = a next-steps page item;
   * answer = the person's answer to the AI's `asking` question (a choice button or their own words, 2026-10-19);
   * play = asked while playing (▶ Play, §3.5: the words plus the moment — a picture, the player's camera, what was
   * near, the console), so the AI fixes the game without the person stopping.
   */
  kind: 'ask' | 'name' | 'next-step' | 'answer' | 'play';
  /** "answer": the request the question was about (the status's `request`). */
  to?: string;
  /** "answer": the question it answers (the status's `note`), so the record reads alone. */
  question?: string;
  /** The person's words (any language), one line, ≤ 500 characters. */
  text: string;
  /** "ask": the picked objects; empty or left out = about the whole game (nothing picked). "name": at least one. */
  objects?: RequestObject[];
  step?: NextStepId | AiStepId;
  lang: Lang;
  dim?: Dim;
  /** Changes in the editor that are not saved yet (the AI may want them saved first). */
  unsaved?: number;
  /**
   * step "delete-files" only: the unused files the person checked in the Library (≤ 200, plain
   * files inside the game folder). The AI asks the creator before deleting; the editor deletes nothing.
   */
  files?: string[];
  /**
   * "ask" / "play", 3D only ("play": the player's own camera, adapter player()): where the person's camera stood (`eye`) and what it looked at (`target`), in world units, when
   * they asked. The editor opens on the game's own camera, so this is usually the player's view too. WHY
   * (agent-solid pass 2026-10-17): a real Claude Code run put all three lighthouses it was asked for outside the
   * picture, saw it only in its game shot, and spent another minute moving them. With the view in the request it
   * can put new things where the person is looking from the start.
   */
  view?: { eye: [number, number, number]; target: [number, number, number] };
  /**
   * "ask" only: asset files picked in the Library that the words are about (folder paths, ≤ 50; "use the Library",
   * 2026-10-18). With "Add this to the scene" it asks for a new object made from the file, put where `view` looks;
   * otherwise the file is what "this" means ("use this sound when the door opens").
   */
  assets?: string[];
  /**
   * "ask" only (studio-motion-triggers, 2026-10-22): motions picked in the Library that the words are about ("make this
   * crate do this Hop when the player walks up"): each with its length and what it is on now (`on`: object keys and
   * their `when`). The AI wires the moment in the game's code (playMotion(key, name) works for any Library motion).
   */
  motions?: RequestMotion[];
  /**
   * "ask" only (studio-code-keepout, 2026-10-24): the rule layouts the words are about — the card's "✦ Describe with
   * text" under Keep-out areas puts the layout here with its areas as they are now (`avoid`: boxes and conditions, on or
   * off), so "not within 5 m of the player" reaches the AI with the layout's id: it writes a codeAvoid() and adds it
   * with `--do place.avoid`.
   */
  places?: RequestPlace[];
  /**
   * "ask" only: what the words are for, when a button said so. 'avoid' = a keep-out area for `places` (studio-code-keepout).
   * 'to-code' (studio-code-torule, 2026-10-24; the plan's need 3: "turn what I placed / moved by hand into a formula") =
   * the words came from ✦ Turn into a rule — the AI writes the nearest rule for these hand-placed objects (`objects`,
   * with where each stands now) or this motion of points (`motions`, with its `keys`) and puts it in their place itself
   * (`--do place.code --replace` / `motion.code --replace`); the editor measures how close it came. When no rule comes
   * close (half the object's size; a tenth of the path's), it replaces nothing and says so in one line. Absent =
   * whatever the words say.
   */
  intent?: RequestIntent;
  /**
   * UI stage 1: 'ui' when the objects are the game's HTML UI (data-studio-key elements, picked in the UI layer), so
   * the AI changes that element's HTML / CSS, not a world object. Absent = the world, as before.
   */
  layer?: 'ui';
  /**
   * "play" only (§3.5): the game's picture at that moment, a JPEG / PNG data URL (≤ 1.5 MB). The host keeps it as a
   * file and the stored request names that file instead (local: `.studio/play/<id>.jpg`).
   */
  shot?: string;
  /** "play" only: the game's console (errors and warnings first-class, plus the last few lines), oldest first. */
  logs?: PlayLog[];
  /** "play" only: what was near the player (see PlayNear). */
  near?: PlayNear[];
  /** "play" only: the game was in full screen; `size` = the game page's size in CSS px. */
  fullscreen?: boolean;
  size?: [number, number];
  /**
   * "play" only (pause, 2026-10-22): the person PAUSED the game and is talking to the AI about the moment it stopped
   * at, in a small chat over it. The first message carries the moment (`shot`, `view`, `near`, `logs`); each next one
   * carries `chat` = the first one's id and `history` = the talk so far (≤ 12 turns, oldest first). The host keeps the
   * whole talk as one file (local: `.studio/chat/<chat>.json`); the AI's replies are its status notes as usual.
   */
  paused?: boolean;
  chat?: string;
  history?: ChatLine[];
}

/**
 * What an ask is for, when a button set it (StudioRequestInput.intent). 'to-knob' (studio-writeback, 2026-10-24; the
 * card's / the four choices' ✦ Write into the rule): the layout in `places` with `way` — the AI writes that way's offsets
 * into the rule's own numbers (a knob in the game's words: "From the road"), names it in `drag`, and sends `place.code
 * --fold <way>`; the offset row becomes that knob on the card.
 */
export type RequestIntent = 'avoid' | 'to-code' | 'to-knob';
/** A rule layout named in an ask (StudioRequestInput.places): its id and name, its knobs now, its keep-out areas. */
export interface RequestPlace {
  id: string;
  name: string;
  /** How many objects it puts now. */
  n: number;
  knobs?: Record<string, number>;
  avoid: Array<{ box: { p: number[]; size: number[] }; name?: string; off?: true } | { code: string; name?: string; knobs?: Record<string, number>; off?: true }>;
  /** `intent: 'to-knob'` only (studio-writeback): the way to write into the rule. */
  way?: OffsetWay;
  /** `intent: 'to-knob'` only: the layout's offsets as they are now (that way's and the others'). */
  offsets?: PlaceOffset[];
  /** `intent: 'to-knob'` only: each object's row and rank in the offsets' frame and what the offsets add now. */
  objects?: Array<{ key: string; line?: number; rank?: number; offset?: number[] }>;
}

/** A Library motion named in an ask (StudioRequestInput.motions). */
export interface RequestMotion {
  name: string;
  len: number;
  repeat?: MotionRepeat;
  /** The objects it is on now and when each starts. */
  on: Array<{ key: string; when?: MotionWhen; until?: MotionUntil }>;
  /**
   * `intent: 'to-code'` only (studio-code-torule): its position points (offsets from where the object stands, as
   * placement.json keeps them), so the AI fits a rule to the shape the person made — saved or not.
   */
  keys?: { p: MotionKey[] };
}

/** A stored request (.studio/requests/<id>.json). `saved` records are written by the host on every save. */
export interface StudioRequest extends Omit<StudioRequestInput, 'kind' | 'lang'> {
  version: 1;
  /** Sortable by time: "20261016-153012-482-ask-9f3c" (UTC). Also the file name stem. */
  id: string;
  kind: StudioRequestKind;
  /** ISO time, from the host's clock. */
  at: string;
  lang?: Lang;
  /** Files this request is about (placement.json, .studio/next-step.md, ...). */
  files?: string[];
}

/**
 * `asking` (dogfood 2026-10-17, U2): the agent asked the person something in its own window and waits for the
 * answer; `note` is the question. Without it the editor kept saying "Your AI has it" for minutes while the AI waited.
 */
export type AiState = 'received' | 'working' | 'asking' | 'done' | 'failed';

/** What the agent writes back (local: .studio/status.json). Only the latest status is kept. */
export interface StudioStatus {
  version: 1;
  state: AiState;
  /** Latest request id it handled or is handling. */
  request?: string;
  handled?: string[];
  /** How many things it changed in the game (shown as "done (3)"). */
  changed?: number;
  /** One short line for the person, in their language. */
  note?: string;
  /**
   * `asking` only (2026-10-19): up to 4 short answers the editor shows as buttons under the question ("Undo it",
   * "Keep it"); pressing one sends it back as an `answer` request. The ask field answers in the person's own words.
   */
  choices?: string[];
  /** `asking` only: the objects the question is about (keys); the editor lights them in the scene. */
  about?: string[];
  /** `asking` only: what the question would change, one short line each, shown side by side ("On the road" → "16 m up"). */
  before?: string;
  after?: string;
  at?: string;
}

/**
 * What the host knows about the AI's watch when it keeps a request (AI feel,
 * 2026-10-16). `watching`: an AI's watch is running right now (local:
 * `studio.mjs --watch` keeps .studio/watch.json fresh), so the editor can say
 * at once whether anyone will see the request. `undo`: the host kept the game
 * files as they were, so "Undo AI change" can go back to this request.
 * Left out = unknown (then the editor falls back to waiting for a status).
 */
/** The AI behind the editor, when the host can tell (src/server/which-ai.mjs). */
export type AiAgent = 'claude' | 'codex';

export interface AiWatchInfo {
  watching?: boolean;
  seen?: string;
  undo?: boolean;
}

export interface StudioHost {
  /** Where to load the game. gameUrl already carries the edit flag. */
  open(): Promise<{ gameUrl: string; origin: string; title?: string }>;
  /** Last saved result, or null when there is none yet. */
  load(tool: ToolId): Promise<object | null>;
  /**
   * Validate and write the result file. Never touches game code. The host
   * also keeps the save as a `saved` request (§3.4) and returns its id —
   * unless `handoff: false`: the editor writes every change as a draft as
   * it goes (since 2026-10-16, so closing the tab loses nothing) and hands
   * the layout to the AI only when the person presses Save; the draft writes
   * keep no request and print no stdout line, so a watching AI is not woken
   * by every drag.
   */
  save(tool: ToolId, json: object, opts?: { handoff?: boolean }): Promise<{ ok: boolean; error?: string; request?: string; at?: number } & AiWatchInfo>;
  listAssets(): Promise<{ files: AssetFile[]; missing: MissingRef[] }>;
  /** URL the shell can use to show an asset (thumbnail, audio preview). */
  assetUrl(path: string): string;
  /** Add a new file under assets/. Never overwrites: a free name is chosen. */
  addAsset(file: File): Promise<{ path: string }>;
  /**
   * Hand a "next step" (KUMODeck publish, multiplayer, ...) to the user's AI
   * agent. The local host prints one line to stdout and writes
   * .studio/next-step.md; it never contacts any service itself.
   */
  nextStep(id: NextStepId, lang: Lang, detail?: { files?: string[] }): Promise<{ ok: boolean; prompt: string }>;
  /**
   * Hand a request to the user's AI (§3.4): store it first (local:
   * .studio/requests/<id>.json, plus one `studio: request …` line), so it is
   * there whether or not the agent is watching. Every editor → AI hand-off
   * goes through here (or save()); the shell never assumes local files.
   */
  request(r: StudioRequestInput): Promise<{ ok: boolean; id?: string; at?: number; error?: string } & AiWatchInfo>;
  /**
   * The agent's latest status (local: .studio/status.json) and when it was
   * written (ms, host clock; null when there is none). Polled by the shell.
   * Plus (AI feel, 2026-10-16) whether an AI is watching right now and the
   * game files' signature `code`: the shell reloads the game by itself when
   * it changes. Hosts that cannot tell leave them out.
   * `agent` (2026-10-21): which AI is behind the editor, for the AI line's "More in Claude" / "More in Codex"
   * (local: src/server/which-ai.mjs). Left out = unknown: the line says "More in your AI".
   */
  status(): Promise<{ status: StudioStatus | null; time: number | null; watching?: boolean; seen?: string; code?: string; agent?: AiAgent }>;
  /**
   * "Undo AI change" (optional): put the game's files back as they were when
   * request `to` was made (the host keeps a snapshot of the game's files
   * with every request). The answer's `redo` is the id of the snapshot of
   * the files as they were just before: undo `{ to: redo, redo: true }` puts
   * the AI's change back. The host tells the AI with an `undone` request.
   * Left out = no Undo button (the web demo has no code to change).
   */
  undoAi?(to: string, opts?: { redo?: boolean }): Promise<{ ok: boolean; error?: string; restored?: number; removed?: number; redo?: string | null }>;
  /**
   * The AI's hands (studio-ai-hands, 2026-10-24; CONTRACT.md §3.6, optional): `studio.mjs <game> --do …` hands the open
   * editor a job — editor work the AI does itself instead of asking the person (take a motion off, make one from
   * points, move, rename, add a level, Save). The shell does it with its own edits (shell/ai-hands.ts) and the promise's
   * answer goes back to the AI. The local host keeps an event stream open (src/server/hands-relay.mjs): it reaches a
   * hidden tab at once. Returns the way to stop listening. Left out (the web demo: no AI) = no jobs.
   */
  hands?(onJob: (job: { id: string; ops: unknown; by?: 'claude' | 'codex' }) => Promise<unknown>): () => void;
  /**
   * Pass the adapter self-check to the user's AI. Local host: one stdout line
   * ("studio: check failed: …") and .studio/check.md with what to fix.
   */
  reportCheck(result: SelfCheckResult): Promise<void>;
  /** .studio/ui.json (null when missing). The shell normalises it. */
  loadUi(): Promise<unknown>;
  saveUi(prefs: UiPrefs): Promise<{ ok: boolean; error?: string }>;
  /** .studio/studio.json, the game's settings written by the AI (null when missing or invalid JSON). */
  loadConfig(): Promise<GameConfig | null>;
  /** .studio/data/<id>.json of a game tool. */
  loadData(id: string): Promise<unknown>;
  saveData(id: string, data: unknown): Promise<{ ok: boolean; error?: string }>;
  /** URLs of the AI's rewrite of the editor look (.studio/ui/studio.css and shell.js). */
  customUi(): { css: string; js: string };
  /**
   * The link that opens this same editor in another window, pass included (the side window's "Open large",
   * a try on 2026-10-19: "hard to use from the sidebar"). The local server trades its pass for a cookie of THIS browser,
   * so a plain location.href opened in the person's own browser (another cookie jar) only got "Missing pass".
   * Left out (the web demo: no pass) = location.href.
   */
  largeLink?(): Promise<string | null>;
  /**
   * true when no AI is behind this host (the browser-only web demo,
   * src/hosts/browser): request() still keeps the request, but nobody picks
   * it up, so the shell never nudges "say 'look' to your AI" and keeps the
   * whole request text on screen. Left out (the local server) = an AI may be
   * watching.
   */
  readonly offline?: boolean;
  /**
   * Optional KUMODeck sign-in for making pictures and 3D models with AI, paid
   * from the creator's KUMODeck balance (2026-10-16). Only the local server has
   * it (src/server/kumo.mjs reads the KUMODeck CLI's sign-in and calls
   * KUMODeck itself: the key never reaches the page). Left out = the Assets
   * page shows no "Make with AI" (the web demo, other hosts).
   */
  readonly kumo?: KumoHost;
}

/** The person's KUMODeck sign-in as the editor sees it (never a key). */
export interface KumoStatus {
  signedIn: boolean;
  /** The command that signs in (`npx kumodeck login`). */
  loginCommand: string;
  /** true when a saved sign-in has run out. */
  expired?: boolean;
  email?: string;
  server?: string;
  /** Prepaid balance in cents. */
  balanceCents?: number;
  currency?: string;
  /** The KUMODeck dashboard, where the balance is topped up. */
  topUpUrl?: string | null;
  /** The KUMODeck project the new files belong to (kumo.json, or picked). */
  project?: { id: string; name: string } | null;
  /** true when kumo.json in the folder names the project. */
  fromFolder?: boolean;
  /** When no project is chosen yet: the account's projects to pick from. */
  projects?: Array<{ id: string; name: string }>;
  /** 3D models started in this run. */
  jobs?: KumoJob[];
  /**
   * What was made in this game folder, newest first (.studio/generated.json, src/server/generated.mjs; generate-ui
   * 2026-10-22): the editor's "Made here", whose Again / Change put one back in the form.
   */
  made?: KumoMade[];
  error?: { code: string; message: string };
}

/** The kinds "Make with AI" makes (generate-ui, 2026-10-22: sound effects, music and voice lines joined images and 3D). */
export type KumoKind = 'picture' | 'model' | 'sfx' | 'music' | 'voice';

/** One line of the history (.studio/generated.json). */
export interface KumoMade {
  id: string;
  /** ISO time it landed. */
  at: string;
  kind: KumoKind;
  /** The words it was made from (a voice line: the words it says). */
  prompt: string;
  /** What was chosen: picture { side, quality }, model { texture }, sfx { durationSec }, music { durationSec, loop }, voice { voice }. */
  options: Record<string, string | number | boolean>;
  /** assets/… */
  path: string;
  costUsdMicros: number | null;
}

export interface KumoJob {
  id: string;
  prompt: string;
  status: string;
  /** assets/… once the model is in the folder. */
  path: string | null;
  costUsdMicros: number | null;
  error?: { code: string; message: string };
}

/**
 * A KUMODeck refusal, in a code the editor words itself: signed_out,
 * needs_terms (agree once, then send again with acceptTerms), not_enough
 * (balance), not_open / not_allowed (not available to this account yet),
 * no_project, too_many, unreachable, failed …
 */
export interface KumoRefusal {
  ok: false;
  code: string;
  message: string;
  balanceCents?: number;
  needCents?: number;
}

export interface KumoPictureRequest {
  prompt: string;
  width?: number;
  height?: number;
  quality?: 'standard' | 'high';
  tiling?: 'none' | 'both' | 'horizontal' | 'vertical';
  format?: 'jpeg' | 'png';
  name?: string;
  /** true only after the person ticked "I agree" in the editor. */
  acceptTerms?: boolean;
}

export interface KumoModelRequest {
  prompt: string;
  texture?: boolean;
  acceptTerms?: boolean;
}

/** One sound (generate-ui, 2026-10-22): KUMODeck's audio route, made within the request like a picture. */
export interface KumoSoundRequest {
  kind: 'sfx' | 'music' | 'voice';
  /** What it should sound like; for a voice line, the words it says (at most 500 characters). */
  prompt: string;
  /** sfx 0.5–10 s, music 5–120 s. */
  durationSec?: number;
  /** Music only: made to loop (default true). */
  loop?: boolean;
  /** Voice only: neutral, bright, deep, warm or energetic. */
  voice?: string;
  acceptTerms?: boolean;
}

export interface KumoHost {
  status(): Promise<KumoStatus>;
  pickProject(id: string): Promise<KumoStatus | KumoRefusal>;
  makePicture(r: KumoPictureRequest): Promise<{ ok: true; path: string; costUsdMicros: number | null; balanceCents: number | null } | KumoRefusal>;
  /** Starts a 3D model; then job(id) until it has a path or failed. */
  makeModel(r: KumoModelRequest): Promise<({ ok: true } & KumoJob) | KumoRefusal>;
  job(id: string): Promise<({ ok: true } & KumoJob) | KumoRefusal>;
  /** One sound into assets/. Absent (an older host) = the editor offers images and 3D only. */
  makeSound?(r: KumoSoundRequest): Promise<{ ok: true; path: string; costUsdMicros: number | null; balanceCents: number | null } | KumoRefusal>;
}

// ---------------------------------------------------------------------------
// The editor's look, rewritten by the AI (CONTRACT.md §8)
// ---------------------------------------------------------------------------

/** Named regions of the shell (also `data-part` attributes in the page). */
export type ShellPart =
  | 'app' | 'stage' | 'side' | 'header' | 'brand' | 'tabs' | 'tools' | 'top-actions'
  | 'status' | 'ai' | 'panel' | 'footer' | 'bar'
  // Since the 2026-10-16 rebrand: the floating card, the ask bar's field, the bar
  // at the bottom of the game (news + card on phones + ⌘K list + ask), the ⌘K
  // list, and the Assets page.
  | 'card' | 'ask' | 'dock' | 'palette' | 'assets-page';

/** Things that can be hidden with studioShell.hide() (and UiPrefs.show). */
export type ShellShowKey = keyof UiPrefs['show'];

/**
 * `window.studioShell` in the shell page, for `.studio/ui/shell.js`.
 * It can change how the editor looks and add buttons that call editor
 * actions. It cannot reach the game page, the save format or the files: the
 * protected part (bridge messages, handles, validation) stays as it is.
 */
export interface StudioShellApi {
  version: number;
  /** The shell's regions, for moving or restyling them. */
  part(name: ShellPart): HTMLElement;
  /** Add a button. `where` = a region with buttons. Returns the element. */
  addButton(b: { id: string; label: string; where?: 'top-actions' | 'footer' | 'bar' | 'tools'; title?: string; onClick: () => void }): HTMLButtonElement;
  hide(what: ShellShowKey): void;
  show(what: ShellShowKey): void;
  prefs(): UiPrefs;
  /** Change preferences (also saved to .studio/ui/prefs.json). */
  setPrefs(patch: Partial<UiPrefs>): void;
  /** Add or replace UI text (any key of the built-in strings, or your own). */
  setText(lang: Lang, strings: Record<string, string>): void;
  t(key: string): string;
  lang(): Lang;
  items(): Item[];
  /** The name the editor shows for an object (an unnamed one's is guessed from its look, src/shell/names.ts). */
  nameOf(key: string): string;
  selected(): string | null;
  actions: {
    undo(): void;
    redo(): void;
    save(): Promise<void>;
    select(key: string | null): void;
    switchTool(id: ToolId): void;
    frameAll(): void;
    openSettings(): void;
    openNextSteps(): void;
    activateTool(id: string | null): void;
    /** Copy / delete the selection (CONTRACT.md §1.8). */
    copy(): void;
    remove(): void;
    /** Select several objects at once (`primary` = the one the card shows). */
    selectMany(keys: string[], primary?: string): void;
  };
  /** 'selected' | 'items' | 'moved' | 'saved' — returns an unsubscribe function. */
  on(event: 'selected' | 'items' | 'moved' | 'saved', cb: (detail: unknown) => void): () => void;
}

// ---------------------------------------------------------------------------
// Promise 4: result files (validated by src/schema, the single validator)
// ---------------------------------------------------------------------------

export const RESULT_FILES: Record<ToolId, string> = {
  placement: 'placement.json',
  library: 'library.json',
};

export interface PlacementEntry extends Pose {
  /** Pose before the first edit: lets the AI search the code for the literal numbers. */
  was?: Pose;
  label?: string;
  unstable?: boolean;
}

export interface PlacementFile {
  version: 1;
  tool: 'placement';
  dim: Dim;
  space: 'local';
  objects: Record<string, PlacementEntry>;
  /**
   * Optional: copies the person made (CONTRACT.md §1.8), in the order they
   * were made (a copy of a copy comes after its original). The AI adds each
   * one to the code under `key`, copied from the object `from`.
   */
  added?: PlacementAdded[];
  /** Optional: objects the person deleted; the AI takes them out of the code. Sorted by key. */
  removed?: PlacementRemoved[];
  /**
   * 2D, optional: draw orders the person changed. One entry per sibling list
   * (`in` = Item.layer), `keys` back → front (first = drawn first), `was` =
   * the order the game itself draws. Only lists whose order differs from
   * `was` are written.
   */
  order?: PlacementOrder[];
  /**
   * Optional (UI stage 1, 2026-10-19): the game's HTML UI moved / resized in the editor's UI layer, by the element's
   * data-studio-key. Absent when nothing was moved — and always for a game without data-studio-key, so its file is
   * byte for byte what it was. `dim` above stays the world's; UI is always screen CSS px.
   */
  ui?: Record<string, PlacementUiEntry>;
  /** With `ui`: the game's size [width, height] in CSS px when it was saved (for turning px into % / vw). */
  uiView?: [number, number];
  /**
   * Optional (UI stage 3, 2026-10-22): CSS variables of the game's theme (--accent, --font-title…) changed in the
   * editor, by name. Absent when none changed: older files keep their bytes.
   */
  theme?: Record<string, PlacementThemeEntry>;
  /**
   * Optional (motion-gui, 2026-10-22): objects that move by themselves, by key (a game object or a copy in `added`;
   * never a key of `removed`). Absent when nothing moves, so older files stay byte for byte what they were. With
   * `levels`, each level has its own `motion` (PlacementLevel) and this one is absent (integrate3, 2026-10-22).
   */
  motion?: Record<string, Motion>;
  /**
   * Optional (studio-motion-triggers, 2026-10-22): the Library's motions, named, each a clip without "when" (len /
   * repeat / keys). Objects use them by name (`motion.<key>.clips[].use`). Always at the top, also with `levels`: a
   * motion is an asset any level's object can use. Absent when there is none.
   */
  motions?: LibraryMotion[];
  /**
   * Optional (levels, 2026-10-22, CONTRACT.md §4.1): a game with several levels. Each level holds its own world part
   * (`objects` / `added` / `removed` / `order` / `motion`, the same shapes as above); the list's order is the person's.
   * With `levels`, the top `objects` is {} and the top has no added / removed / order / motion. Absent for a game with one level —
   * its file is byte for byte what it was.
   */
  levels?: PlacementLevel[];
  /**
   * Optional (studio-uniforms, 2026-10-23, CONTRACT.md §4.1): names the person gave objects in the editor (Rename, F2 —
   * done in place, not asked of the AI), object key → name. The AI renames each object in the code (its key / name)
   * and takes the entry out. With `levels`, each level has its own and this one is absent. Absent = nothing renamed.
   */
  names?: Record<string, string>;
  /**
   * Optional (studio-code-base, 2026-10-24, CONTRACT.md §1.12): what the person changed of the game's code layouts
   * (codePlace), by layout id. With `levels`, each level has its own. Absent = nothing changed (the code places them).
   */
  places?: Record<string, PlacementPlace>;
  /** With `levels`, only when they differ from the code: the code's level ids in the code's order (a missing one = deleted). */
  levelsWas?: string[];
}

/** One level's part of placement.json (CONTRACT.md §4.1). */
export interface PlacementLevel {
  id: string;
  label?: string;
  /** Renamed in the editor: the name the code gives it (for the AI to find). */
  labelWas?: string;
  /** Made in the editor (the code does not have it yet): the code's level it was copied from, which the game builds. */
  from?: string;
  /**
   * Made with New level (studio-blank-level, 2026-10-23; only with `from`): an empty level — only the ground, sky and
   * lights stay. Its `removed` lists what the person saw go; build it in the code as a level of its own without them.
   */
  blank?: true;
  objects?: Record<string, PlacementEntry>;
  added?: PlacementAdded[];
  removed?: PlacementRemoved[];
  order?: PlacementOrder[];
  /** This level's motions (motion-gui × levels, integrate3 2026-10-22): keys are this level's objects. */
  motion?: Record<string, Motion>;
  /** Names the person gave this level's objects (Rename; see PlacementFile.names). */
  names?: Record<string, string>;
  /** This level's changes to the code layouts (see PlacementFile.places). */
  places?: Record<string, PlacementPlace>;
}

/**
 * How an object moves by itself (CONTRACT.md §4.1 `motion`). Since the timeline (studio-timeline, 2026-10-22): its
 * `clips`, named motions made of keys. The older shape (motion-gui, v0.1.13: `path` / `speed` / `repeat` / `spin`) is
 * still read — the editor turns it into one clip when it opens the file, the loader plays it as it was — and never
 * written by the editor again. The loader runs both (src/loader/studio-placement.js clipAt / motionAt), the editor
 * previews them with the same maths.
 */
export interface Motion {
  /** The object's named motions (1–16), each name once. */
  clips?: MotionClip[];
  /** v0.1.13: the points it goes through, as offsets from the object's place. The start is not written. 1–32 points. */
  path?: number[][];
  /** v0.1.13: along the path, metres (3D) / px (2D) per second. */
  speed?: number;
  /** v0.1.13: pingpong = there and back (default), loop, once. */
  repeat?: MotionRepeat;
  /** v0.1.13: turning round the up axis, radians per second. */
  spin?: number;
}

/**
 * One named motion of an object (studio-timeline, 2026-10-22): the keys of its position / angle / size over time,
 * as offsets from the object's place (so moving the object carries its motion along).
 */
export interface MotionClip {
  /** "Open", "Spin": what the person and the AI call it (unique within the object). */
  name: string;
  /** Seconds (0.1–600): where a loop starts again, where a pingpong turns, where a once ends. */
  len: number;
  /** once (default: stays on its last pose), loop, pingpong (there and back). */
  repeat?: MotionRepeat;
  /**
   * studio-timeline's shape (still read): true = plays as soon as the game starts. Since studio-motion-triggers
   * (2026-10-22) the editor writes `when: { on: 'start' }` instead and never writes `start`.
   */
  start?: boolean;
  /**
   * When it starts (studio-motion-triggers, CONTRACT.md §4.1 "When a motion plays"). A string is studio-timeline's
   * shape (the person's words for the AI), read as `{ on: 'say', say }`. Absent on a clip with `use` = the game starts.
   * A list (studio-timeline-2, 2026-10-22: "E or a click"): 2–4 of them, any one starts it. One is never a list.
   */
  when?: MotionWhen | MotionWhen[] | string;
  /** When it stops (absent = never: a once clip ends on its last pose, a loop / pingpong goes on). */
  until?: MotionUntil;
  /** Switched off on the timeline (studio-code-base, 2026-10-24): it stays on the object and does not play. */
  off?: true;
  /**
   * The Library motion this clip is (studio-motion-triggers): its len / repeat / keys come from `motions` in the file.
   * In the file a clip with `use` has no len / repeat / keys of its own; inside the editor they are filled in from the
   * Library (timeline-wire.ts reads and writes the two together).
   */
  use?: string;
  /**
   * Inside the editor and the loader only, never in the file (studio-timeline-2): the clip's Library motion is a scene
   * motion (`tracks`), and `keys` are this object's track of it.
   */
  scene?: boolean;
  keys: MotionKeys;
}

/**
 * When an object's motion starts (studio-motion-triggers, 2026-10-22). The loader runs `start`, `time`, `key`, `click`,
 * `after` and `enter` (when it can find `who`) by itself; `touch`, `cue` and `say` need the game's code (the AI adds
 * touch(key) / cue(name) / playMotion(key, name) where it happens).
 */
export type MotionWhen =
  | { on: 'start' }
  | { on: 'time'; after: number }
  | { on: 'key'; key: string }
  | { on: 'click' }
  | { on: 'after'; use: string; key?: string }
  | { on: 'enter'; area: MotionArea; who?: string }
  | { on: 'touch' }
  | { on: 'cue'; cue: string }
  | { on: 'say'; say?: string };
export type MotionTrigger = MotionWhen['on'];
/** A box in the world: its middle `p` and its size (3D [x, y, z] / [w, h, d] m; 2D [x, y] / [w, h] px). */
export interface MotionArea {
  p: number[];
  size: number[];
}
/** When a motion stops: after `times` rounds, or when a named cue comes; `then` = stay where it is (default) or go back to its first pose. */
export interface MotionUntil {
  times?: number;
  cue?: string;
  then?: 'stay' | 'reset';
}

/** A motion in the Library (studio-motion-triggers): placement.json's top `motions`. A clip without "when". */
export interface LibraryMotion {
  name: string;
  len: number;
  repeat?: MotionRepeat;
  /** One object's keys. Empty ({}) in the editor for a scene motion; the file leaves it out then. */
  keys: MotionKeys;
  /**
   * A scene motion (studio-timeline-2, 2026-10-22: "several objects in one motion", a cutscene): keys per object key
   * (1–16 objects) instead of `keys`. Every object in it is attached with the same `when` / `until`; the loader starts
   * them all at the same moment when any one of them starts (and playMotion(anyOfThem, name) plays the whole scene).
   */
  tracks?: Record<string, MotionKeys>;
  /**
   * The rows' order on the timeline (studio-ui-lead2, 2026-10-23: "I want to set the order myself"): the tracks' object
   * keys, each once, as the person arranged them (dragged by the row's grip). Only with `tracks`. Absent = the tracks'
   * keys as written (the file sorts object keys, so that is alphabetical). The loader ignores it.
   */
  order?: string[];
  /**
   * A code motion (studio-code-base, 2026-10-24; CONTRACT.md §1.9.4): the id of a codeMotion() in the game's code — its
   * shape lives there. The file then has no len / repeat / keys (in the editor `len` is the strip's width, `keys` {}).
   */
  code?: string;
  /** A code motion's knobs the person turned: v = now, was = the code's number (where the AI writes v on Save). */
  knobs?: Record<string, KnobValue>;
}

/** A knob the person turned (code motions, code layouts, keep-out conditions): v now, was = the number in the code. */
export interface KnobValue {
  v: number;
  was?: number;
}

/**
 * What the person changed of one code layout (codePlace in the game's code; CONTRACT.md §1.12, §4.1 `places`). Every
 * field optional; an entry with none is not written.
 */
export interface PlacementPlace {
  knobs?: Record<string, KnobValue>;
  /** "Just this one" put by hand, over the formula: the layout's own keys ("hex-3") → a pose. */
  pins?: Record<string, { p: number[]; r?: number; s?: number | number[]; t?: [number, number] }>;
  /** Placed by hand: every object is a pin (the AI writes the formula out as a list of places on Save). */
  hand?: true;
  /** Keep-out areas of this layout, in order: a box drawn by hand, or a codeAvoid() condition; either may be off. */
  avoid?: PlacementAvoid[];
  /** The hand-placed objects this layout replaced (✦ To code): hidden until the AI takes them out of the code. */
  from?: string[];
  /**
   * Offsets (studio-offsets, 2026-10-24): a drag of one of its objects the code has no knob for, kept as a rule — which
   * way, how and how much — over at(), before the keep-out areas and the pins; ≤ 8. Until Save writes them into the code.
   */
  offsets?: PlaceOffset[];
}
/**
 * One offset of a rule layout (CONTRACT.md §1.12 "Offsets"). `way`: along / side (a row's: along it, away from the middle
 * line of its two rows), up, turn (°; mirrored on the second row), size (× a factor), move (not a row: the ground [x, z],
 * 2D [x, y]). `how`: same (every object v), zigzag (every other: the odd ranks when `odd`, else the even), ramp (v × the
 * rank; size 1 + (v − 1) × rank). `v` = the number the card shows.
 */
export type OffsetWay = 'along' | 'side' | 'up' | 'turn' | 'size' | 'move';
/**
 * 'jitter' (studio-writeback, 2026-10-24; a request that day: "a little, by a fixed random amount"): v × a random number from
 * −1 to 1 per object, the same every load for the row's `seed` (size: 1 + (v − 1) × it; move: x and z each their own).
 * Made from the card's ⋯ (Add jitter), never by a drag.
 */
export type OffsetHow = 'same' | 'zigzag' | 'ramp' | 'jitter';
export type PlaceOffset =
  | { way: Exclude<OffsetWay, 'move'>; how: Exclude<OffsetHow, 'jitter'>; v: number; odd?: true }
  | { way: Exclude<OffsetWay, 'move'>; how: 'jitter'; v: number; seed: number }
  | { way: 'move'; how: 'same'; v: [number, number] }
  | { way: 'move'; how: 'jitter'; v: [number, number]; seed: number };
export type PlacementAvoid =
  | { box: { p: number[]; size: number[] }; name?: string; off?: true }
  | { code: string; knobs?: Record<string, KnobValue>; off?: true };

/**
 * A code motion as the game page lists it (bridge `studio:code-motions`, read from the loader's codeMotion() list):
 * its knobs with the code's numbers, its round with them (seconds; null = it never ends).
 */
export interface CodeMotionInfo {
  code: string;
  name: string;
  knobs: Record<string, CodeKnob>;
  round: number | null;
  note?: string;
  game?: boolean;
  /** The knob a drag of its path's ◇ turns (codeMotion `drag`; studio-code-knobs). */
  drag?: string;
}
/** A rule motion of one object at one moment (studio:timeline/pose `code`): its code id, time and knob values. */
export interface CodeAt {
  key: string;
  code: string;
  t: number;
  knobs: Record<string, number>;
}
/**
 * The ways a person drags a rule layout's object (studio-to-coords, 2026-10-24; codePlace `drag` by way): along / side =
 * Move along the row / away from it, up = Height, turn = Turn, size = Size; move = Move of a layout that is not a row,
 * group = several picked together.
 */
export type PlaceWay = 'along' | 'side' | 'move' | 'up' | 'turn' | 'size' | 'group';
/** A code layout as the game page lists it (`studio:code-places`): the objects it put and its keep-out conditions. */
export interface CodePlaceInfo {
  id: string;
  name: string;
  keys: string[];
  skipped: string[];
  knobs: Record<string, CodeKnob>;
  drag?: string | Record<string, string>;
  /**
   * What its rule looks like (studio-code-knobs; the card's "Layout: Line · 4"): 'line' = the places are on one straight
   * line, 'lines' = on two parallel ones (a road's two sides, studio-offsets), 'scatter' = at() uses its seeded random.
   * Absent = neither (the card says the layout's name).
   */
  kind?: 'line' | 'lines' | 'scatter';
  /**
   * studio-offsets: each number's place in the offsets' frame (index = number − 1; null = none) — its row (0 = number
   * 1's), its rank in that row, the row's along and side on the ground ([x, z]; 2D [x, y]) and `mirror` on the second
   * row (absent all three: not a row), and what its offsets add now ([dx, dy(, dz)]). Absent: not a row and no offsets.
   */
  rows?: Array<{ line: number; rank: number; along?: [number, number]; side?: [number, number]; mirror?: true; offset?: number[] } | null>;
  /** The codeAvoid() ids it names in the code (on unless the file switches them off). */
  avoid: string[];
}
/**
 * ✦ Turn into a rule (studio-code-torule, 2026-10-24): what a code layout's guide draws beside its violet rings until
 * Save — where the hand-placed objects it replaced stood (`was[i]` = the place of the one the rule's number i + 1 took
 * over, as the editor's model had it; null = none) and their names (`names[i]`). The page draws an orange dot each and a
 * thin line to where the rule's object stands NOW (a knob turned moves the line), and over the farthest one the chip
 * "lamp-3 · 0.6 m" — the same measure as the card's "Max deviation" (shell/to-rule.ts), drawn by bridge/code-place.ts.
 */
export interface PlaceCompareMarks {
  was: Array<number[] | null>;
  names: Array<string | null>;
}
/** A keep-out condition as the game page lists it (codeAvoid): its words ("From the player" … "within") and knobs. */
export interface CodeAvoidInfo {
  code: string;
  name: string;
  after?: string;
  knobs: Record<string, CodeKnob>;
  /** It draws its own shape on the ground (codeAvoid `show`). */
  show?: boolean;
}
/** A knob as the code writes it: the code's number and how the editor shows it. */
export interface CodeKnob {
  v: number;
  label: string;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Keys per property, in time order (1–256 each); a property with no keys is left as the game puts it.
 *   p — added to the position ([x, y, z] m in 3D, [x, y] px in 2D)
 *   r — added to the angles in radians ([x, y, z] in 3D: y is the card's Angle, x / z its tilt; [angle] in 2D)
 *   s — multiplying the size ([x, y, z] in 3D, [x, y] in 2D)
 */
export interface MotionKeys {
  p?: MotionKey[];
  r?: MotionKey[];
  s?: MotionKey[];
}
export type MotionChannel = keyof MotionKeys;

export interface MotionKey {
  /** Seconds from the clip's start. */
  t: number;
  v: number[];
  /** How this key goes on to the next: linear (the same speed), ease (default: slow start, slow stop), step (jumps at the next key). */
  ease?: MotionEase;
  /**
   * Position keys only (studio-timeline-2, 2026-10-22): the path's handles at this point, as offsets from it (m / px):
   * `in` towards the key before, `out` towards the key after. Absent = smooth (the curve through the points, as
   * before); written once a handle was dragged. Both [0, 0(, 0)] = a corner.
   */
  in?: number[];
  out?: number[];
}
export type MotionEase = 'linear' | 'ease' | 'step';
export type MotionRepeat = 'pingpong' | 'loop' | 'once';

export interface PlacementUiEntry {
  /** [dx, dy] CSS px from where the game's own CSS puts the element (the CSS `translate` it gets). [0, -48] = 48 px up. */
  p: [number, number];
  /** CSS `scale`; absent = 1. */
  s?: number;
  /** The element's text (first 40 characters): a clue for finding it in the code. */
  label?: string;
  /** UI stage 2: the screen it belongs to (its container's data-studio-screen); absent = always on screen. */
  screen?: string;
  /** UI stage 3: what the card changed (text, size, colours; a button's state colours under "@hover" …). */
  set?: UiStyleSet;
  /** With `set`: the game's own values of the same fields (what the AI looks for in the code). */
  setWas?: UiStyleSet;
}

/** placement.json `theme` (UI stage 3): one CSS variable of the game's theme, changed in the editor. */
export interface PlacementThemeEntry {
  /** The new value. */
  v: string;
  /** The game's own value (what the AI looks for in the CSS). */
  was?: string;
}

export interface PlacementAdded extends Pose {
  /** Key of the new object (give it this name / studioKey in the code). */
  key: string;
  /** Key of the object it is a copy of (another entry of `added`, or a game object). */
  from: string;
  label?: string;
}

export interface PlacementRemoved {
  key: string;
  label?: string;
  /** The pose the game itself gives the object, to find it in the code. */
  was?: Pose;
  unstable?: boolean;
}

export interface PlacementOrder {
  in: string;
  keys: string[];
  was?: string[];
}

export interface LibraryFile {
  version: 1;
  tool: 'library';
  replace: Array<{ from: string; to: string; usedBy?: string[] }>;
  added: Array<{ file: string; place?: { key: string; p: number[]; r?: number; s?: number } }>;
  unused: string[];
}

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/**
 * Signatures implemented by src/schema (one validator shared by the server,
 * the shell and later the cloud). `value` is the normalised file: numbers
 * rounded, keys sorted, unknown fields dropped.
 */
export interface SchemaModule {
  validatePlacement(json: unknown): ValidateResult<PlacementFile>;
  validateLibrary(json: unknown): ValidateResult<LibraryFile>;
  /** Stable JSON text: sorted keys, 2-space indent, trailing newline. */
  stringifyResult(file: PlacementFile | LibraryFile): string;
}

// ---------------------------------------------------------------------------
// Shell tools (how a tool such as the library plugs into the shell)
// ---------------------------------------------------------------------------

/**
 * A tool owns one panel of the shell (right column on PC, the sheet above the
 * bottom bar on phones) and one result file. The shell owns everything shared:
 * the game frame, selection, undo/redo for placement, save, language, the
 * "next step" menu.
 */
export interface ShellTool {
  id: ToolId;
  label: Record<Lang, string>;
  /** Render into `el` (empty, owned by the tool until unmount). */
  mount(el: HTMLElement, ctx: ShellContext): void;
  unmount(): void;
  /** Number of unsaved changes, shown on the Save button. */
  dirty(): number;
  /** The result file to save, or null when there is nothing to save. */
  result(): object | null;
  /** Called after a successful save of this tool's file. */
  saved(): void;
  /** Saved file (or null) loaded at start-up, before mount. */
  restore?(json: object | null): void;
}

/**
 * The objects as the Library shows them (ShellContext.objects, "one Library" 2026-10-18). The shell owns the
 * objects and the selection; the Library owns its page (search, the All / Objects / Files filter, the grid, the
 * detail on the right) and asks this for the objects' part of each. Names are untrusted text: the elements are
 * built with textContent only.
 */
export interface LibraryObjects {
  /** Every object in the game (counted under "3D" or "2D" in the Library's filters, by dim()). */
  count(): number;
  /**
   * Whether the game's objects are 3D or 2D: the Library's one row of filters (All / 3D / 2D / Sound / Other, a review
   * 2026-10-18) puts them under that one. Replaced the objects' own filters (Unnamed, Duplicates, made from a file /
   * drawn in code), which went with the old four groups.
   */
  dim(): Dim;
  /** Only the objects that use this file (a file's "Show just these objects"); null = all. */
  showFile(path: string | null): void;
  /** "planks.jpg · used by 3 ×" while narrowed to one file's objects, else null. */
  band(): HTMLElement | null;
  /** The tiles for this search and filter (one per kind group, "pine ×3") and how many objects they hold. */
  tiles(q: string): { tiles: HTMLElement[]; n: number };
  /**
   * Optional (studio-fix-0146, 2026-10-24): the game's objects that are not in the level on screen (a New level hides
   * everything but the ground), as tiles the Library puts under their own heading ("Not in this level · n"): a press
   * or a drop on the Scene row puts one in this level. Shells without levels leave it out.
   */
  absentTiles?(q: string): { tiles: HTMLElement[]; n: number };
  /** The picked objects' detail and which ones they are (to tell a new pick), or null with nothing picked. */
  detail(): { el: HTMLElement; key: string } | null;
  /** Pick one object here (a name in a file's detail), without leaving the Library or moving the camera. */
  select(key: string): void;
  /** Drop the pick (a file was opened: one thing open at a time). */
  clear(): void;
  /** Multi-select / Done, for the Library's bar. */
  multiButton(): HTMLElement;
  /**
   * Called right before a press on an object tile picks it: the Library closes the file it had open — unless `add`
   * (Shift, or Multi-select): then the picked files stay picked with the objects ("use the Library", 2026-10-18).
   */
  onPick(fn: (add: boolean) => void): void;
  /** Multi-select is on: a press on a file's tile adds it to the pick too. */
  multi(): boolean;
}

/**
 * The Library's motions (studio-motion-triggers, 2026-10-22; shell/library-motions.ts): the "Motion" filter's tiles and
 * the picked motion's detail. The Library (tools/library/panel.ts) puts them in its one grid, like the objects.
 */
export interface LibraryMotions {
  count(): number;
  /** The tiles for this search, and how many motions they are. */
  tiles(q: string): { tiles: HTMLElement[]; n: number };
  /** The picked motion's detail (and a key that changes with it), or null with none picked. */
  detail(): { el: HTMLElement; key: string } | null;
  /** Drop the pick (a file or an object was opened alone). */
  clear(): void;
  /** Called right before a press on a motion's tile picks it (`add`: Shift / Multi-select keeps the other picks). */
  onPick(fn: (add: boolean) => void): void;
  /** studio-motion-flow: the Motion filter's "+ New motion" tile (null = none here). */
  newTile?(): HTMLElement | null;
}

export interface ShellContext {
  host: StudioHost;
  lang: Lang;
  /** Translate a shell string key (falls back to English, then to the key). */
  t(key: string): string;
  /** Send to the game iframe (no-op until the bridge said hello). */
  send(msg: ShellToBridge): void;
  /** Listen to bridge messages of one type; returns an unsubscribe function. */
  on<T extends BridgeToShell['type']>(type: T, cb: (msg: Extract<BridgeToShell, { type: T }>) => void): () => void;
  /** Latest placement list from the adapter. */
  items(): Item[];
  /** Switch to the placement tool and select an object there. */
  selectObject(key: string): void;
  /**
   * Optional (added 2026-10-16, older shells leave it out): switch to the
   * placement tool and select several objects at once, e.g. every object
   * that uses one asset file.
   */
  selectObjects?(keys: string[]): void;
  /**
   * Optional (added 2026-10-18, the Objects shelf): show the objects as a grid instead of the game — `file` = only
   * the objects that use this asset file, `key` = with this object selected there. Shells without it leave it out
   * (tools then select in the game with selectObject / selectObjects). The shell of "one Library" (same day, later)
   * gives `objects` instead and leaves this out: the Library then does both itself, without leaving its page.
   */
  showObjects?(o: { file?: string; key?: string }): void;
  /**
   * Optional (added 2026-10-18, "one Library"): the objects placed in the game, for the Library to show next to the
   * files in ONE grid (a try of the editor: "put objects and files in one library; the left has Scene and Library"). Shells
   * without it leave it out and the Library lists files only, as before.
   */
  objects?: LibraryObjects;
  /** Optional (studio-motion-triggers, 2026-10-22): the Library's motions, shown under the "Motion" filter and in All. */
  motions?: LibraryMotions;
  switchTool(id: ToolId): void;
  /** Tell the shell that dirty() changed (re-renders the Save button). */
  changed(): void;
  /** True on the phone layout. */
  phone(): boolean;
  /**
   * Hand a request to the AI the same way the card and "Ideas for your AI" do
   * (host.request, then the AI line under the bar follows it). Resolves true when kept.
   * Used by the Library's "Ask my AI to delete it".
   */
  ask(r: Omit<StudioRequestInput, 'lang'>): Promise<boolean>;
  /**
   * Optional ("use the Library", 2026-10-18): the Library's files as things to use, not only to look at. Shells
   * without it leave it out (the Library then has no "Add to scene" / "Ask your AI…" on files).
   */
  files?: LibraryFileUse;
}

/** What the Library does with its files through the shell (ShellContext.files). Paths are folder paths. */
export interface LibraryFileUse {
  /**
   * The files picked in the Library changed (a file's detail opened, or several picked with Shift / Multi-select):
   * the ask box's chip names them, so the next words are about them.
   */
  picked(paths: string[]): void;
  /**
   * "Add to scene" on files: a new object can only be made from a file by the AI (it writes the code), so the ask box
   * gets "Add this to the scene" with the files' chip — nothing is sent until Enter. Absent = no AI behind this host
   * (the web demo): the button is dimmed and says why.
   */
  add?(paths: string[]): void;
  /** "Ask your AI…" about files: the cursor in the ask box with their chip. Absent = no AI (the web demo). */
  ask?(paths: string[]): void;
}

// ---------------------------------------------------------------------------
// Limits and constants
// ---------------------------------------------------------------------------

export const LIMITS = {
  maxObjects: 500,
  maxAbs3d: 10_000,
  maxAbs2d: 100_000,
  /** Rounding steps: 1 mm in 3D, 0.1 px in 2D, 1e-4 rad for angles. */
  step3d: 0.001,
  step2d: 0.1,
  stepAngle: 0.0001,
  maxScale: 1000,
  minScale: 0.001,
  maxResultBytes: 64 * 1024,
  maxReplace: 500,
  maxAdded: 200,
  maxUnused: 2000,
  maxAssetBytes: 100 * 1024 * 1024,
  undoSteps: 200,
  /** placement.json `ui` (UI stage 1): elements, |p| in CSS px, and the scale range (src/schema keeps the same values). */
  maxUi: 200,
  maxUiCoord: 10_000,
  minUiScale: 0.1,
  maxUiScale: 10,
  /** UI stage 3: a text on the card, a colour / theme value, the font size range (px), theme variables. */
  maxUiText: 200,
  maxUiColor: 64,
  maxUiValue: 200,
  minUiFont: 1,
  maxUiFont: 500,
  maxTheme: 100,
} as const;

/** Allowed characters of an object key. Names with other characters are mapped; the original stays in `label`. */
export const KEY_RE = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;
/** Keys starting with this prefix are tree paths and unstable. */
export const PATH_KEY_PREFIX = 'path:';
/** Marker names games can set to control discovery. */
export const MARK = {
  /** three: object.userData.studioKey / Pixi: obj.studioKey — the most stable key. */
  key: 'studioKey',
  /** three: object.userData.studioAsset / Pixi: obj.studioAsset — "this object uses that file". */
  asset: 'studioAsset',
  /** `studio: false` (three: userData.studio, Pixi: obj.studio) hides an object and its children. */
  hide: 'studio',
} as const;

/** File extensions the library lists (and the only ones addAsset accepts). */
export const ASSET_EXT: Record<Exclude<AssetType, 'other'>, readonly string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'],
  model: ['glb', 'gltf', 'fbx', 'obj'],
  sound: ['mp3', 'ogg', 'wav', 'm4a'],
  atlas: ['atlas', 'json'],
  font: ['woff2', 'woff', 'ttf', 'otf'],
};
/** Folders never listed or served as assets. */
/** Folder (inside the game folder) for studio files that are not results: adapter.js, check.md, next-step.md. */
export const STUDIO_DIR = '.studio';
export const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', '.studio', '.next', '.vite', '.cache'] as const;

/** UI sizes shared by the bridge (handles) and shell. */
export const UI = {
  /**
   * Handle diameter in CSS px with a mouse (the person can change it on the
   * View page). 48 until the visual pass (2026-10-16): a fingertip size on
   * PC made the handles bigger than the objects (Ive-view review §1). A pro
   * tool's on-canvas controls are 8–28 px; 32 keeps them easy to hit.
   * 28 since the rebrand (2026-10-16): the handles are one tool strip of
   * 28 px buttons under the object, the row height of every other control.
   */
  handlePx: 28,
  /** The smallest strip button on phones: 44 px, the finger target (Apple's minimum). */
  handlePxPhone: 44,
  /** Radius for pickNear on touch vs mouse. A finger covers more than a cursor tip. */
  pickRadiusTouch: 28,
  pickRadiusMouse: 12,
  /** Movement (px) before a press turns into a drag/look-around instead of a tap. */
  tapSlopPx: 8,
  /** Long-press on rotate/scale/lift handles repeats; the whole run is one undo step. */
  holdDelayMs: 350,
  holdRepeatMs: 60,
  /**
   * A press held this long without moving opens choices: the strip's turn / size options (on their button) and the
   * menu of the place pressed (anywhere else on the game, the list's rows, the Library's tiles; context menu,
   * 2026-10-18). One length for both, so a long press feels the same everywhere; they never meet, because the strip's
   * long press is only on its buttons. 450 ms: past a tap (~100–200 ms) and a hesitant press-then-drag, short of
   * iOS's 500 ms callout.
   */
  longPressMs: 450,
  /** Narrower than this = phone layout (bottom bar instead of right column). */
  phoneMaxWidth: 720,
} as const;

/** Localised UI languages. More later; English is the fallback. */
export type Lang = 'en' | 'ja';

/** Paths served by the local host (src/server) — see CONTRACT.md §3.2. */
export const LOCAL_PATHS = {
  /** Shell page. The one-time token arrives as ?t=… on this URL. */
  shell: '/__studio/',
  /** Edit script injected as the first child of <head> in HTML responses (CONTRACT.md §3.2: the pass becomes a cookie). */
  editScript: '/__studio/studio-edit.js',
  api: '/__studio/api/',
  /** AI-written adapter, served from <game>/.studio/adapter.js, injected right after the edit script. */
  gameAdapter: '/__studio/game-adapter.js',
  /** AI-written game tools and rules in code, from <game>/.studio/tools.js, injected after the adapter. */
  gameTools: '/__studio/game-tools.js',
  /** Query flag on the game URL that turns on edit mode. */
  editFlag: 'studio=edit',
  /**
   * Query parameter on the game URL with the shell's origin. The bridge only
   * posts to, and only accepts messages from, window.parent at this origin.
   * Missing = the game's own origin (local host serves both from one origin).
   */
  parentParam: 'studioParent',
  /**
   * Levels (2026-10-22): query parameters on the game URL (edit and ▶ Play) with the level the editor shows and the
   * code's level to build for it; studio.levels() returns them. Absent = the game's first level.
   */
  levelParam: 'studioLevel',
  buildParam: 'studioBuild',
} as const;
