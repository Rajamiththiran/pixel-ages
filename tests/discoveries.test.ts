import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Ground, Plant, Resource } from '../src/shared/ids';
import { Discovery, DISCOVERIES, ERA_SIZES, has } from '../src/shared/discoveries';
import type { FounderPerson } from '../src/shared/types';
import { createState } from '../src/sim/state';
import {
  discoveryChance, eraOf, forgetting, gainDiscovery, loseDiscovery, rollDiscoveries, updateEra, useResources,
} from '../src/sim/progress/discoveryRules';
import { isKnown } from '../src/sim/people/explore';
import { pressure } from '../src/sim/society/walls';
import { at, runOf } from './fixtures';

const bits = (...ids: number[]): number => ids.reduce((m, d) => m | (1 << d), 0);

function people(n: number): FounderPerson[] {
  return Array.from({ length: n }, (_, k) => ({ sex: (k % 2) as 0 | 1, age: 25, intelligence: 100, cooperation: 50, strength: 50 }));
}

/** A forest world (no resources) with one band at (50, 40). `edit` changes the map first. */
function world(n: number, edit?: (m: ReturnType<typeof createMap>) => void): ReturnType<typeof createState> {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  edit?.(m);
  const run = runOf(m);
  run.founders = [{ id: 1, name: 'Test', colorIndex: 0, x: 50, y: 40, people: people(n) }];
  return createState(run);
}

describe('discovery table (§12.1)', () => {
  it('19 discoveries; era sizes 3, 3, 3, 4, 3, 3', () => {
    expect(DISCOVERIES).toHaveLength(19);
    expect(ERA_SIZES.slice(1)).toEqual([3, 3, 3, 4, 3, 3]);
    DISCOVERIES.forEach((d, k) => expect(d.id).toBe(k));
  });

  it('every discovery needs only lower ids of the same or an earlier era', () => {
    for (const d of DISCOVERIES) {
      for (const n of DISCOVERIES) {
        if (!has(d.needs, n.id)) continue;
        expect(n.id).toBeLessThan(d.id);
        expect(n.era).toBeLessThanOrEqual(d.era);
      }
    }
  });
});

describe('discovery chance (§12.3)', () => {
  it('matches the worked Pottery example: about 0.83% a year', () => {
    const p = discoveryChance(DISCOVERIES[Discovery.pottery]!, {
      avgInt: 110, population: 40, fed12: 0.8, writing: false, teachBonus: 1,
    });
    expect(p).toBeCloseTo(0.01 * 1.1 * (Math.sqrt(40) / 5) * 0.6, 10);
    expect(p).toBeCloseTo(0.0083, 4);
  });

  it('a hungry group (fed12 ≤ 0.5) invents nothing; Writing and teaching raise the chance', () => {
    const def = DISCOVERIES[Discovery.fire]!;
    const base = { avgInt: 100, population: 25, fed12: 1, writing: false, teachBonus: 1 };
    expect(discoveryChance(def, { ...base, fed12: 0.5 })).toBe(0);
    expect(discoveryChance(def, base)).toBeCloseTo(0.02);
    expect(discoveryChance(def, { ...base, writing: true, teachBonus: 1.3 })).toBeCloseTo(0.02 * 1.3 * 1.3);
  });
});

describe('eras (§12.4)', () => {
  const D = Discovery;
  it('needs all but one discovery of every era up to it', () => {
    expect(eraOf(0)).toBe(0);
    expect(eraOf(bits(D.fire))).toBe(0);
    expect(eraOf(bits(D.fire, D.stoneTools))).toBe(1);
    expect(eraOf(bits(D.fire, D.stoneTools, D.raft, D.taming))).toBe(2);
    // Era 2 discoveries without era 1 don't count.
    expect(eraOf(bits(D.fire, D.raft, D.taming, D.clothing))).toBe(0);
    // Era 4 has four discoveries: three are needed.
    const to3 = bits(D.fire, D.stoneTools, D.raft, D.taming, D.farming, D.pottery);
    expect(eraOf(to3)).toBe(3);
    expect(eraOf(to3 | bits(D.mudBrick, D.wheel))).toBe(3);
    expect(eraOf(to3 | bits(D.mudBrick, D.wheel, D.riding))).toBe(4);
  });
});

describe('discovering (§12.2–12.3)', () => {
  it('never without the found requirement: no Stone on the map → no Stone Tools', () => {
    const s = world(40);
    const g = s.groups[0]!;
    for (let y = 0; y < 3000; y++) rollDiscoveries(s, g);
    expect(has(g.discoveries, Discovery.fire)).toBe(true);        // forest is known: rolls do happen
    expect(has(g.discoveries, Discovery.stoneTools)).toBe(false);
    expect(has(g.discoveries, Discovery.spear)).toBe(false);      // needs Stone Tools
  });

  it('with a known stone deposit, Stone Tools (and then Spear) are found', () => {
    const s = world(40, (m) => { m.resourceType[at(52, 40)] = Resource.Stone; m.resourceAmount[at(52, 40)] = 100; });
    const g = s.groups[0]!;
    for (let y = 0; y < 3000; y++) rollDiscoveries(s, g);
    expect(has(g.discoveries, Discovery.stoneTools)).toBe(true);
    expect(has(g.discoveries, Discovery.spear)).toBe(true);
    expect(s.log.some((e) => e.type === 'discovery' && e.text === 'Test discovered Stone Tools')).toBe(true);
  });
});

describe('forgetting (§12.5)', () => {
  it('a band below the era limit for 10 years forgets, the era drops, and the log says so', () => {
    const s = world(4); // era 1 needs 5 people to keep its discoveries
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.fire, Discovery.stoneTools);
    updateEra(s, g);
    expect(g.era).toBe(1);
    for (let y = 0; y < 9; y++) { forgetting(s, g); updateEra(s, g); }
    expect(g.discoveries).toBe(bits(Discovery.fire, Discovery.stoneTools));
    forgetting(s, g);
    updateEra(s, g);
    expect(g.discoveries).toBe(0);
    expect(g.era).toBe(0);
    const texts = s.log.map((e) => e.text);
    expect(texts).toContain('Test forgot Fire (too few people)');
    expect(texts).toContain('Test fell back to era 0: Early people');
  });

  it('enough people resets the count', () => {
    const s = world(6);
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.fire);
    for (let y = 0; y < 30; y++) forgetting(s, g);
    expect(has(g.discoveries, Discovery.fire)).toBe(true);
  });

  it('losing a discovery takes everything built on it (cascade)', () => {
    const s = world(4);
    const g = s.groups[0]!;
    const D = Discovery;
    g.discoveries = bits(D.stoneTools, D.spear, D.clothing, D.raft, D.boat);
    loseDiscovery(s, g, D.stoneTools, 'too few people');
    expect(g.discoveries).toBe(bits(D.raft));
    expect(s.log.filter((e) => e.type === 'lostDiscovery').map((e) => e.text)).toEqual([
      'Test forgot Stone Tools (too few people)',
      'Test forgot Spear (it needs Stone Tools)',
      'Test forgot Clothing (it needs Stone Tools)',
      'Test forgot Boat (it needs Stone Tools)',
    ]);
  });
});

describe('resource use (§12.6)', () => {
  it('running out makes a discovery inactive (logged once) and adds pressure; new stone revives it', () => {
    const tile = at(51, 40);
    const s = world(4, (m) => { m.resourceType[tile] = Resource.Stone; m.resourceAmount[tile] = 1; });
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.stoneTools);
    g.hunger = 0;
    g.crowding = 0;
    useResources(s, g);                        // uses the last unit
    expect(s.resourceAmount[tile]).toBe(0);
    expect(s.resourceType[tile]).toBe(Resource.None);
    expect(g.inactive).toBe(0);
    expect(pressure(g)).toBe(0);
    useResources(s, g);                        // nothing left
    useResources(s, g);
    expect(has(g.inactive, Discovery.stoneTools)).toBe(true);
    expect(has(g.discoveries, Discovery.stoneTools)).toBe(true); // still owned (counts for eras)
    expect(s.log.filter((e) => e.type === 'ranOut')).toHaveLength(1);
    expect(pressure(g)).toBe(0.5);
    s.resourceType[tile] = Resource.Stone;
    s.resourceAmount[tile] = 10;
    useResources(s, g);
    expect(g.inactive).toBe(0);
    expect(s.resourceAmount[tile]).toBe(9);
  });

  it('uses ceil(population / 50) units a year from the nearest deposit first', () => {
    const near = at(51, 40);
    const far = at(53, 40);
    const s = world(40, (m) => {
      for (const t of [near, far]) { m.resourceType[t] = Resource.Clay; m.resourceAmount[t] = 100; }
    });
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.fire, Discovery.pottery, Discovery.farming, Discovery.mudBrick);
    useResources(s, g);                        // Pottery and Mud Brick each take 1
    expect([s.resourceAmount[near], s.resourceAmount[far]]).toEqual([98, 100]);
  });
});

describe('Raft (§11.7)', () => {
  it('opens water tiles in the frontier', () => {
    const s = world(4, (m) => {
      for (let y = 30; y < 50; y++) for (let x = 53; x < 70; x++) { m.ground[at(x, y)] = Ground.Water; m.plantType[at(x, y)] = Plant.None; }
    });
    const g = s.groups[0]!;
    const water = (i: number): boolean => s.ground[i] === Ground.Water;
    expect(isKnown(g, at(53, 40))).toBe(true);           // the shore is in sight
    expect(g.frontier.some(water)).toBe(false);
    gainDiscovery(s, g, Discovery.raft, 'Test discovered Raft');
    expect(g.frontier.some(water)).toBe(true);
    loseDiscovery(s, g, Discovery.raft, 'too few people');
    expect(g.frontier.some(water)).toBe(false);
  });
});
