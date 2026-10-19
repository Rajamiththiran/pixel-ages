// Terrain: tile colour + grain (§18.3) plus extra detail (terrainDetail.ts), drawn into an
// offscreen canvas. Only dirty tiles are redrawn; water and river tiles re-dirty on a timer.
// F8 (§14.1) adds curved, flowing rivers, beaches, height shading, stumps, worn and salty
// fields, greening ash and flood silt. Seasons are a tint layer on top (season.ts), so the
// terrain itself never redraws for a season.

import { CONFIG } from '../config';
import { Ground, Plant, Resource, WallType } from '../shared/ids';
import { hash01 } from '../shared/hash';
import { N8 } from '../shared/grid';
import type { MapData } from '../shared/types';
import { RGBS, type RGB } from './palette';
import { HazardMark, Look, Mark, lookLevel } from '../shared/protocol';
import {
  PeakKind, SALT as DETAIL_SALT, applyDesertDetail, applyFoam, applyGrassDetail, applyWetEdge, blend, computeDepth, copy,
  edgeDistance, forestCrown, forestFloor, isWaterTile, mountainPeak, peakKind, scale, waterPixel,
} from './terrainDetail';

const R = CONFIG.render;
const D = R.detail;
const F8 = R.f8;
const TILE = CONFIG.map.tilePx;
const LAST = TILE - 1;

// One salt per speck type so speck patterns don't line up with each other.
const SALT = {
  grain: 0, mountainLight: 1, mountainDark: 2, fruit: 5, resource: 6,
  wallInk: 11, wallLight: 12, pass: 14,
  ash: 21, ruin: 22,             // F4 marks
  fire: 23,                      // F5 flames
  riverDash: 71, riverShimmer: 73, stump: 75, salt: 77, puddle: 79, ashGreen: 81, // F8
} as const;

const RESOURCE_COLOR: Record<number, RGB> = {
  [Resource.Stone]: RGBS.stoneLight,
  [Resource.Clay]: RGBS.clay,
  [Resource.Copper]: RGBS.copper,
  [Resource.Iron]: RGBS.iron,
  [Resource.Tin]: RGBS.tin,
  [Resource.Salt]: RGBS.salt,
};

export interface TerrainTime {
  waterStep: number;             // +1 every waterShimmerMs (wave drift, foam lapping)
  riverStep: number;             // +1 every riverFlowMs (river dashes move 1 px)
}

/** What a tile is drawn from besides the map. Everything is null in setup. */
export interface TileExtras {
  depth: Uint8Array;             // water depth field (computeDepth)
  crossing: Uint8Array | null;   // breached wall tiles
  marks: Uint8Array | null;      // F4: paths, roads, ruins, pits, canals, terraces, ash
  hazards: Uint8Array | null;    // F5: burning (flood water is drawn by the effects layer, F8)
  look: Uint8Array | null;       // F8: worn soil, salt, ash stage, silt
  base: MapData | null;          // F8: the painted map, for stumps where forest was cut
}

// Per-tile scratch, reused so drawing allocates nothing.
const nb = new Uint8Array(8);
const nbLake = new Uint8Array(8);
const out: RGB = [0, 0, 0];
const tmp: RGB = [0, 0, 0];
const BANK: RGB = [0, 0, 0];
blend(RGBS.grass, RGBS.mud, 0.55, BANK);

const isRiver = (map: MapData, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < map.width && y < map.height && map.wall[y * map.width + x] === WallType.River;
const isWaterAt = (map: MapData, x: number, y: number): boolean =>
  x < 0 || y < 0 || x >= map.width || y >= map.height || isWaterTile(map, y * map.width + x);

/**
 * Writes the 8×8 pixels of tile i into `data` (RGBA, image width `imgW`).
 */
export function drawTilePixels(map: MapData, i: number, data: Uint8ClampedArray, imgW: number, time: TerrainTime, ex: TileExtras): void {
  const { width, height } = map;
  const tx = i % width;
  const ty = (i - tx) / width;
  const wall = map.wall[i]!;
  const ground = map.ground[i]!;
  const plant = map.plantType[i]!;
  const dens = map.plantDensity[i]! / 255;
  const res = map.resourceType[i]!;
  const resShare = res !== Resource.None ? R.resourceSpeckBase + R.resourceSpeckScale * (map.resourceAmount[i]! / 255) : 0;
  const isCrossing = ex.crossing !== null && ex.crossing[i] === 1;
  const water = isWaterTile(map, i);
  const river = wall === WallType.River;
  const kind = isCrossing ? PeakKind.None : peakKind(map, i);
  const tileMarks = ex.marks ? ex.marks[i]! : 0;
  const tileHazards = ex.hazards ? ex.hazards[i]! : 0;
  const look = ex.look ? ex.look[i]! : 0;
  const shaded = hasHeight(map, tx, ty);

  // Neighbours of the other kind (land ↔ water) give shore foam / wet edges; lakes and the sea
  // (not rivers) give beaches. Crowns can overhang from a neighbouring forest tile, so check those too.
  let hasEdge = false;
  let hasLake = false;
  let nearForest = plant === Plant.Forest && wall === WallType.None;
  for (let k = 0; k < 8; k++) {
    const [dx, dy] = N8[k]!;
    const nx = tx + dx;
    const ny = ty + dy;
    nb[k] = 0;
    nbLake[k] = 0;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const j = ny * width + nx;
    const wj = isWaterTile(map, j);
    if (wj !== water) { nb[k] = 1; hasEdge = true; }
    if (!water && wj && map.wall[j] !== WallType.River && !narrowWater(map, ex.depth, nx, ny)) { nbLake[k] = 1; hasLake = true; }
    if (map.plantType[j] === Plant.Forest && map.wall[j] === WallType.None) nearForest = true;
  }
  const beachGround = !water && wall === WallType.None && (ground === Ground.Grassland || ground === Ground.Desert);
  const sea = wall === WallType.Sea;
  const corners = sea ? 0 : riverCorners(map, tx, ty, !water);
  // A rounded-off water corner shows bank: mud along rivers and streams, sand round lakes.
  const cornerLand = river || (water && narrowWater(map, ex.depth, tx, ty)) ? BANK : RGBS.sand;
  // F8: stumps where the forest is well below its painted density (cut, burned or grazed away).
  const painted = ex.base && ex.base.plantType[i] === Plant.Forest ? ex.base.plantDensity[i]! / 255 : 0;
  const nowForest = plant === Plant.Forest ? dens : 0;
  const stumps = !water && wall === WallType.None && painted - nowForest > F8.stumps.belowPainted;

  for (let oy = 0; oy < TILE; oy++) {
    const py = ty * TILE + oy;
    for (let ox = 0; ox < TILE; ox++) {
      const px = tx * TILE + ox;
      const edge = hasEdge ? edgeDistance(ox, oy, nb) : 99;
      const corner = corners !== 0 ? cornerCut(ox, oy, corners) : false;

      if (water && !corner) {
        if (river) riverPixel(map, tx, ty, px, py, time.riverStep, out);
        else waterPixel(map, ex.depth, px, py, wall === WallType.Sea, time.waterStep, out);
        if (hasEdge) applyFoam(edge, px, py, time.waterStep, out);
      } else if (water) {
        // A rounded-off corner of a water tile: the bank.
        copy(cornerLand, out);
        applyWetEdge(0, out);
      } else if (corner) {
        // A land corner inside a bend: the water rounds it off.
        if (corners & RIVER_BEND) riverPixel(map, tx, ty, px, py, time.riverStep, out);
        else waterPixel(map, ex.depth, px, py, false, time.waterStep, out);
      } else if (wall === WallType.Mountain) {
        mountainWallPixel(isCrossing, px, py, out);
        if (kind === PeakKind.Wall) mountainPeak(map, kind, px, py, out);
        if (shaded) scale(out, heightShade(map, px, py));
        if (hasEdge) applyWetEdge(edge, out);
      } else {
        landPixel(map, ground, plant, dens, kind, nearForest, stumps ? painted : -1, px, py, out);
        if (resShare > 0 && hash01(px, py, SALT.resource + res) < resShare) copy(RESOURCE_COLOR[res]!, out);
        if (look !== 0) soilPixel(look, plant, px, py, out);
        if (tileMarks !== 0) markPixel(map, ex.marks!, i, tileMarks, plant, look, ox, oy, px, py, out);
        if (tileHazards & HazardMark.Fire) {
          const f = hash01(px, py, SALT.fire);
          if (f < R.marks.flameShare) copy(f < R.marks.flameShare / 2 ? RGBS.fireYellow : RGBS.fireOrange, out);
          else scale(out, R.marks.burnDark);
        }
        if (beachGround && hasLake && edgeDistance(ox, oy, nbLake) < F8.beachPx) copy(RGBS.sand, out);
        if (shaded) scale(out, heightShade(map, px, py));
        if (hasEdge) applyWetEdge(edge, out);
      }

      const g = 1 + R.grain * (2 * hash01(px, py, SALT.grain) - 1);
      const o = (py * imgW + px) * 4;
      data[o] = out[0] * g;
      data[o + 1] = out[1] * g;
      data[o + 2] = out[2] * g;
      data[o + 3] = 255;
    }
  }
}

// ---------- rivers (F8) ----------

// Corner bits: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right.
/** Bit 16: the corners belong to a river bend (drawn as flowing river water). */
const RIVER_BEND = 16;

/**
 * Corners to round off. A water tile rounds a corner whose two sides both face dry land; a land
 * tile (`land`) loses a corner whose two sides and diagonal are all water (an inner bend). Sea
 * walls keep their square edge (they frame the map).
 */
function riverCorners(map: MapData, x: number, y: number, land: boolean): number {
  let bits = 0;
  const wet = (xx: number, yy: number): boolean => xx >= 0 && yy >= 0 && xx < map.width && yy < map.height
    && isWaterTile(map, yy * map.width + xx) && map.wall[yy * map.width + xx] !== WallType.Sea;
  const corner = (dx: number, dy: number, bit: number): void => {
    if (land) {
      if (wet(x + dx, y) && wet(x, y + dy) && wet(x + dx, y + dy)) {
        bits |= bit;
        if (isRiver(map, x + dx, y) && isRiver(map, x, y + dy)) bits |= RIVER_BEND;
      }
    } else if (!isWaterAt(map, x + dx, y) && !isWaterAt(map, x, y + dy)) bits |= bit;
  };
  corner(-1, -1, 1); corner(1, -1, 2); corner(-1, 1, 4); corner(1, 1, 8);
  return bits;
}

/** A stream: Water ground with land within one tile everywhere around it (no wide water near). */
function narrowWater(map: MapData, depth: Uint8Array, x: number, y: number): boolean {
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

/** Is (ox, oy) outside the quarter circle that rounds one of the flagged corners? */
function cornerCut(ox: number, oy: number, bits: number): boolean {
  const r = F8.river.cornerRadius;
  const test = (cx: number, cy: number): boolean => {
    const dx = cx - ox, dy = cy - oy;
    return dx * dx + dy * dy > r * r;
  };
  if (bits & 1 && ox < r && oy < r && test(r - 0.5, r - 0.5)) return true;
  if (bits & 2 && ox > LAST - r && oy < r && test(LAST - r + 0.5, r - 0.5)) return true;
  if (bits & 4 && ox < r && oy > LAST - r && test(r - 0.5, LAST - r + 0.5)) return true;
  if (bits & 8 && ox > LAST - r && oy > LAST - r && test(LAST - r + 0.5, LAST - r + 0.5)) return true;
  return false;
}

/**
 * River water: short light dashes drifting along the river (east–west where it runs sideways,
 * north–south where it runs up and down, downhill when the land has height) and a few glints.
 */
function riverPixel(map: MapData, x: number, y: number, px: number, py: number, step: number, o: RGB): void {
  copy(RGBS.water, o);
  const h = isRiver(map, x - 1, y) || isRiver(map, x + 1, y);
  const v = isRiver(map, x, y - 1) || isRiver(map, x, y + 1);
  const e = map.elevation;
  const w = map.width;
  const at = (xx: number, yy: number): number => (xx >= 0 && yy >= 0 && xx < w && yy < map.height ? e[yy * w + xx]! : e[y * w + x]!);
  const sx = at(x - 1, y) < at(x + 1, y) ? -1 : 1;  // flows toward the lower side; east by default
  const sy = at(x, y - 1) < at(x, y + 1) ? -1 : 1;
  const RV = F8.river;
  const dash = (along: number, across: number): boolean => {
    const l = along - step;
    const seg = Math.floor(l / RV.dashEvery);
    return l - seg * RV.dashEvery < RV.dashLen && hash01(seg, across, SALT.riverDash) < 0.4;
  };
  if ((h || !v) && dash(px * sx, py)) copy(RGBS.waterLight, o);
  else if (v && !h && dash(py * sy, px)) copy(RGBS.waterLight, o);
  if (hash01(px, py, SALT.riverShimmer + (step >> 2)) < RV.shimmer) copy(RGBS.foam, o);
}

// ---------- height shading (F8, D7) ----------

/** Does the tile or any neighbour have height? Flat maps skip the shading maths. */
function hasHeight(map: MapData, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < map.width && ny < map.height && map.elevation[ny * map.width + nx]! > 0) return true;
    }
  }
  return false;
}

/** Smooth height at a pixel: bilinear between tile centres. */
function heightAt(map: MapData, px: number, py: number): number {
  const fx = Math.min(map.width - 1, Math.max(0, (px + 0.5) / TILE - 0.5));
  const fy = Math.min(map.height - 1, Math.max(0, (py + 0.5) / TILE - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(map.width - 1, x0 + 1), y1 = Math.min(map.height - 1, y0 + 1);
  const ax = fx - x0, ay = fy - y0;
  const e = map.elevation, w = map.width;
  return (e[y0 * w + x0]! * (1 - ax) + e[y0 * w + x1]! * ax) * (1 - ay) + (e[y1 * w + x0]! * (1 - ax) + e[y1 * w + x1]! * ax) * ay;
}

/** Light from the top-left: slopes facing it are brighter, slopes facing away darker. */
function heightShade(map: MapData, px: number, py: number): number {
  const half = TILE / 2;
  const d = heightAt(map, px - half, py - half) - heightAt(map, px + half, py + half);
  const S = F8.shade;
  return 1 - Math.max(-S.max, Math.min(S.max, d * S.perStep));
}

// ---------- soil, marks, land ----------

/** F8 look byte: worn fields paler, salt white, flood silt muddy with puddles. */
function soilPixel(look: number, plant: number, px: number, py: number, o: RGB): void {
  const S = F8.soil;
  const worn = lookLevel(look, Look.wornShift);
  if (worn > 0 && plant === Plant.Farmland) { copy(o, tmp); blend(tmp, RGBS.sand, S.wornPale[worn - 1]!, o); }
  const salt = lookLevel(look, Look.saltShift);
  if (salt > 0 && hash01(px, py, SALT.salt) < S.saltWhite[salt - 1]!) copy(RGBS.salt, o);
  if (look & Look.Silt) {
    copy(o, tmp);
    blend(tmp, RGBS.mud, S.siltBlend, o);
    if (hash01(px, py, SALT.puddle) < S.puddle) copy(RGBS.waterLight, o);
  }
}

/** Does neighbour (dx, dy) of tile i carry one of `bits` (or water, for canals)? */
function linked(map: MapData, marks: Uint8Array, i: number, dx: number, dy: number, bits: number, water: boolean): boolean {
  const w = map.width;
  const x = (i % w) + dx;
  const y = Math.floor(i / w) + dy;
  if (x < 0 || y < 0 || x >= w || y >= map.height) return false;
  const j = y * w + x;
  return (marks[j]! & bits) !== 0 || (water && isWaterTile(map, j));
}

/**
 * One pixel of what people left on a land tile (F4): terraces as dark contour rows, ash as
 * soot (F8: with green shoots once it is old), canals and paths/roads as lines from the tile
 * centre toward linked neighbours, a pit for a used-up deposit, broken walls for a ruin.
 */
function markPixel(
  map: MapData, marks: Uint8Array, i: number, m: number, plant: number, look: number,
  ox: number, oy: number, px: number, py: number, out: RGB,
): void {
  if (m & Mark.Terrace && plant === Plant.Farmland && oy % 3 === 2) scale(out, R.marks.terraceDark);
  if (m & Mark.Ash && hash01(px, py, SALT.ash) < R.marks.ashSpeck) {
    const greening = lookLevel(look, Look.ashShift) === 1;
    copy(greening && hash01(px, py, SALT.ashGreen) < F8.soil.ashGreen ? RGBS.grassLight : RGBS.ink, out);
  }
  const mid = TILE / 2 - 1;                       // centre rows/columns: 3 (and 4 for wide lines)
  const onLine = (bits: number, wide: boolean, water: boolean): boolean => {
    const inRow = oy === mid || (wide && oy === mid + 1);
    const inCol = ox === mid || (wide && ox === mid + 1);
    let any = false;
    if (inRow && ox <= mid && linked(map, marks, i, -1, 0, bits, water)) return true;
    if (inRow && ox >= mid && linked(map, marks, i, 1, 0, bits, water)) return true;
    if (inCol && oy <= mid && linked(map, marks, i, 0, -1, bits, water)) return true;
    if (inCol && oy >= mid && linked(map, marks, i, 0, 1, bits, water)) return true;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) if (linked(map, marks, i, dx, dy, bits, water)) any = true;
    // A lone stretch still shows a short dash.
    return !any && inRow && ox >= mid - 1 && ox <= mid + 2;
  };
  if (m & Mark.Canal && onLine(Mark.Canal, false, true)) copy(RGBS.waterLight, out);
  if (m & Mark.Road) {
    if (onLine(Mark.Road | Mark.Path, true, false)) blend(out, RGBS.stoneLight, R.marks.roadBlend, out);
  } else if (m & Mark.Path && onLine(Mark.Path | Mark.Road, false, false)) blend(out, RGBS.sand, R.marks.pathBlend, out);
  if (m & Mark.Quarry) {
    const d2 = (ox - mid - 0.5) ** 2 + (oy - mid - 0.5) ** 2;
    if (d2 <= R.marks.pitRadius2) copy(d2 <= 1 ? RGBS.ink : RGBS.mountainDark, out);
  }
  if (m & Mark.Ruin) {
    const ring = (ox === 1 || ox === TILE - 2) && oy >= 1 && oy <= TILE - 2
      || (oy === 1 || oy === TILE - 2) && ox >= 1 && ox <= TILE - 2;
    if (ring && hash01(px, py, SALT.ruin) > R.marks.ruinGap) copy(RGBS.stone, out);
  }
}

function speck(px: number, py: number, salt: number, share: number): boolean {
  return share > 0 && hash01(px, py, salt) < share;
}

/**
 * F8 stumps: a tree spot (same spots as the crowns) that would hold a tree at the painted
 * density `painted` but not at today's density keeps a stump, at `share` of such spots.
 */
function stumpAt(map: MapData, px: number, py: number, painted: number): boolean {
  const c = D.treeCell;
  const cx = Math.floor(px / c);
  const cy = Math.floor(py / c);
  const sx = cx * c + Math.floor(hash01(cx, cy, DETAIL_SALT.tree) * c);
  const sy = cy * c + Math.floor(hash01(cx, cy, DETAIL_SALT.tree + 1) * c);
  if (py !== sy || (px !== sx && px !== sx + 1)) return false;
  const i = Math.floor(sy / TILE) * map.width + Math.floor(sx / TILE);
  const now = map.plantType[i] === Plant.Forest ? map.plantDensity[i]! / 255 : 0;
  const roll = hash01(cx, cy, DETAIL_SALT.tree + 2);
  const wasTree = roll < D.treeBase + (1 - D.treeBase) * painted;
  const isTree = map.plantType[i] === Plant.Forest && roll < D.treeBase + (1 - D.treeBase) * now;
  return wasTree && !isTree && hash01(cx, cy, SALT.stump) < F8.stumps.share;
}

function landPixel(
  map: MapData, ground: number, plant: number, dens: number, kind: number, nearForest: boolean, painted: number,
  px: number, py: number, out: RGB,
): void {
  switch (ground) {
    case Ground.Desert:
      copy(RGBS.sand, out);
      applyDesertDetail(px, py, out);
      break;
    case Ground.Mountain:
      if (speck(px, py, SALT.mountainLight, R.mountainLightSpeck)) copy(RGBS.stoneLight, out);
      else if (speck(px, py, SALT.mountainDark, R.mountainDarkSpeck)) copy(RGBS.mountainDark, out);
      else copy(RGBS.stone, out);
      if (kind === PeakKind.Ground) mountainPeak(map, kind, px, py, out);
      break;
    default:
      copy(RGBS.grass, out);
      if (plant === Plant.None) applyGrassDetail(px, py, D.tuftBase, true, out);
  }

  switch (plant) {
    case Plant.Grass: {
      const desert = ground === Ground.Desert;
      copy(out, tmp);
      blend(tmp, RGBS.grassLight, desert ? dens * R.desertGrassMaxBlend : dens, out);
      const chance = (ground === Ground.Grassland ? D.tuftBase : 0) + D.tuftGrassBonus * dens;
      applyGrassDetail(px, py, chance, ground === Ground.Grassland, out);
      break;
    }
    case Plant.Forest:
      forestFloor(dens, out);
      break;
    case Plant.FruitBushes:
      copy(out, tmp);
      blend(tmp, RGBS.fruitBush, dens, out);
      if (speck(px, py, SALT.fruit, R.fruitSpeck * dens)) copy(RGBS.fruit, out);
      break;
    case Plant.Farmland:
      // Crop rows; the season's colour (green → gold → stubble → bare) is the season tint (F8).
      copy(py % R.farmSoilRowEvery === 0 ? RGBS.wood : RGBS.grass, out);
      break;
  }

  if (painted >= 0 && stumpAt(map, px, py, painted)) copy((px & 1) === 0 ? RGBS.wood : RGBS.darkWood, out);
  // Crowns last: they stand above the ground and may overhang from a neighbouring forest tile.
  if (nearForest) forestCrown(map, px, py, out);
}

function mountainWallPixel(isCrossing: boolean, px: number, py: number, out: RGB): void {
  if (isCrossing) copy(speck(px, py, SALT.pass, R.mountainPassSpeck) ? RGBS.stone : RGBS.sand, out);
  else if (speck(px, py, SALT.wallInk, R.mountainWallInkSpeck)) copy(RGBS.ink, out);
  else if (speck(px, py, SALT.wallLight, R.mountainWallLightSpeck)) copy(RGBS.stoneLight, out);
  else copy(RGBS.mountainDark, out);
}

/** Offscreen terrain canvas with dirty-tile redraw. */
export class TerrainLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly dirty: Uint8Array;
  private dirtyList: number[] = [];
  private time: TerrainTime = { waterStep: 0, riverStep: 0 };
  private lastWaterStep = -1;
  private lastRiverStep = -1;
  private depth: Uint8Array;
  private depthNext: Uint8Array;
  private depthDirty = false;
  private readonly extras: TileExtras;

  constructor(private map: MapData) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = map.width * TILE;
    this.canvas.height = map.height * TILE;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    const n = map.width * map.height;
    this.dirty = new Uint8Array(n);
    this.depth = new Uint8Array(n);
    this.depthNext = new Uint8Array(n);
    computeDepth(map, this.depth);
    this.extras = { depth: this.depth, crossing: null, marks: null, hazards: null, look: null, base: null };
    this.markAll();
  }

  set crossing(c: Uint8Array | null) { this.extras.crossing = c; }
  get crossing(): Uint8Array | null { return this.extras.crossing; }

  /** Run-mode layers (all null in setup). */
  setRunLayers(marks: Uint8Array | null, hazards: Uint8Array | null, look: Uint8Array | null, base: MapData | null): void {
    this.extras.marks = marks;
    this.extras.hazards = hazards;
    this.extras.look = look;
    this.extras.base = base;
  }

  setMap(map: MapData): void {
    this.map = map;
    computeDepth(map, this.depth);
    this.markAll();
  }

  markDirty(i: number): void {
    if (this.dirty[i]) return;
    this.dirty[i] = 1;
    this.dirtyList.push(i);
  }

  /**
   * Tiles whose map data changed. Neighbours are redrawn too: foam, wet edges, beaches, river
   * bends, height shading, overhanging tree crowns and mountain peaks all reach one tile across.
   */
  mapChanged(tiles: Iterable<number>): void {
    for (const i of tiles) this.markWithNeighbours(i);
    this.depthDirty = true;
  }

  private markWithNeighbours(i: number): void {
    const w = this.map.width;
    const h = this.map.height;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) this.markDirty(ny * w + nx);
      }
    }
  }

  markAll(): void {
    for (let i = 0; i < this.dirty.length; i++) this.markDirty(i);
  }

  /** Advances animation steps; re-dirties water and river tiles when their step changes. */
  animate(nowMs: number): void {
    const waterStep = Math.floor(nowMs / R.waterShimmerMs);
    const riverStep = Math.floor(nowMs / R.riverFlowMs);
    const waterChanged = waterStep !== this.lastWaterStep;
    const riverChanged = riverStep !== this.lastRiverStep;
    this.lastWaterStep = waterStep;
    this.lastRiverStep = riverStep;
    this.time.waterStep = waterStep;
    this.time.riverStep = riverStep;
    if (!waterChanged && !riverChanged) return;
    const m = this.map;
    for (let i = 0; i < this.dirty.length; i++) {
      const w = m.wall[i];
      if (riverChanged && w === WallType.River) this.markDirty(i);
      else if (waterChanged && (w === WallType.Sea || (w === WallType.None && m.ground[i] === Ground.Water))) this.markDirty(i);
    }
  }

  /**
   * Redraws dirty tiles and uploads only their bounding box. With `budgetMs`, stops after
   * that much work and leaves the rest for the next frame, so a big change (a whole year
   * of plant growth at 8×) never freezes the screen.
   */
  flush(budgetMs = Infinity): void {
    if (this.depthDirty) {
      this.depthDirty = false;
      // Depth shading blends between tile centres, so a changed depth also changes neighbours.
      computeDepth(this.map, this.depthNext);
      for (let i = 0; i < this.depth.length; i++) {
        if (this.depthNext[i] !== this.depth[i]) this.markWithNeighbours(i);
      }
      [this.depth, this.depthNext] = [this.depthNext, this.depth];
      this.extras.depth = this.depth;
    }
    if (this.dirtyList.length === 0) return;
    const w = this.map.width;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    const t0 = performance.now();
    let k = 0;
    for (; k < this.dirtyList.length; k++) {
      // Check the clock every 64 tiles; reading it per tile would cost more than it saves.
      if ((k & 63) === 63 && performance.now() - t0 > budgetMs) break;
      const i = this.dirtyList[k]!;
      drawTilePixels(this.map, i, this.img.data, this.canvas.width, this.time, this.extras);
      this.dirty[i] = 0;
      const x = i % w;
      const y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.dirtyList = k === this.dirtyList.length ? [] : this.dirtyList.slice(k);
    this.ctx.putImageData(
      this.img, 0, 0,
      minX * TILE, minY * TILE, (maxX - minX + 1) * TILE, (maxY - minY + 1) * TILE,
    );
  }
}
