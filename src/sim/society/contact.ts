// Contact between groups (§14), yearly: groups whose homes are close and connected meet, then
// coexist, trade, fight or absorb, decided from their pressure, cooperation and power. F6 (§12)
// adds weapons and walls, culture, language, inequality, raids, alliances and intermarriage.

import { CONFIG } from '../../config';
import { Culture, Mode } from '../../shared/ids';
import { Discovery, DISCOVERIES, has, sameMask } from '../../shared/discoveries';
import { battlePractice } from '../people/practice';
import { addWear, roadBetween } from '../world/landscape';
import { chance, float, int, stochasticRound } from '../../shared/rng';
import type { Alliance, Group, Relation, SimState } from '../state';
import { tilesConnected } from '../world/regions';
import { addKnownTiles, hasActive } from '../people/explore';
import { BUCKETS, buryDead, logEvent, logQuiet, population, removeGroups, traitAverages, villages } from '../people/groups';
import { strengthNow } from '../people/inheritance';
import { freePerson } from '../people/persons';
import { bestSite, groupViable, moveHome } from '../people/movement';
import { addParty, partySize, takeAll, takeCounts, takeSlots, shareOfCounts } from '../people/transfer';
import { resizeSample, toVillage, villageWorkers } from '../people/village';
import { canDiscover, foundMask, gainDiscovery, updateEra, wantedFound } from '../progress/discoveryRules';
import { pressure, warPressure } from './walls';
import { canHold, headOf, logFounded, makeSubject, realmOf, realmPower, sameRealm, takeRealm } from './realms';
import {
  blendCulture, craftMult, fortMult, intermarry, learnMult, mixCulture, noteContact, noteWin, outsidersJoined, pairCulture,
  rollRaid, sameLanguage, understand, weaponMult, workingAnimals,
} from './society';

const C = CONFIG.contact;
const P = CONFIG.people;
const SO = CONFIG.future.society;
const RC = CONFIG.realms;

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
  // Perfection pass (DECISIONS 20.4–20.6); left out = the F6 scores.
  kin?: number;                  // 0–1: parent or sister group, fading over the generations
  weakFailing?: boolean;         // the weaker side is starving or too small to carry on
  truce?: boolean;               // they made peace less than a generation ago
}

/**
 * The four scores before the random nudge. Absorb is only possible when one side is 3× stronger
 * and the weaker one is failing; war is impossible during a truce and unlikely between close kin.
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
    war: x.truce ? null : C.warPressureWeight * pPair + C.warCoopWeight * (100 - coopAvg) + (ratio >= C.warRatioBonusAt ? C.warRatioBonus : 0)
      + SO.inequalityWarWeight * ineq + SO.warlikeWeight * warlike - C.kinWarPenalty * (x.kin ?? 0),
    absorb: ratio >= C.absorbRatio && x.weakFailing !== false
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

/**
 * How close kin two groups are, 0–1: a group and the one it split from, or two sisters split
 * from the same group, count 1 when the younger is new and 0 after kinFadeYears (DECISIONS 20.4).
 */
export function kinship(s: SimState, a: Group, b: Group): number {
  const close = a.parentId === b.id || b.parentId === a.id || (a.parentId >= 0 && a.parentId === b.parentId);
  if (!close || !sameLanguage(a, b)) return 0;
  const age = s.year - Math.max(a.foundedYear, b.foundedYear);
  return Math.max(0, 1 - age / C.kinFadeYears);
}

/** A group that is starving or too small to carry on alone may join a stronger one (DECISIONS 20.5). */
export const failing = (g: Group): boolean => g.hunger >= C.absorbFailingHunger || population(g) < C.absorbFailingPop;

/**
 * The decision inputs for a pair. `helpA` and `helpB` are realm-mates who would fight beside
 * each side (C4): their power counts too. A subject is protected by its ruler: it cannot be absorbed.
 */
export function inputsFor(s: SimState, a: Group, b: Group, rel: Relation | undefined, helpA: Group[] = [], helpB: Group[] = []): DecisionInputs {
  const lang = sameLanguage(a, b);
  const powerA = forceOf(s, a).power + helpA.reduce((t, g) => t + forceOf(s, g).power, 0);
  const powerB = forceOf(s, b).power + helpB.reduce((t, g) => t + forceOf(s, g).power, 0);
  const weak = powerA < powerB ? a : b;
  return {
    // Kin who no longer share a language are strangers (F6 §12.5).
    coopA: traitAverages(s, a).coop, coopB: traitAverages(s, b).coop, sameLineage: a.lineageId === b.lineageId && lang,
    pA: warPressure(a, b), pB: warPressure(b, a), hA: a.hunger, hB: b.hunger,
    powerA, powerB, discoveriesDiffer: !sameMask(a.discoveries, b.discoveries),
    sameLanguage: understand(a, b), inequality: (a.inequality + b.inequality) / 2,
    warlike: pairCulture(a, b, Culture.warlike), openness: pairCulture(a, b, Culture.openness),
    kin: kinship(s, a, b), weakFailing: failing(weak) && weak.overlordId < 0,
    truce: rel !== undefined && s.year < rel.truceUntil,
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
    gainDiscovery(s, learner, def.id, `${learner.name} learned ${def.name} from ${teacher.name}`, true);
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
  // One battle of a war: a small event; the war's start and end are the big ones (DECISIONS 20.9).
  logEvent(s, 'war', `${winner.name}${withAllies(helpW)} beat ${loser.name}${withAllies(helpL)} (${loser.name} lost ${loserDeaths} people)`,
    winner, loser, null, null, true);
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
 * Conquest (§14.4): half the survivors are taken captive; the winner may learn the loser's
 * discoveries and learns its land. The rest are driven off their land: if they can carry on and
 * there is somewhere 12+ tiles away, the loser moves there and stays itself (same name, skills
 * and ways, DECISIONS 20.11); otherwise they scatter and the group is gone. Returns true if the
 * loser lives on. Real basis: tribes beaten in war lost their land and moved, as the Iroquois
 * drove out the Huron; whole peoples rarely vanished in one battle.
 */
export function conquer(s: SimState, winner: Group, loser: Group): boolean {
  const p = s.persons;
  // C4: a farming chiefdom keeps a settled village it beats; it stays and pays tribute.
  const ruler = s.groups.find((g) => g.id === headOf(winner));
  if (ruler && canHold(s, ruler, loser)) {
    subjugate(s, winner, ruler, loser);
    return true;
  }
  // 1. Captives: a random half of the survivors.
  const captives = takeCaptives(s, winner, loser, C.captureShare);
  // 2. Discoveries (50% each, requirements apply) and land.
  spoils(s, winner, loser);
  // A beaten ruler's villages go to the winner's realm if it can hold them, or go free (C4).
  const realm = takeRealm(s, ruler, loser);
  const lost = realmText(realm, ruler);
  // 3. The rest are driven off, or scatter.
  const site = groupViable(s, loser) ? bestSite(s, loser, [[winner.homeX, winner.homeY]], C.refugeeMinDistance) : -1;
  if (site >= 0) {
    const fled = population(loser);
    const km = moveHome(s, loser, site);
    logEvent(s, 'conquered', `${winner.name} drove ${loser.name} from its land (${captives} captured; ${fled} fled ${km} km${lost})`, winner, loser);
    if (realm.founded) logFounded(s, ruler!);
    return true;
  }
  for (const slot of takeAll(loser).slots) freePerson(p, slot);
  logEvent(s, 'conquered', `${winner.name} conquered ${loser.name} (${captives} captured, the rest scattered${lost})`, winner, loser);
  if (realm.founded) logFounded(s, ruler!);
  removeGroups(s, [loser]);
  return false;
}

/** "; its 3 villages went to Garden" / "; its 2 villages went free" after a ruler is beaten (C4). */
function realmText(r: { taken: number; freed: number }, ruler: Group | undefined): string {
  if (r.taken + r.freed === 0) return '';
  const parts: string[] = [];
  if (r.taken > 0) parts.push(`${r.taken} went to ${ruler!.name}`);
  if (r.freed > 0) parts.push(`${r.freed} went free`);
  return `; of its ${villages(r.taken + r.freed)}, ${parts.join(' and ')}`;
}

/** Takes `share` of the loser's survivors as captives into the winner; they bring their ways and blood (F6). */
function takeCaptives(s: SimState, winner: Group, loser: Group, share: number): number {
  const p = s.persons;
  let captives = 0;
  if (loser.village) {
    const party = takeCounts(loser, shareOfCounts(s, loser.village, share));
    captives = partySize(party);
    addParty(s, winner, party);
  } else {
    const order = loser.members.slice();
    for (let k = order.length - 1; k > 0; k--) {
      const j = int(s.rng, k + 1);
      [order[k], order[j]] = [order[j]!, order[k]!];
    }
    const taken = order.slice(0, Math.round(order.length * share)).sort((x, y) => p.id[x]! - p.id[y]!);
    captives = taken.length;
    addParty(s, winner, takeSlots(loser, taken));
  }
  if (captives > 0) {
    mixCulture(winner, loser, captives / Math.max(1, population(winner)));
    outsidersJoined(winner);
  }
  return captives;
}

/** The winner may learn the loser's discoveries (50% each, requirements apply) and learns its land. */
function spoils(s: SimState, winner: Group, loser: Group): void {
  learnFrom(s, winner, loser, C.gainDiscoveryChance);
  addKnownTiles(s, winner, knownTiles(s, loser));
  if (winner.mode === Mode.Band && winner.members.length >= P.groupSize.toVillageAt) toVillage(s, winner);
}

/**
 * C4 (plan §4.2): the beaten village stays where it is and pays tribute to the winner's ruler. A
 * tenth are taken as hostages and slaves; if it ruled villages itself, those in range come too.
 * Real basis: chiefdoms grew by making beaten neighbours tributaries, not by emptying their land.
 */
function subjugate(s: SimState, winner: Group, ruler: Group, loser: Group): void {
  const captives = takeCaptives(s, winner, loser, RC.captureShare);
  spoils(s, winner, loser);
  const r = makeSubject(s, ruler, loser);
  const who = r.taken > 0 ? `it and ${r.taken} of its villages now pay` : 'it now pays';
  const to = winner === ruler ? '' : ` to ${ruler.name}`;
  const freed = r.freed > 0 ? `; ${villages(r.freed)} went free` : '';
  logEvent(s, 'realm', `${winner.name} conquered ${loser.name}: ${who} tribute${to} (${captives} captured${freed})`, winner, loser, loser.homeX, loser.homeY);
  if (r.founded) logFounded(s, ruler);
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
 * together against it. An alliance outlives its threat by allianceKeepYears while all three are
 * still there and the two are at peace (DECISIONS 20.8). New alliances are logged; ended ones quietly.
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
  // C4: a ruler's threat is its whole realm's strength (balance of power).
  const threat = new Map<number, number>();
  const threatOf = (id: number): number => {
    let v = threat.get(id);
    if (v === undefined) {
      const g = s.groups.find((o) => o.id === id);
      v = g ? realmPower(s, g) : 0;
      threat.set(id, v);
    }
    return v;
  };
  const byId = new Map(s.groups.map((g) => [g.id, g] as const));
  const next: Alliance[] = [];
  const atPeace = new Set<number>();
  for (const r of s.relations) {
    if (r.kind === 'war') continue;
    atPeace.add(pairKey(r.a, r.b));
    const na = near.get(r.a);
    const nb = near.get(r.b);
    if (!na || !nb) continue;
    const strongest = Math.max(powerOf(r.a), powerOf(r.b));
    for (const c of [...na].sort((x, y) => x - y)) {
      if (c === r.b || !nb.has(c)) continue;
      const gc = byId.get(c);
      if (!gc || sameRealm(gc, byId.get(r.a)!) || sameRealm(gc, byId.get(r.b)!)) continue;   // nobody allies against its own realm
      if (strongest <= 0 || threatOf(c) < SO.allianceRatio * strongest) continue;
      const old = s.alliances.find((x) => x.a === r.a && x.b === r.b && x.against === c);
      next.push({ a: r.a, b: r.b, against: c, sinceYear: old?.sinceYear ?? s.year, lastYear: s.year });
    }
  }
  // One line per bloc (DECISIONS 20.8): when neighbours first band together against a group,
  // "A, B and C allied against D"; allies who join later or pairs that re-form are not news.
  const name = (id: number): Group => s.groups.find((o) => o.id === id)!;
  const announced = new Set<number>();
  for (const c of [...new Set(next.map((x) => x.against))].sort((x, y) => x - y)) {
    if (s.alliances.some((x) => x.against === c)) continue;
    // Allies who were already allied (against anyone) are not a new alliance.
    const pairs = next.filter((x) => x.against === c);
    const fresh = pairs.some((x) => !announced.has(pairKey(x.a, x.b)) && !s.alliances.some((o) => o.a === x.a && o.b === x.b));
    for (const x of pairs) announced.add(pairKey(x.a, x.b));
    if (!fresh) continue;
    const members = [...new Set(next.filter((x) => x.against === c).flatMap((x) => [x.a, x.b]))].sort((x, y) => x - y);
    const names = members.map((id) => name(id).name);
    const list = names.length <= 4 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
      : `${names.slice(0, 3).join(', ')} and ${names.length - 3} others`;
    logQuiet(s, `ally:${c}`, CONFIG.log.quietYears, 'alliance', `${list} allied against ${name(c).name}`,
      name(members[0]!), name(c), null, null, false);
  }
  // Alliances whose threat faded stay for a while: no flapping around the 2× line.
  const alive = new Set(s.groups.map((g) => g.id));
  for (const old of s.alliances) {
    if (s.year - old.lastYear >= SO.allianceKeepYears) continue;
    if (!alive.has(old.a) || !alive.has(old.b) || !alive.has(old.against) || !atPeace.has(pairKey(old.a, old.b))) continue;
    if (next.some((x) => x.a === old.a && x.b === old.b && x.against === old.against)) continue;
    next.push({ ...old });
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

/**
 * Realm-mates who fight beside `g` against `enemy` (C4): its ruler, and the realm's villages in
 * contact with the enemy. Nobody fights its own realm.
 */
function realmHelpers(s: SimState, g: Group, enemy: Group, near: ReadonlyMap<number, ReadonlySet<number>>, gone: ReadonlySet<number>): Group[] {
  if (g.overlordId < 0 && g.realmRank === 0) return [];      // free, and rules nobody
  const head = headOf(g);
  const out: Group[] = [];
  for (const m of realmOf(s, g)) {
    if (m === g || m === enemy || gone.has(m.id) || sameRealm(m, enemy) || population(m) === 0) continue;
    if (m.id === head || near.get(m.id)?.has(enemy.id)) out.push(m);
  }
  return out;
}

/** Allies of an alliance and realm-mates, each once. */
const joinSides = (x: Group[], y: Group[]): Group[] => [...x, ...y.filter((g) => !x.includes(g))];

/** A war begins (C3): its size is measured against the populations now. */
function startWar(s: SimState, rel: Relation, a: Group, b: Group): void {
  rel.warPopA = population(a);
  rel.warPopB = population(b);
  rel.warDeadA = 0;
  rel.warDeadB = 0;
  logEvent(s, 'war', `War broke out between ${a.name} and ${b.name}`, a, b);
}

/**
 * A war ends in peace when one side has lost warWearyShare of its people in it, or after
 * warMaxYears; then a truce of truceYears (DECISIONS 20.6). Real basis: early wars were seasons of
 * raids and battles until one side could bear no more losses, then a peace sealed by gifts or marriage.
 */
function endWarIfWeary(s: SimState, rel: Relation, a: Group, b: Group): void {
  const years = s.year - rel.sinceYear + 1;
  const weary = rel.warDeadA >= C.warWearyShare * Math.max(1, rel.warPopA) || rel.warDeadB >= C.warWearyShare * Math.max(1, rel.warPopB);
  if (!weary && years < C.warMaxYears) return;
  const span = years === 1 ? '1 year' : `${years} years`;
  // C4: the side that lost more of its people may submit and pay tribute rather than make peace,
  // if the other side's ruler can hold it and its realm is submitRatio× stronger (plan §4.2).
  const shareA = rel.warDeadA / Math.max(1, rel.warPopA);
  const shareB = rel.warDeadB / Math.max(1, rel.warPopB);
  const [loser, other] = shareA > shareB ? [a, b] : shareB > shareA ? [b, a] : [null, null];
  if (loser && other) {
    const ruler = s.groups.find((g) => g.id === headOf(other));
    if (ruler && canHold(s, ruler, loser) && realmPower(s, ruler) >= RC.submitRatio * realmPower(s, loser)) {
      const losses = `${a.name} lost ${rel.warDeadA}, ${b.name} lost ${rel.warDeadB}`;   // before the peace clears them
      const r = makeSubject(s, ruler, loser);
      const withIt = r.taken > 0 ? ` with ${villages(r.taken)}` : '';
      logEvent(s, 'realm', `${loser.name}${withIt} submitted to ${ruler.name} after ${span} of war (${losses})`, loser, ruler);
      if (r.founded) logFounded(s, ruler);
      return;
    }
  }
  setTruce(s, rel, a, b);
  logEvent(s, 'war', `${a.name} and ${b.name} made peace after ${span} of war (${a.name} lost ${rel.warDeadA}, ${b.name} lost ${rel.warDeadB})`, a, b);
}

/** The war is over: they live side by side, with no war for truceYears. */
function setTruce(s: SimState, rel: Relation, a: Group, b: Group): void {
  rel.kind = 'coexist';
  rel.sinceYear = s.year;
  rel.truceUntil = s.year + C.truceYears;
  rel.reviewYear = s.year + C.reviewYears;
  rel.pa = warPressure(a, b);
  rel.pb = warPressure(b, a);
}

/** A new relation between a and b (a.id < b.id), kept in (a, b) order. */
function newRelation(s: SimState, a: Group, b: Group, kind: Relation['kind']): Relation {
  const rel: Relation = {
    a: a.id, b: b.id, kind, sinceYear: s.year, reviewYear: 0, pa: warPressure(a, b), pb: warPressure(b, a),
    warPopA: 0, warPopB: 0, warDeadA: 0, warDeadB: 0, truceUntil: 0,
  };
  s.relations.push(rel);
  s.relations.sort((x, y) => x.a - y.a || x.b - y.b);
  return rel;
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
  const near = new Map<number, Set<number>>();
  for (const [a, b] of pairs) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const set = near.get(x.id);
      if (set) set.add(y.id); else near.set(x.id, new Set([y.id]));
    }
  }
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
    if (sameRealm(a, b)) {
      // C4: one realm lives in peace: goods, ideas and marriages flow, nobody fights or raids.
      if (!rel) {
        rel = newRelation(s, a, b, 'trade');
        relOf.set(pairKey(a.id, b.id), rel);
      } else if (rel.kind !== 'trade') {
        rel.kind = 'trade';
        rel.sinceYear = s.year;
      }
      trade(s, a, b);
      diffuse(s, a, b);
      blendCulture(a, b);
      intermarry(s, a, b);
      continue;
    }
    const pa = warPressure(a, b);
    const pb = warPressure(b, a);
    // A war runs its course (C3): it is not re-decided until it ends in peace or conquest.
    const review = !rel || (rel.kind !== 'war' && (s.year >= rel.reviewYear
      || Math.abs(pa - rel.pa) > C.pressureChangeReview || Math.abs(pb - rel.pb) > C.pressureChangeReview));
    if (review) {
      const x = inputsFor(s, a, b, rel, realmHelpers(s, a, b, near, gone), realmHelpers(s, b, a, near, gone));
      const choice = decide(s, x);
      if (choice === 'absorb') {
        const [strong, weak] = x.powerA >= x.powerB ? [a, b] : [b, a];
        absorb(s, strong, weak);
        gone.add(weak.id);
        continue;
      }
      const changed = !rel || rel.kind !== choice;
      if (!rel) {
        rel = newRelation(s, a, b, choice);
        relOf.set(pairKey(a.id, b.id), rel);
      } else if (changed) {
        rel.kind = choice;
        rel.sinceYear = s.year;
      }
      if (changed && choice === 'trade') {
        logQuiet(s, `trade:${pairKey(a.id, b.id)}`, CONFIG.log.quietYears, 'tradeStart', `${a.name} and ${b.name} began to trade`, a, b);
      }
      if (changed && choice === 'war') startWar(s, rel, a, b);
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
      } else {
        const r = battle(s, a, b, joinSides(alliesOf(s, a, b, gone), realmHelpers(s, a, b, near, gone)),
          joinSides(alliesOf(s, b, a, gone), realmHelpers(s, b, a, near, gone)));
        if (r.conquered) {
          // Driven off, the loser lives on elsewhere: the war is over, and a truce follows.
          // Kept as a subject (C4), the two are one realm now: no truce needed.
          if (conquer(s, r.winner, r.loser) && !sameRealm(r.winner, r.loser)) setTruce(s, rel!, a, b);
          gone.add(r.loser.id);
          continue;
        }
        rel!.warDeadA += r.winner === a ? r.winnerDeaths : r.loserDeaths;
        rel!.warDeadB += r.winner === b ? r.winnerDeaths : r.loserDeaths;
      }
      endWarIfWeary(s, rel!, a, b);
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
