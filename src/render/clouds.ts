// Pixel clouds (seasons plan Phase 5, mockup E). Each cloud is a cluster of hashed discs (the
// mockup's makeClouds), drifting with the wind in whole pixels. Its shape is worked out once, as a
// mask (rim and core for its shadow; Phase 6: the wider zones of wet ground and puddles under rain)
// and two body sprites (one per checker parity, so the body's dithered band stays fixed to the world
// grid as the cloud moves). Phase 6: a raining cloud carries its rain spots with it. How many clouds
// pass, and how big, follows the rain the screen shows under them. Drawing only.

import { CONFIG } from '../config';
import { hash01 } from '../shared/hash';
import { seasonRampRgb, styleOff } from './ramps';
import { seasonRampsOn } from './materials';

const CC = CONFIG.render.seasons.clouds;
const RC = CONFIG.render.seasons.rain;
const W = CONFIG.render.f8.weather;

/** Phase 5 switches: pixel clouds; their shadows dithered on the ramps (off: a crisp navy wash). */
export const cloudsOn: boolean = seasonRampsOn && CC.on && !styleOff('clouds');
export const cloudDitherOn: boolean = cloudsOn && !styleOff('cloudDither');
/** Phase 6 switches: rain and snow in frames, wet ground, puddles. */
export const rainFramesOn: boolean = cloudsOn && RC.frames && !styleOff('rainFrames');
export const wetGroundOn: boolean = cloudDitherOn && RC.wetGround && !styleOff('wetGround');
export const puddlesOn: boolean = cloudDitherOn && RC.puddles && !styleOff('puddles');

/** Mask bits: inside the cloud (its rim), its core, Phase 6 the puddle zone and the wet zone (wider). */
export const Mask = { Out: 0, In: 1, Core: 2, Puddle: 4, Wet: 8 } as const;

export interface CloudShape {
  readonly w: number;
  readonly h: number;
  /** The mask's top-left, relative to the cloud's position. */
  readonly ox: number;
  readonly oy: number;
  readonly mask: Uint8Array;
  readonly storm: boolean;
  /** Phase 6: it rains (or snows) from this cloud; its wet ground and puddles show. */
  readonly rainy: boolean;
  /** Phase 6: rain spots relative to the cloud's position: x, y, frame phase (0–2), pair (0/1) each. */
  readonly spots: Int16Array;
  /** Mask positions (x 0…w, y) whose value differs from the one to their left; when the cloud moves one pixel right, the pixel left of each is all that can change. */
  readonly edges: Int16Array;
  /** Body sprites per parity of the top-left's world (x + y), and the wash shadow; built when first drawn. */
  body: [HTMLCanvasElement | null, HTMLCanvasElement | null];
  wash: HTMLCanvasElement | null;
}

interface Puff { x: number; y: number; r: number }

/**
 * A cloud's shape from its seed (the mockup's makeClouds): 4–7 discs and a centre disc, × `size`.
 * The mask reaches to the wet zone when it rains (`rainy`), so the shadow's box covers it.
 */
export function makeCloud(seed: number, size: number, storm: boolean, rainy = false): CloudShape {
  const s = CC.salt;
  const [p0, p1] = CC.puffs, [sx, sy] = CC.spreadPx, [r0, r1] = CC.puffRadiusPx;
  const n = p0! + Math.floor(hash01(seed, 3, s) * (p1! - p0!));
  const puffs: Puff[] = [];
  for (let p = 0; p < n; p++) {
    puffs.push({ x: (hash01(seed, p, s + 1) - 0.5) * sx! * size, y: (hash01(seed, p, s + 2) - 0.5) * sy! * size, r: (r0! + hash01(seed, p, s + 3) * (r1! - r0!)) * size });
  }
  puffs.push({ x: 0, y: 0, r: CC.coreRadiusPx * size });
  const reach = rainy ? Math.max(RC.wetScale, RC.puddleScale) : 1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of puffs) { x0 = Math.min(x0, q.x - q.r * reach); y0 = Math.min(y0, q.y - q.r * reach); x1 = Math.max(x1, q.x + q.r * reach); y1 = Math.max(y1, q.y + q.r * reach); }
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
      let m = 0;
      if (inside(x, y, 1)) m |= Mask.In;
      if (inside(x, y, CC.coreScale)) m |= Mask.Core;
      if (rainy && inside(x, y, RC.puddleScale)) m |= Mask.Puddle;
      if (rainy && inside(x, y, RC.wetScale)) m |= Mask.Wet;
      mask[ly * w + lx] = m;
    }
  }
  const edges: number[] = [];
  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx <= w; lx++) {
      const a = lx > 0 ? mask[ly * w + lx - 1]! : 0, b = lx < w ? mask[ly * w + lx]! : 0;
      if (a !== b) edges.push(lx, ly);
    }
  }
  return { w, h, ox, oy, mask, storm, rainy, spots: rainy ? rainSpots(seed, inside, x0, y0, x1, y1) : new Int16Array(0), edges: Int16Array.from(edges), body: [null, null], wash: null };
}

/**
 * Phase 6 (mockup E): rain spots, snowDensity per pixel of the cloud grown to spotScale, moved by the
 * shadow offset less spotShiftPx (rain falls from the cloud toward its shadow); none under the body.
 */
function rainSpots(seed: number, inside: (x: number, y: number, sc: number) => boolean, x0: number, y0: number, x1: number, y1: number): Int16Array {
  const [sx, sy] = CC.shadowOffsetPx, shift = RC.spotShiftPx;
  const g = RC.spotScale;
  const bx0 = Math.floor(x0 * g), by0 = Math.floor(y0 * g), bw = Math.ceil(x1 * g) - bx0, bh = Math.ceil(y1 * g) - by0;
  const n = Math.round(bw * bh * RC.snowDensity * 1.5);   // tries: about a third fall outside the grown cloud
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const u = bx0 + Math.floor(hash01(seed, k, RC.salt) * bw), v = by0 + Math.floor(hash01(seed, k, RC.salt + 1) * bh);
    if (!inside(u, v, g)) continue;
    const x = u + sx! - shift, y = v + sy!;
    if (inside(x, y, 1)) continue;   // under the cloud's own body: hidden there by day, so never drawn
    out.push(x, y, Math.floor(hash01(seed, k, RC.salt + 2) * 3), hash01(seed, k, RC.salt + 3) < RC.flakePairShare ? 1 : 0);
  }
  return Int16Array.from(out);
}

const at = (c: CloudShape, lx: number, ly: number): boolean => lx >= 0 && ly >= 0 && lx < c.w && ly < c.h && (c.mask[ly * c.w + lx]! & Mask.In) !== 0;

/**
 * The body's ramp step at mask pixel (lx, ly) (mockup): lit top-left rim at step 4, the underside at
 * step 1, a dithered band (2 / 3 by world parity `odd`) above it, the rest step 3; −1 outside.
 */
export function bodyStep(c: CloudShape, lx: number, ly: number, odd: boolean): number {
  if (!at(c, lx, ly)) return -1;
  const [rx, ry] = CC.rimPx, [ux, uy] = CC.undersidePx, [bx, by] = CC.bandPx;
  if (!at(c, lx - rx!, ly - ry!)) return 4;
  if (!at(c, lx + ux!, ly + uy!)) return 1;
  if (!at(c, lx + bx!, ly + by!)) return odd ? 2 : 3;
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
    if ((c.mask[k]! & Mask.In) === 0) continue;
    img.data[k * 4] = 10; img.data[k * 4 + 1] = 12; img.data[k * 4 + 2] = 30; img.data[k * 4 + 3] = Math.round(255 * W.shadowAlpha);
  }
  ctx.putImageData(img, 0, 0);
  c.wash = cv;
  return cv;
}

/** A cloud on the map now: its shape and whole-pixel position. */
export interface CloudAt { readonly shape: CloudShape; readonly x: number; readonly y: number }

/** A forced sky (dev): a cloudy sky, rain, a storm, snowfall (flakes wherever it falls), or a clear sky with dawn mist. */
export type ForcedSky = 'clouds' | 'rain' | 'storm' | 'snowfall' | 'mist';

/** Dev builds: `?weather=clouds|rain|storm|snowfall|mist`. */
export function parseWeather(q: string | null): ForcedSky | null {
  return q === 'clouds' || q === 'rain' || q === 'storm' || q === 'snowfall' || q === 'mist' ? q : null;
}

const weatherFromUrl = (): ForcedSky | null =>
  import.meta.env.DEV && typeof location !== 'undefined' ? parseWeather(new URLSearchParams(location.search).get('weather')) : null;

/** The share of slots that carry a cloud, and its size, over land with rain `rain` (0–100). */
export function cloudiness(rain: number): { share: number; size: number } {
  const t = Math.max(0, Math.min(1, (rain - CC.dryRain) / (CC.wetRain - CC.dryRain)));
  return { share: CC.shareDry + (CC.shareWet - CC.shareDry) * t, size: CC.sizeDry + (CC.sizeWet - CC.sizeDry) * t };
}

/**
 * The clouds in the sky: `slots` lanes, each crossing the map with the wind again and again. Each
 * pass (a generation) decides once whether a cloud shows, how big, and whether it rains (by the rain
 * under it then), so a cloud never pops or changes shape while crossing.
 */
export class Clouds {
  private readonly gen: Int32Array;
  private readonly shapes: (CloudShape | null)[];
  private readonly ys: Float32Array;
  readonly now: CloudAt[] = [];
  /** Dev: a forced sky (`?weather=`), else null. */
  readonly forced: ForcedSky | null;

  constructor(private readonly pw: number, private readonly ph: number, forced: ForcedSky | null = weatherFromUrl()) {
    this.gen = new Int32Array(CC.slots).fill(-1);
    this.shapes = new Array(CC.slots).fill(null);
    this.ys = new Float32Array(CC.slots);
    this.forced = forced;
  }

  /** Phase 7: a storm blows now (weather over years, S9); a dev sky overrides it. */
  stormy = false;

  /** A storm is on (the storm ramp, every slot, the gloom, rain everywhere). */
  get storm(): boolean { return this.forced === 'storm' || (this.forced === null && this.stormy); }

  /**
   * Moves the clouds to drift time `t` (seconds of wind); `rainAt(y)` is the shown rain (0–100) of
   * the map's row band at pixel row y. Fills `now` with the clouds on or near the map.
   */
  update(t: number, rainAt: (y: number) => number): void {
    const span = this.pw + 2 * CC.marginPx;
    const f = this.forced;
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
        // A storm (dev, or Phase 7's) fills every lane with big storm clouds as they come: none pops.
        const storm = this.storm;
        const rain = storm || f === 'rain' || f === 'snowfall' ? 100 : f === 'clouds' ? (CC.dryRain + CC.wetRain) / 2 : rainAt(y);
        const { share, size } = cloudiness(rain);
        const show = f !== 'mist' && (storm || hash01(k, g, CC.salt + 9) < share);
        const rainy = storm || f === 'rain' || f === 'snowfall' || (f === null && rain >= W.rainAbove && hash01(k, g, CC.salt + 10) < CC.rainyShare);
        this.shapes[k] = show ? makeCloud(seed, storm ? CC.stormSize : size, storm, rainy) : null;
      }
      const shape = this.shapes[k];
      if (!shape) continue;
      this.now.push({ shape, x: Math.floor(pos - g * span - CC.marginPx), y: Math.floor(this.ys[k]!) });
    }
  }

  /** Is map pixel (x, y) under a cloud's body now (`rainy`: a raining cloud's)? */
  covers(x: number, y: number, rainy = false): boolean {
    for (const c of this.now) {
      const s = c.shape;
      if (rainy && !s.rainy) continue;
      const lx = x - c.x - s.ox, ly = y - c.y - s.oy;
      if (lx >= 0 && ly >= 0 && lx < s.w && ly < s.h && (s.mask[ly * s.w + lx]! & Mask.In) !== 0) return true;
    }
    return false;
  }
}
