// The object fills its picture (design review wave 1, W1-11 / D2, 2026-10-17): the game's picture of one object (adapter
// capture(), see-through around the object) is cropped to the object's own box, then given a margin of 4 px at the
// 32 px size the card and the list show it at (4 / 32 = 12.5 % of each side).
//
// WHY here and not in each adapter: the adapters frame the object's world box (three.js: its bounding sphere from a
// little above), so a tall, thin object — the lighthouse — came out as a thin stroke in the middle of a square and
// read as the letter "i" on the card (review photo 02). Cropping the finished picture by its see-through pixels works
// the same for every engine, and 2D pictures that are already tight come back nearly unchanged.

/** Margin round the object, as a share of the square's side: 4 px of 32 (the review's number). */
export const FIT_MARGIN = 4 / 32;
/** A pixel counts as the object from this alpha up (soft edges and the faint halo of the black / white trick stay out). */
const ALPHA_MIN = 24;
/** Share of the picture's alpha left out at each side when finding the object's box (see below). 0.01 = 1 %. */
const TRIM = 0.01;
const OUT = 96; // the size the list asks the game for (main.ts placement/thumbs); the Library's tiles ask for more

const cache = new Map<string, Promise<string>>();

/**
 * The picture cropped to its object with the margin, `out` px square; the same picture when it cannot tell (opaque,
 * empty, an error). Never rejects. `out`: the size it was asked for (a Library tile's twice-its-size picture must not
 * come back as 96 px — that blur is what Ive review 3 ⑧ saw).
 */
export function fitPicture(src: string, out = OUT): Promise<string> {
  const id = `${out}|${src}`;
  let p = cache.get(id);
  if (!p) {
    p = new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) return resolve(src);
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d', { willReadFrequently: true });
          if (!g) return resolve(src);
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, w, h).data;
          // The object's box by weight, not by the outermost pixel: the 1 % of alpha at each side is left out. WHY: the
          // lighthouse carries its faint light beam (a wide, nearly clear cone); a plain box round every pixel with
          // some alpha was the beam's box, and the tower stayed a thin stroke in the middle.
          const cols = new Float64Array(w), rows = new Float64Array(h);
          let total = 0, clear = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const a = d[(y * w + x) * 4 + 3]!;
              if (a < ALPHA_MIN) {
                clear++;
                continue;
              }
              cols[x] += a;
              rows[y] += a;
              total += a;
            }
          }
          // Nothing see-through (an opaque picture: its own background) or nothing drawn: leave it as it is.
          if (!total || clear < w * h * 0.02) return resolve(src);
          const span = (sums: Float64Array): [number, number] => {
            let lo = 0, hi = sums.length - 1, acc = 0;
            while (lo < hi && acc + sums[lo]! <= total * TRIM) acc += sums[lo++]!;
            acc = 0;
            while (hi > lo && acc + sums[hi]! <= total * TRIM) acc += sums[hi--]!;
            return [lo, hi];
          };
          const [x0, x1] = span(cols);
          const [y0, y1] = span(rows);
          const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
          const side = Math.max(bw, bh) / (1 - 2 * FIT_MARGIN);
          // Already about this tight (within 2 px of the right size): keep the original pixels.
          if (side >= Math.max(w, h) - 2) return resolve(src);
          const cx = x0 + bw / 2, cy = y0 + bh / 2;
          const o = document.createElement('canvas');
          o.width = o.height = out;
          const og = o.getContext('2d');
          if (!og) return resolve(src);
          og.imageSmoothingQuality = 'high';
          og.drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, out, out);
          resolve(o.toDataURL('image/png'));
        } catch {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
    if (cache.size > 600) cache.clear();
    cache.set(id, p);
  }
  return p;
}
