// Game speeds, Phase 1 (docs/pixel-ages-speeds-plan.md §2, §3): the table, the pace it gives
// the worker loop, and that only the loop ever reads the speed.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { DEFAULT_SPEED, SPEEDS, speedForKey, speedRow, speedTitle, stepSpeed, ticksPerSecondAt, yearsPerSecondAt } from '../src/shared/speeds';

const SIM = import.meta.glob('../src/sim/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('speed table', () => {
  it('has the six buttons, slowest first (Drift added by the owner)', () => {
    expect(SPEEDS).toEqual([0, 1, 2, 4, 6, 8]);
  });

  it('gives the plan\'s years and months per second', () => {
    expect(SPEEDS.map(yearsPerSecondAt)).toEqual([1 / 6, 0.5, 1, 3, 5, 8]);
    expect(SPEEDS.map(ticksPerSecondAt)).toEqual([2, 6, 12, 36, 60, 96]);
  });

  it('starts at 2×, the old 1× pace, and keeps the old 8× pace at the top', () => {
    expect(DEFAULT_SPEED).toBe(2);
    expect(ticksPerSecondAt(DEFAULT_SPEED)).toBe(CONFIG.time.ticksPerYear);
    expect(ticksPerSecondAt(8)).toBe(8 * CONFIG.time.ticksPerYear);
  });

  it('falls back to the default speed for an unknown value', () => {
    expect(speedRow(3).speed).toBe(DEFAULT_SPEED);
  });

  it('writes tooltips with the real rate', () => {
    expect(speedTitle(1)).toBe('0.5 years per second');
    expect(speedTitle(2)).toBe('1 year per second');
    expect(speedTitle(0)).toBe('2 months per second');
  });
});

describe('buttons and keys (Phase 2)', () => {
  it('names every speed shortly, so six buttons fit the bar', () => {
    for (const v of SPEEDS) expect(speedRow(v).label.length).toBeLessThanOrEqual(5);
    expect(new Set(SPEEDS.map((v) => speedRow(v).label)).size).toBe(SPEEDS.length);
  });

  it('keys 0 1 2 4 6 8 pick their speed; other keys pick none', () => {
    for (const v of SPEEDS) expect(speedForKey(String(v))).toBe(v);
    for (const k of ['3', '5', '7', '9', 'a', ' ']) expect(speedForKey(k)).toBeNull();
  });

  it('− and + step one speed and stop at the ends', () => {
    expect(stepSpeed(2, 1)).toBe(4);
    expect(stepSpeed(6, -1)).toBe(4);
    expect(stepSpeed(8, 1)).toBe(8);
    expect(stepSpeed(1, -1)).toBe(0);
    expect(stepSpeed(0, -1)).toBe(0);
  });
});

describe('speed never reaches the simulation (§16)', () => {
  it('only the worker loop reads the speed table', () => {
    for (const [path, src] of Object.entries(SIM)) {
      if (path.endsWith('/worker.ts')) continue;
      expect(/shared\/speeds|time\.speeds|ticksPerSecondAt/.test(src), path).toBe(false);
    }
  });
});
