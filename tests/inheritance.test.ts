import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createRng } from '../src/shared/rng';
import { actualFromChildhood, inheritTrait } from '../src/sim/people/inheritance';

const T = CONFIG.people.traits;

describe('inheritance (§11.3)', () => {
  it('10,000 children: mean = parents\' average, spread = mendelSd', () => {
    const rng = createRng(77);
    for (const [trait, mom, dad] of [[T.intelligence, 110, 130], [T.cooperation, 40, 60], [T.strength, 70, 50]] as const) {
      let sum = 0, sq = 0;
      const N = 10000;
      for (let k = 0; k < N; k++) {
        const c = inheritTrait(rng, mom, dad, trait);
        sum += c; sq += c * c;
      }
      const mean = sum / N;
      const sd = Math.sqrt(sq / N - mean * mean);
      expect(mean).toBeCloseTo((mom + dad) / 2, 0);
      expect(sd).toBeGreaterThan(trait.mendelSd * 0.95);
      expect(sd).toBeLessThan(trait.mendelSd * 1.05);
    }
  });

  it('children stay inside the hard range', () => {
    const rng = createRng(3);
    for (let k = 0; k < 2000; k++) {
      const c = inheritTrait(rng, 178, 180, T.intelligence);
      expect(c).toBeLessThanOrEqual(T.intelligence.max);
    }
  });
});

describe('environment (§11.4)', () => {
  const pot = { int: 120, coop: 50, str: 60 };

  it('a well-fed, calm childhood keeps potential (plus learning and a cooperation bonus)', () => {
    const a = actualFromChildhood(pot, 1, 0, 0, false);
    expect(a).toEqual({ int: 120, coop: 55, str: 60 });
    expect(actualFromChildhood(pot, 1, 0, 3, true).int).toBeCloseTo(120 + 4.5 + 3);
    expect(actualFromChildhood(pot, 1, 0, 6, true).int).toBe(130); // learning capped at +10
  });

  it('a starving childhood lowers intelligence and strength, capped', () => {
    const a = actualFromChildhood(pot, 0.6, 0, 0, false);
    expect(a.int).toBeCloseTo(120 - 40 * 0.3);
    expect(a.str).toBeCloseTo(60 - 30 * 0.3);
    const worst = actualFromChildhood(pot, 0, 0, 0, false);
    expect(worst.int).toBe(100);   // −20 at most
    expect(worst.str).toBe(35);    // −25 at most
  });

  it('hard months lower cooperation', () => {
    expect(actualFromChildhood(pot, 1, 0.5, 0, false).coop).toBeCloseTo(50 - 7.5);
  });
});
