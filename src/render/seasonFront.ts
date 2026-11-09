// The season front (seasons plan Phase 3a, §6.2; mockup C). A season does not arrive row by row: it
// starts in several spots and spreads like a fungus. For each front field (warm: spring and summer;
// autumn; cold: winter and the snow) every pixel gets one fixed arrival:
//
//   A(p) = min over seeds s of ( start(s) + cost(s → p) )
//
// Seeds sit one per square at a hashed spot; an early spot (low and south for warm, high and north
// for the others, plus a hash) starts first. Growth is cheaper or dearer by clustered noise and by
// height, so patches are lumpy and follow the valleys. A becomes the pixel's share of the land
// (the front moves evenly), and the share its key (0–255) with a Bayer-dithered edge: a pixel shows
// the new season once the front's level passes its key, so it changes once per front. Drawing only.

import { CONFIG } from '../config';
import { hash01 } from '../shared/hash';
import type { MapData } from '../shared/types';
import { bayer } from './dither';
import { cellNoise } from './moisture';
import { isWaterTile } from './terrainDetail';
import { heightAt, mountainous } from './winter';

const TILE = CONFIG.map.tilePx;
const FC = CONFIG.render.seasons.front;

/** The three fields a front can follow. */
export const FrontKind = { Warm: 0, Autumn: 1, Cold: 2 } as const;
const KINDS = 3;
/** The field each season's front follows (spring, summer, autumn, winter). */
export const FRONT_KIND = [FrontKind.Warm, FrontKind.Warm, FrontKind.Autumn, FrontKind.Cold] as const;

const BINS = 4096;

/** One map's front fields: the key each pixel turns at, per field. */
export class FrontFields {
  readonly pw: number;
  readonly ph: number;
  private readonly base: Uint8Array[] = [];
  /** The cold field's share of the land per pixel (0 first … 1 last; water −1): the order snow lies in. */
  readonly coldShare: Float32Array;
  private readonly heights: Int16Array;   // per tile: the height the fields were worked out for
  private ready = false;

  constructor(private readonly w: number, private readonly h: number) {
    this.pw = w * TILE; this.ph = h * TILE;
    for (let k = 0; k < KINDS; k++) this.base.push(new Uint8Array(this.pw * this.ph));
    this.coldShare = new Float32Array(this.pw * this.ph);
    this.heights = new Int16Array(w * h).fill(-1);
  }

  /** A new map. */
  invalidate(): void { this.ready = false; }

  /** Worked out for the land as it is? */
  get isReady(): boolean { return this.ready; }

  /** A whole new map: true (worked out again on the next `ensure`) if any tile's height differs. */
  heightsChanged(map: MapData): boolean {
    if (!this.ready || map.width !== this.w || map.height !== this.h) { this.ready = false; return true; }
    for (let i = 0; i < this.w * this.h; i++) if (tileHeight(map, i) !== this.heights[i]) { this.ready = false; return true; }
    return false;
  }

  /** Tiles changed: true (worked out again on the next `ensure`) when the height of one did. */
  tilesChanged(map: MapData, tiles: readonly number[]): boolean {
    if (!this.ready) return true;
    for (const i of tiles) if (tileHeight(map, i) !== this.heights[i]) { this.ready = false; return true; }
    return false;
  }

  /** Works the fields out if the land's height changed; true when it did. */
  ensure(map: MapData): boolean {
    if (this.ready) return false;
    this.ready = true;
    for (let i = 0; i < this.w * this.h; i++) this.heights[i] = tileHeight(map, i);
    const arrival = new Float32Array(this.pw * this.ph);
    // Which pixels are land (the front moves evenly over the land); all water: the whole map.
    const tileLand = new Uint8Array(this.w * this.h);
    let anyLand = false;
    for (let i = 0; i < tileLand.length; i++) { tileLand[i] = isWaterTile(map, i) ? 0 : 1; anyLand ||= tileLand[i] === 1; }
    if (!anyLand) tileLand.fill(1);
    const land = new Uint8Array(this.pw * this.ph);
    for (let py = 0; py < this.ph; py++) {
      const row = Math.floor(py / TILE) * this.w;
      for (let px = 0; px < this.pw; px++) land[py * this.pw + px] = tileLand[row + Math.floor(px / TILE)]!;
    }
    const G = FC.gridPx, hts = nodeHeights(map, Math.ceil(this.pw / G), Math.ceil(this.ph / G));
    for (let k = 0; k < KINDS; k++) {
      upsample(grow(map, k, this.pw, this.ph, hts), this.pw, this.ph, arrival);
      this.toKeys(arrival, land, anyLand, this.base[k]!, k === FrontKind.Cold ? this.coldShare : null);
    }
    return true;
  }

  /** The keys of field `kind` in `year` (the fixed base, shifted a little in patches each year: S15) into `out`. */
  keys(kind: number, year: number, out: Uint8Array): void {
    const base = this.base[kind]!;
    const amp = FC.yearJitter * 255;
    if (amp <= 0) { out.set(base); return; }
    // The shift on a 4 px grid: it changes by a fraction of a key from one cell to the next.
    const { pw, ph } = this;
    const gw = Math.ceil(pw / 4), gh = Math.ceil(ph / 4);
    const shift = new Int16Array(gw * gh);
    const salt = FC.salt + 20 + kind * 7 + year * 31;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) shift[gy * gw + gx] = Math.round(amp * (cellNoise(gx * 4 + 2, gy * 4 + 2, FC.yearJitterCellPx, salt) - 0.5));
    }
    for (let py = 0; py < ph; py++) {
      const row = (py >> 2) * gw, o = py * pw;
      for (let px = 0; px < pw; px++) {
        const v = base[o + px]! + shift[row + (px >> 2)]!;
        out[o + px] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }

  /** Arrival → share of the land (a histogram) → key with the Bayer edge. */
  private toKeys(a: Float32Array, land: Uint8Array, anyLand: boolean, out: Uint8Array, share: Float32Array | null): void {
    const { pw, ph } = this, n0 = pw * ph;
    let lo = Infinity, hi = -Infinity;
    for (let p = 0; p < n0; p++) {
      if (land[p] === 0) continue;
      const v = a[p]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const scale = BINS / Math.max(1e-6, hi - lo);
    // Each pixel's bin, kept for the last pass.
    const bins = new Uint16Array(n0);
    const hist = new Uint32Array(BINS);
    let n = 0;
    for (let p = 0; p < n0; p++) {
      const b = Math.floor((a[p]! - lo) * scale);
      bins[p] = b < 0 ? 0 : b >= BINS ? BINS - 1 : b;
      if (land[p] !== 0) { hist[bins[p]!]!++; n++; }
    }
    // A pixel's share: the land below its bin, plus half its own bin (so a flat field sits mid-way).
    const below = new Float32Array(BINS);
    let sum = 0;
    for (let b = 0; b < BINS; b++) { below[b] = n > 0 ? (sum + hist[b]! / 2) / n : 0; sum += hist[b]!; }
    const edge = FC.edgeShare;
    for (let py = 0; py < ph; py++) {
      for (let px = 0; px < pw; px++) {
        const p = py * pw + px;
        const q = below[bins[p]!]!;
        const v = Math.round((q + (bayer(px, py) - 0.5) * edge) * 255);
        out[p] = v < 0 ? 0 : v > 255 ? 255 : v;
        if (share) share[p] = anyLand && land[p] !== 0 ? q : -1;
      }
    }
  }
}

/** A tile's height for the fields (mountains count as the highest). */
const tileHeight = (map: MapData, i: number): number => (mountainous(map, i) ? 1000 : map.elevation[i]!);

/**
 * The arrival time at each grid node (gridPx apart) of field `kind`: seeds started at their time,
 * grown with Dial's bucket queue (step costs are small integers), 8-way so patches are round, not diamonds.
 */
export function grow(map: MapData, kind: number, pw: number, ph: number, heights?: Float32Array): { t: Float32Array; gw: number; gh: number } {
  const G = FC.gridPx;
  const gw = Math.ceil(pw / G), gh = Math.ceil(ph / G), n = gw * gh;
  const warm = kind === FrontKind.Warm;
  const salt = FC.salt + kind * 5;
  const hts = heights ?? nodeHeights(map, gw, gh);
  const nz = new Float32Array(n);
  FC.noiseCellPx.forEach((cell, o) => addNoise(nz, gw, gh, cell, salt + o, FC.noiseWeights[o]!));
  const cost = new Uint16Array(n);
  let maxCost = 1;
  for (let i = 0; i < n; i++) {
    const ht = hts[i]!;
    const c = Math.max(1, Math.round(FC.stepCost * (1 + FC.noiseAmp * (nz[i]! - 0.5)) * (1 + FC.slope * (warm ? ht : 1 - ht))));
    cost[i] = c;
    if (c > maxCost) maxCost = c;
  }
  // Seeds: one per square, at a hashed spot; its start from how early its spot is.
  const S = FC.seedCellPx;
  const seeds: Array<[number, number]> = [];   // [start, node]
  const wsum = FC.heightWeight + FC.latitudeWeight + FC.jitterWeight;
  for (let cy = 0; cy * S < ph; cy++) {
    for (let cx = 0; cx * S < pw; cx++) {
      const x = Math.min(pw - 1, Math.floor(cx * S + hash01(cx, cy, salt + 2) * S));
      const y = Math.min(ph - 1, Math.floor(cy * S + hash01(cx, cy, salt + 3) * S));
      const ht = heightAt(map, x, y);
      const north = 1 - y / ph;
      const late = (FC.heightWeight * (warm ? ht : 1 - ht) + FC.latitudeWeight * (warm ? north : 1 - north)
        + FC.jitterWeight * hash01(cx, cy, salt + 4)) / wsum;
      seeds.push([Math.round(late * (FC.startSpreadPx / G) * FC.stepCost), Math.floor(y / G) * gw + Math.floor(x / G)]);
    }
  }
  seeds.sort((a, b) => a[0] - b[0]);
  const HALF_DIAG = Math.SQRT2 / 2;
  const B = Math.ceil(maxCost * Math.SQRT2) + 2;
  // Buckets as linked lists in typed arrays (entry e: node[e], the next entry nxt[e]); a node may
  // be listed more than once (the later, longer entries are skipped).
  const head = new Int32Array(B).fill(-1);
  let node = new Int32Array(n * 4), nxt = new Int32Array(n * 4), used = 0;
  const push = (b: number, j: number): void => {
    if (used === node.length) {
      const a = new Int32Array(used * 2), c = new Int32Array(used * 2);
      a.set(node); c.set(nxt); node = a; nxt = c;
    }
    node[used] = j; nxt[used] = head[b]!; head[b] = used++;
  };
  const dist = new Int32Array(n).fill(0x7fffffff);
  let pending = 0, next = 0, cur = seeds.length > 0 ? seeds[0]![0] : 0;
  while (pending > 0 || next < seeds.length) {
    if (pending === 0 && seeds[next]![0] > cur) cur = seeds[next]![0];
    while (next < seeds.length && seeds[next]![0] <= cur) {
      const [s, j] = seeds[next++]!;
      if (s < dist[j]!) { dist[j] = s; push(s % B, j); pending++; }
    }
    const b = cur % B;
    while (head[b] !== -1) {
      const e0 = head[b]!;
      head[b] = nxt[e0]!;
      const i = node[e0]!;
      pending--;
      if (dist[i] !== cur) continue;   // reached sooner by another path
      const x = i % gw, y = (i - x) / gw, ci = cost[i]!;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= gw) continue;
          const j = ny * gw + nx;
          const s = ci + cost[j]!;
          const d = cur + (dx !== 0 && dy !== 0 ? Math.round(s * HALF_DIAG) : (s + 1) >> 1);
          if (d < dist[j]!) { dist[j] = d; push(d % B, j); pending++; }
        }
      }
    }
    // Popped entries are not reused; start over once the lists are empty, so the pool stays small.
    if (pending === 0) used = 0;
    cur++;
  }
  // Ragged edges: growth alone makes round patches (the cost noise averages out over distance).
  const amp = (2 * FC.edgeNoisePx / G) * FC.stepCost;
  const en = new Float32Array(n);
  FC.edgeNoiseCellPx.forEach((cell, o) => addNoise(en, gw, gh, cell, salt + 5 + o, FC.edgeNoiseWeights[o]!));
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = dist[i]! + amp * (en[i]! - 0.5);
  return { t, gw, gh };
}

/** Height (0–1, mountains the highest) at each grid node's centre. */
export function nodeHeights(map: MapData, gw: number, gh: number): Float32Array {
  const G = FC.gridPx, out = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) out[gy * gw + gx] = heightAt(map, gx * G + G / 2, gy * G + G / 2);
  return out;
}

/**
 * Adds `weight` × value noise (cells `cell` px wide; the same values as moisture.ts cellNoise at the
 * node centres) to each grid node. The lattice is hashed once, not four times per node.
 */
function addNoise(out: Float32Array, gw: number, gh: number, cell: number, salt: number, weight: number): void {
  const G = FC.gridPx;
  const lw = Math.floor((gw * G) / cell) + 2, lh = Math.floor((gh * G) / cell) + 2;
  const lat = new Float32Array(lw * lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) lat[y * lw + x] = hash01(x, y, salt);
  const sx = new Float32Array(gw), x0s = new Int32Array(gw);
  for (let gx = 0; gx < gw; gx++) {
    const fx = (gx * G + G / 2) / cell, x0 = Math.floor(fx), ax = fx - x0;
    x0s[gx] = x0; sx[gx] = ax * ax * (3 - 2 * ax);
  }
  for (let gy = 0; gy < gh; gy++) {
    const fy = (gy * G + G / 2) / cell, y0 = Math.floor(fy), ay = fy - y0, sy = ay * ay * (3 - 2 * ay);
    const r0 = y0 * lw, r1 = r0 + lw, o = gy * gw;
    for (let gx = 0; gx < gw; gx++) {
      const x0 = x0s[gx]!, s = sx[gx]!;
      const a = lat[r0 + x0]!, b = lat[r0 + x0 + 1]!, c = lat[r1 + x0]!, d = lat[r1 + x0 + 1]!;
      out[o + gx] = out[o + gx]! + weight * ((a + (b - a) * s) * (1 - sy) + (c + (d - c) * s) * sy);
    }
  }
}

/** Grid times → one per pixel, bilinear between node centres (no blocky steps). */
function upsample(g: { t: Float32Array; gw: number; gh: number }, pw: number, ph: number, out: Float32Array): void {
  const G = FC.gridPx, { t, gw, gh } = g;
  for (let py = 0; py < ph; py++) {
    const fy = Math.min(gh - 1, Math.max(0, (py + 0.5) / G - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ay = fy - y0;
    for (let px = 0; px < pw; px++) {
      const fx = Math.min(gw - 1, Math.max(0, (px + 0.5) / G - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), ax = fx - x0;
      const a = t[y0 * gw + x0]!, b = t[y0 * gw + x1]!, c = t[y1 * gw + x0]!, d = t[y1 * gw + x1]!;
      out[py * pw + px] = (a + (b - a) * ax) * (1 - ay) + (c + (d - c) * ax) * ay;
    }
  }
}
