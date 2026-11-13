// Visual fixes D: circles drawn as pixel art. ctx.arc is anti-aliased and blurs the crisp look,
// so rings (territory, brush preview, the classic era ring) are cached sprites of whole pixels.

/**
 * The pixels of a ring of radius r (px), `width` px thick, as (dx, dy) pairs from its centre,
 * in angle order clockwise from the top, so a dash pattern can walk round it. Closed: a pixel
 * belongs when its distance from the centre lies in (r + 0.5 − width, r + 0.5].
 */
export function circlePixels(r: number, width = 1): Array<[number, number]> {
  const out: Array<[number, number, number]> = [];
  const R = Math.ceil(r) + 1;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      // Render only: Math.atan2 is fine here (rule 4 covers the simulation).
      if (d <= r + 0.5 && d > r + 0.5 - width) out.push([dx, dy, Math.atan2(dx, -dy)]);
    }
  }
  out.sort((a, b) => (a[2] < 0 ? a[2] + 2 * Math.PI : a[2]) - (b[2] < 0 ? b[2] + 2 * Math.PI : b[2]));
  return out.map(([dx, dy]) => [dx, dy]);
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * A ring as a cached sprite, its centre at (size − 1) / 2. `dash` [on, off]: whole pixels shown
 * and skipped along the ring (null: solid).
 */
export function circleSprite(colour: string, r: number, width = 1, dash: readonly [number, number] | null = null): HTMLCanvasElement {
  const ri = Math.max(0, Math.round(r));
  const key = `${colour}|${ri}|${width}|${dash ? dash.join(',') : ''}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 2 * ri + 3;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = colour;
  const px = circlePixels(ri, width);
  px.forEach(([dx, dy], k) => {
    if (dash && k % (dash[0] + dash[1]) >= dash[0]) return;
    ctx.fillRect(ri + 1 + dx, ri + 1 + dy, 1, 1);
  });
  if (cache.size > 256) cache.clear();   // radii vary with the brush and ranges: keep the cache small
  cache.set(key, c);
  return c;
}

/** Draws a ring centred on map point (cx, cy), snapped to whole pixels. */
export function drawPixelCircle(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colour: string,
  width = 1, dash: readonly [number, number] | null = null,
): void {
  const img = circleSprite(colour, r, width, dash);
  const ri = Math.max(0, Math.round(r));
  ctx.drawImage(img, Math.round(cx) - ri - 1, Math.round(cy) - ri - 1);
}
