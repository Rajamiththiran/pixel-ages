// Pixel clouds (seasons plan Phase 5, mockup E). Each cloud is a cluster of hashed discs (the
// mockup's makeClouds), drifting with the wind in whole pixels. Its shape is worked out once, as a
// mask (rim and core) for its shadow and two body sprites (one per checker parity, so the body's
// dithered band stays fixed to the world grid as the cloud moves). How many clouds pass, and how big,
// follows the rain the screen shows under them. Drawing only.

import { CONFIG } from '../config';
import { hash01 } from '../shared/hash';
import { seasonRampRgb, styleOff } from './ramps';
import { seasonRampsOn } from './materials';

const CC = CONFIG.render.seasons.clouds;
const W = CONFIG.render.f8.weather;

/** Phase 5 switches: pixel clouds; their shadows dithered on the ramps (off: a crisp navy wash). */
export const cloudsOn: boolean = seasonRampsOn && CC.on && !styleOff('clouds');
export const cloudDitherOn: boolean = cloudsOn && !styleOff('cloudDither');

/** Mask values: outside, inside the cloud (its rim), inside its core. */
export const Mask = { Out: 0, Rim: 1, Core: 2 } as const;

export interface CloudShape {
  readonly w: number;
  readonly h: number;
  /** The mask's top-left, relative to the cloud's position. */
  readonly ox: number;
  readonly oy: number;
  readonly mask: Uint8Array;
  readonly storm: boolean;
  /** Body sprites per parity of the top-left's world (x + y), and the wash shadow; built when first drawn. */
  body: [HTMLCanvasElement | null, HTMLCanvasElement | null];
  wash: HTMLCanvasElement | null;
}

interface Puff { x: number; y: number; r: number }

/** A cloud's shape from its seed (the mockup's makeClouds): 4–7 discs and a centre disc, × `size`. */
export function makeCloud(seed: number, size: number, storm: boolean): CloudShape {
  const s = CC.salt;
  const [p0, p1] = CC.puffs, [sx, sy] = CC.spreadPx, [r0, r1] = CC.puffRadiusPx;
  const n = p0! + Math.floor(hash01(seed, 3, s) * (p1! - p0!));
  const puffs: Puff[] = [];
  for (let p = 0; p < n; p++) {
    puffs.push({ x: (hash01(seed, p, s + 1) - 0.5) * sx! * size, y: (hash01(seed, p, s + 2) - 0.5) * sy! * size, r: (r0! + hash01(seed, p, s + 3) * (r1! - r0!)) * size });
  }
  puffs.push({ x: 0, y: 0, r: CC.coreRadiusPx * size });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of puffs) { x0 = Math.min(x0, q.x - q.r); y0 = Math.min(y0, q.y - q.r); x1 = Math.max(x1, q.x + q.r); y1 = Math.max(y1, q.y + q.r); }
  const ox = Math.floor(x0) - 1, oy = Math.floor(y0) - 1;
  const w = Math.ceil(x1) + 2 - ox, h = Math.ceil(y1) + 2 - oy;
  const inside = (x: number, y: number, sc: number): boolean => {
    for (const q of puffs) {
      const dx = x - q.x, dy = (y - q.y) * CC.aspect, r = q.r * sc;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  };
  const mask = new Uint8Array(w * h);
  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx < w; lx++) {
      const x = lx + ox, y = ly + oy;
      mask[ly * w + lx] = inside(x, y, CC.coreScale) ? Mask.Core : inside(x, y, 1) ? Mask.Rim : Mask.Out;
    }
  }
  return { w, h, ox, oy, mask, storm, body: [null, null], wash: null };
}

const at = (c: CloudShape, lx: number, ly: number): number => (lx < 0 || ly < 0 || lx >= c.w || ly >= c.h ? Mask.Out : c.mask[ly * c.w + lx]!);

/**
 * The body's ramp step at mask pixel (lx, ly) (mockup): lit top-left rim at step 4, the underside at
 * step 1, a dithered band (2 / 3 by world parity `odd`) above it, the rest step 3; −1 outside.
 */
export function bodyStep(c: CloudShape, lx: number, ly: number, odd: boolean): number {
  if (at(c, lx, ly) === Mask.Out) return -1;
  const [rx, ry] = CC.rimPx, [ux, uy] = CC.undersidePx, [bx, by] = CC.bandPx;
  if (at(c, lx - rx!, ly - ry!) === Mask.Out) return 4;
  if (at(c, lx + ux!, ly + uy!) === Mask.Out) return 1;
  if (at(c, lx + bx!, ly + by!) === Mask.Out) return odd ? 2 : 3;
  return 3;
}

/** The body sprite whose top-left lies on world parity `parity` ((x + y) & 1). */
export function bodySprite(c: CloudShape, parity: number): HTMLCanvasElement {
  const done = c.body[parity];
  if (done) return done;
  const cv = document.createElement('canvas');
  cv.width = c.w; cv.height = c.h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(c.w, c.h);
  const ramp = seasonRampRgb(c.storm ? 'cloudStorm' : 'cloud');
  for (let ly = 0; ly < c.h; ly++) {
    for (let lx = 0; lx < c.w; lx++) {
      const s = bodyStep(c, lx, ly, ((lx + ly + parity) & 1) === 1);
      if (s < 0) continue;
      const o = (ly * c.w + lx) * 4, col = ramp[s]!;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  c.body[parity] = cv;
  return cv;
}

/** `?off=cloudDither`: the shadow as a crisp-edged navy wash (the cloud's whole mask). */
export function washSprite(c: CloudShape): HTMLCanvasElement {
  if (c.wash) return c.wash;
  const cv = document.createElement('canvas');
  cv.width = c.w; cv.height = c.h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(c.w, c.h);
  for (let k = 0; k < c.mask.length; k++) {
    if (c.mask[k] === Mask.Out) continue;
    img.data[k * 4] = 10; img.data[k * 4 + 1] = 12; img.data[k * 4 + 2] = 30; img.data[k * 4 + 3] = Math.round(255 * W.shadowAlpha);
  }
  ctx.putImageData(img, 0, 0);
  c.wash = cv;
  return cv;
}

/** A cloud on the map now: its shape and whole-pixel position. */
export interface CloudAt { readonly shape: CloudShape; readonly x: number; readonly y: number }

/** Dev builds: `?weather=clouds` (a cloudy sky everywhere) or `?weather=storm`. */
export function parseWeather(q: string | null): 'clouds' | 'storm' | null {
  return q === 'clouds' || q === 'storm' ? q : null;
}

const weatherFromUrl = (): 'clouds' | 'storm' | null =>
  import.meta.env.DEV && typeof location !== 'undefined' ? parseWeather(new URLSearchParams(location.search).get('weather')) : null;

/** The share of slots that carry a cloud, and its size, over land with rain `rain` (0–100). */
export function cloudiness(rain: number): { share: number; size: number } {
  const t = Math.max(0, Math.min(1, (rain - CC.dryRain) / (CC.wetRain - CC.dryRain)));
  return { share: CC.shareDry + (CC.shareWet - CC.shareDry) * t, size: CC.sizeDry + (CC.sizeWet - CC.sizeDry) * t };
}

/**
 * The clouds in the sky: `slots` lanes, each crossing the map with the wind again and again. Each
 * pass (a generation) decides once whether a cloud shows and how big (by the rain under it then), so
 * a cloud never pops or changes shape while crossing.
 */
export class Clouds {
  private readonly gen: Int32Array;
  private readonly shapes: (CloudShape | null)[];
  private readonly ys: Float32Array;
  readonly now: CloudAt[] = [];
  /** Dev: a forced sky (`?weather=`), else null. */
  readonly forced: 'clouds' | 'storm' | null;

  constructor(private readonly pw: number, private readonly ph: number, forced: 'clouds' | 'storm' | null = weatherFromUrl()) {
    this.gen = new Int32Array(CC.slots).fill(-1);
    this.shapes = new Array(CC.slots).fill(null);
    this.ys = new Float32Array(CC.slots);
    this.forced = forced;
  }

  /** A storm is on (the storm ramp, every slot, the gloom). */
  get storm(): boolean { return this.forced === 'storm'; }

  /**
   * Moves the clouds to drift time `t` (seconds of wind); `rainAt(y)` is the shown rain (0–100) of
   * the map's row band at pixel row y. Fills `now` with the clouds on or near the map.
   */
  update(t: number, rainAt: (y: number) => number): void {
    const span = this.pw + 2 * CC.marginPx;
    this.now.length = 0;
    for (let k = 0; k < CC.slots; k++) {
      // Each slot starts at its own phase, so the lanes are spread across the map.
      const pos = t * W.windPxPerS + hash01(k, 0, CC.salt + 7) * span;
      const g = Math.floor(pos / span);
      if (g !== this.gen[k]) {
        this.gen[k] = g;
        const seed = k * 7919 + g;
        const y = (0.04 + 0.92 * hash01(k, g, CC.salt + 8)) * this.ph;
        this.ys[k] = y;
        const f = this.forced;
        const { share, size } = cloudiness(f === 'storm' ? 100 : f === 'clouds' ? (CC.dryRain + CC.wetRain) / 2 : rainAt(y));
        const show = f === 'storm' || hash01(k, g, CC.salt + 9) < share;
        this.shapes[k] = show ? makeCloud(seed, f === 'storm' ? CC.stormSize : size, f === 'storm') : null;
      }
      const shape = this.shapes[k];
      if (!shape) continue;
      this.now.push({ shape, x: Math.floor(pos - g * span - CC.marginPx), y: Math.floor(this.ys[k]!) });
    }
  }

  /** Is map pixel (x, y) under a cloud's body now? */
  covers(x: number, y: number): boolean {
    for (const c of this.now) {
      const s = c.shape, lx = x - c.x - s.ox, ly = y - c.y - s.oy;
      if (lx >= 0 && ly >= 0 && lx < s.w && ly < s.h && s.mask[ly * s.w + lx] !== Mask.Out) return true;
    }
    return false;
  }
}
