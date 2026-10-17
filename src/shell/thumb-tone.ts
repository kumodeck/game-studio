// "Is this list picture almost white?" (polish pass 2026-10-16, play test stumble 9: a white cloud's picture
// vanished on the light picture tile). The pictures are the objects alone on a see-through background; a light
// one gets a mid-grey tile (shell.css `.thumb[data-tone=light]`) instead of the usual pale one.
//
// WHY measured here and not a fixed darker tile for all: most objects are coloured and read best on the pale tile
// the rest of the editor uses; only the few near-white ones need help.

/** Average lightness (0..1) of the opaque pixels → light above this. 0.8 = white / pale cream / light grey. */
export const LIGHT_AT = 0.8;
const cache = new Map<string, Promise<boolean>>();

/** true when the opaque part of the picture is light. Never rejects (false when it cannot tell). */
export function isLightPicture(src: string): Promise<boolean> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const n = 24;
          const c = document.createElement('canvas');
          c.width = c.height = n;
          const g = c.getContext('2d', { willReadFrequently: true });
          if (!g) return resolve(false);
          g.drawImage(img, 0, 0, n, n);
          const d = g.getImageData(0, 0, n, n).data;
          let sum = 0;
          let count = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3]! < 128) continue;
            sum += (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255;
            count++;
          }
          resolve(count > 8 && sum / count > LIGHT_AT);
        } catch {
          resolve(false);
        }
      };
      img.onerror = () => resolve(false);
      img.src = src;
    });
    if (cache.size > 600) cache.clear();
    cache.set(src, p);
  }
  return p;
}

/** Mark an <img class="thumb"> light or not once its picture is measured. */
export function toneThumb(img: HTMLImageElement, src: string): void {
  void isLightPicture(src).then((light) => {
    if (img.getAttribute('src') !== src) return; // a newer picture came meanwhile
    if (light) img.dataset.tone = 'light';
    else delete img.dataset.tone;
  });
}
