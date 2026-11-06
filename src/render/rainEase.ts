// Gradual climate (docs/pixel-ages-speeds-plan.md, Phase 5). The simulation changes rain once a
// year (climate drift, dry and wet years), so drawn straight from it the whole map's weather jumps
// each January. This keeps the rain the screen draws, sliding from the old year's rain to the new
// over a year of screen-clock time. Drawing only: the simulation's rain is read, never changed.

import { CONFIG } from '../config';

const G = CONFIG.render.gradual;

export class RainEase {
  /** The rain the screen draws, 0–100 per tile. */
  shown: Uint8Array;
  private from: Uint8Array;
  private to: Uint8Array;
  private start = 0;          // screen-clock month the slide began
  private step = -1;          // last step drawn
  private lastMs = -Infinity;
  private done = true;

  constructor(rain: Uint8Array) {
    this.shown = rain.slice();
    this.from = rain.slice();
    this.to = rain.slice();
  }

  /**
   * The simulation's rain changed. `snap` (a jump in time, or a speed that holds the look) shows
   * it at once; otherwise it slides from what is shown now, starting at clock month `t`.
   */
  set(rain: Uint8Array, t: number, snap: boolean): void {
    if (rain.length !== this.shown.length) {
      this.shown = rain.slice(); this.from = rain.slice(); this.to = rain.slice();
      this.done = true;
      return;
    }
    if (snap) {
      this.shown.set(rain); this.from.set(rain); this.to.set(rain);
      this.done = true;
      return;
    }
    this.from.set(this.shown);
    this.to.set(rain);
    this.start = t;
    this.step = -1;
    this.done = false;
  }

  /** Moves the slide on to clock month `t`; true when `shown` changed (redraw what reads it). */
  update(t: number, nowMs: number): boolean {
    if (this.done) return false;
    const p = Math.min(1, Math.max(0, (t - this.start) / G.rainMonths));
    const step = Math.floor(p * G.rainSteps);
    if (step === this.step) return false;
    if (step < G.rainSteps && nowMs - this.lastMs < G.rainMinMs) return false;
    this.step = step;
    this.lastMs = nowMs;
    const k = step / G.rainSteps;
    for (let i = 0; i < this.shown.length; i++) this.shown[i] = Math.round(this.from[i]! + (this.to[i]! - this.from[i]!) * k);
    if (step === G.rainSteps) this.done = true;
    return true;
  }
}
