// Terrain: tile colour + grain (§18.3) plus extra detail (terrainDetail.ts), drawn into an
// offscreen canvas. Only dirty tiles are redrawn; water and river tiles re-dirty on a timer.

import { CONFIG } from '../config';
import { Ground, Plant, Resource, WallType, Season } from '../shared/ids';
import { hash01 } from '../shared/hash';
import { N8 } from '../shared/grid';
import type { MapData } from '../shared/types';
import { RGBS, type RGB } from './palette';
import {
  PeakKind, applyDesertDetail, applyFoam, applyGrassDetail, applyWetEdge, blend, computeDepth, copy,
  edgeDistance, forestCrown, forestFloor, isWaterTile, mountainPeak, peakKind, waterPixel,
} from './terrainDetail';

const R = CONFIG.render;
const D = R.detail;
const TILE = CONFIG.map.tilePx;

// One salt per speck type so speck patterns don't line up with each other.
const SALT = {
  grain: 0, mountainLight: 1, mountainDark: 2, fruit: 5, resource: 6,
  wallInk: 11, wallLight: 12, pass: 14,
} as const;

const RESOURCE_COLOR: Record<number, RGB> = {
  [Resource.Stone]: RGBS.stoneLight,
  [Resource.Clay]: RGBS.clay,
  [Resource.Copper]: RGBS.copper,
  [Resource.Iron]: RGBS.iron,
};

const FARM_SEASON_COLOR: RGB[] = [RGBS.grassLight, RGBS.grass, RGBS.sand, RGBS.wood];

export interface TerrainTime {
  waterStep: number;             // +1 every waterShimmerMs (wave drift, foam lapping)
  riverStep: number;             // changes every riverFlowMs
  season: Season;
}

// Per-tile scratch, reused so drawing allocates nothing.
const nb = new Uint8Array(8);
const out: RGB = [0, 0, 0];
const tmp: RGB = [0, 0, 0];

/**
 * Writes the 8×8 pixels of tile i into `data` (RGBA, image width `imgW`).
 * `depth` is the water depth field (computeDepth); `crossing` marks breached wall tiles.
 */
export function drawTilePixels(
  map: MapData, i: number, data: Uint8ClampedArray, imgW: number,
  time: TerrainTime, depth: Uint8Array, crossing: Uint8Array | null,
): void {
  const { width, height } = map;
  const tx = i % width;
  const ty = (i - tx) / width;
  const wall = map.wall[i]!;
  const ground = map.ground[i]!;
  const plant = map.plantType[i]!;
  const dens = map.plantDensity[i]! / 255;
  const res = map.resourceType[i]!;
  const resShare = res !== Resource.None ? R.resourceSpeckBase + R.resourceSpeckScale * (map.resourceAmount[i]! / 255) : 0;
  const isCrossing = crossing !== null && crossing[i] === 1;
  const water = isWaterTile(map, i);
  const kind = isCrossing ? PeakKind.None : peakKind(map, i);

  // Neighbours of the other kind (land ↔ water) give shore foam / wet edges.
  // Crowns can overhang from a neighbouring forest tile, so check those too.
  let hasEdge = false;
  let nearForest = plant === Plant.Forest && wall === WallType.None;
  for (let k = 0; k < 8; k++) {
    const [dx, dy] = N8[k]!;
    const nx = tx + dx;
    const ny = ty + dy;
    nb[k] = 0;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const j = ny * width + nx;
    if (isWaterTile(map, j) !== water) { nb[k] = 1; hasEdge = true; }
    if (map.plantType[j] === Plant.Forest && map.wall[j] === WallType.None) nearForest = true;
  }

  for (let oy = 0; oy < TILE; oy++) {
    const py = ty * TILE + oy;
    for (let ox = 0; ox < TILE; ox++) {
      const px = tx * TILE + ox;
      const edge = hasEdge ? edgeDistance(ox, oy, nb) : 99;

      if (water) {
        if (wall === WallType.River) {
          copy((px + py + time.riverStep) % R.riverStreakEvery === 0 ? RGBS.waterLight : RGBS.water, out);
        } else {
          waterPixel(map, depth, px, py, wall === WallType.Sea, time.waterStep, out);
        }
        if (hasEdge) applyFoam(edge, px, py, time.waterStep, out);
      } else if (wall === WallType.Mountain) {
        mountainWallPixel(isCrossing, px, py, out);
        if (kind === PeakKind.Wall) mountainPeak(map, kind, px, py, out);
        if (hasEdge) applyWetEdge(edge, out);
      } else {
        landPixel(map, ground, plant, dens, kind, nearForest, px, py, time.season, out);
        if (resShare > 0 && hash01(px, py, SALT.resource + res) < resShare) copy(RESOURCE_COLOR[res]!, out);
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

function speck(px: number, py: number, salt: number, share: number): boolean {
  return share > 0 && hash01(px, py, salt) < share;
}

function landPixel(
  map: MapData, ground: number, plant: number, dens: number, kind: number, nearForest: boolean,
  px: number, py: number, season: number, out: RGB,
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
      copy(py % R.farmSoilRowEvery === 0 ? RGBS.wood : FARM_SEASON_COLOR[season]!, out);
      break;
  }

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
  private time: TerrainTime = { waterStep: 0, riverStep: 0, season: Season.Spring };
  private lastWaterStep = -1;
  private lastRiverStep = -1;
  private depth: Uint8Array;
  private depthNext: Uint8Array;
  private depthDirty = false;
  crossing: Uint8Array | null = null;

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
    this.markAll();
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
   * Tiles whose map data changed. Neighbours are redrawn too: foam, wet edges,
   * overhanging tree crowns and mountain peaks all reach one tile across.
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

  setSeason(season: Season): void {
    if (season === this.time.season) return;
    this.time.season = season;
    for (let i = 0; i < this.dirty.length; i++) if (this.map.plantType[i] === Plant.Farmland) this.markDirty(i);
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
    // The streak test is (px + py + t) % 5, so only t mod 5 matters.
    this.time.riverStep = riverStep % R.riverStreakEvery;
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
      drawTilePixels(this.map, i, this.img.data, this.canvas.width, this.time, this.depth, this.crossing);
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
