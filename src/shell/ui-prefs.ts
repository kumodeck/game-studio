// UI preferences (.studio/ui.json): where the panel sits, how wide, which
// colours, text and handle sizes, and which parts are shown.
//
// WHY in the game folder (not the browser's storage): the person sets the
// editor up once per project and it stays the same whichever browser or
// port the studio opens on next time; the file is also readable by the AI
// ("make the handles bigger" can be done by editing it).
//
// The file is hand-editable, so everything read from it goes through
// normalizeUi(): unknown fields are dropped and numbers clamped, and a broken
// file falls back to the defaults (which are the original look).
import type { UiPrefs } from '../contract.ts';

export const DEFAULT_UI: UiPrefs = {
  version: 1,
  // Rebrand 2026-10-16: the list is a 248 px column on the left (the reading
  // order of a scene tool: where you are → what is in it → the thing itself).
  // A prefs.json saved earlier keeps what it says ("right", 340).
  panel: 'left',
  width: 248,
  height: 42,
  // 'auto' (was 'dark' until the ive finish, 2026-10-16): light or dark is the
  // device's setting, like every Mac and iPhone app; the editor makes no choice
  // of its own. The View page still offers dark / light for whoever wants one.
  theme: 'auto',
  // 13 (was 14): the PC text sizes are 13 / 11 since the ive finish (12 / 13 / 15 before).
  fontSize: 13,
  // 28 (was 48 until the visual pass, then 32): the tool strip's buttons, see
  // UI.handlePx. Phones never go below UI.handlePxPhone (main.ts handlePx()).
  handleSize: 28,
  // lang: false (2026-10-16 UI/UX review): the language is set once, so it
  // lives on the View page instead of taking a button in the top row. With it
  // gone the PC top row fits on one line. `show.lang: true` brings it back.
  // adapter: false (2026-10-16, AI partner): the top line is the game's name;
  // the engine name and version ("three 186") are for whoever wants them,
  // under View → Show. A prefs.json saved earlier keeps what it says.
  show: { thumbs: true, numbers: true, help: true, adapter: false, play: true, frame: true, lang: false, next: true, tools: true },
};

export const UI_LIMITS = {
  width: [240, 640],
  height: [25, 75],
  fontSize: [12, 20],
  handleSize: [24, 72],
} as const;

const clamp = (v: unknown, [lo, hi]: readonly [number, number], dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : dflt;

export function normalizeUi(raw: unknown): UiPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const show = (r.show && typeof r.show === 'object' ? r.show : {}) as Record<string, unknown>;
  const out: UiPrefs = {
    version: 1,
    panel: r.panel === 'left' || r.panel === 'bottom' || r.panel === 'right' ? r.panel : DEFAULT_UI.panel,
    width: clamp(r.width, UI_LIMITS.width, DEFAULT_UI.width),
    height: clamp(r.height, UI_LIMITS.height, DEFAULT_UI.height),
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto' ? r.theme : DEFAULT_UI.theme,
    fontSize: clamp(r.fontSize, UI_LIMITS.fontSize, DEFAULT_UI.fontSize),
    handleSize: clamp(r.handleSize, UI_LIMITS.handleSize, DEFAULT_UI.handleSize),
    show: { ...DEFAULT_UI.show },
  };
  for (const k of Object.keys(out.show) as Array<keyof UiPrefs['show']>) if (typeof show[k] === 'boolean') out.show[k] = show[k] as boolean;
  if (r.lang === 'en' || r.lang === 'ja') out.lang = r.lang;
  // The first-run intro's step (intro.ts). Kept only as a whole number 0–4.
  if (typeof r.intro === 'number' && Number.isInteger(r.intro) && r.intro >= 0 && r.intro <= 4) out.intro = r.intro;
  return out;
}

/** Resolve 'auto' against the system setting. */
export function effectiveTheme(p: UiPrefs, prefersDark: boolean): 'dark' | 'light' {
  return p.theme === 'auto' ? (prefersDark ? 'dark' : 'light') : p.theme;
}
