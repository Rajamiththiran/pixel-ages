// Areas (regions) over non-wall tiles (§8.3). Pure: the editor's live area preview
// imports this on the main thread, and the simulation will use it from step 2.

import { WallType } from '../../shared/ids';

export interface AreaResult {
  regionId: Int32Array;          // -1 on intact wall tiles
  count: number;                 // number of regions
  tileCount: Int32Array;         // per region
  firstTile: Int32Array;         // per region, lowest tile index (its top-left-most tile)
  centerX: Float64Array;         // per region, mean tile x
  centerY: Float64Array;
}

/**
 * Flood fill with 4-connectivity, so a diagonal line of wall tiles still blocks.
 * Regions are numbered in order of their lowest tile index, which keeps ids stable
 * for the same wall layout. `crossing` (optional) marks breached wall tiles as open.
 */
export function computeAreas(
  wall: Uint8Array, width: number, height: number, crossing?: Uint8Array,
): AreaResult {
  const n = width * height;
  const regionId = new Int32Array(n).fill(-1);
  const isOpen = (i: number): boolean =>
    wall[i] === WallType.None || (crossing !== undefined && crossing[i] === 1);

  const stack = new Int32Array(n);
  const counts: number[] = [];
  const firsts: number[] = [];
  const sumX: number[] = [];
  const sumY: number[] = [];
  let count = 0;

  for (let start = 0; start < n; start++) {
    if (regionId[start] !== -1 || !isOpen(start)) continue;
    const id = count++;
    let tiles = 0;
    let sx = 0;
    let sy = 0;
    let top = 0;
    stack[top++] = start;
    regionId[start] = id;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i % width;
      const y = (i - x) / width;
      tiles++;
      sx += x;
      sy += y;
      if (y > 0) visit(i - width);
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (y < height - 1) visit(i + width);
    }
    counts.push(tiles);
    firsts.push(start);
    sumX.push(sx);
    sumY.push(sy);

    function visit(j: number): void {
      if (regionId[j] === -1 && isOpen(j)) {
        regionId[j] = id;
        stack[top++] = j;
      }
    }
  }

  const tileCount = Int32Array.from(counts);
  const centerX = new Float64Array(count);
  const centerY = new Float64Array(count);
  for (let r = 0; r < count; r++) {
    centerX[r] = sumX[r]! / counts[r]!;
    centerY[r] = sumY[r]! / counts[r]!;
  }
  return { regionId, count, tileCount, firstTile: Int32Array.from(firsts), centerX, centerY };
}

/** Display name of a region ("Area 1" is the region with the lowest tile index). */
export const areaName = (regionId: number): string => `Area ${regionId + 1}`;

// ---------- wall segments ----------

export interface WallSegmentInfo {
  segmentId: Int32Array;         // -1 on non-wall tiles
  types: number[];               // WallType per segment
}

/** Connected wall tiles of the same type, 8-connectivity (§8.3). Numbered by lowest tile index. */
export function computeWallSegments(wall: Uint8Array, width: number, height: number): WallSegmentInfo {
  const n = width * height;
  const segmentId = new Int32Array(n).fill(-1);
  const types: number[] = [];
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    const type = wall[start]!;
    if (type === WallType.None || segmentId[start] !== -1) continue;
    const id = types.length;
    types.push(type);
    let top = 0;
    stack[top++] = start;
    segmentId[start] = id;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (segmentId[j] === -1 && wall[j] === type) {
            segmentId[j] = id;
            stack[top++] = j;
          }
        }
      }
    }
  }
  return { segmentId, types };
}

// ---------- union-find over regions ----------

/** Root of region r. Path halving keeps lookups short without recursion. */
export function findRoot(parent: Int32Array, r: number): number {
  while (parent[r] !== r) {
    parent[r] = parent[parent[r]!]!;
    r = parent[r]!;
  }
  return r;
}

/** Merges two regions. The lower root id becomes the root, so merges are order-independent. */
export function unionRegions(parent: Int32Array, a: number, b: number): number {
  const ra = findRoot(parent, a);
  const rb = findRoot(parent, b);
  if (ra === rb) return ra;
  const lo = Math.min(ra, rb);
  parent[Math.max(ra, rb)] = lo;
  return lo;
}

/** True if two tiles are in connected areas. Intact wall tiles (-1) are never connected. */
export function tilesConnected(regionId: Int32Array, parent: Int32Array, a: number, b: number): boolean {
  const ra = regionId[a]!;
  const rb = regionId[b]!;
  if (ra < 0 || rb < 0) return false;
  return findRoot(parent, ra) === findRoot(parent, rb);
}

export interface CrossingTarget {
  width: number;
  height: number;
  wall: Uint8Array;
  crossing: Uint8Array;
  regionId: Int32Array;
  regionParent: Int32Array;
}

/**
 * Opens a crossing (§8.3): wall tiles in the square of `radius` around (cx, cy) become
 * passable, and every region touching the new crossing tiles is merged. The crossing tiles
 * join the merged region. Returns the tiles that were opened, ascending.
 */
export function openCrossing(t: CrossingTarget, cx: number, cy: number, radius: number): number[] {
  const opened: number[] = [];
  for (let y = Math.max(0, cy - radius); y <= Math.min(t.height - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(t.width - 1, cx + radius); x++) {
      const i = y * t.width + x;
      if (t.wall[i] !== WallType.None && t.crossing[i] === 0) {
        t.crossing[i] = 1;
        opened.push(i);
      }
    }
  }
  // Merge every region that touches an open tile; repeat until stable so crossing tiles
  // next to other new crossing tiles also pick up a region.
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of opened) {
      const x = i % t.width;
      const y = (i - x) / t.width;
      let root = t.regionId[i]! >= 0 ? findRoot(t.regionParent, t.regionId[i]!) : -1;
      const visit = (j: number): void => {
        const r = t.regionId[j]!;
        if (r < 0) return;
        root = root < 0 ? findRoot(t.regionParent, r) : unionRegions(t.regionParent, root, r);
      };
      if (y > 0) visit(i - t.width);
      if (x > 0) visit(i - 1);
      if (x < t.width - 1) visit(i + 1);
      if (y < t.height - 1) visit(i + t.width);
      if (root >= 0 && t.regionId[i] !== root) {
        if (t.regionId[i]! < 0) changed = true;
        t.regionId[i] = root;
      }
    }
  }
  return opened;
}
