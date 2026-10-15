import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createMap } from '../src/editor/mapState';
import { Mode, Plant } from '../src/shared/ids';
import type { FounderPerson } from '../src/shared/types';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { cloneState, hashState } from '../src/sim/serialize';
import { countMembers, population, traitAverages } from '../src/sim/people/groups';
import { modeSwitches, shareLabour, toBand, toVillage, yearlySample } from '../src/sim/people/village';
import { runOf, scenarioD } from './fixtures';

/** n people aged 0–69 with traits spread around 100 / 50 / 50 (a fixed pattern, no randomness). */
function crowd(n: number): FounderPerson[] {
  return Array.from({ length: n }, (_, k) => ({
    sex: (k % 2) as 0 | 1,
    age: (k * 7) % 70,
    intelligence: 100 + ((k * 13) % 21) - 10,
    cooperation: 50 + ((k * 5) % 11) - 5,
    strength: 50 + ((k * 3) % 11) - 5,
  }));
}

function bigBand(n: number, seed = 4): ReturnType<typeof createState> {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  const run = runOf(m, seed);
  run.founders = [{ id: 1, name: 'Town', colorIndex: 0, x: 80, y: 45, people: crowd(n) }];
  return createState(run);
}

const within = (a: number, b: number, share: number): boolean => Math.abs(a - b) <= share * Math.abs(b);

describe('band ↔ village (§11.10)', () => {
  it('switching keeps the population and every age group exactly, both ways', () => {
    const s = bigBand(160);
    const g = s.groups[0]!;
    const counts = countMembers(s, g);
    toVillage(s, g);
    expect(g.mode).toBe(Mode.Village);
    expect(g.members).toEqual([]);
    expect(s.persons.slotOf.size).toBe(0);
    expect(population(g)).toBe(160);
    expect(countMembers(s, g)).toEqual(counts);
    expect(g.village!.sample).toHaveLength(CONFIG.people.village.sampleSize);

    toBand(s, g);
    expect(g.mode).toBe(Mode.Band);
    expect(g.members).toHaveLength(160);
    expect(countMembers(s, g)).toEqual(counts);
    expect(s.log.map((e) => e.type)).toEqual(['becameVillage', 'becameBand']);
  });

  it('trait averages survive switching: within 2% on average over 20 runs, and 5% in any one run', () => {
    // One switch draws a 64-person sample, so a single run carries sampling noise (DECISIONS 5.2).
    const keys = ['int', 'coop', 'str', 'potInt', 'potCoop', 'potStr'] as const;
    const ratio: Record<string, number[]> = {};
    for (let seed = 1; seed <= 20; seed++) {
      const s = bigBand(160, seed);
      const g = s.groups[0]!;
      const before = traitAverages(s, g);
      toVillage(s, g);
      const mid = traitAverages(s, g);
      toBand(s, g);
      const after = traitAverages(s, g);
      for (const k of keys) {
        expect(within(mid[k], before[k], 0.05)).toBe(true);
        expect(within(after[k], before[k], 0.05)).toBe(true);
        (ratio[k] ??= []).push(after[k] / before[k]);
      }
    }
    for (const k of keys) {
      const mean = ratio[k]!.reduce((a, b) => a + b, 0) / ratio[k]!.length;
      expect(Math.abs(mean - 1)).toBeLessThan(0.02);
    }
  });

  it('bands become villages at 150 and villages bands below 100 (monthly check)', () => {
    const s = bigBand(150);
    modeSwitches(s);
    const g = s.groups[0]!;
    expect(g.mode).toBe(Mode.Village);
    g.village!.counts.fill(0);
    g.village!.counts[2] = 50;
    g.village!.counts[8] = 49;            // 99 people
    modeSwitches(s);
    expect(g.mode).toBe(Mode.Band);
    expect(g.members).toHaveLength(99);
  });

  it('performance guard: too many individuals → the largest band becomes a village early', () => {
    const s = bigBand(60);
    const P = CONFIG.perf as { maxIndividuals: number };
    const keep = P.maxIndividuals;
    P.maxIndividuals = 50;
    try { modeSwitches(s); } finally { P.maxIndividuals = keep; }
    expect(s.groups[0]!.mode).toBe(Mode.Village);
    expect(s.log.at(-1)!.type).toBe('perf');
  });

  it('a village lives on: counts stay whole, the sample stays 64, years pass deterministically', () => {
    const s = bigBand(300);
    toVillage(s, s.groups[0]!);
    const copy = cloneState(s);
    runTicks(s, 30 * 12);
    runTicks(copy, 30 * 12);
    expect(hashState(s)).toBe(hashState(copy));
    for (const g of s.groups) {
      if (!g.village) continue;
      for (const c of g.village.counts) expect(c).toBeGreaterThanOrEqual(0);
      expect(g.village.sample).toHaveLength(64);
    }
    expect(s.groups.reduce((n, g) => n + population(g), 0)).toBeGreaterThan(200);
  });

  it('yearly sample update: members age a year and the sample is refilled to 64', () => {
    const s = bigBand(200);
    const g = s.groups[0]!;
    toVillage(s, g);
    const ages = g.village!.sample.map((m) => m.ageYears).reduce((a, b) => a + b, 0) / 64;
    g.village!.birthsThisYear = 0;
    yearlySample(s, g);
    expect(g.village!.sample).toHaveLength(64);
    const after = g.village!.sample.map((m) => m.ageYears).reduce((a, b) => a + b, 0) / 64;
    expect(after).toBeGreaterThan(ages + 0.3);   // deaths and copies blur it, but everyone aged a year
  });

  it('village labour: shares ∝ score², and support jobs never crowd out food work', () => {
    const L = shareLabour(new Map([[1, 30], [2, 30]]), 100);
    expect(L[1]).toBeCloseTo(50);
    expect(L[2]).toBeCloseTo(50);
    const big = shareLabour(new Map([[1, 40], [7, 500]]), 100); // Build with a huge shelter deficit
    expect(big[7]!).toBeLessThan(55);
    expect(big[1]!).toBeGreaterThan(45);
  });
});

describe('Scenario D with villages', () => {
  it('reaches villages within 400 years in at least one seed, deterministically', () => {
    let villages = 0;
    for (const seed of [1, 3]) {
      const s = createState(scenarioD(seed));
      runTicks(s, 400 * 12);
      villages += s.groups.filter((g) => g.village).length;
    }
    expect(villages).toBeGreaterThan(0);
  }, 600000);
});
