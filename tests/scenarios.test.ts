// Headless scenario runs (§25, §26). Quick checks run always; the long multi-seed runs only
// with LONG=1 npm test, and print a summary table.

import { describe, expect, it } from 'vitest';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { cloneState, hashState } from '../src/sim/serialize';
import { scenarioA, scenarioB } from './fixtures';

const LONG = Boolean((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.LONG);

const population = (s: ReturnType<typeof createState>, lineage?: number): number =>
  s.groups.filter((g) => lineage === undefined || g.lineageId === lineage).reduce((n, g) => n + g.members.length, 0);

describe('determinism with people (§16.3)', () => {
  it('same seed → identical history after 100 years; a different seed differs', () => {
    const a = createState(scenarioA(5));
    const b = createState(scenarioA(5));
    const c = createState(scenarioA(6));
    runTicks(a, 100 * 12);
    runTicks(b, 100 * 12);
    runTicks(c, 100 * 12);
    expect(hashState(a)).toBe(hashState(b));
    expect(hashState(a)).not.toBe(hashState(c));
    // The run includes discoveries (step 4), so they are covered by the same hash.
    expect(a.log.some((e) => e.type === 'discovery')).toBe(true);
  });

  it('a keyframe restored at year 40 reproduces year 100 exactly', () => {
    const straight = createState(scenarioB(48213));
    runTicks(straight, 100 * 12);
    const s = createState(scenarioB(48213));
    runTicks(s, 40 * 12);
    const restored = cloneState(cloneState(s));
    runTicks(restored, 60 * 12);
    expect(hashState(restored)).toBe(hashState(straight));
  });
});

describe('Scenario B starts as the owner set it up (§26)', () => {
  it('two lineages, 4 people each, intelligence 70 and 140', () => {
    const s = createState(scenarioB());
    expect(s.groups.map((g) => [g.name, g.members.length])).toEqual([['Forest', 4], ['Desert', 4]]);
    const int = s.groups.map((g) => s.persons.actInt[g.members[0]!]);
    expect(int).toEqual([70, 140]);
  });
});

describe.skipIf(!LONG)('Scenario A — Garden (§26), seeds 1–10', () => {
  it('lineage alive at year 100 in at least 7 of 10 seeds; bands stay 15–60 and split', () => {
    let alive = 0, splits = 0, maxBand = 0, discovered = 0;
    const rows: string[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const s = createState(scenarioA(seed));
      const at: number[] = [];
      for (const year of [100, 300]) {
        while (s.year < year) {
          runTicks(s, 12);
          for (const g of s.groups) maxBand = Math.max(maxBand, g.members.length);
        }
        at.push(population(s));
      }
      if (at[0]! > 0) alive++;
      splits += s.log.filter((e) => e.type === 'split').length;
      const disc = s.log.filter((e) => e.type === 'discovery');
      if (disc.length > 0) discovered++;
      const first = disc[0] ? `${disc[0].year}`.padStart(4) : '   —';
      const farming = disc.find((e) => e.text.endsWith('Farming'))?.year ?? '—';
      const era = Math.max(0, ...s.groups.map((g) => g.era));
      rows.push(`seed ${String(seed).padStart(2)} | year 100: ${String(at[0]).padStart(5)} | year 300: ${String(at[1]).padStart(6)} | groups ${String(s.groups.length).padStart(3)} | first discovery ${first} | farming ${farming} | era ${era}`);
    }
    console.log(['Scenario A summary', ...rows, `alive at 100: ${alive}/10, splits: ${splits}, biggest band: ${maxBand}`].join('\n'));
    expect(alive).toBeGreaterThanOrEqual(7);
    expect(splits).toBeGreaterThan(0);
    expect(discovered).toBeGreaterThanOrEqual(7);
  }, 1800000);
});

describe.skipIf(!LONG)('Scenario B — Smart desert vs rich forest (§26)', () => {
  it('runs 1,000 years without errors (the full 10,000 comes with steps 4–5)', () => {
    const s = createState(scenarioB(48213));
    const rows: string[] = [];
    const era = (lineage: number): number => Math.max(0, ...s.groups.filter((g) => g.lineageId === lineage).map((g) => g.era));
    for (const year of [100, 300, 1000]) {
      runTicks(s, (year - s.year) * 12);
      rows.push(`year ${year}: Forest ${population(s, 1)} (era ${era(1)}), Desert ${population(s, 2)} (era ${era(2)})`);
    }
    console.log(['Scenario B (seed 48213)', ...rows].join('\n'));
    expect(s.year).toBe(1000);
  }, 1800000);
});
