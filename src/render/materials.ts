// The material buffer (seasons plan Phase 1a, docs/pixel-ages-seasons-plan.md §6.1). Beside the
// terrain image, every pixel keeps what it is made of: its ramp step (the tag: group × 8 + step,
// ramps.ts) and its role (grass, crown, lake…). The colour is picked last, through a lookup
// table, as in the seasons mockup ("the buffer holds (material, step), effects move steps, and
// only then is a colour picked"). In Phase 1a the table is today's colours, so the image is
// unchanged; later phases swap tables per season. Drawing only.

import { CONFIG } from '../config';
import { bayer } from './dither';
import { rampsOn, styleOff, tagCount, tagRgb, tagValid } from './ramps';

const TILE = CONFIG.map.tilePx;
const TILE_PX = TILE * TILE;
const G = CONFIG.render.gradual;

/** Phase 1a switch. Needs the ramps (the classic look has no tags). */
export const matbufOn: boolean = rampsOn && CONFIG.render.seasons.matbuf.on && !styleOff('matbuf');

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

/** One map's material buffer, one entry per terrain pixel (same layout as the image). */
export interface MatBuf {
  readonly w: number;    // px
  readonly h: number;
  readonly tag: Uint16Array;
  readonly role: Uint8Array;
}

/** The tag of a pixel not drawn yet: it resolves to transparent, as the image's undrawn pixels are. */
export const NO_TAG = 0xffff;

export function createMatBuf(w: number, h: number): MatBuf {
  return { w, h, tag: new Uint16Array(w * h).fill(NO_TAG), role: new Uint8Array(w * h) };
}

/** A tile's entries, copied out (for a tile dissolving from its old look). */
export interface MatTile { tag: Uint16Array; role: Uint8Array }

/** Packs a colour as the image's little-endian RGBA word, opaque (as blit.ts packs sprite pixels). */
const packRgba = (r: number, g: number, b: number): number => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;

let identity: Uint32Array | null = null;

/**
 * The lookup table of Phase 1a: every tag to its own colour, so a resolved pixel is exactly the
 * colour drawTilePixels wrote. Built once (all ramps and accents are known after palette.ts loads).
 * It spans every 16-bit tag, so NO_TAG and unused tags read as transparent (0).
 */
export function identityLut(): Uint32Array {
  if (identity) return identity;
  identity = new Uint32Array(NO_TAG + 1);
  for (let t = 0; t < tagCount(); t++) {
    if (!tagValid(t)) continue;
    const c = tagRgb(t);
    identity[t] = packRgba(c[0], c[1], c[2]);
  }
  return identity;
}

/** Writes tile (tx, ty)'s colours from the buffer through `lut` into the image (`px` = its pixels as words). */
export function resolveTile(buf: MatBuf, lut: Uint32Array, px: Uint32Array, tx: number, ty: number): void {
  for (let y = 0; y < TILE; y++) {
    const o = (ty * TILE + y) * buf.w + tx * TILE;
    for (let x = 0; x < TILE; x++) px[o + x] = lut[buf.tag[o + x]!]!;
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

/** Do two tile snapshots look the same through `lut`? (A tile only fades when it would look different.) */
export function sameMatLook(lut: Uint32Array, a: MatTile, b: MatTile): boolean {
  for (let k = 0; k < TILE_PX; k++) if (lut[a.tag[k]!] !== lut[b.tag[k]!]) return false;
  return true;
}

/**
 * Writes tile (tx, ty) at dissolve `step` of `fadeSteps` into the buffer: the same Bayer order as
 * terrain.ts dissolveTile (speeds plan Phase 5), so a pixel takes its new entry once and the look
 * through the identity table is what dissolveTile shows.
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
