// Wood and materials (future blueprint F1, §7): cutting forest, fuel for Fire, buildings,
// rafts, boats and carts. Wood cut from a tile is exactly the density that tile loses (§4.4):
// nothing appears from nowhere.

import { CONFIG } from '../../config';
import { Plant, Resource, Season } from '../../shared/ids';
import { Discovery, DISCOVERIES, addBit, clearBit, has } from '../../shared/discoveries';
import type { Group, SimState } from '../state';
import { logEvent } from './groups';
import { hasActive, rebuildFrontier } from './explore';
import { maxStock } from '../world/plants';
import { takeResource } from '../progress/deposits';
import { palisadeWoodWanted } from '../society/society';

const W = CONFIG.future.wood;
const S = CONFIG.future.smelt;

/** Why an owned discovery is inactive (Group.inactiveWhy). */
export const Lack = { None: 0, Resource: 1, Wood: 2 } as const;

/** Density points one woodcutter removes in a month: 4 units × 255 / 100 → 10. */
export const CUT_DENSITY = Math.round((W.perWorker * 255) / W.perFullTile);

/** Wood units in `density` points of forest. */
export const woodOfDensity = (density: number): number => (density * W.perFullTile) / 255;

/** The densest forest tile in the range (ties → lowest index), −1 if none. */
export function bestForest(s: SimState, range: readonly number[]): number {
  let best = -1;
  let bestD = 0;
  for (const i of range) {
    if (s.plantType[i] !== Plant.Forest) continue;
    const d = s.plantDensity[i]!;
    if (d > bestD || (d === bestD && d > 0 && i < best)) { best = i; bestD = d; }
  }
  return best;
}

/** Removes `density` points from forest tile i; an emptied tile becomes bare (Plant None). */
function thin(s: SimState, i: number, density: number): void {
  const left = s.plantDensity[i]! - density;
  if (left <= 0) {
    s.plantType[i] = Plant.None;
    s.plantDensity[i] = 0;
    s.plantFood[i] = 0;
    return;
  }
  s.plantDensity[i] = left;
  // Fewer trees hold less food; regrowth then starts from the new maximum.
  s.plantFood[i] = Math.min(s.plantFood[i]!, maxStock(s, i));
}

/**
 * `workers` woodcutter-months (may be fractional in villages). Each worker's 10 density points
 * come from the densest forest tile in range at that moment, so forest thins evenly around
 * home before any tile is cleared. Returns the last tile cut, −1 if there was no forest.
 */
export function cutWood(s: SimState, g: Group, range: readonly number[], workers = 1): number {
  let tile = -1;
  const whole = Math.floor(workers);
  const chunks = whole + (workers > whole ? 1 : 0);
  for (let k = 0; k < chunks; k++) {
    let left = k < whole ? CUT_DENSITY : Math.round((workers - whole) * CUT_DENSITY);
    while (left > 0) {
      const i = bestForest(s, range);
      if (i < 0) return tile;
      const take = Math.min(left, s.plantDensity[i]!);
      thin(s, i, take);
      g.wood += woodOfDensity(take);
      left -= take;
      tile = i;
    }
  }
  return tile;
}

// ---------- inactive because something is missing ----------

/** Marks d inactive (logged once, when it stops working). */
export function setInactive(s: SimState, g: Group, d: number, why: number, text: string): void {
  g.inactiveWhy[d] = why;
  if (has(g.inactive, d)) return;
  addBit(g.inactive, d);
  logEvent(s, 'ranOut', text, g);
}

export function setActive(g: Group, d: number): void {
  clearBit(g.inactive, d);
  g.inactiveWhy[d] = Lack.None;
}

// ---------- fuel ----------

const WINTER_MONTHS = CONFIG.seasonOfMonth.filter((x) => x === Season.Winter).length;

/** Wood a group with Fire burns in a year. */
export const fuelPerYear = (pop: number): number =>
  pop * (WINTER_MONTHS * W.fireWinter + (CONFIG.time.ticksPerYear - WINTER_MONTHS) * W.fireOther);

/**
 * Monthly: a group with Fire burns fuel; without enough, Fire stops working. A fire that went
 * out is lit again only with fuel for `fuelUrgentMonths` winter months in store, so a group
 * living on scraps of wood doesn't flicker on and off every month.
 */
export function burnFuel(s: SimState, g: Group, pop: number): void {
  if (!has(g.discoveries, Discovery.fire)) return;
  const winter = CONFIG.seasonOfMonth[s.month] === Season.Winter;
  const need = pop * (winter ? W.fireWinter : W.fireOther);
  if (has(g.inactive, Discovery.fire)) {
    if (fuelUrgent(g, pop)) return;              // still out: the scraps are kept for later
    setActive(g, Discovery.fire);
  }
  if (g.wood >= need) {
    g.wood -= need;
  } else {
    g.wood = 0;
    setInactive(s, g, Discovery.fire, Lack.Wood, `${g.name} ran out of wood (Fire stops working)`);
  }
}

// ---------- yearly wood for discoveries ----------

/** Kiln wood for Pottery in a year. */
export const kilnWood = (pop: number): number => (W.kilnPer10 * pop) / 10;

/** Charcoal per metal unit, by discovery id. */
export const SMELT_WOOD: Readonly<Record<number, number>> = {
  [Discovery.copperWorking]: S.copperWood,
  [Discovery.bronzeWorking]: S.bronzeWood,
  [Discovery.ironWorking]: S.ironWood,
};

/** Wood discovery `d` uses in a year (kiln or smelting), with `units` of ore. */
export function yearlyWoodOf(d: number, pop: number, units: number): number {
  if (d === Discovery.pottery) return kilnWood(pop);
  return (SMELT_WOOD[d] ?? 0) * units;
}

// ---------- rafts, boats, carts ----------

const VESSELS: ReadonlyArray<readonly [number, number, string]> = [
  [Discovery.raft, W.raft, 'raft'], [Discovery.boat, W.boat, 'boat'], [Discovery.cart, W.cart, 'cart'],
];

/** Wood to build discovery d's raft, boat or cart (0 if d has none). */
export const vesselWood = (d: number): number => VESSELS.find((v) => v[0] === d)?.[1] ?? 0;

/** Builds d's raft/boat/cart if it isn't built yet and the wood is there; otherwise d is inactive. */
export function buildVessel(s: SimState, g: Group, d: number): void {
  const v = VESSELS.find((x) => x[0] === d);
  if (!v || has(g.built, d)) return;
  if (g.wood >= v[1]) {
    g.wood -= v[1];
    addBit(g.built, d);
    if (d === Discovery.boat) g.boatYear = s.year;
    setActive(g, d);
  } else {
    setInactive(s, g, d, Lack.Wood, `${g.name} needs ${v[1]} wood to build a ${v[2]} (${DISCOVERIES[d]!.name} stops working)`);
  }
}

/** Yearly: worn-out boats go; missing rafts, boats and carts are built when the wood is there. */
export function yearlyVessels(s: SimState, g: Group): void {
  const raftBefore = hasActive(g, Discovery.raft);
  if (has(g.built, Discovery.boat) && s.year - g.boatYear >= W.boatLifeYears) clearBit(g.built, Discovery.boat);
  for (const [d] of VESSELS) if (has(g.discoveries, d)) buildVessel(s, g, d);
  if (raftBefore !== hasActive(g, Discovery.raft)) rebuildFrontier(s, g);
}

// ---------- buildings ----------

/** Wood for the next building: a mud-brick house with Mud Brick, else a hut. */
export const buildingWood = (house: boolean): number => (house ? W.house : W.hut);

/**
 * Pays for one hut, or one house: of stone with Stone Building and 30 stone at hand (F6), else of
 * mud brick (wood + clay). False, with nothing paid, if short.
 */
export function payBuilding(s: SimState, g: Group, house: boolean): boolean {
  const SH = CONFIG.future.stoneHouse;
  if (house && hasActive(g, Discovery.stoneBuilding) && g.wood >= SH.wood && takeResource(s, g, Resource.Stone, SH.stone)) {
    g.wood -= SH.wood;
    return true;
  }
  const wood = buildingWood(house);
  if (g.wood < wood) return false;
  if (house && !takeResource(s, g, Resource.Clay, W.houseClay)) return false;
  g.wood -= wood;
  return true;
}

// ---------- how much wood the group wants ----------

/**
 * Wood the group will need over the next 12 months: fuel, kilns, smelting, missing
 * rafts/boats/carts, plus `shelterWood` for buildings it still wants.
 */
export function woodNeedYear(g: Group, pop: number, shelterWood: number): number {
  const units = Math.ceil(pop / CONFIG.discoveries.resourceUsePer);
  let need = shelterWood + palisadeWoodWanted(g);   // F6: a threatened group saves wood for a palisade
  if (has(g.discoveries, Discovery.fire)) need += fuelPerYear(pop);
  for (const def of DISCOVERIES) if (has(g.discoveries, def.id)) need += yearlyWoodOf(def.id, pop, units);
  for (const [d, cost] of VESSELS) if (has(g.discoveries, d) && !has(g.built, d)) need += cost;
  return need;
}

/** 0–1: how much of the year's need is not in store yet. */
export const woodShortage = (g: Group, need: number): number =>
  need > 0 ? Math.min(1, Math.max(0, (need - g.wood) / need)) : 0;

/** The fire is about to go out: less wood than `fuelUrgentMonths` winter months of fuel. */
export const fuelUrgent = (g: Group, pop: number): boolean =>
  has(g.discoveries, Discovery.fire) && g.wood < pop * W.fireWinter * W.fuelUrgentMonths;

/**
 * Score of cutting wood (DECISIONS 8.3): grows with the year's shortage. When the fire is about
 * to go out, a woodcutter is worth the fire's cooking bonus (food × 1.15), scored like a food job,
 * so even a hungry band keeps its fire burning.
 */
export function cutWoodScore(g: Group, pop: number, shortage: number): number {
  const score = W.cutBase + W.needWeight * shortage;
  if (!fuelUrgent(g, pop)) return score;
  const F = CONFIG.people.food;
  const cooking = (F.cookedMult - 1) * g.need;
  return Math.max(score, W.cutBase + ((g.hunger + CONFIG.people.brain.food.hungerFloor) * cooking) / F.gatherCap);
}
