// Speeds plan Phase 4 (docs/pixel-ages-speeds-plan.md): the visuals follow the speed — walkers'
// pace, and how much of the season shows (full, softened, held).

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { easeWeights, seasonTarget, seasonWeights } from '../src/render/season';
import { clockPace, holdsDay, seasonLook, seasonShow, walkerPace, walkPace } from '../src/render/speedLook';
import { SPEEDS, speedRow, ticksPerSecondAt } from '../src/shared/speeds';

const R = CONFIG.render;
const HELD = CONFIG.render.f8.season.heldWeights;
const playing = (speed: number) => ({ speed, playing: true, timelapse: false, yearsPerSecond: 0 });

describe('season look by speed (owner §7.3: full at Drift, 1× and 2×, softened at 4×, held at 6× and 8×)', () => {
  it('the table says full, softened and held', () => {
    expect(SPEEDS.map((v) => speedRow(v).seasonShow)).toEqual([1, 1, 1, 1, 0.5, 0, 0]);
  });

  it('seasons Phase 3b: the materials show every season at Watch, Drift and Crawl, two looks at Walk, one held look above (S3, S4)', () => {
    expect(SPEEDS.map((v) => seasonLook(playing(v)))).toEqual(['full', 'full', 'full', 'two', 'held', 'held', 'held']);
    expect(seasonLook({ speed: 8, playing: false, timelapse: false, yearsPerSecond: 0 })).toBe('full');   // paused
    expect(seasonLook({ speed: -1, playing: true, timelapse: true, yearsPerSecond: 0 })).toBe('held');    // time-lapse
  });

  it('seasons Phase 3b: only Watch holds the day, and only while time runs (S2)', () => {
    expect(SPEEDS.map((v) => holdsDay(playing(v)))).toEqual([true, false, false, false, false, false, false]);
    expect(holdsDay({ speed: -1, playing: false, timelapse: false, yearsPerSecond: 0 })).toBe(false);
  });

  it('full shows the turning year exactly as before', () => {
    for (let m = 0; m < 12; m += 0.25) expect(Array.from(seasonTarget(m, 1))).toEqual(Array.from(seasonWeights(m + 0.5)));
  });

  it('held is one look all year: summer-normal, no winter', () => {
    for (let m = 0; m < 12; m += 0.5) expect(Array.from(seasonTarget(m, 0))).toEqual([...HELD]);
    expect(HELD[3]).toBe(0);
    expect(HELD.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('softened lies halfway, and the weights always sum to 1', () => {
    for (let m = 0; m < 12; m += 0.5) {
      const w = seasonTarget(m, 0.5);
      const full = seasonWeights(m + 0.5);
      for (let s = 0; s < 4; s++) expect(w[s]).toBeCloseTo((full[s]! + HELD[s]!) / 2, 9);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });

  it('paused shows the full season; a time-lapse holds the look', () => {
    expect(seasonShow({ speed: 8, playing: false, timelapse: false, yearsPerSecond: 0 })).toBe(1);
    expect(seasonShow({ speed: 2, playing: false, timelapse: true, yearsPerSecond: 0 })).toBe(0);
    expect(SPEEDS.map((v) => seasonShow(playing(v)))).toEqual([1, 1, 1, 1, 0.5, 0, 0]);
  });

  it('switching to Fly blends into the held look instead of popping', () => {
    const now = new Float64Array(seasonTarget(10, 1));   // deep winter at Walk
    const target = seasonTarget(10, 0);
    let biggest = 0;
    for (let k = 0; k < 60; k++) {
      const before = Array.from(now);
      easeWeights(now, target, 1000 / 60);
      biggest = Math.max(biggest, ...before.map((b, s) => Math.abs(now[s]! - b)));
    }
    expect(biggest).toBeLessThan(0.15);                   // at most a small change per screen frame
    for (let s = 0; s < 4; s++) expect(now[s]).toBeCloseTo(target[s]!, 2);   // settled within a second
  });
});

describe('walker pace by speed', () => {
  it('Walk keeps the old 1× pace and Fly the old 8× pace', () => {
    const walk = walkPace(ticksPerSecondAt(2));
    expect(walk.basePx).toBeCloseTo(R.walkSpeedPx, 9);
    expect(walk.arriveSec).toBeCloseTo(0.25, 9);          // the old arriveMs
    expect(walkPace(ticksPerSecondAt(8)).basePx).toBeCloseTo(R.walkSpeedPx * 4, 6);   // the old fastWalkMult
  });

  it('slower speeds walk slower and take longer; faster ones hurry', () => {
    const paces = SPEEDS.map((v) => walkPace(ticksPerSecondAt(v)));
    for (let k = 1; k < paces.length; k++) {
      expect(paces[k]!.basePx).toBeGreaterThan(paces[k - 1]!.basePx);
      expect(paces[k]!.arriveSec).toBeLessThan(paces[k - 1]!.arriveSec);
    }
    expect(paces[2]!.arriveSec).toBeCloseTo(0.5, 9);      // Crawl: a season is half a second
    expect(paces[1]!.arriveSec).toBeCloseTo(1.5, 9);      // Drift: a season is 1.5 seconds
    expect(paces[0]!.arriveSec).toBeCloseTo(6, 9);        // Watch: a season is 6 seconds
  });

  it('follows the real pace while playing, the chosen speed while paused, the top speed in a time-lapse', () => {
    expect(walkerPace({ speed: 8, playing: true, timelapse: false, yearsPerSecond: 5 })).toBe(60);
    expect(walkerPace({ speed: 1, playing: false, timelapse: false, yearsPerSecond: 0 })).toBe(6);
    expect(walkerPace({ speed: 1, playing: true, timelapse: true, yearsPerSecond: 0 })).toBe(96);
  });

  it('the screen clock runs only while time runs at a set speed', () => {
    expect(clockPace(playing(1))).toBe(6);
    expect(clockPace({ speed: 1, playing: false, timelapse: false, yearsPerSecond: 0 })).toBe(0);
    expect(clockPace({ speed: 1, playing: true, timelapse: true, yearsPerSecond: 0 })).toBe(0);
  });
});
