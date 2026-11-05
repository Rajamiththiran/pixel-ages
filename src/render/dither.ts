// Toy Diorama dither (docs/diorama-plan/02-dither.md): clustered ordered dither, a 4×4 Bayer
// matrix over value noise (design system readme, "Texture"; ported from the mockup renderer,
// docs/mockups/Pixel Ages UI mockups/pixel-scenes.js). Every value depends only on the world
// pixel, so the pattern never flickers and a tile redraws the same whatever else changed.

import { CONFIG } from '../config';
import { hash01 } from '../shared/hash';
import { rampMix, rampsOn, rampShift, rampSpan, styleOff } from './ramps';
import type { RGB } from './palette';

const DD = CONFIG.render.diorama.dither;

/** Phase 2 switch. Dither moves along the ramps, so it needs them. */
export const ditherOn: boolean = rampsOn && DD.on && !styleOff('dither');

const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The Bayer threshold at a pixel, 1/32 … 31/32. */
export function bayer(px: number, py: number): number {
  return (B4[(py & 3) * 4 + (px & 3)]! + 0.5) / 16;
}

// Value-noise lattice: one hash per lattice point, built once for the map (≈ 290 × 160 points).
const LW = Math.ceil((CONFIG.map.width * CONFIG.map.tilePx) / DD.noiseScalePx) + 2;
const LH = Math.ceil((CONFIG.map.height * CONFIG.map.tilePx) / DD.noiseScalePx) + 2;
const lattice = new Float32Array(LW * LH);
for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) lattice[y * LW + x] = hash01(x, y, DD.noiseSalt);

const at = (x: number, y: number): number =>
  x >= 0 && y >= 0 && x < LW && y < LH ? lattice[y * LW + x]! : hash01(x, y, DD.noiseSalt);

/** Smooth value noise 0–1 at a pixel (bilinear with smoothstep between lattice points). */
export function valueNoise(px: number, py: number): number {
  const fx = px / DD.noiseScalePx, fy = py / DD.noiseScalePx;
  const xi = Math.floor(fx), yi = Math.floor(fy);
  const xf = fx - xi, yf = fy - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Ground texture: where the noise is high the pixel lifts a ramp step, where low it drops one,
 * with the Bayer matrix deciding which pixels (mockup terrainColour). The mockup's shade there is
 * a fraction of a step; on whole-step ramps the same strength is that share of pixels moving.
 */
export function textureStep(px: number, py: number): number {
  const n = valueNoise(px, py), b = bayer(px, py);
  if (n > DD.lightAbove && Math.min(1, (n - DD.lightAbove) * DD.gain) * DD.stepShare > b) return 1;
  if (n < DD.darkBelow && Math.min(1, (DD.darkBelow - n) * DD.gain) * DD.stepShare > b) return -1;
  return 0;
}

// The texture step of every pixel of the map, worked out once (it depends only on the pixel):
// a byte read per pixel instead of the noise maths on every redraw.
const TW = CONFIG.map.width * CONFIG.map.tilePx, TH = CONFIG.map.height * CONFIG.map.tilePx;
let texture: Int8Array | null = null;

/** Applies the ground texture to a pixel. */
export function applyTexture(px: number, py: number, out: RGB): void {
  let s: number;
  if (px < TW && py < TH) {
    if (!texture) {
      texture = new Int8Array(TW * TH);
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) texture[y * TW + x] = textureStep(x, y);
    }
    s = texture[py * TW + px]!;
  } else s = textureStep(px, py);
  if (s !== 0) rampShift(out, s);
}

// The pixel being drawn: gradient blends read its Bayer threshold.
let threshold = 0.5;

/** Terrain sets this before drawing each pixel. */
export function ditherPixel(px: number, py: number): void { threshold = bayer(px, py); }

/**
 * A gradient (plant density, water depth) between two colours: `t` is cut into tones (the ramp
 * steps between them on one ramp, else `gradientLevels`) and the Bayer threshold picks between
 * the two nearest, so a 30% blend shows as a 30% stipple of the next tone instead of a hard band.
 */
export function mixGrad(a: RGB, b: RGB, t: number, out: RGB): void {
  const K = rampSpan(a, b) || DD.gradientLevels;
  const i = Math.min(K, Math.floor(Math.max(0, Math.min(1, t)) * K + threshold));
  rampMix(a, b, i / K, out);
}
