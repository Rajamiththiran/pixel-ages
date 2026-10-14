// Brushes (§8.2, §20.2). Pure functions over MapData; every change goes through
// a StrokeRecorder so it can be undone.

import { CONFIG } from '../config';
import { Ground, Plant, Resource, WallType } from '../shared/ids';
import type { MapData } from '../shared/types';
import { dist2, forEachInDisk, lineTiles } from '../shared/grid';
import { Layer } from './mapState';
import type { StrokeRecorder } from './undo';

export type Tool =
  | { kind: 'ground'; value: Ground }
  | { kind: 'plant'; value: Plant }          // Plant.None = eraser
  | { kind: 'resource'; value: Resource }    // Resource.None = eraser
  | { kind: 'rain' }
  | { kind: 'animal'; species: number }      // 0–3, or -1 = eraser (all species)
  | { kind: 'wall'; value: WallType }        // WallType.None = eraser
  | { kind: 'people' };

export const ANIMAL_ERASER = -1;

/** 0–100 % strength → 0–255 density/amount. */
export const strengthToByte = (strengthPct: number): number => Math.round((strengthPct / 100) * 255);

/**
 * Paints one tile with `tool`. `soft` is the rain brush's outer-ring blend (0 = none).
 * Painting rules (§8.2): Water clears plants, resources and animals; walls clear plants
 * and resources; plants, resources and animals can't go on Water.
 */
export function paintTile(
  map: MapData, rec: StrokeRecorder, tool: Tool, i: number, strengthPct: number, soft = 0,
): void {
  switch (tool.kind) {
    case 'ground':
      rec.set(Layer.Ground, i, tool.value);
      if (tool.value === Ground.Water) {
        clearPlant(rec, i);
        clearResource(rec, i);
        for (let s = 0; s < 4; s++) rec.set(Layer.Animal0 + s, i, 0);
      }
      return;

    case 'plant': {
      if (tool.value === Plant.None) { clearPlant(rec, i); return; }
      // Walls clear plants, so painting plants onto a wall would be undone by the wall rule.
      if (map.ground[i] === Ground.Water || map.wall[i] !== WallType.None) return;
      const d = strengthToByte(strengthPct);
      if (d === 0) { clearPlant(rec, i); return; }
      rec.set(Layer.PlantType, i, tool.value);
      rec.set(Layer.PlantDensity, i, d);
      return;
    }

    case 'resource': {
      if (tool.value === Resource.None) { clearResource(rec, i); return; }
      if (map.ground[i] === Ground.Water || map.wall[i] !== WallType.None) return;
      const a = strengthToByte(strengthPct);
      if (a === 0) { clearResource(rec, i); return; }
      rec.set(Layer.ResourceType, i, tool.value);
      rec.set(Layer.ResourceAmount, i, a);
      return;
    }

    case 'rain': {
      const target = Math.round(strengthPct);
      if (soft <= 0) { rec.set(Layer.Rain, i, target); return; }
      // Blend from the value before the stroke so dragging doesn't keep compounding the blend.
      const orig = rec.original(Layer.Rain, i);
      rec.set(Layer.Rain, i, Math.round(orig + (target - orig) * soft));
      return;
    }

    case 'animal': {
      if (tool.species === ANIMAL_ERASER) {
        for (let s = 0; s < 4; s++) rec.set(Layer.Animal0 + s, i, 0);
        return;
      }
      if (map.ground[i] === Ground.Water) return;
      rec.set(Layer.Animal0 + tool.species, i, strengthToByte(strengthPct));
      return;
    }

    case 'wall':
      rec.set(Layer.Wall, i, tool.value);
      if (tool.value !== WallType.None) {
        clearPlant(rec, i);
        clearResource(rec, i);
      }
      return;

    case 'people':
      return;
  }
}

function clearPlant(rec: StrokeRecorder, i: number): void {
  rec.set(Layer.PlantType, i, Plant.None);
  rec.set(Layer.PlantDensity, i, 0);
}

function clearResource(rec: StrokeRecorder, i: number): void {
  rec.set(Layer.ResourceType, i, Resource.None);
  rec.set(Layer.ResourceAmount, i, 0);
}

/**
 * Stamps a filled circle of diameter `size` tiles centred on (cx, cy).
 * `fullTiles` collects tiles painted at full value in this stroke, so the rain
 * brush's soft ring never lowers a tile the brush centre already covered.
 */
export function stamp(
  map: MapData, rec: StrokeRecorder, tool: Tool, cx: number, cy: number,
  size: number, strengthPct: number, fullTiles: Set<number>,
): void {
  const r = size / 2;
  const r2 = r * r;
  const inner = r - 1;
  const inner2 = inner > 0 ? inner * inner : 0.25;
  forEachInDisk(cx, cy, r2, map.width, map.height, (i, x, y) => {
    if (tool.kind === 'rain' && dist2(cx, cy, x, y) > inner2) {
      if (!fullTiles.has(i)) paintTile(map, rec, tool, i, strengthPct, CONFIG.editor.rainSoftEdgeBlend);
      return;
    }
    fullTiles.add(i);
    paintTile(map, rec, tool, i, strengthPct);
  });
}

/** Stamps along the line from the previous mouse tile to the current one, so fast strokes have no gaps. */
export function strokeSegment(
  map: MapData, rec: StrokeRecorder, tool: Tool,
  x0: number, y0: number, x1: number, y1: number,
  size: number, strengthPct: number, fullTiles: Set<number>,
): void {
  const pts = lineTiles(x0, y0, x1, y1);
  // The start point was already stamped by the previous segment.
  for (let k = pts.length > 1 ? 1 : 0; k < pts.length; k++) {
    const p = pts[k]!;
    stamp(map, rec, tool, p[0], p[1], size, strengthPct, fullTiles);
  }
}
