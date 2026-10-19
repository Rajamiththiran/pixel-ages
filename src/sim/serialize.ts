// SimState copies (keyframes) and the state hash used by determinism tests (§16.3).

import type { Group, SimState, VillageData } from './state';
import { POOL_ARRAYS, clonePool } from './people/persons';

export function cloneVillage(v: VillageData): VillageData {
  return {
    ...v,
    counts: v.counts.slice(),
    sample: v.sample.map((m) => ({ ...m, pot: [...m.pot], act: [...m.act] })),
  };
}

export function cloneGroup(g: Group): Group {
  return {
    ...g,
    known: g.known.slice(),
    frontier: g.frontier.slice(),
    belowLimitYears: g.belowLimitYears.slice(),
    inactiveWhy: g.inactiveWhy.slice(),
    discoveries: g.discoveries.slice(),
    inactive: g.inactive.slice(),
    built: g.built.slice(),
    practice: g.practice.slice(),
    practiceYear: g.practiceYear.slice(),
    idleYears: g.idleYears.slice(),
    needAcc: g.needAcc.slice(),
    needs: g.needs.slice(),
    lessons: g.lessons.slice(),
    culture: g.culture.slice(),
    fedHistory: g.fedHistory.slice(),
    farmTiles: g.farmTiles.slice(),
    wallTarget: g.wallTarget ? { ...g.wallTarget } : null,
    members: g.members.slice(),
    village: g.village ? cloneVillage(g.village) : null,
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
    farmedThisYear: s.farmedThisYear.slice(),
    fish: s.fish.slice(),
    fertility: s.fertility.slice(),
    salinity: s.salinity.slice(),
    animalLowYears: s.animalLowYears.slice(),
    areaAnimals: s.areaAnimals.slice(),
    elevation: s.elevation,                        // painted, never changes
    wear: s.wear.slice(),
    roadOK: s.roadOK.slice(),
    ruinAge: s.ruinAge.slice(),
    quarry: s.quarry.slice(),
    canal: s.canal.slice(),
    terrace: s.terrace.slice(),
    ash: s.ash.slice(),
    bareYears: s.bareYears.slice(),
    cellForest0: s.cellForest0,                    // never changes
    dryCells: s.dryCells.slice(),
    fireState: s.fireState.slice(),
    floodMonths: s.floodMonths.slice(),
    weatherYear: s.weatherYear.slice(),
    hazardsActive: s.hazardsActive.map((h) => ({ ...h })),
    climate: s.climate.slice(),
    driftMult: s.driftMult.slice(),
    groups: s.groups.map(cloneGroup),
    lineages: s.lineages.map((l) => ({ ...l })),
    persons: clonePool(s.persons),
    relations: s.relations.map((r) => ({ ...r })),
    lineagesMet: s.lineagesMet.slice(),
    alliances: s.alliances.map((a) => ({ ...a })),
    languages: s.languages.map((l) => ({ ...l })),
    activeEvents: s.activeEvents.map((e) => ({ ...e })),
    log: [],
    logDropped: 0,
    stats: [],
  };
}

/** A group's typed arrays, in a fixed order (kept out of the JSON part of the hash). */
const GROUP_ARRAYS = [
  'known', 'belowLimitYears', 'fedHistory', 'inactiveWhy', 'discoveries', 'inactive', 'built',
  'practice', 'practiceYear', 'idleYears', 'needAcc', 'needs', 'lessons', 'culture',
] as const;

/** Typed arrays that make up the state, in a fixed order. */
function stateArrays(s: SimState): ArrayBufferView[] {
  const out: ArrayBufferView[] = [
    s.rng, s.ground, s.plantType, s.plantDensity, s.plantFood, s.resourceType, s.resourceAmount,
    s.baseRain, s.rainNow, s.animal[0], s.animal[1], s.animal[2], s.animal[3], s.wall, s.crossing,
    s.regionId, s.regionParent, s.dryYears, s.wetYears, s.farmIdleYears, s.farmedThisYear, s.climate, s.driftMult,
    s.fish, s.fertility, s.salinity, s.animalLowYears, s.areaAnimals,
    s.wear, s.roadOK, s.ruinAge, s.quarry, s.canal, s.terrace, s.ash, s.bareYears, s.dryCells,
    s.fireState, s.floodMonths, s.weatherYear,
  ];
  for (const k of POOL_ARRAYS) out.push(s.persons[k]);
  for (const g of s.groups) for (const k of GROUP_ARRAYS) out.push(g[k]);
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
    ...g, ...Object.fromEntries(GROUP_ARRAYS.map((k) => [k, undefined])),
    village: g.village ? { ...g.village, counts: Array.from(g.village.counts) } : null,
  }));
  const json = JSON.stringify({
    year: s.year, month: s.month, walls: s.wallSegments, events: s.activeEvents, hazards: s.hazardsActive,
    groups, lineages: s.lineages, nextGroupId: s.nextGroupId, relations: s.relations, met: s.lineagesMet,
    alliances: s.alliances, languages: s.languages, nextLanguageId: s.nextLanguageId,
    persons: { nextId: s.persons.nextId, free: s.persons.free, capacity: s.persons.capacity },
  });
  for (let k = 0; k < json.length; k++) mix(json.charCodeAt(k) & 255);
  return (h >>> 0).toString(16).padStart(8, '0');
}
