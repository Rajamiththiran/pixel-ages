// The screen clock (docs/pixel-ages-speeds-plan.md, Phase 3). The worker sends whole months; at
// Crawl one lasts 167 ms, so anything drawn from them steps six times a second. This clock keeps a
// fractional month (e.g. 4.37) that runs on in real time at the current speed between frames.
// Drawing only: it reads frames and never touches the simulation (§16).

import { CONFIG } from '../config';

const C = CONFIG.render.screenClock;
const MONTHS = CONFIG.time.ticksPerYear;

export class ScreenClock {
  /** Months since year 0 on screen, with a fraction. */
  t = 0;
  private sim = 0;     // the simulation's month (year × 12 + month) in the last frame
  private step = 0;    // months the last frame moved on (one at Crawl, a dozen at Fly on a busy map)
  private perMs = 0;   // months per ms while playing; 0 when paused or in a time-lapse

  /**
   * A frame from the worker. `monthsPerSecond` is 0 when time is not running at a set speed
   * (paused, time-lapse). `jump` (a jump in time: timeline, Back to now, a new run) snaps.
   */
  sync(absMonth: number, monthsPerSecond: number, jump: boolean): void {
    const moved = absMonth - this.sim;
    this.sim = absMonth;
    this.perMs = monthsPerSecond / 1000;
    if (jump || moved < 0) { this.t = absMonth; this.step = 0; return; }   // a jump, or time went back
    if (this.perMs === 0) { if (this.t < absMonth) this.t = absMonth; return; }   // paused, Step, time-lapse
    if (moved > 0) this.step = moved;
    // Far behind (a hitch): snap. A little behind: advance() catches up smoothly, so a frame that
    // comes early never makes the screen step.
    if (this.t < absMonth - this.room()) this.t = absMonth;
  }

  /** Runs on by `dtMs` of real time, faster while behind the last frame, never past the lead. */
  advance(dtMs: number): number {
    const cap = this.sim + this.room();
    const rate = this.t < this.sim ? this.perMs * C.catchUp : this.perMs;
    if (this.t < cap) this.t = Math.min(this.t + dtMs * rate, cap);
    return this.t;
  }

  /** The month of the year on screen, 0 ≤ m < 12, with a fraction. */
  get monthOfYear(): number {
    return ((this.t % MONTHS) + MONTHS) % MONTHS;
  }

  /**
   * How far the screen may run ahead of (or fall behind) the last frame: `leadMonths`, or
   * `leadSteps` times the months a frame brings when frames bring many (the fast speeds). A frame
   * that brings more than `maxGapMs` of months at this pace is a hitch and does not widen it.
   */
  private room(): number {
    return Math.max(C.leadMonths, Math.min(this.step, this.perMs * C.maxGapMs) * C.leadSteps);
  }
}

/**
 * The clock's pace: the speed's months per second, or the real pace when the computer cannot keep
 * up (`yearsPerSecond` as measured by the worker; 0 before it has a measure).
 */
export function clockRate(speedMonthsPerSecond: number, yearsPerSecond: number): number {
  const real = yearsPerSecond * MONTHS;
  return real > 0 ? Math.min(speedMonthsPerSecond, real) : speedMonthsPerSecond;
}
