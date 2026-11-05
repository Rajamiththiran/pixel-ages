// Crown field for one tile (docs/diorama-plan/03-shadows.md). Shadows and forest-edge occlusion
// need to know, for each pixel of a tile, which crown covers it, whether a crown's shadow falls
// on it, and how far the nearest canopy is to its left or above. Instead of searching the tree
// cells around every pixel, the crowns that can reach the tile are laid out once into a small
// window (the tile plus a margin above and to the left), then read per pixel.

import { CONFIG } from '../config';
import type { MapData } from '../shared/types';
import { crownColour, crownIn, type Crown } from './terrainDetail';
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
let ox = 0, oy = 0;

const crown: Crown = { x: 0, y: 0, r: 0, tone: 0 };

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
    }
  }
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
