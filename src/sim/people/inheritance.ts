// Genes + environment (§11.3, §11.4). Potential is inherited; the actual trait used by every
// rule is fixed at age 15 from childhood nutrition, adversity and the group's knowledge.

import { CONFIG } from '../../config';
import { gaussian, type RngState } from '../../shared/rng';
import type { PersonPool } from './persons';

const T = CONFIG.people.traits;
const E = CONFIG.people.environment;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Breeding value: parents' average plus random variation (half the population spread). */
export function inheritTrait(rng: RngState, mother: number, father: number, t: { min: number; max: number; mendelSd: number }): number {
  return clamp((mother + father) / 2 + gaussian(rng) * t.mendelSd, t.min, t.max);
}

/** Sets a newborn's potential from its parents (and its developing "actual" to the same). */
export function inheritAll(rng: RngState, p: PersonPool, child: number, mom: number, dad: number): void {
  p.potInt[child] = inheritTrait(rng, p.potInt[mom]!, p.potInt[dad]!, T.intelligence);
  p.potCoop[child] = inheritTrait(rng, p.potCoop[mom]!, p.potCoop[dad]!, T.cooperation);
  p.potStr[child] = inheritTrait(rng, p.potStr[mom]!, p.potStr[dad]!, T.strength);
  p.actInt[child] = p.potInt[child]!;
  p.actCoop[child] = p.potCoop[child]!;
  p.actStr[child] = p.potStr[child]!;
}

/** Actual traits from potential + childhood (cn = nutrition share, ca = hard-month share). */
export function actualFromChildhood(
  pot: { int: number; coop: number; str: number }, cn: number, ca: number, era: number, writing: boolean,
): { int: number; coop: number; str: number } {
  const lack = Math.max(0, E.goodNutrition - cn);
  const learning = Math.min(E.intLearningMax, E.intLearningPerEra * era + (writing ? E.intLearningWriting : 0));
  return {
    int: clamp(pot.int + clamp(-E.intNutritionSlope * lack, E.intNutritionMin, 0) + learning, T.intelligence.min, T.intelligence.max),
    str: clamp(pot.str + clamp(-E.strNutritionSlope * lack, E.strNutritionMin, 0), T.strength.min, T.strength.max),
    coop: clamp(
      pot.coop - E.coopAdversityPenalty * ca + (cn >= E.goodNutrition && ca === 0 ? E.coopGoodChildhoodBonus : 0),
      T.cooperation.min, T.cooperation.max,
    ),
  };
}

/** At exactly age 15: fix the person's actual traits (§11.4). */
export function fixActualTraits(p: PersonPool, slot: number, era: number, writing: boolean): void {
  const months = CONFIG.people.childMonths;
  const a = actualFromChildhood(
    { int: p.potInt[slot]!, coop: p.potCoop[slot]!, str: p.potStr[slot]! },
    p.childFedSum[slot]! / months, p.childAdversity[slot]! / months, era, writing,
  );
  p.actInt[slot] = a.int;
  p.actCoop[slot] = a.coop;
  p.actStr[slot] = a.str;
}

/** Strength right now: actual × food × age (§11.4). */
export function strengthNow(p: PersonPool, slot: number): number {
  const age = p.ageMonths[slot]! / 12;
  const ageMult = age > E.strAgingFromAge ? Math.max(E.strAgingMin, 1 - (age - E.strAgingFromAge) * E.strAgingPerYear) : 1;
  return p.actStr[slot]! * (E.strFoodFloor + (1 - E.strFoodFloor) * p.nutrition[slot]!) * ageMult;
}
