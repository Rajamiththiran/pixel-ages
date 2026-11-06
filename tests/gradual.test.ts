// Speeds plan Phase 5 (docs/pixel-ages-speeds-plan.md): the yearly rain slides over a year of
// screen time, and changed tiles dissolve in Bayer steps instead of popping. Drawing only.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { RainEase } from '../src/render/rainEase';
import { dissolveTile, readTile, sameTile } from '../src/render/terrain';
import { gradualLand } from '../src/render/speedLook';
import { SPEEDS } from '../src/shared/speeds';

const G = CONFIG.render.gradual;
const TILE = CONFIG.map.tilePx;

describe('rain slides over a year', () => {
  const before = new Uint8Array([60, 60, 20, 0]);
  const after = new Uint8Array([30, 90, 20, 100]);

  it('a jump in time shows the new rain at once', () => {
    const e = new RainEase(before);
    e.set(after, 0, true);
    expect(Array.from(e.shown)).toEqual(Array.from(after));
    expect(e.update(5, 1e6)).toBe(false);
  });

  it('a yearly change slides in even steps and arrives after rainMonths', () => {
    const e = new RainEase(before);
    e.set(after, 100, false);
    expect(Array.from(e.shown)).toEqual(Array.from(before));         // nothing jumps at once
    let ms = 0;
    const seen: number[] = [];
    for (let t = 100; t <= 100 + G.rainMonths; t += 0.25) {
      ms += 1000;
      if (e.update(t, ms)) seen.push(e.shown[0]!);
    }
    expect(seen.length).toBeGreaterThanOrEqual(G.rainSteps);
    for (let k = 1; k < seen.length; k++) expect(seen[k]!).toBeLessThanOrEqual(seen[k - 1]!);   // dries steadily
    expect(Array.from(e.shown)).toEqual(Array.from(after));
  });

  it('halfway through the year it shows halfway', () => {
    const e = new RainEase(before);
    e.set(after, 0, false);
    e.update(G.rainMonths / 2, 1e6);
    expect(e.shown[0]).toBe(45);
    expect(e.shown[3]).toBe(50);
  });

  it('redraws at most every rainMinMs, except the last step', () => {
    const e = new RainEase(before);
    e.set(after, 0, false);
    expect(e.update(1, 1000)).toBe(true);
    expect(e.update(2, 1000 + G.rainMinMs / 2)).toBe(false);
    expect(e.update(G.rainMonths, 1000 + G.rainMinMs / 2)).toBe(true);   // arrives regardless
    expect(Array.from(e.shown)).toEqual(Array.from(after));
  });

  it('a new change mid-slide starts from what is shown (no jump back)', () => {
    const e = new RainEase(before);
    e.set(after, 0, false);
    e.update(G.rainMonths / 2, 1e6);
    const mid = Array.from(e.shown);
    e.set(before, G.rainMonths / 2, false);
    expect(Array.from(e.shown)).toEqual(mid);
  });
});

describe('tiles dissolve in Bayer steps', () => {
  const W = TILE * 2;   // a 2 × 1 tile image
  const tileOf = (v: number): Uint8ClampedArray => new Uint8ClampedArray(TILE * TILE * 4).fill(v);
  const newShare = (data: Uint8ClampedArray, tx: number): number => {
    const t = readTile(data, W, tx, 0);
    let n = 0;
    for (let k = 0; k < t.length; k += 4) if (t[k] === 200) n++;
    return n / (TILE * TILE);
  };

  it('starts all old, ends all new, and shows 25% more each step', () => {
    const data = new Uint8ClampedArray(W * TILE * 4);
    for (let s = 0; s <= G.fadeSteps; s++) {
      dissolveTile(data, W, 1, 0, tileOf(50), tileOf(200), s);
      expect(newShare(data, 1)).toBeCloseTo(s / G.fadeSteps, 9);
    }
    expect(newShare(data, 0)).toBe(0);   // the other tile is untouched
  });

  it('each pixel changes once', () => {
    const data = new Uint8ClampedArray(W * TILE * 4);
    let prev = readTile(data, W, 0, 0);
    const changed = new Uint8Array(TILE * TILE);
    for (let s = 0; s <= G.fadeSteps; s++) {
      dissolveTile(data, W, 0, 0, tileOf(50), tileOf(200), s);
      const now = readTile(data, W, 0, 0);
      if (s > 0) for (let p = 0; p < TILE * TILE; p++) if (now[p * 4] !== prev[p * 4]) changed[p]!++;
      prev = now;
    }
    expect(Math.max(...changed)).toBe(1);
    expect(sameTile(prev, tileOf(200))).toBe(true);
  });
});

describe('when land and rain change gradually', () => {
  it('while a season can be read; not at the speeds that hold the look, nor in a time-lapse', () => {
    const at = (speed: number, playing = true, timelapse = false) => gradualLand({ speed, playing, timelapse, yearsPerSecond: 0 });
    expect(SPEEDS.map((v) => at(v))).toEqual([true, true, true, false, false]);
    expect(at(8, false)).toBe(true);          // paused (Step) at Fly
    expect(at(2, true, true)).toBe(false);    // time-lapse
  });
});
