// The held look's rain (seasons plan Phase 4, mockup D). At the fast speeds the map holds one calm
// look; only weather that lasts years may break it. This keeps each tile's rain averaged over
// `rainYears` of screen time (an exponential average), so a drought of several years dries the
// grass and cracks the ground while a single dry year (125 ms at Fly) barely moves it and never
// flashes. Drawing only: the simulation's rain is read, never changed.

import { CONFIG } from '../config';

const HC = CONFIG.render.seasons.held;
const MONTHS = CONFIG.time.ticksPerYear;
const FW = CONFIG.render.f8.weather;

export class HeldRain {
  /** The rain the held look draws, 0–100 per tile (whole numbers, so tiny drifts redraw nothing). */
  readonly shown: Uint8Array;
  private readonly avg: Float32Array;
  private lastT = 0;
  private lastStep = -Infinity;

  constructor(rain: ArrayLike<number>) {
    this.shown = Uint8Array.from(rain);
    this.avg = Float32Array.from(rain);
  }

  /** Starts from `rain` (entering the held look, a jump in time): nothing slides. */
  snap(rain: ArrayLike<number>, t: number): void {
    for (let i = 0; i < this.avg.length; i++) { this.avg[i] = rain[i]!; this.shown[i] = rain[i]!; }
    this.lastT = t;
  }

  /**
   * Averages toward the simulation's rain `rain` up to screen-clock month `t` (every frame, so a year
   * counts for its own length), and shows the average at most every stepMs of real time. True when
   * `shown` changed (redraw what reads it).
   */
  update(rain: ArrayLike<number>, t: number, nowMs: number): boolean {
    const years = Math.max(0, t - this.lastT) / MONTHS;
    this.lastT = t;
    if (years > 0) {
      const k = 1 - Math.exp(-years / HC.rainYears);
      for (let i = 0; i < this.avg.length; i++) this.avg[i] = this.avg[i]! + (rain[i]! - this.avg[i]!) * k;
    }
    if (nowMs - this.lastStep < HC.stepMs) return false;
    this.lastStep = nowMs;
    let changed = false;
    for (let i = 0; i < this.avg.length; i++) {
      const v = Math.round(this.avg[i]!);
      if (v !== this.shown[i]) { this.shown[i] = v; changed = true; }
    }
    return changed;
  }

  /**
   * The year's note (owner decision S11): 'drought' or 'wet' when at least `landShare` of the land
   * tiles (`land`) with painted rain is that dry or wet on the average (as the ground's cracks and
   * puddles: rain ÷ painted rain below droughtBelow or above wetAbove), else null.
   */
  note(base: ArrayLike<number>, land: (i: number) => boolean): 'drought' | 'wet' | null {
    let n = 0, dry = 0, wet = 0;
    for (let i = 0; i < this.shown.length; i++) {
      if (!land(i) || base[i]! <= 0) continue;
      n++;
      const r = this.shown[i]! / base[i]!;
      if (r < FW.droughtBelow) dry++;
      else if (r > FW.wetAbove) wet++;
    }
    if (n === 0) return null;
    return dry >= HC.note.landShare * n ? 'drought' : wet >= HC.note.landShare * n ? 'wet' : null;
  }
}
