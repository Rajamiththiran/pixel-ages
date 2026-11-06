// The material buffer (seasons plan Phase 1a, docs/pixel-ages-seasons-plan.md §6.1). Beside the
// terrain image, every pixel keeps what it is made of: its ramp step (the tag: group × 8 + step,
// ramps.ts) and its role (grass, crown, lake…). The colour is picked last, through lookup tables,
// as in the seasons mockup ("the buffer holds (material, step), effects move steps, and only then
// is a colour picked"). Phase 1b: one table per season state and grass moisture class, so a pixel
// swaps from one seasonal ramp to the next at the same step; nothing is laid over it. Drawing only.

import { CONFIG } from '../config';
import { bayer } from './dither';
import {
  Mat, rampsOn, seasonRampRgb, styleOff, tagCount, tagRgb, tagValid, type SeasonRampName,
} from './ramps';
import type { RGB } from './palette';

const TILE = CONFIG.map.tilePx;
const TILE_PX = TILE * TILE;
const G = CONFIG.render.gradual;
const SC = CONFIG.render.seasons;

/** Phase 1a switch. Needs the ramps (the classic look has no tags). */
export const matbufOn: boolean = rampsOn && SC.matbuf.on && !styleOff('matbuf');

/** Phase 1b switch: the seasons live in the materials, not in a tint on top. Needs the buffer. */
export const seasonRampsOn: boolean = matbufOn && SC.seasonRamps.on && !styleOff('seasonRamps');

/**
 * What a terrain pixel is, so a later phase can recolour it by season (a crown turns copper, a
 * lake ices, a field goes to stubble). The last thing drawn over a pixel sets it.
 */
export const Role = {
  None: 0,       // not drawn yet
  Grass: 1,      // grassland: open ground and grass
  Forest: 2,     // the floor between trees
  Crown: 3,      // a tree crown (own tile or overhanging)
  Fruit: 4,      // fruit bushes
  Farm: 5,       // farmland rows
  Desert: 6,     // desert sand (and grass on it)
  Mountain: 7,   // mountain ground
  Wall: 8,       // a mountain wall's body, or a pass through it
  Peak: 9,       // a mountain peak (ground or wall)
  Lake: 10,      // still water: lakes, ponds, streams
  River: 11,     // river water
  Sea: 12,       // sea water
  Bank: 13,      // mud at a river or stream where a water tile's corner is rounded off
  Beach: 14,     // sand round a lake or the sea
  Mark: 15,      // what people left on the land: paths, roads, canals, pits, ruins
  Fire: 16,      // a burning tile's flames and char
} as const;
export type Role = (typeof Role)[keyof typeof Role];
const ROLES = 17;

/** What the buffer resolves to: today's colours (setup, and the switch off), a season, or the held fast-forward look. */
export const LookState = { Painted: 0, Spring: 1, Summer: 2, Autumn: 3, Winter: 4, Held: 5 } as const;
export type LookState = (typeof LookState)[keyof typeof LookState];
const STATES = 6;

/** How wet the grass is (Phase 1b): picks the dry, normal or lush grass ramp of the season. */
export const Moist = { Dry: 0, Normal: 1, Lush: 2 } as const;
export type Moist = (typeof Moist)[keyof typeof Moist];
const CLASSES = 3;

/** One map's material buffer, one entry per terrain pixel (same layout as the image). */
export interface MatBuf {
  readonly w: number;    // px
  readonly h: number;
  readonly tag: Uint16Array;
  readonly role: Uint8Array;
  readonly moist: Uint8Array;   // Phase 1b: the pixel's grass moisture class (rain, not the tile's drawing)
}

/** The tag of a pixel not drawn yet: it resolves to transparent, as the image's undrawn pixels are. */
export const NO_TAG = 0xffff;

export function createMatBuf(w: number, h: number): MatBuf {
  return { w, h, tag: new Uint16Array(w * h).fill(NO_TAG), role: new Uint8Array(w * h), moist: new Uint8Array(w * h).fill(Moist.Normal) };
}

/** A tile's entries, copied out (for a tile dissolving from its old look). */
export interface MatTile { tag: Uint16Array; role: Uint8Array }

/** Packs a colour as the image's little-endian RGBA word, opaque (as blit.ts packs sprite pixels). */
const packRgba = (c: RGB): number => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;

// ---------- which ramp a pixel takes in each season ----------

/** A ramp: a system ramp (its Mat) or a seasonal one (its name in SEASON_HEX). */
type Ramp = Mat | SeasonRampName;

// Per season (spring, summer, autumn, winter) and moisture class (dry, normal, lush).
const GRASS: readonly (readonly Ramp[])[] = [
  ['grassSpDry', 'grassSpNormal', 'grassSpLush'],
  ['grassSuDry', Mat.Grass, 'grassSuLush'],
  ['grassAuDry', 'grassAuNormal', 'grassAuLush'],
  ['grassWiDry', 'grassWiNormal', 'grassWiLush'],
];
const EVERGREEN: readonly Ramp[] = ['evergreenSp', Mat.Forest, 'evergreenAu', 'evergreenWi'];
const FRUIT: readonly (Ramp | null)[] = ['fruitSp', 'fruitSu', 'fruitAu', null];   // winter: dormant, the grass's ramp
const SAND: readonly Ramp[] = ['sandSp', Mat.Sand, 'sandAu', 'sandWi'];
const STONE: readonly Ramp[] = [Mat.Stone, Mat.Stone, Mat.Stone, 'stoneWi'];
const CROP: readonly Ramp[] = ['cropSprout', 'cropGreen', Mat.Crop, 'cropStubble'];   // one stage per season until Phase 2b
const RIVER: readonly Ramp[] = ['waterSpring', Mat.Water, Mat.Water, 'waterWinter'];  // spring meltwater
const STILL: readonly Ramp[] = [Mat.Water, Mat.Water, Mat.Water, 'waterWinter'];

/**
 * The ramp a pixel of group `g` with `role` takes in `season` (0 spring … 3 winter) and moisture
 * class `cls`, or null to keep its own colour. Things lying on the ground (ore, salt, ash, marks)
 * keep their ramp's season; accents (ink, flowers, flames, fruit) never change.
 */
export function seasonalRamp(g: number, role: number, season: number, cls: number): Ramp | null {
  switch (g) {
    case Mat.Grass:
      return role === Role.Fruit && FRUIT[season] !== null ? FRUIT[season]! : GRASS[season]![cls]!;
    case Mat.Forest: return EVERGREEN[season]!;   // Phase 2a splits crowns into evergreen and deciduous
    case Mat.Sand: return SAND[season]!;
    case Mat.Stone: return STONE[season]!;
    case Mat.Crop: return CROP[season]!;
    case Mat.Water: return role === Role.River ? RIVER[season]! : STILL[season]!;
    default: return null;
  }
}

/** The held fast-forward look (seasons brief D): summer, normal moisture, gold fields. */
function heldRamp(g: number, role: number): Ramp | null {
  if (g === Mat.Crop) return null;
  return seasonalRamp(g, role, 1, Moist.Normal);
}

function rampColour(r: Ramp, step: number): RGB {
  if (typeof r === 'number') return tagRgb(r * 8 + step);
  const c = seasonRampRgb(r);
  return c[Math.max(0, Math.min(c.length - 1, step))]!;
}

/** The colour of (role, tag) in a state and moisture class. */
export function lookColour(state: LookState, cls: number, role: number, tag: number): RGB {
  const g = tag >> 3, step = tag & 7;
  if (state === LookState.Painted) return tagRgb(tag);
  const r = state === LookState.Held ? heldRamp(g, role) : seasonalRamp(g, role, state - 1, cls);
  // The crop furrow (step 0) is soil all year; Phase 2b gives the fields their stages.
  if (r === null || (g === Mat.Crop && step === 0)) return tagRgb(tag);
  return rampColour(r, step);
}

let tables: Uint32Array[] | null = null;
let span = 0;

/** The lookup tables, one per state × moisture class, indexed by role × tags + tag. Built once. */
function lookTables(): Uint32Array[] {
  if (tables) return tables;
  span = tagCount();
  tables = [];
  for (let s = 0; s < STATES; s++) {
    for (let c = 0; c < CLASSES; c++) {
      const t = new Uint32Array(ROLES * span);
      for (let role = 0; role < ROLES; role++) {
        for (let tag = 0; tag < span; tag++) if (tagValid(tag)) t[role * span + tag] = packRgba(lookColour(s as LookState, c, role, tag));
      }
      tables.push(t);
    }
  }
  return tables;
}

// ---------- the look: which state each Bayer rank shows ----------

// Bayer rank (0–15) of each 4×4 cell, the same matrix as dither.ts.
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const RANKS = 16;

/**
 * What the image shows now: the state of each of the 16 Bayer ranks. A season arrives as a
 * dissolve, rank by rank, so each pixel changes once (Phase 3 replaces the ranks with the front).
 */
export interface Look {
  readonly tables: Uint32Array[];
  readonly span: number;
  readonly shown: Int8Array;   // state per rank
}

export function createLook(state: LookState = LookState.Painted): Look {
  const t = lookTables();
  return { tables: t, span, shown: new Int8Array(RANKS).fill(state) };
}

/** The colour word of pixel `p` at (x, y). */
function colourAt(buf: MatBuf, look: Look, tag: number, role: number, p: number, x: number, y: number): number {
  if (tag === NO_TAG) return 0;
  return look.tables[look.shown[B4[(y & 3) * 4 + (x & 3)]!]! * CLASSES + buf.moist[p]!]![role * look.span + tag]!;
}

/** Writes tile (tx, ty)'s colours from the buffer into the image (`px` = its pixels as words). */
export function resolveTile(buf: MatBuf, look: Look, px: Uint32Array, tx: number, ty: number): void {
  for (let y = 0; y < TILE; y++) {
    const py = ty * TILE + y;
    const o = py * buf.w + tx * TILE;
    for (let x = 0; x < TILE; x++) px[o + x] = colourAt(buf, look, buf.tag[o + x]!, buf.role[o + x]!, o + x, tx * TILE + x, py);
  }
}

/** Writes the colours of every pixel of Bayer rank `rank` (one pixel in 16, on a 4 × 4 lattice). */
export function resolveRank(buf: MatBuf, look: Look, px: Uint32Array, rank: number): void {
  const k = B4.indexOf(rank), ox = k & 3, oy = k >> 2;
  // Every pixel of a rank shows the same state: pick its three moisture tables once.
  const s = look.shown[rank]! * CLASSES;
  const t = [look.tables[s]!, look.tables[s + 1]!, look.tables[s + 2]!];
  const { tag, role, moist } = buf, span = look.span;
  for (let y = oy; y < buf.h; y += 4) {
    for (let p = y * buf.w + ox, end = (y + 1) * buf.w; p < end; p += 4) {
      const g = tag[p]!;
      px[p] = g === NO_TAG ? 0 : t[moist[p]!]![role[p]! * span + g]!;
    }
  }
}

/** Copies tile (tx, ty)'s entries out of the buffer. */
export function readMatTile(buf: MatBuf, tx: number, ty: number, out: MatTile = { tag: new Uint16Array(TILE_PX), role: new Uint8Array(TILE_PX) }): MatTile {
  for (let y = 0; y < TILE; y++) {
    const o = (ty * TILE + y) * buf.w + tx * TILE;
    out.tag.set(buf.tag.subarray(o, o + TILE), y * TILE);
    out.role.set(buf.role.subarray(o, o + TILE), y * TILE);
  }
  return out;
}

/** Would two snapshots of tile (tx, ty) look the same now? (A tile only fades when it would look different.) */
export function sameMatLook(buf: MatBuf, look: Look, tx: number, ty: number, a: MatTile, b: MatTile): boolean {
  for (let y = 0; y < TILE; y++) {
    const py = ty * TILE + y;
    for (let x = 0; x < TILE; x++) {
      const k = y * TILE + x, p = py * buf.w + tx * TILE + x;
      if (colourAt(buf, look, a.tag[k]!, a.role[k]!, p, tx * TILE + x, py) !== colourAt(buf, look, b.tag[k]!, b.role[k]!, p, tx * TILE + x, py)) return false;
    }
  }
  return true;
}

/**
 * Writes tile (tx, ty) at dissolve `step` of `fadeSteps` into the buffer: the same Bayer order as
 * terrain.ts dissolveTile (speeds plan Phase 5), so a pixel takes its new entry once and the look
 * through the painted table is what dissolveTile shows.
 */
export function dissolveMat(buf: MatBuf, tx: number, ty: number, old: MatTile, neu: MatTile, step: number): void {
  const share = step / G.fadeSteps;
  for (let y = 0; y < TILE; y++) {
    const py = ty * TILE + y;
    const o = py * buf.w + tx * TILE;
    for (let x = 0; x < TILE; x++) {
      const src = bayer(tx * TILE + x, py) < share ? neu : old;
      buf.tag[o + x] = src.tag[y * TILE + x]!;
      buf.role[o + x] = src.role[y * TILE + x]!;
    }
  }
}
