// Crown field for one tile (docs/diorama-plan/03-shadows.md). Shadows and forest-edge occlusion
// need to know, for each pixel of a tile, which crown covers it, whether a crown's shadow falls
// on it, and how far the nearest canopy is to its left or above. Instead of searching the tree
// cells around every pixel, the crowns that can reach the tile are laid out once into a small
// window (the tile plus a margin above and to the left), then read per pixel.

import { CONFIG } from '../config';
import { hash01 } from '../shared/hash';
import type { MapData } from '../shared/types';
import { crownColour, crownIn, type Crown } from './terrainDetail';
import { treesOn } from './materials';
import type { RGB } from './palette';

const TILE = CONFIG.map.tilePx;
const D = CONFIG.render.detail;
const DS = CONFIG.render.diorama.shadows;
const M = CONFIG.render.diorama.forestOcclusion.reachPx;
const S = TILE + M;                    // window side: the tile, and M px above and to the left

const bestY = new Int16Array(S * S);   // the covering crown's centre (front-most rule), −1 none
const bestX = new Int16Array(S * S);
const dxs = new Int8Array(S * S);      // pixel − crown centre
const dys = new Int8Array(S * S);
const radius = new Float32Array(S * S);
const tone = new Float32Array(S * S);
const shade = new Uint8Array(S * S);   // a crown's cast shadow
const branch = new Uint8Array(S * S);  // seasons Phase 2a: a bare crown's wood step here (1–3), 0 none
let ox = 0, oy = 0;

const crown: Crown = { x: 0, y: 0, r: 0, tone: 0 };
const TR = CONFIG.render.seasons.trees;
// The crowns laid out in the window (centre and radius), for their branches.
const MAX_CROWNS = 256;
const cxs = new Int16Array(MAX_CROWNS), cys = new Int16Array(MAX_CROWNS), crs = new Float32Array(MAX_CROWNS);
let crownCount = 0;

function stampShadow(x: number, y: number): void {
  const lx = x - ox, ly = y - oy;
  if (lx >= 0 && ly >= 0 && lx < S && ly < S) shade[ly * S + lx] = 1;
}

/**
 * Lays out every crown that can touch tile (tx, ty) or its window: crown pixels (front-most crown
 * wins, as forestCrown), and each crown's shadow, a disc of its radius thrown (3 + r) × 0.45 px
 * down-right, joined to the tree's foot by a line (the mockup's tree shadow).
 */
export function buildCrowns(map: MapData, tx: number, ty: number): void {
  ox = tx * TILE - M;
  oy = ty * TILE - M;
  bestY.fill(-1);
  shade.fill(0);
  crownCount = 0;
  const c = D.treeCell;
  const rMax = Math.ceil(D.treeRadiusMax);
  const lift = DS.treeLiftPx + D.treeRadiusMax;
  const reach = rMax + Math.round(lift * DS.perHeightPx) + 2;       // how far up-left a crown's shadow can come from
  for (let cy = Math.floor((oy - reach) / c); cy <= Math.floor((oy + S + rMax) / c); cy++) {
    for (let cx = Math.floor((ox - reach) / c); cx <= Math.floor((ox + S + rMax) / c); cx++) {
      if (!crownIn(map, cx, cy, crown)) continue;
      const { x, y, r } = crown;
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const lx = x + dx - ox, ly = y + dy - oy;
          if (lx < 0 || ly < 0 || lx >= S || ly >= S) continue;
          const k = ly * S + lx;
          const by = bestY[k]!;
          if (by >= 0 && !(y > by || (y === by && x > bestX[k]!))) continue;
          bestY[k] = y; bestX[k] = x; dxs[k] = dx; dys[k] = dy; radius[k] = r; tone[k] = crown.tone;
        }
      }
      const l = DS.treeLiftPx + r;
      const sx = x + Math.round(l * DS.perHeightPx), sy = y + Math.round(l * DS.perHeightPx) + 1;
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) if (dx * dx + dy * dy <= r * r) stampShadow(sx + dx, sy + dy);
      }
      for (let t = 0; t <= Math.floor(l); t++) stampShadow(Math.round(x + t * DS.perHeightPx), Math.round(y + r + t * DS.perHeightPx));
      if (crownCount < MAX_CROWNS) { cxs[crownCount] = x; cys[crownCount] = y; crs[crownCount] = r; crownCount++; }
    }
  }
  layBranches();
}

/**
 * Seasons Phase 2a: where each crown's bare winter branches are (the mockup's bare tree, scaled to
 * the game's small crowns): a trunk from the centre down, then branches fanning upward from the
 * centre, darker on the right, lighter at the tips. Only on the crown's own pixels (the front-most
 * crown keeps a pixel), so a bare tree never draws over its neighbours.
 */
function layBranches(): void {
  branch.fill(0);
  if (!treesOn) return;
  for (let n = 0; n < crownCount; n++) {
    const x = cxs[n]!, y = cys[n]!, r = crs[n]!;
    for (let t = 0; t <= Math.floor(r); t++) {
      const k = own(x, y, x, y + t);
      if (k >= 0) branch[k] = 1;
    }
    const b = branchesOf(x, y, r);
    for (let q = 0; q < b.length; q += 3) {
      const k = own(x, y, x + b[q]!, y + b[q + 1]!);
      if (k >= 0) branch[k] = b[q + 2]!;
    }
  }
}

// A crown is laid out again for every tile its window reaches: its branches are worked out once.
const branchCache = new Map<number, Int8Array>();

/** A crown's branch pixels: (dx, dy, wood step) triples, in drawing order. */
function branchesOf(x: number, y: number, r: number): Int8Array {
  const key = y * 65536 + x;
  let b = branchCache.get(key);
  if (b) return b;
  const out: number[] = [];
  const len = r + TR.branchReachPx;
  for (let j = 0; j < TR.branches; j++) {
    // Render only: Math.cos and Math.sin are fine here (rule 4 is for the simulation).
    const ang = -Math.PI / 2 + (j - (TR.branches - 1) / 2) * TR.branchSpreadRad + (hash01(x, y, TR.salt + j) - 0.5) * TR.branchJitterRad;
    for (let s = 1; s <= len; s += TR.branchStepPx) {
      out.push(Math.round(Math.cos(ang) * s), Math.round(Math.sin(ang) * s), s > len - 1 ? 3 : Math.cos(ang) < 0 ? 2 : 1);
    }
  }
  b = Int8Array.from(out);
  branchCache.set(key, b);
  return b;
}

/** The window index of (bx, by) if crown (x, y) is the one drawn there, else −1. */
function own(x: number, y: number, bx: number, by: number): number {
  const k = index(bx, by);
  return k >= 0 && bestY[k] === y && bestX[k] === x ? k : -1;
}

/** The crown over a pixel of the built tile (seasons Phase 2a). */
export interface CrownPixel { x: number; y: number; r: number; dx: number; dy: number; branch: number }

/** Fills `out` with the crown covering (px, py); false where no crown covers it. */
export function crownPixelAt(px: number, py: number, out: CrownPixel): boolean {
  const k = index(px, py);
  if (k < 0 || bestY[k]! < 0) return false;
  out.x = bestX[k]!; out.y = bestY[k]!; out.r = radius[k]!; out.dx = dxs[k]!; out.dy = dys[k]!; out.branch = branch[k]!;
  return true;
}

const index = (px: number, py: number): number => {
  const lx = px - ox, ly = py - oy;
  return lx >= 0 && ly >= 0 && lx < S && ly < S ? ly * S + lx : -1;
};

/** The crown colour at a pixel of the built tile; false where no crown covers it. */
export function crownColourAt(px: number, py: number, out: RGB): boolean {
  const k = index(px, py);
  if (k < 0 || bestY[k]! < 0) return false;
  crownColour(dxs[k]!, dys[k]!, radius[k]!, tone[k]!, out);
  return true;
}

/** Does a crown's shadow fall here? (Crown pixels themselves are never shaded: crowns stand above.) */
export function inTreeShadow(px: number, py: number): boolean {
  const k = index(px, py);
  return k >= 0 && shade[k] === 1 && bestY[k]! < 0;
}

/** Distance (1…reach) to a crown directly left of or above the pixel, 0 when none is that close. */
export function canopyDistance(px: number, py: number): number {
  for (let d = 1; d <= M; d++) {
    const a = index(px - d, py), b = index(px, py - d);
    if ((a >= 0 && bestY[a]! >= 0) || (b >= 0 && bestY[b]! >= 0)) return d;
  }
  return 0;
}
