// Day and night (F8 §14.2). Visual only: the simulation has months, not hours, so the day is a
// real-time cycle that runs while the world plays. Night darkens the map toward deep blue
// (multiply), then fires and lit windows glow on top (additive light).
// Toy Diorama phase 4 (docs/diorama-plan/04-night.md): NightPass maps every colour through
// night(c), the Night tokens, and warms the land round each light in dithered bands (readme
// "Light"; falloff from the mockup renderer, docs/mockups/Pixel Ages UI mockups/pixel-scenes.js).

import { CONFIG } from '../config';
import { hexToRgb, PALETTE, type RGB } from './palette';
import { bayer } from './dither';
import { styleOff } from './ramps';

const L = CONFIG.render.f8.light;
const DN = CONFIG.render.diorama.night;
const NIGHT = hexToRgb(PALETTE.night);

/**
 * Darkness 0 (day) … 1 (deep night) at `phase` 0–1 of the day. The day starts at sunrise; dusk
 * and dawn each take `dusk` of the cycle; night takes `nightShare`.
 */
export function darknessAt(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const dayEnd = 1 - L.nightShare - 2 * L.dusk;
  if (p < dayEnd) return 0;
  if (p < dayEnd + L.dusk) return (p - dayEnd) / L.dusk;
  if (p < dayEnd + L.dusk + L.nightShare) return 1;
  return 1 - (p - dayEnd - L.dusk - L.nightShare) / L.dusk;
}

/** A soft round light, drawn additively. Built once per radius and colour. */
const glows = new Map<string, HTMLCanvasElement>();
export function glowSprite(radius: number, colour: string): HTMLCanvasElement {
  const key = `${radius}|${colour}`;
  let c = glows.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = radius * 2;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  g.addColorStop(0, colour);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, radius * 2, radius * 2);
  glows.set(key, c);
  return c;
}

export class DayNight {
  private clockMs = L.dayMs * 0.1;   // start in the morning
  enabled = true;
  /** Darkness 0–1 right now (0 when switched off). */
  darkness = 0;
  /**
   * Seasons Phase 3b (S2): hold the day in full daylight (Watch: a night would cover half a year
   * there and a front could play in the dark). In daylight the day stops; at dusk, night or dawn it
   * runs on `holdCatchUp` times faster until full daylight (never a pop, never a race through an evening).
   */
  hold = false;

  /** Advances the day while the world plays. */
  update(dtMs: number, playing: boolean): void {
    if (playing && this.hold) {
      if (darknessAt(this.clockMs / L.dayMs) > 0) this.clockMs += dtMs * L.holdCatchUp;
    } else if (playing) this.clockMs += dtMs;
    this.darkness = this.enabled ? darknessAt(this.clockMs / L.dayMs) : 0;
  }

  /** Night tint over the visible map (`w` × `h` map px from the camera's top-left). */
  drawTint(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const d = this.darkness * L.maxDark;
    if (d <= 0) return;
    const r = Math.round(255 - (255 - NIGHT[0]) * d);
    const g = Math.round(255 - (255 - NIGHT[1]) * d);
    const b = Math.round(255 - (255 - NIGHT[2]) * d);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /** Additive glows: [x, y, radius] triples in map px. */
  drawLights(ctx: CanvasRenderingContext2D, lights: ArrayLike<number>, count: number): void {
    if (this.darkness <= 0 || count === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, this.darkness);
    for (let k = 0; k < count; k++) {
      const x = lights[k * 3]!, y = lights[k * 3 + 1]!, r = lights[k * 3 + 2]!;
      const img = glowSprite(r, 'rgba(255,170,70,0.55)');
      ctx.drawImage(img, x - r, y - r);
    }
    ctx.restore();
  }
}

// ---------- Toy Diorama night (phase 4) ----------

/** Phase 4 switch. */
export const nightOn: boolean = DN.on && !styleOff('night');

/**
 * How far into the night the map is drawn, 0 (day) … 1 (night), in `duskSteps` whole steps over
 * dusk and dawn: light changes in bands of time too, never a smooth fade (readme "quantized light").
 */
export function nightLevel(darkness: number): number {
  if (darkness <= 0) return 0;
  const n = CONFIG.render.diorama.duskSteps;
  return Math.min(n, Math.ceil(darkness * n - 1e-9)) / n;
}

/** night(c) at level q, mix(c, c × mul + add, q), as a GPU multiply colour and add colour (0–255). */
export function nightMultiplyAdd(q: number): { mul: RGB; add: RGB } {
  const mul: RGB = [0, 0, 0], add: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    mul[i] = 255 * (1 - q + q * DN.mul[i]!);
    add[i] = q * DN.add[i]!;
  }
  return { mul, add };
}

/** The night colour of c (full night). */
export function nightOf(c: RGB): RGB {
  return [c[0] * DN.mul[0]! + DN.add[0]!, c[1] * DN.mul[1]! + DN.add[1]!, c[2] * DN.mul[2]! + DN.add[2]!];
}

/** Firelight band 0 … bands at a pixel lit with strength `light` (0–1+), dithered at the band edges. */
export function lightBand(light: number, px: number, py: number): number {
  return Math.min(DN.bands, Math.floor(Math.min(1, Math.max(0, light)) * DN.bands + bayer(px, py)));
}

const rgb = (c: RGB): string =>
  `rgb(${Math.round(Math.min(255, c[0]))},${Math.round(Math.min(255, c[1]))},${Math.round(Math.min(255, c[2]))})`;

/**
 * The night pass, over the whole drawn frame (terrain, overlays and sprites alike):
 *   1. a copy of the day frame warmed to the lit colour (day × litMul), cut to the firelight bands;
 *   2. the frame mapped through night(c): one multiply, one add;
 *   3. the warm copy laid over it, each band at its share (1/3, 2/3, 3/3): mix(night, lit, band).
 * Emissive pixels (flames, lit windows) are put back afterwards by the renderer. The band mask is
 * built on the CPU only when the lights change.
 */
export class NightPass {
  private key = '';
  private light: Float32Array | null = null;
  private mask: HTMLCanvasElement | null = null;
  private maskImg: ImageData | null = null;
  private lit = false;
  private warm: HTMLCanvasElement | null = null;
  private extra: HTMLCanvasElement | null = null;

  /**
   * Lights are [x, y, radius, strength] quadruples in map px; `apply` sets the camera transform
   * on a context (map px → canvas px).
   */
  draw(ctx: CanvasRenderingContext2D, level: number, lights: ArrayLike<number>, count: number,
    mapW: number, mapH: number, apply: (c: CanvasRenderingContext2D) => void): void {
    if (level <= 0) return;
    this.buildMask(lights, count, mapW, mapH);
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.lit) {
      // Lit colour = day × litMul. A multiply can't go above 1, so the part over 1 (red × 1.10)
      // is a second copy, added.
      const base = DN.litMul.map((v) => Math.min(1, v) * 255) as unknown as RGB;
      const over = DN.litMul.map((v) => Math.max(0, v - 1) * 255) as unknown as RGB;
      const warm = this.canvas('warm', W, H).getContext('2d')!;
      warm.setTransform(1, 0, 0, 1, 0, 0);
      warm.globalCompositeOperation = 'copy';
      warm.drawImage(ctx.canvas, 0, 0);
      warm.globalCompositeOperation = 'multiply';
      warm.fillStyle = rgb(base);
      warm.fillRect(0, 0, W, H);
      if (over.some((v) => v > 0)) {
        const ex = this.canvas('extra', W, H).getContext('2d')!;
        ex.globalCompositeOperation = 'copy';
        ex.drawImage(ctx.canvas, 0, 0);
        ex.globalCompositeOperation = 'multiply';
        ex.fillStyle = rgb(over);
        ex.fillRect(0, 0, W, H);
        warm.globalCompositeOperation = 'lighter';
        warm.drawImage(ex.canvas, 0, 0);
      }
      // Cut to the bands: the mask's alpha is band / bands.
      warm.globalCompositeOperation = 'destination-in';
      warm.imageSmoothingEnabled = false;
      apply(warm);
      warm.drawImage(this.mask!, 0, 0);
      warm.setTransform(1, 0, 0, 1, 0, 0);
      warm.globalCompositeOperation = 'source-over';
    }
    const { mul, add } = nightMultiplyAdd(level);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = rgb(mul);
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgb(add);
    ctx.fillRect(0, 0, W, H);
    if (this.lit) {
      // Firelight shows as the night comes: the bands at the night level's share.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = level;
      ctx.drawImage(this.warm!, 0, 0);
    }
    ctx.restore();
  }

  private canvas(which: 'warm' | 'extra', w: number, h: number): HTMLCanvasElement {
    let c = this[which];
    if (!c || c.width !== w || c.height !== h) {
      c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      this[which] = c;
    }
    return c;
  }

  /** Light strength per map pixel, summed over the lights (mockup falloff), then cut into dithered bands. */
  private buildMask(lights: ArrayLike<number>, count: number, w: number, h: number): void {
    let key = `${w}x${h}:`;
    for (let k = 0; k < count * 4; k++) key += Math.round(lights[k]! * 10) + ',';
    if (key === this.key && this.mask) return;
    this.key = key;
    if (!this.light || this.light.length !== w * h) {
      this.light = new Float32Array(w * h);
      this.mask = document.createElement('canvas');
      this.mask.width = w;
      this.mask.height = h;
      this.maskImg = this.mask.getContext('2d')!.createImageData(w, h);
    }
    const L = this.light;
    L.fill(0);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let k = 0; k < count; k++) {
      const lx = lights[k * 4]!, ly = lights[k * 4 + 1]!, reach = lights[k * 4 + 2]! * DN.reachMult, s = lights[k * 4 + 3]!;
      const ax = Math.max(0, Math.floor(lx - reach)), bx = Math.min(w - 1, Math.ceil(lx + reach));
      const ay = Math.max(0, Math.floor(ly - reach)), by = Math.min(h - 1, Math.ceil(ly + reach));
      for (let y = ay; y <= by; y++) {
        for (let x = ax; x <= bx; x++) {
          const dx = x - lx, dy = y - ly, d2 = dx * dx + dy * dy;
          if (d2 >= reach * reach) continue;
          const f = 1 - Math.sqrt(d2) / reach;
          L[y * w + x] = L[y * w + x]! + f * f * s;
        }
      }
      if (ax < x0) x0 = ax;
      if (ay < y0) y0 = ay;
      if (bx > x1) x1 = bx;
      if (by > y1) y1 = by;
    }
    const d = this.maskImg!.data;
    d.fill(0);
    this.lit = x1 >= x0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const b = lightBand(L[y * w + x]!, x, y);
        if (b > 0) d[(y * w + x) * 4 + 3] = Math.round((255 * b) / DN.bands);
      }
    }
    this.mask!.getContext('2d')!.putImageData(this.maskImg!, 0, 0);
  }
}
