// The name a person reads for an object in the list and on the card (polish pass 2026-10-16, play test
// stumble 8: the list showed "No name" with `path:8` next to it, and two rows both called "tree").
//
// WHY here and not in the adapters: the key (`path:6`, `tree#2`) is the editor's and the AI's handle and must not
// change; only what is SHOWN changes. A tree path means nothing to a newcomer, so an object without a name is
// called by what it looks like: the picture file it draws ("rock" for rock.svg) or its kind ("Unnamed shape").
// The key stays in the row's tooltip and in everything sent to the AI.
import type { Item } from '../contract.ts';

/** Kind tags (adapters' Item.kinds) → the i18n word for "an unnamed one of these". */
const KIND_WORD: Record<string, string> = {
  sprite: 'picture', text: 'text', graphics: 'shape', container: 'group', group: 'group', model: 'model',
  box: 'shape', sphere: 'shape', plane: 'shape', cylinder: 'shape', cone: 'shape', mesh: 'shape',
};

/** The file name without folder and extension, when `group` is a picture / model URL or path. */
export function fileStem(group: string | undefined): string | null {
  if (!group || !/\.(png|jpe?g|webp|gif|svg|avif|glb|gltf)(\?|#|$)/i.test(group)) return null;
  const last = group.split(/[?#]/)[0]!.split('/').pop() || '';
  const stem = decodeURIComponentSafe(last).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  return stem || null;
}
function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The shown name.
 * - Named: its label; a second, third… object with the same name (key `tree#2`) reads "tree 2".
 * - Unnamed (`unstable`): the stem of its picture or model file, else "Unnamed <kind>" (`t('noname.kind.<w>')`).
 */
export function displayName(it: Pick<Item, 'key' | 'label' | 'kinds' | 'group' | 'unstable'>, t: (k: string) => string): string {
  if (it.unstable) {
    const stem = fileStem(it.group);
    if (stem) return stem;
    const w = KIND_WORD[(it.kinds || []).find((k) => KIND_WORD[k]) || ''] || 'object';
    return t(`noname.kind.${w}`);
  }
  const m = /^(.*)#(\d+)$/.exec(it.key);
  if (m && m[2] !== '1' && it.label === m[1]) return `${it.label} ${m[2]}`;
  return it.label;
}
