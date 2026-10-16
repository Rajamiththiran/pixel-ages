// F5 — elements and hazards (future blueprint §11.7). Hand-checked numbers from the §11 rules.

import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createMap } from '../src/editor/mapState';
import { Ground, Hazard, Plant, Practice, Resource, Species, WallType } from '../src/shared/ids';
import { Discovery, maskOf } from '../src/shared/discoveries';
import { createState, type SimState } from '../src/sim/state';
import { cloneState, hashState } from '../src/sim/serialize';
import { runTicks } from '../src/sim/tick';
import { toVillage } from '../src/sim/people/village';
import { Farmed, fieldYield } from '../src/sim/people/farming';
import { discoveryChance } from '../src/sim/progress/discoveryRules';
import { DISCOVERIES } from '../src/shared/discoveries';
import {
  dryness, fireFrom, flashFloods, floodplains, hazardDeathMult, herdPredation, maintain, riskLayer, riverFloods,
  townFireChance, yearlyBlight, yearlyDisease, yearlyLandslides, yearlyMines, yearlyUpkeep,
} from '../src/sim/world/hazards';
import { at, fourPeople, runOf } from './fixtures';

const FU = CONFIG.future;
const D = Discovery;

/** Restores any config numbers a test raised to force an event. */
const saved: Array<[Record<string, number>, string, number]> = [];
const force = (obj: Record<string, number>, key: string, v: number): void => { saved.push([obj, key, obj[key]!]); obj[key] = v; };
afterEach(() => { while (saved.length) { const [o, k, v] = saved.pop()!; o[k] = v; } });

function people(n: number): ReturnType<typeof fourPeople> {
  return Array.from({ length: n }, (_, k) => ({ sex: (k % 2) as 0 | 1, age: 25, intelligence: 100, cooperation: 50, strength: 50 }));
}

/** A dry forest (rain 20) with a River wall at x = 60–61 and one band at (50, 40). */
function world(edit?: (m: ReturnType<typeof createMap>) => void, n = 4): SimState {
  const m = createMap();
  m.rain.fill(20);
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  for (let y = 0; y < 90; y++) for (const x of [60, 61]) { m.wall[at(x, y)] = WallType.River; m.plantType[at(x, y)] = Plant.None; m.plantDensity[at(x, y)] = 0; }
  edit?.(m);
  const run = runOf(m);
  run.founders = [{ id: 1, name: 'Oak', colorIndex: 0, x: 50, y: 40, people: n === 4 ? fourPeople() : people(n) }];
  return createState(run);
}

describe('fire (§11.2)', () => {
  it('dryness = clamp(1 − rain / 60) × season: summer ×1, winter ×0.1', () => {
    const s = world();
    s.month = 4;                                           // summer
    expect(dryness(s, at(10, 10))).toBeCloseTo(1 - 20 / 60, 6);
    s.month = 10;                                          // winter
    expect(dryness(s, at(10, 10))).toBeCloseTo((1 - 20 / 60) * 0.1, 6);
  });

  it('fire spreads through fuel, stops at a river, and leaves ash with fresh grass', () => {
    const s = world();
    s.month = 4;
    force(FU.fire as unknown as Record<string, number>, 'spreadBase', 100);   // every roll lights
    const { tiles } = fireFrom(s, at(57, 40));
    expect(tiles).toBeGreaterThan(50);
    expect(s.fireState[at(59, 40)]).toBeGreaterThan(0);    // the near bank burns
    for (let y = 30; y <= 50; y++) expect(s.fireState[at(62, y)]).toBe(0); // the far bank never does
    const i = at(57, 40);
    expect(s.plantType[i]).toBe(Plant.Grass);
    expect(s.plantDensity[i]).toBe(CONFIG.plants.newPlantDensity);
    expect(s.ash[i]).toBe(FU.fire.ashYears);
    // Burned land doesn't burn again while the ash lasts.
    expect(fireFrom(s, i).tiles).toBe(0);
  });

  it('fire spreads much further in summer than in winter', () => {
    const burned = (month: number): number => {
      let total = 0;
      for (let k = 0; k < 20; k++) {
        const s = world();
        s.rng[1] = (s.rng[1]! ^ Math.imul(k + 1, 2654435761)) >>> 0;
        s.month = month;
        total += fireFrom(s, at(30, 40)).tiles;
      }
      return total;
    };
    expect(burned(4)).toBeGreaterThan(burned(10) * 3);
  });

  it('a stone or firebreak town burns less than a thatch town (§4.1)', () => {
    const s = world(undefined, 200);
    const g = s.groups[0]!;
    s.month = 4;
    g.huts = 20;
    g.houses = 0;
    const thatch = townFireChance(s, g);
    // 0.002 × dryness 2/3 × crowding (200 / 150) × thatch 1
    expect(thatch).toBeCloseTo(0.002 * (2 / 3) * (200 / 150), 9);
    g.huts = 0;
    g.houses = 20;
    expect(townFireChance(s, g)).toBeCloseTo(thatch * 0.5, 9);
    g.discoveries = maskOf(D.fireSafety, D.firebreaks);
    expect(townFireChance(s, g)).toBeCloseTo(thatch * 0.5 * 0.5, 9);
    g.discoveries = maskOf(D.firebreaks, D.stoneBuilding);
    expect(townFireChance(s, g)).toBeCloseTo(thatch * 0.5 * 0.5 * 0.5, 9);
  });

  it('a fire reaching a settlement burns half its buildings and 30% of its food, and teaches', () => {
    const s = world();
    const g = s.groups[0]!;
    g.huts = 4;
    g.foodStock = 100;
    s.month = 4;
    force(FU.fire as unknown as Record<string, number>, 'spreadBase', 100);
    force(FU.fire as unknown as Record<string, number>, 'lightning', 1);   // every summer forest tile is struck
    runTicks(s, 1);
    expect(g.huts).toBe(2);
    expect(g.foodStock).toBeLessThan(80);
    expect(g.lessons[Hazard.Wildfire]).toBeGreaterThan(s.year);
    expect(s.log.some((e) => e.type === 'hazard' && e.text.startsWith('A wildfire reached Oak'))).toBe(true);
  });
});

describe('floods (§11.3)', () => {
  it('floodplain = land within 2 tiles of the river and at most 1 higher', () => {
    const s = world((m) => { m.elevation[at(58, 41)] = 2; });
    const fp = floodplains(s);
    expect(fp.stretch[at(58, 40)]).toBeGreaterThanOrEqual(0);
    expect(fp.stretch[at(59, 40)]).toBeGreaterThanOrEqual(0);
    expect(fp.stretch[at(57, 40)]).toBe(-1);               // 3 tiles away
    expect(fp.stretch[at(58, 41)]).toBe(-1);               // 2 higher than the river
    expect(fp.stretch[at(62, 40)]).toBeGreaterThanOrEqual(0); // the other bank too
  });

  it('a flood covers only the floodplain, takes the harvest, leaves silt; levees kept up stop it', () => {
    const s = world((m) => { m.plantType.fill(Plant.None); }, 4);
    const g = s.groups[0]!;
    g.homeX = 58;
    s.weatherYear.fill(1);                                 // a very wet year
    force(FU.flood as unknown as Record<string, number>, 'base', 100);
    const plain = at(59, 20), dry = at(55, 20);
    s.plantType[plain] = Plant.Farmland;
    s.plantDensity[plain] = 255;
    g.discoveries = maskOf(D.farming, D.irrigation, D.mudBrick, D.levees);
    g.maintenance = 1;
    riverFloods(s);
    expect(s.floodMonths[plain]).toBe(0);                  // levees at full upkeep
    g.maintenance = 0;
    riverFloods(s);
    expect(s.floodMonths[plain]).toBeGreaterThan(0);
    expect(s.floodMonths[dry]).toBe(0);
    expect(s.farmedThisYear[plain]! & Farmed.Flooded).toBe(Farmed.Flooded);
    s.month = 6;
    expect(fieldYield(s, g, plain, 1)).toBe(0);            // this year's harvest is lost
    expect(g.lessons[Hazard.RiverFlood]).toBeGreaterThan(s.year);
  });

  it('flash floods hit big villages without drains in heavy rain', () => {
    const s = world((m) => { m.rain.fill(100); m.plantType.fill(Plant.None); }, 320);
    const g = s.groups[0]!;
    toVillage(s, g);
    force(FU.flood as unknown as Record<string, number>, 'flashBase', 100);
    g.discoveries = maskOf(D.farming, D.irrigation, D.drainage);
    g.maintenance = 1;
    flashFloods(s);
    expect(s.hazardsActive).toHaveLength(0);               // drains at full upkeep
    g.maintenance = 0;
    flashFloods(s);
    expect(s.hazardsActive.map((h) => h.kind)).toEqual([Hazard.FlashFlood]);
  });
});

describe('disease (§11.4)', () => {
  it('endemic disease in villages: 1 + 0.2 × crowding × herds × clean water', () => {
    const s = world((m) => { m.plantType.fill(Plant.None); }, 300);
    const g = s.groups[0]!;
    expect(hazardDeathMult(s, g)).toBe(1);                  // a band
    toVillage(s, g);
    g.herd = 0;
    expect(hazardDeathMult(s, g)).toBeCloseTo(1 + 0.2 * 2 * 0.5, 9);
    g.herd = 50;
    expect(hazardDeathMult(s, g)).toBeCloseTo(1 + 0.2 * 2 * 1, 9);
    g.discoveries = maskOf(D.diggingStick, D.farming, D.wells);
    expect(hazardDeathMult(s, g)).toBeCloseTo(1 + 0.2 * 2 * 0.5, 9);
  });

  it('outbreaks spread only along trade links', () => {
    const m = createMap();
    const run = runOf(m);
    run.founders = [
      { id: 1, name: 'A', colorIndex: 0, x: 20, y: 20, people: fourPeople() },
      { id: 2, name: 'B', colorIndex: 1, x: 24, y: 20, people: fourPeople() },
      { id: 3, name: 'C', colorIndex: 2, x: 20, y: 24, people: fourPeople() },
    ];
    const s = createState(run);
    s.relations = [
      { a: 1, b: 2, kind: 'trade', sinceYear: 0, reviewYear: 10, pa: 0, pb: 0 },
      { a: 1, b: 3, kind: 'coexist', sinceYear: 0, reviewYear: 10, pa: 0, pb: 0 },
    ];
    s.hazardsActive = [{ kind: Hazard.Outbreak, groupId: 1, endYear: 5 }];
    force(FU.disease as unknown as Record<string, number>, 'spreadChance', 1);
    yearlyDisease(s);
    const sickIds = s.hazardsActive.filter((h) => h.kind === Hazard.Outbreak).map((h) => h.groupId);
    expect(sickIds).toEqual([1, 2]);
    expect(hazardDeathMult(s, s.groups[1]!)).toBe(FU.disease.outbreakMult);
  });
});

describe('blight, landslides, mines, herds (§11.1)', () => {
  it('blight: a wet year without Crop Rotation cuts next year\'s harvest to 0.3', () => {
    const s = world((m) => { m.plantType.fill(Plant.None); });
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.farming);
    g.farmTiles = [at(48, 40), at(49, 40), at(51, 40)];
    s.month = 6;
    const before = fieldYield(s, g, at(48, 40), 1);
    force(FU.blight as unknown as Record<string, number>, 'base', 100);
    yearlyBlight(s);
    expect(fieldYield(s, g, at(48, 40), 1)).toBeCloseTo(before * 0.3, 9);
    g.discoveries = maskOf(D.farming, D.cropRotation);
    s.hazardsActive = [];
    yearlyBlight(s);
    expect(s.hazardsActive).toHaveLength(0);
  });

  it('cleared slopes slide in wet years; forest and terraces hold them', () => {
    const s = world((m) => { for (let x = 20; x <= 30; x++) m.elevation[at(x, 10)] = x % 2 === 0 ? 9 : 0; });
    s.weatherYear.fill(1);
    const bare = at(24, 10), forest = at(26, 10), terraced = at(28, 10);
    s.plantType[bare] = Plant.Farmland;
    s.plantType[terraced] = Plant.Farmland;
    s.terrace[terraced] = 1;
    force(FU.landslide as unknown as Record<string, number>, 'base', 100);
    yearlyLandslides(s);
    expect(s.plantType[bare]).toBe(Plant.None);
    expect(s.fertility[bare]).toBe(0);
    expect(s.plantType[forest]).toBe(Plant.Forest);
    expect(s.plantType[terraced]).toBe(Plant.Farmland);
  });

  it('a mine with little practice may collapse: deaths, and the deposit is lost', () => {
    const ore = at(51, 40);
    const s = world((m) => { m.resourceType[ore] = Resource.Copper; m.resourceAmount[ore] = 200; }, 20);
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.fire, D.pottery, D.copperWorking, D.mining);
    force(FU.mine as unknown as Record<string, number>, 'base', 100);
    yearlyMines(s);
    expect(s.resourceAmount[ore]).toBe(0);
    expect(s.quarry[ore]).toBe(1);
    expect(g.lessons[Hazard.MineCollapse]).toBeGreaterThan(0);
    // Full metal-work practice makes it safe.
    s.resourceAmount[ore] = 200; s.resourceType[ore] = Resource.Copper;
    g.practice[Practice.metalWork] = 1e6;
    yearlyMines(s);
    expect(s.resourceAmount[ore]).toBe(200);
  });

  it('wolves take herd animals: herd × (1 − wolves × 0.03), × 0.3 with Dogs', () => {
    const s = world();
    const g = s.groups[0]!;
    s.animal[Species.Predator].fill(0.5);
    g.herd = 100;
    herdPredation(s, g, [at(50, 40), at(51, 40)]);
    expect(g.herd).toBeCloseTo(100 * (1 - 0.5 * 0.03), 6);
    g.discoveries = maskOf(D.dogs);
    g.herd = 100;
    herdPredation(s, g, [at(50, 40)]);
    expect(g.herd).toBeCloseTo(100 * (1 - 0.5 * 0.03 * 0.3), 6);
  });
});

describe('upkeep and lessons (§11.5–11.6)', () => {
  it('works lose 5% upkeep a year; a worker-month restores 0.002', () => {
    const s = world();
    const g = s.groups[0]!;
    g.maintenance = 0.8;
    yearlyUpkeep(s);
    expect(g.maintenance).toBeCloseTo(0.76, 9);
    maintain(g, 10);
    expect(g.maintenance).toBeCloseTo(0.78, 9);
    maintain(g, 1000);
    expect(g.maintenance).toBe(1);
  });

  it('neglected canals deliver less water: irrigation bonus × upkeep', () => {
    const s = world((m) => { m.rain.fill(30); m.plantType.fill(Plant.None); m.ground[at(52, 40)] = Ground.Water; });
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.farming, D.irrigation);
    s.month = 6;
    const field = at(51, 40);
    g.maintenance = 1;
    const full = fieldYield(s, g, field, 1);
    g.maintenance = 0;
    const none = fieldYield(s, g, field, 1);
    expect(full / none).toBeCloseTo(60 / 30, 6);            // rain factor 0.5 → 1 with working canals
  });

  it('clever, cooperative groups learn more from a disaster: × (0.5 + int/200) × (0.5 + coop/200)', () => {
    const def = DISCOVERIES[D.firebreaks]!;
    const x = { avgInt: 140, population: 25, fed12: 1, writing: false, teachBonus: 1 };
    const plain = discoveryChance(def, x);
    expect(discoveryChance(def, { ...x, lesson: true, avgCoop: 80 })).toBeCloseTo(plain * 3 * 1.2 * 0.9, 12);
  });
});

describe('risk views and determinism', () => {
  it('fire risk is high on dry forest, nil on water; flood risk only on the floodplain', () => {
    const s = world();
    const fire = riskLayer(s, 'fireRisk');
    expect(fire[at(30, 30)]).toBeGreaterThan(100);
    expect(fire[at(60, 30)]).toBe(0);
    const flood = riskLayer(s, 'floodRisk');
    expect(flood[at(59, 30)]).toBeGreaterThan(0);
    expect(flood[at(30, 30)]).toBe(0);
  });

  it('runs with hazards replay exactly, also from a keyframe', () => {
    const make = (): SimState => world(undefined, 30);
    const a = make(), b = make();
    for (const s of [a, b]) s.groups[0]!.discoveries = maskOf(D.fire);
    runTicks(a, 40 * 12);
    runTicks(b, 20 * 12);
    const c = cloneState(b);
    runTicks(b, 20 * 12);
    runTicks(c, 20 * 12);
    expect(hashState(a)).toBe(hashState(b));
    expect(hashState(c)).toBe(hashState(a));
    const hazardsHappened = a.log.some((e) => e.type === 'hazard') || a.ash.some((v) => v > 0);
    expect(hazardsHappened).toBe(true);
  });

  it('the hash covers burning, flood water, weather and running hazards', () => {
    const s = world();
    const base = hashState(s);
    for (const k of ['fireState', 'floodMonths', 'weatherYear'] as const) {
      const c = cloneState(s);
      c[k][2] = 1;
      expect(hashState(c)).not.toBe(base);
    }
    const c = cloneState(s);
    c.hazardsActive.push({ kind: Hazard.Blight, groupId: 1, endYear: 3 });
    expect(hashState(c)).not.toBe(base);
    expect(s.hazardsActive).toHaveLength(0);
  });
});
