// Visuals that follow the speed (docs/pixel-ages-speeds-plan.md, Phase 4), in place of the old
// "8× or not" switch: how fast the screen clock runs, how fast walkers go, and how much of the
// season shows. Drawing only; the frame's fields are read, never changed.

import { CONFIG } from '../config';
import { SPEEDS, speedRow, ticksPerSecondAt } from '../shared/speeds';
import { styleOff } from './ramps';
import { clockRate } from './screenClock';

const R = CONFIG.render;
const MONTHS = CONFIG.time.ticksPerYear;
/** `?off=gradual` turns Phase 5 off, to compare (like the diorama's ?off= switches). */
const gradualOff = styleOff('gradual');

/** The parts of a frame that say how time is running. */
export interface TimeState {
  speed: number;
  playing: boolean;
  timelapse: boolean;
  yearsPerSecond: number;
}

/** The screen clock's pace in months per second: 0 unless time runs at a set speed. */
export function clockPace(f: TimeState): number {
  return f.playing && !f.timelapse ? clockRate(ticksPerSecondAt(f.speed), f.yearsPerSecond) : 0;
}

/**
 * Months per second the walkers keep pace with: the real pace while playing, the chosen speed's
 * while paused (people still walk to their spots), the top speed's in a time-lapse.
 */
export function walkerPace(f: TimeState): number {
  if (f.timelapse) return ticksPerSecondAt(SPEEDS[SPEEDS.length - 1]!);
  return f.playing ? clockRate(ticksPerSecondAt(f.speed), f.yearsPerSecond) : ticksPerSecondAt(f.speed);
}

/**
 * How much of the turning year shows, 1 (all) to 0 (the held fast-forward look): the speed's
 * `seasonShow` while time runs; all of it while paused, when a season can be read; none in a
 * time-lapse, which runs faster than any speed.
 */
export function seasonShow(f: TimeState): number {
  if (f.timelapse) return 0;
  return f.playing ? speedRow(f.speed).seasonShow : 1;
}

/** How the seasons show (seasons plan §6.3): every season with its front, two looks a year, or one held look. */
export type SeasonMode = 'full' | 'two' | 'held';

/**
 * Seasons Phase 3b: the season look of a frame: the speed's `look` while time runs; every season
 * while paused (a season can be read); the held look in a time-lapse, which runs faster than any speed.
 */
export function seasonLook(f: TimeState): SeasonMode {
  if (f.timelapse) return 'held';
  return f.playing ? speedRow(f.speed).look : 'full';
}

/** Seasons Phase 3b (S2): does the day stop at noon (Watch, while time runs)? */
export const holdsDay = (f: TimeState): boolean => f.playing && !f.timelapse && speedRow(f.speed).holdDay;

/**
 * Phase 5: whether land changes dissolve and the yearly rain slides, rather than showing at once:
 * yes while a season can be read (paused, or a speed that shows some of it), no at the speeds
 * that hold the look and in a time-lapse, where years pass too fast for either to be seen.
 */
export function gradualLand(f: TimeState): boolean {
  return !gradualOff && seasonShow(f) > 0;
}

/**
 * A walker's normal pace (map px a second) and the time it has to reach its spot, at
 * `monthsPerSecond`: the pace grows with the speed (Walk ×1, Fly ×4), the arrival time is a
 * season of screen time.
 */
export function walkPace(monthsPerSecond: number): { basePx: number; arriveSec: number } {
  const mps = Math.max(monthsPerSecond, 1e-6);
  return { basePx: R.walkSpeedPx * Math.pow(mps / MONTHS, R.walkPaceExp), arriveSec: R.arriveMonths / mps };
}
