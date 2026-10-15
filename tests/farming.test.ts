import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Ground, Plant, Species } from '../src/shared/ids';
import { Discovery } from '../src/shared/discoveries';
import { createState } from '../src/sim/state';
import { revealAround } from '../src/sim/people/explore';
import { rangeTiles } from '../src/sim/people/food';
import {
  ensureFarmTiles, farmCandidates, farmWork, farmlandIdle, herdCapacity, herdWork,
} from '../src/sim/people/farming';
import { at, fourPeople, runOf } from './fixtures';

const bits = (...ids: number[]): number => ids.reduce((m, d) => m | (1 << d), 0);

/** Grassland: rain 20 west of x = 50, rain 40 from x = 50; a pond at (44, 40) in the desert-ish west. */
function farmWorld(): ReturnType<typeof createState> {
  const m = createMap();
  for (let y = 0; y < 90; y++) {
    for (let x = 0; x < 160; x++) {
      const i = at(x, y);
      m.rain[i] = x < 50 ? 20 : 40;
      if (x < 46) m.ground[i] = Ground.Desert;
    }
  }
  m.ground[at(44, 40)] = Ground.Water;
  const run = runOf(m);
  run.founders = [{ id: 1, name: 'Farmers', colorIndex: 0, x: 50, y: 40, people: fourPeople() }];
  const s = createState(run);
  revealAround(s, s.groups[0]!, 50, 40, 6);
  return s;
}

describe('farm tiles (§11.5)', () => {
  it('only known Grassland with rain ≥ 30 in range; none without Farming', () => {
    const s = farmWorld();
    const g = s.groups[0]!;
    const range = rangeTiles(s, g);
    expect(farmCandidates(s, g, range)).toEqual([]);
    g.discoveries = bits(Discovery.farming);
    const c = farmCandidates(s, g, range);
    expect(c.length).toBeGreaterThan(0);
    for (const i of c) {
      expect(s.ground[i]).toBe(Ground.Grassland);
      expect(s.rainNow[i]).toBeGreaterThanOrEqual(30);
      expect(i).not.toBe(at(50, 40)); // the camp stays open
    }
  });

  it('Irrigation adds dry land within 2 tiles of water', () => {
    const s = farmWorld();
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.farming, Discovery.irrigation);
    const c = farmCandidates(s, g, rangeTiles(s, g));
    expect(c).toContain(at(46, 40));               // grassland, rain 20, 2 tiles from the pond
    expect(c).toContain(at(45, 40));               // desert next to the pond
    expect(c).not.toContain(at(47, 43));           // dry and too far from water
  });

  it('ceil(farmers / 10) fields, wettest first; 10 farmers per field; winter yields nothing', () => {
    const s = farmWorld();
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.farming);
    ensureFarmTiles(s, g, 15, farmCandidates(s, g, rangeTiles(s, g)));
    expect(g.farmTiles).toHaveLength(2);
    for (const i of g.farmTiles) expect(s.plantType[i]).toBe(Plant.Farmland);
    // Fewer farmers never gives fields up.
    ensureFarmTiles(s, g, 3, farmCandidates(s, g, rangeTiles(s, g)));
    expect(g.farmTiles).toHaveLength(2);

    const slot = g.members[0]!;                    // intelligence 100: yield ×1
    s.month = 4;                                   // summer
    g.foodStock = 0;
    expect(farmWork(s, g, slot, 9)).toBe(g.farmTiles[0]);
    expect(farmWork(s, g, slot, 10)).toBe(g.farmTiles[1]);
    expect(g.foodStock).toBeCloseTo(2 * 2.0 * 0.93 * (40 / 60), 5);
    s.month = 10;                                  // winter
    g.foodStock = 0;
    farmWork(s, g, slot, 0);
    expect(g.foodStock).toBe(0);
  });

  it('a field nobody farms for 3 years turns back into grass; a farmed one stays', () => {
    const s = farmWorld();
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.farming);
    ensureFarmTiles(s, g, 20, farmCandidates(s, g, rangeTiles(s, g)));
    const [used, idle] = g.farmTiles as [number, number];
    for (let y = 0; y < 3; y++) {
      s.farmedThisYear[used] = 1;
      farmlandIdle(s);
    }
    expect(s.plantType[used]).toBe(Plant.Farmland);
    expect(s.plantType[idle]).toBe(Plant.Grass);
    expect(s.plantDensity[idle]).toBe(128);
    expect(g.farmTiles).toEqual([used]);
  });
});

describe('herding (§11.5)', () => {
  it('herders catch wild animals up to capacity and tend up to 20 each', () => {
    const s = farmWorld();
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.taming);
    const range = rangeTiles(s, g);
    const wild = at(52, 40);
    s.animal[Species.Herd][wild] = 0.5;
    const cap = herdCapacity(s, g, range);
    expect(cap).toBeCloseTo(5 * range.length * (40 / 60), 5); // no plants: every range tile grazes
    const hm = { capacity: cap, tended: 0 };
    g.foodStock = 0;
    expect(herdWork(s, g, g.members[0]!, range, hm)).toBe(wild);
    expect(g.herd).toBeCloseTo(2);                            // min(2, 0.5 × 10)
    expect(s.animal[Species.Herd][wild]).toBeCloseTo(0.3);    // 2 / 10 taken
    expect(g.foodStock).toBeCloseTo(2 * 0.08);
    // A full herd catches nothing more.
    const hm2 = { capacity: g.herd, tended: 0 };
    herdWork(s, g, g.members[0]!, range, hm2);
    expect(g.herd).toBeCloseTo(2);
  });
});
