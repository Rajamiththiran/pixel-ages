// Extra terrain detail (owner request, 14 Oct 2026): water depth, waves and foam,
// grass blades, forest crowns, mountain peaks, desert dunes. Pure per-pixel functions;
// every pattern comes from hash01 of pixel or cell coordinates, so it never flickers.

import { CONFIG } from '../config';
import { Ground, Plant, WallType } from '../shared/ids';
import { hash01 } from '../shared/hash';
import type { MapData } from '../shared/types';
import { RGBS, type RGB } from './palette';

const D = CONFIG.render.detail;
const TILE = CONFIG.map.tilePx;
const LAST = TILE - 1;

export const SALT = {
  wave: 21, foam: 25, tuft: 31, flower: 35, tree: 41, peak: 51, dune: 61, pebble: 65,
} as const;

// ---------- colour helpers ----------

export function copy(c: RGB, out: RGB): void {
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
}

export function blend(a: RGB, b: RGB, t: number, out: RGB): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

export function scale(out: RGB, m: number): void {
  out[0] *= m; out[1] *= m; out[2] *= m;
}

const tmp: RGB = [0, 0, 0];

// ---------- tile classification ----------

/** Water for depth, waves and foam: Water ground, River walls and Sea walls. */
export function isWaterTile(map: MapData, i: number): boolean {
  const w = map.wall[i];
  return w === WallType.River || w === WallType.Sea || (w === WallType.None && map.ground[i] === Ground.Water);
}

// Mountain kinds; peaks only form and draw within one kind.
export const PeakKind = { None: 0, Ground: 1, Wall: 2 } as const;

export function peakKind(map: MapData, i: number): number {
  const w = map.wall[i];
  if (w === WallType.Mountain) return PeakKind.Wall;
  if (w === WallType.None && map.ground[i] === Ground.Mountain) return PeakKind.Ground;
  return PeakKind.None;
}

/**
 * Tile depth = tiles to the nearest non-water tile (8-way), capped. Land is 0.
 * Multi-source BFS, so it costs one pass over the map.
 */
export function computeDepth(map: MapData, out: Uint8Array): void {
  const { width, height } = map;
  const n = width * height;
  const cap = D.waterDeepAtTiles + 1;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (isWaterTile(map, i)) out[i] = cap;
    else { out[i] = 0; queue[tail++] = i; }
  }
  while (head < tail) {
    const i = queue[head++]!;
    const d = out[i]! + 1;
    if (d >= cap) continue;
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const j = ny * width + nx;
        if (out[j]! > d) { out[j] = d; queue[tail++] = j; }
      }
    }
  }
}

/**
 * Pixel distance (Chebyshev) from (ox, oy) inside a tile to the nearest edge shared with a
 * neighbour flagged in `nb` (N8 order: NW, N, NE, W, E, SW, S, SE). 99 if none.
 */
export function edgeDistance(ox: number, oy: number, nb: Uint8Array): number {
  let d = 99;
  if (nb[1]) d = Math.min(d, oy);
  if (nb[6]) d = Math.min(d, LAST - oy);
  if (nb[3]) d = Math.min(d, ox);
  if (nb[4]) d = Math.min(d, LAST - ox);
  if (nb[0]) d = Math.min(d, Math.max(ox, oy));
  if (nb[2]) d = Math.min(d, Math.max(LAST - ox, oy));
  if (nb[5]) d = Math.min(d, Math.max(ox, LAST - oy));
  if (nb[7]) d = Math.min(d, Math.max(LAST - ox, LAST - oy));
  return d;
}

// ---------- water ----------

/** Smooth per-pixel depth: bilinear between tile centres. */
function sampleDepth(depth: Uint8Array, w: number, h: number, px: number, py: number): number {
  const fx = (px + 0.5) / TILE - 0.5;
  const fy = (py + 0.5) / TILE - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const cx0 = Math.max(0, x0), cx1 = Math.min(w - 1, x0 + 1);
  const cy0 = Math.max(0, y0), cy1 = Math.min(h - 1, y0 + 1);
  const a = depth[cy0 * w + cx0]!, b = depth[cy0 * w + cx1]!;
  const c = depth[cy1 * w + cx0]!, d = depth[cy1 * w + cx1]!;
  return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
}

const SHALLOW: RGB = [0, 0, 0];
blend(RGBS.water, RGBS.waterLight, D.waterShallowBlend, SHALLOW);

export function waterPixel(
  map: MapData, depth: Uint8Array, px: number, py: number, sea: boolean, waveStep: number, out: RGB,
): void {
  let t = Math.min(1, sampleDepth(depth, map.width, map.height, px, py) / D.waterDeepAtTiles);
  if (sea) t = D.seaMinDepth + (1 - D.seaMinDepth) * t;
  if (t <= D.waterShallowShare) blend(SHALLOW, RGBS.water, t / D.waterShallowShare, out);
  else blend(RGBS.water, RGBS.deepWater, (t - D.waterShallowShare) / (1 - D.waterShallowShare), out);
  if (sea) scale(out, D.seaDarken);
  if (isWave(px, py, waveStep)) {
    copy(out, tmp);
    blend(tmp, RGBS.waterLight, D.waveBlend, out);
  }
}

/** A small ⌒ wave mark, one per cell at most, drifting right over time. */
function isWave(px: number, py: number, step: number): boolean {
  const cw = D.waveCellW;
  const ch = D.waveCellH;
  const cy = Math.floor(py / ch);
  // Alternate rows drift at full and half speed so the water doesn't slide as one sheet.
  const sx = px - ((cy & 1) === 0 ? step : Math.floor(step / 2));
  const cx = Math.floor(sx / cw);
  if (hash01(cx, cy, SALT.wave) >= D.waveChance) return false;
  const mx = Math.floor(hash01(cx, cy, SALT.wave + 1) * (cw - 4));
  const my = 1 + Math.floor(hash01(cx, cy, SALT.wave + 2) * (ch - 2));
  const lx = sx - cx * cw - mx;
  const ly = py - cy * ch - my;
  return (ly === 0 && (lx === 1 || lx === 2)) || (ly === 1 && (lx === 0 || lx === 3));
}

/** Foam on water pixels next to land: solid at the edge, flickering one pixel further in. */
export function applyFoam(d: number, px: number, py: number, waveStep: number, out: RGB): void {
  if (d === 0 || (d === 1 && hash01(px, py, SALT.foam + (waveStep & 1)) < D.foamLapChance)) {
    copy(RGBS.foam, out);
  }
}

/** Wet sand/soil on land pixels next to water. */
export function applyWetEdge(d: number, out: RGB): void {
  const m = D.wetEdgeMult[d];
  if (m !== undefined) scale(out, m);
}

// ---------- grass ----------

/** Grass blades (and a few flowers) on top of whatever colour `out` already holds. */
export function applyGrassDetail(px: number, py: number, chance: number, flowers: boolean, out: RGB): void {
  const c = D.tuftCell;
  const cx = Math.floor(px / c);
  const cy = Math.floor(py / c);
  if (hash01(cx, cy, SALT.tuft) < chance) {
    // Blade fits inside its cell: x in 0..c-2 (room for the shadow), y in 1..c-1 (room for the tip).
    const bx = cx * c + Math.floor(hash01(cx, cy, SALT.tuft + 1) * (c - 1));
    const by = cy * c + 1 + Math.floor(hash01(cx, cy, SALT.tuft + 2) * (c - 1));
    if (px === bx && py === by) { scale(out, D.tuftLight); return; }
    if (px === bx && py === by - 1) { scale(out, D.tuftTip); return; }
    if (px === bx + 1 && py === by) { scale(out, D.tuftShadow); return; }
  }
  if (!flowers) return;
  const f = D.flowerCell;
  const fx = Math.floor(px / f);
  const fy = Math.floor(py / f);
  if (hash01(fx, fy, SALT.flower) >= D.flowerChance) return;
  const ox = fx * f + Math.floor(hash01(fx, fy, SALT.flower + 1) * f);
  const oy = fy * f + Math.floor(hash01(fx, fy, SALT.flower + 2) * f);
  if (px !== ox || py !== oy) return;
  const k = Math.floor(hash01(fx, fy, SALT.flower + 3) * 3);
  copy(k === 0 ? RGBS.fireYellow : k === 1 ? RGBS.flowerWhite : RGBS.fruit, out);
}

// ---------- forest ----------

/**
 * Round tree crowns lit from the top-left. Returns true if (px, py) is covered by a crown
 * (out = crown colour); crowns from neighbouring forest tiles may overhang this pixel.
 */
export function forestCrown(map: MapData, px: number, py: number, out: RGB): boolean {
  const c = D.treeCell;
  const pcx = Math.floor(px / c);
  const pcy = Math.floor(py / c);
  let bestY = -1;
  let bestX = -1;
  let bestDx = 0, bestDy = 0, bestR = 0, bestTone = 1;
  for (let cy = pcy - 1; cy <= pcy + 1; cy++) {
    for (let cx = pcx - 1; cx <= pcx + 1; cx++) {
      const tx = cx * c + Math.floor(hash01(cx, cy, SALT.tree) * c);
      const ty = cy * c + Math.floor(hash01(cx, cy, SALT.tree + 1) * c);
      const tileX = Math.floor(tx / TILE);
      const tileY = Math.floor(ty / TILE);
      if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) continue;
      const ti = tileY * map.width + tileX;
      if (map.plantType[ti] !== Plant.Forest || map.wall[ti] !== WallType.None) continue;
      const dens = map.plantDensity[ti]! / 255;
      if (hash01(cx, cy, SALT.tree + 2) >= D.treeBase + (1 - D.treeBase) * dens) continue;
      const r = D.treeRadiusMin + hash01(cx, cy, SALT.tree + 3) * (D.treeRadiusMax - D.treeRadiusMin);
      const dx = px - tx;
      const dy = py - ty;
      if (dx * dx + dy * dy > r * r) continue;
      // Front-most crown wins: lower on screen, then further right.
      if (ty > bestY || (ty === bestY && tx > bestX)) {
        bestY = ty; bestX = tx; bestDx = dx; bestDy = dy; bestR = r;
        bestTone = 1 - D.treeToneVar / 2 + hash01(cx, cy, SALT.tree + 4) * D.treeToneVar;
      }
    }
  }
  if (bestY < 0) return false;
  const n = (bestDx + bestDy) / bestR;
  if (n <= D.treeLightBelow) blend(RGBS.forest, RGBS.grassLight, D.treeLightBlend, out);
  else copy(RGBS.forest, out);
  if (n >= D.treeShadowAbove) scale(out, D.treeShadowMult);
  scale(out, bestTone);
  return true;
}

/** Dark ground between trees, stronger with density. */
export function forestFloor(dens: number, out: RGB): void {
  copy(out, tmp);
  blend(tmp, FOREST_FLOOR, dens, out);
}

const FOREST_FLOOR: RGB = [
  RGBS.forest[0] * D.forestFloorMult, RGBS.forest[1] * D.forestFloorMult, RGBS.forest[2] * D.forestFloorMult,
];

// ---------- mountains ----------

const PEAK_GROUND_LIGHT: RGB = [0, 0, 0];
blend(RGBS.stone, RGBS.stoneLight, D.peakLightBlend, PEAK_GROUND_LIGHT);
const PEAK_WALL_DARK: RGB = [0, 0, 0];
blend(RGBS.mountainDark, RGBS.ink, D.wallPeakDarkBlend, PEAK_WALL_DARK);

/**
 * Triangular peaks: light left slope, dark right slope, snow on tall ones. A peak exists only
 * where its base and apex tiles are both of `kind`, so peaks never poke into other terrain.
 * Returns true if (px, py) is on a peak.
 */
export function mountainPeak(map: MapData, kind: number, px: number, py: number, out: RGB): boolean {
  const W = D.peakCellW;
  const H = D.peakCellH;
  const hMax = D.peakMaxH;
  let bestBy = -1;
  let bestRel = 0, bestSide = 0, bestH = 0;
  for (let cy = Math.floor(py / H); cy <= Math.floor((py + hMax) / H); cy++) {
    for (let cx = Math.floor((px - hMax) / W); cx <= Math.floor((px + hMax) / W); cx++) {
      if (hash01(cx, cy, SALT.peak) >= D.peakChance) continue;
      const bx = cx * W + Math.floor(hash01(cx, cy, SALT.peak + 1) * W);
      const by = cy * H + Math.floor(hash01(cx, cy, SALT.peak + 2) * H);
      if (by < py || by <= bestBy) continue;
      const hgt = D.peakMinH + Math.floor(hash01(cx, cy, SALT.peak + 3) * (hMax - D.peakMinH + 1));
      const rel = py - (by - hgt);
      if (rel < 0 || Math.abs(px - bx) > rel) continue;
      if (kindAt(map, bx, by) !== kind || kindAt(map, bx, by - hgt) !== kind) continue;
      bestBy = by; bestRel = rel; bestSide = px - bx; bestH = hgt;
    }
  }
  if (bestBy < 0) return false;
  const wall = kind === PeakKind.Wall;
  if (bestH >= D.snowMinH && bestRel < D.snowRows) copy(wall ? RGBS.stoneLight : RGBS.snow, out);
  else if (bestSide <= 0) copy(wall ? RGBS.stone : PEAK_GROUND_LIGHT, out);
  else copy(wall ? PEAK_WALL_DARK : RGBS.mountainDark, out);
  return true;
}

function kindAt(map: MapData, px: number, py: number): number {
  const x = Math.floor(px / TILE);
  const y = Math.floor(py / TILE);
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return PeakKind.None;
  return peakKind(map, y * map.width + x);
}

// ---------- desert ----------

const TWO_PI = Math.PI * 2;

/** Broken wavy dune crests (dark line, lit row above) and scattered pebbles. */
export function applyDesertDetail(px: number, py: number, out: RGB): void {
  const P = D.dunePeriod;
  const k0 = Math.floor(py / P);
  for (let k = k0 - 1; k <= k0 + 1; k++) {
    const phase = hash01(k, 0, SALT.dune) * P;
    const shift = hash01(k, 1, SALT.dune) * D.duneWavelength;
    const seg = Math.floor((px + shift) / D.duneSegment);
    if (hash01(k, seg, SALT.dune + 2) >= D.duneKeep) continue;
    // Render-only code, so Math.sin is fine here (the determinism rule covers src/sim).
    const crest = Math.round(k * P + phase + D.duneAmp * Math.sin(((px + shift) / D.duneWavelength) * TWO_PI));
    if (py === crest) { scale(out, D.duneDark); return; }
    if (py === crest - 1) { scale(out, D.duneLight); return; }
  }
  if (hash01(px, py, SALT.pebble) < D.pebbleChance) {
    copy(hash01(px, py, SALT.pebble + 1) < 0.5 ? RGBS.stone : RGBS.wood, out);
  }
}
