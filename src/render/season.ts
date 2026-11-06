// Seasons on all land (F8 §14.1): a tint per tile, one pixel per tile scaled up over the
// terrain. Spring greens the grass and crops, summer turns them gold, autumn colours the forest
// and stubbles the fields, winter frosts the lowland and snows on the mountains. The season's
// weights follow the screen clock's fractional month (speeds plan Phase 3), so the year turns with
// no monthly steps. At the fast speeds no season can be read, so the year softens (Trot) or
// gives way to one calm held look (Ride, Fly; Phase 4); the easing blends any change of speed.
// Toy Diorama phase 2 (docs/diorama-plan/02-dither.md): the tint is a crisp 4×4 Bayer stipple of
// each season's colour instead of a blurred translucent wash (readme: "never blurred").

import { CONFIG } from '../config';
import { Ground, Plant, WallType } from '../shared/ids';
import type { MapData } from '../shared/types';
import { RGBS, worldHex, type PaletteKey } from './palette';
import { styleOff } from './ramps';

const S = CONFIG.render.f8.season;
const TILE = CONFIG.map.tilePx;

/** Phase 2 switch for the stippled tint. */
export const seasonDitherOn: boolean = CONFIG.render.diorama.ditherSeason.on && !styleOff('ditherSeason');

// Bayer ranks of the 4×4 cells (the same matrix as dither.ts, so stipple and ground texture agree).
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const CELLS = 16;

/**
 * Which season (0–3) covers each 4×4 cell, −1 for none: season s covers `counts[s]` cells, taken
 * in Bayer order after the seasons before it, so any share spreads evenly and a growing share
 * only adds cells. It starts from the top of the matrix: the ground texture (dither.ts) moves only
 * low-threshold pixels, so the two never sit on the same pixel.
 */
export function stippleCells(counts: ArrayLike<number>, out: Int8Array = new Int8Array(CELLS)): Int8Array {
  out.fill(-1);
  let start = 0;
  for (let s = 0; s < 4; s++) {
    const end = Math.min(CELLS, start + counts[s]!);
    for (let k = 0; k < CELLS; k++) {
      const rank = CELLS - 1 - B4[k]!;
      if (rank >= start && rank < end) out[k] = s;
    }
    start = end;
  }
  return out;
}

/** Cells (of 16) each season covers for tint class `cls` under weights `w`. */
export function stippleCounts(cls: number, w: ArrayLike<number>, out: number[] = [0, 0, 0, 0]): number[] {
  for (let s = 0; s < 4; s++) {
    out[s] = cls === TintClass.None ? 0 : Math.round(w[s]! * (S[SEASON_KEYS[s]!][CLASS_KEYS[cls - 1]!] as readonly [PaletteKey, number])[1] * CELLS);
  }
  return out;
}

/** Tile classes that take a seasonal tint (0 = none: water and river/sea walls). */
export const TintClass = { None: 0, Grass: 1, Forest: 2, Fruit: 3, Farm: 4, Desert: 5, Cold: 6 } as const;
const CLASS_KEYS = ['grass', 'forest', 'fruit', 'farm', 'desert', 'cold'] as const;
const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter'] as const;
// Middle month of each season (CONFIG.seasonOfMonth: 0–2 spring, 3–5 summer, 6–8 autumn, 9–11 winter).
const CENTRE = [1, 4, 7, 10];

/**
 * Weights of spring, summer, autumn and winter at month `m` (0–12, fractions allowed): a
 * triangle 3 months wide around each season's middle month, so they always sum to 1.
 */
export function seasonWeights(m: number, out: Float64Array = new Float64Array(4)): Float64Array {
  for (let s = 0; s < 4; s++) {
    let d = Math.abs(m - CENTRE[s]!);
    d = Math.min(d, 12 - d);
    out[s] = Math.max(0, 1 - d / 3);
  }
  return out;
}

/**
 * The season weights to draw at `month` (0–12, with a fraction) when `show` of the turning year
 * shows (speeds plan Phase 4): 1 is the year as it turns, 0 the held fast-forward look
 * (`heldWeights`), between is a softened year. They always sum to 1.
 */
export function seasonTarget(month: number, show: number, out: Float64Array = new Float64Array(4)): Float64Array {
  seasonWeights(month + 0.5, out);
  for (let s = 0; s < 4; s++) out[s] = S.heldWeights[s]! + (out[s]! - S.heldWeights[s]!) * show;
  return out;
}

/**
 * Moves the drawn weights `now` toward `target` over `dtMs` (time constant `easeMs`). With the
 * screen clock the target already flows; the ease stays as a gentle filter, so a change of speed
 * (to or from the held look) blends over a moment instead of popping.
 */
export function easeWeights(now: Float64Array, target: ArrayLike<number>, dtMs: number): void {
  const k = 1 - Math.exp(-dtMs / S.easeMs);
  for (let s = 0; s < 4; s++) now[s] = now[s]! + (target[s]! - now[s]!) * k;
}

export function tintClass(map: MapData, i: number): number {
  const wall = map.wall[i];
  const ground = map.ground[i];
  if (wall === WallType.Mountain) return TintClass.Cold;
  if (wall !== WallType.None || ground === Ground.Water) return TintClass.None;
  if (ground === Ground.Mountain || map.elevation[i]! >= S.snowElevation) return TintClass.Cold;
  switch (map.plantType[i]) {
    case Plant.Forest: return TintClass.Forest;
    case Plant.FruitBushes: return TintClass.Fruit;
    case Plant.Farmland: return TintClass.Farm;
    default: return ground === Ground.Desert ? TintClass.Desert : TintClass.Grass;
  }
}

/** The blended tint of one class under season weights `w`, as premultiplied [r, g, b, a] 0–255. */
export function classTint(cls: number, w: ArrayLike<number>, out: number[]): number[] {
  let r = 0, g = 0, b = 0, a = 0;
  if (cls !== TintClass.None) {
    const key = CLASS_KEYS[cls - 1]!;
    for (let s = 0; s < 4; s++) {
      const [colour, alpha] = S[SEASON_KEYS[s]!][key] as readonly [PaletteKey, number];
      const k = w[s]! * alpha;
      const c = RGBS[colour];
      r += c[0] * k; g += c[1] * k; b += c[2] * k; a += k;
    }
  }
  out[0] = r; out[1] = g; out[2] = b; out[3] = a;
  return out;
}

export class SeasonLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private cls: Uint8Array;
  private readonly target = new Float64Array(4);
  private readonly now = new Float64Array(4);
  private readonly drawn = new Float64Array(4).fill(-1);
  private classesDirty = true;
  private map: MapData;
  enabled = false;
  // Stipple (phase 2): one mask per class, one 4×4 pattern per class, composed into `layer`.
  private layer: HTMLCanvasElement | null = null;
  private scratch: HTMLCanvasElement | null = null;
  private masks: HTMLCanvasElement[] = [];
  private stippleKey = '';
  private patterns = new Map<string, CanvasPattern>();

  constructor(map: MapData) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.width = map.width;
    this.canvas.height = map.height;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(map.width, map.height);
    this.cls = new Uint8Array(map.width * map.height);
  }

  setMap(map: MapData): void { this.map = map; this.classesDirty = true; }
  tilesChanged(): void { this.classesDirty = true; }

  /**
   * The month on screen, 0 ≤ m < 12 with a fraction (the screen clock, speeds plan Phase 3).
   * A whole month m gives the same weights as before the clock. Snaps when `snap` (a jump in time).
   */
  setMonth(month: number, snap = false): void {
    seasonTarget(month, this.show, this.target);
    if (snap) this.now.set(this.target);
  }

  /** How much of the turning year shows, 1 to 0 (the held look); speeds plan Phase 4. */
  show = 1;

  /** The eased weights now (for weather and sound). */
  get weights(): ArrayLike<number> { return this.now; }

  update(dtMs: number): void {
    easeWeights(this.now, this.target, dtMs);
    if (seasonDitherOn) { this.updateStipple(); return; }
    let moved = this.classesDirty;
    for (let s = 0; s < 4; s++) if (Math.abs(this.now[s]! - this.drawn[s]!) > 0.004) moved = true;
    if (!moved) return;
    if (this.classesDirty) {
      this.classesDirty = false;
      for (let i = 0; i < this.cls.length; i++) this.cls[i] = tintClass(this.map, i);
    }
    this.drawn.set(this.now);
    // One premultiplied tint per class, then un-premultiply into the image.
    const per: number[][] = [];
    for (let c = 0; c <= TintClass.Cold; c++) per.push(classTint(c, this.now, [0, 0, 0, 0]));
    const d = this.img.data;
    for (let i = 0; i < this.cls.length; i++) {
      const t = per[this.cls[i]!]!;
      const a = t[3]!;
      const o = i * 4;
      if (a <= 0) { d[o + 3] = 0; continue; }
      d[o] = t[0]! / a; d[o + 1] = t[1]! / a; d[o + 2] = t[2]! / a; d[o + 3] = Math.min(255, a * 255);
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  /**
   * Rebuilds the stipple when the classes change or a season's share moves a whole cell (1/16),
   * so easing at 1× costs a few GPU fills now and then, not a redraw per frame.
   */
  private updateStipple(): void {
    const m = this.map;
    if (this.classesDirty) {
      this.classesDirty = false;
      for (let i = 0; i < this.cls.length; i++) this.cls[i] = tintClass(m, i);
      this.buildMasks();
      this.stippleKey = '';
    }
    const counts: number[][] = [];
    for (let c = 1; c <= TintClass.Cold; c++) counts.push(stippleCounts(c, this.now));
    const key = counts.join('|');
    if (key === this.stippleKey) return;
    this.stippleKey = key;
    const W = m.width * TILE, H = m.height * TILE;
    if (!this.layer || this.layer.width !== W || this.layer.height !== H) {
      this.layer = document.createElement('canvas'); this.layer.width = W; this.layer.height = H;
      this.scratch = document.createElement('canvas'); this.scratch.width = W; this.scratch.height = H;
    }
    const lctx = this.layer.getContext('2d')!;
    const sctx = this.scratch!.getContext('2d')!;
    lctx.clearRect(0, 0, W, H);
    sctx.imageSmoothingEnabled = false;
    for (let c = 1; c <= TintClass.Cold; c++) {
      const n = counts[c - 1]!;
      if (n.every((v) => v === 0)) continue;
      // Only this class's tiles: the mask scaled up crisp, then the pattern inside it.
      sctx.globalCompositeOperation = 'source-over';
      sctx.clearRect(0, 0, W, H);
      sctx.drawImage(this.masks[c]!, 0, 0, W, H);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = this.pattern(sctx, c, n);
      sctx.fillRect(0, 0, W, H);
      lctx.drawImage(this.scratch!, 0, 0);
    }
    sctx.globalCompositeOperation = 'source-over';
  }

  /** The class's 4×4 pattern for these cell counts: each covered cell in its season's colour (cached). */
  private pattern(ctx: CanvasRenderingContext2D, cls: number, counts: number[]): CanvasPattern {
    const key = `${cls}:${counts.join(',')}`;
    let p = this.patterns.get(key);
    if (p) return p;
    const cells = stippleCells(counts);
    const tile = document.createElement('canvas');
    tile.width = tile.height = 4;
    const tctx = tile.getContext('2d')!;
    for (let k = 0; k < CELLS; k++) {
      const s = cells[k]!;
      if (s < 0) continue;
      tctx.fillStyle = worldHex((S[SEASON_KEYS[s]!][CLASS_KEYS[cls - 1]!] as readonly [PaletteKey, number])[0]);
      tctx.fillRect(k & 3, k >> 2, 1, 1);
    }
    p = ctx.createPattern(tile, 'repeat')!;
    this.patterns.set(key, p);
    return p;
  }

  /** One opaque-where-this-class mask per tint class, one pixel per tile. */
  private buildMasks(): void {
    const { width: w, height: h } = this.map;
    this.masks = [];
    for (let c = 0; c <= TintClass.Cold; c++) {
      const mc = document.createElement('canvas');
      mc.width = w; mc.height = h;
      const mctx = mc.getContext('2d')!;
      const img = mctx.createImageData(w, h);
      for (let i = 0; i < this.cls.length; i++) if (this.cls[i] === c) img.data[i * 4 + 3] = 255;
      mctx.putImageData(img, 0, 0);
      this.masks.push(mc);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    if (seasonDitherOn) {
      if (this.layer) ctx.drawImage(this.layer, 0, 0);
      return;
    }
    // Smoothed, so the tint fades across tile edges instead of showing the tile grid. Water
    // tiles are transparent, so near a shore the tint only thins out (no colour bleeds onto water).
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, this.map.width * TILE, this.map.height * TILE);
    ctx.restore();
  }
}
