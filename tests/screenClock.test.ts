// Speeds plan Phase 3 (docs/pixel-ages-speeds-plan.md): the screen clock runs on between the
// worker's frames, stays in line with the simulation, snaps on a jump, and makes the season
// colour flow with no monthly steps.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { clockRate, ScreenClock } from '../src/render/screenClock';
import { easeWeights, seasonWeights } from '../src/render/season';
import { SPEEDS, ticksPerSecondAt } from '../src/shared/speeds';

const FRAME_MS = 1000 / 60;   // a 60 fps screen
const SC = CONFIG.render.screenClock;
const LEAD_MONTHS = SC.leadMonths;

describe('screen clock', () => {
  it('runs on at the speed between frames, but never past the lead', () => {
    const c = new ScreenClock();
    c.sync(120, 6, true);                     // Crawl: 6 months a second
    expect(c.advance(1000 / 12)).toBeCloseTo(120.5, 6);
    expect(c.advance(1000)).toBe(120 + LEAD_MONTHS);   // no new frame: waits at the lead
  });

  it('at the fast speeds, the room grows with the months a frame brings', () => {
    const fly = new ScreenClock();
    fly.sync(120, 96, true);
    fly.sync(134, 96, false);                 // a busy map at Fly: 14 months a frame
    expect(fly.advance(1000)).toBeCloseTo(134 + 14 * SC.leadSteps, 6);
    const hitch = new ScreenClock();
    hitch.sync(120, 96, true);
    hitch.sync(220, 96, false);               // 100 months at once: a hitch, snaps
    expect(hitch.t).toBe(220);
    expect(hitch.advance(1000)).toBeCloseTo(220 + 0.096 * SC.maxGapMs * SC.leadSteps, 6);
  });

  it('keeps the pace of the speed, or the real pace when the computer falls behind', () => {
    expect(clockRate(96, 0)).toBe(96);        // no measure yet
    expect(clockRate(96, 5)).toBe(60);        // a late-game world at Fly runs 5 years/s
    expect(clockRate(6, 0.52)).toBe(6);       // never faster than the speed
  });

  it('catches up smoothly when a little behind, snaps when far behind', () => {
    const c = new ScreenClock();
    c.sync(10, 6, true);
    c.advance(1000 / 12);                     // 10.5
    c.sync(11, 6, false);                     // the frame came early: half a month behind
    expect(c.t).toBe(10.5);
    expect(c.advance(1000 / 24)).toBeCloseTo(10.5 + 0.25 * SC.catchUp, 6);
    c.sync(16, 6, false);                     // far behind (a hitch): snap
    expect(c.t).toBe(16);
  });

  it('is set to the month while paused (Step), and never moves backward', () => {
    const c = new ScreenClock();
    c.sync(0, 0, true);
    c.sync(1, 0, false);                      // Step
    expect(c.t).toBe(1);
    c.sync(3, 6, true);
    c.advance(100);
    const t = c.t;
    c.sync(3, 6, false);                      // the same month again: stay where the screen is
    expect(c.t).toBe(t);
    c.sync(3, 0, false);                      // paused: the lead shrinks, but the clock does not go back
    expect(c.advance(500)).toBe(t);
  });

  it('snaps on a jump in time, and when time went back', () => {
    const c = new ScreenClock();
    c.sync(5000, 12, true);
    c.advance(40);
    c.sync(240, 12, true);                    // timeline: year 20
    expect(c.t).toBe(240);
    c.sync(5000, 12, false);
    c.sync(100, 12, false);                   // time went back without the jump flag
    expect(c.t).toBe(100);
  });

  it('stands still while paused', () => {
    const c = new ScreenClock();
    c.sync(37, 0, true);
    expect(c.advance(5000)).toBe(37);
    expect(c.monthOfYear).toBe(1);
  });

  it('gives the same season weights as before at a whole month', () => {
    const c = new ScreenClock();
    for (let m = 0; m < 12; m++) {
      c.sync(7 * 12 + m, 6, true);
      expect(Array.from(seasonWeights(c.monthOfYear + 0.5))).toEqual(Array.from(seasonWeights(m + 0.5)));
    }
  });
});

/**
 * Plays `years` of frames from the worker at `speed` (frames come late by a few ms, as setTimeout
 * does) to a 60 fps screen, and returns the eased spring weight and the change of all four weights
 * on each screen frame after the first year. `clock` false: the old month-by-month target.
 */
function play(speed: number, years: number, clock: boolean): { spring: number[]; change: number[] } {
  const tps = ticksPerSecondAt(speed);
  const c = new ScreenClock();
  const now = new Float64Array(seasonWeights(0.5));
  const target = new Float64Array(4);
  const spring: number[] = [];
  const change: number[] = [];
  let sim = 0;
  let nextFrame = 0;
  c.sync(0, tps, true);
  let month = 0;
  const end = years * 1000;
  for (let ms = 0, k = 0; ms < end; ms += FRAME_MS, k++) {
    while (nextFrame <= ms) {
      // The worker sends at most maxFramesPerSecond frames, each carrying the months since the last.
      const gap = Math.max(1000 / tps, 1000 / CONFIG.time.maxFramesPerSecond);
      sim = Math.round((nextFrame / 1000) * tps);
      c.sync(sim, tps, false);
      month = sim % 12;
      nextFrame += gap + ((k % 3) - 1) * 4;   // ±4 ms of jitter
    }
    if (clock) { c.advance(FRAME_MS); seasonWeights(c.monthOfYear + 0.5, target); }
    else seasonWeights(month + 0.5, target);
    const before = Array.from(now);
    easeWeights(now, target, FRAME_MS);
    if (ms >= 1000 * Math.ceil(12 / tps)) {
      spring.push(now[0]!);
      change.push(before.reduce((a, b, s) => a + Math.abs(now[s]! - b), 0));
    }
  }
  return { spring, change };
}

const pulse = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[sorted.length - 1]! / sorted[Math.floor(sorted.length / 2)]!;
};

describe('seasons flow with the clock', () => {
  // Largest change in one screen frame ÷ the usual one. Measured: Crawl 1.26 with the clock, 2.06
  // with the old month steps; Walk 1.33 and 1.49. (At the fast speeds the swing is small and this
  // ratio is the season curve's own ups and downs, not steps.)
  it('at Crawl and Walk the colour changes evenly, where the old month steps pulsed', () => {
    expect(pulse(play(1, 6, true).change)).toBeLessThan(1.35);
    expect(pulse(play(1, 6, false).change)).toBeGreaterThan(1.8);
    expect(pulse(play(2, 6, true).change)).toBeLessThan(pulse(play(2, 6, false).change));
  });

  // Drift (2 months a second): frames come every 500 ms, so month steps would pulse hard (6.1);
  // the clock makes it the evenest of all (1.01, measured).
  it('at Drift the colour changes evenly too', () => {
    expect(pulse(play(0, 12, true).change)).toBeLessThan(1.2);
    expect(pulse(play(0, 12, false).change)).toBeGreaterThan(3);
  });

  it('the slow speeds show most of the year; the fast ones blur instead of flashing', () => {
    const share = (v: number): number => { const s = play(v, Math.max(6, 2 * Math.ceil(12 / ticksPerSecondAt(v))), true).spring; return Math.max(...s) - Math.min(...s); };
    const shares = SPEEDS.map(share);
    expect(shares[0]).toBeGreaterThan(0.9);      // Drift (~0.93)
    expect(shares[1]).toBeGreaterThan(0.75);     // Crawl (~0.80)
    expect(shares[2]).toBeGreaterThan(0.55);     // Walk (~0.63)
    expect(shares[5]).toBeLessThan(0.2);         // Fly (~0.12): a gentle drift, not 8 flashes a second
    for (let k = 1; k < shares.length; k++) expect(shares[k]).toBeLessThan(shares[k - 1]!);
  });
});
