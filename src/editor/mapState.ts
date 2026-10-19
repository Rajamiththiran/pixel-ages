// MapData create/clone and layer access for the editor.

import { CONFIG } from '../config';
import type { MapData } from '../shared/types';

/** New map default (§8.2): all Grassland, no plants, no resources, rain 50, no animals, no walls. */
export function createMap(width: number = CONFIG.map.width, height: number = CONFIG.map.height): MapData {
  const n = width * height;
  return {
    version: 3,
    width,
    height,
    ground: new Uint8Array(n).fill(CONFIG.editor.newMap.ground),
    plantType: new Uint8Array(n),
    plantDensity: new Uint8Array(n),
    resourceType: new Uint8Array(n),
    resourceAmount: new Uint8Array(n),
    rain: new Uint8Array(n).fill(CONFIG.editor.newMap.rain),
    animals: [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)],
    wall: new Uint8Array(n),
    elevation: new Uint8Array(n),
  };
}

export function cloneMap(m: MapData): MapData {
  return {
    version: 3,
    width: m.width,
    height: m.height,
    ground: m.ground.slice(),
    plantType: m.plantType.slice(),
    plantDensity: m.plantDensity.slice(),
    resourceType: m.resourceType.slice(),
    resourceAmount: m.resourceAmount.slice(),
    rain: m.rain.slice(),
    animals: [m.animals[0].slice(), m.animals[1].slice(), m.animals[2].slice(), m.animals[3].slice()],
    wall: m.wall.slice(),
    elevation: m.elevation.slice(),
  };
}

/** Copies every layer of `src` into `dst` in place (same size), so references stay valid. */
export function copyMapInto(dst: MapData, src: MapData): void {
  dst.ground.set(src.ground);
  dst.plantType.set(src.plantType);
  dst.plantDensity.set(src.plantDensity);
  dst.resourceType.set(src.resourceType);
  dst.resourceAmount.set(src.resourceAmount);
  dst.rain.set(src.rain);
  for (let s = 0; s < 4; s++) dst.animals[s]!.set(src.animals[s]!);
  dst.wall.set(src.wall);
  dst.elevation.set(src.elevation);
}

// Layer ids used by undo records. Animals are 6..9 (6 + Species id).
export const Layer = {
  Ground: 0, PlantType: 1, PlantDensity: 2, ResourceType: 3, ResourceAmount: 4,
  Rain: 5, Animal0: 6, Animal1: 7, Animal2: 8, Animal3: 9, Wall: 10, Elevation: 11,
} as const;
export type Layer = (typeof Layer)[keyof typeof Layer];

export function layerArray(m: MapData, layer: number): Uint8Array {
  switch (layer) {
    case Layer.Ground: return m.ground;
    case Layer.PlantType: return m.plantType;
    case Layer.PlantDensity: return m.plantDensity;
    case Layer.ResourceType: return m.resourceType;
    case Layer.ResourceAmount: return m.resourceAmount;
    case Layer.Rain: return m.rain;
    case Layer.Wall: return m.wall;
    case Layer.Elevation: return m.elevation;
    default: {
      const a = m.animals[layer - Layer.Animal0];
      if (!a) throw new Error(`Unknown layer ${layer}`);
      return a;
    }
  }
}
