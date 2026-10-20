// Keyboard steps shared by the bridge (keys pressed while the game frame has
// focus) and the shell (keys pressed in the side panel), so both feel the same.
import type { ShellToBridge } from '../contract.ts';

export type StepOp = Omit<Extract<ShellToBridge, { type: 'studio:placement/step' }>, 'type' | 'key' | 'hold'>;

/**
 * Keyboard steps on the selected object. Screen-relative so they feel the
 * same in 2D and 3D: arrows move 10 px on screen (Shift: 1 px), Q/E rotate
 * 15° (Shift: 1°), PageUp/PageDown raise/lower (3D), +/- scale by 10%,
 * End drops onto the surface below (3D; Unreal's End, "snap to floor" — bridge/snap.ts; a Mac laptop: fn + →).
 */
export function keyStep(key: string, shift: boolean, dim: '2d' | '3d'): StepOp | null {
  const px = shift ? 1 : 10;
  const deg = ((shift ? 1 : 15) * Math.PI) / 180;
  switch (key) {
    case 'ArrowLeft':
      return { op: 'move', dx: -px, dy: 0 };
    case 'ArrowRight':
      return { op: 'move', dx: px, dy: 0 };
    case 'ArrowUp':
      return { op: 'move', dx: 0, dy: -px };
    case 'ArrowDown':
      return { op: 'move', dx: 0, dy: px };
    case 'q':
    case 'Q':
      return { op: 'rotate', d: -deg };
    case 'e':
    case 'E':
      return { op: 'rotate', d: deg };
    case 'PageUp':
      return dim === '3d' ? { op: 'lift', d: shift ? 0.01 : 0.1 } : null;
    case 'PageDown':
      return dim === '3d' ? { op: 'lift', d: shift ? -0.01 : -0.1 } : null;
    case 'End':
      return dim === '3d' ? { op: 'drop' } : null;
    case '+':
    case '=':
      return { op: 'scale', d: shift ? 1.01 : 1.1 };
    case '-':
    case '_':
      return { op: 'scale', d: shift ? 1 / 1.01 : 1 / 1.1 };
    default:
      return null;
  }
}
