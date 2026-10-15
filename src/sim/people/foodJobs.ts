// Food jobs scored by the food they would bring this month (future blueprint F0, §6.1;
// replaces the v1 §11.6 scores for Gather, Hunt, Farm and Herd). In v1 the hunt score was
// about a quarter of the gather score, so bands starved next to herds of deer.
//
//   score(job) = base(job) + (H + hungerFloor) × expectedFood(job) / gatherCap
//
// A full gatherer (2 FU) at H = 0 scores 15 — the same as v1's gather score — so the support
// jobs (explore, care, build, teach) keep their v1 balance.

import { CONFIG } from '../../config';
import { Species } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import type { Group, SimState } from '../state';
import { rainFactor } from '../world/climate';
import { hasActive } from './explore';
import { nearWater, soilMult } from './farming';

const F = CONFIG.people.food;
const J = CONFIG.people.brain.food;
const T = CONFIG.future.tools;

/** What the range offers this month, worked out once per group. */
export interface FoodOutlook {
  plantFood: number;             // Σ plant food stock over the range
  prey: number;                  // Σ prey density over the range
  bestPrey: number;              // the richest prey tile's density
  bestWildHerd: number;          // the richest wild herd tile's density
  fieldRain: number;             // farm rain factor × soil (F3) of the best field (or candidate), 0 if none
  fish: number;                  // F3: Σ fish density over the waters in range
  bestFish: number;              // F3: the richest water tile's fish density
}

export function foodOutlook(
  s: SimState, g: Group, range: readonly number[], farmCandidates: readonly number[], waters: readonly number[] = [],
): FoodOutlook {
  const preyA = s.animal[Species.Prey];
  const herdA = s.animal[Species.Herd];
  let plantFood = 0, prey = 0, bestPrey = 0, bestWildHerd = 0;
  for (const i of range) {
    plantFood += s.plantFood[i]!;
    prey += preyA[i]!;
    if (preyA[i]! > bestPrey) bestPrey = preyA[i]!;
    if (herdA[i]! > bestWildHerd) bestWildHerd = herdA[i]!;
  }
  const field = g.farmTiles[0] ?? farmCandidates[0];
  let fieldRain = 0;
  if (field !== undefined) {
    const rf = rainFactor(s.rainNow[field]!);
    fieldRain = (hasActive(g, Discovery.irrigation) && nearWater(s, field) ? Math.max(rf, 1) : rf) * soilMult(s, field);
  }
  let fish = 0, bestFish = 0;
  for (const i of waters) {
    fish += s.fish[i]!;
    if (s.fish[i]! > bestFish) bestFish = s.fish[i]!;
  }
  return { plantFood, prey, bestPrey, bestWildHerd, fieldRain, fish, bestFish };
}

/** Chance that one hunter catches something this month (§11.5). */
export function huntSuccess(g: Group, strength: number, avgCoop: number): number {
  return Math.min(F.huntMaxSuccess,
    F.huntBaseSuccess * (F.huntStrengthBase + strength / 100)
    * (hasActive(g, Discovery.stoneTools) ? 1 : F.huntNoToolsMult)
    * (hasActive(g, Discovery.spear) ? F.huntSpearMult : 1)
    * (hasActive(g, Discovery.bow) ? T.bowHunt : 1)
    * (hasActive(g, Discovery.dogs) ? CONFIG.future.animals.dogsHunt : 1)
    * (1 + avgCoop / F.huntCoopDivisor));
}

/** A gatherer's cap this month (FU). */
export const gatherCapOf = (g: Group, mult: number): number =>
  F.gatherCap * mult * (hasActive(g, Discovery.stoneTools) ? F.stoneToolsGatherMult : 1)
  * (hasActive(g, Discovery.diggingStick) ? T.diggingStickGather : 1);

/** Farm tools: Iron Working ×1.2, Sickle ×1.1 (F2). */
export const farmToolMult = (g: Group): number =>
  (hasActive(g, Discovery.ironWorking) ? F.ironFarmMult : 1) * (hasActive(g, Discovery.sickle) ? T.sickleFarm : 1);

/** One more gatherer: their cap, but never more than the plant food left per gatherer. */
export const expectedGather = (cap: number, o: FoodOutlook, gatherers: number): number =>
  Math.min(cap, o.plantFood / (gatherers + 1));

/**
 * One more hunter: success × yield × best prey density, but never more than a sustainable
 * share of all the prey in range per hunter (many hunters empty a range).
 */
export const expectedHunt = (success: number, mult: number, o: FoodOutlook, hunters: number): number =>
  Math.min(success * F.huntYield * o.bestPrey * mult, (o.prey * F.huntYield * J.preyMonthlyShare) / (hunters + 1));

/** One more farmer this season on the best field. */
export function expectedFarm(s: SimState, g: Group, o: FoodOutlook, mult: number): number {
  const season = CONFIG.seasonOfMonth[s.month % 12]!;
  return F.farmerCap * F.farmSeason[season]! * o.fieldRain * mult * farmToolMult(g);
}

/**
 * One more herder: the animals left to tend now, plus the animals they would catch counted
 * as `herdInvestMonths` of future food (a herd has to be built up before it feeds anyone).
 */
export function expectedHerd(g: Group, o: FoodOutlook, capacity: number, herders: number, mult: number): number {
  const tend = Math.max(0, Math.min(F.herdPerHerder, g.herd - herders * F.herdPerHerder));
  const catchNow = g.herd < capacity ? Math.min(F.herdCapturePerHerder, o.bestWildHerd * F.herdAnimalsPerDensity) : 0;
  return (tend + catchNow * J.herdInvestMonths) * F.herdYieldPerAnimal * mult;
}

/** One fisher's catch at density d (F3 §9.1): 2 FU × d × yield × (Nets ? 1.5 : 1). */
export const fishCatch = (g: Group, d: number, mult: number): number =>
  CONFIG.future.fish.yield * d * mult * (hasActive(g, Discovery.fishingNets) ? CONFIG.future.fish.netsMult : 1);

/** One more fisher: the best water's catch, but no more than a sustainable share of all the fish in range. */
export const expectedFish = (g: Group, mult: number, o: FoodOutlook, fishers: number): number =>
  Math.min(fishCatch(g, o.bestFish, mult), (fishCatch(g, o.fish, mult) * J.preyMonthlyShare) / (fishers + 1));

/** Score of a food job from its expected food (§6.1 of the future blueprint). */
export const foodScore = (base: number, H: number, expected: number): number =>
  base + (H + J.hungerFloor) * (expected / F.gatherCap);
