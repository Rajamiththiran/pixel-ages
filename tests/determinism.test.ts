import { describe, expect, it } from 'vitest';
import { createState } from '../src/sim/state';
import { runTicks, tick } from '../src/sim/tick';
import { cloneState, hashState } from '../src/sim/serialize';
import { computeDriftMult } from '../src/sim/world/climate';
import { livingWorld } from './fixtures';

const YEAR = 12;

describe('determinism (§16.3)', () => {
  it('same setup + same seed → identical state after 300 years', () => {
    const a = createState(livingWorld(48213, 'slow'));
    const b = createState(livingWorld(48213, 'slow'));
    const t0 = Date.now();
    runTicks(a, 300 * YEAR);
    const ms = Date.now() - t0;
    runTicks(b, 300 * YEAR);
    expect(hashState(a)).toBe(hashState(b));
    console.log(`300 years of the living world: ${ms} ms (${(ms / 300).toFixed(2)} ms per year)`);
  });

  it('a different seed with drift on gives a different result', () => {
    const a = createState(livingWorld(1, 'slow'));
    const b = createState(livingWorld(2, 'slow'));
    runTicks(a, 300 * YEAR);
    runTicks(b, 300 * YEAR);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('300 years straight = 100 years, keyframe, restore, 200 more', () => {
    const straight = createState(livingWorld(7, 'strong'));
    runTicks(straight, 300 * YEAR);

    const first = createState(livingWorld(7, 'strong'));
    runTicks(first, 100 * YEAR);
    const keyframe = cloneState(first);
    const restored = cloneState(keyframe);
    runTicks(restored, 200 * YEAR);
    expect(hashState(restored)).toBe(hashState(straight));
  });

  it('batch size never changes results (1 tick at a time vs 96 at a time)', () => {
    const a = createState(livingWorld(5, 'slow'));
    const b = createState(livingWorld(5, 'slow'));
    for (let k = 0; k < 100 * YEAR; k++) tick(a);
    for (let k = 0; k < 100 * YEAR; k += 96) runTicks(b, Math.min(96, 100 * YEAR - k));
    expect(hashState(a)).toBe(hashState(b));
  });

  it('a copy is independent of the original', () => {
    const a = createState(livingWorld(3, 'slow'));
    runTicks(a, 10 * YEAR);
    const before = hashState(a);
    const c = cloneState(a);
    runTicks(c, 10 * YEAR);
    expect(hashState(a)).toBe(before);
  });
});

describe('climate drift (§10.1)', () => {
  it('drift off never changes rain', () => {
    const s = createState(livingWorld(1, 'off'));
    const rain = s.rainNow.slice();
    runTicks(s, 200 * YEAR);
    expect(s.driftMult.every((v) => v === 1)).toBe(true);
    expect(s.rainNow).toEqual(rain);
  });

  it('strong drift moves rain slowly and stays within 0.3–1.7', () => {
    const s = createState(livingWorld(9, 'strong'));
    runTicks(s, 400 * YEAR);
    let min = Infinity, max = -Infinity;
    for (const v of s.driftMult) { min = Math.min(min, v); max = Math.max(max, v); }
    expect(min).toBeGreaterThanOrEqual(0.3);
    expect(max).toBeLessThanOrEqual(1.7);
    expect(max - min).toBeGreaterThan(0.05);
    // Interpolation is smooth: neighbouring tiles differ only slightly.
    computeDriftMult(s);
    let jump = 0;
    for (let i = 1; i < s.driftMult.length; i++) {
      if (i % s.width !== 0) jump = Math.max(jump, Math.abs(s.driftMult[i]! - s.driftMult[i - 1]!));
    }
    expect(jump).toBeLessThan(0.05);
  });
});
