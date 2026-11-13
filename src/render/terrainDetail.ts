// Extra terrain detail (owner request, 14 Oct 2026): water depth, waves and foam,
// grass blades, forest crowns, mountain peaks, desert dunes. Pure per-pixel functions;
// every pattern comes from hash01 of pixel or cell coordinates, so it never flickers.

import { CONFIG } from '../config';
import { Ground, Plant, WallType } from '../shared/ids';
import { hash01 } from '../shared/hash';
import type { MapData } from '../shared/types';
import { RGBS, type RGB } from './palette';
import { Mat, rampMix, rampRgb, rampShift, rampsOn, styleOff } from './ramps';
import { ditherOn, mixGrad } from './dither';

const D = CONFIG.render.detail;
const DR = CONFIG.render.diorama.ramps;
const DS = CONFIG.render.diorama.shadows;
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

/** Blend a → b: arithmetic in the classic look, along the colour ramps in the Diorama look (phase 1). */
export const mix: (a: RGB, b: RGB, t: number, out: RGB) => void = rampsOn ? rampMix : blend;

/** A gradient blend (plant density): `mix`, dithered between tones in phase 2. */
export const grad: (a: RGB, b: RGB, t: number, out: RGB) => void = ditherOn ? mixGrad : mix;

/** Shading: the classic look multiplies by `mult`; the Diorama look moves `steps` along the ramp. */
export function shade(out: RGB, mult: number, steps: number): void {
  if (rampsOn) rampShift(out, steps);
  else scale(out, mult);
}

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
mix(RGBS.water, RGBS.waterLight, D.waterShallowBlend, SHALLOW);

export function waterPixel(
  map: MapData, depth: Uint8Array, px: number, py: number, sea: boolean, waveStep: number, out: RGB,
): void {
  let t = Math.min(1, sampleDepth(depth, map.width, map.height, px, py) / D.waterDeepAtTiles);
  if (sea) t = D.seaMinDepth + (1 - D.seaMinDepth) * t;
  // Depth is banded, not dithered: a narrow stream has one depth all along and would turn into an
  // even checker; the mockup leaves water untextured too (readme: "banded or dithered").
  if (t <= D.waterShallowShare) mix(SHALLOW, RGBS.water, t / D.waterShallowShare, out);
  else mix(RGBS.water, RGBS.deepWater, (t - D.waterShallowShare) / (1 - D.waterShallowShare), out);
  if (sea) shade(out, D.seaDarken, DR.seaSteps);
  if (isWave(px, py, waveStep)) {
    copy(out, tmp);
    mix(tmp, RGBS.waterLight, D.waveBlend, out);
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
  if (rampsOn) {
    const s = DR.wetEdgeSteps[d];
    if (s) rampShift(out, s);
    return;
  }
  const m = D.wetEdgeMult[d];
  if (m !== undefined) scale(out, m);
}

// ---------- grass ----------

/** Grass blades (and a few flowers) on top of whatever colour `out` already holds. True where it drew a flower. */
export function applyGrassDetail(px: number, py: number, chance: number, flowers: boolean, out: RGB): boolean {
  const c = D.tuftCell;
  const cx = Math.floor(px / c);
  const cy = Math.floor(py / c);
  if (hash01(cx, cy, SALT.tuft) < chance) {
    // Blade fits inside its cell: x in 0..c-2 (room for the shadow), y in 1..c-1 (room for the tip).
    const bx = cx * c + Math.floor(hash01(cx, cy, SALT.tuft + 1) * (c - 1));
    const by = cy * c + 1 + Math.floor(hash01(cx, cy, SALT.tuft + 2) * (c - 1));
    if (px === bx && py === by) { shade(out, D.tuftLight, DR.tuftLightSteps); return false; }
    if (px === bx && py === by - 1) { shade(out, D.tuftTip, DR.tuftTipSteps); return false; }
    if (px === bx + 1 && py === by) { shade(out, D.tuftShadow, DR.tuftShadowSteps); return false; }
  }
  if (!flowers) return false;
  const f = D.flowerCell;
  const fx = Math.floor(px / f);
  const fy = Math.floor(py / f);
  if (hash01(fx, fy, SALT.flower) >= D.flowerChance) return false;
  const ox = fx * f + Math.floor(hash01(fx, fy, SALT.flower + 1) * f);
  const oy = fy * f + Math.floor(hash01(fx, fy, SALT.flower + 2) * f);
  if (px !== ox || py !== oy) return false;
  const k = Math.floor(hash01(fx, fy, SALT.flower + 3) * 3);
  copy(k === 0 ? RGBS.fireYellow : k === 1 ? RGBS.flowerWhite : RGBS.fruit, out);
  return true;
}

// ---------- forest ----------

/** One tree: crown centre (px), radius, and a 0–1 hash that sets its tone. */
export interface Crown { x: number; y: number; r: number; tone: number }

/**
 * The tree of crown cell (cx, cy): one possible crown per cell, on forest tiles only, existing
 * with a chance that grows with density. False when the cell has none.
 */
// Visual fixes F: tiles a settlement stands on (per tile, 1), where no tree grows; null outside a run.
let clearedMask: Uint8Array | null = null;
export function setClearedMask(mask: Uint8Array | null): void { clearedMask = mask; }

// ---------- visual fixes G: soft land edges ----------

const FE = CONFIG.render.fixes.edges;
/** Visual fixes G switch (?off=edges): land and lake shores keep their tile edges. */
export const edgesOn: boolean = FE.on && !styleOff('edges');

/** Smooth value noise in [0, 1) on cells of `cell` px (smoothstep between hashed corners). */
export function valueNoise(x: number, y: number, cell: number, salt: number): number {
  const fx = x / cell, fy = y / cell;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  const sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay);
  const a = hash01(x0, y0, salt), b = hash01(x0 + 1, y0, salt), c = hash01(x0, y0 + 1, salt), d = hash01(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** Natural land: no wall, no water, no field, not cleared. Its ground and plants may fray into a neighbour's. */
export function naturalTile(map: MapData, i: number): boolean {
  return map.wall[i] === WallType.None && map.ground[i] !== Ground.Water && map.plantType[i] !== Plant.Farmland
    && (clearedMask === null || clearedMask[i] !== 1);
}

/** Is tile (x, y) natural land drawn differently from tile i (ground, plants or their density)? */
function differs(map: MapData, i: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const j = y * map.width + x;
  if (j === i || !naturalTile(map, j)) return false;
  return map.ground[j] !== map.ground[i] || map.plantType[j] !== map.plantType[i] || map.plantDensity[j] !== map.plantDensity[i];
}

/** A pixel's offset along one axis: noise up to ± ampPx plus ± jitterPx of grain, held within reachPx. */
function edgeShift(px: number, py: number, salt: number): number {
  const n = Math.round((valueNoise(px, py, FE.cellPx, salt) - 0.5) * 2 * FE.ampPx);
  const j = Math.floor(hash01(px, py, salt + 2) * (2 * FE.jitterPx + 1)) - FE.jitterPx;
  return Math.max(-FE.reachPx, Math.min(FE.reachPx, n + j));
}

/**
 * Visual fixes G: the tile whose ground and plants pixel (px, py) shows. Within reachPx of a border
 * between two natural land tiles, the pixel looks up the tile under a small noise offset, so the
 * border frays instead of running straight along the grid; anywhere else, its own tile.
 */
export function edgeSource(map: MapData, px: number, py: number): number {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  const i = ty * map.width + tx;
  if (!edgesOn) return i;
  const ox = px - tx * TILE, oy = py - ty * TILE, r = FE.reachPx;
  if (ox >= r && ox < TILE - r && oy >= r && oy < TILE - r) return i;
  if (!naturalTile(map, i)) return i;
  // Only the neighbours on the near sides can be reached; when none of them is natural land that looks
  // different, the offset changes nothing (the same picture, no noise worked out).
  const ddx = ox < r ? -1 : ox >= TILE - r ? 1 : 0, ddy = oy < r ? -1 : oy >= TILE - r ? 1 : 0;
  if (!differs(map, i, tx + ddx, ty) && !differs(map, i, tx, ty + ddy) && !differs(map, i, tx + ddx, ty + ddy)) return i;
  const sx = Math.floor((px + edgeShift(px, py, FE.salt)) / TILE), sy = Math.floor((py + edgeShift(px, py, FE.salt + 1)) / TILE);
  if ((sx === tx && sy === ty) || sx < 0 || sy < 0 || sx >= map.width || sy >= map.height) return i;
  const j = sy * map.width + sx;
  return naturalTile(map, j) ? j : i;
}

// ---------- visual fixes G: lake and pond shores ----------

/** A stream: Water ground with land within one tile everywhere around it (no wide water near). */
export function narrowWater(map: MapData, depth: Uint8Array, x: number, y: number): boolean {
  const i = y * map.width + x;
  if (map.wall[i] !== WallType.None || depth[i]! > 1) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < map.width && ny < map.height && depth[ny * map.width + nx]! > 1) return false;
    }
  }
  return true;
}

/**
 * Open water on the ground: a lake, a pond or a stream (not a River or Sea wall). A pond's arm tips
 * count as narrow water, so streams are in too: their banks come out smooth as well (mud, not sand).
 */
export function lakeTileAt(map: MapData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const j = y * map.width + x;
  return map.wall[j] === WallType.None && map.ground[j] === Ground.Water;
}

/**
 * Visual fixes G: is tile (tx, ty) on a shore drawn along the smooth water field? Open ground water
 * with land beside it, or land (no wall) beside such water. River and Sea walls keep their tile edges.
 */
export function shoreTile(map: MapData, tx: number, ty: number): boolean {
  if (!edgesOn) return false;
  const i = ty * map.width + tx;
  if (map.wall[i] !== WallType.None) return false;
  const water = isWaterTile(map, i);
  if (water && !lakeTileAt(map, tx, ty)) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = tx + dx, y = ty + dy;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if (water ? !isWaterTile(map, y * map.width + x) : lakeTileAt(map, x, y)) return true;
    }
  }
  return false;
}

/**
 * The water field at a pixel of a shore tile: 1 on water tiles (every kind, so a river running into
 * a lake gets no beach across its mouth), 0 on land, bilinear between tile centres and wobbled a
 * little. The shore is where it crosses one half: a pond of a few tiles comes out round, not a plus.
 */
export function shoreFieldAt(map: MapData, px: number, py: number): number {
  const fx = (px + 0.5) / TILE - 0.5, fy = (py + 0.5) / TILE - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const at = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < map.width && y < map.height && isWaterTile(map, y * map.width + x) ? 1 : 0;
  const f = (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
  return f + (valueNoise(px, py, FE.shoreCellPx, FE.salt + 5) - 0.5) * FE.shoreNoise;
}

/**
 * Every pixel's water (1) or land (0) as the terrain draws it: by tile, except along lake shores
 * (shoreTile), where the smooth field decides. The snow and ice orders use it (winter.ts).
 */
export function shoreWaterMask(map: MapData, out: Uint8Array): void {
  const pw = map.width * TILE;
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const i = ty * map.width + tx;
      const shore = shoreTile(map, tx, ty);
      const v = isWaterTile(map, i) ? 1 : 0;
      for (let oy = 0; oy < TILE; oy++) {
        const py = ty * TILE + oy;
        for (let ox = 0; ox < TILE; ox++) {
          const px = tx * TILE + ox;
          out[py * pw + px] = shore ? (shoreFieldAt(map, px, py) >= 0.5 ? 1 : 0) : v;
        }
      }
    }
  }
}

export function crownIn(map: MapData, cx: number, cy: number, out: Crown): boolean {
  const c = D.treeCell;
  const tx = cx * c + Math.floor(hash01(cx, cy, SALT.tree) * c);
  const ty = cy * c + Math.floor(hash01(cx, cy, SALT.tree + 1) * c);
  const tileX = Math.floor(tx / TILE);
  const tileY = Math.floor(ty / TILE);
  if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return false;
  // Visual fixes G: a tree near a forest's edge stands by the frayed edge, so a clearing is not a square hole.
  const ti = edgeSource(map, tx, ty);
  if (map.plantType[ti] !== Plant.Forest || map.wall[ti] !== WallType.None) return false;
  if (clearedMask !== null && clearedMask[ti] === 1) return false;
  const dens = map.plantDensity[ti]! / 255;
  if (hash01(cx, cy, SALT.tree + 2) >= D.treeBase + (1 - D.treeBase) * dens) return false;
  out.x = tx; out.y = ty;
  out.r = D.treeRadiusMin + hash01(cx, cy, SALT.tree + 3) * (D.treeRadiusMax - D.treeRadiusMin);
  out.tone = hash01(cx, cy, SALT.tree + 4);
  return true;
}

/** A crown pixel's colour, (dx, dy) from the crown's centre: lit top-left, shaded bottom-right. */
export function crownColour(dx: number, dy: number, r: number, tone: number, out: RGB): void {
  const n = (dx + dy) / r;
  if (rampsOn) {
    // Diorama: forest-2 crowns, one step up on the lit top-left, two down on the far side; some
    // crowns a step darker or lighter so a wood isn't one flat green.
    const t = tone < DR.treeToneShare ? -1 : tone >= 1 - DR.treeToneShare ? 1 : 0;
    const side = n <= D.treeLightBelow ? DR.treeLightSteps : n >= D.treeShadowAbove ? DR.treeShadowSteps : 0;
    copy(rampRgb(Mat.Forest, 2 + t + side), out);
    return;
  }
  if (n <= D.treeLightBelow) blend(RGBS.forest, RGBS.grassLight, D.treeLightBlend, out);
  else copy(RGBS.forest, out);
  if (n >= D.treeShadowAbove) scale(out, D.treeShadowMult);
  scale(out, 1 - D.treeToneVar / 2 + tone * D.treeToneVar);
}

const crown: Crown = { x: 0, y: 0, r: 0, tone: 0 };

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
      if (!crownIn(map, cx, cy, crown)) continue;
      const dx = px - crown.x;
      const dy = py - crown.y;
      if (dx * dx + dy * dy > crown.r * crown.r) continue;
      // Front-most crown wins: lower on screen, then further right.
      if (crown.y > bestY || (crown.y === bestY && crown.x > bestX)) {
        bestY = crown.y; bestX = crown.x; bestDx = dx; bestDy = dy; bestR = crown.r; bestTone = crown.tone;
      }
    }
  }
  if (bestY < 0) return false;
  crownColour(bestDx, bestDy, bestR, bestTone, out);
  return true;
}

/** Dark ground between trees, stronger with density. */
export function forestFloor(dens: number, out: RGB): void {
  copy(out, tmp);
  grad(tmp, FOREST_FLOOR, dens, out);
}

// Diorama: the forest's deepest step, forest-0, instead of the forest colour × 0.55.
const FOREST_FLOOR: RGB = rampsOn ? rampRgb(Mat.Forest, 0) : [
  RGBS.forest[0] * D.forestFloorMult, RGBS.forest[1] * D.forestFloorMult, RGBS.forest[2] * D.forestFloorMult,
];

// ---------- mountains ----------

const PEAK_GROUND_LIGHT: RGB = [0, 0, 0];
mix(RGBS.stone, RGBS.stoneLight, D.peakLightBlend, PEAK_GROUND_LIGHT);
// Diorama: a wall's body is stone-1 (terrain.ts), so its peaks' dark slope is stone-0, not ink.
const PEAK_WALL_DARK: RGB = [0, 0, 0];
if (rampsOn) copy(rampRgb(Mat.Stone, 0), PEAK_WALL_DARK);
else blend(RGBS.mountainDark, RGBS.ink, D.wallPeakDarkBlend, PEAK_WALL_DARK);

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

/**
 * Is (px, py) in a peak's cast shadow? Each peak pixel h px above the peak's base row throws its
 * shadow (h + 1) × 0.45 px right and down (+1 row, +0–1 px wide), as the mockup projects its peaks
 * (pixel-scenes.js). Only pixels a peak really draws (on its own mountain kind) cast.
 */
export function peakShadowAt(map: MapData, px: number, py: number): boolean {
  const W = D.peakCellW;
  const H = D.peakCellH;
  const hMax = D.peakMaxH;
  const a = DS.perHeightPx;
  const far = Math.round((hMax + 1) * a);
  for (let cy = Math.floor((py - far - 1) / H); cy <= Math.floor((py + hMax) / H); cy++) {
    for (let cx = Math.floor((px - far - DS.peakSpreadPx - hMax) / W); cx <= Math.floor((px + hMax) / W); cx++) {
      if (hash01(cx, cy, SALT.peak) >= D.peakChance) continue;
      const bx = cx * W + Math.floor(hash01(cx, cy, SALT.peak + 1) * W);
      const by = cy * H + Math.floor(hash01(cx, cy, SALT.peak + 2) * H);
      const hgt = D.peakMinH + Math.floor(hash01(cx, cy, SALT.peak + 3) * (hMax - D.peakMinH + 1));
      const kind = kindAt(map, bx, by);
      if (kind === PeakKind.None || kindAt(map, bx, by - hgt) !== kind) continue;
      for (let h = 0; h <= hgt; h++) {
        const qy = by - h;
        if (qy + 1 + Math.round((h + 1) * a) !== py) continue;
        for (let e = 0; e <= DS.peakSpreadPx; e++) {
          const qx = px - Math.round((h + 1) * a) - e;
          if (Math.abs(qx - bx) <= hgt - h && kindAt(map, qx, qy) === kind) return true;
        }
      }
    }
  }
  return false;
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
    if (py === crest) { shade(out, D.duneDark, DR.duneDarkSteps); return; }
    if (py === crest - 1) { shade(out, D.duneLight, DR.duneLightSteps); return; }
  }
  if (hash01(px, py, SALT.pebble) < D.pebbleChance) {
    copy(hash01(px, py, SALT.pebble + 1) < 0.5 ? RGBS.stone : RGBS.wood, out);
  }
}
