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
