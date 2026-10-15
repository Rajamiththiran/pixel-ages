// Walls and breaching (§13). Step 4 only needs pressure (an inactive discovery adds to it);
// wall work, wear and breaches arrive in step 5.

import { CONFIG } from '../../config';
import type { Group } from '../state';

const W = CONFIG.walls;

/** Pressure P (0–1): hunger, crowding, or a discovery that ran out of its resource. */
export function pressure(g: Group): number {
  const crowd = Math.min(1, Math.max(0, (g.crowding - W.crowdingPressureStart) * W.crowdingPressureScale));
  return Math.max(g.hunger / 100, crowd, g.inactive !== 0 ? W.inactivePressure : 0);
}
