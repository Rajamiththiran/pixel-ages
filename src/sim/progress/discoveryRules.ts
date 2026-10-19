// Discoveries and eras (§12): what a group has found, yearly discovery rolls, eras,
// forgetting, and resources used up each year. F2 (future blueprint §8) adds practice, need and
// lessons to the chance, the 60% era rule, and forgetting of skills nobody uses.

import { CONFIG } from '../../config';
import { Ground, Need, Plant, PRACTICE_NAMES, Resource, RESOURCE_NAMES, Species, WallType } from '../../shared/ids';
import {
  Discovery, DISCOVERIES, DISCOVERY_COUNT, ERA_NAMES, ERA_NEEDED, FOUND_OF_RESOURCE, Found, LESSONS_FOR, addBit, clearAll,
  has, newMask, type DiscoveryDef,
} from '../../shared/discoveries';
import { chance } from '../../shared/rng';
import type { Group, SimState } from '../state';
import { hasActive, rebuildFrontier } from '../people/explore';
import { logEvent, population, traitAverages } from '../people/groups';
import { Lack, SMELT_WOOD, buildVessel, setActive, setInactive, vesselWood, yearlyVessels, yearlyWoodOf } from '../people/wood';
import { availableUnits, knownResourceTiles, resourceTiles, takeUnits } from './deposits';

const D = CONFIG.discoveries;
const FU = CONFIG.future;
const PR = FU.practice;

/** Every Found bit a tile can give (all but Hunted). */
const TILE_FOUND_ALL = Found.Forest | Found.Stone | Found.Clay | Found.Copper | Found.Iron | Found.Water
  | Found.Mountain | Found.WetGrassland | Found.HerdAnimals | Found.RidingAnimals | Found.Tin | Found.Salt | Found.Predators;

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
  if (s.animal[Species.Predator][i]! >= minD) m |= Found.Predators;
  return m;
}

// Found bits of every tile, worked out once per state and month (sim-local cache, never state:
// it is a pure function of the tiles, so it can't change results).
const tileCache = new WeakMap<SimState, { stamp: number; bits: Uint16Array }>();

function tileFoundBits(s: SimState): Uint16Array {
  const stamp = s.year * 13 + s.month; // the yearly steps run with month = 12
  let c = tileCache.get(s);
  if (!c || c.stamp !== stamp) {
    const bits = c?.bits ?? new Uint16Array(s.width * s.height);
    for (let i = 0; i < bits.length; i++) bits[i] = tileFound(s, i);
    c = { stamp, bits };
    tileCache.set(s, c);
  }
  return c.bits;
}

/** Forget the cached tile bits (tests that change tiles within one month). */
export const invalidateFound = (s: SimState): void => { tileCache.delete(s); };

/**
 * Everything the group's known tiles (and its history) have found, as Found bits. Only the
 * bits in `wanted` matter to the caller, so the scan stops once all of those are found.
 */
export function foundMask(s: SimState, g: Group, wanted = TILE_FOUND_ALL): number {
  let mask = g.hasHunted ? Found.Hunted : 0;
  const want = wanted & TILE_FOUND_ALL;
  if (want === 0) return mask;
  const bits = tileFoundBits(s);
  const n = bits.length;
  const known = g.known;
  for (let b = 0; b < known.length; b++) {
    const byte = known[b]!;
    if (byte === 0) continue;
    for (let k = 0; k < 8; k++) {
      const i = b * 8 + k;
      if (i >= n) break;
      if ((byte >> k) & 1) mask |= bits[i]!;
    }
    if ((mask & want) === want) break;
  }
  return mask;
}

/** Found bits still useful to the group: needed by a discovery it doesn't own (optionally only those `other` owns). */
export function wantedFound(g: Group, other: ArrayLike<number> | null = null): number {
  let want = 0;
  for (const def of DISCOVERIES) if (!has(g.discoveries, def.id) && (other === null || has(other, def.id))) want |= def.needsFound;
  return want;
}

/** Not owned yet, needed discoveries owned, requirements found, big enough (City). */
export function canDiscover(g: Group, def: DiscoveryDef, found: number, population: number): boolean {
  return !has(g.discoveries, def.id)
    && def.needs.every((d) => has(g.discoveries, d))
    && (found & def.needsFound) === def.needsFound
    && population >= def.minPopulation;
}

export interface ChanceInputs {
  avgInt: number;                // adults' average actual intelligence
  population: number;
  fed12: number;                 // 12-month average fed ratio
  writing: boolean;
  teachBonus: number;
  // F2 (§8.2), each for the discovery being rolled; left out = 0 / false (the v1 chance).
  practiceShare?: number;        // min(1, practice in its activity / (24 × population))
  need?: number;                 // 0–1, last year's pressure of its need
  lesson?: boolean;              // a lesson of one of its hazards is active
  avgCoop?: number;              // F5: clever, cooperative groups learn more from a disaster
  specialists?: number;          // F6: share of craftspeople (each 1%: +2%)
}

/** F5 §11.6: lessons × (0.5 + int/200) × (0.5 + coop/200); 1 when cooperation is not given. */
const lessonFactor = (x: ChanceInputs): number =>
  (x.avgCoop === undefined ? 1 : (0.5 + x.avgInt / 200) * (0.5 + x.avgCoop / 200));

/**
 * Yearly chance of one discovery: the v1 formula (§12.3) × learning by doing × necessity ×
 * a lesson from a recent disaster (future blueprint §8.2) × craftspeople (F6 §12.1).
 */
export function discoveryChance(def: DiscoveryDef, x: ChanceInputs): number {
  const spareFood = Math.min(1, Math.max(0, (x.fed12 - D.spareFoodFrom) * D.spareFoodScale));
  return D.baseChanceByEra[def.era - 1]!
    * (x.avgInt / 100)
    * (Math.sqrt(x.population) / D.popSqrtDivisor)
    * spareFood
    * (x.writing ? D.writingChanceMult : 1)
    * x.teachBonus
    * (1 + PR.weight * (x.practiceShare ?? 0))
    * (1 + PR.needWeight * (x.need ?? 0))
    * (x.lesson ? FU.lessons.mult * lessonFactor(x) : 1)
    * (1 + FU.society.specialistDiscovery * (x.specialists ?? 0));
}

/** Era from owned discoveries: every era up to E has at least 60% of its discoveries (F2 §8.3). */
export function eraOf(owned: ArrayLike<number>): number {
  let era = 0;
  for (let e = 1; e < ERA_NEEDED.length; e++) {
    let count = 0;
    for (const def of DISCOVERIES) if (def.era === e && has(owned, def.id)) count++;
    if (count < ERA_NEEDED[e]!) break;
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
  addBit(g.discoveries, d);
  g.belowLimitYears[d] = 0;
  logEvent(s, 'discovery', text, g);
  // A raft, boat or cart has to be built from wood before it works (F1).
  if (vesselWood(d) > 0) buildVessel(s, g, d);
  if (d === Discovery.raft) rebuildFrontier(s, g);
}

/**
 * Loses discovery d and every owned discovery that needs it, directly or through others
 * (§12.5). Each loss is logged.
 */
export function loseDiscovery(s: SimState, g: Group, d: number, reason: string): void {
  if (!has(g.discoveries, d)) return;
  const lost = newMask();
  addBit(lost, d);
  // Discoveries only ever need lower ids, so one pass in id order finds the whole cascade.
  for (const def of DISCOVERIES) {
    if (has(g.discoveries, def.id) && def.needs.some((n) => has(lost, n))) addBit(lost, def.id);
  }
  const raftBefore = hasActive(g, Discovery.raft);
  clearAll(g.discoveries, lost);
  clearAll(g.inactive, lost);
  clearAll(g.built, lost);
  for (let k = 0; k < g.inactiveWhy.length; k++) if (has(lost, k)) g.inactiveWhy[k] = Lack.None;
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
  const pop = population(g);
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

/**
 * Unused skills fade (F2 §8.4): a discovery whose activity nobody practised for 50 years in a
 * row is forgotten with 5% a year, on top of the population rule. Discoveries without a
 * practice link never fade this way.
 */
export function forgetUnused(s: SimState, g: Group): void {
  const Df = FU.diffusion;
  for (const def of DISCOVERIES) {
    if (def.practice < 0 || !has(g.discoveries, def.id)) continue;
    if (g.idleYears[def.practice]! < Df.unusedForgetYears) continue;
    if (chance(s.rng, Df.unusedForgetChance)) {
      loseDiscovery(s, g, def.id, `nobody practised ${PRACTICE_NAMES[def.practice]!.toLowerCase()} for ${g.idleYears[def.practice]} years`);
    }
  }
}

/**
 * Yearly bookkeeping of practice and needs (F2 §8.1–8.2): last year's needs become this year's
 * (0–1), idle activities count up, and practice fades 2%.
 */
export function yearlyPractice(g: Group): void {
  const months = CONFIG.time.ticksPerYear;
  for (let k = 0; k < g.needs.length; k++) {
    // Hunger and cold are summed month by month; war losses are added as shares of the full need.
    // Hunger and cold are averaged over the months; war, fires and floods are counted strikes.
    const v = k === Need.war || k === Need.fires || k === Need.floods ? g.needAcc[k]! : g.needAcc[k]! / months;
    g.needs[k] = Math.min(1, Math.max(0, v));
    g.needAcc[k] = 0;
  }
  for (let p = 0; p < g.practice.length; p++) {
    g.idleYears[p] = g.practiceYear[p]! > 0 ? 0 : Math.min(65535, g.idleYears[p]! + 1);
    g.practiceYear[p] = 0;
    g.practice[p] = g.practice[p]! * (1 - PR.decayPerYear);
  }
}

/** Starts the lesson of a hazard that just struck the group (§4.5): its prevention discoveries ×3 for 30 years. */
export function learnLesson(s: SimState, g: Group, hazard: number): void {
  g.lessons[hazard] = Math.min(65535, s.year + FU.lessons.years);
}

/** True if a lesson that makes discovery d likelier is still running. */
export const lessonActive = (s: SimState, g: Group, d: number): boolean =>
  LESSONS_FOR[d]!.some((h) => g.lessons[h]! > s.year);

/** Practice share of discovery d's activity: practice / (24 × population), at most 1. */
export function practiceShare(g: Group, d: number, pop: number): number {
  const p = DISCOVERIES[d]!.practice;
  if (p < 0 || pop <= 0) return 0;
  return Math.min(1, g.practice[p]! / (PR.full * pop));
}

/**
 * Resource use (§12.6): Stone Tools, Pottery, Mud Brick, Copper, Bronze and Iron Working each use
 * ceil(population / 50) units a year from the nearest known deposits. F1 adds wood: Pottery fires
 * a kiln, and metal is smelted with charcoal into the group's metal stock. Without enough, the
 * discovery goes inactive (logged once) until a year when there is enough again — except that a
 * metal discovery keeps working while its stock of tools covers the year.
 */
export function useResources(s: SimState, g: Group, deposits = resourceTiles(s)): void {
  const pop = population(g);
  const units = Math.ceil(pop / D.resourceUsePer);
  for (const def of DISCOVERIES) {
    if (!has(g.discoveries, def.id)) continue;
    const wood = yearlyWoodOf(def.id, pop, units);
    if (def.uses === Resource.None && wood === 0) continue;
    const tiles = def.uses === Resource.None ? [] : knownResourceTiles(s, g, def.uses, deposits);
    const oreOk = def.uses === Resource.None || availableUnits(s, tiles) >= units;
    const woodOk = g.wood >= wood;
    const metal = SMELT_WOOD[def.id] !== undefined;
    if (oreOk && woodOk) {
      takeUnits(s, tiles, def.uses === Resource.None ? 0 : units);
      g.wood -= wood;
      if (metal) g.metal += units;
      setActive(g, def.id);
    } else if (metal && g.metal >= units) {
      // Old tools are reworked: the stock covers this year.
      g.metal -= units;
      setActive(g, def.id);
    } else {
      const lacking = oreOk ? 'wood' : RESOURCE_NAMES[def.uses];
      setInactive(s, g, def.id, oreOk ? Lack.Wood : Lack.Resource, `${g.name} ran out of ${lacking} (${def.name} stops working)`);
    }
  }
  g.metal *= 1 - CONFIG.future.smelt.metalWearPerYear;
}

/** Rolls every discovery the group could make this year, in id order (§12.3). */
export function rollDiscoveries(s: SimState, g: Group): void {
  const pop = population(g);
  const found = foundMask(s, g, wantedFound(g));
  const x: ChanceInputs = {
    avgInt: traitAverages(s, g).int,
    avgCoop: traitAverages(s, g).coop,
    population: pop,
    fed12: fed12(g),
    writing: has(g.discoveries, Discovery.writing),
    teachBonus: g.teachBonus,
    specialists: g.specialists,
  };
  for (const def of DISCOVERIES) {
    if (!canDiscover(g, def, found, pop)) continue;
    x.practiceShare = practiceShare(g, def.id, pop);
    x.need = def.need >= 0 ? g.needs[def.need]! : 0;
    x.lesson = lessonActive(s, g, def.id);
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
  g.teachBonus = 1 + Math.min(T.maxBonus, (T.perShare * teachers) / Math.max(1, population(g)));
  g.teacherMonths = 0;
}

/** Yearly step 3 (§5.1): resources, every group in id order. */
export function yearlyResources(s: SimState): void {
  const deposits = resourceTiles(s);
  for (const g of s.groups) {
    useResources(s, g, deposits);
    yearlyVessels(s, g);
  }
}

/**
 * Yearly step 4 (§5.1): practice and needs roll over, forgetting (too few people, then unused
 * skills, F2), new discoveries, then the era.
 */
export function yearlyDiscoveries(s: SimState): void {
  for (const g of s.groups) {
    updateTeachBonus(g);
    yearlyPractice(g);
    forgetting(s, g);
    forgetUnused(s, g);
    rollDiscoveries(s, g);
    updateEra(s, g);
  }
}
