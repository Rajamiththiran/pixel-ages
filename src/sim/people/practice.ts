// Practice and needs (future blueprint F2, §8.1–8.2): what a group has been doing and what it
// has been suffering, month by month. Both make related discoveries likelier.

import { CONFIG } from '../../config';
import { Action, Ground, Hazard, Need, Practice, Season } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import type { Group, SimState } from '../state';
import { hasActive } from './explore';
import { plagued } from '../events';
import { learnLesson } from '../progress/discoveryRules';

const PR = CONFIG.future.practice;

/** The activity each job practises (jobs not listed practise nothing). */
const PRACTICE_OF_ACTION: Readonly<Record<number, number>> = {
  [Action.Gather]: Practice.gathering,
  [Action.Hunt]: Practice.hunting,
  [Action.Farm]: Practice.farming,
  [Action.Herd]: Practice.herding,
  [Action.Fish]: Practice.fishing,
  [Action.CutWood]: Practice.woodWork,
  [Action.Build]: Practice.building,
  [Action.Wall]: Practice.building,
};

export function addPractice(g: Group, p: number, months: number): void {
  if (months <= 0) return;
  g.practice[p] = g.practice[p]! + months;
  g.practiceYear[p] = g.practiceYear[p]! + months;
}

const WINTER_MONTHS = CONFIG.seasonOfMonth.filter((x) => x === Season.Winter).length;

/**
 * One month of practice and needs. `workers(action)` is how many worked each job this month
 * (whole people in a band, shares in a village); `adults` are everyone 15+.
 */
export function monthlyPractice(s: SimState, g: Group, workers: (action: number) => number, adults: number): void {
  for (const [action, p] of Object.entries(PRACTICE_OF_ACTION)) addPractice(g, p, workers(Number(action)));
  // Work without a job of its own: part of everyone's month (DECISIONS 9.3).
  const fire = hasActive(g, Discovery.fire);
  if (fire) addPractice(g, Practice.fireUse, adults * PR.fireUseShare);
  if (hasActive(g, Discovery.pottery) || hasActive(g, Discovery.mudBrick)) addPractice(g, Practice.clayWork, adults * PR.clayWorkShare);
  if (hasActive(g, Discovery.copperWorking) || hasActive(g, Discovery.bronzeWorking) || hasActive(g, Discovery.ironWorking)) {
    addPractice(g, Practice.metalWork, adults * PR.metalWorkShare);
  }
  if (hasActive(g, Discovery.raft) || hasActive(g, Discovery.boat)) addPractice(g, Practice.sailing, adults * PR.sailingShare);

  // Needs: hunger every month; cold in winter without a fire, or in desert/mountains without clothing.
  g.needAcc[Need.hunger] = g.needAcc[Need.hunger]! + g.hunger / 100;
  if (CONFIG.seasonOfMonth[s.month] === Season.Winter) {
    const ground = s.ground[g.homeY * s.width + g.homeX];
    const harsh = (ground === Ground.Desert || ground === Ground.Mountain) && !hasActive(g, Discovery.clothing);
    const cold = (fire ? 0 : 0.5) + (harsh ? 0.5 : 0);
    // Scaled so that a whole cold winter averages to `cold` over the year.
    g.needAcc[Need.cold] = g.needAcc[Need.cold]! + (cold * CONFIG.time.ticksPerYear) / WINTER_MONTHS;
  }
  // Disasters teach (§4.5): a planned Plague is an outbreak, so Wells and Sewers get its lesson
  // for 30 years after it last struck. The other hazards arrive in F5.
  if (plagued(s, g)) learnLesson(s, g, Hazard.Outbreak);
}

/** A battle: every fighting adult practises fighting; losses add to the war need (10% lost = full). */
export function battlePractice(g: Group, fighters: number, lost: number, popBefore: number): void {
  addPractice(g, Practice.fighting, fighters * PR.fightingPerBattle);
  if (popBefore > 0) g.needAcc[Need.war] = g.needAcc[Need.war]! + lost / popBefore / CONFIG.future.needs.warLossFull;
}
