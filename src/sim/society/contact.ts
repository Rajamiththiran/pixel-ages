// Contact between groups (§14), yearly: groups whose homes are close and connected meet, then
// coexist, trade, fight or absorb, decided from their pressure, cooperation and power. F6 (§12)
// adds weapons and walls, culture, language, inequality, raids, alliances and intermarriage.

import { CONFIG } from '../../config';
import { Culture, Mode } from '../../shared/ids';
import { Discovery, DISCOVERIES, has, sameMask } from '../../shared/discoveries';
import { battlePractice } from '../people/practice';
import { addWear, roadBetween } from '../world/landscape';
import { chance, float, int, stochasticRound } from '../../shared/rng';
import type { Alliance, Group, SimState } from '../state';
import { tilesConnected } from '../world/regions';
import { addKnownTiles, hasActive } from '../people/explore';
import { BUCKETS, buryDead, logEvent, population, removeGroups, traitAverages } from '../people/groups';
import { strengthNow } from '../people/inheritance';
import { freePerson } from '../people/persons';
import { bestSite } from '../people/movement';
import { addParty, partySize, partyViable, takeAll, takeCounts, takeSlots, shareOfCounts, spawnGroup } from '../people/transfer';
import { resizeSample, toVillage, villageWorkers } from '../people/village';
import { canDiscover, foundMask, gainDiscovery, updateEra, wantedFound } from '../progress/discoveryRules';
import { pressure } from './walls';
import {
  blendCulture, craftMult, fortMult, intermarry, learnMult, mixCulture, noteContact, noteWin, outsidersJoined, pairCulture,
  rollRaid, sameLanguage, understand, weaponMult, workingAnimals,
} from './society';

const C = CONFIG.contact;
const P = CONFIG.people;
const SO = CONFIG.future.society;

// ---------- power ----------

export interface Force { adults: number; str: number; power: number }

/**
 * Fighting adults (15–59), their average strength now, and power = adults × (0.5 + str/100) ×
 * riding × the best weapon they can equip × craftspeople's quality (§14.2, F6 §12.1, §12.6).
 */
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
  const warMult = (hasActive(g, Discovery.riding) ? C.warMult.riding : 1) * weaponMult(g, adults) * craftMult(g);
  return { adults, str, power: adults * (C.powerStrBase + str / 100) * warMult };
}

// ---------- detection ----------

/**
 * Pairs of groups whose homes are within R_a + R_b (12 tiles) and connected (§14.1), found
 * with a 16-tile grid, sorted by (lower id, higher id). Working animals on either side (F6) and a
 * road between the homes (F4) each stretch that 1.5×.
 */
export function contactPairs(s: SimState): Array<[Group, Group]> {
  const maxD = 2 * P.range.forage;
  const animalMult = CONFIG.future.workAnimals.tradeMult;
  const roadMult = CONFIG.future.wear.roadTradeMult;
  const roadD = maxD * roadMult * animalMult;
  const cellOf = (g: Group): [number, number] => [Math.floor(g.homeX / C.gridCell), Math.floor(g.homeY / C.gridCell)];
  const grid = new Map<number, Group[]>();
  const key = (cx: number, cy: number): number => cy * 1024 + cx;
  for (const g of s.groups) {
    const [cx, cy] = cellOf(g);
    const list = grid.get(key(cx, cy));
    if (list) list.push(g); else grid.set(key(cx, cy), [g]);
  }
  const reach = Math.ceil(roadD / C.gridCell);
  const pairs: Array<[Group, Group]> = [];
  for (const a of s.groups) {
    const [cx, cy] = cellOf(a);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        for (const b of grid.get(key(cx + dx, cy + dy)) ?? []) {
          if (b.id <= a.id) continue;
          const d2 = (a.homeX - b.homeX) ** 2 + (a.homeY - b.homeY) ** 2;
          if (d2 > roadD * roadD) continue;
          if (d2 > maxD * maxD) {
            const reach = maxD * (workingAnimals(a) || workingAnimals(b) ? animalMult : 1);
            if (d2 > reach * reach && (d2 > (reach * roadMult) ** 2 || !roadBetween(s, a, b))) continue;
          }
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
  // F6 (§12.2–12.5); left out = neutral (the v1 scores).
  sameLanguage?: boolean;
  inequality?: number;           // pair average 0–1
  warlike?: number;              // pair average 0–100
  openness?: number;             // pair average 0–100
}

/**
 * The four scores before the random nudge. Absorb is only possible when one side is 3× stronger.
 * F6: inequality raises war and lowers trade and absorb; warlike and open cultures lean to war
 * and to trade; groups without a shared language coexist less easily.
 */
export function decisionScores(x: DecisionInputs): Record<Choice, number | null> {
  const coopAvg = Math.min(100, (x.coopA + x.coopB) / 2 + (x.sameLineage ? C.sameLineageCoopBonus : 0));
  const pPair = (x.pA + x.pB) / 2;
  const ratio = Math.max(x.powerA, x.powerB) / Math.max(1, Math.min(x.powerA, x.powerB));
  const hWeaker = x.powerA < x.powerB ? x.hA : x.powerB < x.powerA ? x.hB : Math.max(x.hA, x.hB);
  const ineq = x.inequality ?? 0;
  const warlike = (x.warlike ?? SO.cultureStart) - SO.cultureStart;
  const open = (x.openness ?? SO.cultureStart) - SO.cultureStart;
  return {
    coexist: C.coexistScore + (x.sameLanguage === false ? SO.languageCoexist : 0),
    trade: C.tradeCoopWeight * coopAvg + (x.hA < C.tradeFedBelowH && x.hB < C.tradeFedBelowH ? C.tradeFedBonus : 0)
      + (x.discoveriesDiffer ? C.tradeDiffBonus : 0) - SO.inequalityTradeWeight * ineq + SO.opennessWeight * open,
    war: C.warPressureWeight * pPair + C.warCoopWeight * (100 - coopAvg) + (ratio >= C.warRatioBonusAt ? C.warRatioBonus : 0)
      + SO.inequalityWarWeight * ineq + SO.warlikeWeight * warlike,
    absorb: ratio >= C.absorbRatio
      ? C.absorbBase + C.absorbRatioWeight * Math.min(ratio, C.absorbRatioCap) + C.absorbHungerWeight * hWeaker
        - SO.inequalityAbsorbWeight * ineq
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
  const lang = sameLanguage(a, b);
  return {
    // Kin who no longer share a language are strangers (F6 §12.5).
    coopA: traitAverages(s, a).coop, coopB: traitAverages(s, b).coop, sameLineage: a.lineageId === b.lineageId && lang,
    pA: pressure(a), pB: pressure(b), hA: a.hunger, hB: b.hunger,
    powerA: forceOf(s, a).power, powerB: forceOf(s, b).power, discoveriesDiffer: !sameMask(a.discoveries, b.discoveries),
    sameLanguage: understand(a, b), inequality: (a.inequality + b.inequality) / 2,
    warlike: pairCulture(a, b, Culture.warlike), openness: pairCulture(a, b, Culture.openness),
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

/** Every tile g knows, ascending (whole empty bytes of the bitset are skipped: speed only). */
const knownTiles = (s: SimState, g: Group): number[] => {
  const out: number[] = [];
  const n = s.width * s.height;
  for (let b = 0; b < g.known.length; b++) {
    const byte = g.known[b]!;
    if (byte === 0) continue;
    for (let k = 0; k < 8; k++) if ((byte >> k) & 1 && b * 8 + k < n) out.push(b * 8 + k);
  }
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

/**
 * The side that attacks: the one under more pressure (ties → the lower id). The other defends
 * behind its walls (F6, DECISIONS 13.9).
 */
export const attackerOf = (a: Group, b: Group): Group => (pressure(b) > pressure(a) ? b : a);

/**
 * One battle (§14.4). Conquest, if it happens, is resolved by the caller. F6: the defender's
 * power counts × its walls; allies' power adds to their side and they share its losses.
 */
export function battle(s: SimState, a: Group, b: Group, alliesA: Group[] = [], alliesB: Group[] = []): BattleResult {
  const fa = forceOf(s, a);
  const fb = forceOf(s, b);
  const help = (gs: Group[]): Array<{ g: Group; f: Force }> => gs.map((g) => ({ g, f: forceOf(s, g) }));
  const helpA = help(alliesA);
  const helpB = help(alliesB);
  const defender = attackerOf(a, b) === a ? b : a;
  const sideA = (fa.power + helpA.reduce((t, x) => t + x.f.power, 0)) * (defender === a ? fortMult(a) : 1);
  const sideB = (fb.power + helpB.reduce((t, x) => t + x.f.power, 0)) * (defender === b ? fortMult(b) : 1);
  const effA = sideA * (C.battleBase + C.battleRandom * float(s.rng));
  const effB = sideB * (C.battleBase + C.battleRandom * float(s.rng));
  const aWins = effA > effB || (effA === effB && a.id < b.id);
  const [winner, loser, effW, effL, fw, fl] = aWins ? [a, b, effA, effB, fa, fb] : [b, a, effB, effA, fb, fa];
  const [helpW, helpL] = aWins ? [helpA, helpB] : [helpB, helpA];
  const share = effW + effL > 0 ? effW / (effW + effL) : 0.5;
  const loseRate = C.loserLossBase + C.loserLossScale * share;
  const winRate = C.winnerLossBase + C.winnerLossScale * (1 - share);
  const popW = population(winner);
  const popL = population(loser);
  const loserDeaths = killAdults(s, loser, stochasticRound(s.rng, loseRate * fl.adults));
  const winnerDeaths = killAdults(s, winner, stochasticRound(s.rng, winRate * fw.adults));
  for (const [list, rate] of [[helpL, loseRate], [helpW, winRate]] as const) {
    for (const { g, f } of list) {
      const pop = population(g);
      battlePractice(g, f.adults, killAdults(s, g, stochasticRound(s.rng, rate * f.adults)), pop);
      warAdversity(s, g);
      g.underThreat = true;
    }
  }
  warAdversity(s, a);
  warAdversity(s, b);
  battlePractice(winner, fw.adults, winnerDeaths, popW);
  battlePractice(loser, fl.adults, loserDeaths, popL);
  noteWin(winner);
  for (const { g } of helpW) noteWin(g);
  const withAllies = (list: ReadonlyArray<{ g: Group }>): string => (list.length ? ` (with ${list.map((x) => x.g.name).join(', ')})` : '');
  logEvent(s, 'war', `${winner.name}${withAllies(helpW)} beat ${loser.name}${withAllies(helpL)} (${loser.name} lost ${loserDeaths} people)`, winner, loser);
  const conquered = population(loser) < C.conquerMinPop || effL < C.conquerPowerShare * effW;
  return { winner, loser, effW, effL, share, loserDeaths, winnerDeaths, conquered };
}

/**
 * A raid (F6 §12.7): a hungry group strikes a neighbour's store instead of making war. It wins
 * with power / (power + defender's power × walls); then it takes 20% of the store (and of the
 * herd, if it can keep animals). Few die: 3% of the losing side's fighters, 1% of the winners'.
 */
export function raid(s: SimState, raider: Group, target: Group): boolean {
  const fr = forceOf(s, raider);
  const ft = forceOf(s, target);
  const pr = fr.power;
  const pt = ft.power * fortMult(target);
  const success = pr > 0 && float(s.rng) < pr / (pr + pt);
  const [win, lose, fw, fl] = success ? [raider, target, fr, ft] : [target, raider, ft, fr];
  const popW = population(win);
  const popL = population(lose);
  const lost = killAdults(s, lose, stochasticRound(s.rng, SO.raidLossLose * fl.adults));
  battlePractice(win, fw.adults, killAdults(s, win, stochasticRound(s.rng, SO.raidLossWin * fw.adults)), popW);
  battlePractice(lose, fl.adults, lost, popL);
  noteWin(win);
  target.underThreat = true;
  if (!success) {
    logEvent(s, 'raid', `${target.name} drove off raiders from ${raider.name} (${lost} of them died)`, target, raider);
    return false;
  }
  const food = target.foodStock * SO.raidShare;
  target.foodStock -= food;
  raider.foodStock += food;
  let herd = 0;
  if (target.herd > 0 && hasActive(raider, Discovery.taming)) {
    herd = target.herd * SO.raidShare;
    target.herd -= herd;
    raider.herd += herd;
  }
  const animals = herd >= 1 ? ` and ${Math.floor(herd)} animals` : '';
  logEvent(s, 'raid', `${raider.name} raided ${target.name} and took ${Math.round(food)} food${animals} (${lost} died)`, raider, target);
  return true;
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
  // Captives bring their ways and their blood (F6).
  if (captives > 0) {
    mixCulture(winner, loser, captives / Math.max(1, population(winner)));
    outsidersJoined(winner);
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
  // Traders wear the route between the homes (F4): a path, a road once someone has the Wheel.
  addWear(s, a.homeX, a.homeY, b.homeX, b.homeY, CONFIG.future.wear.tradePerYear,
    hasActive(a, Discovery.wheel) || hasActive(b, Discovery.wheel));
  for (const [x, y] of [[a, b], [b, a]] as const) {
    // F6: open cultures learn more; a foreign language halves it.
    learnFrom(s, x, y, ((C.tradeLearnChance * traitAverages(s, x).int) / 100) * learnMult(x, y));
    const home = x.homeY * s.width + x.homeX;
    const share: number[] = [];
    // Tiles y knows and x doesn't, ascending: compared 8 at a time on the bitsets (speed only).
    const n = s.width * s.height;
    for (let b = 0; b < y.known.length; b++) {
      const fresh = y.known[b]! & ~x.known[b]!;
      if (fresh === 0) continue;
      for (let k = 0; k < 8; k++) {
        const i = b * 8 + k;
        if (!((fresh >> k) & 1) || i >= n || !tilesConnected(s.regionId, s.regionParent, home, i)) continue;
        if (chance(s.rng, C.tradeTileShare)) share.push(i);
      }
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
  mixCulture(strong, weak, n / Math.max(1, population(strong)));   // F6: the newcomers' ways mix in
  if (n > 0) outsidersJoined(strong);
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

/**
 * Alliances (F6 §12.7), recomputed each year before the battles: two groups at peace (coexist or
 * trade) that are both in contact with a third at least 2× stronger than either of them stand
 * together against it. New alliances are logged; ones whose threat is gone end quietly.
 */
export function updateAlliances(s: SimState, pairs: ReadonlyArray<readonly [Group, Group]>): void {
  const near = new Map<number, Set<number>>();
  const link = (x: number, y: number): void => {
    const set = near.get(x);
    if (set) set.add(y); else near.set(x, new Set([y]));
  };
  for (const [a, b] of pairs) { link(a.id, b.id); link(b.id, a.id); }
  const power = new Map<number, number>();
  const powerOf = (id: number): number => {
    let v = power.get(id);
    if (v === undefined) {
      const g = s.groups.find((o) => o.id === id);
      v = g ? forceOf(s, g).power : 0;
      power.set(id, v);
    }
    return v;
  };
  const next: Alliance[] = [];
  for (const r of s.relations) {
    if (r.kind === 'war') continue;
    const na = near.get(r.a);
    const nb = near.get(r.b);
    if (!na || !nb) continue;
    const strongest = Math.max(powerOf(r.a), powerOf(r.b));
    for (const c of [...na].sort((x, y) => x - y)) {
      if (c === r.b || !nb.has(c)) continue;
      if (strongest <= 0 || powerOf(c) < SO.allianceRatio * strongest) continue;
      const old = s.alliances.find((x) => x.a === r.a && x.b === r.b && x.against === c);
      next.push({ a: r.a, b: r.b, against: c, sinceYear: old?.sinceYear ?? s.year });
      if (!old) {
        const [ga, gb, gc] = [r.a, r.b, c].map((id) => s.groups.find((o) => o.id === id)!);
        logEvent(s, 'alliance', `${ga!.name} and ${gb!.name} allied against ${gc!.name}`, ga!, gb!);
      }
    }
  }
  s.alliances = next.sort((x, y) => x.a - y.a || x.b - y.b || x.against - y.against);
}

/** Groups allied with `g` against `enemy` this year that are still on the map. */
function alliesOf(s: SimState, g: Group, enemy: Group, gone: ReadonlySet<number>): Group[] {
  const out: Group[] = [];
  for (const al of s.alliances) {
    if (al.against !== enemy.id || (al.a !== g.id && al.b !== g.id)) continue;
    const id = al.a === g.id ? al.b : al.a;
    if (gone.has(id) || id === enemy.id) continue;
    const ally = s.groups.find((o) => o.id === id);
    if (ally && population(ally) > 0 && !out.includes(ally)) out.push(ally);
  }
  return out;
}

/** Yearly step 5 (§5.1): detect contacts, decide or continue relations, resolve them. */
export function yearlyContact(s: SimState): void {
  for (const g of s.groups) {
    g.trading = false;
    g.underThreat = false;
    g.isolationYears += 1;         // F6: until outsiders join again
  }
  const pairs = contactPairs(s);
  const inContact = new Set(pairs.map(([a, b]) => a.id * 65536 + b.id));
  s.relations = s.relations.filter((r) => inContact.has(r.a * 65536 + r.b));
  updateAlliances(s, pairs);
  const gone = new Set<number>();
  // Each pair's relation, looked up by key instead of searching the list (speed only).
  const relOf = new Map(s.relations.map((r) => [pairKey(r.a, r.b), r] as const));

  for (const [a, b] of pairs) {
    if (gone.has(a.id) || gone.has(b.id)) continue;
    noteContact(s, a, b);          // F6: speakers of one language who meet keep it one language
    if (a.lineageId !== b.lineageId) {
      const k = pairKey(a.lineageId, b.lineageId);
      if (!s.lineagesMet.includes(k)) {
        s.lineagesMet.push(k);
        s.lineagesMet.sort((x, y) => x - y);
        logEvent(s, 'firstContact', `${a.name} met ${b.name}`, a, b);
      }
    }
    let rel = relOf.get(pairKey(a.id, b.id));
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
        relOf.set(pairKey(a.id, b.id), rel);
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
      a.underThreat = true;
      b.underThreat = true;
      // A hungry attacker may raid the enemy's stores this year instead of a full battle (F6 §12.7).
      const attacker = attackerOf(a, b);
      if (attacker.hungerPeak > SO.raidHunger && rollRaid(s, attacker)) {
        raid(s, attacker, attacker === a ? b : a);
        continue;
      }
      const r = battle(s, a, b, alliesOf(s, a, b, gone), alliesOf(s, b, a, gone));
      if (r.conquered) {
        conquer(s, r.winner, r.loser);
        gone.add(r.loser.id);
      }
      continue;
    }
    if (rel!.kind === 'trade') trade(s, a, b);
    diffuse(s, a, b);
    // F6: neighbours at peace grow alike and marry each other's young people.
    blendCulture(a, b);
    intermarry(s, a, b);
    // Neighbours who went hungry this year and don't trade may raid instead of making war.
    if (rel!.kind === 'coexist') {
      for (const [x, y] of [[a, b], [b, a]] as const) {
        if (x.hungerPeak > SO.raidHunger && population(x) > 0 && population(y) > 0 && rollRaid(s, x)) raid(s, x, y);
      }
    }
  }
}

/**
 * Ideas cross between neighbours in contact (F2 §8.4), trade or not: each learns each of the
 * other's discoveries with 2% × its intelligence / 100 a year, if it meets the requirements.
 * Real basis: ideas spread between neighbours through marriage and objects.
 */
export function diffuse(s: SimState, a: Group, b: Group): void {
  const p = CONFIG.future.diffusion.contactLearnChance;
  learnFrom(s, a, b, ((p * traitAverages(s, a).int) / 100) * learnMult(a, b));
  learnFrom(s, b, a, ((p * traitAverages(s, b).int) / 100) * learnMult(b, a));
}
