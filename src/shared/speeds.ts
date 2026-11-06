// Game speeds (docs/pixel-ages-speeds-plan.md, Phase 1). The table lives in CONFIG.time.speeds;
// these helpers turn a speed into the worker's pace. Speed only paces the loop: ticks are
// identical at every speed, so it never changes results (§16).

import { CONFIG } from '../config';

const T = CONFIG.time;
type Row = (typeof T.speeds)[number];

/** A speed button's value: 1, 2, 4, 6 or 8 (from the config table). */
export type Speed = Row['speed'];

/** Every speed, slowest first. */
export const SPEEDS: readonly Speed[] = T.speeds.map((r) => r.speed);

export const DEFAULT_SPEED: Speed = T.defaultSpeed;

/** The table row for a speed; an unknown value falls back to the default speed. */
export function speedRow(speed: number): Row {
  return T.speeds.find((r) => r.speed === speed) ?? T.speeds.find((r) => r.speed === T.defaultSpeed)!;
}

export const yearsPerSecondAt = (speed: number): number => speedRow(speed).yearsPerSecond;

/** Months (ticks) per second of real time at this speed. */
export const ticksPerSecondAt = (speed: number): number => speedRow(speed).yearsPerSecond * T.ticksPerYear;

/** Tooltip text: "0.5 years per second", "1 year per second". */
export function speedTitle(speed: number): string {
  const y = yearsPerSecondAt(speed);
  return `${y} ${y === 1 ? 'year' : 'years'} per second`;
}
