import { describe, expect, it } from 'vitest';
import { chance, createRng, float, gaussian, int, nextU32, stochasticRound } from '../src/shared/rng';

describe('rng (§16.1)', () => {
  it('gives a fixed sequence for seed 1 (snapshot)', () => {
    const s = createRng(1);
    const got = Array.from({ length: 8 }, () => nextU32(s));
    expect(got).toEqual([1130556604, 2591592147, 3014952990, 960850752, 2734082507, 3058966613, 1454546984, 2701238177]);
  });

  it('same seed → same sequence, different seed → different sequence', () => {
    const a = createRng(48213), b = createRng(48213), c = createRng(48214);
    const seq = (s: Uint32Array): number[] => Array.from({ length: 20 }, () => nextU32(s));
    const sa = seq(a);
    expect(seq(b)).toEqual(sa);
    expect(seq(c)).not.toEqual(sa);
  });

  it('a copied state continues the same sequence', () => {
    const a = createRng(7);
    for (let k = 0; k < 100; k++) nextU32(a);
    const b = a.slice();
    expect(Array.from({ length: 10 }, () => nextU32(b))).toEqual(Array.from({ length: 10 }, () => nextU32(a)));
  });

  it('float is in [0, 1) with mean ≈ 0.5; int stays in range; chance matches p', () => {
    const s = createRng(3);
    let sum = 0, hits = 0;
    const N = 100000;
    for (let k = 0; k < N; k++) {
      const f = float(s);
      expect(f >= 0 && f < 1).toBe(true);
      sum += f;
      const n = int(s, 6);
      expect(n >= 0 && n < 6 && Number.isInteger(n)).toBe(true);
      if (chance(s, 0.3)) hits++;
    }
    expect(sum / N).toBeCloseTo(0.5, 2);
    expect(hits / N).toBeCloseTo(0.3, 2);
  });

  it('gaussian has mean ≈ 0 and sd ≈ 1', () => {
    const s = createRng(11);
    const N = 100000;
    let sum = 0, sq = 0;
    for (let k = 0; k < N; k++) { const g = gaussian(s); sum += g; sq += g * g; }
    const mean = sum / N;
    expect(mean).toBeCloseTo(0, 1);
    expect(Math.sqrt(sq / N - mean * mean)).toBeCloseTo(1, 1);
  });

  it('stochasticRound keeps the expected value', () => {
    const s = createRng(5);
    const N = 100000;
    let sum = 0;
    for (let k = 0; k < N; k++) {
      const r = stochasticRound(s, 2.3);
      expect(r === 2 || r === 3).toBe(true);
      sum += r;
    }
    expect(sum / N).toBeCloseTo(2.3, 2);
  });
});
