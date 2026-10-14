// Test worlds. Step 2: a living world with no people. Scenarios A–D (§26) are added in step 3+.

import { createMap } from '../src/editor/mapState';
import { Ground, Plant, Resource, Species, WallType } from '../src/shared/ids';
import type { ClimateDrift, MapData, RunSetup } from '../src/shared/types';

export const W = 160;
export const H = 90;
export const at = (x: number, y: number): number => y * W + x;

export function fillRect(
  _m: MapData, x0: number, y0: number, x1: number, y1: number, fn: (i: number, x: number, y: number) => void,
): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(at(x, y), x, y);
}

export function runOf(map: MapData, seed = 1, climateDrift: ClimateDrift = 'off'): RunSetup {
  return { version: 1, name: 'test', map, founders: [], events: [], seed, climateDrift };
}

/**
 * Two areas split by a river: a rich wet west (forest, fruit, prey, wolves, horses)
 * and a dry east (desert, an oasis lake with grass, goats). Sea wall around the edge.
 */
export function livingWorld(seed = 1, drift: ClimateDrift = 'slow'): RunSetup {
  const m = createMap();
  fillRect(m, 0, 0, W - 1, H - 1, (i, x, y) => {
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) m.wall[i] = WallType.Sea;
  });
  fillRect(m, 80, 1, 81, H - 2, (i) => { m.wall[i] = WallType.River; });
  // West: wet grassland, forest on the left half, fruit patches, prey and predators.
  fillRect(m, 1, 1, 79, H - 2, (i, x) => {
    m.rain[i] = 65;
    m.animals[Species.Prey][i] = x < 40 ? 150 : 80;
    m.animals[Species.Predator][i] = x < 40 ? 25 : 0;
    m.animals[Species.Riding][i] = x >= 40 ? 70 : 0;
    if (x < 40) { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255; }
    else { m.plantType[i] = Plant.Grass; m.plantDensity[i] = 200; }
  });
  fillRect(m, 50, 30, 57, 37, (i) => { m.plantType[i] = Plant.FruitBushes; m.plantDensity[i] = 255; });
  fillRect(m, 60, 40, 64, 44, (i) => { m.resourceType[i] = Resource.Stone; m.resourceAmount[i] = 255; });
  // East: desert at rain 8, an oasis lake with grass and goats around it.
  fillRect(m, 82, 1, W - 2, H - 2, (i) => { m.ground[i] = Ground.Desert; m.rain[i] = 8; });
  fillRect(m, 112, 37, 128, 53, (i, x, y) => {
    const d2 = (x - 120) * (x - 120) + (y - 45) * (y - 45);
    if (d2 <= 9) { m.ground[i] = Ground.Water; return; }
    if (d2 <= 64) {
      m.ground[i] = Ground.Grassland; m.rain[i] = 35;
      m.plantType[i] = Plant.Grass; m.plantDensity[i] = 180;
      m.animals[Species.Herd][i] = 80;
    }
  });
  fillRect(m, 140, 65, 146, 71, (i) => { m.ground[i] = Ground.Mountain; m.resourceType[i] = Resource.Copper; m.resourceAmount[i] = 200; });
  return runOf(m, seed, drift);
}
