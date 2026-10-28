// Village mode (§11.10): a group of 150+ is simulated as counts by sex and age bucket, plus a
// 64-person sample that carries genes and natural selection. Below 100 it becomes a band of
// individuals again.

import { CONFIG } from '../../config';
import { Action, Ground, Mode, Season, Sex, Species } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { chance, float, gaussian, int, stochasticRound, type RngState } from '../../shared/rng';
import type { Group, SampleMember, SimState, VillageData } from '../state';
import { frontierInRange, hasActive, revealAround, revealRadius } from './explore';
import { computeSignals, fishWork, homeRange, spoil, yieldMultInt } from './food';
import { ensureFarmTiles, farmCandidates, fieldYield, growHerd, herdCapacity, herdFoundInRange, herdWork } from './farming';
import { BUCKETS, BUCKET_START, logEvent, logQuiet, population } from './groups';
import { allocPerson, freePerson } from './persons';
import { pairing } from './lifecycle';
import { actualFromChildhood, inheritTrait } from './inheritance';
import { pressure, updateWallTarget, wearWall } from '../society/walls';
import { fed12 } from '../progress/discoveryRules';
import { fishTiles } from '../world/fish';
import { expectedFish, expectedFarm, expectedGather, expectedHerd, expectedHunt, foodOutlook, foodScore, gatherCapOf, huntSuccess } from './foodJobs';
import { eventDeathMult, plagued } from '../events';
import { monthlyPractice } from './practice';
import { hazardDeathMult, herdPredation, maintain, maintainScore, sick } from '../world/hazards';
import { walk } from '../world/landscape';
import { burnFuel, buildingWood, cutWood, cutWoodScore, fuelUrgent, otherFuel, payBuilding, woodNeedYear, woodShortage, woodSource } from './wood';
import { inbreedMult } from '../society/society';

const P = CONFIG.people;
const V = P.village;
const B = P.brain;
const F = P.food;
const E = P.environment;
const TRAITS = [P.traits.intelligence, P.traits.cooperation, P.traits.strength] as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const cell = (sex: number, bucket: number): number => sex * BUCKETS + bucket;

/** Age bucket of an age in years: 0:0–4, 1:5–14, 2:15–49, 3:50–59, 4:60–69, 5:70+. */
export function bucketOf(ageYears: number): number {
  let b = 0;
  while (b + 1 < BUCKETS && ageYears >= BUCKET_START[b + 1]!) b++;
  return b;
}

/** Strength right now (§11.4) for a sample member, with the village's nutrition. */
function sampleStrength(m: SampleMember, nutrition: number): number {
  const age = m.ageYears;
  const ageMult = age > E.strAgingFromAge ? Math.max(E.strAgingMin, 1 - (age - E.strAgingFromAge) * E.strAgingPerYear) : 1;
  return m.act[2] * (E.strFoodFloor + (1 - E.strFoodFloor) * nutrition) * ageMult;
}

/** The village's working-age (15–59) averages from its sample: intelligence, cooperation, strength now. */
export function villageWorkers(g: Group): { int: number; coop: number; str: number } {
  const v = g.village!;
  const nutrition = fed12(g);
  let n = 0, i = 0, c = 0, st = 0;
  for (const m of v.sample) {
    if (m.ageYears < P.ages.adult || m.ageYears > P.ages.hunterMaxAge) continue;
    n++;
    i += m.act[0];
    c += m.act[1];
    st += sampleStrength(m, nutrition);
  }
  return n === 0 ? { int: 0, coop: 0, str: 0 } : { int: i / n, coop: c / n, str: st / n };
}

/** Monthly food need of a village: counts × child / adult / elder need. */
export function villageNeed(v: VillageData): number {
  let need = 0;
  for (let sex = 0; sex < 2; sex++) {
    for (let b = 0; b < BUCKETS; b++) {
      const n = v.counts[cell(sex, b)]!;
      need += n * (b < 2 ? P.foodNeed.child : b >= 4 ? P.foodNeed.elder : P.foodNeed.adult);
    }
  }
  return need;
}

/** People in cells (both sexes) of the given buckets. */
function inBuckets(v: VillageData, buckets: readonly number[]): number {
  let n = 0;
  for (const b of buckets) n += v.counts[cell(Sex.Male, b)]! + v.counts[cell(Sex.Female, b)]!;
  return n;
}

// ---------- the sample ----------

export const memberOf = (s: SimState, slot: number): SampleMember => {
  const p = s.persons;
  return {
    sex: p.sex[slot]!,
    ageYears: p.ageMonths[slot]! / 12,
    pot: [p.potInt[slot]!, p.potCoop[slot]!, p.potStr[slot]!],
    act: [p.actInt[slot]!, p.actCoop[slot]!, p.actStr[slot]!],
  };
};

/** A copy of a sample member with gaussian × mendelSd / 2 noise on each trait (actual moves with potential). */
function noisyCopy(rng: RngState, m: SampleMember): SampleMember {
  const out: SampleMember = { sex: m.sex, ageYears: m.ageYears, pot: [...m.pot], act: [...m.act] };
  for (let k = 0; k < 3; k++) {
    const t = TRAITS[k]!;
    const pot = clamp(m.pot[k]! + gaussian(rng) * t.mendelSd * V.sampleNoiseShare, t.min, t.max);
    out.act[k] = clamp(pot + (m.act[k]! - m.pot[k]!), t.min, t.max);
    out.pot[k] = pot;
  }
  return out;
}

/** Resizes to exactly sampleSize: removes random members, or adds noisy copies of random ones. */
export function resizeSample(rng: RngState, sample: SampleMember[]): void {
  while (sample.length > V.sampleSize) sample.splice(int(rng, sample.length), 1);
  const base = sample.length;
  while (base > 0 && sample.length < V.sampleSize) sample.push(noisyCopy(rng, sample[int(rng, base)]!));
}

/**
 * Two samples merged in proportion to the populations they stand for, then sized to 64
 * (DECISIONS 5.6): 20 newcomers in a village of 1,000 get ~1 sample place, not 20.
 */
export function mergeSamples(rng: RngState, a: SampleMember[], popA: number, b: SampleMember[], popB: number): SampleMember[] {
  if (b.length === 0 || popB <= 0) { const out = a.slice(); resizeSample(rng, out); return out; }
  if (a.length === 0 || popA <= 0) { const out = b.slice(); resizeSample(rng, out); return out; }
  const fromB = Math.min(V.sampleSize, Math.round((V.sampleSize * popB) / (popA + popB)));
  // Too few newcomers for a place (a yearly marriage, F6): keep the sample as it is, rather than
  // redrawing it with replacement, which would wear away its variety year after year.
  if (fromB === 0) return a.map((m) => ({ ...m, pot: [...m.pot], act: [...m.act] }));
  const out: SampleMember[] = [];
  for (let k = 0; k < V.sampleSize - fromB; k++) out.push(a[int(rng, a.length)]!);
  for (let k = 0; k < fromB; k++) out.push(b[int(rng, b.length)]!);
  return out.map((m) => ({ ...m, pot: [...m.pot], act: [...m.act] }));
}

// ---------- switching (§11.10) ----------

/** Band → village: count people by sex and bucket, keep 64 at random as the sample, free the persons. */
export function toVillage(s: SimState, g: Group, reason: 'size' | 'perf' = 'size'): void {
  const p = s.persons;
  const counts = new Int32Array(2 * BUCKETS);
  let cf = 0, ca = 0, kids = 0;
  for (const slot of g.members) {
    const months = p.ageMonths[slot]!;
    counts[cell(p.sex[slot]!, bucketOf(months / 12))]! += 1;
    if (months < P.ages.adult * 12) {
      kids++;
      cf += p.childFedSum[slot]! / Math.max(1, months);
      ca += p.childAdversity[slot]! / Math.max(1, months);
    }
  }
  // 64 distinct members at random (partial Fisher–Yates over the id-ordered list).
  const pool = g.members.slice();
  const take = Math.min(V.sampleSize, pool.length);
  for (let k = 0; k < take; k++) {
    const j = k + int(s.rng, pool.length - k);
    [pool[k], pool[j]] = [pool[j]!, pool[k]!];
  }
  const sample = pool.slice(0, take).map((slot) => memberOf(s, slot));
  resizeSample(s.rng, sample);
  const pop = g.members.length;
  g.village = {
    counts, sample,
    fed: g.fedHistory[(g.fedIndex + g.fedHistory.length - 1) % g.fedHistory.length]!,
    childFed: kids > 0 ? Math.min(1, cf / kids) : 1,
    childAdversity: kids > 0 ? Math.min(1, ca / kids) : 0,
    birthsThisYear: 0, deathMultSum: 0, deathMultMonths: 0, shortage: false,
  };
  for (const slot of g.members) freePerson(p, slot);
  g.members = [];
  g.mode = Mode.Village;
  // A group hovering around the threshold grows and shrinks again: news only once in quietYears (DECISIONS 20.9).
  if (reason === 'perf') logEvent(s, 'perf', `${g.name} is simulated as a village early (${pop} people) to keep the simulation fast`, g);
  else logQuiet(s, `village:${g.id}`, CONFIG.log.quietYears, 'becameVillage', `${g.name} grew into a village (${pop} people)`, g, null, null, null, false);
}

/**
 * Hands out sample members in shuffled rounds: random, but every member is copied about
 * equally often, so rebuilt individuals keep the sample's averages (DECISIONS 5.2).
 */
export function sampleDealer(rng: RngState, size: number): () => number {
  let order: number[] = [];
  return () => {
    if (order.length === 0) {
      order = Array.from({ length: size }, (_, k) => k);
      for (let k = order.length - 1; k > 0; k--) {
        const j = int(rng, k + 1);
        [order[k], order[j]] = [order[j]!, order[k]!];
      }
    }
    return order.pop()!;
  };
}

/**
 * One individual from a village's numbers: an age uniform inside the bucket and traits from a
 * sample member (`pick`, else a random one) plus noise. Children keep a childhood that matches
 * the village's.
 */
export function personFromVillage(s: SimState, g: Group, v: VillageData, sex: number, bucket: number, pick?: number): number {
  const p = s.persons;
  const slot = allocPerson(p);
  const span = bucket < BUCKETS - 1 ? V.bucketYears[bucket]! : V.oldestSpanYears;
  const months = BUCKET_START[bucket]! * 12 + int(s.rng, span * 12);
  const m = v.sample.length > 0 ? noisyCopy(s.rng, v.sample[pick ?? int(s.rng, v.sample.length)]!) : null;
  const child = months < P.ages.adult * 12;
  p.groupId[slot] = g.id;
  p.sex[slot] = sex;
  p.ageMonths[slot] = months;
  const pot = m ? m.pot : [100, 50, 50];
  const act = m && !child ? m.act : pot;
  p.potInt[slot] = pot[0]!; p.potCoop[slot] = pot[1]!; p.potStr[slot] = pot[2]!;
  p.actInt[slot] = act[0]!; p.actCoop[slot] = act[1]!; p.actStr[slot] = act[2]!;
  p.health[slot] = P.health.max;
  p.fed[slot] = v.fed;
  p.nutrition[slot] = fed12(g);
  if (child) {
    p.childFedSum[slot] = months * v.childFed;
    p.childAdversity[slot] = Math.round(months * v.childAdversity);
  }
  p.workTile[slot] = g.homeY * s.width + g.homeX;
  p.skin[slot] = int(s.rng, 3);
  p.hair[slot] = int(s.rng, 3);
  return slot;
}

/** Village → band: every counted person becomes an individual again; adults pair at random. */
export function toBand(s: SimState, g: Group): void {
  const v = g.village!;
  const slots: number[] = [];
  const deal = sampleDealer(s.rng, v.sample.length);
  for (let sex = 0; sex < 2; sex++) {
    for (let b = 0; b < BUCKETS; b++) {
      for (let k = 0; k < v.counts[cell(sex, b)]!; k++) slots.push(personFromVillage(s, g, v, sex, b, deal()));
    }
  }
  g.members = slots; // allocated in id order
  g.village = null;
  g.mode = Mode.Band;
  pairing(s, g);
  logQuiet(s, `band:${g.id}`, CONFIG.log.quietYears, 'becameBand', `${g.name} shrank back into a band (${slots.length} people)`, g);
}

/**
 * Monthly step 7 (§5.1): bands of 150+ become villages, villages under 100 become bands.
 * Performance guard: while band people exceed 30,000, the largest band becomes a village.
 */
export function modeSwitches(s: SimState): void {
  const G = P.groupSize;
  for (const g of s.groups) {
    if (g.mode === Mode.Band && g.members.length >= G.toVillageAt) toVillage(s, g);
    else if (g.mode === Mode.Village && population(g) < G.toBandBelow) toBand(s, g);
  }
  for (;;) {
    let total = 0;
    let largest: Group | null = null;
    for (const g of s.groups) {
      if (g.mode !== Mode.Band) continue;
      total += g.members.length;
      if (!largest || g.members.length > largest.members.length) largest = g;
    }
    if (total <= CONFIG.perf.maxIndividuals || !largest || largest.members.length === 0) return;
    toVillage(s, largest, 'perf');
  }
}

// ---------- the monthly village (§11.10) ----------

/** Village labour (§11.10): workers per action, shared ∝ score² with no nudge. */
export interface Labour { [action: number]: number }

const SUPPORT = [Action.Explore, Action.Care, Action.Build, Action.CutWood, Action.Maintain] as const;

/**
 * Shares ∝ score². Support jobs get the bands' diminishing returns (DECISIONS 3.5): their
 * score × max(0, 1 − 2 × share), solved with a few damped rounds so the shares settle.
 */
export function shareLabour(scores: Map<number, number>, workers: number): Labour {
  const acts = [...scores.keys()].sort((a, b) => a - b);
  const base = acts.map((a) => Math.max(0, scores.get(a)!));
  const isSupport = acts.map((a) => (SUPPORT as readonly number[]).includes(a));
  const normalise = (sc: number[]): number[] => {
    const sq = sc.map((v) => v * v);
    const tot = sq.reduce((x, y) => x + y, 0);
    return tot > 0 ? sq.map((v) => v / tot) : sc.map(() => 0);
  };
  let share = normalise(base);
  for (let r = 0; r < V.labourFalloffRounds; r++) {
    const next = normalise(base.map((v, k) => (isSupport[k] ? v * Math.max(0, 1 - B.supportFalloff * share[k]!) : v)));
    share = share.map((v, k) => (v + next[k]!) / 2);
  }
  const out: Labour = {};
  acts.forEach((a, k) => { out[a] = workers * share[k]!; });
  return out;
}

export function updateVillage(s: SimState, g: Group): void {
  const v = g.village!;
  const pop = population(g);
  const range = homeRange(s, g);
  computeSignals(s, g, range, villageNeed(v));
  updateWallTarget(s, g);

  // F6: specialists craft full time; everyone else shares the other work.
  const crafters = inBuckets(v, [2, 3]) * g.specialists;
  const workers = inBuckets(v, [2, 3]) - crafters;
  const children = inBuckets(v, [0, 1]);
  const adults = inBuckets(v, [2, 3, 4, 5]);
  const avg = villageWorkers(g);
  const H = g.hunger;
  const season = CONFIG.seasonOfMonth[s.month]!;
  const mudBrick = hasActive(g, Discovery.mudBrick);
  const taming = hasActive(g, Discovery.taming);
  const P_ = pressure(g);

  // Buildings the village wants: houses for 10 each with Mud Brick, else huts for 5 each.
  const wantBuildings = Math.ceil(pop / (mudBrick ? P.build.villagePeoplePerHouse : P.build.villagePeoplePerHut));
  const deficit = Math.max(0, wantBuildings - (mudBrick ? g.houses : g.huts));
  const cands = farmCandidates(s, g, range);
  const farmSlots = F.farmersPerTile * (g.farmTiles.length + cands.length);
  const herdOk = taming && (g.herd > 0 || herdFoundInRange(s, range));
  const capacity = taming ? herdCapacity(s, g, range) : 0;
  const frontier = frontierInRange(s, g);
  // Wood (F1): the year's need for fuel, kilns, smelting, boats and the buildings still wanted.
  const shortage = woodShortage(g, woodNeedYear(g, pop, deficit * buildingWood(mudBrick)));

  // Scores: the band brain's formulas with group averages and no nudge (§11.10).
  const sc = new Map<number, number>();
  // Food jobs scored by expected food per worker (future blueprint F0); the range's plants and
  // prey are shared among everyone who might work them.
  const J = B.food;
  const waters = hasActive(g, Discovery.fishing) ? fishTiles(s, g.homeX, g.homeY, g.known) : [];
  const o = foodOutlook(s, g, range, cands, waters);
  const ymult = yieldMultInt(s, g, avg.int);
  sc.set(Action.Gather, foodScore(J.gatherBase, H, expectedGather(gatherCapOf(g, ymult), o, workers)));
  sc.set(Action.Hunt, foodScore(J.huntBase, H, expectedHunt(huntSuccess(g, avg.str, avg.coop), ymult, o, workers * J.villageHunterShare)));
  if (hasActive(g, Discovery.farming) && season !== Season.Winter && farmSlots > 0) {
    sc.set(Action.Farm, foodScore(J.farmBase, H, expectedFarm(s, g, o, ymult)));
  }
  // Fish (F3): the catch is shared like prey, among the quarter of workers who might fish.
  if (waters.length > 0) sc.set(Action.Fish, foodScore(CONFIG.future.fish.fishBase, H, expectedFish(g, ymult, o, workers * J.villageHunterShare)));
  if (herdOk) sc.set(Action.Herd, foodScore(J.herdBase, H, expectedHerd(g, o, capacity, 0, ymult)));
  if (frontier.length > 0) {
    sc.set(Action.Explore, B.exploreBase + (avg.int - 100) / B.exploreIntDivisor
      + B.exploreCrowdWeight * Math.max(0, g.crowding - B.exploreCrowdStart) + B.exploreHungerWeight * H * (1 - g.plantAvail));
  }
  if (children > 0) {
    const kidsRatio = children / Math.max(1, adults);
    sc.set(Action.Care, (B.careKidsWeight * kidsRatio + B.careHungerWeight * 100 * (1 - v.fed)) * (avg.coop / 100));
  }
  if (deficit > 0 && g.wood >= buildingWood(mudBrick)) sc.set(Action.Build, B.buildBase + B.buildPerFamily * deficit);
  if (g.wallTarget) sc.set(Action.Wall, B.wallWeight * P_ * (avg.str / 100));
  const wood = woodSource(s, g, range);
  if ((shortage > 0 || fuelUrgent(g, pop)) && wood.tiles.length > 0) {
    sc.set(Action.CutWood, cutWoodScore(g, pop, shortage));
  }
  const upkeep = maintainScore(g);                       // F5: canals, levees, drains
  if (upkeep > 0) sc.set(Action.Maintain, upkeep);
  const L = shareLabour(sc, workers);
  // Farmers and herders beyond what the land and herd can take gather instead (DECISIONS 5.5).
  const farmers = Math.min(L[Action.Farm] ?? 0, farmSlots);
  const herders = Math.min(L[Action.Herd] ?? 0, Math.max(g.herd, F.herdPerHerder) / F.herdPerHerder);
  const gatherers = (L[Action.Gather] ?? 0) + (L[Action.Farm] ?? 0) - farmers + (L[Action.Herd] ?? 0) - herders;

  const mult = yieldMultInt(s, g, avg.int);
  // Gather: expected harvest, taken from range tiles in proportion to their stock.
  if (gatherers > 0) {
    let stock = 0;
    for (const i of range) stock += s.plantFood[i]!;
    const want = gatherers * gatherCapOf(g, mult);
    const take = Math.min(want, stock);
    if (take > 0) {
      const keep = 1 - take / stock;
      for (const i of range) s.plantFood[i] = s.plantFood[i]! * keep;
      g.foodStock += take;
    }
  }
  // Hunt: expected successes, each on the range tile with the most prey right now.
  const hunters = L[Action.Hunt] ?? 0;
  if (hunters > 0 && range.length > 0) {
    const success = huntSuccess(g, avg.str, avg.coop);
    const prey = s.animal[Species.Prey];
    // Tiles by prey, most first (ties → lowest index); after each success the hit tile sinks
    // back into place, so every success still lands on the richest tile at that moment.
    const before = (a: number, b: number): boolean => prey[a]! > prey[b]! || (prey[a] === prey[b] && a < b);
    const order = range.filter((i) => prey[i]! > 0).sort((a, b) => prey[b]! - prey[a]! || a - b);
    let left = hunters * success;
    while (left > 1e-9 && order.length > 0) {
      const best = order[0]!;
      const d = prey[best]!;
      const k = Math.min(1, left);
      g.foodStock += F.huntYield * d * mult * k;
      prey[best] = Math.max(0, d - F.huntDepletion * k);
      g.hasHunted = true;
      left -= k;
      if (prey[best] === 0) { order.shift(); continue; }
      for (let j = 0; j + 1 < order.length && before(order[j + 1]!, order[j]!); j++) {
        [order[j], order[j + 1]] = [order[j + 1]!, order[j]!];
      }
    }
  }
  // Fish: each fisher-month on the richest water at that moment (like hunting).
  const fishers = L[Action.Fish] ?? 0;
  // A part-time fisher (the last fraction) brings part of a catch and takes part of the fish.
  for (let left = fishers; left > 1e-9 && waters.length > 0; left -= 1) fishWork(s, g, mult, waters, Math.min(1, left));
  // Farm: 10 farmers per field, best field first.
  if (farmers > 0) {
    ensureFarmTiles(s, g, Math.ceil(farmers), cands);
    let left = farmers;
    for (const tile of g.farmTiles) {
      if (left <= 0) break;
      const n = Math.min(F.farmersPerTile, left);
      g.foodStock += n * fieldYield(s, g, tile, mult);
      walk(s, g, tile, n);                             // F4: farmers wear paths to their fields
      left -= n;
    }
  }
  // Herd: each (whole or part) herder catches and tends, like a band herder.
  if (herders > 0) {
    const hm = { capacity, tended: 0 };
    for (let left = herders; left > 1e-9; left -= 1) {
      const before = g.foodStock;
      const herdBefore = g.herd;
      herdWork(s, g, mult, range, hm);
      const part = Math.min(1, left);
      if (part < 1) { g.foodStock = before + (g.foodStock - before) * part; g.herd = herdBefore + (g.herd - herdBefore) * part; }
    }
  }
  g.herders = herders;
  if (taming) growHerd(g, capacity);
  herdPredation(s, g, range);                            // F5: wolves take herd animals
  // Explore: stochasticRound(explorers × 0.2) reveals at the average intelligence.
  const reveals = stochasticRound(s.rng, (L[Action.Explore] ?? 0) * V.revealsPerExplorer);
  for (let k = 0; k < reveals; k++) {
    const options = frontierInRange(s, g);
    if (options.length === 0) break;
    const tile = options[int(s.rng, options.length)]!;
    revealAround(s, g, tile % s.width, Math.floor(tile / s.width), revealRadius(avg.int));
  }
  // Woodcutters thin the densest forest in range.
  const cutters = L[Action.CutWood] ?? 0;
  if (cutters > 0) cutWood(s, g, wood.tiles, cutters, wood.eff);
  maintain(g, L[Action.Maintain] ?? 0);
  // Wall work at the average strength.
  wearWall(s, g, avg.str, L[Action.Wall] ?? 0);
  if (g.wallTarget) walk(s, g, g.wallTarget.tile, L[Action.Wall] ?? 0);
  // Build toward the wanted number of buildings.
  const builders = L[Action.Build] ?? 0;
  if (builders > 0) {
    const months = mudBrick ? P.build.houseMonths : P.build.hutMonths;
    g.buildProgress += builders;
    let missing = deficit;
    while (missing > 0 && g.buildProgress >= months && payBuilding(s, g, mudBrick)) {
      g.buildProgress -= months;
      if (mudBrick) g.houses += 1; else g.huts += 1;
      missing--;
    }
    // Nothing more wanted, or no wood (or clay) for the next one: the work waits.
    g.buildProgress = Math.min(g.buildProgress, months);
  }
  g.carers = L[Action.Care] ?? 0;
  // Practice (F2): farmers and herders beyond what the land takes counted as gatherers above.
  const worked: Record<number, number> = { [Action.Gather]: gatherers, [Action.Farm]: farmers, [Action.Herd]: herders, [Action.Craft]: crafters };
  monthlyPractice(s, g, (a) => worked[a] ?? L[a] ?? 0, adults);
  // Teachers: people 50+ × (share of sample 50+ with intelligence ≥ 90) × 0.3.
  const T = P.teach;
  let old = 0, clever = 0;
  for (const m of v.sample) if (m.ageYears >= T.minAge) { old++; if (m.act[0] >= T.minInt) clever++; }
  g.teacherMonths += inBuckets(v, [3, 4, 5]) * (old > 0 ? clever / old : 0) * T.villageShare;

  burnFuel(s, g, pop, otherFuel(s, g, range));
  spoil(s, g);
  distributeVillage(s, g);
  villageBirths(s, g);
  villageDeaths(s, g);
  villageAging(s, g);
}

/** One fed ratio for everyone: min(1, stock / need) (§11.10). */
function distributeVillage(s: SimState, g: Group): void {
  const v = g.village!;
  const fed = g.need > 0 ? Math.min(1, g.foodStock / g.need) : 1;
  g.foodStock = Math.max(0, g.foodStock - g.need);
  v.fed = fed;
  if (fed < 1) v.shortage = true;
  g.fedHistory[g.fedIndex] = fed;
  g.fedIndex = (g.fedIndex + 1) % g.fedHistory.length;
  g.lowestFed = fed;
  g.fedYearSum += fed;
  // Childhood averages over the last 15 years (the length of a childhood).
  const months = P.childMonths;
  v.childFed += (fed - v.childFed) / months;
  const hard = fed < P.fed.starvingBelow || plagued(s, g) || sick(s, g);
  v.childAdversity += ((hard ? 1 : 0) - v.childAdversity) / months;
}

/** Expected births = fertile women (15–49 × 25/35) / 44 a month, halved when H > 60. */
function villageBirths(s: SimState, g: Group): void {
  const v = g.village!;
  const fertile = v.counts[cell(Sex.Female, 2)]! * V.fertileShare;
  const births = stochasticRound(s.rng, (fertile / V.birthIntervalMonths) * (g.hunger > P.birth.hungryAboveH ? V.hungryBirthMult : 1)
    * inbreedMult(g, population(g)));
  for (let k = 0; k < births; k++) v.counts[cell(chance(s.rng, 0.5) ? Sex.Female : Sex.Male, 0)]! += 1;
  v.birthsThisYear += births;
}

/** The village's monthly death multiplier before care (§11.9 table, as for bands). */
function groupDeathMult(s: SimState, g: Group): number {
  const M = P.deathMult;
  const v = g.village!;
  const home = s.ground[g.homeY * s.width + g.homeX];
  const harsh = (home === Ground.Desert || home === Ground.Mountain) && !hasActive(g, Discovery.clothing);
  const winter = CONFIG.seasonOfMonth[s.month] === Season.Winter;
  return (harsh ? M.harshHomeNoClothing : 1)
    * (winter && !hasActive(g, Discovery.fire) ? M.winterNoFire : 1)
    * (hasActive(g, Discovery.mudBrick) ? M.mudBrick : 1)
    * (v.fed < P.fed.starvingBelow ? M.starving : v.fed < P.fed.malnourishedBelow ? M.malnourished : 1)
    * eventDeathMult(s, g)
    * hazardDeathMult(s, g);   // F5: outbreaks and endemic disease
}

/** Expected deaths per bucket = count × monthly rate × multipliers, stochastically rounded. */
function villageDeaths(s: SimState, g: Group): void {
  const v = g.village!;
  const mult = groupDeathMult(s, g);
  v.deathMultSum += mult;
  v.deathMultMonths += 1;
  const care = g.carers > 0 ? Math.max(P.care.minMult, 1 - P.care.reductionPerCarer * g.carers) : 1;
  for (let sex = 0; sex < 2; sex++) {
    for (let b = 0; b < BUCKETS; b++) {
      const c = cell(sex, b);
      const n = v.counts[c]!;
      if (n === 0) continue;
      const rate = Math.min(1, P.deathMonthly[b]!.p * mult * (b < 2 ? care : 1));
      v.counts[c] = n - Math.min(n, stochasticRound(s.rng, n * rate));
    }
  }
}

/** Each month count / (bucket years × 12) people move up a bucket; 70+ only loses people to death. */
function villageAging(s: SimState, g: Group): void {
  const v = g.village!;
  for (let sex = 0; sex < 2; sex++) {
    const moves: number[] = [];
    for (let b = 0; b < BUCKETS - 1; b++) {
      const n = v.counts[cell(sex, b)]!;
      moves.push(Math.min(n, stochasticRound(s.rng, n / (V.bucketYears[b]! * 12))));
    }
    for (let b = 0; b < BUCKETS - 1; b++) {
      v.counts[cell(sex, b)]! -= moves[b]!;
      v.counts[cell(sex, b + 1)]! += moves[b]!;
    }
  }
}

/** Annual death rate of a bucket, from the monthly table: 1 − (1 − p)^12. */
function annualRate(bucket: number): number {
  let alive = 1;
  for (let m = 0; m < 12; m++) alive *= 1 - P.deathMonthly[bucket]!.p;
  return 1 - alive;
}

/**
 * Yearly sample update (§11.10): members die by their bucket's rate × this year's average
 * multipliers × a trait factor (weak people die more; in a shortage, generous ones do too);
 * births in proportion to the village's births; everyone ages a year; back to 64.
 */
export function yearlySample(s: SimState, g: Group): void {
  const v = g.village!;
  const avgMult = v.deathMultMonths > 0 ? v.deathMultSum / v.deathMultMonths : 1;
  const mid = V.traitHazardMid;
  const div = V.traitHazardDivisor;
  const survivors = v.sample.filter((m) => {
    const p = annualRate(bucketOf(m.ageYears)) * avgMult * (1 + (mid - m.act[2]) / div)
      * (v.shortage ? 1 + (m.act[1] - mid) / div : 1);
    return !chance(s.rng, p);
  });
  // Never lose the whole sample: it is the village's genes.
  const sample = survivors.length > 0 ? survivors : v.sample;
  const pop = population(g);
  const births = pop > 0 ? stochasticRound(s.rng, (V.sampleSize * v.birthsThisYear) / pop) : 0;
  const mothers = sample.filter((m) => m.sex === Sex.Female && m.ageYears >= P.birth.minAge && m.ageYears <= P.birth.maxAge);
  const fathers = sample.filter((m) => m.sex === Sex.Male && m.ageYears >= P.birth.minAge);
  const writing = hasActive(g, Discovery.writing);
  for (let k = 0; k < births && mothers.length > 0 && fathers.length > 0; k++) {
    const mom = mothers[int(s.rng, mothers.length)]!;
    const dad = fathers[int(s.rng, fathers.length)]!;
    const pot = [0, 1, 2].map((t) => inheritTrait(s.rng, mom.pot[t]!, dad.pot[t]!, TRAITS[t]!)) as [number, number, number];
    const a = actualFromChildhood({ int: pot[0], coop: pot[1], str: pot[2] }, v.childFed, v.childAdversity, g.era, writing);
    sample.push({ sex: float(s.rng) < 0.5 ? Sex.Female : Sex.Male, ageYears: 0, pot, act: [a.int, a.coop, a.str] });
  }
  for (const m of sample) m.ageYears += 1;
  resizeSample(s.rng, sample);
  v.sample = sample;
  v.birthsThisYear = 0;
  v.deathMultSum = 0;
  v.deathMultMonths = 0;
  v.shortage = false;
}
