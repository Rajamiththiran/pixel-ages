// F1 — wood and materials (future blueprint §7.4). Hand-checked numbers from the §7 rules.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createMap } from '../src/editor/mapState';
import { Action, Ground, Plant, Resource } from '../src/shared/ids';
import { Discovery, DISCOVERIES, Found, addBit, idsOf, maskOf, orInto } from '../src/shared/discoveries';
import { createState, type SimState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { cloneState, hashState } from '../src/sim/serialize';
import { addKnownTiles, hasActive, isKnown } from '../src/sim/people/explore';
import { ensureFarmTiles } from '../src/sim/people/farming';
import { homeRange } from '../src/sim/people/food';
import {
  CUT_DENSITY, Lack, bestForest, burnFuel, cutWood, payBuilding, woodNeedYear, otherFuel, woodOfDensity, woodSource, yearlyVessels, fuelPerYear,
} from '../src/sim/people/wood';
import { canDiscover, foundMask, gainDiscovery, invalidateFound, useResources } from '../src/sim/progress/discoveryRules';
import { renewClay } from '../src/sim/progress/deposits';
import { at, fourPeople, runOf } from './fixtures';

const Wd = CONFIG.future.wood;

/** A forest world (density 255, rain 50) with one band of `n` at (50, 40). */
function forestWorld(edit?: (m: ReturnType<typeof createMap>) => void, n = 4): SimState {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  edit?.(m);
  const run = runOf(m);
  const people = n === 4 ? fourPeople() : Array.from({ length: n }, (_, k) => ({ sex: (k % 2) as 0 | 1, age: 25, intelligence: 100, cooperation: 50, strength: 50 }));
  run.founders = [{ id: 1, name: 'Oak', colorIndex: 0, x: 50, y: 40, people }];
  return createState(run);
}

describe('cutting wood (§7.1)', () => {
  it('one woodcutter-month removes 10 density points and yields exactly that wood', () => {
    const s = forestWorld();
    const g = s.groups[0]!;
    const i = at(52, 40);
    expect(CUT_DENSITY).toBe(10);                       // 4 units × 255 / 100, rounded
    const tile = cutWood(s, g, [i]);
    expect(tile).toBe(i);
    expect(s.plantDensity[i]).toBe(245);
    expect(g.wood).toBeCloseTo((10 * 100) / 255, 10);   // ≈ 3.92 units
    // Fewer trees hold less food.
    expect(s.plantFood[i]).toBeLessThanOrEqual(CONFIG.plants.maxStock[Plant.Forest]! * (245 / 255) + 1e-6);
  });

  it('cuts the densest forest tile first; ties go to the lowest index', () => {
    const s = forestWorld();
    const a = at(51, 40), b = at(52, 40), c = at(53, 40);
    s.plantDensity[a] = 200;
    expect(bestForest(s, [c, a, b])).toBe(b);           // b and c tie at 255 → lower index b
    s.plantType[b] = Plant.Grass;
    expect(bestForest(s, [c, a, b])).toBe(c);
  });

  it('a tile cut to 0 becomes bare (no plant); the rest of the work moves to the next tile', () => {
    const s = forestWorld();
    const g = s.groups[0]!;
    const a = at(51, 40), b = at(52, 40);
    s.plantDensity[a] = 7;
    s.plantDensity[b] = 5;
    cutWood(s, g, [a, b]);
    expect(s.plantType[a]).toBe(Plant.None);
    expect(s.plantDensity[a]).toBe(0);
    expect(s.plantFood[a]).toBe(0);
    expect(s.plantDensity[b]).toBe(2);                  // 7 from a, the other 3 from b
    expect(g.wood).toBeCloseTo(woodOfDensity(10), 10);
  });

  it('fractional village workers cut a matching share; without forest nothing happens', () => {
    const s = forestWorld();
    const g = s.groups[0]!;
    const a = at(51, 40);
    cutWood(s, g, [a], 2.5);
    expect(s.plantDensity[a]).toBe(255 - 25);
    const before = g.wood;
    expect(cutWood(s, g, [at(80, 80)].filter((i) => s.plantType[i] !== Plant.Forest))).toBe(-1);
    expect(g.wood).toBe(before);
  });

  it('clearing a forest tile for a field yields its wood', () => {
    const s = forestWorld();
    const g = s.groups[0]!;
    const i = at(51, 41);
    s.plantDensity[i] = 204;
    ensureFarmTiles(s, g, 1, [i]);
    expect(s.plantType[i]).toBe(Plant.Farmland);
    expect(g.wood).toBeCloseTo(woodOfDensity(204), 10);  // 80 units
  });

  it('with the range cleared, woodcutters walk up to 10 km for half the wood (DECISIONS 17.3)', () => {
    const dist2 = (i: number): number => (i % 160 - 50) ** 2 + (Math.floor(i / 160) - 40) ** 2;
    const s = forestWorld((m) => {
      // Fields everywhere within 7 km of home; forest only beyond.
      for (let i = 0; i < m.plantType.length; i++) if (dist2(i) <= 49) { m.plantType[i] = Plant.Grass; m.plantDensity[i] = 255; }
    });
    const g = s.groups[0]!;
    addKnownTiles(s, g, Array.from({ length: s.width * s.height }, (_, i) => i).filter((i) => dist2(i) <= 144));
    const range = homeRange(s, g);
    expect(bestForest(s, range)).toBe(-1);
    const src = woodSource(s, g, range);
    expect(src.eff).toBe(Wd.farEfficiency);
    expect(src.tiles.every((i) => dist2(i) <= Wd.farRangeTiles ** 2)).toBe(true);
    const tile = cutWood(s, g, src.tiles, 1, src.eff);
    expect(dist2(tile)).toBeGreaterThan(49);
    expect(s.plantDensity[tile]).toBe(255 - CUT_DENSITY * Wd.farEfficiency);
    expect(g.wood).toBeCloseTo(woodOfDensity(CUT_DENSITY * Wd.farEfficiency), 10);   // nothing from nowhere
  });

  it('forest only beyond 10 km is out of reach; forest in range is cut at the full rate', () => {
    const dist2 = (i: number): number => (i % 160 - 50) ** 2 + (Math.floor(i / 160) - 40) ** 2;
    const s = forestWorld((m) => {
      for (let i = 0; i < m.plantType.length; i++) if (dist2(i) <= 121) m.plantType[i] = Plant.Grass;
    });
    const g = s.groups[0]!;
    addKnownTiles(s, g, Array.from({ length: s.width * s.height }, (_, i) => i).filter((i) => dist2(i) <= 400));
    expect(woodSource(s, g, homeRange(s, g)).tiles).toEqual([]);
    const near = forestWorld();
    expect(woodSource(near, near.groups[0]!, homeRange(near, near.groups[0]!)).eff).toBe(1);
  });
});

describe('fuel for Fire (§7.2)', () => {
  it('fire without fuel is inactive and logs once; with wood it works again', () => {
    const s = forestWorld();
    const g = s.groups[0]!;
    orInto(g.discoveries, maskOf(Discovery.fire));
    g.wood = 0;
    burnFuel(s, g, 4);
    burnFuel(s, g, 4);
    expect(hasActive(g, Discovery.fire)).toBe(false);
    expect(g.inactiveWhy[Discovery.fire]).toBe(Lack.Wood);
    expect(s.log.filter((e) => e.type === 'ranOut' && e.text.includes('Fire'))).toHaveLength(1);
    // A fire that went out needs 2 winter months of fuel (4 × 0.08 × 2 = 0.64) before it is lit again.
    s.month = 0;                                         // spring: 0.02 a person
    g.wood = 0.5;
    burnFuel(s, g, 4);
    expect(hasActive(g, Discovery.fire)).toBe(false);
    expect(g.wood).toBe(0.5);                            // the scraps are kept
    g.wood = 1;
    burnFuel(s, g, 4);
    expect(hasActive(g, Discovery.fire)).toBe(true);
    expect(g.wood).toBeCloseTo(1 - 4 * Wd.fireOther, 10);
  });

  it('without wood, dung and straw keep the fire going; the rest fires the kiln (DECISIONS 17.6)', () => {
    const s = forestWorld((m) => { m.plantType.fill(Plant.Grass); });
    const g = s.groups[0]!;
    orInto(g.discoveries, maskOf(Discovery.fire));
    g.herd = 20;
    g.wood = 0;
    const range = homeRange(s, g);
    const src = woodSource(s, g, range);
    expect(src.tiles).toEqual([]);
    const other = otherFuel(s, g, range);
    expect(other).toBeCloseTo(20 * Wd.dungPerAnimal + range.length * Wd.grassPerTile, 10);
    s.month = 9;                                         // winter: 4 × 0.08 = 0.32
    burnFuel(s, g, 4, other);
    expect(hasActive(g, Discovery.fire)).toBe(true);
    expect(g.spareFuel).toBeCloseTo(other - 4 * Wd.fireWinter, 10);
    // With enough wood, the wood burns and the dung is left for the kiln.
    g.wood = 10;
    g.spareFuel = 0;
    burnFuel(s, g, 4, other);
    expect(g.wood).toBeCloseTo(10 - 4 * Wd.fireWinter, 10);
    expect(g.spareFuel).toBeCloseTo(other, 10);
    // Wood short: it all burns and dung makes up the rest.
    g.wood = 0.1;
    g.spareFuel = 0;
    burnFuel(s, g, 4, other);
    expect(g.wood).toBeCloseTo(0, 10);
    expect(g.spareFuel).toBeCloseTo(other - (4 * Wd.fireWinter - 0.1), 10);
    expect(hasActive(g, Discovery.fire)).toBe(true);
  });

  it('winter burns 0.08 a person a month; a year of fire for 10 people is 4.2 units', () => {
    const s = forestWorld();
    const g = s.groups[0]!;
    orInto(g.discoveries, maskOf(Discovery.fire));
    g.wood = 10;
    s.month = 9;                                         // winter
    burnFuel(s, g, 10);
    expect(g.wood).toBeCloseTo(10 - 0.8, 10);
    expect(fuelPerYear(10)).toBeCloseTo(10 * (3 * 0.08 + 9 * 0.02), 10);
  });
});

describe('smelting and resource use (§7.3)', () => {
  /** A band that knows a copper deposit and owns Copper Working. */
  function smelter(copper = 100): { s: SimState; g: SimState['groups'][number]; ore: number } {
    const ore = at(51, 40);
    const s = forestWorld((m) => { m.resourceType[ore] = Resource.Copper; m.resourceAmount[ore] = copper; });
    const g = s.groups[0]!;
    expect(isKnown(g, ore)).toBe(true);
    orInto(g.discoveries, maskOf(Discovery.fire, Discovery.copperWorking)); // no Pottery, so no kiln wood
    return { s, g, ore };
  }

  it('smelting needs both ore and wood: 1 unit of ore + 4 wood → 1 metal (then 10% wear)', () => {
    const { s, g, ore } = smelter();
    g.wood = 0;
    useResources(s, g);
    expect(hasActive(g, Discovery.copperWorking)).toBe(false);
    expect(g.inactiveWhy[Discovery.copperWorking]).toBe(Lack.Wood);
    expect(s.resourceAmount[ore]).toBe(100);             // nothing taken
    g.wood = 10;
    useResources(s, g);
    expect(hasActive(g, Discovery.copperWorking)).toBe(true);
    expect(s.resourceAmount[ore]).toBe(99);              // ceil(4 / 50) = 1 unit
    expect(g.wood).toBeCloseTo(10 - CONFIG.future.smelt.copperWood, 10);
    expect(g.metal).toBeCloseTo(1 * (1 - CONFIG.future.smelt.metalWearPerYear), 10);
  });

  it('without ore the metal stock covers the year; once it is used up the discovery stops (no ore)', () => {
    const { s, g, ore } = smelter();
    s.resourceAmount[ore] = 0;
    s.resourceType[ore] = Resource.None;
    g.wood = 100;
    g.metal = 1.5;
    useResources(s, g);
    expect(hasActive(g, Discovery.copperWorking)).toBe(true);
    expect(g.metal).toBeCloseTo(0.5 * 0.9, 10);
    useResources(s, g);
    expect(hasActive(g, Discovery.copperWorking)).toBe(false);
    expect(g.inactiveWhy[Discovery.copperWorking]).toBe(Lack.Resource);
    expect(g.wood).toBe(100);                            // no smelting, no charcoal burned
  });

  it('Pottery needs kiln wood: 0.5 per 10 people a year', () => {
    const clay = at(49, 40);
    const s = forestWorld((m) => { m.resourceType[clay] = Resource.Clay; m.resourceAmount[clay] = 50; }, 20);
    const g = s.groups[0]!;
    orInto(g.discoveries, maskOf(Discovery.fire, Discovery.pottery));
    g.wood = 0.9;
    useResources(s, g);
    expect(hasActive(g, Discovery.pottery)).toBe(false);  // needs 1.0
    g.wood = 1.0;
    useResources(s, g);
    expect(hasActive(g, Discovery.pottery)).toBe(true);
    expect(g.wood).toBeCloseTo(0, 10);
  });

  it('a kiln can be fired with this year\'s spare dung and straw; it does not keep to the next year', () => {
    const clay = at(49, 40);
    const s = forestWorld((m) => { m.resourceType[clay] = Resource.Clay; m.resourceAmount[clay] = 50; }, 20);
    const g = s.groups[0]!;
    orInto(g.discoveries, maskOf(Discovery.fire, Discovery.pottery));
    g.wood = 0.4;
    g.spareFuel = 0.6;                                   // kiln needs 1.0
    useResources(s, g);
    expect(hasActive(g, Discovery.pottery)).toBe(true);
    expect(g.wood).toBeCloseTo(0, 10);
    expect(g.spareFuel).toBe(0);
  });

  it('Stone Tools use a tenth as much stone: ceil(population / 500) a year (DECISIONS 17.4)', () => {
    const stone = at(49, 40);
    const s = forestWorld((m) => { m.resourceType[stone] = Resource.Stone; m.resourceAmount[stone] = 100; }, 40);
    const g = s.groups[0]!;
    orInto(g.discoveries, maskOf(Discovery.stoneTools));
    useResources(s, g);
    expect(s.resourceAmount[stone]).toBe(100 - Math.ceil(40 / CONFIG.discoveries.stoneUsePer));   // 1
  });

  it('clay beside water comes back with silt; clay away from water stays dug out (DECISIONS 17.5)', () => {
    const bank = at(49, 40), dry = at(30, 30);
    const s = forestWorld((m) => {
      m.ground[at(48, 40)] = Ground.Water;
      for (const i of [bank, dry]) { m.resourceType[i] = Resource.Clay; m.resourceAmount[i] = 12; }
    });
    for (const i of [bank, dry]) { s.resourceAmount[i] = 0; s.resourceType[i] = Resource.None; s.quarry[i] = 1; }
    renewClay(s);
    expect(s.resourceType[bank]).toBe(Resource.Clay);
    expect(s.resourceAmount[bank]).toBe(CONFIG.discoveries.clayRenewPerYear);
    expect(s.quarry[bank]).toBe(0);
    expect(s.resourceAmount[dry]).toBe(0);
    for (let y = 0; y < 5; y++) renewClay(s);
    expect(s.resourceAmount[bank]).toBe(12);              // never more than was painted
  });

  it('Bronze Working needs Tin found and Copper Working; Tin and Salt are found on known tiles', () => {
    const tin = at(52, 41), salt = at(48, 39);
    const s = forestWorld((m) => {
      m.resourceType[tin] = Resource.Tin; m.resourceAmount[tin] = 100;
      m.resourceType[salt] = Resource.Salt; m.resourceAmount[salt] = 100;
    });
    const g = s.groups[0]!;
    invalidateFound(s);
    const found = foundMask(s, g);
    expect(found & Found.Tin).toBe(Found.Tin);
    expect(found & Found.Salt).toBe(Found.Salt);
    const bronze = DISCOVERIES[Discovery.bronzeWorking]!;
    expect(bronze.era).toBe(5);
    expect(canDiscover(g, bronze, found, 4)).toBe(false);    // needs Copper Working
    orInto(g.discoveries, maskOf(Discovery.fire, Discovery.stoneTools, Discovery.pottery, Discovery.copperWorking));
    expect(canDiscover(g, bronze, found, 4)).toBe(true);
    expect(canDiscover(g, bronze, found & ~Found.Tin, 4)).toBe(false);
  });
});

describe('rafts, boats, carts and buildings (§7.2)', () => {
  it('a raft needs 10 wood: inactive (water closed) until it is built', () => {
    const s = forestWorld();
    const g = s.groups[0]!;
    g.wood = 4;
    gainDiscovery(s, g, Discovery.raft, 'Oak discovered Raft');
    expect(hasActive(g, Discovery.raft)).toBe(false);
    expect(s.log.some((e) => e.type === 'ranOut' && e.text.includes('raft'))).toBe(true);
    g.wood = 12;
    yearlyVessels(s, g);
    expect(hasActive(g, Discovery.raft)).toBe(true);
    expect(g.wood).toBe(2);
    yearlyVessels(s, g);
    expect(g.wood).toBe(2);                              // built once
  });

  it('a boat wears out after 30 years and is rebuilt from 30 wood', () => {
    const s = forestWorld();
    const g = s.groups[0]!;
    orInto(g.discoveries, maskOf(Discovery.raft));
    addBit(g.built, Discovery.raft);
    g.wood = 30;
    gainDiscovery(s, g, Discovery.boat, 'Oak discovered Boat');
    expect(hasActive(g, Discovery.boat)).toBe(true);
    expect(g.wood).toBe(0);
    s.year += 29;
    yearlyVessels(s, g);
    expect(hasActive(g, Discovery.boat)).toBe(true);
    s.year += 1;
    yearlyVessels(s, g);
    expect(hasActive(g, Discovery.boat)).toBe(false);    // worn out, no wood to rebuild
    g.wood = 31;
    yearlyVessels(s, g);
    expect(hasActive(g, Discovery.boat)).toBe(true);
    expect(g.wood).toBe(1);
  });

  it('a hut costs 6 wood; a mud-brick house 4 wood and 20 clay', () => {
    const clay = at(49, 41);
    const s = forestWorld((m) => { m.resourceType[clay] = Resource.Clay; m.resourceAmount[clay] = 30; });
    const g = s.groups[0]!;
    g.wood = 5;
    expect(payBuilding(s, g, false)).toBe(false);
    expect(g.wood).toBe(5);
    g.wood = 10;
    expect(payBuilding(s, g, false)).toBe(true);
    expect(g.wood).toBe(4);
    expect(payBuilding(s, g, true)).toBe(true);
    expect(g.wood).toBe(0);
    expect(s.resourceAmount[clay]).toBe(10);
    g.wood = 4;
    expect(payBuilding(s, g, true)).toBe(false);          // only 10 clay left
    expect(g.wood).toBe(4);
  });

  it('wood need adds fuel, smelting and missing vessels to the shelter wood', () => {
    const s = forestWorld();
    const g = s.groups[0]!;
    orInto(g.discoveries, maskOf(Discovery.fire, Discovery.raft, Discovery.copperWorking));
    // 50 people: fuel 21, copper ceil(50/50) × 4 = 4, raft 10, plus 12 for two huts.
    expect(woodNeedYear(g, 50, 12)).toBeCloseTo(21 + 4 + 10 + 12, 10);
  });
});

describe('wood in a living band (§7.4)', () => {
  it('a band with Fire cuts wood, keeps its fire burning and thins the forest around home', () => {
    const s = forestWorld(undefined, 12);
    const g = s.groups[0]!;
    orInto(g.discoveries, maskOf(Discovery.fire));
    const range = homeRange(s, g);
    let cutMonths = 0, fireMonths = 0, maxLost = 0;
    for (let m = 0; m < 5 * 12; m++) {
      runTicks(s, 1);
      const band = s.groups[0];
      if (!band) break;
      for (const slot of band.members) if (s.persons.action[slot] === Action.CutWood) { cutMonths++; break; }
      if (hasActive(band, Discovery.fire)) fireMonths++;
      let lost = 0;
      for (const i of range) lost += 255 - s.plantDensity[i]!;
      maxLost = Math.max(maxLost, lost);
    }
    expect(cutMonths).toBeGreaterThan(0);
    expect(fireMonths).toBeGreaterThanOrEqual(5 * 12 - 3);
    // Thinned between yearly regrowth (+26 density a year at rain 50 heals a small band's cutting).
    expect(maxLost).toBeGreaterThan(0);
  });

  it('a desert band with Fire and no forest cannot keep its fire going', () => {
    const s = forestWorld((m) => {
      m.plantType.fill(Plant.None);
      m.plantDensity.fill(0);
      m.ground.fill(Ground.Desert);
      m.rain.fill(8);
    });
    const g = s.groups[0]!;
    orInto(g.discoveries, maskOf(Discovery.fire));
    runTicks(s, 2);
    expect(hasActive(s.groups[0]!, Discovery.fire)).toBe(false);
  });

  it('keyframes and the hash keep wood, metal and what is built', () => {
    const s = forestWorld();
    const g = s.groups[0]!;
    g.wood = 12.5;
    g.metal = 3;
    g.built = maskOf(Discovery.raft);
    g.inactiveWhy[Discovery.fire] = Lack.Wood;
    const c = cloneState(s);
    expect(hashState(c)).toBe(hashState(s));
    const cg = c.groups[0]!;
    expect([cg.wood, cg.metal, idsOf(cg.built), cg.inactiveWhy[Discovery.fire]]).toEqual([12.5, 3, [Discovery.raft], Lack.Wood]);
    cg.inactiveWhy[Discovery.fire] = 0;
    expect(g.inactiveWhy[Discovery.fire]).toBe(Lack.Wood); // deep copy
    cg.wood = 12;
    expect(hashState(c)).not.toBe(hashState(s));
  });
});
