// Run validation (§20.6): errors stop the run; warnings are shown but allowed.

import { CONFIG } from '../config';
import { Ground, Plant, Sex, Species, WallType } from '../shared/ids';
import type { FounderGroup, MapData, PlannedEvent } from '../shared/types';
import { describeEvent, validateEvent } from '../sim/events';

export interface Validation { errors: string[]; warnings: string[] }

/** Food a group could live on near home: plants or prey within the forage radius (6 tiles). */
function hasFoodNear(map: MapData, g: FounderGroup): boolean {
  const R = CONFIG.people.range.forage;
  for (let y = Math.max(0, g.y - R); y <= Math.min(map.height - 1, g.y + R); y++) {
    for (let x = Math.max(0, g.x - R); x <= Math.min(map.width - 1, g.x + R); x++) {
      if ((x - g.x) ** 2 + (y - g.y) ** 2 > R * R) continue;
      const i = y * map.width + x;
      const p = map.plantType[i];
      if ((p === Plant.Forest || p === Plant.FruitBushes || p === Plant.Grass) && map.plantDensity[i]! > 0) return true;
      if (map.animals[Species.Prey][i]! > 0) return true;
    }
  }
  return false;
}

export function validateRun(map: MapData, founders: readonly FounderGroup[], events: readonly PlannedEvent[], regionId: Int32Array): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (founders.length === 0) errors.push('Place at least one group (People tool).');
  for (const g of founders) {
    const i = g.y * map.width + g.x;
    if (map.ground[i] === Ground.Water || map.wall[i] !== WallType.None) errors.push(`${g.name}'s home is on ${map.wall[i] ? 'a wall' : 'water'}. Move the group.`);
    const men = g.people.filter((p) => p.sex === Sex.Male).length;
    if (men === 0 || men === g.people.length) warnings.push(`${g.name} can't have children.`);
    if (!hasFoodNear(map, g)) warnings.push(`${g.name} has no forest, fruit bushes, grass or prey within ${CONFIG.people.range.forage} tiles — it may starve quickly.`);
  }
  const meet = 2 * CONFIG.people.range.forage;
  for (let a = 0; a < founders.length; a++) {
    for (let b = a + 1; b < founders.length; b++) {
      const A = founders[a]!, B = founders[b]!;
      const sameArea = regionId[A.y * map.width + A.x] === regionId[B.y * map.width + B.x];
      if (sameArea && (A.x - B.x) ** 2 + (A.y - B.y) ** 2 <= meet * meet) warnings.push(`${A.name} and ${B.name} live within ${meet} tiles of each other — they'll meet immediately.`);
    }
  }
  events.forEach((ev, k) => {
    for (const e of validateEvent(ev, map, regionId)) {
      const area = 'at' in ev && ev.kind !== 'earthquake' && ev.at.x >= 0 ? regionId[ev.at.y * map.width + ev.at.x] ?? -1 : -1;
      errors.push(`Event ${k + 1} (${describeEvent(ev, area)}): ${e}`);
    }
  });
  return { errors, warnings };
}
