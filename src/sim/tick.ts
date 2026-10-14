// One month of simulation in the exact order of §5.1. Pure function of SimState:
// same state in → same state out, whatever the speed or batch size.

import { CONFIG } from '../config';
import type { SimState } from './state';
import { updateClimate, updateRainNow } from './world/climate';
import { regenPlants, yearlyPlants } from './world/plants';
import { updateAnimals } from './world/animals';

export function tick(s: SimState): void {
  // 1. Planned events start/end — step 6.
  // 2. Current rain for every tile.
  updateRainNow(s);
  // 3. Plants regrow food stock.
  regenPlants(s, CONFIG.seasonOfMonth[s.month]!);
  // 4. Animals: growth, predation, diffusion.
  updateAnimals(s);
  // 5–8. Groups, walls, mode switches, migration — steps 3–5.
  // 9. Advance month; after month 11 run the yearly steps.
  s.month += 1;
  if (s.month === CONFIG.time.ticksPerYear) {
    yearly(s);
    s.month = 0;
    s.year += 1;
  }
}

function yearly(s: SimState): void {
  // 1. Climate drift.
  updateClimate(s);
  // 2. Plant growth/death/spread and ground change.
  yearlyPlants(s);
  // 3–7. Resources, discoveries, contact, village samples, stats — steps 3–6.
  // 8. Keyframes are stored by the timeline after the year rolls over (timeline.ts).
}

/** Runs n ticks. Used by tests and silent timeline rebuilds. */
export function runTicks(s: SimState, n: number): void {
  for (let k = 0; k < n; k++) tick(s);
}
