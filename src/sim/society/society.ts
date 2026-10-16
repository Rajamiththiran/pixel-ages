// Society (future blueprint F6, §12): specialists, chiefs and inequality, marriage between groups
// and inbreeding, culture, language drift, weapons and fortifications, and working animals.
// Raids and alliances are part of the yearly contact step (contact.ts).

import { CONFIG } from '../../config';
import { Culture, CULTURE_NAMES, Mode, Need, Practice, Resource, Sex } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { chance, gaussian, int, stochasticRound } from '../../shared/rng';
import type { Group, SimState } from '../state';
import { hasActive } from '../people/explore';
import { BUCKETS, logEvent, population, traitAverages } from '../people/groups';
import { addParty, takeCounts, takeSlots } from '../people/transfer';
import { bucketOf } from '../people/village';
import { takeResource } from '../progress/deposits';

const FU = CONFIG.future;
const SO = FU.society;
const WP = FU.weapons;
const FT = FU.fortify;
const WA = FU.workAnimals;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------- specialists (§12.1) ----------

/** Food stored in months of need, summed month by month for the yearly specialist and chief rules. */
export function noteStore(g: Group): void {
  g.storeMonthsSum += g.need > 0 ? g.foodStock / g.need : 0;
  g.hungerPeak = Math.max(g.hungerPeak, g.hunger);   // raids: the year's worst month
}

/** Specialist share for a year with `months` of food stored on average: min(0.15, 0.02 × months) above 6 months and 150 people. */
export function specialistShare(months: number, pop: number): number {
  if (months <= SO.surplusMonths || pop < SO.specialistMinPop) return 0;
  return Math.min(SO.specialistMax, SO.specialistPerSurplus * months);
}

/** Better tools and weapons from craftspeople: × (1 + 2 × specialists). */
export const craftMult = (g: Group): number => 1 + SO.specialistTools * g.specialists;

/** The activity crafters practise: metal work, else clay work, else wood work. */
export function craftPractice(g: Group): number {
  if (hasActive(g, Discovery.copperWorking) || hasActive(g, Discovery.bronzeWorking) || hasActive(g, Discovery.ironWorking)) return Practice.metalWork;
  if (hasActive(g, Discovery.pottery) || hasActive(g, Discovery.mudBrick)) return Practice.clayWork;
  return Practice.woodWork;
}

// ---------- chiefs and inequality (§12.2) ----------

/**
 * Yearly: inequality += 0.02 (a chief and a surplus) + 0.05 × wins, then × (1 − 0.05 × coop/100).
 * With a chief and a steady surplus it settles at 0.02 / (0.05 × coop/100): 0.8 at coop 50.
 */
export function nextInequality(ineq: number, chief: boolean, surplus: boolean, wins: number, coop: number): number {
  const up = ineq + (chief && surplus ? SO.inequalitySurplusGain : 0) + SO.inequalityWarWinGain * wins;
  return clamp(up * (1 - SO.inequalityCoopFall * (coop / 100)), 0, 1);
}

// ---------- culture (§12.4) ----------

/** Pair average of one culture trait. */
export const pairCulture = (a: Group, b: Group, k: number): number => (a.culture[k]! + b.culture[k]!) / 2;

/** A split's culture: the parent's plus gaussian × 3 on each trait. */
export function driftCulture(s: SimState, child: Group, parent: Group): void {
  for (let k = 0; k < child.culture.length; k++) {
    child.culture[k] = clamp(parent.culture[k]! + gaussian(s.rng) * SO.cultureDrift, 0, 100);
  }
}

/** Newcomers bring their ways: target moves `share` of the way to the source's culture. */
export function mixCulture(target: Group, source: Group, share: number): void {
  if (share <= 0) return;
  for (let k = 0; k < target.culture.length; k++) {
    target.culture[k] = target.culture[k]! + (source.culture[k]! - target.culture[k]!) * Math.min(1, share);
  }
}

/** Neighbours at peace drift toward each other: 2% of the gap a year. */
export function blendCulture(a: Group, b: Group): void {
  for (let k = 0; k < a.culture.length; k++) {
    const gap = b.culture[k]! - a.culture[k]!;
    a.culture[k] = a.culture[k]! + gap * SO.cultureBlend;
    b.culture[k] = b.culture[k]! - gap * SO.cultureBlend;
  }
}

/** Learning (trade, diffusion) × (0.5 + openness / 100), × 0.5 between peoples who can't understand each other. */
export function learnMult(learner: Group, teacher: Group): number {
  return (0.5 + learner.culture[Culture.openness]! / 100) * (understand(learner, teacher) ? 1 : SO.languageMult);
}

/** Selfishness in a band's food sharing: × (2 − sharing / 50) × (1 + inequality). */
export const selfishMult = (g: Group): number =>
  Math.max(0, 2 - g.culture[Culture.sharing]! / SO.sharingSelfish) * (1 + g.inequality);

export const cultureText = (g: Group): string =>
  CULTURE_NAMES.map((n, k) => `${n.toLowerCase()} ${Math.round(g.culture[k]!)}`).join(' · ');

// ---------- language (§12.5) ----------

export const sameLanguage = (a: Group, b: Group): boolean => a.languageId === b.languageId;

/**
 * False when the language penalties apply (§12.5): kin of one lineage that grew apart; between
 * different lineages only with `languageBetweenLineages` (v1 already treats them as strangers).
 */
export const understand = (a: Group, b: Group): boolean =>
  sameLanguage(a, b) || (a.lineageId !== b.lineageId && !SO.languageBetweenLineages);

export const languageName = (s: SimState, id: number): string => s.languages.find((l) => l.id === id)?.name ?? '—';

/** Two groups met: if they speak the same language, both keep it alive. */
export function noteContact(s: SimState, a: Group, b: Group): void {
  if (!sameLanguage(a, b)) return;
  a.kinContactYear = s.year;
  b.kinContactYear = s.year;
}

/**
 * Yearly: a group that has met no group of its own language for 500 years, while others still
 * speak it, now speaks its own (in id order, so of two long-parted halves only one changes).
 */
export function languageDrift(s: SimState): void {
  for (const g of s.groups) {
    if (s.year - g.kinContactYear <= SO.languageYears) continue;
    if (!s.groups.some((o) => o !== g && o.languageId === g.languageId)) continue;
    const old = languageName(s, g.languageId);
    const id = s.nextLanguageId++;
    s.languages.push({ id, name: g.name, parentId: g.languageId, sinceYear: s.year });
    g.languageId = id;
    g.kinContactYear = s.year;
    logEvent(s, 'society', `${g.name} has grown apart from the ${old} people: it now speaks its own language`, g);
  }
}

// ---------- marriage and inbreeding (§12.3) ----------

/** Births × (1 − 0.3 × min(1, isolated years / 200)) in groups under 50 people. */
export function inbreedMult(g: Group, pop: number): number {
  if (pop >= SO.inbreedBelowPop) return 1;
  return 1 - SO.inbreedPenalty * Math.min(1, g.isolationYears / SO.inbreedYears);
}

/** Outsiders joined the group: it is no longer isolated. */
export const outsidersJoined = (g: Group): void => { g.isolationYears = 0; };

/** Unpaired band people aged 16–30, in id order. */
function unpairedYoung(s: SimState, g: Group): number[] {
  const p = s.persons;
  return g.members.filter((slot) => {
    const age = p.ageMonths[slot]! / 12;
    return p.partnerId[slot] === -1 && age >= SO.marriageMinAge && age < SO.marriageMaxAge;
  });
}

/** Takes the marrying-away share out of `g` as a party (not yet added anywhere). */
function marryingAway(s: SimState, g: Group): ReturnType<typeof takeSlots> | null {
  if (g.village) {
    const v = g.village;
    const counts = new Int32Array(2 * BUCKETS);
    let n = 0;
    for (const sex of [Sex.Male, Sex.Female]) {
      const c = sex * BUCKETS + 2;
      const k = Math.min(v.counts[c]!, stochasticRound(s.rng, v.counts[c]! * SO.villageUnpairedShare * SO.marriageShare));
      counts[c] = k;
      n += k;
    }
    if (n === 0) return null;
    const party = takeCounts(g, counts);
    // The party's sample stands for young adults only.
    const young = party.sample.filter((m) => bucketOf(m.ageYears) === 2);
    if (young.length > 0) party.sample = young;
    return party;
  }
  const pool = unpairedYoung(s, g);
  const n = stochasticRound(s.rng, pool.length * SO.marriageShare);
  if (n === 0) return null;
  for (let k = 0; k < n; k++) {
    const j = k + int(s.rng, pool.length - k);
    [pool[k], pool[j]] = [pool[j]!, pool[k]!];
  }
  const p = s.persons;
  return takeSlots(g, pool.slice(0, n).sort((x, y) => p.id[x]! - p.id[y]!));
}

/**
 * Yearly, between two groups at peace (coexist or trade): each sends 2% of its unpaired young
 * adults to the other (§12.3). Both are then no longer isolated. Returns people moved.
 */
export function intermarry(s: SimState, a: Group, b: Group): number {
  const fromA = marryingAway(s, a);
  const fromB = marryingAway(s, b);
  let moved = 0;
  if (fromA) { moved += fromA.slots.length + fromA.counts.reduce((x, y) => x + y, 0); addParty(s, b, fromA); outsidersJoined(b); }
  if (fromB) { moved += fromB.slots.length + fromB.counts.reduce((x, y) => x + y, 0); addParty(s, a, fromB); outsidersJoined(a); }
  return moved;
}

// ---------- weapons and fortifications (§12.6) ----------

/**
 * War power × the best weapon the group can equip: metal weapons (copper, bronze, iron) for the
 * share of fighters its metal stock covers (0.1 a fighter), wood weapons (spear, bow) for the rest.
 */
export function weaponMult(g: Group, fighters: number): number {
  const wood = hasActive(g, Discovery.bow) ? WP.bow : hasActive(g, Discovery.spear) ? WP.spear : 1;
  const metal = hasActive(g, Discovery.ironWorking) ? WP.iron
    : hasActive(g, Discovery.bronzeWorking) ? WP.bronze
    : hasActive(g, Discovery.copperWorking) ? WP.copper : 0;
  if (metal <= wood || fighters <= 0) return wood;
  const equipped = Math.min(1, g.metal / (fighters * WP.metalPerFighter));
  return equipped * metal + (1 - equipped) * wood;
}

/** Defence × 1.3 behind a palisade, × 1.8 behind a stone wall. */
export const fortMult = (g: Group): number => (g.fortification === 2 ? FT.stoneWall : g.fortification === 1 ? FT.palisade : 1);

/** Wood a threatened group with Palisade still needs for one. */
export const palisadeWoodWanted = (g: Group): number =>
  (g.underThreat && g.fortification === 0 && hasActive(g, Discovery.palisade) ? FT.palisadeWood : 0);

/** Yearly: a threatened group builds a palisade (200 wood), then a stone wall (Stone Building, 500 stone). */
export function buildFortifications(s: SimState, g: Group): void {
  if (!g.underThreat && g.needs[Need.war]! <= SO.threatNeed) return;
  if (g.fortification < 2 && hasActive(g, Discovery.stoneBuilding) && takeResource(s, g, Resource.Stone, FT.stoneWallStone)) {
    g.fortification = 2;
    logEvent(s, 'society', `${g.name} built a stone wall`, g);
    return;
  }
  if (g.fortification === 0 && hasActive(g, Discovery.palisade) && g.wood >= FT.palisadeWood) {
    g.wood -= FT.palisadeWood;
    g.fortification = 1;
    logEvent(s, 'society', `${g.name} built a palisade`, g);
  }
}

// ---------- working animals (§12.8) ----------

/** Plough + oxen: farm yield × (1 + 0.5 × share of fields with 2 oxen each). */
export function ploughMult(g: Group): number {
  if (!hasActive(g, Discovery.plough) || g.herd < 1) return 1;
  const share = Math.min(1, g.herd / (Math.max(1, g.farmTiles.length) * WA.oxenPerField));
  return 1 + (WA.ploughMult - 1) * share;
}

/** Horses (Riding) or oxen pulling a Cart widen the group's reach for contact and trade. */
export const workingAnimals = (g: Group): boolean =>
  hasActive(g, Discovery.riding) || (hasActive(g, Discovery.cart) && g.herd >= 1);

/** Herd yield × (1 + domestication). */
export const domesticMult = (g: Group): number => 1 + g.domestication;

// ---------- the yearly step ----------

/**
 * Yearly (after contact and hazards): specialists, chief and inequality from the year's store,
 * domestication, walls, then language drift. Resets the year's counters.
 */
export function yearlySociety(s: SimState): void {
  const months = CONFIG.time.ticksPerYear;
  for (const g of s.groups) {
    const pop = population(g);
    const stored = g.storeMonthsSum / months;
    const surplus = stored > SO.surplusMonths;
    g.specialists = g.mode === Mode.Village ? specialistShare(stored, pop) : 0;
    if (!g.chief && pop >= SO.chiefMinPop && surplus) {
      g.chief = true;
      logEvent(s, 'society', `${g.name} now has a chief`, g);
    } else if (g.chief && pop < SO.chiefLostBelowPop) {
      g.chief = false;
      logEvent(s, 'society', `${g.name} no longer has a chief`, g);
    }
    g.inequality = nextInequality(g.inequality, g.chief, surplus, g.warWinsYear, traitAverages(s, g).coop);
    // A herd tended this year grows tamer; a lost herd takes its breeding with it.
    if (g.herd < 1) g.domestication = 0;
    else if (g.idleYears[Practice.herding] === 0) g.domestication = Math.min(WA.domesticationMax, g.domestication + WA.domesticationPerYear);
    buildFortifications(s, g);
    g.storeMonthsSum = 0;
    g.warWinsYear = 0;
    g.hungerPeak = 0;
  }
  languageDrift(s);
}

/** A raid or battle won (inequality). */
export const noteWin = (g: Group): void => { g.warWinsYear += 1; };

/** Society fields a split or refugee group takes from its parent (culture drifts, §12.4). */
export function inheritSociety(s: SimState, child: Group, parent: Group): void {
  driftCulture(s, child, parent);
  child.languageId = parent.languageId;
  child.kinContactYear = s.year;
  child.isolationYears = parent.isolationYears;
  child.inequality = parent.inequality;
  child.domestication = parent.domestication;
}

/** Does a hungry group raid this year: 30% × warlike / 50. */
export const rollRaid = (s: SimState, g: Group): boolean =>
  chance(s.rng, SO.raidChance * (g.culture[Culture.warlike]! / 50));
