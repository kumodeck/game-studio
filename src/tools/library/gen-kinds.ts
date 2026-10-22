// The five kinds "Make with AI" makes, as data (generate-ui, 2026-10-22): images, 3D models, sound effects, music and
// voice lines. The form (ai-make.ts) reads everything kind-specific from here — the price before Make, the usual wait,
// the example words, the longest text — so adding a kind is one row here, one in the server (kumo.mjs) and its words
// in strings.ts. Pure functions only: test/generate.test.ts runs them without a page.
//
// Prices are at cost, the same numbers as src/server/kumo.mjs (kumoImagePrice / kumo3dPrice / kumoSoundPrice), which
// copy the KUMODeck server's price table. The server checks again (402), so a price here that drifted would only be
// shown wrong, never charged wrong.

import type { KumoKind, KumoMade, KumoSoundRequest } from '../../contract.ts';
import type { StringKey } from './strings.ts';

export type Kind = KumoKind;
export type PictureQuality = 'standard' | 'high' | 'seamless';

/** In the order of the chips. Image and 3D first: they were the only two before, and people know where they are. */
export const KINDS: readonly Kind[] = ['picture', 'model', 'sfx', 'music', 'voice'];
export const isSound = (k: Kind): k is 'sfx' | 'music' | 'voice' => k === 'sfx' || k === 'music' || k === 'voice';

/** What the form holds. One object for every kind, so switching kinds keeps the words and each kind's choices. */
export interface Form {
  kind: Kind;
  prompt: string;
  quality: PictureQuality;
  side: number;
  texture: boolean;
  /** Sound effect length (s). */
  sfxSec: number;
  /** Music length (s). */
  musicSec: number;
  loop: boolean;
  voice: string;
}

export const DEFAULT_FORM: Form = { kind: 'picture', prompt: '', quality: 'standard', side: 1024, texture: true, sfxSec: 2, musicSec: 30, loop: true, voice: 'neutral' };

/**
 * The lengths offered. Sound effects: 1 s (a click, a coin), 2 s (most effects; the default), 5 s (a door, a short
 * ambience). Music: 15 / 30 / 60 s — the price is the same for any length (Stable Audio 3 Medium is per piece), so
 * 30 s is the default only because a longer loop takes longer to make. KUMODeck takes sfx 0.5–10 s and music 5–120 s.
 */
export const SFX_SECONDS = [1, 2, 5] as const;
export const MUSIC_SECONDS = [15, 30, 60] as const;
/** The voices KUMODeck knows (the server's VOICE_PRESETS; kumo.mjs KUMO_VOICES). */
export const VOICES = ['neutral', 'bright', 'deep', 'warm', 'energetic'] as const;

/** The longest words each kind takes (the server's limits: a voice line is at most 500 characters). */
export const MAX_LEN: Record<Kind, number> = { picture: 1000, model: 1024, sfx: 1000, music: 1000, voice: 500 };

/**
 * How long one usually takes, in seconds, for "usually about …" and "taking longer than usual" (after twice this).
 * picture 20 / model 180: the first real production run (2026-10-17, 18.8 s and 182 s). sfx / voice / music: not run
 * for real yet (that costs money; stage 2) — from the providers' pages, a few seconds for an effect or a line and up
 * to about a minute for music. Change the words in strings.ts (aiUsual*) with these.
 */
export const USUAL_SEC: Record<Kind, number> = { picture: 20, model: 180, sfx: 10, music: 60, voice: 10 };

/** Price of one, in US dollars (see the top of this file). */
export function priceOf(f: Form): number {
  switch (f.kind) {
    case 'picture': {
      const mp = Math.max(1, Math.ceil((f.side * f.side) / (1024 * 1024)));
      if (f.quality === 'seamless') return 0.02 * mp;
      if (f.quality === 'high') return 0.03 + 0.015 * (mp - 1);
      return 0.003 * mp;
    }
    case 'model':
      return f.texture ? 0.2 : 0.1;
    case 'sfx':
      return 0.002 * f.sfxSec;
    case 'music':
      return 0.0376;
    case 'voice':
      return 0.00005 * Math.max(1, f.prompt.trim().length);
  }
}

/** The request for a sound (only for the sound kinds). */
export function soundRequest(f: Form): KumoSoundRequest {
  const prompt = f.prompt.trim();
  if (f.kind === 'sfx') return { kind: 'sfx', prompt, durationSec: f.sfxSec };
  if (f.kind === 'music') return { kind: 'music', prompt, durationSec: f.musicSec, loop: f.loop };
  return { kind: 'voice', prompt, voice: f.voice };
}

/**
 * "Again" / "Change" on a line of the history: the same kind, words and choices back in the form. Choices the line
 * does not have (an older line, a hand-edited file) keep what the form had; values out of range are left out, so the
 * form never offers something KUMODeck refuses. Nothing is sent: the person presses Make, with the price on it.
 */
export function formFrom(m: KumoMade, f: Form): Form {
  const o = m.options || {};
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  const next: Form = { ...f, kind: m.kind, prompt: m.prompt.slice(0, MAX_LEN[m.kind]) };
  if (m.kind === 'picture') {
    next.side = [512, 1024, 2048].includes(o.side as number) ? (o.side as number) : f.side;
    next.quality = o.quality === 'high' || o.quality === 'seamless' || o.quality === 'standard' ? o.quality : f.quality;
  }
  if (m.kind === 'model' && typeof o.texture === 'boolean') next.texture = o.texture;
  if (m.kind === 'sfx') next.sfxSec = num(o.durationSec, 0.5, 10, f.sfxSec);
  if (m.kind === 'music') {
    next.musicSec = num(o.durationSec, 5, 120, f.musicSec);
    if (typeof o.loop === 'boolean') next.loop = o.loop;
  }
  if (m.kind === 'voice' && (VOICES as readonly string[]).includes(o.voice as string)) next.voice = o.voice as string;
  return next;
}

/** Words for each kind (strings.ts). */
export const KIND_WORDS: Record<Kind, { chip: StringKey; ph: StringKey; price: StringKey; usual: StringKey; making: StringKey; examples: readonly StringKey[] }> = {
  picture: { chip: 'kindPicture', ph: 'aiPicturePh', price: 'aiPicturePrice', usual: 'aiUsualPicture', making: 'aiMakingPicture', examples: ['exPicture1', 'exPicture2', 'exPicture3'] },
  model: { chip: 'kindModel', ph: 'aiModelPh', price: 'aiModelPrice', usual: 'aiUsualModel', making: 'aiStartingModel', examples: ['exModel1', 'exModel2', 'exModel3'] },
  sfx: { chip: 'kindSfx', ph: 'aiSfxPh', price: 'aiSfxPrice', usual: 'aiUsualSfx', making: 'aiMakingSound', examples: ['exSfx1', 'exSfx2', 'exSfx3'] },
  music: { chip: 'kindMusic', ph: 'aiMusicPh', price: 'aiMusicPrice', usual: 'aiUsualMusic', making: 'aiMakingMusic', examples: ['exMusic1', 'exMusic2', 'exMusic3'] },
  voice: { chip: 'kindVoice', ph: 'aiVoicePh', price: 'aiVoicePrice', usual: 'aiUsualVoice', making: 'aiMakingVoice', examples: ['exVoice1', 'exVoice2', 'exVoice3'] },
};
