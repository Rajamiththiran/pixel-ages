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
import { Mat, rampRgb, rampShift, rampTag, rampsOn } from './ramps';
import {
  FieldPos, GroundMark, GroundRole, KEYS, droughtOn, heldOn, snowPathsOn, wetYearOn, PUDDLE_DARK, PUDDLE_LIGHT, isGroundRole, isWaterRole, LookState, NO_TAG, Role, SELF, anchorCode, anchorOffsets, bayerKey, fieldRoleParts, frontOn, groundOn, fieldRole, iceAt, iceOn, resolveBand, sheafRole, snowAt, snowOn, winterKeys, createLook, createMatBuf, isCrown, isDeciduous, treesOn, dissolveMat, matbufOn, readMatTile, resolveRanks, resolveTile, sameMatLook, colourAt, type Look as SeasonLook, type MatBuf, type MatTile,
} from './materials';
import { MoistureField, cellNoise } from './moisture';
import { WinterField } from './winter';
import { FrontFields } from './seasonFront';
import { Mask, cloudDitherOn, puddlesOn, wetGroundOn, type CloudAt } from './clouds';
import { fieldClass, rowCut } from './fields';
import { applyTexture, bayer, ditherOn, ditherPixel } from './dither';
import { buildCrowns, canopyDistance, crownColourAt, crownPixelAt, inTreeShadow, type CrownPixel } from './crowns';
import { occlusionOn, shadowsOn } from './shadows';
import { HazardMark, Look, Mark, lookLevel } from '../shared/protocol';
import {
  PeakKind, SALT as DETAIL_SALT, applyDesertDetail, applyFoam, applyGrassDetail, applyWetEdge, blend, computeDepth, copy,
  edgeDistance, forestCrown, forestFloor, grad, isWaterTile, mix, mountainPeak, peakKind, peakShadowAt, scale, shade, waterPixel,
} from './terrainDetail';

const R = CONFIG.render;
const D = R.detail;
const F8 = R.f8;
const DR = R.diorama.ramps;
const DO = R.diorama.forestOcclusion;
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
  shadow?: Uint8ClampedArray | null; // Diorama phase 3: cast-shadow mask (alpha 255 = shadowed), same layout as the image
  mat?: MatBuf | null;           // Seasons Phase 1a: each pixel's ramp step and role, same layout as the image
  fields?: Uint8Array | null;    // Seasons Phase 2b: harvest per tile (0–255); given, farmland is drawn on the mockup's rows
  ponds?: Uint8Array | null;     // Seasons Phase 2c: still water small enough to freeze through (per tile, 1)
  keys?: Uint8Array | null;      // Seasons Phase 3a: each pixel's key in the current front (null: its Bayer key)
}

// What the pixel being drawn turned out to be, for shadows and occlusion (phase 3).
let onCrown = false;
let onPeak = false;
let crownsReady = false;
let onMark = false;            // a line, pit or ruin pixel of a mark (seasons Phase 1a role)

// Per-tile scratch, reused so drawing allocates nothing.
const nb = new Uint8Array(8);
const nbLake = new Uint8Array(8);
const out: RGB = [0, 0, 0];
const tmp: RGB = [0, 0, 0];
const BANK: RGB = [0, 0, 0];
mix(RGBS.grass, RGBS.mud, 0.55, BANK);
// Diorama: a mountain wall's body sits one step above stone-0, so its peaks' dark slopes show.
const WALL_BODY: RGB = rampsOn ? rampRgb(Mat.Stone, DR.wallBodyStep) : RGBS.mountainDark;
// Diorama farmland rows (crop ramp): a furrow, a lit ridge, then the crop.
const CROP_ROWS: readonly RGB[] = [rampRgb(Mat.Crop, 0), rampRgb(Mat.Crop, 3), rampRgb(Mat.Crop, 2)];

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
  let nearPeak = kind !== PeakKind.None;
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
    if (peakKind(map, j) !== PeakKind.None) nearPeak = true;
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
  // Phase 3: lay out the crowns near a forest once, for crown pixels, tree shadows and the canopy edge
  // (seasons Phase 2a: and each crown's kind and bare branches).
  crownsReady = nearForest && (shadowsOn || occlusionOn || treesOn);
  if (crownsReady) buildCrowns(map, tx, ty);
  const occlude = occlusionOn && crownsReady && wall === WallType.None && plant !== Plant.Forest && plant !== Plant.Farmland;
  const mat = ex.mat ?? null;
  // Seasons Phase 2a: a wood of mostly deciduous trees (low ground) has a bright floor in winter.
  const bareWood = treesOn && ground !== Ground.Mountain && evergreenChance(map.elevation[i]!) < 0.5;
  // Seasons Phase 2b: a field's class and harvest (−1: the old rows).
  fieldCut = ex.fields && plant === Plant.Farmland ? ex.fields[i]! : -1;
  if (fieldCut >= 0) fieldCls = fieldClass(tx, ty);
  // Seasons Phase 2d: flowers and leaf litter on the ground (the litter by the wood's deciduous share).
  const details = groundOn && mat !== null;
  const leafShare = details && nearForest && ground !== Ground.Mountain ? Math.max(0, 1 - evergreenChance(map.elevation[i]!)) : 0;

  /**
   * One land pixel into `out`; returns its role. Seasons Phase 2a draws it a second time without
   * crowns (`crowns` false): the ground a bare deciduous crown shows in winter.
   */
  const land = (ox: number, oy: number, px: number, py: number, edge: number, crowns: boolean): number => {
    onCrown = false;
    onPeak = false;
    onFruitSpeck = false;
    onFlower = false;
    landPixel(map, ground, plant, dens, kind, crowns && nearForest, stumps ? painted : -1, px, py, out);
    let role: number = landRole(ground, plant);
    if (treesOn) {
      onTree = onCrown && crownsReady && crownPixelAt(px, py, cp);
      if (onTree) role = crownRole(map, cp, px, py);
      else if (role === Role.Fruit) role = fruitRole(px, py, dens);
      else if (role === Role.Forest && bareWood) role = Role.FloorBare;
    }
    if (role === Role.Farm && fieldCut >= 0) role = fieldHere;
    if (resShare > 0 && hash01(px, py, SALT.resource + res) < resShare) copy(RESOURCE_COLOR[res]!, out);
    if (look !== 0) soilPixel(look, plant, px, py, out);
    if (tileMarks !== 0) {
      onMark = false;
      markPixel(map, ex.marks!, i, tileMarks, plant, look, ox, oy, px, py, out);
      if (onMark) role = Role.Mark;
    }
    if (tileHazards & HazardMark.Fire) {
      const f = hash01(px, py, SALT.fire);
      if (f < R.marks.flameShare) copy(f < R.marks.flameShare / 2 ? RGBS.fireYellow : RGBS.fireOrange, out);
      else shade(out, R.marks.burnDark, DR.burnSteps);
      role = Role.Fire;
    }
    if (beachGround && hasLake && edgeDistance(ox, oy, nbLake) < F8.beachPx) { copy(RGBS.sand, out); role = Role.Beach; }
    if (shaded) shadeHeight(map, px, py, out);
    if (hasEdge) applyWetEdge(edge, out);
    if (occlude && !onCrown) occludePixel(px, py, out);
    // Diorama phase 2: clustered ordered dither on land (the mockup leaves water untextured).
    if (ditherOn) applyTexture(px, py, out);
    return role;
  };

  for (let oy = 0; oy < TILE; oy++) {
    const py = ty * TILE + oy;
    for (let ox = 0; ox < TILE; ox++) {
      const px = tx * TILE + ox;
      const edge = hasEdge ? edgeDistance(ox, oy, nb) : 99;
      const corner = corners !== 0 ? cornerCut(ox, oy, corners) : false;
      if (ditherOn) ditherPixel(px, py);
      onCrown = false;
      onPeak = false;
      onTree = false;
      let role: number;   // a Role, or a field role (materials.ts fieldRole)

      if (water && !corner) {
        if (river) riverPixel(map, tx, ty, px, py, time.riverStep, out);
        else waterPixel(map, ex.depth, px, py, wall === WallType.Sea, time.waterStep, out);
        if (hasEdge) applyFoam(edge, px, py, time.waterStep, out);
        role = river ? Role.River : wall === WallType.Sea ? Role.Sea : ex.ponds && ex.ponds[i] === 1 ? Role.Pond : Role.Lake;
      } else if (water) {
        // A rounded-off corner of a water tile: the bank.
        copy(cornerLand, out);
        applyWetEdge(0, out);
        if (ditherOn) applyTexture(px, py, out);
        role = cornerLand === BANK ? Role.Bank : Role.Beach;
      } else if (corner) {
        // A land corner inside a bend: the water rounds it off.
        if (corners & RIVER_BEND) riverPixel(map, tx, ty, px, py, time.riverStep, out);
        else waterPixel(map, ex.depth, px, py, false, time.waterStep, out);
        role = corners & RIVER_BEND ? Role.River : Role.Lake;
      } else if (wall === WallType.Mountain) {
        mountainWallPixel(isCrossing, px, py, out);
        if (kind === PeakKind.Wall) onPeak = mountainPeak(map, kind, px, py, out);
        if (shaded) shadeHeight(map, px, py, out);
        if (hasEdge) applyWetEdge(edge, out);
        // Diorama phase 2: clustered ordered dither on land (the mockup leaves water untextured).
        if (ditherOn) applyTexture(px, py, out);
        role = onPeak ? Role.Peak : Role.Wall;
      } else {
        role = land(ox, oy, px, py, edge, true);
      }

      // Diorama: no random grain (readme: texture is ordered dither, applyTexture above), and
      // every pixel ends on a ramp or accent colour.
      let g = 1;
      // Seasons Phase 2a: a tree turns as one, at its centre's rank (a crown covered by sand or a
      // mark is ground again).
      const tree = onTree && isCrown(role);
      if (rampsOn) {
        const tag = rampTag(out);
        // Seasons Phase 1a: the material buffer keeps the step and role; the image is resolved from it.
        if (mat) {
          const p = py * imgW + px;
          mat.tag[p] = tag; mat.role[p] = role;
          // The pixel whose arrival it takes: a tree's centre, a field tile's centre (Phase 3a: field by field), or itself.
          const ax = tree ? cp.x : frontOn && fieldRoleParts(role) ? tx * TILE + TILE / 2 : px;
          const ay = tree ? cp.y : frontOn && fieldRoleParts(role) ? ty * TILE + TILE / 2 : py;
          mat.anchor[p] = ax === px && ay === py ? SELF : anchorCode(ax - px, ay - py);
          mat.rank[p] = ex.keys ? ex.keys[ay * imgW + ax]! : bayerKey(ax, ay);
          mat.alt[p] = NO_TAG;
          // Seasons Phase 2d: a flower or leaf litter, which keeps the ground under it in alt.
          if (details && (role === Role.Grass || role === Role.Forest || role === Role.FloorBare)) {
            if (onFlower && role === Role.Grass && isFlowerTag(tag)) {
              copy(out, flowerRgb);
              noFlowers = true;
              const under = land(ox, oy, px, py, edge, true);
              noFlowers = false;
              mat.role[p] = GroundRole.Flower; mat.alt[p] = rampTag(out); mat.altRole[p] = under;
              copy(flowerRgb, out);
            } else {
              const bloom = role === Role.Grass ? bloomTag(px, py) : -1;
              const litter = bloom < 0 && leafShare > 0 ? litterRole(px, py, role === Role.Grass, leafShare) : -1;
              if (bloom >= 0) { mat.tag[p] = bloom; mat.role[p] = GroundRole.Bloom; mat.alt[p] = tag; mat.altRole[p] = role; }
              else if (litter >= 0) { mat.role[p] = litter; mat.alt[p] = tag; mat.altRole[p] = role; }
            }
          }
        }
      } else g = 1 + R.grain * (2 * hash01(px, py, SALT.grain) - 1);
      const o = (py * imgW + px) * 4;
      if (ex.shadow) {
        // Phase 3: trees and peaks cast down-right; the crowns and peaks themselves stand above it.
        const cast = (crownsReady && !onCrown && inTreeShadow(px, py)) || (nearPeak && !onPeak && peakShadowAt(map, px, py));
        ex.shadow[o + 3] = cast ? 255 : 0;
      }
      data[o] = out[0] * g;
      data[o + 1] = out[1] * g;
      data[o + 2] = out[2] * g;
      data[o + 3] = 255;
      // Seasons Phase 2a: what a bare deciduous crown shows in winter: its branch, else the ground under it.
      if (mat && tree && isDeciduous(role)) {
        const p = py * imgW + px;
        if (cp.branch > 0) {
          mat.alt[p] = Mat.Wood * 8 + cp.branch;
          mat.altRole[p] = hash01(px, py, TRS.salt + 13) < TRS.branchSnowShare ? Role.BranchSnow : Role.Branch;
        } else {
          // Phase 2d: no flowers here (they would need an alt of their own; a bare tree is winter's anyway).
          noFlowers = details;
          const under = land(ox, oy, px, py, edge, false);
          noFlowers = false;
          mat.alt[p] = rampTag(out);
          mat.altRole[p] = under;
        }
      }
    }
  }
}

// ---------- seasons Phase 2a: trees and bushes ----------

const TRS = CONFIG.render.seasons.trees;
const cp: CrownPixel = { x: 0, y: 0, r: 0, dx: 0, dy: 0, branch: 0 };
let onTree = false;        // the pixel being drawn is a laid-out crown (cp holds it)
let onFruitSpeck = false;  // landPixel drew a fruit speck

/** The chance that a crown on land of this height is evergreen (mountain ground: Infinity). */
export function evergreenChance(elevation: number): number {
  const t = Math.max(0, Math.min(1, (elevation - TRS.evergreenFromElevation) / (TRS.evergreenFullElevation - TRS.evergreenFromElevation)));
  return TRS.evergreenBase + TRS.evergreenHigh * t;
}

/** A crown's kind from its centre (x, y): evergreen (Role.Crown) or a deciduous tree by its autumn colour. */
export function crownKind(x: number, y: number, elevation: number): Role {
  if (hash01(x, y, TRS.salt + 10) < evergreenChance(elevation)) return Role.Crown;
  const h = hash01(x, y, TRS.salt + 11);
  return h < TRS.autumnYellow ? Role.DecYellow : h < TRS.autumnYellow + TRS.autumnCopper ? Role.DecCopper : Role.DecGreen;
}

/**
 * The role of a crown pixel. An evergreen's lit upper pixels are its snow cap: white in winter
 * where the snow lies (Phase 2c: the snow cover decides, not the crown).
 */
function crownRole(map: MapData, c: CrownPixel, px: number, py: number): Role {
  const tx = Math.min(map.width - 1, Math.max(0, Math.floor(c.x / TILE)));
  const ty = Math.min(map.height - 1, Math.max(0, Math.floor(c.y / TILE)));
  const ti = ty * map.width + tx;
  const mountain = map.ground[ti] === Ground.Mountain;
  const kind = crownKind(c.x, c.y, mountain ? Infinity : map.elevation[ti]!);
  if (kind === Role.Crown && c.dy < 0 && (c.dx + c.dy) / c.r <= TRS.snowLitBelow
    && hash01(px, py, TRS.salt + 12) < TRS.snowCapShare) return Role.CrownSnow;
  return kind;
}

// ---------- seasons Phase 2b: fields and the harvest ----------

const FC = CONFIG.render.seasons.fields;
const CC = CONFIG.render.seasons.clouds;
const RNC = CONFIG.render.seasons.rain;

/** Phase 6: a puddle oval at (x, y) (mockup: a few small ovals per cell of puddleCellPx). */
function puddleShape(x: number, y: number): boolean {
  const [cw, ch] = RNC.puddleCellPx, [rx, ry] = RNC.puddleRadiusPx;
  const cx = Math.floor(x / cw!), cy = Math.floor(y / ch!);
  if (hash01(cx, cy, RNC.salt + 6) >= RNC.puddleShare) return false;
  const dx = (x - (cx * cw! + (cw! - 1) / 2)) / rx!, dy = (y - (cy * ch! + (ch! - 1) / 2)) / ry!;
  return dx * dx + dy * dy <= 1;
}

/** Phase 6: puddles stand in hollows (a tile lower than a neighbour), and on flat land in some tiles. */
function puddlyTile(map: MapData, tx: number, ty: number): boolean {
  const mw = map.width, e = map.elevation[ty * mw + tx]!;
  let higher = false, lower = false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = tx + dx, ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= mw || ny >= map.height) continue;
    const f = map.elevation[ny * mw + nx]!;
    if (f > e) higher = true; else if (f < e) lower = true;
  }
  return higher || (!lower && hash01(tx, ty, RNC.salt + 5) < RNC.puddleFlatShare);
}

const DRC = CONFIG.render.seasons.drought;

/** Phase 7: drought patches (the mockup's clustered noise above patchAbove). */
function droughtPatch(x: number, y: number): boolean {
  const [c0, c1] = DRC.patchCellPx, [w0, w1] = DRC.patchWeights;
  return w0! * cellNoise(x, y, c0!, DRC.salt) + w1! * cellNoise(x, y, c1!, DRC.salt + 1) > DRC.patchAbove;
}

/** Phase 7: the mockup's crack pattern: two sets of broken diagonal lines. */
function crackLine(x: number, y: number): boolean {
  const [e0, e1] = DRC.crackEvery, [s0, s1] = DRC.crackShare;
  const a = (((x + 2 * y) % e0!) + e0!) % e0! === 0 && hash01(x >> 2, y >> 1, DRC.salt + 2) < s0!;
  const b = (((2 * x - y) % e1!) + e1!) % e1! === 0 && hash01(x >> 1, y >> 2, DRC.salt + 3) < s1!;
  return a || b;
}

/** Phase 6: ground a puddle can stand on (open ground, paths, fields; not woods, bushes, rock or fire). */
function puddleRole(role: number): boolean {
  return role === Role.Grass || role === Role.Desert || role === Role.Mark || role === Role.Bank || role === Role.Beach
    || fieldRoleParts(role) !== null || isGroundRole(role);
}
// Phase 2c: how far past the snow line a moved line can change a pixel (dusting, dithered edge), 0–255.
const SNOW_EDGE = CONFIG.render.seasons.snow.edgeShare * 255;
const SNOW_DUST = CONFIG.render.seasons.snow.dustShare * 255;
let fieldCut = -1;         // the tile's harvest (0–255), −1 when farmland is drawn on the old rows
let fieldCls = 0;          // the tile's field class (fields.ts)
let fieldHere: number = Role.Farm;   // the role farmPixel gave the pixel

/** A sheaf's crop step at (px, py) in this tile's cut part (mockup: a 4-pixel stook), 0 for none. */
function sheafStep(px: number, py: number, tx: number, ty: number): number {
  const [ex, ey] = FC.sheafEveryPx;
  const at = (ax: number, ay: number): boolean => {
    const lx = ax - tx * TILE, ly = ay - ty * TILE;
    if (ax % ex! !== 3 || ay % ey! !== 3 || lx < 0 || lx > TILE - 2 || ly < 1 || ly > TILE - 2) return false;
    return lx + 1 < rowCut(fieldCut, tx, ty, ly, TILE);   // the whole stook stands in stubble
  };
  if (at(px, py + 1)) return 4;
  if (at(px, py)) return 3;
  if (at(px - 1, py)) return 2;
  if (at(px, py - 1)) return 1;
  return 0;
}

/**
 * Seasons Phase 2b: a farmland pixel on the mockup's rows (a ridge every other row), drawn in the
 * gold stage's colours (the system crop ramp); its role says where it sits and whether it is
 * harvested, and each season's stage is picked from that (materials.ts).
 */
function farmPixel(px: number, py: number, out: RGB): void {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  const lx = px - tx * TILE, ly = py - ty * TILE;
  const s = sheafStep(px, py, tx, ty);
  if (s > 0) { copy(rampRgb(Mat.Crop, s), out); fieldHere = sheafRole(fieldCls); return; }
  const cut = lx < rowCut(fieldCut, tx, ty, ly, TILE);
  let pos: number;
  if ((py & 1) === 0) {
    copy(rampRgb(Mat.Crop, hash01(px, py, FC.salt + 2) < 0.1 ? 0 : 1), out);
    pos = FieldPos.Furrow;
  } else {
    copy(rampRgb(Mat.Crop, hash01(px, py, FC.salt + 3) < 0.3 ? 4 : 3), out);
    pos = (px & 1) === 1 ? FieldPos.Stubble : hash01(px, py, FC.salt + 4) < FC.sproutShare ? FieldPos.Sprout : FieldPos.Ridge;
  }
  fieldHere = fieldRole(fieldCls, pos, cut);
}

// ---------- seasons Phase 2d: ground ----------

const GDC = CONFIG.render.seasons.ground;
let onFlower = false;      // landPixel drew one of the all-year grass flowers
let noFlowers = false;     // draw the ground without those flowers (the ground under one, or under a bare crown)
const flowerRgb: RGB = [0, 0, 0];
let flowerTags: number[] | null = null;   // white, yellow, fruit (accents)

function flowerTag(k: number): number {
  flowerTags ??= [RGBS.flowerWhite, RGBS.fireYellow, RGBS.fruit].map((c) => rampTag([...c] as RGB));
  return flowerTags[k]!;
}

const isFlowerTag = (tag: number): boolean => tag === flowerTag(0) || tag === flowerTag(1) || tag === flowerTag(2);

/** A spring flower's tag at open grass pixel (px, py), or −1 (mockup: flowerShare of the pixels in value-noise clusters). */
function bloomTag(px: number, py: number): number {
  const h = hash01(px, py, GDC.salt);
  if (h >= GDC.flowerShare || cellNoise(px, py, GDC.flowerCellPx, GDC.salt + 1) <= GDC.flowerAbove) return -1;
  return flowerTag(h < GDC.flowerWhite ? 0 : 1);
}

/**
 * The leaf-litter role at (px, py), or −1: on grass next to a forest (`edge`) in clustered patches,
 * on the forest floor more evenly (mockup), both × the wood's deciduous share. Its own hash, so a
 * pixel rarely carries a spring flower too (the mockup's one hash makes them share pixels).
 */
function litterRole(px: number, py: number, edge: boolean, share: number): number {
  const [c0, c1] = GDC.litterCellPx, [w0, w1] = GDC.litterNoiseWeights;
  const h = hash01(px, py, GDC.salt + 2);
  const limit = share * (edge ? GDC.litterEdge : GDC.litterFloor);
  if (h >= limit) return -1;
  const lim = edge ? limit * (w0! * cellNoise(px, py, c0!, GDC.salt + 3) + w1! * cellNoise(px, py, c1!, GDC.salt + 4)) : limit;
  if (h >= lim) return -1;
  const u = h / lim;
  return u < GDC.litterGold ? GroundRole.LitterGold : u < GDC.litterGold + GDC.litterYellow ? GroundRole.LitterYellow : GroundRole.LitterCopper;
}

/** The role of a fruit-bush pixel: its fruit, a twig bare in winter, a blossom in spring, or a leaf. */
function fruitRole(px: number, py: number, dens: number): Role {
  if (onFruitSpeck) return Role.FruitSpeck;
  const h = hash01(px, py, TRS.salt + 14);
  return h < TRS.twigShare * dens ? Role.FruitTwig : h < (TRS.twigShare + TRS.blossomShare) * dens ? Role.FruitBlossom : Role.Fruit;
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
function shadeHeight(map: MapData, px: number, py: number, out: RGB): void {
  const half = TILE / 2;
  const d = heightAt(map, px - half, py - half) - heightAt(map, px + half, py + half);
  if (rampsOn) {
    // Whole ramp steps: lit slopes warmer and lighter, far slopes cooler and darker.
    const steps = -Math.round(d / DR.heightPerStep);
    if (steps !== 0) rampShift(out, Math.max(-DR.heightMaxSteps, Math.min(DR.heightMaxSteps, steps)));
    return;
  }
  const S = F8.shade;
  scale(out, 1 - Math.max(-S.max, Math.min(S.max, d * S.perStep)));
}

// ---------- soil, marks, land ----------

/** F8 look byte: worn fields paler, salt white, flood silt muddy with puddles. */
function soilPixel(look: number, plant: number, px: number, py: number, o: RGB): void {
  const S = F8.soil;
  const worn = lookLevel(look, Look.wornShift);
  if (worn > 0 && plant === Plant.Farmland) {
    // Diorama: one step paler per wear level (a blend toward sand under halfway would not show on the ramps).
    if (rampsOn) rampShift(o, worn * DR.wornSteps);
    else { copy(o, tmp); blend(tmp, RGBS.sand, S.wornPale[worn - 1]!, o); }
  }
  const salt = lookLevel(look, Look.saltShift);
  if (salt > 0 && hash01(px, py, SALT.salt) < S.saltWhite[salt - 1]!) copy(RGBS.salt, o);
  if (look & Look.Silt) {
    copy(o, tmp);
    mix(tmp, RGBS.mud, S.siltBlend, o);
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
  if (m & Mark.Terrace && plant === Plant.Farmland && oy % 3 === 2) shade(out, R.marks.terraceDark, DR.terraceSteps);
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
  if (m & Mark.Canal && onLine(Mark.Canal, false, true)) { copy(RGBS.waterLight, out); onMark = true; }
  if (m & Mark.Road) {
    if (onLine(Mark.Road | Mark.Path, true, false)) { mix(out, RGBS.stoneLight, R.marks.roadBlend, out); onMark = true; }
  } else if (m & Mark.Path && onLine(Mark.Path | Mark.Road, false, false)) { mix(out, RGBS.sand, R.marks.pathBlend, out); onMark = true; }
  if (m & Mark.Quarry) {
    const d2 = (ox - mid - 0.5) ** 2 + (oy - mid - 0.5) ** 2;
    if (d2 <= R.marks.pitRadius2) { copy(d2 <= 1 ? RGBS.ink : RGBS.mountainDark, out); onMark = true; }
  }
  if (m & Mark.Ruin) {
    const ring = (ox === 1 || ox === TILE - 2) && oy >= 1 && oy <= TILE - 2
      || (oy === 1 || oy === TILE - 2) && ox >= 1 && ox <= TILE - 2;
    if (ring && hash01(px, py, SALT.ruin) > R.marks.ruinGap) { copy(RGBS.stone, out); onMark = true; }
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

/**
 * Forest-edge occlusion: ground just right of or below a canopy is darker, by the mockup's shade
 * of 0.3 / distance, as a share of pixels dropping one ramp step (Bayer, or rounding without dither).
 */
function occludePixel(px: number, py: number, out: RGB): void {
  const d = canopyDistance(px, py);
  if (d === 0) return;
  const share = Math.min(1, DO.shade / d / DO.shadePerStep);
  if (share > (ditherOn ? bayer(px, py) : 0.5)) rampShift(out, -1);
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
      if (kind === PeakKind.Ground) onPeak = mountainPeak(map, kind, px, py, out);
      break;
    default:
      copy(RGBS.grass, out);
      if (plant === Plant.None) onFlower = applyGrassDetail(px, py, D.tuftBase, !noFlowers, out);
  }

  switch (plant) {
    case Plant.Grass: {
      const desert = ground === Ground.Desert;
      copy(out, tmp);
      grad(tmp, RGBS.grassLight, desert ? dens * R.desertGrassMaxBlend : dens, out);
      const chance = (ground === Ground.Grassland ? D.tuftBase : 0) + D.tuftGrassBonus * dens;
      onFlower = applyGrassDetail(px, py, chance, ground === Ground.Grassland && !noFlowers, out);
      break;
    }
    case Plant.Forest:
      forestFloor(dens, out);
      break;
    case Plant.FruitBushes:
      copy(out, tmp);
      grad(tmp, RGBS.fruitBush, dens, out);
      if (speck(px, py, SALT.fruit, R.fruitSpeck * dens)) { copy(RGBS.fruit, out); onFruitSpeck = true; }
      break;
    case Plant.Farmland:
      // Crop rows; the season's colour (green → gold → stubble → bare) is the season tint (F8).
      // Seasons Phase 2b: the mockup's rows, drawn gold; the stage comes from the pixel's role.
      if (fieldCut >= 0) farmPixel(px, py, out);
      else if (rampsOn) copy(CROP_ROWS[Math.min(2, py % R.farmSoilRowEvery)]!, out);
      else copy(py % R.farmSoilRowEvery === 0 ? RGBS.wood : RGBS.grass, out);
      break;
  }

  if (painted >= 0 && stumpAt(map, px, py, painted)) copy((px & 1) === 0 ? RGBS.wood : RGBS.darkWood, out);
  // Crowns last: they stand above the ground and may overhang from a neighbouring forest tile.
  if (nearForest) onCrown = crownsReady ? crownColourAt(px, py, out) : forestCrown(map, px, py, out);
}

/** A land pixel's role after landPixel: crowns and peaks stand above the ground (seasons Phase 1a). */
function landRole(ground: number, plant: number): Role {
  if (onCrown) return Role.Crown;
  if (onPeak) return Role.Peak;
  switch (plant) {
    case Plant.Forest: return Role.Forest;
    case Plant.FruitBushes: return Role.Fruit;
    case Plant.Farmland: return Role.Farm;
  }
  return ground === Ground.Mountain ? Role.Mountain : ground === Ground.Desert ? Role.Desert : Role.Grass;
}

function mountainWallPixel(isCrossing: boolean, px: number, py: number, out: RGB): void {
  if (isCrossing) copy(speck(px, py, SALT.pass, R.mountainPassSpeck) ? RGBS.stone : RGBS.sand, out);
  else if (speck(px, py, SALT.wallInk, R.mountainWallInkSpeck)) copy(RGBS.ink, out);
  else if (speck(px, py, SALT.wallLight, R.mountainWallLightSpeck)) copy(RGBS.stoneLight, out);
  else copy(WALL_BODY, out);
}

// ---------- Speeds plan Phase 5: tiles dissolve instead of popping ----------

const GR = CONFIG.render.gradual;
const TILE_BYTES_PX = TILE * TILE * 4;

/** A tile's look, copied out: its RGBA pixels, or its material entries (seasons Phase 1a). */
type TileSnap = Uint8ClampedArray | MatTile;

/** A tile changing look: its old and new look, when it began, and the step drawn. */
interface TileFade { old: TileSnap; neu: TileSnap; start: number; step: number }

/**
 * How the layer copies, compares and dissolves a tile. Without the material buffer: the image's
 * RGBA pixels (as before). With it: the buffer's entries, and `commit` resolves the tile's colours
 * into the image, so the image is always the lookup's result.
 */
interface TileStore {
  read(tx: number, ty: number, out?: TileSnap): TileSnap;
  same(tx: number, ty: number, a: TileSnap, b: TileSnap): boolean;
  dissolve(tx: number, ty: number, old: TileSnap, neu: TileSnap, step: number): void;
  commit(tx: number, ty: number): void;
  /** A snapshot no longer needed: kept for the next read (a late-game map snapshots many tiles a month). */
  release(s: TileSnap): void;
}

const POOL_MAX = 4096;

function rgbaStore(data: Uint8ClampedArray, imgW: number): TileStore {
  const pool: Uint8ClampedArray[] = [];
  return {
    read: (tx, ty, out) => readTile(data, imgW, tx, ty, (out ?? pool.pop()) as Uint8ClampedArray | undefined),
    same: (_tx, _ty, a, b) => sameTile(a as Uint8ClampedArray, b as Uint8ClampedArray),
    dissolve: (tx, ty, old, neu, step) => dissolveTile(data, imgW, tx, ty, old as Uint8ClampedArray, neu as Uint8ClampedArray, step),
    commit: () => {},
    release: (s) => { if (pool.length < POOL_MAX) pool.push(s as Uint8ClampedArray); },
  };
}

function matStore(mat: MatBuf, look: SeasonLook, px: Uint32Array): TileStore {
  const pool: MatTile[] = [];
  return {
    read: (tx, ty, out) => readMatTile(mat, tx, ty, (out ?? pool.pop()) as MatTile | undefined),
    same: (tx, ty, a, b) => sameMatLook(mat, look, tx, ty, a as MatTile, b as MatTile),
    dissolve: (tx, ty, old, neu, step) => { dissolveMat(mat, tx, ty, old as MatTile, neu as MatTile, step); resolveTile(mat, look, px, tx, ty); },
    commit: (tx, ty) => resolveTile(mat, look, px, tx, ty),
    release: (s) => { if (pool.length < POOL_MAX) pool.push(s as MatTile); },
  };
}

/** Copies tile (tx, ty)'s pixels out of the terrain image. */
export function readTile(data: Uint8ClampedArray, imgW: number, tx: number, ty: number, out: Uint8ClampedArray = new Uint8ClampedArray(TILE_BYTES_PX)): Uint8ClampedArray {
  for (let y = 0; y < TILE; y++) {
    const o = ((ty * TILE + y) * imgW + tx * TILE) * 4;
    out.set(data.subarray(o, o + TILE * 4), y * TILE * 4);
  }
  return out;
}

export function sameTile(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Writes tile (tx, ty) at dissolve `step` of `fadeSteps`: a pixel shows its new colour once its
 * Bayer threshold (the same 4×4 order as the ground dither) is below step ÷ fadeSteps, so the new
 * look arrives in even 25% patches and each pixel changes once.
 */
export function dissolveTile(data: Uint8ClampedArray, imgW: number, tx: number, ty: number,
  old: Uint8ClampedArray, neu: Uint8ClampedArray, step: number): void {
  const share = step / GR.fadeSteps;
  for (let y = 0; y < TILE; y++) {
    const py = ty * TILE + y;
    const o = (py * imgW + tx * TILE) * 4;
    for (let x = 0; x < TILE; x++) {
      const src = bayer(tx * TILE + x, py) < share ? neu : old;
      const s = (y * TILE + x) * 4;
      data[o + x * 4] = src[s]!; data[o + x * 4 + 1] = src[s + 1]!; data[o + x * 4 + 2] = src[s + 2]!; data[o + x * 4 + 3] = src[s + 3]!;
    }
  }
}

/** Offscreen terrain canvas with dirty-tile redraw. */
export class TerrainLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  /** Phase 3: where trees and peaks cast their shadow (opaque = shadowed); null with shadows off. */
  readonly shadowCanvas: HTMLCanvasElement | null = null;
  private readonly shadowCtx: CanvasRenderingContext2D | null = null;
  private readonly shadowImg: ImageData | null = null;
  private readonly dirty: Uint8Array;
  private dirtyList: number[] = [];
  private time: TerrainTime = { waterStep: 0, riverStep: 0 };
  private lastWaterStep = -1;
  private lastRiverStep = -1;
  private depth: Uint8Array;
  private depthNext: Uint8Array;
  private depthDirty = false;
  private readonly extras: TileExtras;
  // Speeds plan Phase 5: tiles the simulation changed dissolve from their old look (see TileFade).
  /** Off at the speeds that hold the season look, in a time-lapse and in setup. */
  fadeOn = false;
  private fadeWanted: Uint8Array;
  private readonly fades = new Map<number, TileFade>();
  /** Seasons Phase 1a: each pixel's ramp step and role; the image is resolved from it. Null with `?off=matbuf`. */
  readonly mat: MatBuf | null = null;
  private readonly store: TileStore;
  // Phase 1b: the season each Bayer rank shows, the grass moisture, and what waits to be recoloured.
  private readonly look: SeasonLook | null = null;
  private readonly px: Uint32Array;
  private readonly moisture: MoistureField | null = null;
  // Phase 2c: the orders snow and ice reach each pixel, and whether a moved line waits to be drawn.
  private readonly winter: WinterField | null = null;
  private coverDirty = false;
  private coverFull = false;       // the orders themselves changed: every pixel showing winter is recoloured
  private drawnSnow = 0;           // the lines the image shows
  private drawnIce = 0;
  private rain: ArrayLike<number> | null = null;
  private moistureDirty = false;
  private readonly keysDirty = new Uint8Array(KEYS);   // 1: key k shows a new state
  private anyKeysDirty = false;
  private readonly winterMask = new Uint8Array(KEYS);
  // Phase 3a: the front fields, and each pixel's key in the field shown now (−1: the Bayer keys).
  private readonly fronts: FrontFields | null = null;
  private readonly keys: Uint8Array | null = null;
  private keysKind = -1;
  private keysYear = 0;
  private wholeImage = false;      // the next upload covers every tile
  // Phase 5: cloud shadows as ramp steps per pixel (look.shade), the clouds last stamped, and the storm's gloom.
  private shade: Uint8Array | null = null;
  private stamped: CloudAt[] = [];
  private gloom = false;
  private raining = true;          // Phase 6: rain clouds wet the ground (off at the held speeds)
  private cloudsStale = false;     // Phase 6: winter came or went: the next move recomputes whole cloud boxes
  // Phase 7: the marks years-long weather leaves per pixel (materials.ts GroundMark), and the per-tile state they come from.
  private groundMarks: Uint8Array | null = null;
  private groundStates: Uint8Array | null = null;
  private rects: number[] = [];                       // x, y, w, h of each rectangle to upload
  private readonly rectImgs = new Map<number, ImageData>();   // small images for those uploads, by size

  /** `useMat`: draw through the material buffer (the switch; tests compare both ways). */
  constructor(private map: MapData, useMat = matbufOn) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = map.width * TILE;
    this.canvas.height = map.height * TILE;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    const n = map.width * map.height;
    this.dirty = new Uint8Array(n);
    this.fadeWanted = new Uint8Array(n);
    this.depth = new Uint8Array(n);
    this.depthNext = new Uint8Array(n);
    computeDepth(map, this.depth);
    if (shadowsOn) {
      this.shadowCanvas = document.createElement('canvas');
      this.shadowCanvas.width = this.canvas.width;
      this.shadowCanvas.height = this.canvas.height;
      this.shadowCtx = this.shadowCanvas.getContext('2d')!;
      this.shadowImg = this.shadowCtx.createImageData(this.canvas.width, this.canvas.height);
    }
    this.px = new Uint32Array(this.img.data.buffer, this.img.data.byteOffset, this.img.data.length >> 2);
    if (useMat && rampsOn) {
      this.mat = createMatBuf(this.canvas.width, this.canvas.height);
      this.look = createLook();
      this.moisture = new MoistureField(map.width, map.height);
      if (snowOn || iceOn) this.winter = new WinterField(map.width, map.height);
      this.keys = new Uint8Array(this.canvas.width * this.canvas.height);
      this.bayerKeys(this.keys);
      if (frontOn) this.fronts = new FrontFields(map.width, map.height);
    }
    this.store = this.mat && this.look ? matStore(this.mat, this.look, this.px) : rgbaStore(this.img.data, this.canvas.width);
    this.extras = { depth: this.depth, crossing: null, marks: null, hazards: null, look: null, base: null, shadow: this.shadowImg?.data ?? null, mat: this.mat, keys: this.keys };
    this.winterNow();
    this.markAll();
  }

  set crossing(c: Uint8Array | null) { this.extras.crossing = c; }

  /** Seasons Phase 2b: the harvest per tile (FieldState.cut); given, farmland is drawn on the mockup's rows. */
  set fields(cut: Uint8Array | null) { this.extras.fields = cut; this.markAll(); }

  /** Tiles whose look changed but not their map data (a field cut further): redrawn, nothing else. */
  redrawTiles(tiles: readonly number[]): void { for (const i of tiles) this.markDirty(i); }
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
    // Phase 3a: the front fields only change with the land's height (setMap also runs at a run's
    // start and end, and they take ~250 ms on a full map).
    if (this.fronts?.heightsChanged(map)) this.keysKind = -2;
    computeDepth(map, this.depth);
    this.moisture?.landChanged();
    this.moistureDirty = true;
    this.winterNow();
    this.markAll();
  }

  /**
   * Phase 2c: works out the snow and ice orders now (a new map, or water came or went: ~100 ms, so
   * not on ordinary land changes). Tiles that became or stopped being a pond are redrawn (their
   * role); nothing else is, so tiles fading keep fading.
   */
  private winterNow(): void {
    const w = this.winter, look = this.look;
    if (!w || !look) return;
    // Phase 3a: snow lies in the cold front's order once the front fields are worked out (rekey).
    w.arrival = this.fronts?.isReady ? this.fronts.coldShare : null;
    const before = w.ponds.slice();
    w.invalidate();
    w.ensure(this.map);
    look.cold = snowOn ? w.cold : null;
    look.ice = iceOn ? w.ice : null;
    this.extras.ponds = iceOn ? w.ponds : null;
    this.coverFull = true;
    for (let i = 0; i < before.length; i++) if (before[i] !== w.ponds[i]) this.markDirty(i);
  }

  /**
   * Phase 1b: the state each key shows (materials.ts LookState). Keys that change are recoloured on
   * the next flush, without redrawing a tile. Phase 3a: `kind` is the front field the keys follow
   * (seasonFront.ts FrontKind; −1 the Bayer keys) in `year`.
   */
  setLook(states: ArrayLike<number>, kind = -1, year = 0): void {
    const look = this.look;
    if (!look) return;
    const k = this.fronts ? kind : -1;
    const y = k >= 0 ? year : 0;
    // The painted map (setup) needs no keys: the fields are worked out when a season first shows,
    // so painting in setup never waits for them.
    let painted = true;
    for (let r = 0; r < look.shown.length && painted; r++) painted = states[r] === LookState.Painted && look.shown[r] === LookState.Painted;
    if (!painted && (k !== this.keysKind || y !== this.keysYear)) this.rekey(k, y);
    for (let r = 0; r < look.shown.length; r++) {
      if (look.shown[r] === states[r]) continue;
      if (look.shown[r] === LookState.Winter || states[r] === LookState.Winter) this.cloudsStale = true;
      look.shown[r] = states[r]!;
      this.keysDirty[r] = 1;
      this.anyKeysDirty = true;
    }
  }

  /** The keys without the front: each pixel's Bayer key (Phase 1b's dissolve). */
  private bayerKeys(out: Uint8Array): void {
    const w = this.canvas.width, h = this.canvas.height;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = bayerKey(x, y);
  }

  /**
   * Phase 3a: the keys follow another field (a new front, a new year). Each pixel takes the key of
   * its anchor; snapshots of fading tiles too. A front starts with every key showing one state, so
   * this recolours nothing; if they differ (a jump, a fast speed skipping a front's end) every key is.
   */
  private rekey(kind: number, year: number): void {
    const mat = this.mat, look = this.look, keys = this.keys;
    if (!mat || !look || !keys) return;
    if (kind >= 0) {
      if (this.fronts!.ensure(this.map)) this.winterNow();
      this.fronts!.keys(kind, year, keys);
    } else this.bayerKeys(keys);
    this.keysKind = kind; this.keysYear = year;
    const off = anchorOffsets(mat.w), n = keys.length, last = n - 1;
    const keyOf = (p: number, a: number): number => keys[Math.min(last, Math.max(0, p + off[a]!))]!;
    for (let p = 0; p < n; p++) mat.rank[p] = keyOf(p, mat.anchor[p]!);
    const w = this.map.width;
    const snap = (i: number, t: MatTile): void => {
      const tx = i % w, ty = (i - tx) / w;
      for (let y = 0; y < TILE; y++) {
        const o = (ty * TILE + y) * mat.w + tx * TILE;
        for (let x = 0; x < TILE; x++) t.rank[y * TILE + x] = keyOf(o + x, t.anchor[y * TILE + x]!);
      }
    };
    for (const [i, f] of this.fades) { snap(i, f.old as MatTile); snap(i, f.neu as MatTile); }
    const s0 = look.shown[0];
    if (!look.shown.every((s) => s === s0)) { this.keysDirty.fill(1); this.anyKeysDirty = true; }
  }

  /** Phase 1b: the rain per tile the screen shows (its contents may change later; call again then). */
  /**
   * Phase 2c: the snow and ice lines winter has reached (0–255; seasonLook.ts). Pixels showing
   * winter are recoloured on the next flush when either moves.
   */
  setCover(snowLine: number, iceLine: number): void {
    const look = this.look;
    if (!look || !this.winter) return;
    const s = snowOn ? snowLine : 0, i = iceOn ? iceLine : 0;
    if (s === look.snowLine && i === look.iceLine) return;
    look.snowLine = s; look.iceLine = i;
    this.coverDirty = true;
  }

  /**
   * Phase 5 (mockup E, owner decision S12): the clouds now, at whole-pixel positions, and whether a
   * storm's gloom lies over the land. Their shadows (offset down-right) drop the ground one or two ramp
   * steps on a world-fixed checker; only pixels whose drop changed are recoloured, so a ground pixel
   * changes only as a shadow's edge passes it.
   */
  setClouds(clouds: readonly CloudAt[], gloom: boolean, rain = true): void {
    const mat = this.mat, look = this.look;
    if (!mat || !look || !cloudDitherOn) return;
    const same = gloom === this.gloom && rain === this.raining && clouds.length === this.stamped.length
      && clouds.every((c, k) => c.shape === this.stamped[k]!.shape && c.x === this.stamped[k]!.x && c.y === this.stamped[k]!.y);
    if (same) return;
    const w = mat.w, h = mat.h;
    if (!this.shade) { this.shade = new Uint8Array(w * h); look.shade = this.shade; }
    const shade = this.shade;
    const [sx, sy] = CC.shadowOffsetPx;
    const box = (c: CloudAt): [number, number, number, number] => {
      const x0 = c.x + c.shape.ox + sx!, y0 = c.y + c.shape.oy + sy!;
      return [x0, y0, x0 + c.shape.w, y0 + c.shape.h];
    };
    const boxes = clouds.map(box);
    const g = gloom ? 1 : 0;
    // Winter came or went somewhere: rain's wet ground and puddles inside a zone may change, not only at its edges.
    const full = this.cloudsStale;
    this.cloudsStale = false;
    const map = this.map;
    const puddly = (tx: number, ty: number): boolean => puddlyTile(map, tx, ty);
    const nearOf = (x0: number, y0: number, x1: number, y1: number): number[] => {
      const near: number[] = [];
      boxes.forEach((b, k) => { if (b[0] < x1 && b[2] > x0 && b[1] < y1 && b[3] > y0) near.push(k); });
      return near;
    };
    /** Recomputes pixel (x, y)'s shade from the clouds in `near`; true if it changed (and is recoloured). */
    const one = (x: number, y: number, near: number[]): boolean => {
      const odd = (x + y) & 1;
      let d = 0, wet = 0, pud = 0;
      for (let j = 0; j < near.length; j++) {
        const k = near[j]!, b = boxes[k]!;
        if (x < b[0] || y < b[1] || x >= b[2] || y >= b[3]) continue;
        const s = clouds[k]!.shape, m = s.mask[(y - b[1]) * s.w + (x - b[0])]!;
        const v = m & Mask.Core ? 1 + odd : m & Mask.In ? odd : 0;
        if (v > d) d = v;
        if (rain && s.rainy) { if (m & Mask.Wet) wet = 1; if (m & Mask.Puddle) pud = 1; }
      }
      const p = y * w + x;
      let v = Math.min(3, d + g * odd);
      if (wet || pud) {
        // Phase 6 (mockup E): rain wets open land a step darker, and puddles stand; not where winter shows.
        const role = mat.role[p]!;
        if (!isWaterRole(role) && look.shown[mat.rank[p]!] !== LookState.Winter) {
          if (pud && puddlesOn && puddleRole(role) && puddleShape(x, y) && puddly(Math.floor(x / TILE), Math.floor(y / TILE))) {
            v = puddleShape(x - 1, y - 1) ? PUDDLE_DARK : PUDDLE_LIGHT;
          } else if (wet && wetGroundOn) v = Math.min(3, v + 1);
        }
      }
      if (v === shade[p]) return false;
      shade[p] = v;
      if (mat.tag[p] !== NO_TAG) this.px[p] = colourAt(mat, look, p, x, y);
      return true;
    };
    /** Recomputes the shade in a rectangle; true if a pixel changed. */
    const redo = (x0: number, y0: number, x1: number, y1: number): boolean => {
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
      if (x0 >= x1 || y0 >= y1) return false;
      const near = nearOf(x0, y0, x1, y1);
      let any = false;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (one(x, y, near)) any = true;
      return any;
    };
    if (gloom !== this.gloom || rain !== this.raining) {
      // The storm came or went (or rain stopped wetting): every pixel.
      this.gloom = gloom;
      redo(0, 0, w, h);
      this.wholeImage = true;
    } else {
      // Each cloud once, over where it was and where it is now (clouds keep their shape while crossing);
      // a cloud that came or went, over its one box. Only those boxes are uploaded.
      const before = new Map(this.stamped.map((c) => [c.shape, c] as const));
      const todo: [number, number, number, number][] = [];
      clouds.forEach((c, k) => {
        const b = boxes[k]!, was = before.get(c.shape);
        before.delete(c.shape);
        if (!was) { todo.push(b); return; }
        if (was.x === c.x && was.y === c.y) return;
        const o = box(was);
        const u: [number, number, number, number] = [Math.min(b[0], o[0]), Math.min(b[1], o[1]), Math.max(b[2], o[2]), Math.max(b[3], o[3])];
        if (full || c.x !== was.x + 1 || c.y !== was.y) { todo.push(u); return; }
        // One pixel with the wind: inside the shape nothing changes (the checker is fixed to the world),
        // so only its outlines can: a pixel whose mask value differs from the one to its right (the cloud
        // moved that one onto it). A whole box each move was ~20% of a frame with rain's wider zones (measured).
        const near = nearOf(u[0], u[1], u[2], u[3]), e = c.shape.edges;
        let any = false;
        for (let j = 0; j < e.length; j += 2) {
          const x = b[0] + e[j]! - 1, y = b[1] + e[j + 1]!;   // the pixel left of each mask edge: it saw the edge's right side before
          if (x >= 0 && y >= 0 && x < w && y < h && one(x, y, near)) any = true;
        }
        if (any) {
          const x0 = Math.max(0, u[0]), y0 = Math.max(0, u[1]);
          this.rects.push(x0, y0, Math.min(w, u[2]) - x0, Math.min(h, u[3]) - y0);
        }
      });
      for (const o of before.values()) todo.push(box(o));
      for (const r of todo) {
        if (!redo(r[0], r[1], r[2], r[3])) continue;
        const x0 = Math.max(0, r[0]), y0 = Math.max(0, r[1]);
        this.rects.push(x0, y0, Math.min(w, r[2]) - x0, Math.min(h, r[3]) - y0);
      }
    }
    this.stamped = clouds.slice();
    this.raining = rain;
  }

  /**
   * Phase 5: uploads the rectangles cloud shadows changed, each through a small image of its own (a
   * dirty-rect putImageData of the whole image copies all of it in Chrome; measured: ~10 ms a move).
   */
  private uploadRects(): void {
    const r = this.rects, w = this.canvas.width;
    for (let k = 0; k < r.length; k += 4) {
      const x = r[k]!, y = r[k + 1]!, rw = r[k + 2]!, rh = r[k + 3]!;
      if (rw <= 0 || rh <= 0) continue;
      const key = rw * 100000 + rh;
      let img = this.rectImgs.get(key);
      if (!img) { img = this.ctx.createImageData(rw, rh); this.rectImgs.set(key, img); }
      const dst = new Uint32Array(img.data.buffer);
      for (let row = 0; row < rh; row++) dst.set(this.px.subarray((y + row) * w + x, (y + row) * w + x + rw), row * rw);
      this.ctx.putImageData(img, x, y);
    }
    this.rects.length = 0;
    if (this.rectImgs.size > 64) this.rectImgs.clear();
  }

  /**
   * Phase 7: the years-long weather per tile (weather.ts: 0 none, 1 drought, 2 wet year, by the shown
   * rain against the painted rain). Tiles whose state changed get their marks (cracked sand, puddles)
   * and are recoloured in place.
   */
  setGround(states: Uint8Array): void {
    const look = this.look, mat = this.mat;
    if (!look || !mat || (!droughtOn && !wetYearOn)) return;
    if (!this.groundMarks) {
      this.groundMarks = new Uint8Array(mat.w * mat.h);
      this.groundStates = new Uint8Array(states.length);
      look.ground = this.groundMarks;
    }
    const w = this.map.width;
    let any = false;
    for (let i = 0; i < states.length; i++) {
      if (states[i] === this.groundStates![i]) continue;
      this.groundStates![i] = states[i]!;
      this.groundTile(i);
      this.store.commit(i % w, Math.floor(i / w));
      any = true;
    }
    if (any) this.wholeImage = true;
  }

  /** Phase 7: the marks of tile i's pixels: cracks on open dry land in patches, puddles on open wet land. */
  private groundTile(i: number): void {
    const mat = this.mat!, marks = this.groundMarks!, st = this.groundStates![i]!;
    const w = this.map.width, tx = i % w, ty = (i - tx) / w;
    const puddly = st === 2 && puddlyTile(this.map, tx, ty);
    for (let oy = 0; oy < TILE; oy++) {
      const y = ty * TILE + oy;
      for (let ox = 0; ox < TILE; ox++) {
        const x = tx * TILE + ox, p = y * mat.w + x, role = mat.role[p]!;
        let m: number = GroundMark.None;
        // Open ground only (mockup: not paths, banks, rock or woods).
        if (st !== 0 && (role === Role.Grass || role === Role.Desert || isGroundRole(role))) {
          if (st === 1 && droughtOn && droughtPatch(x, y)) {
            m = crackLine(x, y) ? GroundMark.CrackLine : hash01(x, y, DRC.salt + 4) < DRC.bodyLightShare ? GroundMark.CrackLight : GroundMark.CrackBody;
          } else if (st === 2 && wetYearOn && puddly && puddleShape(x, y)) {
            m = puddleShape(x - 1, y - 1) ? GroundMark.PuddleDark : GroundMark.PuddleLight;
          }
        }
        marks[p] = m;
      }
    }
  }

  /** Phase 7: trampled ground round homes (1 per pixel), which snow only dusts; null for none. */
  setTrample(mask: Uint8Array | null): void {
    const look = this.look;
    if (!look || !snowPathsOn) return;
    look.trample = mask;
    this.coverFull = true;
  }

  /**
   * Phase 6: what falls at map pixel (px, py) (weather.ts Fall): snow where the land shows winter (where
   * snow can lie), nothing on water showing winter, rain anywhere else.
   */
  fallAt(px: number, py: number): number {
    const mat = this.mat, look = this.look;
    if (!mat || !look || px < 0 || py < 0 || px >= mat.w || py >= mat.h) return 0;
    const p = py * mat.w + px;
    if (look.shown[mat.rank[p]!] !== LookState.Winter) return 0;
    return isWaterRole(mat.role[p]!) ? 2 : 1;
  }

  /** Phase 2c: is map pixel (px, py) under snow now? (A building there wears it on its roof.) */
  snowAt(px: number, py: number): boolean {
    if (!this.mat || !this.look || px < 0 || py < 0 || px >= this.mat.w || py >= this.mat.h) return false;
    return snowAt(this.mat, this.look, py * this.mat.w + px, px, py);
  }

  /** Phase 2c: is the centre of tile i frozen now? (Boats keep off it.) */
  frozenTile(i: number): boolean {
    if (!this.mat || !this.look) return false;
    const w = this.map.width, px = (i % w) * TILE + TILE / 2, py = Math.floor(i / w) * TILE + TILE / 2;
    return iceAt(this.mat, this.look, py * this.mat.w + px);
  }

  setRain(rain: ArrayLike<number>): void {
    this.rain = rain;
    this.moistureDirty = true;
  }

  /** What each key shows now (tests and the dev hooks). */
  get shownStates(): readonly number[] { return this.look ? Array.from(this.look.shown) : []; }

  markDirty(i: number): void {
    if (this.dirty[i]) return;
    this.dirty[i] = 1;
    this.dirtyList.push(i);
  }

  /**
   * Tiles whose map data changed. Neighbours are redrawn too: foam, wet edges, beaches, river
   * bends, height shading, overhanging tree crowns and mountain peaks all reach one tile across.
   */
  mapChanged(tiles: Iterable<number>, fade = false): void {
    const list = Array.isArray(tiles) ? tiles as number[] : [...tiles];
    for (const i of list) this.markWithNeighbours(i, fade && this.fadeOn);
    this.depthDirty = true;
    // Grass near water is wetter: only water coming or going changes the moisture.
    if (this.moisture?.tilesChanged(this.map, list)) this.moistureDirty = true;
    // Water came or went: the snow and ice orders (and which water is a pond) are worked out again.
    if (this.winter?.tilesChanged(this.map, list)) this.winterNow();
    // Phase 3a: the height changed: the front fields (and the snow order with them) are worked out
    // again when a season next shows.
    if (this.fronts?.tilesChanged(this.map, list)) this.keysKind = -2;
  }

  private markWithNeighbours(i: number, fade = false): void {
    const w = this.map.width;
    const h = this.map.height;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
          this.markDirty(ny * w + nx);
          if (fade) this.fadeWanted[ny * w + nx] = 1;
        }
      }
    }
  }

  /** Redraws every tile at once (a new map, a jump in time): no tile fades. */
  markAll(): void {
    this.fades.clear();
    if (this.fadeWanted.length !== this.dirty.length) this.fadeWanted = new Uint8Array(this.dirty.length);
    else this.fadeWanted.fill(0);
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
    const w = this.map.width;
    const imgW = this.canvas.width;
    const data = this.img.data;
    const store = this.store;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    const grow = (i: number): void => {
      const x = i % w;
      const y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    // Phase 1b: grass moisture follows the rain (only while a season shows; painted ignores it, and held
    // until Phase 4, whose held look follows years-long rain),
    // and keys that show a new state are recoloured without redrawing.
    if (this.look && this.mat && this.moisture) {
      if (this.moistureDirty && this.rain && this.look.shown.some((s) => s !== LookState.Painted && (heldOn || s !== LookState.Held))) {
        this.moistureDirty = false;
        // Colours only (no shadow changes): recolour in place, then the whole image goes up.
        this.moisture.update(this.map, this.rain, this.mat, (i) => { store.commit(i % w, Math.floor(i / w)); this.wholeImage = true; });
      }
      if (this.anyKeysDirty) {
        resolveRanks(this.mat, this.look, this.px, this.keysDirty);
        this.keysDirty.fill(0);
        this.anyKeysDirty = false;
        this.wholeImage = true;
      }
      const L = this.look, wf = this.winter;
      if (this.coverFull) {
        // New orders: every pixel showing winter.
        this.coverFull = false;
        this.coverDirty = false;
        if (winterKeys(L, this.winterMask)) { resolveRanks(this.mat, L, this.px, this.winterMask); this.wholeImage = true; }
        this.drawnSnow = L.snowLine; this.drawnIce = L.iceLine;
      } else if (this.coverDirty && wf) {
        // A moved line: only the pixels it crossed (and the dusting and dithered edge beyond it; the
        // ice front's neighbours) can change. A whole-map recolour each step was ~20% of a late-game frame.
        this.coverDirty = false;
        if (L.snowLine !== this.drawnSnow) {
          const lo = Math.max(0, Math.floor(Math.min(this.drawnSnow, L.snowLine) - SNOW_EDGE - 1));
          const hi = Math.min(254, Math.ceil(Math.max(this.drawnSnow, L.snowLine) + SNOW_DUST + SNOW_EDGE + 1));
          resolveBand(this.mat, L, this.px, wf.coldList, wf.coldStart[lo]!, wf.coldStart[hi + 1]!, false);
        }
        if (L.iceLine !== this.drawnIce) {
          const lo = Math.max(0, Math.min(this.drawnIce, L.iceLine) - 1);
          const hi = Math.min(254, Math.max(this.drawnIce, L.iceLine));
          resolveBand(this.mat, L, this.px, wf.iceList, wf.iceStart[lo]!, wf.iceStart[hi + 1]!, true);
        }
        this.drawnSnow = L.snowLine; this.drawnIce = L.iceLine;
        this.wholeImage = true;
      }
    }
    if (this.dirtyList.length === 0 && this.fades.size === 0 && maxX < 0 && !this.wholeImage && this.rects.length === 0) return;
    const t0 = performance.now();

    // Speeds plan Phase 5: fading tiles move on a step (75%, 50%, 25% old, then new).
    for (const [i, f] of this.fades) {
      const step = Math.min(GR.fadeSteps, Math.floor(((t0 - f.start) / GR.fadeMs) * GR.fadeSteps));
      if (step === f.step) continue;
      f.step = step;
      store.dissolve(i % w, Math.floor(i / w), f.old, f.neu, step);
      if (step >= GR.fadeSteps) { this.fades.delete(i); store.release(f.old); store.release(f.neu); }
      grow(i);
    }

    let k = 0;
    for (; k < this.dirtyList.length; k++) {
      // Check the clock every 64 tiles; reading it per tile would cost more than it saves.
      if ((k & 63) === 63 && performance.now() - t0 > budgetMs) break;
      const i = this.dirtyList[k]!;
      const tx = i % w, ty = (i - tx) / w;
      let fade = this.fades.get(i);
      // A tile the simulation changed keeps its old pixels to dissolve from (if not fading already).
      const old = !fade && this.fadeWanted[i] === 1 && this.fades.size < GR.fadeMaxTiles ? store.read(tx, ty) : null;
      this.fadeWanted[i] = 0;
      drawTilePixels(this.map, i, data, imgW, this.time, this.extras);
      if (this.groundMarks) this.groundTile(i);   // Phase 7: its roles may have changed
      this.dirty[i] = 0;
      if (fade) {
        // Redrawn while fading (a neighbour changed, water moved): the newest look is the new one.
        store.read(tx, ty, fade.neu);
        store.dissolve(tx, ty, fade.old, fade.neu, fade.step);
      } else if (old) {
        const neu = store.read(tx, ty);
        if (!store.same(tx, ty, old, neu)) {
          fade = { old, neu, start: t0, step: 0 };
          this.fades.set(i, fade);
          store.dissolve(tx, ty, old, neu, 0);
        } else { store.commit(tx, ty); store.release(old); store.release(neu); }
      } else store.commit(tx, ty);
      grow(i);
    }
    this.dirtyList = k === this.dirtyList.length ? [] : this.dirtyList.slice(k);
    const whole = this.wholeImage;
    if (whole) {
      this.wholeImage = false;
      this.rects.length = 0;
      this.ctx.putImageData(this.img, 0, 0);
    } else if (this.rects.length > 0) this.uploadRects();
    if (maxX < 0) return;
    if (!whole) {
      this.ctx.putImageData(
        this.img, 0, 0,
        minX * TILE, minY * TILE, (maxX - minX + 1) * TILE, (maxY - minY + 1) * TILE,
      );
    }
    this.shadowCtx?.putImageData(
      this.shadowImg!, 0, 0,
      minX * TILE, minY * TILE, (maxX - minX + 1) * TILE, (maxY - minY + 1) * TILE,
    );
  }
}
