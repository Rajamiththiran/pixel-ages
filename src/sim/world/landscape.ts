// People change the landscape (future blueprint F4, §10): slopes and erosion, overgrazing,
// local drying, paths and roads, canals and terraces, burning forest edges, quarries and ruins.
// Also packs the per-tile "marks" byte the renderer draws them from.

import { CONFIG } from '../../config';
import { Ground, Plant, WallType } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import type { Group, SimState } from '../state';
import { hasActive } from '../people/explore';
import { rainFactor } from './climate';
import { Farmed } from '../people/farming';
import { Mark } from '../../shared/protocol';

const FU = CONFIG.future;
const WR = FU.wear;


// ---------- slopes ----------

const slopeCache = new WeakMap<Uint8Array, Uint8Array>();

/**
 * Slope of every tile (fixed for a run): the largest height difference to an 8-neighbour
 * (painted elevation, D7). Mountain ground and tiles next to a mountain range are at least
 * slope 2, so maps painted without heights still have hills (§10.3 fallback).
 */
export function slopes(s: SimState): Uint8Array {
  let c = slopeCache.get(s.elevation);
  if (c) return c;
  const w = s.width;
  const h = s.height;
  c = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = s.elevation[i]!;
      let slope = 0;
      let nearRange = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          slope = Math.max(slope, Math.abs(s.elevation[j]! - e));
          if (s.wall[j] === WallType.Mountain) nearRange = true;
        }
      }
      if (s.ground[i] === Ground.Mountain || nearRange) slope = Math.max(slope, FU.erosion.mountainSlope);
      c[i] = slope;
    }
  }
  slopeCache.set(s.elevation, c);
  return c;
}

// ---------- paths and roads (§10.6) ----------

/**
 * Wears the straight line from (x0, y0) to (x1, y1) by `amount` (both ends included, capped
 * at 255). Walkers from a group with the Wheel mark it fit for a road.
 */
export function addWear(s: SimState, x0: number, y0: number, x1: number, y1: number, amount: number, wheel: boolean): void {
  if (amount <= 0) return;
  const w = s.width;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    const i = y * w + x;
    s.wear[i] = Math.min(255, s.wear[i]! + amount);
    if (wheel) s.roadOK[i] = 1;
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/** One worker-month from home to `tile` (bands, and village farmers per field). */
export function walk(s: SimState, g: Group, tile: number, workers = 1): void {
  if (tile < 0) return;
  const home = g.homeY * s.width + g.homeX;
  if (tile === home) return;
  addWear(s, g.homeX, g.homeY, tile % s.width, Math.floor(tile / s.width),
    Math.round(workers * WR.perWorkerMonth), hasActive(g, Discovery.wheel));
}

/** True if at least half the straight line between two homes is road (contact reaches 1.5× as far). */
export function roadBetween(s: SimState, a: Group, b: Group): boolean {
  const w = s.width;
  let x = a.homeX, y = a.homeY;
  const dx = Math.abs(b.homeX - x), dy = -Math.abs(b.homeY - y);
  const sx = x < b.homeX ? 1 : -1, sy = y < b.homeY ? 1 : -1;
  let err = dx + dy, road = 0, all = 0;
  for (;;) {
    const i = y * w + x;
    all++;
    if (s.wear[i]! >= WR.road && s.roadOK[i] === 1) road++;
    if (x === b.homeX && y === b.homeY) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return road * 2 >= all;
}

// ---------- ruins (§10.8) ----------

/**
 * A settlement is abandoned (died out, conquered, absorbed, or moved away): its building tiles
 * become ruins. Small camps with no buildings leave nothing. Radius 1 for up to 12 buildings, 2
 * beyond (the renderer lays buildings out around home).
 */
export function leaveRuins(s: SimState, g: Group): void {
  const buildings = g.huts + g.houses;
  if (buildings === 0) return;
  const r = buildings <= 12 ? 1 : 2;
  const w = s.width;
  for (let y = Math.max(0, g.homeY - r); y <= Math.min(s.height - 1, g.homeY + r); y++) {
    for (let x = Math.max(0, g.homeX - r); x <= Math.min(w - 1, g.homeX + r); x++) {
      const i = y * w + x;
      if (s.ground[i] === Ground.Water || (s.wall[i] !== WallType.None && s.crossing[i] === 0)) continue;
      s.ruinAge[i] = 1;
    }
  }
}

// ---------- burning forest edges (§10.4) ----------

/** A forest tile in range next to open land, nearest home first (ties → lowest index); −1 if none. */
export function burnTarget(s: SimState, g: Group, range: readonly number[]): number {
  const w = s.width;
  let best = -1, bestD = Infinity;
  for (const i of range) {
    if (s.plantType[i] !== Plant.Forest) continue;
    const x = i % w, y = (i - x) / w;
    let edge = false;
    for (const j of [i - w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i + w]) {
      if (j < 0 || j >= s.plantType.length) continue;
      if (s.plantType[j] !== Plant.Forest && s.ground[j] !== Ground.Water && s.wall[j] === WallType.None) { edge = true; break; }
    }
    if (!edge) continue;
    const d = (x - g.homeX) * (x - g.homeX) + (y - g.homeY) * (y - g.homeY);
    if (d < bestD || (d === bestD && i < best)) { best = i; bestD = d; }
  }
  return best;
}

/**
 * Burning in the wet season (Fire Safety): the forest edge becomes fresh grass on ash, where
 * grazers find new growth (Aboriginal fire-stick farming). A burn that escapes is a wildfire (F5).
 */
export function burnTile(s: SimState, i: number): void {
  s.plantType[i] = Plant.Grass;
  s.plantDensity[i] = FU.burn.grassDensity;
  s.plantFood[i] = 0;
  s.ash[i] = FU.burn.ashYears;
}

// ---------- local drying (§10.1) ----------

/** Forest share (density-weighted) of every climate cell. */
export function cellForestShares(width: number, height: number, plantType: Uint8Array, plantDensity: Uint8Array): Float32Array {
  const C = CONFIG.climate;
  const out = new Float32Array(C.cellsX * C.cellsY);
  const count = new Float32Array(out.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = cellOf(x, y, width, height);
      const i = y * width + x;
      count[c] = count[c]! + 1;
      if (plantType[i] === Plant.Forest) out[c] = out[c]! + plantDensity[i]! / 255;
    }
  }
  for (let c = 0; c < out.length; c++) out[c] = count[c]! > 0 ? out[c]! / count[c]! : 0;
  return out;
}

/** The climate cell of tile (x, y). */
export function cellOf(x: number, y: number, width: number, height: number): number {
  const C = CONFIG.climate;
  const cx = Math.min(C.cellsX - 1, Math.floor((x * C.cellsX) / width));
  const cy = Math.min(C.cellsY - 1, Math.floor((y * C.cellsY) / height));
  return cy * C.cellsX + cx;
}

// ---------- yearly ----------

let grazeScratch = new Float32Array(0);

/**
 * Yearly landscape step (F4), after plant growth and before idle fields are counted:
 * paths fade, ruins age, ash cools, canals and terraces follow this year's farming, slopes
 * erode, herds overgraze, and climate cells that lost their forest dry out.
 */
export function yearlyLandscape(s: SimState, ranges: (g: Group) => number[]): void {
  const n = s.ground.length;
  // Paths fade; a road needs its Wheel walkers every year.
  for (let i = 0; i < n; i++) {
    if (s.wear[i] !== 0) s.wear[i] = Math.floor(s.wear[i]! * WR.fadePerYear);
    if (s.wear[i]! < WR.road) s.roadOK[i] = 0;
    if (s.ruinAge[i] !== 0) s.ruinAge[i] = s.ruinAge[i]! + 1 >= FU.ruinYears ? 0 : s.ruinAge[i]! + 1;
    if (s.ash[i] !== 0) s.ash[i] = s.ash[i]! - 1;
  }

  // Canals: the tiles between each field irrigated this year and its water. Terraces stay.
  s.canal.fill(0);
  const w = s.width;
  const r = CONFIG.people.food.irrigationDistance;
  const slope = slopes(s);
  for (let i = 0; i < n; i++) {
    const flags = s.farmedThisYear[i]!;
    if (flags & Farmed.Terraced && slope[i]! > 0) s.terrace[i] = 1;
    if (!(flags & Farmed.Irrigated)) continue;
    const x = i % w, y = (i - x) / w;
    let water = -1, best = Infinity;
    for (let yy = Math.max(0, y - r); yy <= Math.min(s.height - 1, y + r); yy++) {
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        const j = yy * w + xx;
        if (s.ground[j] !== Ground.Water && s.wall[j] !== WallType.River) continue;
        const d = (xx - x) * (xx - x) + (yy - y) * (yy - y);
        if (d < best || (d === best && j < water)) { best = d; water = j; }
      }
    }
    if (water < 0) continue;
    // Walk from the field toward the water, marking land tiles.
    let cx = x, cy = y;
    const tx = water % w, ty = (water - tx) / w;
    for (let step = 0; step <= 2 * r; step++) {
      const j = cy * w + cx;
      if (s.ground[j] === Ground.Water || s.wall[j] !== WallType.None) break;
      s.canal[j] = 1;
      if (cx === tx && cy === ty) break;
      cx += Math.sign(tx - cx);
      cy += Math.sign(ty - cy);
    }
  }

  // Erosion: farmed slopes without terraces, and bare slopes, lose fertility (§10.3).
  for (let i = 0; i < n; i++) {
    if (slope[i] === 0 || s.ground[i] === Ground.Water || s.wall[i] !== WallType.None) continue;
    const plant = s.plantType[i];
    const exposed = plant === Plant.None || (plant === Plant.Farmland && s.terrace[i] === 0);
    if (exposed) s.fertility[i] = Math.max(0, s.fertility[i]! - FU.erosion.rate * slope[i]!);
  }

  // Overgrazing (§10.2): each group's herd spreads over the grazing tiles in its range.
  if (grazeScratch.length !== n) grazeScratch = new Float32Array(n);
  const graze = grazeScratch;
  graze.fill(0);
  const per = CONFIG.people.food.herdCapacityPerTile;
  for (const g of s.groups) {
    if (g.herd < 1) continue;
    const tiles = ranges(g).filter((i) => s.ground[i] !== Ground.Water && (s.plantType[i] === Plant.Grass || s.plantType[i] === Plant.None));
    if (tiles.length === 0) continue;
    const share = g.herd / tiles.length;
    for (const i of tiles) graze[i] = graze[i]! + share / (per * Math.max(0.05, rainFactor(s.rainNow[i]!)));
  }
  const G = FU.grazing;
  for (let i = 0; i < n; i++) {
    if (graze[i]! > 1 && s.plantType[i] === Plant.Grass) {
      const d = s.plantDensity[i]! - G.overgrazeLoss;
      if (d <= 0) {
        s.plantType[i] = Plant.None;
        s.plantDensity[i] = 0;
        s.plantFood[i] = 0;
        if (s.bareYears[i] === 0) s.bareYears[i] = 1;   // grazed bare: the desert clock starts
      } else s.plantDensity[i] = d;
    }
    // Grazed-bare dry land counts toward desert (groundChange reads bareYears).
    if (s.bareYears[i] !== 0) {
      const bare = s.plantType[i] === Plant.None && s.ground[i] === Ground.Grassland && s.rainNow[i]! < G.dryBelowRain;
      s.bareYears[i] = bare ? Math.min(255, s.bareYears[i]! + 1) : 0;
    }
  }

  // Local drying (§10.1): cells that had forest and lost it below 20% get 10% less rain.
  const now = cellForestShares(s.width, s.height, s.plantType, s.plantDensity);
  for (let c = 0; c < now.length; c++) {
    s.dryCells[c] = s.cellForest0[c]! >= FU.drying.forestShare && now[c]! < FU.drying.forestShare ? 1 : 0;
  }
}


// ---------- marks for the renderer ----------

/** The marks byte of every tile: path, road, ruin, quarry, canal, terrace, ash. */
export function computeMarks(s: SimState, out: Uint8Array): Uint8Array {
  for (let i = 0; i < out.length; i++) {
    let m = 0;
    const wear = s.wear[i]!;
    if (wear >= WR.path) m |= Mark.Path;
    if (wear >= WR.road && s.roadOK[i] === 1) m |= Mark.Road;
    if (s.ruinAge[i] !== 0) m |= Mark.Ruin;
    if (s.quarry[i] !== 0) m |= Mark.Quarry;
    if (s.canal[i] !== 0) m |= Mark.Canal;
    if (s.terrace[i] !== 0 && s.plantType[i] === Plant.Farmland) m |= Mark.Terrace;
    if (s.ash[i] !== 0) m |= Mark.Ash;
    out[i] = m;
  }
  return out;
}
