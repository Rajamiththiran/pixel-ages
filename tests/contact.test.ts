import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Plant, Resource, WallType } from '../src/shared/ids';
import { Discovery, has, maskOf } from '../src/shared/discoveries';
import type { FounderPerson } from '../src/shared/types';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { cloneState, hashState } from '../src/sim/serialize';
import { population } from '../src/sim/people/groups';
import { absorb, battle, conquer, contactPairs, decisionScores, forceOf, trade } from '../src/sim/society/contact';
import { at, runOf, scenarioD } from './fixtures';

const bits = maskOf;

function adults(n: number, strength = 50, intelligence = 100): FounderPerson[] {
  return Array.from({ length: n }, (_, k) => ({ sex: (k % 2) as 0 | 1, age: 20 + (k % 20), intelligence, cooperation: 50, strength }));
}

/** Two groups 10 tiles apart on forest land (stone near both), a river wall far to the east. */
function neighbours(a: FounderPerson[], b: FounderPerson[], bx = 60): ReturnType<typeof createState> {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  for (let y = 0; y < 90; y++) { m.wall[at(120, y)] = WallType.River; m.wall[at(121, y)] = WallType.River; }
  m.resourceType[at(51, 40)] = Resource.Stone; m.resourceAmount[at(51, 40)] = 200;
  m.resourceType[at(bx + 1, 40)] = Resource.Stone; m.resourceAmount[at(bx + 1, 40)] = 200;
  const run = runOf(m, 9);
  run.founders = [
    { id: 1, name: 'North', colorIndex: 0, x: 50, y: 40, people: a },
    { id: 2, name: 'South', colorIndex: 1, x: bx, y: 40, people: b },
  ];
  return createState(run);
}

describe('contact detection (§14.1)', () => {
  it('homes within 12 tiles and connected are in contact; a wall keeps them apart', () => {
    expect(contactPairs(neighbours(adults(4), adults(4), 62)).map(([a, b]) => [a.id, b.id])).toEqual([[1, 2]]);
    expect(contactPairs(neighbours(adults(4), adults(4), 63))).toEqual([]);   // 13 tiles
    expect(contactPairs(neighbours(adults(4), adults(4), 125))).toEqual([]);  // across the river
  });
});

describe('deciding (§14.2–14.3)', () => {
  it('matches the §14.3 example: War 75, Trade 31, Absorb 69.45', () => {
    const sc = decisionScores({
      coopA: 30, coopB: 40, sameLineage: false, pA: 0.8, pB: 0.5, hA: 80, hB: 60,
      powerA: 120 * 1.1 * 1.3, powerB: 40 * 1.0, discoveriesDiffer: true,
    });
    expect(sc.war).toBeCloseTo(75);
    expect(sc.trade).toBeCloseTo(31);
    expect(sc.absorb!).toBeCloseTo(30 + 5 * (171.6 / 40) + 0.3 * 60);
    expect(sc.coexist).toBe(35);
  });

  it('absorb only when one side is at least 3× stronger', () => {
    const base = { coopA: 50, coopB: 50, sameLineage: true, pA: 0.2, pB: 0.2, hA: 10, hB: 10, discoveriesDiffer: false };
    expect(decisionScores({ ...base, powerA: 29.9, powerB: 10 }).absorb).toBeNull();
    expect(decisionScores({ ...base, powerA: 30, powerB: 10 }).absorb).not.toBeNull();
    expect(decisionScores({ ...base, powerA: 10, powerB: 30 }).absorb).not.toBeNull();
  });
});

describe('battles (§14.4)', () => {
  it('deaths follow the formula: loser (0.10 + 0.20 × share), winner (0.05 + 0.10 × (1 − share)) of their adults', () => {
    for (let seed = 0; seed < 5; seed++) {
      const s = neighbours(adults(40, 60), adults(20, 40));
      s.rng[0] = (s.rng[0]! + seed * 7919) >>> 0;
      const [a, b] = s.groups as [ReturnType<typeof createState>['groups'][0], ReturnType<typeof createState>['groups'][0]];
      const fa = forceOf(s, a);
      const fb = forceOf(s, b);
      expect(fa.adults).toBe(40);
      const r = battle(s, a, b);
      const [fw, fl] = r.winner === a ? [fa, fb] : [fb, fa];
      expect(r.effW / fw.power).toBeGreaterThanOrEqual(0.8);
      expect(r.effW / fw.power).toBeLessThanOrEqual(1.2);
      expect(r.share).toBeCloseTo(r.effW / (r.effW + r.effL), 10);
      const lose = (0.10 + 0.20 * r.share) * fl.adults;
      const win = (0.05 + 0.10 * (1 - r.share)) * fw.adults;
      expect([Math.floor(lose), Math.ceil(lose)]).toContain(r.loserDeaths);
      expect([Math.floor(win), Math.ceil(win)]).toContain(r.winnerDeaths);
      expect(population(r.loser)).toBe(fl.adults - r.loserDeaths);
      expect(s.log.at(-1)!.type).toBe('war');
    }
  });

  it('conquest: half the survivors are captured, the rest are driven 12+ tiles away and stay themselves', () => {
    const s = neighbours(adults(40, 60), adults(20, 40));
    const [a, b] = s.groups as [ReturnType<typeof createState>['groups'][0], ReturnType<typeof createState>['groups'][0]];
    b.discoveries = bits(Discovery.stoneTools);
    expect(conquer(s, a, b)).toBe(true);
    expect(population(a)).toBe(50);
    expect(s.groups).toHaveLength(2);                // DECISIONS 20.11: no new group, South moves
    expect(population(b)).toBe(10);
    expect(b.name).toBe('South');
    const dx = b.homeX - a.homeX;
    const dy = b.homeY - a.homeY;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(144);
    expect(s.log.some((e) => e.type === 'conquered' && /^North drove South from its land \(10 captured; 10 fled \d+ km\)$/.test(e.text))).toBe(true);
  });

  it('conquest: survivors too few to carry on scatter, and the group is gone', () => {
    const s = neighbours(adults(40, 60), adults(2, 40));
    const [a, b] = s.groups as [ReturnType<typeof createState>['groups'][0], ReturnType<typeof createState>['groups'][0]];
    expect(conquer(s, a, b)).toBe(false);
    expect(s.groups.find((g) => g.id === b.id)).toBeUndefined();
    expect(s.log.some((e) => e.text === 'North conquered South (1 captured, the rest scattered)')).toBe(true);
  });
});

describe('trade and absorb (§14.5–14.6)', () => {
  it('trade teaches discoveries, but only ones whose requirements the learner has found', () => {
    const s = neighbours(adults(10, 50, 160), adults(10, 50, 160));
    const [a, b] = s.groups as [ReturnType<typeof createState>['groups'][0], ReturnType<typeof createState>['groups'][0]];
    a.discoveries = bits(Discovery.fire, Discovery.stoneTools, Discovery.taming);
    for (let y = 0; y < 200 && !has(b.discoveries, Discovery.stoneTools); y++) trade(s, a, b);
    expect(has(b.discoveries, Discovery.fire)).toBe(true);        // forest is known
    expect(has(b.discoveries, Discovery.stoneTools)).toBe(true);  // stone next to its home
    expect(has(b.discoveries, Discovery.taming)).toBe(false);     // no herd animals anywhere
    expect(s.log.some((e) => e.text === 'South learned Fire from North')).toBe(true);
    expect(a.trading && b.trading).toBe(true);
  });

  it('absorb: everyone, food, herd and knowledge move to the stronger group', () => {
    const s = neighbours(adults(30), adults(6));
    const [a, b] = s.groups as [ReturnType<typeof createState>['groups'][0], ReturnType<typeof createState>['groups'][0]];
    b.foodStock = 10;
    a.foodStock = 5;
    absorb(s, a, b);
    expect(population(a)).toBe(36);
    expect(a.foodStock).toBe(15);
    expect(s.groups).toHaveLength(1);
    expect(s.log.some((e) => e.type === 'absorbed' && e.text === 'North absorbed South (6 people)')).toBe(true);
    expect(s.log.some((e) => e.type === 'lineageExtinct')).toBe(true);
  });
});

describe('determinism with everything on (§16.3)', () => {
  it('Scenario D: same seed → same history; a keyframe at year 150 replays to year 300 exactly', () => {
    const a = createState(scenarioD(2));
    runTicks(a, 300 * 12);
    const b = createState(scenarioD(2));
    runTicks(b, 150 * 12);
    const kf = cloneState(b);
    runTicks(b, 150 * 12);
    const c = cloneState(kf);
    runTicks(c, 150 * 12);
    expect(hashState(b)).toBe(hashState(a));
    expect(hashState(c)).toBe(hashState(a));
  }, 600000);
});
