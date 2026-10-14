// Life cycle of a band (§11.9): pairing, births, deaths, aging, health.

import { CONFIG } from '../../config';
import { Action, Ground, Season, Sex } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { chance, int } from '../../shared/rng';
import type { Group, SimState } from '../state';
import { allocPerson } from './persons';
import { fixActualTraits, inheritAll } from './inheritance';
import { hasActive } from './explore';
import { logEvent } from './groups';

const P = CONFIG.people;
const AGE = P.ages;

const isKin = (s: SimState, a: number, b: number): boolean => {
  const p = s.persons;
  const ida = p.id[a]!, idb = p.id[b]!;
  if (p.motherId[a] === idb || p.fatherId[a] === idb || p.motherId[b] === ida || p.fatherId[b] === ida) return true;
  const ma = p.motherId[a]!, fa = p.fatherId[a]!;
  return (ma >= 0 && ma === p.motherId[b]) || (fa >= 0 && fa === p.fatherId[b]);
};

/**
 * Unpaired women 16+, in id order, each pair with a random unpaired man 16+ who isn't close
 * kin and is at most 20 years older or 5 years younger than her (DECISIONS 3.2).
 */
export function pairing(s: SimState, g: Group): void {
  const p = s.persons;
  const minAge = P.birth.minAge * 12;
  const olderMan = P.pairMaxOlderMan * 12;
  const olderWoman = P.pairMaxOlderWoman * 12;
  const single = (slot: number): boolean => p.partnerId[slot] === -1 && p.ageMonths[slot]! >= minAge;
  for (const w of g.members) {
    if (p.sex[w] !== Sex.Female || !single(w)) continue;
    const options = g.members.filter((m) => {
      if (p.sex[m] !== Sex.Male || !single(m) || isKin(s, w, m)) return false;
      const diff = p.ageMonths[m]! - p.ageMonths[w]!; // > 0: he is older
      return diff <= olderMan && -diff <= olderWoman;
    });
    if (options.length === 0) continue;
    const m = options[int(s.rng, options.length)]!;
    p.partnerId[w] = p.id[m]!;
    p.partnerId[m] = p.id[w]!;
  }
}

/** Women 16–40 with a living partner and no baby at the breast: 5% a month (2.5% when hungry). */
export function births(s: SimState, g: Group): void {
  const p = s.persons;
  const B = P.birth;
  const mothers = g.members.filter((w) =>
    p.sex[w] === Sex.Female && p.partnerId[w] !== -1 && p.nursing[w] === 0
    && p.ageMonths[w]! >= B.minAge * 12 && p.ageMonths[w]! < (B.maxAge + 1) * 12);
  const rate = g.hunger > B.hungryAboveH ? B.hungryMonthlyChance : B.monthlyChance;
  for (const mom of mothers) {
    if (!chance(s.rng, rate)) continue;
    const dad = p.slotOf.get(p.partnerId[mom]!);
    if (dad === undefined) continue;
    const child = allocPerson(p);
    p.groupId[child] = g.id;
    p.sex[child] = chance(s.rng, 0.5) ? Sex.Female : Sex.Male;
    p.motherId[child] = p.id[mom]!;
    p.fatherId[child] = p.id[dad]!;
    inheritAll(s.rng, p, child, mom, dad);
    p.health[child] = P.health.max;
    p.fed[child] = 1;
    p.nutrition[child] = 1;
    p.action[child] = Action.Child;
    p.workTile[child] = p.workTile[mom]!;
    // Looks run in families: each feature comes from one parent.
    p.skin[child] = chance(s.rng, 0.5) ? p.skin[mom]! : p.skin[dad]!;
    p.hair[child] = chance(s.rng, 0.5) ? p.hair[mom]! : p.hair[dad]!;
    p.nursing[mom] = B.nursingMonths;
    g.members.push(child); // newest id, so the list stays sorted
  }
}

/** Monthly death chance from the forager table (§11.9), before multipliers. */
export function baseDeathRate(ageMonths: number): number {
  const age = ageMonths / 12;
  for (const row of P.deathMonthly) if (age < row.upToAge) return row.p;
  return 1;
}

/** Rolls deaths for every member; returns the slots that died. */
export function deaths(s: SimState, g: Group): number[] {
  const p = s.persons;
  const M = P.deathMult;
  const homeGround = s.ground[g.homeY * s.width + g.homeX];
  const harshHome = (homeGround === Ground.Desert || homeGround === Ground.Mountain) && !hasActive(g, Discovery.clothing);
  const winter = CONFIG.seasonOfMonth[s.month] === Season.Winter;
  const groupMult = (harshHome ? M.harshHomeNoClothing : 1)
    * (winter && !hasActive(g, Discovery.fire) ? M.winterNoFire : 1)
    * (hasActive(g, Discovery.mudBrick) ? M.mudBrick : 1);
  const careMult = g.carers > 0 ? Math.max(P.care.minMult, 1 - P.care.reductionPerCarer * g.carers) : 1;
  const dead: number[] = [];
  for (const slot of g.members) {
    const months = p.ageMonths[slot]!;
    if (months >= AGE.maxAge * 12) { dead.push(slot); continue; }
    const fed = p.fed[slot]!;
    let rate = baseDeathRate(months) * groupMult;
    if (fed < P.fed.starvingBelow) rate *= M.starving;
    else if (fed < P.fed.malnourishedBelow) rate *= M.malnourished;
    if (p.health[slot]! < P.health.lowBelow) rate *= M.lowHealth;
    if (months < AGE.adult * 12) rate *= careMult;
    if (chance(s.rng, rate)) dead.push(slot);
  }
  for (const slot of dead) p.alive[slot] = 0;
  return dead;
}

/** One month older; at exactly 15 the actual traits are fixed (§11.4). */
export function aging(s: SimState, g: Group): void {
  const p = s.persons;
  const adultMonths = AGE.adult * 12;
  const writing = hasActive(g, Discovery.writing);
  for (const slot of g.members) {
    p.ageMonths[slot] = p.ageMonths[slot]! + 1;
    if (p.nursing[slot]! > 0) p.nursing[slot] = p.nursing[slot]! - 1;
    if (p.ageMonths[slot] === adultMonths) fixActualTraits(p, slot, g.era, writing);
  }
}

/** −20 when starving; no change if hurt this month; otherwise +10 (+20 when resting). */
export function updateHealth(s: SimState, g: Group): void {
  const p = s.persons;
  const H = P.health;
  for (const slot of g.members) {
    let h = p.health[slot]!;
    if (p.fed[slot]! < P.fed.starvingBelow) h -= H.starvingLoss;
    else if (!p.injured[slot]) h += p.action[slot] === Action.Rest ? H.restRegen : H.regen;
    p.health[slot] = Math.min(H.max, Math.max(0, h));
    p.injured[slot] = 0;
  }
}

/** Logs once if the band can no longer have children (§11.1). */
export function checkCanReproduce(s: SimState, g: Group): void {
  if (g.cannotReproduceLogged) return;
  const p = s.persons;
  const B = P.birth;
  let man = false, boy = false, woman = false, girl = false;
  for (const slot of g.members) {
    const age = p.ageMonths[slot]! / 12;
    if (p.sex[slot] === Sex.Male) {
      if (age >= B.minAge) man = true; else boy = true;
    } else if (age >= B.minAge && age <= B.maxAge) woman = true;
    else if (age < B.minAge) girl = true;
  }
  if ((!man && !boy) || (!woman && !girl)) {
    g.cannotReproduceLogged = true;
    logEvent(s, 'cannotReproduce', `${g.name} can no longer have children`, g);
  }
}
