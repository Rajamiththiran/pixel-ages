// Test worlds: the §26 scenarios (src/presets/scenarios.ts) plus a living world with no people.

import { Ground, Plant, Resource, Species, WallType } from '../src/shared/ids';
import type { ClimateDrift, RunSetup } from '../src/shared/types';
import { HazardMark, Look, Mark } from '../src/shared/protocol';
import { createMap } from '../src/editor/mapState';
import { H, W, fillRect, runOf } from '../src/presets/scenarios';

export * from '../src/presets/scenarios';

/** A small map with every ground, plant, wall, ore, hill, mark, hazard and look (render tests). */
export function allTilesMap() {
  const MW = 40, MH = 24, m = createMap(MW, MH);
  const n = MW * MH;
  const marks = new Uint8Array(n), hazards = new Uint8Array(n), look = new Uint8Array(n);
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      const band = Math.floor(x / 5);
      m.ground[i] = [Ground.Grassland, Ground.Desert, Ground.Grassland, Ground.Water, Ground.Mountain, Ground.Grassland, Ground.Grassland, Ground.Desert][band]!;
      if (band === 0) { m.plantType[i] = Plant.Forest; m.plantDensity[i] = (y * 11) % 256; }
      if (band === 2) { m.plantType[i] = [Plant.Grass, Plant.FruitBushes, Plant.Farmland][y % 3]!; m.plantDensity[i] = 40 + y * 9; }
      if (band === 5) { m.plantType[i] = Plant.Farmland; marks[i] = y % 2 ? Mark.Terrace : Mark.Road; look[i] = (y % 4) << Look.wornShift | ((y >> 2) % 4) << Look.saltShift; }
      if (band === 6) { marks[i] = [Mark.Path, Mark.Ash, Mark.Ruin, Mark.Quarry, Mark.Canal][y % 5]!; if (y % 7 === 0) hazards[i] = HazardMark.Fire; if (y % 5 === 1) look[i] = 2 << Look.ashShift | (y % 3 ? Look.Silt : 0); }
      if (band === 7 && y < 8) m.wall[i] = [WallType.River, WallType.Mountain, WallType.Sea][x % 3]!;
      if (x % 6 === 1 && y % 4 === 1) { m.resourceType[i] = 1 + ((x + y) % 6) as Resource; m.resourceAmount[i] = 200; }
      m.elevation[i] = Math.max(0, Math.min(9, Math.round(9 - Math.hypot(x - 20, y - 12) / 1.5)));
    }
  }
  return { m, marks, hazards, look, base: createMap(MW, MH) };
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

