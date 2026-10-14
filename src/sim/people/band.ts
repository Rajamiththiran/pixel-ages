// One month of a band (§5.1 step 5): pairing → brain → actions → spoilage → distribution →
// births → deaths → aging → health.

import { CONFIG } from '../../config';
import type { Group, SimState } from '../state';
import { chooseAction, type BandContext } from './brain';
import { doActions } from './actions';
import { computeSignals, distribute, rangeTiles, spoil } from './food';
import { frontierInRange } from './explore';
import { aging, births, checkCanReproduce, deaths, pairing, updateHealth } from './lifecycle';
import { buryDead, traitAverages } from './groups';

const P = CONFIG.people;

export function updateBand(s: SimState, g: Group): void {
  const p = s.persons;
  pairing(s, g);
  const range = rangeTiles(s, g);
  computeSignals(s, g, range);
  const ctx = bandContext(s, g, range);

  for (const slot of g.members) p.action[slot] = chooseAction(s, g, ctx, slot);
  const { carers, killed } = doActions(s, g, ctx);
  buryDead(s, g, killed);

  spoil(g);
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
  return {
    range,
    frontierInRange: frontierInRange(s, g),
    kidsRatio: children / Math.max(1, adults),
    children,
    avgCoop: traitAverages(s, g).coop,
    familiesWithoutShelter: Math.max(0, countFamilies(s, g) - sheltered),
    hungriest: 100 * (1 - g.lowestFed),
    adults,
    chosen: new Int32Array(12),
  };
}
