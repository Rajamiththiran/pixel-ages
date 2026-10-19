// Seasons on all land (F8 §14.1): a tint per tile, one pixel per tile scaled up over the
// terrain. Spring greens the grass and crops, summer turns them gold, autumn colours the forest
// and stubbles the fields, winter frosts the lowland and snows on the mountains. The season's
// weights follow the month smoothly and are eased in real time: at 1× (a year a second) the
// year visibly turns; at 8× it blurs toward the yearly average instead of flashing.

import { CONFIG } from '../config';
import { Ground, Plant, WallType } from '../shared/ids';
import type { MapData } from '../shared/types';
import { RGBS, type PaletteKey } from './palette';

const S = CONFIG.render.f8.season;
const TILE = CONFIG.map.tilePx;

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

  /** The month on screen (0–11). Snaps when `snap` (a jump in time), else eases. */
  setMonth(month: number, snap = false): void {
    seasonWeights(month + 0.5, this.target);
    if (snap) this.now.set(this.target);
  }

  /** The eased weights now (for weather and sound). */
  get weights(): ArrayLike<number> { return this.now; }

  update(dtMs: number): void {
    const k = 1 - Math.exp(-dtMs / S.easeMs);
    for (let s = 0; s < 4; s++) this.now[s] = this.now[s]! + (this.target[s]! - this.now[s]!) * k;
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

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    // Smoothed, so the tint fades across tile edges instead of showing the tile grid. Water
    // tiles are transparent, so near a shore the tint only thins out (no colour bleeds onto water).
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, this.map.width * TILE, this.map.height * TILE);
    ctx.restore();
  }
}
