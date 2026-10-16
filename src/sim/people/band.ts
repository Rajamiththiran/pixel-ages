// One month of a band (§5.1 step 5): pairing → brain → actions → spoilage → distribution →
// births → deaths → aging → health.

import { CONFIG } from '../../config';
import type { Group, SimState } from '../state';
import { chooseAction, type BandContext } from './brain';
import { doActions } from './actions';
import { computeSignals, distribute, homeRange, spoil } from './food';
import { frontierInRange, hasActive } from './explore';
import { farmCandidates, herdCapacity, herdFoundInRange } from './farming';
import { foodOutlook } from './foodJobs';
import { Discovery } from '../../shared/discoveries';
import { aging, births, checkCanReproduce, deaths, pairing, updateHealth } from './lifecycle';
import { buryDead, traitAverages } from './groups';
import { pressure, updateWallTarget } from '../society/walls';
import { ACTION_NAMES, Season } from '../../shared/ids';
import { bestForest, burnFuel, buildingWood, woodNeedYear, woodShortage } from './wood';
import { monthlyPractice } from './practice';
import { fishTiles } from '../world/fish';
import { burnTarget } from '../world/landscape';

const P = CONFIG.people;

export function updateBand(s: SimState, g: Group): void {
  const p = s.persons;
  pairing(s, g);
  const range = homeRange(s, g);
  computeSignals(s, g, range);
  updateWallTarget(s, g);
  const ctx = bandContext(s, g, range);

  for (const slot of g.members) p.action[slot] = chooseAction(s, g, ctx, slot);
  const { carers, killed } = doActions(s, g, ctx);
  buryDead(s, g, killed);
  burnFuel(s, g, g.members.length);
  monthlyPractice(s, g, (a) => ctx.chosen[a] ?? 0, ctx.adults);

  spoil(s, g);
  distribute(s, g, ctx.avgCoop, carers);
  births(s, g);
  buryDead(s, g, deaths(s, g));
  aging(s, g);
  updateHealth(s, g);
  if (g.members.length > 0) checkCanReproduce(s, g);
}

/** Families = couples, plus single parents with children under 15 (§11.6). */
export function countFamilies(s: SimState, g: Group): number {
  const p = s.persons;
  const adultMonths = P.ages.adult * 12;
  const parents = new Set<number>();
  for (const slot of g.members) {
    if (p.ageMonths[slot]! >= adultMonths) continue;
    if (p.motherId[slot]! >= 0) parents.add(p.motherId[slot]!);
    if (p.fatherId[slot]! >= 0) parents.add(p.fatherId[slot]!);
  }
  let families = 0;
  for (const slot of g.members) {
    if (p.ageMonths[slot]! < adultMonths) continue;
    const partner = p.partnerId[slot]!;
    const partnerHere = partner >= 0 && p.groupId[p.slotOf.get(partner) ?? -1] === g.id;
    if (partnerHere) { if (p.id[slot]! < partner) families++; }
    else if (parents.has(p.id[slot]!)) families++;
  }
  return families;
}

function bandContext(s: SimState, g: Group, range: number[]): BandContext {
  const p = s.persons;
  let children = 0;
  for (const slot of g.members) if (p.ageMonths[slot]! < P.ages.adult * 12) children++;
  const adults = g.members.length - children;
  const sheltered = g.huts * P.build.familiesPerHut + g.houses * P.build.familiesPerHouse;
  const farmCands = farmCandidates(s, g, range);
  const taming = hasActive(g, Discovery.taming);
  // Waters to fish (F3): only worth working out with Fishing.
  const waters = hasActive(g, Discovery.fishing) ? fishTiles(s, g.homeX, g.homeY, g.known) : [];
  const families = Math.max(0, countFamilies(s, g) - sheltered);
  const house = hasActive(g, Discovery.mudBrick);
  // Wood still needed for shelters: a hut per family, or a mud-brick house per 3 families.
  const shelterWood = buildingWood(house) * (house ? Math.ceil(families / P.build.familiesPerHouse) : families);
  return {
    farmCandidates: farmCands,
    farmSlots: P.food.farmersPerTile * (g.farmTiles.length + farmCands.length),
    herdOk: taming && (g.herd > 0 || herdFoundInRange(s, range)),
    herdCapacity: taming ? herdCapacity(s, g, range) : 0,
    pressure: pressure(g),
    outlook: foodOutlook(s, g, range, farmCands, waters),
    waters,
    // Burning (F4) happens in spring, with Fire Safety, on the forest edge nearest home.
    burnTile: CONFIG.seasonOfMonth[s.month] === Season.Spring && hasActive(g, Discovery.fireSafety) ? burnTarget(s, g, range) : -1,
    range,
    frontierInRange: frontierInRange(s, g),
    kidsRatio: children / Math.max(1, adults),
    children,
    avgCoop: traitAverages(s, g).coop,
    familiesWithoutShelter: families,
    hungriest: 100 * (1 - g.lowestFed),
    adults,
    chosen: new Int32Array(ACTION_NAMES.length),
    woodShortage: woodShortage(g, woodNeedYear(g, g.members.length, shelterWood)),
    hasForest: bestForest(s, range) >= 0,
  };
}
