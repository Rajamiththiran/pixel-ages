// Fill bucket (§20.2): fills the 4-connected region of tiles that share the
// clicked tile's value in the current layer.

import type { MapData } from '../shared/types';
import { paintTile, ANIMAL_ERASER, type Tool } from './brushes';
import type { StrokeRecorder } from './undo';

/** Tile indices of the 4-connected region around `start` whose `valueOf` equals start's. Ascending order. */
export function regionOfSameValue(
  valueOf: (i: number) => number, width: number, height: number, start: number,
): number[] {
  const target = valueOf(start);
  const seen = new Uint8Array(width * height);
  const stack = [start];
  const out: number[] = [];
  seen[start] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    out.push(i);
    const x = i % width;
    const y = (i - x) / width;
    const tryN = (j: number): void => {
      if (!seen[j] && valueOf(j) === target) { seen[j] = 1; stack.push(j); }
    };
    if (y > 0) tryN(i - width);
    if (x > 0) tryN(i - 1);
    if (x < width - 1) tryN(i + 1);
    if (y < height - 1) tryN(i + width);
  }
  return out.sort((a, b) => a - b);
}

/** The value the fill bucket compares for a tool's layer. */
export function layerValueFn(map: MapData, tool: Tool): (i: number) => number {
  switch (tool.kind) {
    case 'ground': return (i) => map.ground[i]!;
    case 'plant': return (i) => map.plantType[i]!;
    case 'resource': return (i) => map.resourceType[i]!;
    case 'rain': return (i) => map.rain[i]!;
    case 'elevation': return (i) => map.elevation[i]!;
    case 'wall': return (i) => map.wall[i]!;
    case 'animal': {
      if (tool.species === ANIMAL_ERASER) {
        // Eraser works on "all animals": pack the four densities into one key.
        const [a, b, c, d] = map.animals;
        return (i) => ((a[i]! << 24) | (b[i]! << 16) | (c[i]! << 8) | d[i]!) >>> 0;
      }
      const arr = map.animals[tool.species]!;
      return (i) => arr[i]!;
    }
    case 'people': return () => 0;
  }
}

export function fillBucket(
  map: MapData, rec: StrokeRecorder, tool: Tool, start: number, strengthPct: number,
): void {
  if (tool.kind === 'people') return;
  const tiles = regionOfSameValue(layerValueFn(map, tool), map.width, map.height, start);
  for (const i of tiles) paintTile(map, rec, tool, i, strengthPct);
}
