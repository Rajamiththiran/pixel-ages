// SimState copies (keyframes) and the state hash used by determinism tests (§16.3).

import type { Group, SimState } from './state';
import { POOL_ARRAYS, clonePool } from './people/persons';

export function cloneGroup(g: Group): Group {
  return {
    ...g,
    known: g.known.slice(),
    frontier: g.frontier.slice(),
    belowLimitYears: g.belowLimitYears.slice(),
    fedHistory: g.fedHistory.slice(),
    farmTiles: g.farmTiles.slice(),
    wallTarget: g.wallTarget ? { ...g.wallTarget } : null,
    members: g.members.slice(),
  };
}

/**
 * Deep copy for keyframes. Typed arrays and the RNG are copied; the setup is shared
 * (it is never changed). Log and stats are not copied: the live run keeps the history,
 * and a replay from a keyframe only needs the state that drives future ticks.
 */
export function cloneState(s: SimState): SimState {
  return {
    ...s,
    rng: s.rng.slice(),
    ground: s.ground.slice(),
    plantType: s.plantType.slice(),
    plantDensity: s.plantDensity.slice(),
    plantFood: s.plantFood.slice(),
    resourceType: s.resourceType.slice(),
    resourceAmount: s.resourceAmount.slice(),
    baseRain: s.baseRain.slice(),
    rainNow: s.rainNow.slice(),
    animal: [s.animal[0].slice(), s.animal[1].slice(), s.animal[2].slice(), s.animal[3].slice()],
    wall: s.wall.slice(),
    crossing: s.crossing.slice(),
    regionId: s.regionId.slice(),
    regionParent: s.regionParent.slice(),
    originalRegionId: s.originalRegionId,          // never changes after start
    wallSegmentId: s.wallSegmentId,                // never changes after start
    wallSegments: s.wallSegments.map((w) => ({ ...w })),
    dryYears: s.dryYears.slice(),
    wetYears: s.wetYears.slice(),
    farmIdleYears: s.farmIdleYears.slice(),
    climate: s.climate.slice(),
    driftMult: s.driftMult.slice(),
    groups: s.groups.map(cloneGroup),
    lineages: s.lineages.map((l) => ({ ...l })),
    persons: clonePool(s.persons),
    activeEvents: s.activeEvents.map((e) => ({ ...e })),
    log: [],
    logDropped: 0,
    stats: [],
  };
}

/** Typed arrays that make up the state, in a fixed order. */
function stateArrays(s: SimState): ArrayBufferView[] {
  const out: ArrayBufferView[] = [
    s.rng, s.ground, s.plantType, s.plantDensity, s.plantFood, s.resourceType, s.resourceAmount,
    s.baseRain, s.rainNow, s.animal[0], s.animal[1], s.animal[2], s.animal[3], s.wall, s.crossing,
    s.regionId, s.regionParent, s.dryYears, s.wetYears, s.farmIdleYears, s.climate, s.driftMult,
  ];
  for (const k of POOL_ARRAYS) out.push(s.persons[k]);
  for (const g of s.groups) out.push(g.known, g.belowLimitYears, g.fedHistory);
  return out;
}

/** Approximate memory of one copy of the state, for the keyframe memory cap. */
export function stateBytes(s: SimState): number {
  let n = 0;
  for (const a of stateArrays(s)) n += a.byteLength;
  return n;
}

/** FNV-1a over every typed array's bytes, plus a JSON of the non-array state. */
export function hashState(s: SimState): string {
  let h = 0x811c9dc5;
  const mix = (b: number): void => {
    h ^= b;
    h = Math.imul(h, 16777619);
  };
  for (const a of stateArrays(s)) {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let k = 0; k < bytes.length; k++) mix(bytes[k]!);
  }
  const groups = s.groups.map((g) => ({
    ...g, known: undefined, belowLimitYears: undefined, fedHistory: undefined,
  }));
  const json = JSON.stringify({
    year: s.year, month: s.month, walls: s.wallSegments, events: s.activeEvents,
    groups, lineages: s.lineages, nextGroupId: s.nextGroupId,
    persons: { nextId: s.persons.nextId, free: s.persons.free, capacity: s.persons.capacity },
  });
  for (let k = 0; k < json.length; k++) mix(json.charCodeAt(k) & 255);
  return (h >>> 0).toString(16).padStart(8, '0');
}
