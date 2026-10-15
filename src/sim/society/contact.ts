// Contact between groups (§14), yearly: groups whose homes are close and connected meet, then
// coexist, trade, fight or absorb, decided from their pressure, cooperation and power.

import { CONFIG } from '../../config';
import { Mode } from '../../shared/ids';
import { Discovery, DISCOVERIES, has, sameMask } from '../../shared/discoveries';
import { battlePractice } from '../people/practice';
import { chance, float, int, stochasticRound } from '../../shared/rng';
import type { Group, SimState } from '../state';
import { tilesConnected } from '../world/regions';
import { addKnownTiles, hasActive, isKnown } from '../people/explore';
import { BUCKETS, buryDead, logEvent, population, removeGroups, traitAverages } from '../people/groups';
import { strengthNow } from '../people/inheritance';
import { freePerson } from '../people/persons';
import { bestSite } from '../people/movement';
import { addParty, partySize, partyViable, takeAll, takeCounts, takeSlots, shareOfCounts, spawnGroup } from '../people/transfer';
import { resizeSample, toVillage, villageWorkers } from '../people/village';
import { canDiscover, foundMask, gainDiscovery, updateEra, wantedFound } from '../progress/discoveryRules';
import { pressure } from './walls';

const C = CONFIG.contact;
const P = CONFIG.people;

// ---------- power ----------

export interface Force { adults: number; str: number; power: number }

/** Fighting adults (15–59), their average strength now, and power = adults × (0.5 + str/100) × warMult (§14.2). */
export function forceOf(s: SimState, g: Group): Force {
  let adults = 0;
  let str = 0;
  if (g.village) {
    const v = g.village;
    adults = v.counts[2]! + v.counts[3]! + v.counts[BUCKETS + 2]! + v.counts[BUCKETS + 3]!;
    str = villageWorkers(g).str;
  } else {
    const p = s.persons;
    let sum = 0;
    for (const slot of g.members) {
      const age = p.ageMonths[slot]! / 12;
      if (age < P.ages.adult || age > C.fightingAgeMax) continue;
      adults++;
      sum += strengthNow(p, slot);
    }
    str = adults > 0 ? sum / adults : 0;
  }
  const W = C.warMult;
  const warMult = (hasActive(g, Discovery.riding) ? W.riding : 1)
    * (hasActive(g, Discovery.copperWorking) ? W.copperWorking : 1)
    * (hasActive(g, Discovery.bronzeWorking) ? CONFIG.future.bronze.warMult : 1)
    * (hasActive(g, Discovery.ironWorking) ? W.ironWorking : 1);
  return { adults, str, power: adults * (C.powerStrBase + str / 100) * warMult };
}

// ---------- detection ----------

/**
 * Pairs of groups whose homes are within R_a + R_b (12 tiles) and connected (§14.1), found
 * with a 16-tile grid, sorted by (lower id, higher id).
 */
export function contactPairs(s: SimState): Array<[Group, Group]> {
  const maxD = 2 * P.range.forage;
  const cellOf = (g: Group): [number, number] => [Math.floor(g.homeX / C.gridCell), Math.floor(g.homeY / C.gridCell)];
  const grid = new Map<number, Group[]>();
  const key = (cx: number, cy: number): number => cy * 1024 + cx;
  for (const g of s.groups) {
    const [cx, cy] = cellOf(g);
    const list = grid.get(key(cx, cy));
    if (list) list.push(g); else grid.set(key(cx, cy), [g]);
  }
  const reach = Math.ceil(maxD / C.gridCell);
  const pairs: Array<[Group, Group]> = [];
  for (const a of s.groups) {
    const [cx, cy] = cellOf(a);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        for (const b of grid.get(key(cx + dx, cy + dy)) ?? []) {
          if (b.id <= a.id) continue;
          const d2 = (a.homeX - b.homeX) ** 2 + (a.homeY - b.homeY) ** 2;
          if (d2 > maxD * maxD) continue;
          if (!tilesConnected(s.regionId, s.regionParent, a.homeY * s.width + a.homeX, b.homeY * s.width + b.homeX)) continue;
          pairs.push([a, b]);
        }
      }
    }
  }
  return pairs.sort((x, y) => x[0].id - y[0].id || x[1].id - y[1].id);
}

// ---------- deciding (§14.2) ----------

export type Choice = 'coexist' | 'trade' | 'war' | 'absorb';

export interface DecisionInputs {
  coopA: number; coopB: number; sameLineage: boolean;
  pA: number; pB: number; hA: number; hB: number;
  powerA: number; powerB: number; discoveriesDiffer: boolean;
}

/** The four scores before the random nudge. Absorb is only possible when one side is 3× stronger. */
export function decisionScores(x: DecisionInputs): Record<Choice, number | null> {
  const coopAvg = Math.min(100, (x.coopA + x.coopB) / 2 + (x.sameLineage ? C.sameLineageCoopBonus : 0));
  const pPair = (x.pA + x.pB) / 2;
  const ratio = Math.max(x.powerA, x.powerB) / Math.max(1, Math.min(x.powerA, x.powerB));
  const hWeaker = x.powerA < x.powerB ? x.hA : x.powerB < x.powerA ? x.hB : Math.max(x.hA, x.hB);
  return {
    coexist: C.coexistScore,
    trade: C.tradeCoopWeight * coopAvg + (x.hA < C.tradeFedBelowH && x.hB < C.tradeFedBelowH ? C.tradeFedBonus : 0)
      + (x.discoveriesDiffer ? C.tradeDiffBonus : 0),
    war: C.warPressureWeight * pPair + C.warCoopWeight * (100 - coopAvg) + (ratio >= C.warRatioBonusAt ? C.warRatioBonus : 0),
    absorb: ratio >= C.absorbRatio
      ? C.absorbBase + C.absorbRatioWeight * Math.min(ratio, C.absorbRatioCap) + C.absorbHungerWeight * hWeaker
      : null,
  };
}

/** Highest score + U(0, 10) wins; ties go Coexist, Trade, War, Absorb (§14.2). */
export function decide(s: SimState, x: DecisionInputs): Choice {
  const scores = decisionScores(x);
  let best: Choice = 'coexist';
  let bestScore = -Infinity;
  for (const c of ['coexist', 'trade', 'war', 'absorb'] as const) {
    const nudge = float(s.rng) * C.nudge;   // drawn for every option, so the sequence never depends on the scores
    const sc = scores[c];
    if (sc === null) continue;
    if (sc + nudge > bestScore) { bestScore = sc + nudge; best = c; }
  }
  return best;
}

function inputsFor(s: SimState, a: Group, b: Group): DecisionInputs {
  return {
    coopA: traitAverages(s, a).coop, coopB: traitAverages(s, b).coop, sameLineage: a.lineageId === b.lineageId,
    pA: pressure(a), pB: pressure(b), hA: a.hunger, hB: b.hunger,
    powerA: forceOf(s, a).power, powerB: forceOf(s, b).power, discoveriesDiffer: !sameMask(a.discoveries, b.discoveries),
  };
}

// ---------- learning (§12.7) ----------

/** Learns each of `teacher`'s discoveries that `learner` lacks, with chance p, if requirements are met. */
function learnFrom(s: SimState, learner: Group, teacher: Group, p: number): void {
  const found = foundMask(s, learner, wantedFound(learner, teacher.discoveries));
  const pop = population(learner);
  let learned = false;
  for (const def of DISCOVERIES) {
    if (!has(teacher.discoveries, def.id) || !canDiscover(learner, def, found, pop)) continue;
    if (p < 1 && !chance(s.rng, p)) continue;
    gainDiscovery(s, learner, def.id, `${learner.name} learned ${def.name} from ${teacher.name}`);
    learned = true;
  }
  if (learned) updateEra(s, learner);
}

const knownTiles = (s: SimState, g: Group): number[] => {
  const out: number[] = [];
  for (let i = 0; i < s.width * s.height; i++) if (isKnown(g, i)) out.push(i);
  return out;
};

// ---------- war (§14.4) ----------

export interface BattleResult {
  winner: Group; loser: Group; effW: number; effL: number; share: number;
  loserDeaths: number; winnerDeaths: number; conquered: boolean;
}

/** Kills `n` fighting adults: bands weighted by (150 − strength now); villages proportionally by bucket. */
function killAdults(s: SimState, g: Group, n: number): number {
  if (n <= 0) return 0;
  if (g.village) {
    const v = g.village;
    const cells = [2, 3, BUCKETS + 2, BUCKETS + 3];
    const total = cells.reduce((t, c) => t + v.counts[c]!, 0);
    if (total === 0) return 0;
    let killed = 0;
    for (const c of cells) {
      const d = Math.min(v.counts[c]!, stochasticRound(s.rng, (n * v.counts[c]!) / total));
      v.counts[c] = v.counts[c]! - d;
      killed += d;
    }
    // The sample loses the same share of its fighting adults, then is refilled to 64.
    const fighters = v.sample.filter((m) => m.ageYears >= P.ages.adult && m.ageYears <= C.fightingAgeMax);
    let drop = Math.round((fighters.length * killed) / total);
    while (drop-- > 0 && fighters.length > 0) {
      const m = fighters.splice(int(s.rng, fighters.length), 1)[0]!;
      v.sample.splice(v.sample.indexOf(m), 1);
    }
    resizeSample(s.rng, v.sample);
    return killed;
  }
  const p = s.persons;
  const pool = g.members.filter((slot) => {
    const age = p.ageMonths[slot]! / 12;
    return age >= P.ages.adult && age <= C.fightingAgeMax;
  });
  const dead: number[] = [];
  for (let k = 0; k < n && pool.length > 0; k++) {
    const w = pool.map((slot) => Math.max(0, C.deathWeightStrength - strengthNow(p, slot)));
    const total = w.reduce((a, b) => a + b, 0);
    let r = float(s.rng) * total;
    let pick = pool.length - 1;
    for (let j = 0; j < pool.length; j++) { r -= w[j]!; if (r < 0) { pick = j; break; } }
    const slot = pool.splice(pick, 1)[0]!;
    p.alive[slot] = 0;
    dead.push(slot);
  }
  buryDead(s, g, dead);
  return dead.length;
}

/** War is a hard time for children: +3 adversity months each (§14.4). */
function warAdversity(s: SimState, g: Group): void {
  if (g.village) {
    g.village.childAdversity = Math.min(1, g.village.childAdversity + C.warAdversityMonths / P.childMonths);
    return;
  }
  const p = s.persons;
  for (const slot of g.members) {
    if (p.ageMonths[slot]! < P.ages.adult * 12) p.childAdversity[slot] = p.childAdversity[slot]! + C.warAdversityMonths;
  }
}

/** One battle (§14.4). Conquest, if it happens, is resolved by the caller. */
export function battle(s: SimState, a: Group, b: Group): BattleResult {
  const fa = forceOf(s, a);
  const fb = forceOf(s, b);
  const effA = fa.power * (C.battleBase + C.battleRandom * float(s.rng));
  const effB = fb.power * (C.battleBase + C.battleRandom * float(s.rng));
  const aWins = effA > effB || (effA === effB && a.id < b.id);
  const [winner, loser, effW, effL, fw, fl] = aWins ? [a, b, effA, effB, fa, fb] : [b, a, effB, effA, fb, fa];
  const share = effW + effL > 0 ? effW / (effW + effL) : 0.5;
  const popW = population(winner);
  const popL = population(loser);
  const loserDeaths = killAdults(s, loser, stochasticRound(s.rng, (C.loserLossBase + C.loserLossScale * share) * fl.adults));
  const winnerDeaths = killAdults(s, winner, stochasticRound(s.rng, (C.winnerLossBase + C.winnerLossScale * (1 - share)) * fw.adults));
  warAdversity(s, a);
  warAdversity(s, b);
  battlePractice(winner, fw.adults, winnerDeaths, popW);
  battlePractice(loser, fl.adults, loserDeaths, popL);
  logEvent(s, 'war', `${winner.name} beat ${loser.name} (${loser.name} lost ${loserDeaths} people)`, winner, loser);
  const conquered = population(loser) < C.conquerMinPop || effL < C.conquerPowerShare * effW;
  return { winner, loser, effW, effL, share, loserDeaths, winnerDeaths, conquered };
}

/**
 * Conquest (§14.4): half the survivors are taken captive; the rest flee as a new group if they
 * can carry on and there is somewhere 12+ tiles away; the winner may learn the loser's
 * discoveries and learns its land. The loser group is gone.
 */
export function conquer(s: SimState, winner: Group, loser: Group): void {
  const p = s.persons;
  let captives = 0;
  let fled = 0;
  // 1. Captives: a random half of the survivors.
  if (loser.village) {
    const party = takeCounts(loser, shareOfCounts(s, loser.village, C.captureShare));
    captives = partySize(party);
    addParty(s, winner, party);
  } else {
    const order = loser.members.slice();
    for (let k = order.length - 1; k > 0; k--) {
      const j = int(s.rng, k + 1);
      [order[k], order[j]] = [order[j]!, order[k]!];
    }
    const taken = order.slice(0, Math.round(order.length * C.captureShare)).sort((x, y) => p.id[x]! - p.id[y]!);
    captives = taken.length;
    addParty(s, winner, takeSlots(loser, taken));
  }
  // 2. Refugees.
  const rest = takeAll(loser);
  if (partyViable(s, rest)) {
    const site = bestSite(s, loser, [[winner.homeX, winner.homeY]], C.refugeeMinDistance);
    if (site >= 0) {
      const g = spawnGroup(s, loser, rest, site);
      fled = partySize(rest);
      logEvent(s, 'split', `${fled} people fled from ${loser.name} and founded ${g.name}`, g, loser);
    }
  }
  // Refugees who can't found a group scatter and are gone.
  if (fled === 0) for (const slot of rest.slots) freePerson(p, slot);
  // 3–4. Discoveries (50% each, requirements apply) and land.
  learnFrom(s, winner, loser, C.gainDiscoveryChance);
  addKnownTiles(s, winner, knownTiles(s, loser));
  if (winner.mode === Mode.Band && winner.members.length >= P.groupSize.toVillageAt) toVillage(s, winner);
  logEvent(s, 'conquered', `${winner.name} conquered ${loser.name} (${captives} captured${fled > 0 ? `, ${fled} fled` : ''})`, winner, loser);
  removeGroups(s, [loser]);
}

// ---------- trade and absorb ----------

/** A trading year (§14.5): each side may learn the other's discoveries and maps; both eat a little better. */
export function trade(s: SimState, a: Group, b: Group): void {
  for (const [x, y] of [[a, b], [b, a]] as const) {
    learnFrom(s, x, y, (C.tradeLearnChance * traitAverages(s, x).int) / 100);
    const home = x.homeY * s.width + x.homeX;
    const share: number[] = [];
    for (const i of knownTiles(s, y)) {
      if (isKnown(x, i) || !tilesConnected(s.regionId, s.regionParent, home, i)) continue;
      if (chance(s.rng, C.tradeTileShare)) share.push(i);
    }
    addKnownTiles(s, x, share);
  }
  a.trading = true;
  b.trading = true;
}

/** The weaker group joins the stronger one with everything it has (§14.6). */
export function absorb(s: SimState, strong: Group, weak: Group): void {
  const party = takeAll(weak);
  const n = partySize(party);
  addParty(s, strong, party);
  strong.foodStock += weak.foodStock;
  strong.herd += weak.herd;
  strong.wood += weak.wood;
  strong.metal += weak.metal;
  // The newcomers bring their skills and memories of disasters (F2).
  for (let k = 0; k < strong.practice.length; k++) {
    strong.practice[k] = strong.practice[k]! + weak.practice[k]!;
    strong.idleYears[k] = Math.min(strong.idleYears[k]!, weak.idleYears[k]!);
  }
  for (let k = 0; k < strong.lessons.length; k++) strong.lessons[k] = Math.max(strong.lessons[k]!, weak.lessons[k]!);
  addKnownTiles(s, strong, knownTiles(s, weak));
  learnFrom(s, strong, weak, 1);
  if (strong.mode === Mode.Band && strong.members.length >= P.groupSize.toVillageAt) toVillage(s, strong);
  logEvent(s, 'absorbed', `${strong.name} absorbed ${weak.name} (${n} people)`, strong, weak);
  removeGroups(s, [weak]);
}

// ---------- the yearly step ----------

const pairKey = (x: number, y: number): number => Math.min(x, y) * 65536 + Math.max(x, y);

/** Yearly step 5 (§5.1): detect contacts, decide or continue relations, resolve them. */
export function yearlyContact(s: SimState): void {
  for (const g of s.groups) g.trading = false;
  const pairs = contactPairs(s);
  const inContact = new Set(pairs.map(([a, b]) => a.id * 65536 + b.id));
  s.relations = s.relations.filter((r) => inContact.has(r.a * 65536 + r.b));
  const gone = new Set<number>();

  for (const [a, b] of pairs) {
    if (gone.has(a.id) || gone.has(b.id)) continue;
    if (a.lineageId !== b.lineageId) {
      const k = pairKey(a.lineageId, b.lineageId);
      if (!s.lineagesMet.includes(k)) {
        s.lineagesMet.push(k);
        s.lineagesMet.sort((x, y) => x - y);
        logEvent(s, 'firstContact', `${a.name} met ${b.name}`, a, b);
      }
    }
    let rel = s.relations.find((r) => r.a === a.id && r.b === b.id);
    const pa = pressure(a);
    const pb = pressure(b);
    const review = !rel || s.year >= rel.reviewYear
      || Math.abs(pa - rel.pa) > C.pressureChangeReview || Math.abs(pb - rel.pb) > C.pressureChangeReview;
    if (review) {
      const x = inputsFor(s, a, b);
      const choice = decide(s, x);
      if (choice === 'absorb') {
        const [strong, weak] = x.powerA >= x.powerB ? [a, b] : [b, a];
        absorb(s, strong, weak);
        gone.add(weak.id);
        continue;
      }
      if (!rel) {
        rel = { a: a.id, b: b.id, kind: choice, sinceYear: s.year, reviewYear: 0, pa, pb };
        s.relations.push(rel);
        s.relations.sort((x1, y1) => x1.a - y1.a || x1.b - y1.b);
        if (choice === 'trade') logEvent(s, 'tradeStart', `${a.name} and ${b.name} began to trade`, a, b);
      } else if (rel.kind !== choice) {
        if (choice === 'trade') logEvent(s, 'tradeStart', `${a.name} and ${b.name} began to trade`, a, b);
        rel.kind = choice;
        rel.sinceYear = s.year;
      }
      rel.reviewYear = s.year + C.reviewYears;
      rel.pa = pa;
      rel.pb = pb;
    }
    if (rel!.kind === 'war') {
      const r = battle(s, a, b);
      if (r.conquered) {
        conquer(s, r.winner, r.loser);
        gone.add(r.loser.id);
      }
    } else if (rel!.kind === 'trade') {
      trade(s, a, b);
    }
    if (rel!.kind !== 'war') diffuse(s, a, b);
  }
}

/**
 * Ideas cross between neighbours in contact (F2 §8.4), trade or not: each learns each of the
 * other's discoveries with 2% × its intelligence / 100 a year, if it meets the requirements.
 * Real basis: ideas spread between neighbours through marriage and objects.
 */
export function diffuse(s: SimState, a: Group, b: Group): void {
  const p = CONFIG.future.diffusion.contactLearnChance;
  learnFrom(s, a, b, (p * traitAverages(s, a).int) / 100);
  learnFrom(s, b, a, (p * traitAverages(s, b).int) / 100);
}
