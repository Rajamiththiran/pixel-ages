// Cast shadows (docs/diorama-plan/03-shadows.md). Sun from the top-left, everything casts a
// shadow down-right at 0.45 px per px of height (design system readme, "Light"; geometry from the
// mockup renderer docs/mockups/Pixel Ages UI mockups/pixel-scenes.js).
//
// A shadowed pixel c becomes mix(c, mix(shadowOf(c), tint, 0.28), 0.8): exactly the --cast-*
// tokens. That is c × k + b per channel, so the whole shadow mask is applied on the GPU as one
// multiply and one add over whatever is on the ground (terrain, season dots, trampled earth,
// realm wash), with no pixels read back.

import { CONFIG } from '../config';
import { rampsOn, shadowOf, styleOff } from './ramps';
import type { RGB } from './palette';
import type { SpritePixels } from './sprites';

const DD = CONFIG.render.diorama;
const DS = DD.shadows;

/** Phase 3 switches. Occlusion moves along the ramps, so it needs them. */
export const shadowsOn: boolean = DS.on && !styleOff('shadows');
export const contactOn: boolean = DD.contactLines.on && !styleOff('contact');
export const occlusionOn: boolean = rampsOn && DD.forestOcclusion.on && !styleOff('occlusion');

/** The cast colour of c at shadow strength s (0 none … the config strength, full day). */
export function castOf(c: RGB, s: number = DS.strength): RGB {
  const sh = shadowOf(c), t = DS.tint, k = DS.tintMix;
  const out: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const inner = sh[i]! + (t[i]! - sh[i]!) * k;
    out[i] = c[i]! + (inner - c[i]!) * s;
  }
  return out;
}

/** The same as a GPU multiply colour and an add colour, 0–255: castOf(c) = c × mul / 255 + add. */
export function castMultiplyAdd(s: number): { mul: RGB; add: RGB } {
  const m = DD.shadeMul, a = DD.shadeAdd, t = DS.tint, k = DS.tintMix;
  const mul: RGB = [0, 0, 0], add: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    mul[i] = 255 * (1 - s + s * (1 - k) * m[i]!);
    add[i] = s * ((1 - k) * a[i]! + k * t[i]!);
  }
  return { mul, add };
}

/**
 * Shadow strength now: full by day, fading out over the dusk steps as the night comes and back
 * over the dawn steps (owner: sun shadows are day only). Stepped, never a smooth fade.
 */
export function shadowStrength(darkness: number): number {
  const n = DD.duskSteps;
  const q = Math.min(n, Math.ceil(Math.max(0, darkness) * n - 1e-9)) / n;
  return DS.strength * (1 - q);
}

// ---------- sprite shadows ----------

/** A sprite's shadow and contact pixels as (dx, dy) pairs from its top-left. */
export interface SpriteShadow { cast: Int16Array; contact: Int16Array }

const cache = new WeakMap<SpritePixels, SpriteShadow>();

/**
 * Where a sprite's shadow falls (the mockup's sprite shadow): each opaque pixel hh px above the
 * sprite's bottom row throws a shadow hh × 0.45 px right and down from the bottom row, as wide as
 * its height step; the contact line is one pixel right of and under each footprint pixel.
 */
export function spriteShadow(px: SpritePixels): SpriteShadow {
  let s = cache.get(px);
  if (s) return s;
  const a = DS.perHeightPx;
  const cast = new Set<number>(), contact = new Set<number>();
  const key = (x: number, y: number): number => (y + 64) * 4096 + (x + 64);
  for (let ry = 0; ry < px.h; ry++) {
    for (let rx = 0; rx < px.w; rx++) {
      if (px.data[ry * px.w + rx] === 0) continue;
      const hh = px.h - 1 - ry;
      const x0 = rx + Math.round(hh * a), x1 = rx + Math.round((hh + 1) * a);
      for (let sx = x0; sx <= Math.max(x0, x1 - 1); sx++) cast.add(key(sx, px.h - 1 + Math.round(hh * a)));
      if (ry === px.h - 1) contact.add(key(rx + 1, px.h));
    }
  }
  const pairs = (set: Set<number>): Int16Array => {
    const out = new Int16Array(set.size * 2);
    let k = 0;
    for (const v of set) { out[k++] = (v % 4096) - 64; out[k++] = Math.floor(v / 4096) - 64; }
    return out;
  };
  s = { cast: pairs(cast), contact: pairs(contact) };
  cache.set(px, s);
  return s;
}

// ---------- the pass ----------

/** Applies the shadow masks (opaque where shadowed) to the map: one multiply, one add. */
export class ShadowPass {
  private scratch: HTMLCanvasElement | null = null;

  draw(ctx: CanvasRenderingContext2D, masks: readonly (HTMLCanvasElement | null)[], darkness: number,
    view: { x: number; y: number; w: number; h: number }, width: number, height: number): void {
    const s = shadowStrength(darkness);
    if (s <= 0) return;
    if (!this.scratch || this.scratch.width !== width || this.scratch.height !== height) {
      this.scratch = document.createElement('canvas');
      this.scratch.width = width;
      this.scratch.height = height;
    }
    const x0 = Math.max(0, Math.floor(view.x)), y0 = Math.max(0, Math.floor(view.y));
    const x1 = Math.min(width, Math.ceil(view.x + view.w)), y1 = Math.min(height, Math.ceil(view.y + view.h));
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const sc = this.scratch.getContext('2d')!;
    // Union of the masks, so where a tree's and a person's shadow overlap it is shadowed once.
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(x0, y0, w, h);
    for (const m of masks) if (m) sc.drawImage(m, x0, y0, w, h, x0, y0, w, h);
    const { mul, add } = castMultiplyAdd(s);
    const rgb = (c: RGB): string => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = rgb(mul);
    sc.fillRect(x0, y0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.scratch, x0, y0, w, h, x0, y0, w, h);
    sc.fillStyle = rgb(add);
    sc.fillRect(x0, y0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.scratch, x0, y0, w, h, x0, y0, w, h);
    ctx.restore();
    sc.globalCompositeOperation = 'source-over';
  }
}
