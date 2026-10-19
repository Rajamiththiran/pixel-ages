// Rain now and climate drift (§10.1).

import { CONFIG } from '../../config';
import { gaussian } from '../../shared/rng';
import type { SimState } from '../state';
import { eventRainMult } from '../events';
import { cellOf } from './landscape';

const C = CONFIG.climate;

/** rainFactor used by plants, farming and animals. */
export const rainFactor = (rainNow: number): number =>
  Math.min(CONFIG.rain.factorMax, Math.max(0, rainNow / CONFIG.rain.factorDivisor));

export function initClimate(s: SimState): void {
  s.climate.fill(0);
  s.driftMult.fill(1);
}

/**
 * Yearly drift: each coarse climate cell does a slow mean-reverting random walk,
 * then every tile's multiplier is the bilinear blend of the 4 nearest cell centres.
 */
export function updateClimate(s: SimState): void {
  const sigma = C.sigma[s.setup.climateDrift];
  // Drift "off" draws no random numbers at all, so it costs nothing and never changes.
  if (sigma === 0) return;
  for (let c = 0; c < s.climate.length; c++) {
    s.climate[c] = s.climate[c]! * C.reversion + gaussian(s.rng) * sigma;
  }
  computeDriftMult(s);
}

const cellMult = (v: number): number => Math.min(C.maxMult, Math.max(C.minMult, 1 + v));

export function computeDriftMult(s: SimState): void {
  const cw = s.width / C.cellsX;
  const ch = s.height / C.cellsY;
  for (let y = 0; y < s.height; y++) {
    const fy = (y + 0.5) / ch - 0.5;
    const y0 = Math.floor(fy);
    const ay = fy - y0;
    const r0 = Math.min(C.cellsY - 1, Math.max(0, y0));
    const r1 = Math.min(C.cellsY - 1, Math.max(0, y0 + 1));
    for (let x = 0; x < s.width; x++) {
      const fx = (x + 0.5) / cw - 0.5;
      const x0 = Math.floor(fx);
      const ax = fx - x0;
      const c0 = Math.min(C.cellsX - 1, Math.max(0, x0));
      const c1 = Math.min(C.cellsX - 1, Math.max(0, x0 + 1));
      const v00 = cellMult(s.climate[r0 * C.cellsX + c0]!);
      const v01 = cellMult(s.climate[r0 * C.cellsX + c1]!);
      const v10 = cellMult(s.climate[r1 * C.cellsX + c0]!);
      const v11 = cellMult(s.climate[r1 * C.cellsX + c1]!);
      s.driftMult[y * s.width + x] = (v00 * (1 - ax) + v01 * ax) * (1 - ay) + (v10 * (1 - ax) + v11 * ax) * ay;
    }
  }
}

/** Monthly: rainNow = clamp(round(baseRain × drift × events × local drying), 0, 100). */
export function updateRainNow(s: SimState): void {
  const n = s.baseRain.length;
  const ev = eventRainMult(s);
  const cells = tileCells(s);
  const dry = CONFIG.future.drying.mult;
  for (let i = 0; i < n; i++) {
    // F4 (§10.1): a cell that lost its forest gets 10% less rain.
    const r = Math.round(s.baseRain[i]! * s.driftMult[i]! * (ev ? ev[i]! : 1) * (s.dryCells[cells[i]!] ? dry : 1));
    s.rainNow[i] = r < 0 ? 0 : r > 100 ? 100 : r;
  }
}

// The climate cell of each tile; fixed for a map size (sim-local cache, not state).
const cellCache = new Map<number, Uint8Array>();

function tileCells(s: SimState): Uint8Array {
  const key = s.width * 65536 + s.height;
  let c = cellCache.get(key);
  if (!c) {
    c = new Uint8Array(s.width * s.height);
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) c[y * s.width + x] = cellOf(x, y, s.width, s.height);
    cellCache.set(key, c);
  }
  return c;
}
