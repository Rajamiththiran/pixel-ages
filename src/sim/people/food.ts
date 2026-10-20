// Food (§11.5): needs, range signals, gathering, hunting, spoilage, distribution, hunger.

import { CONFIG } from '../../config';
import { Hazard, Species } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { chance } from '../../shared/rng';
import type { Group, SimState } from '../state';
import type { PersonPool } from './persons';
import { hasActive, isKnown, passableFor } from './explore';
import { strengthNow } from './inheritance';
import { maxStock } from '../world/plants';
import { harshWinterNow, plagued } from '../events';
import { fishCatch, gatherCapOf, huntSuccess } from './foodJobs';
import { learnLesson } from '../progress/discoveryRules';
import { fishSustainable, fishTiles } from '../world/fish';
import { sick } from '../world/hazards';
import { forEach8Passable } from '../../shared/grid';
import { fieldsSustainable } from './farming';
import { craftMult, domesticMult, noteStore, selfishMult } from '../society/society';

const P = CONFIG.people;
const F = P.food;

/** Monthly food need in FU: child 0.6, adult 1.0, elder 0.8. */
export function needOf(p: PersonPool, slot: number): number {
  const age = p.ageMonths[slot]! / 12;
  return age < P.ages.adult ? P.foodNeed.child : age >= P.ages.elder ? P.foodNeed.elder : P.foodNeed.adult;
}

/**
 * The forage range: known tiles within radius R of (cx, cy) that the group can actually walk
 * to from there (8-way, no corner cutting). A river without a raft cuts the range in two
 * (DECISIONS 3.3). Ascending tile order. `radius` other than R: the far woodcutting range (F1).
 */
export function rangeTiles(s: SimState, g: Group, cx = g.homeX, cy = g.homeY, radius: number = P.range.forage): number[] {
  const R2 = radius * radius;
  const w = s.width;
  const start = cy * w + cx;
  if (!passableFor(s, g, start)) return [];
  const seen = new Set<number>([start]);
  const queue = [start];
  const pass = (j: number): boolean => passableFor(s, g, j);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    forEach8Passable(i, w, s.height, pass, (j) => {
      if (seen.has(j)) return;
      const dx = (j % w) - cx;
      const dy = Math.floor(j / w) - cy;
      if (dx * dx + dy * dy > R2) return;
      seen.add(j);
      queue.push(j);
    });
  }
  const out: number[] = [];
  for (const i of seen) if (isKnown(g, i)) out.push(i);
  return out.sort((a, b) => a - b);
}

// Each group's home range, reused until something that shapes it changes (speed only: it is a
// pure function of the state, kept outside it).
const homeRanges = new WeakMap<Group, { key: string; tiles: number[] }>();

/** Wall segments breached so far: crossings are the only way passability changes besides Raft. */
const breachCount = (s: SimState): number => {
  let n = 0;
  for (const seg of s.wallSegments) if (seg.breached) n++;
  return n;
};

/** rangeTiles around home, cached while known tiles, home, Raft and crossings stay the same. Don't mutate. */
export function homeRange(s: SimState, g: Group): number[] {
  const key = `${g.knownVersion}|${g.homeX},${g.homeY}|${hasActive(g, Discovery.raft) ? 1 : 0}|${breachCount(s)}`;
  const c = homeRanges.get(g);
  if (c && c.key === key) return c.tiles;
  const tiles = rangeTiles(s, g);
  homeRanges.set(g, { key, tiles });
  return tiles;
}

// The far woodcutting range (F1, DECISIONS 17.3), cached the same way (speed only).
const farRanges = new WeakMap<Group, { key: string; tiles: number[] }>();

/** rangeTiles of `radius` around home, cached like homeRange. Don't mutate. */
export function homeRangeOf(s: SimState, g: Group, radius: number): number[] {
  const key = `${g.knownVersion}|${g.homeX},${g.homeY}|${hasActive(g, Discovery.raft) ? 1 : 0}|${breachCount(s)}|${radius}`;
  const c = farRanges.get(g);
  if (c && c.key === key) return c.tiles;
  const tiles = rangeTiles(s, g, g.homeX, g.homeY, radius);
  farRanges.set(g, { key, tiles });
  return tiles;
}

/**
 * What a tile can give per month without running down (§11.5 sustainableYield). Prey only
 * count as much as the group can hunt them: half without Stone Tools (DECISIONS 3.4).
 */
export function tileSustainable(s: SimState, i: number, huntFactor = 1): number {
  return maxStock(s, i) * P.sustainable.plantShare + s.animal[Species.Prey][i]! * P.sustainable.preyValue * huntFactor;
}

/** How well this group can use prey, relative to full tools (matches hunting success, §11.5). */
export const huntFactor = (g: Group): number => (hasActive(g, Discovery.stoneTools) ? 1 : F.huntNoToolsMult);

/** Sustainable yield of a range's wild food (plants and prey). Fields and herds are added in computeSignals. */
export function rangeSustainable(s: SimState, range: number[], g: Group): number {
  const hf = huntFactor(g);
  let sy = 0;
  for (const i of range) sy += tileSustainable(s, i, hf);
  return sy;
}

/** Sustainable catch of the waters a group with Fishing can reach (F3); 0 without Fishing. */
export function waterSustainable(s: SimState, g: Group): number {
  if (!hasActive(g, Discovery.fishing)) return 0;
  const nets = hasActive(g, Discovery.fishingNets) ? CONFIG.future.fish.netsMult : 1;
  let sy = 0;
  for (const i of fishTiles(s, g.homeX, g.homeY, g.known)) sy += fishSustainable(s, i);
  return sy * nets;
}

/** A band's monthly food need: the sum of its members' needs. */
export function bandNeed(s: SimState, g: Group): number {
  let need = 0;
  for (const slot of g.members) need += needOf(s.persons, slot);
  return need;
}

/** Updates need, H, PA, YA, sustainable yield and crowding for this month (§11.5). */
export function computeSignals(s: SimState, g: Group, range: number[], need = bandNeed(s, g)): void {
  g.need = need;

  let plant = 0, prey = 0;
  for (const i of range) { plant += s.plantFood[i]!; prey += s.animal[Species.Prey][i]!; }
  g.plantAvail = need > 0 ? Math.min(1, Math.max(0, plant / (2 * need))) : 1;
  g.preyAvail = range.length > 0 ? Math.min(1, Math.max(0, (4 * prey) / range.length)) : 0;
  // Wild food, plus fields (10 farmers × 2 FU each, at their rain and soil) and last month's tended herd (§11.5).
  g.sustainable = rangeSustainable(s, range, g)
    + fieldsSustainable(s, g)
    + Math.min(g.herd, g.herders * F.herdPerHerder) * F.herdYieldPerAnimal * domesticMult(g)
    + waterSustainable(s, g);
  g.crowding = g.sustainable > 0 ? Math.min(P.crowdingMax, need / g.sustainable) : P.crowdingMax;
  g.hunger = hungerOf(g);
  noteStore(g);                  // F6: the year's store decides specialists and chiefs
}

/** Group hunger H (0–100): recent shortfall plus worry about an empty store. */
export function hungerOf(g: Group): number {
  const H = P.hunger;
  const n = g.fedHistory.length;
  let fed3 = 0;
  for (let k = 1; k <= H.fedMonths; k++) fed3 += g.fedHistory[(g.fedIndex - k + n) % n]!;
  fed3 /= H.fedMonths;
  const stockMonths = g.need > 0 ? g.foodStock / g.need : 0;
  return Math.min(100, H.fedWeight * (1 - fed3) + Math.max(0, H.storageWorry - H.storageWorryPerMonth * stockMonths));
}

/** Multiplier on all food a worker gains: cooking, copper tools, cleverness, trade, craftspeople's tools (F6). */
export function yieldMult(s: SimState, g: Group, slot: number): number {
  return yieldMultInt(s, g, s.persons.actInt[slot]!);
}

/**
 * yieldMult for a worker of intelligence `int` (villages use the group average). In a harsh
 * winter it halves too: that touches gathering, hunting and herding — fields give nothing in
 * winter anyway (§15).
 */
export function yieldMultInt(s: SimState, g: Group, int: number): number {
  return (hasActive(g, Discovery.fire) ? F.cookedMult : 1)
    * (hasActive(g, Discovery.copperWorking) ? F.copperMult : 1)
    * (hasActive(g, Discovery.bronzeWorking) ? CONFIG.future.bronze.foodMult : 1)
    * (1 + (int - 100) / F.intYieldDivisor)
    * (g.trading ? F.tradeMult : 1)
    * craftMult(g)
    * (harshWinterNow(s) ? CONFIG.events.harshWinterFoodMult : 1);
}

/**
 * Gather from the richest known tile in range; later gatherers find the next best (§11.5).
 * If that tile runs out before the gatherer's monthly cap, they move on to the next richest
 * tile (DECISIONS 3.1): a month of foraging covers more than one km², and it is what lets a
 * full forest range feed the 30–40 people §10.2 calibrates for. Returns the first tile.
 */
export function gather(s: SimState, g: Group, slot: number, range: number[]): number {
  let left = gatherCapOf(g, yieldMult(s, g, slot));
  let first = -1;
  for (let visits = 0; visits < F.gatherMaxTiles && left > 0; visits++) {
    let best = -1;
    let bestFood = 0;
    for (const i of range) {
      const f = s.plantFood[i]!;
      if (f > bestFood) { bestFood = f; best = i; }
    }
    if (best < 0) break;
    if (first < 0) first = best;
    const take = Math.min(left, bestFood);
    s.plantFood[best] = bestFood - take;
    g.foodStock += take;
    left -= take;
  }
  if (first >= 0) return first;
  return range.length > 0 ? range[0]! : g.homeY * s.width + g.homeX;
}

/** Hunt on the known tile in range with the most prey. Returns the tile. */
export function hunt(s: SimState, g: Group, slot: number, range: number[], avgCoop: number): number {
  const prey = s.animal[Species.Prey];
  let best = -1;
  let bestD = 0;
  for (const i of range) {
    const d = prey[i]!;
    if (d > bestD) { bestD = d; best = i; }
  }
  if (best < 0) return range.length > 0 ? range[0]! : g.homeY * s.width + g.homeX;
  const success = huntSuccess(g, strengthNow(s.persons, slot), avgCoop);
  if (chance(s.rng, success)) {
    g.foodStock += F.huntYield * bestD * yieldMult(s, g, slot);
    prey[best] = Math.max(0, bestD - F.huntDepletion);
    g.hasHunted = true;
  }
  return best;
}

/**
 * One fisher-month (F3 §9.1): fish the richest water in range (ties → lowest index), taking
 * 0.01 of its density. `part` < 1 is a village's part-time fisher. Returns the water tile, or
 * home if there is none.
 */
export function fishWork(s: SimState, g: Group, mult: number, waters: readonly number[], part = 1): number {
  let best = -1;
  let bestD = 0;
  for (const i of waters) if (s.fish[i]! > bestD) { bestD = s.fish[i]!; best = i; }
  if (best < 0) return g.homeY * s.width + g.homeX;
  g.foodStock += fishCatch(g, bestD, mult) * part;
  s.fish[best] = Math.max(0, bestD - CONFIG.future.fish.depletion * part);
  return best;
}

/**
 * Monthly food loss (§11.5, F3 §9.6): 10% (6% with Pottery) × 0.8 with Salting. A Granary halves
 * that for up to 12 months of need. Without Pottery or a Granary, food beyond 6 months of need
 * also feeds pests: 5% of it a month — and the group learns from it (Pests lesson).
 */
export function spoil(s: SimState, g: Group): void {
  const ST = CONFIG.future.store;
  const pottery = hasActive(g, Discovery.pottery);
  const granary = hasActive(g, Discovery.granary);
  const rate = (pottery ? F.spoilagePottery : F.spoilage) * (hasActive(g, Discovery.salting) ? CONFIG.future.salting.spoilageMult : 1);
  const stock = g.foodStock;
  const stored = granary ? Math.min(stock, ST.granaryMonths * g.need) : 0;
  let loss = stored * rate * ST.granarySpoilMult + (stock - stored) * rate;
  if (!pottery && !granary) {
    const pests = Math.max(0, stock - ST.pestAboveMonths * g.need) * ST.pestLoss;
    if (pests > 0) {
      loss += pests;
      learnLesson(s, g, Hazard.Pests);
    }
  }
  g.foodStock = Math.max(0, stock - loss);
}

/**
 * Shares food (§11.5). Enough for everyone → everyone eats their need. In a shortage, food is
 * split by need × weight: selfish strong adults take more, cooperative groups protect children,
 * carers give part of theirs away. Anyone whose share exceeds their need is capped and the
 * rest is shared again, so no food is wasted. Returns the group's average fed ratio.
 */
export function distribute(s: SimState, g: Group, avgCoop: number, carers: Set<number>): number {
  const p = s.persons;
  const D = P.distribution;
  const m = g.members;
  const n = m.length;
  if (n === 0) return 1;
  const plague = plagued(s, g) || sick(s, g);   // an outbreak (F5) is hard times too
  // F6: sharing cultures take less for themselves; unequal ones more.
  const selfish = D.selfishness * selfishMult(g);
  const need = new Float64Array(n);
  let total = 0;
  for (let k = 0; k < n; k++) { need[k] = needOf(p, m[k]!); total += need[k]!; }

  const received = new Float64Array(n);
  if (g.foodStock >= total) {
    for (let k = 0; k < n; k++) received[k] = need[k]!;
    g.foodStock -= total;
  } else {
    const weight = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const slot = m[k]!;
      let w = p.ageMonths[slot]! < P.ages.adult * 12
        ? D.childBase + avgCoop / 100
        : 1 + selfish * (strengthNow(p, slot) / 100) * (1 - p.actCoop[slot]! / 100);
      if (carers.has(slot)) w *= D.carerMult;
      weight[k] = need[k]! * w;
    }
    let remaining = g.foodStock;
    const active = new Uint8Array(n).fill(1);
    for (;;) {
      let W = 0;
      for (let k = 0; k < n; k++) if (active[k]) W += weight[k]!;
      if (W <= 0 || remaining <= 0) break;
      let capped = false;
      for (let k = 0; k < n; k++) {
        if (!active[k]) continue;
        if (received[k]! + (remaining * weight[k]!) / W >= need[k]!) {
          // This person's share covers them: give exactly their need and re-share the rest.
          remaining -= need[k]! - received[k]!;
          received[k] = need[k]!;
          active[k] = 0;
          capped = true;
        }
      }
      if (capped) continue;
      for (let k = 0; k < n; k++) if (active[k]) received[k] = received[k]! + (remaining * weight[k]!) / W;
      remaining = 0;
      break;
    }
    g.foodStock = Math.max(0, remaining);
  }

  let sum = 0;
  let lowest = 1;
  for (let k = 0; k < n; k++) {
    const slot = m[k]!;
    const fed = need[k]! > 0 ? Math.min(1, received[k]! / need[k]!) : 1;
    p.fed[slot] = fed;
    p.nutrition[slot] = (p.nutrition[slot]! * 11) / 12 + fed / 12;
    if (p.ageMonths[slot]! < P.ages.adult * 12) {
      p.childFedSum[slot] = p.childFedSum[slot]! + fed;
      // A hard month for a child: starving, or a plague at home (§15).
      if (fed < P.fed.starvingBelow || plague) p.childAdversity[slot] = p.childAdversity[slot]! + 1;
    }
    sum += fed;
    lowest = Math.min(lowest, fed);
  }
  const avg = sum / n;
  g.fedHistory[g.fedIndex] = avg;
  g.fedIndex = (g.fedIndex + 1) % g.fedHistory.length;
  g.lowestFed = lowest;
  g.fedYearSum += avg;
  return avg;
}
