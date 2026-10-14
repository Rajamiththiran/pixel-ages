import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createRng, chance } from '../src/shared/rng';
import { baseDeathRate, deaths } from '../src/sim/people/lifecycle';
import { createMap } from '../src/editor/mapState';
import { createState } from '../src/sim/state';
import { runOf } from './fixtures';
import { allocPerson, createPool, freePerson } from '../src/sim/people/persons';

describe('death table (§11.9)', () => {
  it('100,000 simulated people follow the forager table within ±10%', () => {
    // Annual death chance per age band, from the table: 0–4 6%, 5–14 1%, 15–49 1.5%, 50–59 3%, 60–69 6%, 70+ 15%.
    const bands = [[0, 5, 0.06], [5, 15, 0.01], [15, 50, 0.015], [50, 60, 0.03], [60, 70, 0.06], [70, 100, 0.15]] as const;
    const rng = createRng(1234);
    const exposure = new Array(bands.length).fill(0);
    const deaths = new Array(bands.length).fill(0);
    for (let k = 0; k < 100000; k++) {
      for (let m = 0; m < 1200; m++) {
        const band = bands.findIndex(([lo, hi]) => m >= lo * 12 && m < hi * 12);
        exposure[band]++;
        if (chance(rng, baseDeathRate(m))) { deaths[band]++; break; }
      }
    }
    bands.forEach(([, , annual], b) => {
      const measured = 1 - (1 - deaths[b] / exposure[b]) ** 12;
      expect(measured).toBeGreaterThan(annual * 0.9);
      expect(measured).toBeLessThan(annual * 1.1);
    });
  });

  it('everyone dies at the maximum age (100)', () => {
    const m = createMap();
    const run = runOf(m);
    run.founders = [{ id: 1, name: 'Old', colorIndex: 0, x: 50, y: 50, people: [
      { sex: 0, age: CONFIG.people.ages.maxAge, intelligence: 100, cooperation: 50, strength: 50 },
      { sex: 1, age: 30, intelligence: 100, cooperation: 50, strength: 50 },
    ] }];
    const s = createState(run);
    const g = s.groups[0]!;
    const oldest = g.members[0]!;
    const dead = deaths(s, g);
    expect(dead).toContain(oldest);
  });
});

describe('PersonPool (§7.4)', () => {
  it('reuses slots but never reuses ids, and grows past its capacity', () => {
    const p = createPool(2);
    const a = allocPerson(p);
    const b = allocPerson(p);
    const c = allocPerson(p); // grows
    expect(p.capacity).toBe(4);
    expect([p.id[a], p.id[b], p.id[c]]).toEqual([1, 2, 3]);
    freePerson(p, b);
    const d = allocPerson(p);
    expect(d).toBe(b);              // slot reused
    expect(p.id[d]).toBe(4);        // new id
    expect(p.slotOf.get(2)).toBeUndefined();
    expect(p.slotOf.get(4)).toBe(d);
  });

  it('freeing a person leaves their partner single', () => {
    const p = createPool();
    const a = allocPerson(p);
    const b = allocPerson(p);
    p.partnerId[a] = p.id[b]!;
    p.partnerId[b] = p.id[a]!;
    freePerson(p, a);
    expect(p.partnerId[b]).toBe(-1);
  });
});
