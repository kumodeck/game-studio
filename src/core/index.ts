// src/core: shared services inside the game page (time control, load log).
// Installed by the edit script before any game code runs.
import type { CoreContext } from '../contract.ts';
import { installLoads } from './loads.ts';
import { installTime, type TimeControlImpl, type TimeOptions } from './time.ts';

export interface Core extends CoreContext {
  time: TimeControlImpl;
}

export function installCore(opts: TimeOptions): Core {
  return { time: installTime(opts), loads: installLoads(opts.win) };
}
