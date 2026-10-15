// Discoveries and eras (§12): what a group has found, yearly discovery rolls, eras,
// forgetting, and resources used up each year.

import { CONFIG } from '../../config';
import { Ground, Plant, Resource, RESOURCE_NAMES, Species, WallType } from '../../shared/ids';
import {
  Discovery, DISCOVERIES, DISCOVERY_COUNT, ERA_NAMES, ERA_SIZES, FOUND_OF_RESOURCE, Found, has, type DiscoveryDef,
} from '../../shared/discoveries';
import { chance } from '../../shared/rng';
import type { Group, SimState } from '../state';
import { hasActive, rebuildFrontier } from '../people/explore';
import { logEvent, traitAverages } from '../people/groups';

const D = CONFIG.discoveries;

/** Every Found bit a tile can give (all but Hunted). */
const TILE_FOUND_ALL = Found.Forest | Found.Stone | Found.Clay | Found.Copper | Found.Iron | Found.Water
  | Found.Mountain | Found.WetGrassland | Found.HerdAnimals | Found.RidingAnimals;

/** Found bits of one tile (§12.2). */
function tileFound(s: SimState, i: number): number {
  const wall = s.wall[i]!;
  // Walls carry no plants or resources (§8.2); a river or sea is water, a range is mountain.
  if (wall !== WallType.None) return wall === WallType.Mountain ? Found.Mountain : Found.Water;
  let m = 0;
  const ground = s.ground[i]!;
  if (ground === Ground.Water) m |= Found.Water;
  else if (ground === Ground.Mountain) m |= Found.Mountain;
  else if (ground === Ground.Grassland && s.rainNow[i]! >= CONFIG.people.food.farmMinRain) m |= Found.WetGrassland;
  if (s.plantType[i] === Plant.Forest && s.plantDensity[i]! > 0) m |= Found.Forest;
  if (s.resourceAmount[i]! > 0) m |= FOUND_OF_RESOURCE[s.resourceType[i]!] ?? 0;
  const minD = CONFIG.animals.foundAtDensity;
  if (s.animal[Species.Herd][i]! >= minD) m |= Found.HerdAnimals;
  if (s.animal[Species.Riding][i]! >= minD) m |= Found.RidingAnimals;
  return m;
}

/** Everything the group's known tiles (and its history) have found, as Found bits. */
export function foundMask(s: SimState, g: Group): number {
  let mask = g.hasHunted ? Found.Hunted : 0;
  const n = s.width * s.height;
  const known = g.known;
  for (let b = 0; b < known.length; b++) {
    const byte = known[b]!;
    if (byte === 0) continue;
    for (let k = 0; k < 8; k++) {
      const i = b * 8 + k;
      if (i >= n) break;
      if ((byte >> k) & 1) mask |= tileFound(s, i);
    }
    if ((mask & TILE_FOUND_ALL) === TILE_FOUND_ALL) break;
  }
  return mask;
}

/** Not owned yet, needed discoveries owned, requirements found, big enough (City). */
export function canDiscover(g: Group, def: DiscoveryDef, found: number, population: number): boolean {
  return !has(g.discoveries, def.id)
    && (g.discoveries & def.needs) === def.needs
    && (found & def.needsFound) === def.needsFound
    && population >= def.minPopulation;
}

export interface ChanceInputs {
  avgInt: number;                // adults' average actual intelligence
  population: number;
  fed12: number;                 // 12-month average fed ratio
  writing: boolean;
  teachBonus: number;
}

/** Yearly chance of one discovery (§12.3). */
export function discoveryChance(def: DiscoveryDef, x: ChanceInputs): number {
  const spareFood = Math.min(1, Math.max(0, (x.fed12 - D.spareFoodFrom) * D.spareFoodScale));
  return D.baseChanceByEra[def.era - 1]!
    * (x.avgInt / 100)
    * (Math.sqrt(x.population) / D.popSqrtDivisor)
    * spareFood
    * (x.writing ? D.writingChanceMult : 1)
    * x.teachBonus;
}

/** Era from owned discoveries (§12.4): every era up to E has all but at most one of its discoveries. */
export function eraOf(owned: number): number {
  let era = 0;
  for (let e = 1; e < ERA_SIZES.length; e++) {
    let count = 0;
    for (const def of DISCOVERIES) if (def.era === e && has(owned, def.id)) count++;
    if (count < ERA_SIZES[e]! - 1) break;
    era = e;
  }
  return era;
}

/** Average of the last 12 months' fed ratio. */
export function fed12(g: Group): number {
  let sum = 0;
  for (const f of g.fedHistory) sum += f;
  return sum / g.fedHistory.length;
}

/** Gains discovery d and logs `text`. Raft changes which tiles are passable, so the frontier is rebuilt. */
export function gainDiscovery(s: SimState, g: Group, d: number, text: string): void {
  if (has(g.discoveries, d)) return;
  g.discoveries |= 1 << d;
  g.belowLimitYears[d] = 0;
  logEvent(s, 'discovery', text, g);
  if (d === Discovery.raft) rebuildFrontier(s, g);
}

/**
 * Loses discovery d and every owned discovery that needs it, directly or through others
 * (§12.5). Each loss is logged.
 */
export function loseDiscovery(s: SimState, g: Group, d: number, reason: string): void {
  if (!has(g.discoveries, d)) return;
  let lost = 1 << d;
  // Discoveries only ever need lower ids, so one pass in id order finds the whole cascade.
  for (const def of DISCOVERIES) {
    if (has(g.discoveries, def.id) && (def.needs & lost) !== 0) lost |= 1 << def.id;
  }
  const raftBefore = hasActive(g, Discovery.raft);
  g.discoveries &= ~lost;
  g.inactive &= ~lost;
  const name = DISCOVERIES[d]!.name;
  logEvent(s, 'lostDiscovery', `${g.name} forgot ${name} (${reason})`, g);
  for (const def of DISCOVERIES) {
    if (def.id === d || !has(lost, def.id)) continue;
    g.belowLimitYears[def.id] = 0;
    logEvent(s, 'lostDiscovery', `${g.name} forgot ${def.name} (it needs ${name})`, g);
  }
  g.belowLimitYears[d] = 0;
  // Without Taming nobody can keep the animals: the herd goes wild.
  if (has(lost, Discovery.taming)) g.herd = 0;
  if (raftBefore && !hasActive(g, Discovery.raft)) rebuildFrontier(s, g);
}

/**
 * Forgetting (§12.5): a discovery whose era needs more people than the group has, for 10
 * years in a row, is lost — together with everything built on it.
 */
export function forgetting(s: SimState, g: Group): void {
  const pop = g.members.length;
  const writing = has(g.discoveries, Discovery.writing);
  const lost: number[] = [];
  for (let d = 0; d < DISCOVERY_COUNT; d++) {
    if (!has(g.discoveries, d)) { g.belowLimitYears[d] = 0; continue; }
    let limit: number = D.forgetLimitByEra[DISCOVERIES[d]!.era - 1]!;
    if (writing && d !== Discovery.writing) limit = Math.ceil(limit / 2);
    g.belowLimitYears[d] = pop < limit ? Math.min(255, g.belowLimitYears[d]! + 1) : 0;
    if (g.belowLimitYears[d]! >= D.forgetYears) lost.push(d);
  }
  for (const d of lost) loseDiscovery(s, g, d, 'too few people');
}

/** Known tiles holding resource r, nearest to home first (ties → lowest index). */
function knownResourceTiles(s: SimState, g: Group, r: number): number[] {
  const out: Array<[number, number]> = [];
  const w = s.width;
  const n = w * s.height;
  for (let b = 0; b < g.known.length; b++) {
    const byte = g.known[b]!;
    if (byte === 0) continue;
    for (let k = 0; k < 8; k++) {
      const i = b * 8 + k;
      if (i >= n || !((byte >> k) & 1)) continue;
      if (s.resourceType[i] !== r || s.resourceAmount[i] === 0) continue;
      const dx = (i % w) - g.homeX;
      const dy = Math.floor(i / w) - g.homeY;
      out.push([dx * dx + dy * dy, i]);
    }
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.map((e) => e[1]);
}

/**
 * Resource use (§12.6): Stone Tools, Pottery, Mud Brick, Copper and Iron Working each use
 * ceil(population / 50) units a year from the nearest known deposits. Without enough, the
 * discovery goes inactive (logged once) until a year when there is enough again.
 */
export function useResources(s: SimState, g: Group): void {
  const units = Math.ceil(g.members.length / D.resourceUsePer);
  for (const def of DISCOVERIES) {
    if (def.uses === Resource.None || !has(g.discoveries, def.id)) continue;
    const tiles = knownResourceTiles(s, g, def.uses);
    let available = 0;
    for (const i of tiles) available += s.resourceAmount[i]!;
    if (available >= units) {
      let left = units;
      for (const i of tiles) {
        const take = Math.min(left, s.resourceAmount[i]!);
        s.resourceAmount[i] = s.resourceAmount[i]! - take;
        // An empty deposit is gone from the map.
        if (s.resourceAmount[i] === 0) s.resourceType[i] = Resource.None;
        left -= take;
        if (left === 0) break;
      }
      g.inactive &= ~(1 << def.id);
    } else if (!has(g.inactive, def.id)) {
      g.inactive |= 1 << def.id;
      logEvent(s, 'ranOut', `${g.name} ran out of ${RESOURCE_NAMES[def.uses]} (${def.name} stops working)`, g);
    }
  }
}

/** Rolls every discovery the group could make this year, in id order (§12.3). */
export function rollDiscoveries(s: SimState, g: Group): void {
  const pop = g.members.length;
  const found = foundMask(s, g);
  const x: ChanceInputs = {
    avgInt: traitAverages(s, g).int,
    population: pop,
    fed12: fed12(g),
    writing: has(g.discoveries, Discovery.writing),
    teachBonus: g.teachBonus,
  };
  for (const def of DISCOVERIES) {
    if (!canDiscover(g, def, found, pop)) continue;
    const p = discoveryChance(def, x);
    if (p > 0 && chance(s.rng, p)) gainDiscovery(s, g, def.id, `${g.name} discovered ${def.name}`);
  }
}

/** Recomputes the era and logs a change. */
export function updateEra(s: SimState, g: Group): void {
  const era = eraOf(g.discoveries);
  if (era > g.era) logEvent(s, 'eraUp', `${g.name} reached era ${era}: ${ERA_NAMES[era]}`, g);
  else if (era < g.era) logEvent(s, 'eraDown', `${g.name} fell back to era ${era}: ${ERA_NAMES[era]}`, g);
  g.era = era;
}

/** Teachers this year (average per month) set this year's bonus to discovery rolls (§11.6). */
export function updateTeachBonus(g: Group): void {
  const T = CONFIG.people.teach;
  const teachers = g.teacherMonths / CONFIG.time.ticksPerYear;
  g.teachBonus = 1 + Math.min(T.maxBonus, (T.perShare * teachers) / Math.max(1, g.members.length));
  g.teacherMonths = 0;
}

/** Yearly step 3 (§5.1): resources, every group in id order. */
export function yearlyResources(s: SimState): void {
  for (const g of s.groups) useResources(s, g);
}

/** Yearly step 4 (§5.1): forgetting, then new discoveries, then the era. */
export function yearlyDiscoveries(s: SimState): void {
  for (const g of s.groups) {
    updateTeachBonus(g);
    forgetting(s, g);
    rollDiscoveries(s, g);
    updateEra(s, g);
  }
}
