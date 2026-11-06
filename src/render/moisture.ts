// How wet the grass looks (seasons plan Phase 1b): each season's grass has a dry, a normal and a
// lush ramp. A tile's wetness comes from the rain the screen shows (the simulation's rain, sliding
// over the year), nearness to water and a coarse clustered noise, so the classes lie in patches
// that follow the rain. Per pixel it is smoothed between tile centres and its edge dithered with
// the 4×4 Bayer matrix (readme: "banded or dithered, never blurred"). Drawing only.

import { CONFIG } from '../config';
import { hash01 } from '../shared/hash';
import type { MapData } from '../shared/types';
import { bayer } from './dither';
import { Moist, type MatBuf } from './materials';
import { isWaterTile } from './terrainDetail';

const TILE = CONFIG.map.tilePx;
const MO = CONFIG.render.seasons.moisture;

/** Smooth value noise 0–1 on a lattice `cell` tiles apart (one octave; render only, so floats are fine). */
function cellNoise(x: number, y: number, cell: number, salt: number): number {
  const fx = x / cell, fy = y / cell;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  const sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay);
  const a = hash01(x0, y0, salt), b = hash01(x0 + 1, y0, salt), c = hash01(x0, y0 + 1, salt), d = hash01(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** Tiles (8-way) from each tile to the nearest water tile, capped at `waterReachTiles` + 1. */
export function waterDistance(map: MapData, out: Uint8Array): void {
  const { width: w, height: h } = map;
  const cap = MO.waterReachTiles + 1;
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (let i = 0; i < w * h; i++) {
    if (isWaterTile(map, i)) { out[i] = 0; queue[tail++] = i; } else out[i] = cap;
  }
  while (head < tail) {
    const i = queue[head++]!;
    const d = out[i]! + 1;
    if (d >= cap) continue;
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (out[j]! > d) { out[j] = d; queue[tail++] = j; }
      }
    }
  }
}

/** A tile's wetness: rain ÷ 100, more near water, plus clustered noise. */
export function tileWetness(rain: number, waterDist: number, noise: number): number {
  const near = Math.max(0, 1 - waterDist / (MO.waterReachTiles + 1));
  return rain / 100 + MO.waterBonus * near + MO.noiseAmp * (noise - 0.5);
}

/** The class of a wetness value. */
export const moistClass = (v: number): Moist => (v >= MO.lushAbove ? Moist.Lush : v <= MO.dryBelow ? Moist.Dry : Moist.Normal);

/** One map's wetness per tile, and the pixel classes it gives. */
export class MoistureField {
  readonly wet: Float32Array;
  private readonly noise: Float32Array;
  private readonly dist: Uint8Array;
  // The class a tile's pixels all share (−1 when they mix), for the last wetness the pixels were set from.
  private readonly uniform: Int8Array;
  private distReady = false;
  private ready = false;           // the pixel classes have been set at least once

  constructor(private readonly w: number, private readonly h: number) {
    const n = w * h;
    this.wet = new Float32Array(n);
    this.noise = new Float32Array(n);
    this.dist = new Uint8Array(n);
    this.uniform = new Int8Array(n).fill(Moist.Normal);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.noise[y * w + x] = cellNoise(x + 0.5, y + 0.5, MO.noiseCellTiles, MO.noiseSalt);
  }

  /** The land or water changed: nearness to water is worked out again on the next update. */
  landChanged(): void { this.distReady = false; }

  /**
   * New wetness from `rain` (per tile, 0–100). Writes the pixel classes of every tile whose classes
   * may have changed into `buf.moist` and calls `changed` for each tile that did change.
   */
  update(map: MapData, rain: ArrayLike<number>, buf: MatBuf, changed: (i: number) => void): void {
    if (!this.distReady) { waterDistance(map, this.dist); this.distReady = true; }
    const { w, h } = this;
    // Most calls follow land changes that leave the water where it was: nothing to recheck then.
    let moved = !this.ready;
    for (let i = 0; i < w * h; i++) {
      const v = tileWetness(rain[i]!, this.dist[i]!, this.noise[i]!);
      if (v !== this.wet[i]) { this.wet[i] = v; moved = true; }
    }
    if (!moved) return;
    this.ready = true;
    const half = MO.ditherWidth / 2;
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        // Every pixel value lies between the lowest and highest wetness of the tile and its 8
        // neighbours (smoothing between centres), give or take the dither.
        let lo = Infinity, hi = -Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = this.wet[Math.min(h - 1, Math.max(0, ty + dy)) * w + Math.min(w - 1, Math.max(0, tx + dx))]!;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        const a = moistClass(lo - half), b = moistClass(hi + half);
        const i = ty * w + tx;
        if (a === b && this.uniform[i] === a) continue;   // all one class before and after
        this.uniform[i] = a === b ? a : -1;
        if (this.classifyTile(buf, tx, ty)) changed(i);
      }
    }
  }

  /** Sets the class of each pixel of tile (tx, ty); true if any changed. */
  private classifyTile(buf: MatBuf, tx: number, ty: number): boolean {
    let any = false;
    for (let oy = 0; oy < TILE; oy++) {
      const py = ty * TILE + oy;
      for (let ox = 0; ox < TILE; ox++) {
        const px = tx * TILE + ox;
        const c = moistClass(this.at(px, py) + (bayer(px, py) - 0.5) * MO.ditherWidth);
        const p = py * buf.w + px;
        if (buf.moist[p] !== c) { buf.moist[p] = c; any = true; }
      }
    }
    return any;
  }

  /** Wetness at a pixel: bilinear between tile centres. */
  at(px: number, py: number): number {
    const { w, h } = this;
    const fx = Math.min(w - 1, Math.max(0, (px + 0.5) / TILE - 0.5));
    const fy = Math.min(h - 1, Math.max(0, (py + 0.5) / TILE - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0, m = this.wet;
    return (m[y0 * w + x0]! * (1 - ax) + m[y0 * w + x1]! * ax) * (1 - ay) + (m[y1 * w + x0]! * (1 - ax) + m[y1 * w + x1]! * ax) * ay;
  }
}
