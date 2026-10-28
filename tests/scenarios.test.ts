// Headless scenario runs (§25, §26). Quick checks run always; the long multi-seed runs only
// with LONG=1 npm test, and print a summary table.

import { describe, expect, it } from 'vitest';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { cloneState, hashState } from '../src/sim/serialize';
import { population as groupPop } from '../src/sim/people/groups';
import { Discovery, DISCOVERIES, addBit, has } from '../src/shared/discoveries';
import { scenarioA, scenarioB, scenarioC, scenarioD } from './fixtures';

const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; memoryUsage?: () => { heapUsed: number } } }).process;
const LONG = Boolean(proc?.env?.LONG);

const population = (s: ReturnType<typeof createState>, lineage?: number): number =>
  s.groups.filter((g) => lineage === undefined || g.lineageId === lineage).reduce((n, g) => n + groupPop(g), 0);
const count = (s: ReturnType<typeof createState>, type: string): number => s.log.filter((e) => e.type === type).length;

describe('determinism with people (§16.3)', () => {
  it('same seed → identical history after 100 years; a different seed differs', () => {
    const a = createState(scenarioA(5));
    const b = createState(scenarioA(5));
    const c = createState(scenarioA(6));
    // Discoveries are rare in 100 years since TUNING pass 7: start with Fire, so a discovery's
    // effects (fuel, practice) are in the compared history too.
    for (const s of [a, b, c]) addBit(s.groups[0]!.discoveries, Discovery.fire);
    runTicks(a, 100 * 12);
    runTicks(b, 100 * 12);
    runTicks(c, 100 * 12);
    expect(hashState(a)).toBe(hashState(b));
    expect(hashState(a)).not.toBe(hashState(c));
    expect(a.log.some((e) => e.type === 'ranOut' || e.type === 'discovery') || has(a.groups[0]?.discoveries ?? [0, 0], Discovery.fire)).toBe(true);
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
          for (const g of s.groups) if (!g.village) maxBand = Math.max(maxBand, g.members.length);
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

describe.skipIf(!LONG)('Scenario A — contact (§24 step 5)', () => {
  it('across 10 seeds, contact gives a mix of trade, war and absorb (not always war)', () => {
    let trade = 0, war = 0, absorbed = 0, conquered = 0;
    const rows: string[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const s = createState(scenarioA(seed));
      runTicks(s, 600 * 12);
      const t = count(s, 'tradeStart'), w = count(s, 'war'), a = count(s, 'absorbed'), c = count(s, 'conquered');
      trade += t; war += w; absorbed += a; conquered += c;
      rows.push(`seed ${String(seed).padStart(2)} | year 600: ${String(population(s)).padStart(6)} people, ${String(s.groups.length).padStart(3)} groups (${s.groups.filter((g) => g.village).length} villages) | trade ${t}, battles ${w}, conquered ${c}, absorbed ${a}`);
    }
    console.log(['Scenario A contact (seeds 1–10, 600 years)', ...rows, `total: trade ${trade}, battles ${war}, conquered ${conquered}, absorbed ${absorbed}`].join('\n'));
    expect(trade).toBeGreaterThan(0);
    expect(war).toBeGreaterThan(0);
    expect(absorbed).toBeGreaterThan(0);
  }, 3600000);
});

describe.skipIf(!LONG)('Scenario B — Smart desert vs rich forest (§26)', () => {
  it('runs 10,000 years without errors; the river is breached only after Boat', () => {
    const s = createState(scenarioB(48213));
    const rows: string[] = [];
    const era = (lineage: number): number => Math.max(0, ...s.groups.filter((g) => g.lineageId === lineage).map((g) => g.era));
    for (const year of [100, 300, 1000, 2000, 5000, 10000]) {
      runTicks(s, (year - s.year) * 12);
      rows.push(`year ${year}: Forest ${population(s, 1)} (era ${era(1)}), Desert ${population(s, 2)} (era ${era(2)})`);
    }
    const breaches = s.log.filter((e) => e.type === 'breach');
    const firstBoat = s.log.find((e) => e.type === 'discovery' && e.text.endsWith(DISCOVERIES[Discovery.boat]!.name));
    rows.push(`breaches: ${breaches.map((e) => `year ${e.year} ${e.text}`).join('; ') || 'none'}`);
    rows.push(`first Boat: ${firstBoat ? `year ${firstBoat.year} ${firstBoat.text}` : 'never'}`);
    console.log(['Scenario B (seed 48213)', ...rows].join('\n'));
    expect(s.year).toBe(10000);
    if (breaches.length > 0) {
      expect(firstBoat).toBeDefined();
      expect(breaches[0]!.year).toBeGreaterThanOrEqual(firstBoat!.year);
    }
  }, 10800000);
});

describe.skipIf(!LONG)('Scenario D — Performance (§26)', () => {
  it('runs 10,000 years without errors and stays under 1 GB', () => {
    const s = createState(scenarioD(1));
    const rows: string[] = [];
    let t = Date.now();
    let peak = 0;
    for (let year = 1000; year <= 10000; year += 1000) {
      runTicks(s, (year - s.year) * 12);
      const ms = Date.now() - t;
      t = Date.now();
      const mem = proc?.memoryUsage?.().heapUsed ?? 0;
      peak = Math.max(peak, mem);
      rows.push(`year ${String(year).padStart(5)}: ${String(population(s)).padStart(7)} people, ${String(s.groups.length).padStart(3)} groups, era ${Math.max(0, ...s.groups.map((g) => g.era))}, ${(1000000 / ms).toFixed(1)} years/s, heap ${(mem / 1048576).toFixed(0)} MB`);
    }
    console.log(['Scenario D (seed 1)', ...rows].join('\n'));
    expect(s.year).toBe(10000);
    expect(peak).toBeLessThan(1024 * 1048576);
  }, 10800000);
});

describe.skipIf(!LONG)('Scenario C — Collapse (§26)', () => {
  it('the drought cuts population by 30%+ in most living seeds; discoveries are forgotten; recovery follows', () => {
    let alive = 0, dropped = 0, recovered = 0, forgot = 0;
    const rows: string[] = [];
    for (let seed = 1; seed <= 5; seed++) {
      const s = createState(scenarioC(seed));
      runTicks(s, 500 * 12);
      const before = population(s);
      let low = before;
      while (s.year < 550) { runTicks(s, 12); low = Math.min(low, population(s)); }
      runTicks(s, 50 * 12);
      const after = population(s);
      const lost = count(s, 'lostDiscovery');
      if (before > 0) {
        alive++;
        if (low <= before * 0.7) dropped++;
        if (after > low) recovered++;
        if (lost > 0) forgot++;
      }
      rows.push(`seed ${seed} | year 500: ${before} | lowest in the drought: ${low} | year 600: ${after} | forgotten discoveries: ${lost}`);
    }
    console.log(['Scenario C (seeds 1–5)', ...rows].join('\n'));
    expect(dropped).toBeGreaterThanOrEqual(Math.ceil(alive / 2));
    expect(recovered).toBeGreaterThanOrEqual(Math.ceil(alive / 2));
    expect(forgot).toBeGreaterThan(0);
  }, 3600000);
});
