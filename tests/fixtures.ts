// Test worlds. Step 2: a living world with no people. Scenarios A–D (§26) are added in step 3+.

import { createMap } from '../src/editor/mapState';
import { Ground, Plant, Resource, Species, WallType } from '../src/shared/ids';
import type { ClimateDrift, FounderPerson, MapData, RunSetup } from '../src/shared/types';

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

/** 2 men + 2 women with fixed ages (18–30), the given intelligence, cooperation 50, strength 50. */
export function fourPeople(intelligence = 100, cooperation = 50, strength = 50): FounderPerson[] {
  return [20, 27, 19, 24].map((age, k) => ({ sex: (k < 2 ? 0 : 1) as 0 | 1, age, intelligence, cooperation, strength }));
}

const disk = (cx: number, cy: number, r: number, fn: (i: number, x: number, y: number) => void): void => {
  for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) fn(at(x, y), x, y);
    }
  }
};

/** Scenario A — "Garden" (§26): the baseline world. */
export function scenarioA(seed = 1): RunSetup {
  const m = createMap();
  fillRect(m, 0, 0, W - 1, H - 1, (i, x, y) => {
    m.rain[i] = 60;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { m.wall[i] = WallType.Sea; return; }
    if (x < 80) {
      m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255;
      m.animals[Species.Prey][i] = 153; m.animals[Species.Predator][i] = 26;
    } else {
      m.plantType[i] = Plant.Grass; m.plantDensity[i] = 255;
      m.animals[Species.Prey][i] = 77; m.animals[Species.Herd][i] = 102; m.animals[Species.Riding][i] = 77;
    }
  });
  // Three 8×8 fruit-bush patches near the centre.
  for (const [x0, y0] of [[60, 30], [92, 50], [64, 58]] as const) {
    fillRect(m, x0, y0, x0 + 7, y0 + 7, (i) => { m.plantType[i] = Plant.FruitBushes; m.plantDensity[i] = 255; });
  }
  // A Water-ground river (not a wall), 2 tiles wide, at x = 80, with clay on both banks.
  fillRect(m, 80, 1, 81, H - 2, (i) => {
    m.ground[i] = Ground.Water; m.plantType[i] = Plant.None; m.plantDensity[i] = 0;
    for (let s = 0; s < 4; s++) m.animals[s]![i] = 0;
  });
  fillRect(m, 79, 1, 79, H - 2, (i) => { m.resourceType[i] = Resource.Clay; m.resourceAmount[i] = 255; });
  fillRect(m, 82, 1, 82, H - 2, (i) => { m.resourceType[i] = Resource.Clay; m.resourceAmount[i] = 255; });
  // Stone patches.
  for (const [cx, cy] of [[70, 40], [100, 60]] as const) {
    fillRect(m, cx - 2, cy - 2, cx + 2, cy + 2, (i) => { m.resourceType[i] = Resource.Stone; m.resourceAmount[i] = 255; });
  }
  // Mountain blocks with copper and iron.
  const mountain = (x0: number, y0: number, res: number): void => fillRect(m, x0, y0, x0 + 5, y0 + 5, (i) => {
    m.ground[i] = Ground.Mountain; m.plantType[i] = Plant.None; m.plantDensity[i] = 0;
    m.resourceType[i] = res; m.resourceAmount[i] = 255;
  });
  mountain(130, 20, Resource.Copper);
  mountain(30, 70, Resource.Iron);
  const run = runOf(m, seed, 'off');
  run.name = 'Scenario A — Garden';
  run.founders = [{ id: 1, name: 'Garden', colorIndex: 0, x: 76, y: 45, people: fourPeople(100) }];
  return run;
}

/** Scenario B — "Smart desert vs rich forest" (§26): the owner's experiment. */
export function scenarioB(seed = 48213): RunSetup {
  const m = createMap();
  fillRect(m, 0, 0, W - 1, H - 1, (i, x, y) => {
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { m.wall[i] = WallType.Sea; return; }
    if (x === 80 || x === 81) { m.wall[i] = WallType.River; return; }
    if (x < 80) {
      // Rich west: rain 65, forest over ~60%, prey, herd, riding, a few predators.
      m.rain[i] = 65;
      m.animals[Species.Prey][i] = 128;
      m.animals[Species.Herd][i] = 51;
      m.animals[Species.Riding][i] = 51;
      if (x < 48) { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255; m.animals[Species.Predator][i] = 13; }
      else { m.plantType[i] = Plant.Grass; m.plantDensity[i] = 230; }
    } else {
      m.ground[i] = Ground.Desert; m.rain[i] = 8;
    }
  });
  for (const [x0, y0] of [[52, 20], [60, 60], [55, 40]] as const) {
    fillRect(m, x0, y0, x0 + 6, y0 + 6, (i) => { m.plantType[i] = Plant.FruitBushes; m.plantDensity[i] = 255; });
  }
  fillRect(m, 30, 30, 34, 34, (i) => { m.resourceType[i] = Resource.Stone; m.resourceAmount[i] = 255; });
  fillRect(m, 60, 50, 63, 53, (i) => { m.resourceType[i] = Resource.Clay; m.resourceAmount[i] = 255; });
  // The oasis: a lake of radius 3, grassland with grass around it (radius 8, rain 35), goats.
  disk(120, 45, 8, (i) => {
    m.ground[i] = Ground.Grassland; m.rain[i] = 35;
    m.plantType[i] = Plant.Grass; m.plantDensity[i] = 200;
    m.animals[Species.Herd][i] = 77;
  });
  disk(120, 45, 3, (i) => {
    m.ground[i] = Ground.Water; m.plantType[i] = Plant.None; m.plantDensity[i] = 0;
    for (let s = 0; s < 4; s++) m.animals[s]![i] = 0;
  });
  fillRect(m, 108, 28, 112, 32, (i) => { m.resourceType[i] = Resource.Stone; m.resourceAmount[i] = 255; });
  fillRect(m, 142, 67, 148, 73, (i) => { m.ground[i] = Ground.Mountain; m.resourceType[i] = Resource.Copper; m.resourceAmount[i] = 255; });
  const run = runOf(m, seed, 'slow');
  run.name = 'Smart desert vs rich forest';
  run.founders = [
    { id: 1, name: 'Forest', colorIndex: 0, x: 40, y: 45, people: fourPeople(70) },
    { id: 2, name: 'Desert', colorIndex: 1, x: 120, y: 48, people: fourPeople(140) },
  ];
  return run;
}

/**
 * Scenario D — "Performance" (§26): three areas split by two River walls, all rich land,
 * 6 founder groups (2 per area), strong drift.
 */
export function scenarioD(seed = 1): RunSetup {
  const m = createMap();
  fillRect(m, 0, 0, W - 1, H - 1, (i, x, y) => {
    m.rain[i] = 65;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { m.wall[i] = WallType.Sea; return; }
    if (x === 53 || x === 54 || x === 106 || x === 107) { m.wall[i] = WallType.River; return; }
    // Forest everywhere but a grass strip (herds and horses) in the middle of each area.
    const local = x % 53;
    if (local < 30 || local >= 45) { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255; m.animals[Species.Predator][i] = 13; }
    else { m.plantType[i] = Plant.Grass; m.plantDensity[i] = 230; m.animals[Species.Herd][i] = 77; m.animals[Species.Riding][i] = 51; }
    m.animals[Species.Prey][i] = 128;
  });
  for (const x0 of [5, 58, 111]) {
    fillRect(m, x0 + 20, 40, x0 + 26, 46, (i) => { m.plantType[i] = Plant.FruitBushes; m.plantDensity[i] = 255; });
    fillRect(m, x0 + 10, 10, x0 + 14, 14, (i) => { m.resourceType[i] = Resource.Stone; m.resourceAmount[i] = 255; });
    fillRect(m, x0 + 30, 70, x0 + 34, 74, (i) => { m.resourceType[i] = Resource.Clay; m.resourceAmount[i] = 255; });
    fillRect(m, x0 + 38, 20, x0 + 43, 25, (i) => {
      m.ground[i] = Ground.Mountain; m.plantType[i] = Plant.None; m.plantDensity[i] = 0;
      m.resourceType[i] = x0 === 58 ? Resource.Iron : Resource.Copper; m.resourceAmount[i] = 255;
    });
    // A lake in each area, for Raft, Irrigation and Boat.
    disk(x0 + 12, 60, 3, (i) => { m.ground[i] = Ground.Water; m.plantType[i] = Plant.None; m.plantDensity[i] = 0; for (let s = 0; s < 4; s++) m.animals[s]![i] = 0; });
  }
  const run = runOf(m, seed, 'strong');
  run.name = 'Scenario D — Performance';
  const homes: Array<[number, number, string]> = [[15, 25, 'Red'], [20, 65, 'Blue'], [68, 25, 'Gold'], [73, 65, 'Violet'], [121, 25, 'Teal'], [126, 65, 'Amber']];
  run.founders = homes.map(([x, y, name], k) => ({ id: k + 1, name, colorIndex: k, x, y, people: fourPeople(100) }));
  return run;
}
