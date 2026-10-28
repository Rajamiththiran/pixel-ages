// The brain (§11.6): every person aged 15+ scores each allowed action from the group's needs
// and their own traits, adds a small seeded nudge, and takes the highest score.
// Item 2a: a job is kept for a season — its score counts × 1.5 in its first 3 months — so
// people switch only when something else is clearly better.

import { CONFIG } from '../../config';
import { Action, Season } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { float } from '../../shared/rng';
import type { Group, SimState } from '../state';
import { hasActive } from './explore';
import { strengthNow } from './inheritance';
import { yieldMult } from './food';
import { buildingWood, cutWoodScore, fuelUrgent, type WoodSource } from './wood';
import { maintainScore } from '../world/hazards';
import {
  expectedFarm, expectedFish, expectedGather, expectedHerd, expectedHunt, foodScore, gatherCapOf, huntSuccess, type FoodOutlook,
} from './foodJobs';

const B = CONFIG.people.brain;
const A = CONFIG.people.ages;

/** Group-wide facts the brain needs this month. */
export interface BandContext {
  range: number[];               // known passable tiles in forage range
  frontierInRange: number[];     // frontier tiles within explore range
  kidsRatio: number;             // children / adults
  children: number;
  avgCoop: number;               // adults' average actual cooperation
  familiesWithoutShelter: number;
  hungriest: number;             // 100 × (1 − lowest fed ratio last month)
  adults: number;
  chosen: Int32Array;            // people who already picked each action this month, by Action id
  farmCandidates: number[];      // range tiles that could become new fields, best first
  farmSlots: number;             // farmers the fields (existing + possible) can take this month
  herdOk: boolean;               // Taming, and a herd or wild herd animals in range
  herdCapacity: number;
  pressure: number;              // P (§13), for wall work
  outlook: FoodOutlook;          // food the range offers this month (food job scores)
  waters: number[];              // F3: water tiles in range to fish (empty without Fishing)
  burnTile: number;              // F4: the forest edge to burn this spring month, −1 if none
  woodShortage: number;          // 0–1 of the next 12 months' wood need not yet in store (F1)
  wood: WoodSource;              // where woodcutters can cut (F1; farther once the range is cleared)
}

/** Diminishing returns for support jobs: the more already do it, the less the next one adds. */
const crowdFactor = (ctx: BandContext, action: number): number =>
  Math.max(0, 1 - (B.supportFalloff * ctx.chosen[action]!) / Math.max(1, ctx.adults));

/** The action person `slot` takes this month (§11.6). Ties go to the lowest action id. */
export function chooseAction(s: SimState, g: Group, ctx: BandContext, slot: number): number {
  const p = s.persons;
  const age = p.ageMonths[slot]! / 12;
  if (age < A.adult) return Action.Child;
  const elder = age >= A.elder;
  const H = g.hunger;
  const int = p.actInt[slot]!;
  const coop = p.actCoop[slot]!;
  const str = strengthNow(p, slot);
  const health = p.health[slot]!;
  const mult = yieldMult(s, g, slot);
  const J = B.food;

  let best: number = Action.Gather;
  let bestScore = -1;
  // Item 2a: last month's job, kept with a bonus during its first season (stickMonths).
  const last = p.action[slot]!;
  const keep = p.jobMonths[slot]! < B.stickMonths ? last : -1;
  const consider = (action: number, score: number): void => {
    const total = Math.max(0, score) * (action === keep ? 1 + B.stickBonus : 1) + float(s.rng) * B.nudge;
    if (total > bestScore) { bestScore = total; best = action; }
  };

  // In id order: Gather 1, Hunt 2, Farm 3, Herd 4, Explore 5, Care 6, Build 7, Wall 8,
  // Rest 9, Teach 10, Fish 12, CutWood 13, Maintain 15, Burn 16. Elders (60+) only Gather, Care, Rest, Teach.
  // Food jobs: scored by the food each would bring this month (future blueprint F0).
  const o = ctx.outlook;
  consider(Action.Gather, foodScore(J.gatherBase, H, expectedGather(gatherCapOf(g, mult), o, ctx.chosen[Action.Gather]!)));
  if (!elder && age <= A.hunterMaxAge) {
    consider(Action.Hunt, foodScore(J.huntBase, H, expectedHunt(huntSuccess(g, str, ctx.avgCoop), mult, o, ctx.chosen[Action.Hunt]!)));
  }
  const season = CONFIG.seasonOfMonth[s.month]!;
  if (!elder && season !== Season.Winter && hasActive(g, Discovery.farming) && ctx.chosen[Action.Farm]! < ctx.farmSlots) {
    consider(Action.Farm, foodScore(J.farmBase, H, expectedFarm(s, g, o, mult)));
  }
  const F = CONFIG.people.food;
  if (!elder && ctx.herdOk && ctx.chosen[Action.Herd]! * F.herdPerHerder < Math.max(g.herd, F.herdPerHerder)) {
    consider(Action.Herd, foodScore(J.herdBase, H, expectedHerd(g, o, ctx.herdCapacity, ctx.chosen[Action.Herd]!, mult)));
  }
  if (!elder && age <= A.explorerMaxAge && ctx.frontierInRange.length > 0) {
    consider(Action.Explore, (B.exploreBase + (int - 100) / B.exploreIntDivisor
      + B.exploreCrowdWeight * Math.max(0, g.crowding - B.exploreCrowdStart)
      + B.exploreHungerWeight * H * (1 - g.plantAvail)) * crowdFactor(ctx, Action.Explore));
  }
  if (ctx.children > 0) {
    consider(Action.Care, (B.careKidsWeight * ctx.kidsRatio + B.careHungerWeight * ctx.hungriest) * (coop / 100)
      * crowdFactor(ctx, Action.Care));
  }
  // Building needs the wood for the next hut or house in store (F1).
  if (!elder && ctx.familiesWithoutShelter > 0 && g.wood >= buildingWood(hasActive(g, Discovery.mudBrick))) {
    consider(Action.Build, (B.buildBase + B.buildPerFamily * ctx.familiesWithoutShelter) * crowdFactor(ctx, Action.Build));
  }
  if (!elder && g.wallTarget !== null) consider(Action.Wall, B.wallWeight * ctx.pressure * (str / 100));
  if (health < CONFIG.people.health.restBelow) {
    consider(Action.Rest, B.restWeight * (CONFIG.people.health.restBelow - health));
  }
  if (age >= CONFIG.people.teach.minAge && int >= CONFIG.people.teach.minInt) {
    consider(Action.Teach, (B.teachBase + (int - 100) / B.teachIntDivisor + B.teachKidsWeight * ctx.kidsRatio)
      * crowdFactor(ctx, Action.Teach));
  }
  // Fish (F3, needs Fishing): scored by the catch, like hunting.
  if (!elder && age <= A.hunterMaxAge && ctx.waters.length > 0) {
    consider(Action.Fish, foodScore(CONFIG.future.fish.fishBase, H, expectedFish(g, mult, o, ctx.chosen[Action.Fish]!)));
  }
  // Cut wood (F1): worth more the less of the year's need is in store; a support job, so it falls off as more cut.
  if (!elder && ctx.wood.tiles.length > 0 && (ctx.woodShortage > 0 || fuelUrgent(g, g.members.length))) {
    consider(Action.CutWood, cutWoodScore(g, g.members.length, ctx.woodShortage) * crowdFactor(ctx, Action.CutWood));
  }
  // Maintain canals, levees and drains (F5): only with such works; a support job.
  const upkeep = maintainScore(g);
  if (!elder && upkeep > 0) consider(Action.Maintain, upkeep * crowdFactor(ctx, Action.Maintain));
  // Burn a forest edge (F4, Fire Safety, spring): worth more when game is scarce; one burner a month.
  const Bn = CONFIG.future.burn;
  if (!elder && ctx.burnTile >= 0 && ctx.chosen[Action.Burn]! < Bn.maxPerMonth) {
    consider(Action.Burn, Bn.base + Bn.preyWeight * (1 - g.preyAvail));
  }
  ctx.chosen[best] = ctx.chosen[best]! + 1;
  p.jobMonths[slot] = best === last ? Math.min(255, p.jobMonths[slot]! + 1) : 1;
  return best;
}
