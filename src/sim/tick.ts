// One month of simulation in the exact order of §5.1. Pure function of SimState:
// same state in → same state out, whatever the speed or batch size.

import { CONFIG } from '../config';
import { Mode } from '../shared/ids';
import type { SimState } from './state';
import { updateClimate, updateRainNow } from './world/climate';
import { regenPlants, yearlyPlants } from './world/plants';
import { updateAnimals } from './world/animals';
import { updateBand } from './people/band';
import { checkMigration, checkSplit } from './people/movement';
import { removeEmptyGroups } from './people/groups';
import { recordYearStats } from './stats';
import { farmlandIdle } from './people/farming';
import { yearlyDiscoveries, yearlyResources } from './progress/discoveryRules';
import { modeSwitches, updateVillage, yearlySample } from './people/village';
import { breachChecks } from './society/walls';
import { yearlyContact } from './society/contact';
import { harshWinterNow, updateEvents } from './events';

export function tick(s: SimState): void {
  // 1. Planned events start, end or strike.
  updateEvents(s);
  // 2. Current rain for every tile (drift and events).
  updateRainNow(s);
  // 3. Plants regrow food stock (half as fast in a harsh winter).
  regenPlants(s, CONFIG.seasonOfMonth[s.month]!, harshWinterNow(s) ? CONFIG.events.harshWinterRegenMult : 1);
  // 4. Animals: growth, predation, diffusion.
  updateAnimals(s);
  // 5. Each group, in ascending id.
  for (const g of s.groups) {
    if (g.mode === Mode.Band) updateBand(s, g);
    else updateVillage(s, g);
  }
  removeEmptyGroups(s);
  // 6. Wall breaches.
  breachChecks(s);
  // 7. Band ↔ village switches (and the performance guard).
  modeSwitches(s);
  // 8. Migration and split checks (new groups from splits are checked from next month).
  for (const g of s.groups.slice()) {
    if (!checkMigration(s, g)) checkSplit(s, g);
  }
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
  // 2. Plant growth/death/spread, ground change, idle fields back to grass.
  yearlyPlants(s);
  farmlandIdle(s);
  // 3. Resources used up by discoveries.
  yearlyResources(s);
  // 4. Discoveries: forgetting, new rolls (with this year's teaching), era.
  yearlyDiscoveries(s);
  // 5. Contact: meet, decide, trade, fight, absorb.
  yearlyContact(s);
  // 6. Village samples: deaths by trait, births, aging.
  for (const g of s.groups) if (g.village) yearlySample(s, g);
  // 7. Yearly stats (the log is written as things happen).
  recordYearStats(s);
  // 8. Keyframes are stored by the timeline after the year rolls over (timeline.ts).
}

/** Runs n ticks. Used by tests and silent timeline rebuilds. */
export function runTicks(s: SimState, n: number): void {
  for (let k = 0; k < n; k++) tick(s);
}
