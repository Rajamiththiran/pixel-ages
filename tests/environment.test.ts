// F3 — food and environment (future blueprint §9.7). Hand-checked numbers from the §9 rules.

import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Action, Ground, Hazard, Plant, Species, WallType } from '../src/shared/ids';
import { Discovery, maskOf } from '../src/shared/discoveries';
import { createState, type SimState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { cloneState, hashState } from '../src/sim/serialize';
import { fishCapacity, fishSustainable, fishTiles, updateFish } from '../src/sim/world/fish';
import { capacity, updateAnimals, yearlyExtinction } from '../src/sim/world/animals';
import { Farmed, farmableTile, fieldYield, soilMult, yearlySoil } from '../src/sim/people/farming';
import { fishWork, spoil } from '../src/sim/people/food';
import { fishCatch } from '../src/sim/people/foodJobs';
import { at, fourPeople, runOf } from './fixtures';

const D = Discovery;

/** A grassland world (rain 50) with a lake around (60, 40) and one band at (50, 40). */
function world(edit?: (m: ReturnType<typeof createMap>) => void, people = fourPeople()): SimState {
  const m = createMap();
  for (let y = 36; y <= 44; y++) for (let x = 55; x <= 65; x++) m.ground[at(x, y)] = Ground.Water;
  edit?.(m);
  const run = runOf(m);
  run.founders = [{ id: 1, name: 'Oak', colorIndex: 0, x: 52, y: 40, people }];
  return createState(run);
}

describe('fish (§9.1)', () => {
  it('capacity by water: river 0.8, lake 0.6, sea 0.5, land 0; waters start full', () => {
    const s = world((m) => { m.wall[at(10, 10)] = WallType.River; m.wall[at(11, 10)] = WallType.Sea; m.wall[at(12, 10)] = WallType.Mountain; });
    expect(fishCapacity(s, at(10, 10))).toBe(0.8);
    expect(fishCapacity(s, at(11, 10))).toBe(0.5);
    expect(fishCapacity(s, at(12, 10))).toBe(0);
    expect(fishCapacity(s, at(60, 40))).toBe(0.6);
    expect(fishCapacity(s, at(50, 40))).toBe(0);
    expect(s.fish[at(60, 40)]).toBeCloseTo(0.6, 6);
  });

  it('logistic growth: f + 0.04 × f × (1 − f / K) a month', () => {
    const s = world();
    // Fill the whole lake evenly so diffusion between lake tiles cancels out in its middle.
    for (let y = 36; y <= 44; y++) for (let x = 55; x <= 65; x++) s.fish[at(x, y)] = 0.3;
    updateFish(s);
    expect(s.fish[at(60, 40)]).toBeCloseTo(0.3 + 0.04 * 0.3 * (1 - 0.3 / 0.6), 6);   // 0.306
  });

  it('a fisher takes 5 × density (×1.5 with Nets) and 0.01 of the fish (yield tuned in TUNING pass 4)', () => {
    const s = world();
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.stoneTools, D.fishing);
    const waters = fishTiles(s, g.homeX, g.homeY, g.known);
    expect(waters.length).toBeGreaterThan(0);
    expect(waters.every((i) => s.ground[i] === Ground.Water)).toBe(true);
    g.foodStock = 0;
    const tile = fishWork(s, g, 1, waters);
    expect(g.foodStock).toBeCloseTo(5 * 0.6, 5);
    expect(s.fish[tile]).toBeCloseTo(0.59, 5);
    g.discoveries = maskOf(D.stoneTools, D.fishing, D.fishingNets);
    expect(fishCatch(g, 0.5, 1)).toBeCloseTo(5 * 0.5 * 1.5, 12);
  });

  it('sustainable catch: growth × K/4 / 0.01 catches × yield × K/2 (sea 0.625, lake 0.9, river 1.6 FU a month)', () => {
    const s = world((m) => { m.wall[at(10, 10)] = WallType.River; m.wall[at(11, 10)] = WallType.Sea; });
    expect(fishSustainable(s, at(11, 10))).toBeCloseTo(0.625, 6);
    expect(fishSustainable(s, at(60, 40))).toBeCloseTo(0.9, 6);
    expect(fishSustainable(s, at(10, 10))).toBeCloseTo(1.6, 6);
  });

  it('people fish the open water beyond the bank they know', () => {
    const s = world((m) => { for (let y = 0; y < 90; y++) for (let x = 0; x < 49; x++) m.wall[at(x, y)] = WallType.Sea; });
    const g = s.groups[0]!;
    const known = fishTiles(s, g.homeX, g.homeY, g.known).filter((i) => (g.known[i >> 3]! >> (i & 7)) & 1);
    const all = fishTiles(s, g.homeX, g.homeY, g.known);
    expect(known.length).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThan(known.length * 2);
  });

  it('a lakeside band with Fishing fishes when plants are short', () => {
    const s = world((m) => { m.plantType.fill(Plant.None); m.plantDensity.fill(0); }, Array.from({ length: 12 }, (_, k) => ({
      sex: (k % 2) as 0 | 1, age: 25, intelligence: 100, cooperation: 50, strength: 50,
    })));
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.stoneTools, D.fishing);
    let fisherMonths = 0;
    for (let m = 0; m < 24 && s.groups.length > 0; m++) {
      runTicks(s, 1);
      for (const slot of s.groups[0]?.members ?? []) if (s.persons.action[slot] === Action.Fish) fisherMonths++;
    }
    expect(fisherMonths).toBeGreaterThan(24);
  });
});

describe('local extinction and migration (§9.2–9.3)', () => {
  it('deer below 1% for 5 years die out on a tile; the log names the area once they are gone from it', () => {
    const s = world((m) => { m.animals[Species.Prey][at(20, 20)] = 1; });
    const i = at(20, 20);
    // Empty everything else, then keep this one tile at 0.5% every year.
    s.animal[Species.Prey].fill(0);
    for (let y = 0; y < 4; y++) { s.animal[Species.Prey][i] = 0.005; yearlyExtinction(s); }
    expect(s.animal[Species.Prey][i]).toBeCloseTo(0.005, 6);
    s.animal[Species.Prey][i] = 0.005;
    yearlyExtinction(s);
    expect(s.animal[Species.Prey][i]).toBe(0);
    expect(s.log.filter((e) => e.type === 'animalsGone').map((e) => e.text)).toEqual(['Deer are gone from Area 1']);
    yearlyExtinction(s);
    expect(s.log.filter((e) => e.type === 'animalsGone')).toHaveLength(1);   // logged once
  });

  it('a tile back above 1% resets the count; wolves keep their cycles', () => {
    const s = world();
    const i = at(20, 20);
    s.animal[Species.Prey][i] = 0.005;
    s.animal[Species.Predator][i] = 0.005;
    for (let y = 0; y < 4; y++) yearlyExtinction(s);
    s.animal[Species.Prey][i] = 0.02;
    yearlyExtinction(s);
    s.animal[Species.Prey][i] = 0.005;
    for (let y = 0; y < 4; y++) yearlyExtinction(s);
    expect(s.animal[Species.Prey][i]).toBeCloseTo(0.005, 6);
    for (let y = 0; y < 10; y++) yearlyExtinction(s);
    expect(s.animal[Species.Predator][i]).toBeCloseTo(0.005, 6);
  });

  it('gone animals come back by diffusion from neighbours', () => {
    const s = world();
    s.animal[Species.Prey].fill(0);
    s.animal[Species.Prey][at(20, 20)] = 0.5;
    for (let m = 0; m < 12; m++) updateAnimals(s);
    expect(s.animal[Species.Prey][at(21, 20)]).toBeGreaterThan(0);
  });

  it('spring drift leans toward greener tiles, autumn back; the total given stays 3%', () => {
    const s = world((m) => {
      for (let x = 0; x < 160; x++) for (let y = 0; y < 90; y++) m.rain[at(x, y)] = x <= 30 ? 20 : 60;
    });
    const a = at(30, 20), b = at(31, 20);
    expect(capacity(s, Species.Herd, b)).toBeGreaterThan(capacity(s, Species.Herd, a));
    const run = (month: number): number => {
      const c = cloneState(s);
      c.animal[Species.Herd].fill(0);
      c.animal[Species.Prey].fill(0);
      c.animal[Species.Predator].fill(0);
      c.animal[Species.Riding].fill(0);
      c.animal[Species.Herd][a] = 0.4;
      c.month = month;
      updateAnimals(c);
      return c.animal[Species.Herd][b]!;
    };
    const summer = run(4), spring = run(0), autumn = run(6);
    expect(spring).toBeGreaterThan(summer * 1.3);
    expect(autumn).toBeLessThan(summer * 0.7);
  });
});

describe('soil fertility and fallow (§9.4)', () => {
  it('farming drains 0.04 a year (0.016 with Crop Rotation), rest restores 0.10, manure adds 0.02', () => {
    const s = world();
    const g = s.groups[0]!;
    const a = at(45, 40), b = at(45, 41), c = at(45, 42);
    for (const i of [a, b, c]) s.fertility[i] = 0.5;
    s.farmedThisYear[a] = Farmed.Worked;
    s.farmedThisYear[b] = Farmed.Worked | Farmed.Rotation;
    yearlySoil(s);
    expect(s.fertility[a]).toBeCloseTo(0.46, 6);
    expect(s.fertility[b]).toBeCloseTo(0.5 - 0.04 * 0.4, 6);
    expect(s.fertility[c]).toBeCloseTo(0.6, 6);
    g.herd = 10;
    g.farmTiles = [a];
    s.farmedThisYear[a] = Farmed.Worked;
    yearlySoil(s);
    expect(s.fertility[a]).toBeCloseTo(0.46 + 0.02 - 0.04, 6);
    s.fertility[c] = 0.95;
    yearlySoil(s);
    expect(s.fertility[c]).toBe(1);                       // never above 1
  });

  it('yield × (0.4 + 0.6 × fertility) × (1 − salinity)', () => {
    const s = world();
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.farming);
    const i = at(45, 40);
    s.month = 6;                                          // autumn harvest
    const full = fieldYield(s, g, i, 1);
    s.fertility[i] = 0.5;
    expect(soilMult(s, i)).toBeCloseTo(0.7, 6);
    expect(fieldYield(s, g, i, 1)).toBeCloseTo(full * 0.7, 6);
    s.salinity[i] = 0.25;
    expect(fieldYield(s, g, i, 1)).toBeCloseTo(full * 0.7 * 0.75, 6);
  });
});

describe('salinity (§9.5)', () => {
  it('irrigated fields without Drainage gain 0.01 salt a year; Drainage removes 0.02; above 0.8 the field is barren', () => {
    const s = world();
    const i = at(54, 40);                                 // next to the lake
    s.plantType[i] = Plant.Farmland;
    s.plantDensity[i] = 255;
    s.salinity[i] = 0.5;
    s.farmedThisYear[i] = Farmed.Worked | Farmed.Irrigated;
    yearlySoil(s);
    expect(s.salinity[i]).toBeCloseTo(0.51, 6);
    s.farmedThisYear[i] = Farmed.Worked | Farmed.Irrigated | Farmed.Drained;
    yearlySoil(s);
    expect(s.salinity[i]).toBeCloseTo(0.49, 6);
    s.salinity[i] = 0.795;
    s.farmedThisYear[i] = Farmed.Worked | Farmed.Irrigated;
    yearlySoil(s);
    expect(s.plantType[i]).toBe(Plant.None);               // barren and abandoned
    expect(farmableTile(s, i, true)).toBe(false);
  });

  it('a field is only "irrigated" when water was actually needed (rain factor below 1)', () => {
    const s = world();
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.farming, D.irrigation);
    const i = at(54, 40);
    s.rainNow[i] = 70;                                     // wet enough: no irrigation
    fieldYield(s, g, i, 1);
    expect(s.farmedThisYear[i]! & Farmed.Irrigated).toBe(0);
    s.rainNow[i] = 20;
    fieldYield(s, g, i, 1);
    expect(s.farmedThisYear[i]! & Farmed.Irrigated).toBe(Farmed.Irrigated);
  });
});

describe('granaries and pests (§9.6)', () => {
  it('without Pottery or Granary, food above 6 months of need loses 5% more a month, and teaches', () => {
    const s = world();
    const g = s.groups[0]!;
    g.discoveries = maskOf();
    g.need = 10;
    g.foodStock = 100;                                    // 10 months
    spoil(s, g);
    // 10% spoilage of 100, plus 5% of the 40 above 6 months.
    expect(g.foodStock).toBeCloseTo(100 - 10 - 2, 6);
    expect(g.lessons[Hazard.Pests]).toBeGreaterThan(s.year);
    g.discoveries = maskOf(D.fire, D.pottery);
    g.foodStock = 100;
    spoil(s, g);
    expect(g.foodStock).toBeCloseTo(100 - 6, 6);           // Pottery: no pests
  });

  it('a Granary halves spoilage for up to 12 months of need', () => {
    const s = world();
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.farming, D.granary);
    g.need = 5;
    g.foodStock = 100;                                    // 20 months: 60 in the granary, 40 outside
    spoil(s, g);
    expect(g.foodStock).toBeCloseTo(100 - 60 * 0.1 * 0.5 - 40 * 0.1, 6);
  });
});

describe('state (§5.6)', () => {
  it('keyframes and the hash cover fish, soil, salt and extinction counters', () => {
    const s = world();
    const c = cloneState(s);
    expect(hashState(c)).toBe(hashState(s));
    c.fertility[5] = 0.5;
    expect(s.fertility[5]).toBe(1);
    expect(hashState(c)).not.toBe(hashState(s));
    const d = cloneState(s);
    d.animalLowYears[7] = 3;
    expect(hashState(d)).not.toBe(hashState(s));
    const e = cloneState(s);
    e.fish[at(60, 40)] = 0.1;
    expect(hashState(e)).not.toBe(hashState(s));
  });
});
