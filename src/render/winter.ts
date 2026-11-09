// Snow and ice (seasons plan Phase 2c, mockup B). Each land pixel has a fixed place in the order
// winter snow reaches it (high ground and the north first, in clustered patches: the mockup's
// arrW), and each water pixel a fixed place in the order ice reaches it (from the shore inward;
// small ponds right through, rivers only at their edges, the sea never). Over a winter a snow line
// and an ice line rise through those orders, so every pixel is covered once and stays covered
// until the spring that reaches it. Drawing only: the simulation has no snow or ice.

import { CONFIG } from '../config';
import { Ground, WallType } from '../shared/ids';
import { hash01 } from '../shared/hash';
import type { MapData } from '../shared/types';
import { isWaterTile } from './terrainDetail';

const TILE = CONFIG.map.tilePx;
const SN = CONFIG.render.seasons.snow;
const IC = CONFIG.render.seasons.ice;
const MAX_ELEVATION = CONFIG.editor.maxElevation;

/** The value of a pixel that is never covered (water for snow; land, the sea, a lake's open middle for ice). */
export const NEVER = 255;

/** Smooth value noise 0–1 on a lattice `cell` px apart (render only, so floats are fine). */
function cellNoise(x: number, y: number, cell: number, salt: number): number {
  const fx = x / cell, fy = y / cell;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  const sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay);
  const a = hash01(x0, y0, salt), b = hash01(x0 + 1, y0, salt), c = hash01(x0, y0 + 1, salt), d = hash01(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

const mountainous = (map: MapData, i: number): boolean => map.ground[i] === Ground.Mountain || map.wall[i] === WallType.Mountain;

/** Height 0–1 at a pixel, smoothed between tile centres; mountains count as the highest. */
function heightAt(map: MapData, px: number, py: number): number {
  const w = map.width, h = map.height;
  const fx = Math.min(w - 1, Math.max(0, (px + 0.5) / TILE - 0.5)), fy = Math.min(h - 1, Math.max(0, (py + 0.5) / TILE - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const ax = fx - x0, ay = fy - y0;
  const at = (x: number, y: number): number => { const i = y * w + x; return mountainous(map, i) ? 1 : map.elevation[i]! / MAX_ELEVATION; };
  return (at(x0, y0) * (1 - ax) + at(x1, y0) * ax) * (1 - ay) + (at(x0, y1) * (1 - ax) + at(x1, y1) * ax) * ay;
}

/** The pixels with a value below NEVER, sorted by it (a counting sort), and where each value starts. */
function sortByValue(values: Uint8Array): [Int32Array, Int32Array] {
  const start = new Int32Array(257);
  for (const v of values) if (v !== NEVER) start[v + 1]!++;
  for (let v = 1; v <= 256; v++) start[v] = start[v]! + start[v - 1]!;
  const order = new Int32Array(start[256]!);
  const at = start.slice(0, 256);
  for (let p = 0; p < values.length; p++) { const v = values[p]!; if (v !== NEVER) order[at[v]!++] = p; }
  return [order, start];
}

/** One map's snow and ice orders, per pixel. */
export class WinterField {
  readonly cold: Uint8Array;     // land: 0 snows first … 254 last; water NEVER
  readonly ice: Uint8Array;      // water: 0 freezes first … 254 last; NEVER for land, the sea, open water
  readonly ponds: Uint8Array;    // per tile: 1 = part of a still water body small enough to freeze through
  // The covered pixels sorted by their order (value v: indices list[start[v]] … list[start[v + 1] − 1]),
  // so a moved line recolours only the band it crossed.
  coldList: Int32Array = new Int32Array(0);
  coldStart: Int32Array = new Int32Array(257);
  iceList: Int32Array = new Int32Array(0);
  iceStart: Int32Array = new Int32Array(257);
  private readonly water: Uint8Array;
  private ready = false;
  readonly pw: number;
  readonly ph: number;

  constructor(private readonly w: number, private readonly h: number) {
    this.pw = w * TILE; this.ph = h * TILE;
    this.cold = new Uint8Array(this.pw * this.ph).fill(NEVER);
    this.ice = new Uint8Array(this.pw * this.ph).fill(NEVER);
    this.ponds = new Uint8Array(w * h);
    this.water = new Uint8Array(w * h);
  }

  /** Tiles changed: true (and worked out again on the next `ensure`) when water came or went. */
  tilesChanged(map: MapData, tiles: readonly number[]): boolean {
    if (!this.ready) return true;
    for (const i of tiles) if ((isWaterTile(map, i) ? 1 : 0) !== this.water[i]) { this.ready = false; return true; }
    return false;
  }

  /** A new map. */
  invalidate(): void { this.ready = false; }

  /** Works the orders out if the land or water changed; true when it did. */
  ensure(map: MapData): boolean {
    if (this.ready) return false;
    this.ready = true;
    for (let i = 0; i < this.w * this.h; i++) this.water[i] = isWaterTile(map, i) ? 1 : 0;
    this.snowOrder(map);
    this.iceOrder(map);
    [this.coldList, this.coldStart] = sortByValue(this.cold);
    [this.iceList, this.iceStart] = sortByValue(this.ice);
    return true;
  }

  /** Snow: the raw arrival per land pixel, then its share of the land (a histogram, so the line moves evenly). */
  private snowOrder(map: MapData): void {
    const { pw, ph } = this;
    const raw = new Float32Array(pw * ph);
    const BINS = 2048;
    const hist = new Uint32Array(BINS);
    let land = 0;
    for (let py = 0; py < ph; py++) {
      const ty = Math.floor(py / TILE);
      for (let px = 0; px < pw; px++) {
        const p = py * pw + px;
        if (this.water[ty * this.w + Math.floor(px / TILE)]) { raw[p] = -1; continue; }
        const n = 0.65 * cellNoise(px, py, SN.noiseCellPx, SN.noiseSalt) + 0.35 * cellNoise(px, py, SN.noiseCellPx / 3, SN.noiseSalt + 1);
        const v = (SN.heightWeight * (1 - heightAt(map, px, py)) + SN.latitudeWeight * (py / ph) + SN.noiseWeight * n)
          / (SN.heightWeight + SN.latitudeWeight + SN.noiseWeight);
        raw[p] = v;
        hist[Math.min(BINS - 1, Math.floor(v * BINS))]!++;
        land++;
      }
    }
    // Share of the land below each bin.
    const below = new Float32Array(BINS);
    let sum = 0;
    for (let b = 0; b < BINS; b++) { below[b] = land > 0 ? sum / land : 0; sum += hist[b]!; }
    for (let p = 0; p < raw.length; p++) {
      const v = raw[p]!;
      this.cold[p] = v < 0 ? NEVER : Math.min(254, Math.floor(below[Math.min(BINS - 1, Math.floor(v * BINS))]! * 255));
    }
  }

  /**
   * Ice: each water pixel's distance in px from the nearest land pixel (8-way), then its place:
   * a lake or river freezes out to its rim width, a small pond right through, the sea never.
   */
  private iceOrder(map: MapData): void {
    const { pw, ph, w, h } = this;
    // Still water bodies (4-way) and their size, to tell ponds from lakes.
    const comp = new Int32Array(w * h).fill(-1);
    const size: number[] = [];
    const still = (i: number): boolean => this.water[i] === 1 && map.wall[i] === WallType.None;
    for (let i = 0; i < w * h; i++) {
      if (comp[i]! >= 0 || !still(i)) continue;
      const id = size.length, stack = [i];
      comp[i] = id;
      let n = 0;
      while (stack.length > 0) {
        const j = stack.pop()!; n++;
        const x = j % w, y = (j - x) / w;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (comp[k]! < 0 && still(k)) { comp[k] = id; stack.push(k); }
        }
      }
      size.push(n);
    }
    for (let i = 0; i < w * h; i++) this.ponds[i] = comp[i]! >= 0 && size[comp[i]!]! <= IC.pondMaxTiles ? 1 : 0;
    // Distance from land, per pixel.
    const dist = new Uint8Array(pw * ph).fill(255);
    const queue = new Int32Array(pw * ph);
    let head = 0, tail = 0;
    const waterPx = (p: number): boolean => this.water[Math.floor(Math.floor(p / pw) / TILE) * w + Math.floor((p % pw) / TILE)] === 1;
    for (let p = 0; p < pw * ph; p++) if (!waterPx(p)) { dist[p] = 0; queue[tail++] = p; }
    while (head < tail) {
      const p = queue[head++]!;
      const d = dist[p]! + 1;
      if (d >= 255) continue;
      const x = p % pw, y = (p - x) / pw;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= pw || ny >= ph) continue;
          const q = ny * pw + nx;
          if (dist[q]! > d) { dist[q] = d; queue[tail++] = q; }
        }
      }
    }
    // The deepest pixel of each pond, so a pond is frozen through when the line is full.
    const deepest = new Uint8Array(size.length);
    for (let p = 0; p < pw * ph; p++) {
      const i = Math.floor(Math.floor(p / pw) / TILE) * w + Math.floor((p % pw) / TILE);
      if (this.ponds[i] && dist[p]! > deepest[comp[i]!]!) deepest[comp[i]!] = dist[p]!;
    }
    for (let p = 0; p < pw * ph; p++) {
      const x = p % pw, y = (p - x) / pw;
      const i = Math.floor(y / TILE) * w + Math.floor(x / TILE);
      const d = dist[p]!;
      if (!this.water[i] || map.wall[i] === WallType.Sea) { this.ice[p] = NEVER; continue; }
      if (this.ponds[i]) { this.ice[p] = Math.min(254, Math.floor(((d - 1) / Math.max(1, deepest[comp[i]!]!)) * 255)); continue; }
      const [a, b] = map.wall[i] === WallType.River ? IC.riverRimPx : IC.lakeRimPx;
      const rim = a! + cellNoise(x, y, IC.noiseCellPx, IC.noiseSalt) * (b! - a!);
      this.ice[p] = d > rim ? NEVER : Math.min(254, Math.floor(((d - 1) / rim) * 255));
    }
  }
}
