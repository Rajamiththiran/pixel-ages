// The test scenarios of §26, built in code. Shared by the game (the tutorial's example and the
// presets/ files) and by the tests.

import { createMap } from '../editor/mapState';
import { Ground, Plant, Resource, Species, WallType } from '../shared/ids';
import type { ClimateDrift, FounderPerson, MapData, RunSetup } from '../shared/types';

export const W = 160;
export const H = 90;
export const at = (x: number, y: number): number => y * W + x;

export function fillRect(
  _m: MapData, x0: number, y0: number, x1: number, y1: number, fn: (i: number, x: number, y: number) => void,
): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(at(x, y), x, y);
}

export function runOf(map: MapData, seed = 1, climateDrift: ClimateDrift = 'off'): RunSetup {
  return { version: 3, name: 'test', map, founders: [], events: [], seed, climateDrift };
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

/**
 * Scenario C — "Collapse" (§26): Scenario A plus a drought over the whole area (start 500,
 * 50 years, strength 70) and a plague (start 800, strength 80).
 */
export function scenarioC(seed = 1): RunSetup {
  const run = scenarioA(seed);
  run.name = 'Scenario C — Collapse';
  run.events = [
    { kind: 'drought', at: { x: 76, y: 45 }, startYear: 500, lengthYears: 50, strength: 70 },
    { kind: 'plague', at: { x: 76, y: 45 }, startYear: 800, strength: 80 },
  ];
  return run;
}

// ---------- F9: the new scenarios of the future blueprint (§19) ----------

/** `n` men and `n` women with fixed ages 18–30 and the given traits. */
export function founders(n: number, intelligence = 100, cooperation = 50, strength = 50): FounderPerson[] {
  const ages = [20, 27, 19, 24, 22, 29, 18, 25, 21, 26];
  return Array.from({ length: 2 * n }, (_, k) => ({
    sex: (k < n ? 0 : 1) as 0 | 1, age: ages[k % ages.length]!, intelligence, cooperation, strength,
  }));
}

const seaBorder = (m: MapData): void => fillRect(m, 0, 0, W - 1, H - 1, (i, x, y) => {
  if (x === 0 || y === 0 || x === W - 1 || y === H - 1) m.wall[i] = WallType.Sea;
});

const patch = (m: MapData, x0: number, y0: number, size: number, plant: number): void =>
  fillRect(m, x0, y0, x0 + size - 1, y0 + size - 1, (i) => { m.plantType[i] = plant; m.plantDensity[i] = 255; });

const deposit = (m: MapData, cx: number, cy: number, res: number): void =>
  fillRect(m, cx - 2, cy - 2, cx + 2, cy + 2, (i) => { m.resourceType[i] = res; m.resourceAmount[i] = 255; });

const mountainBlock = (m: MapData, x0: number, y0: number, res: number): void => fillRect(m, x0, y0, x0 + 5, y0 + 5, (i) => {
  m.ground[i] = Ground.Mountain; m.plantType[i] = Plant.None; m.plantDensity[i] = 0;
  m.resourceType[i] = res; m.resourceAmount[i] = 255;
  for (let s = 0; s < 4; s++) m.animals[s]![i] = 0;
});

/**
 * Scenario E — "Fire season" (future §19): dry forest (rain 35 in the west to 45 in the east)
 * with grassland edges, three groups of 10: careful (clever, cooperative), average, careless
 * (low intelligence, low cooperation). Seeds 1–10, drift slow.
 */
export function scenarioE(seed = 1): RunSetup {
  const m = createMap();
  seaBorder(m);
  fillRect(m, 1, 1, W - 2, H - 2, (i, x, y) => {
    m.rain[i] = 35 + Math.round((10 * (x - 1)) / (W - 3));
    const edge = y <= 10 || y >= H - 11;
    if (edge) { m.plantType[i] = Plant.Grass; m.plantDensity[i] = 200; m.animals[Species.Herd][i] = 77; m.animals[Species.Prey][i] = 51; }
    else { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 230; m.animals[Species.Prey][i] = 128; m.animals[Species.Predator][i] = 13; }
  });
  const homes: Array<[number, number, string, number, number]> = [[30, 45, 'Careful', 130, 75], [80, 45, 'Average', 100, 50], [130, 45, 'Careless', 70, 20]];
  for (const [x, y] of homes) {
    // A grassy clearing with fruit by each home, stone and clay within reach.
    disk(x, y, 4, (i) => { m.plantType[i] = Plant.Grass; m.plantDensity[i] = 200; });
    patch(m, x + 3, y - 6, 5, Plant.FruitBushes);
    deposit(m, x - 6, y + 5, Resource.Stone);
    deposit(m, x + 6, y + 6, Resource.Clay);
  }
  const run = runOf(m, seed, 'slow');
  run.name = 'Scenario E — Fire season';
  run.founders = homes.map(([x, y, name, int, coop], k) => ({ id: k + 1, name, colorIndex: [5, 1, 0][k]!, x, y, people: founders(5, int, coop) }));
  return run;
}

/** Valley floor rows of Scenario F (the river runs along y = 44–45). */
const F_VALLEY = { top: 36, bottom: 53, riverTop: 44, riverBottom: 45 } as const;

/**
 * Scenario F — "Floodplain city" (future §19): a River wall along a wide valley floor (height 0,
 * rain 40, grass and fruit) between dry uplands (rain 25, rising to height 6). A wet period of 20
 * years every 300 years. Two groups of 10 on the north side: one on the floodplain, one on the
 * upland edge.
 */
export function scenarioF(seed = 1): RunSetup {
  const m = createMap();
  seaBorder(m);
  const V = F_VALLEY;
  fillRect(m, 1, 1, W - 2, H - 2, (i, _x, y) => {
    if (y >= V.riverTop && y <= V.riverBottom) { m.wall[i] = WallType.River; return; }
    if (y >= V.top && y <= V.bottom) {
      m.rain[i] = 40; m.plantType[i] = Plant.Grass; m.plantDensity[i] = 230;
      m.animals[Species.Prey][i] = 102; m.animals[Species.Herd][i] = 26;
      return;
    }
    const dist = y < V.top ? V.top - y : y - V.bottom;
    m.elevation[i] = Math.min(6, 1 + Math.floor(dist / 3));
    m.rain[i] = 25; m.plantType[i] = Plant.Grass; m.plantDensity[i] = 140;
    m.animals[Species.Herd][i] = 77; m.animals[Species.Prey][i] = 51; m.animals[Species.Riding][i] = 26;
  });
  // Woods: a gallery forest along the valley edges and groves on the uplands (wood for huts and fires).
  fillRect(m, 1, V.top, W - 2, V.top + 2, (i) => { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 230; });
  fillRect(m, 1, V.bottom - 2, W - 2, V.bottom, (i) => { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 230; });
  for (const [x, y] of [[20, 12], [60, 20], [100, 14], [140, 22], [30, 72], [90, 66], [130, 75]] as const) {
    disk(x, y, 5, (i) => { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 230; m.animals[Species.Predator][i] = 13; });
  }
  patch(m, 45, 39, 4, Plant.FruitBushes);
  patch(m, 104, 26, 4, Plant.FruitBushes);
  fillRect(m, 1, V.riverTop - 1, W - 2, V.riverTop - 1, (i, x) => { if (x % 3 === 0) { m.resourceType[i] = Resource.Clay; m.resourceAmount[i] = 255; } });
  deposit(m, 96, 24, Resource.Stone);
  deposit(m, 36, 38, Resource.Stone);
  mountainBlock(m, 120, 4, Resource.Copper);
  const run = runOf(m, seed, 'slow');
  run.name = 'Scenario F — Floodplain city';
  run.founders = [
    { id: 1, name: 'River', colorIndex: 1, x: 40, y: V.riverTop - 2, people: founders(5) },
    { id: 2, name: 'Upland', colorIndex: 2, x: 100, y: 30, people: founders(5) },
  ];
  run.events = Array.from({ length: 33 }, (_, k) => ({ kind: 'wetPeriod' as const, at: { x: 80, y: 20 }, startYear: 300 * (k + 1), lengthYears: 20, strength: 60 }));
  return run;
}

/**
 * Scenario G — "Overgrazed steppe" (future §19): grassland at rain 25 (north) to 35 (south) with
 * many wild goats and horses, a few groves and a lake; two herding-friendly groups of 10.
 */
export function scenarioG(seed = 1): RunSetup {
  const m = createMap();
  seaBorder(m);
  fillRect(m, 1, 1, W - 2, H - 2, (i, _x, y) => {
    m.rain[i] = 25 + Math.round((10 * (y - 1)) / (H - 3));
    m.plantType[i] = Plant.Grass; m.plantDensity[i] = 220;
    m.animals[Species.Herd][i] = 179; m.animals[Species.Riding][i] = 102; m.animals[Species.Prey][i] = 51;
  });
  for (const [x, y] of [[25, 20], [70, 70], [110, 25], [140, 65], [50, 45], [100, 50]] as const) {
    disk(x, y, 3, (i) => { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 230; m.animals[Species.Predator][i] = 26; });
  }
  disk(80, 45, 3, (i) => { m.ground[i] = Ground.Water; m.plantType[i] = Plant.None; m.plantDensity[i] = 0; for (let s = 0; s < 4; s++) m.animals[s]![i] = 0; });
  patch(m, 40, 40, 4, Plant.FruitBushes);
  patch(m, 116, 40, 4, Plant.FruitBushes);
  deposit(m, 36, 50, Resource.Stone);
  deposit(m, 124, 50, Resource.Stone);
  deposit(m, 84, 40, Resource.Clay);
  const run = runOf(m, seed, 'slow');
  run.name = 'Scenario G — Overgrazed steppe';
  run.founders = [
    { id: 1, name: 'Herders', colorIndex: 2, x: 45, y: 45, people: founders(5, 100, 50, 50) },
    { id: 2, name: 'Riders', colorIndex: 5, x: 115, y: 45, people: founders(5, 100, 50, 50) },
  ];
  return run;
}

/** The island of Scenario H (land tiles), inside a sea of Sea walls x 1–45. */
export const H_ISLAND = { x0: 12, y0: 36, x1: 31, y1: 53, seaTo: 45 } as const;

/**
 * Scenario H — "Island isolation" (future §19): a small island (20 × 18 km, Sea walls all round)
 * with 6 founders, and a large rich mainland with 4 groups of 8.
 */
export function scenarioH(seed = 1): RunSetup {
  const m = createMap();
  seaBorder(m);
  const I = H_ISLAND;
  fillRect(m, 1, 1, W - 2, H - 2, (i, x, y) => {
    m.rain[i] = 60;
    const island = x >= I.x0 && x <= I.x1 && y >= I.y0 && y <= I.y1;
    if (x <= I.seaTo && !island) { m.wall[i] = WallType.Sea; return; }
    if ((x + y) % 2 === 0 || island) { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 230; m.animals[Species.Prey][i] = 128; m.animals[Species.Predator][i] = 13; }
    else { m.plantType[i] = Plant.Grass; m.plantDensity[i] = 220; m.animals[Species.Prey][i] = 77; m.animals[Species.Herd][i] = 77; m.animals[Species.Riding][i] = 51; }
  });
  // Clearings and food: the island has grass, fruit, stone and clay, but no metal.
  fillRect(m, I.x0 + 4, I.y0 + 4, I.x1 - 4, I.y1 - 4, (i, x, y) => { if ((x + y) % 3 === 0) { m.plantType[i] = Plant.Grass; m.plantDensity[i] = 220; } });
  patch(m, I.x0 + 12, I.y0 + 2, 4, Plant.FruitBushes);
  deposit(m, I.x0 + 4, I.y1 - 4, Resource.Stone);
  deposit(m, I.x1 - 4, I.y1 - 3, Resource.Clay);
  for (const [x, y] of [[60, 20], [60, 60], [110, 20], [110, 60], [85, 40]] as const) patch(m, x, y, 6, Plant.FruitBushes);
  for (const [x, y] of [[75, 30], [95, 55], [140, 40]] as const) deposit(m, x, y, Resource.Stone);
  for (const [x, y] of [[80, 70], [130, 15]] as const) deposit(m, x, y, Resource.Clay);
  mountainBlock(m, 145, 70, Resource.Copper);
  mountainBlock(m, 100, 4, Resource.Iron);
  const run = runOf(m, seed, 'slow');
  run.name = 'Scenario H — Island isolation';
  run.founders = [
    { id: 1, name: 'Islanders', colorIndex: 4, x: 21, y: 44, people: founders(3) },
    { id: 2, name: 'North', colorIndex: 0, x: 70, y: 25, people: founders(4) },
    { id: 3, name: 'South', colorIndex: 1, x: 70, y: 65, people: founders(4) },
    { id: 4, name: 'East', colorIndex: 2, x: 125, y: 25, people: founders(4) },
    { id: 5, name: 'Coast', colorIndex: 3, x: 125, y: 65, people: founders(4) },
  ];
  return run;
}
