// G1 towns that grow (pixel-ages-towns-plan.md, DECISIONS 22.x) on tiny worlds, in seconds.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createMap } from '../src/editor/mapState';
import { Mode, Plant, SizeClass } from '../src/shared/ids';
import { Discovery, addBit } from '../src/shared/discoveries';
import type { FounderPerson } from '../src/shared/types';
import { createState, type Group, type SimState } from '../src/sim/state';
import { population } from '../src/sim/people/groups';
import { modeSwitches, toVillage } from '../src/sim/people/village';
import { computeSignals, homeRange } from '../src/sim/people/food';
import { checkMigration, bestSite } from '../src/sim/people/movement';
import { fieldRadius } from '../src/sim/people/farming';
import { sizeClassOf, yearlyMarkets } from '../src/sim/society/markets';
import { runOf } from './fixtures';

const T = CONFIG.towns;

function adults(n: number): FounderPerson[] {
  return Array.from({ length: n }, (_, k) => ({ sex: (k % 2) as 0 | 1, age: 20 + (k % 20), intelligence: 100, cooperation: 50, strength: 50 }));
}

function world(homes: Array<{ x: number; y: number; people: FounderPerson[] }>): SimState {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  const run = runOf(m, 4);
  run.founders = homes.map((h, k) => ({ id: k + 1, name: `G${k + 1}`, colorIndex: k, x: h.x, y: h.y, people: h.people }));
  return createState(run);
}
const G = (s: SimState, id: number): Group => s.groups.find((g) => g.id === id)!;

/** A settled farming village with a field next to home. */
function farmers(s: SimState, g: Group): Group {
  if (g.members.length >= CONFIG.people.groupSize.toVillageAt) toVillage(s, g);
  addBit(g.discoveries, Discovery.farming);
  g.farmTiles = [(g.homeY + 1) * s.width + g.homeX];
  return g;
}

/** A town of 300 with craftspeople and two villages 8–10 km away. */
function marketWorld(): { s: SimState; town: Group; a: Group; b: Group } {
  const s = world([{ x: 40, y: 40, people: adults(300) }, { x: 48, y: 40, people: adults(40) }, { x: 40, y: 50, people: adults(40) }]);
  const town = farmers(s, G(s, 1));
  town.specialists = 0.05;
  return { s, town, a: farmers(s, G(s, 2)), b: farmers(s, G(s, 3)) };
}

describe('markets (plan §4.1–4.2)', () => {
  it('a market opens with 300+ people and 2 villages in reach, and closes 10 years after they are gone', () => {
    const { s, town, b } = marketWorld();
    yearlyMarkets(s);
    expect(town.market).toBe(true);
    expect(s.log.some((e) => e.type === 'town' && e.text === 'G1 holds a market: 2 villages come to trade' && !e.minor)).toBe(true);
    b.farmTiles = [];                                           // only one settled village left …
    for (let y = 1; y < T.marketHoldYears; y++) { s.year = y; yearlyMarkets(s); }
    expect(town.market).toBe(true);                             // … but a bad decade is not the end at once
    s.year = T.marketHoldYears;
    yearlyMarkets(s);
    expect(town.market).toBe(false);
  });

  it('villages sell part of their food above keepMonths to the nearest market, and get crafts back', () => {
    const { s, town, a } = marketWorld();
    a.need = 5;
    a.foodStock = 100;                                          // keeps 4 months (20), sells half of 80
    town.foodStock = 0;
    yearlyMarkets(s);
    expect(a.marketId).toBe(town.id);
    expect(a.exports).toBeCloseTo((100 - 5 * T.keepMonths) * T.sellShare);
    expect(a.foodStock).toBeCloseTo(100 - (100 - 5 * T.keepMonths) * T.sellShare);
    expect(town.foodStock).toBeGreaterThanOrEqual(a.exports);
    expect(town.imports).toBeCloseTo(town.foodStock);
    expect(a.craftBonus).toBeCloseTo(T.craftMax * Math.max(T.craftFloor, 0.05 / T.specialistFull));
  });

  it('no market across a war', () => {
    const { s, town, a } = marketWorld();
    s.relations = [{ a: 1, b: 2, kind: 'war', sinceYear: 0, reviewYear: 99, pa: 0, pb: 0, warPopA: 0, warPopB: 0, warDeadA: 0, warDeadB: 0, truceUntil: 0 }];
    town.market = true;
    yearlyMarkets(s);
    expect(a.marketId).toBe(-1);
  });
});

describe('towns grow on their hinterland (plan §4.3)', () => {
  it('food bought and received counts in a town\'s supply, so it is less crowded', () => {
    const { s, town } = marketWorld();
    const range = homeRange(s, town);
    computeSignals(s, town, range, 300);
    const before = town.sustainable;
    town.imports = 1200;
    computeSignals(s, town, range, 300);
    expect(town.sustainable).toBeCloseTo(before + 100);
  });

  it('a split from a market\'s village looks for a site inside the market\'s reach first', () => {
    const { s, town } = marketWorld();
    for (let i = 0; i < s.width * s.height; i++) s.groups[1]!.known[i >> 3] = 255;
    const site = bestSite(s, s.groups[1]!, s.groups.map((g) => [g.homeX, g.homeY] as const), 12, [town.homeX, town.homeY, T.marketReach]);
    expect(site).toBeGreaterThanOrEqual(0);
    const x = site % s.width, y = Math.floor(site / s.width);
    expect((x - town.homeX) ** 2 + (y - town.homeY) ** 2).toBeLessThanOrEqual(T.marketReach ** 2);
  });

  it('a big town farms farther out: +1 tile per 500 people, up to 10', () => {
    const { town } = marketWorld();
    expect(fieldRadius(town)).toBe(CONFIG.people.range.forage);
    town.village!.counts[2] = town.village!.counts[2]! + 1000;
    expect(fieldRadius(town)).toBe(CONFIG.people.range.forage + 2);
    town.village!.counts[2] = town.village!.counts[2]! + 10000;
    expect(fieldRadius(town)).toBe(T.fieldRangeMax);
  });
});

describe('settled life (plan §4.4)', () => {
  it('a village with fields stays a village down to 50 people; without fields it is a band under 100', () => {
    const s = world([{ x: 40, y: 40, people: adults(160) }, { x: 60, y: 40, people: adults(160) }]);
    const [a, b] = [farmers(s, G(s, 1)), G(s, 2)];
    toVillage(s, b);
    for (const g of [a, b]) g.village!.counts[2] = g.village!.counts[2]! - (population(g) - 99);
    modeSwitches(s);
    expect(a.mode).toBe(Mode.Village);
    expect(b.mode).toBe(Mode.Band);
  });

  it('a settled village with fields and houses moves house only after 36 hungry months', () => {
    const s = world([{ x: 40, y: 40, people: adults(40) }]);
    const g = farmers(s, G(s, 1));
    g.huts = 4;
    g.hunger = 95;
    for (let m = 0; m < T.settledMigrateMonths - 1; m++) expect(checkMigration(s, g)).toBe(false);
    expect(g.hungryMonths).toBe(T.settledMigrateMonths - 1);
  });
});

describe('size classes (plan §4.5)', () => {
  it('hamlet, village, town (500+ or a market), city (2,000+ with City); a margin before stepping down', () => {
    const { s, town } = marketWorld();
    const add = (n: number): void => { town.village!.counts[2] = town.village!.counts[2]! + n; };
    expect(sizeClassOf(town)).toBe(SizeClass.Village);
    town.market = true;
    expect(sizeClassOf(town)).toBe(SizeClass.Town);
    town.market = false;
    add(200);                                                   // 500
    yearlyMarkets(s);
    expect(town.sizeClass).toBe(SizeClass.Town);
    expect(s.log.some((e) => e.text === 'G1 grew into a town (500 people)')).toBe(true);
    add(-60);                                                   // 440: above 80% of 500, still a town
    expect(sizeClassOf(town)).toBe(SizeClass.Town);
    add(1600);                                                  // 2,040, but no City yet
    expect(sizeClassOf(town)).toBe(SizeClass.Town);
    addBit(town.discoveries, Discovery.city);
    expect(sizeClassOf(town)).toBe(SizeClass.City);
  });
});
