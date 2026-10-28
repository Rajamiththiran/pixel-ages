// C4 (pixel-ages-c4-plan.md, DECISIONS 21.x): chiefdoms and kingdoms. A farming village with a
// chief keeps the settled villages it beats as subjects that pay tribute; a realm is one ruler and
// its subjects (a subject's ruler is always free, so a realm is never deeper than two levels).
// Subjects revolt when the ruler is weak, far, foreign or lets them starve; a ruler that loses its
// chief, its fields or its village life lets them all go. Real basis: Carneiro's circumscription
// theory, chiefly cycling in the Mississippian south-east, tribute of about a tenth.

import { CONFIG } from '../../config';
import { Mode } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { chance } from '../../shared/rng';
import type { Group, Relation, SimState } from '../state';
import { hasActive } from '../people/explore';
import { logEvent, logQuiet, population, villages } from '../people/groups';
import { roadBetween } from '../world/landscape';
import { sameLanguage } from './society';
import { forceOf, kinship } from './contact';

const RC = CONFIG.realms;
const C = CONFIG.contact;

// ---------- who belongs where ----------

/** The id of the realm's ruler: the group's overlord, or itself. */
export const headOf = (g: Group): number => (g.overlordId >= 0 ? g.overlordId : g.id);

/** Two different groups in one realm (a ruler and its subject, or two subjects of one ruler). */
export const sameRealm = (a: Group, b: Group): boolean => a.id !== b.id && headOf(a) === headOf(b);

export const subjectsOf = (s: SimState, ruler: Group): Group[] => s.groups.filter((g) => g.overlordId === ruler.id);

/** The ruler and its subjects (just the group if it is free and rules nobody). */
export function realmOf(s: SimState, g: Group): Group[] {
  const head = s.groups.find((o) => o.id === headOf(g));
  return head ? [head, ...subjectsOf(s, head)] : [g];
}

/** The war power of the whole realm `g` belongs to. */
export const realmPower = (s: SimState, g: Group): number => realmOf(s, g).reduce((t, m) => t + forceOf(s, m).power, 0);

/** A free village with a chief and working fields: it can take tribute (Carneiro: chiefdoms are farmers'). */
export const canRule = (g: Group): boolean =>
  g.overlordId < 0 && g.mode === Mode.Village && g.chief && hasActive(g, Discovery.farming);

/** Base control range in tiles: half a day's walk, farther with horses and with writing. */
export function baseRange(ruler: Group): number {
  return RC.controlRange * (hasActive(ruler, Discovery.riding) ? RC.ridingMult : 1)
    * (hasActive(ruler, Discovery.writing) ? RC.writingMult : 1);
}

const dist2 = (a: Group, b: Group): number => (a.homeX - b.homeX) ** 2 + (a.homeY - b.homeY) ** 2;

/** Control range between these two homes: the base, × roadMult when a road joins them. */
export function controlRange(s: SimState, ruler: Group, g: Group): number {
  const r = baseRange(ruler);
  if (dist2(ruler, g) <= r * r) return r;
  return roadBetween(s, ruler, g) ? r * RC.roadMult : r;
}

export const inRange = (s: SimState, ruler: Group, g: Group): boolean => {
  const r = controlRange(s, ruler, g);
  return dist2(ruler, g) <= r * r;
};

/** Can `ruler` keep `g` as a subject: it can rule, `g` is a settled village of another realm, and it is in range. */
export const canHold = (s: SimState, ruler: Group, g: Group): boolean =>
  ruler.id !== g.id && headOf(g) !== ruler.id && canRule(ruler) && g.mode === Mode.Village && inRange(s, ruler, g);

// ---------- joining and leaving ----------

/** Members of one realm live in peace: their relation is quiet trade, with no war running. */
function makePeace(s: SimState, a: Group, b: Group): void {
  const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
  const rel = s.relations.find((r) => r.a === lo && r.b === hi);
  if (!rel || rel.kind === 'trade') return;
  rel.kind = 'trade';
  rel.sinceYear = s.year;
  rel.warDeadA = 0;
  rel.warDeadB = 0;
}

/**
 * `g` becomes a subject of `ruler`. If `g` ruled villages, each one in the new ruler's range goes
 * with it and the rest go free (taking a capital took its realm). The ruler's first subject makes
 * it a chiefdom (`founded`: the caller logs it after its own line, with logFounded).
 */
export function makeSubject(s: SimState, ruler: Group, g: Group): { taken: number; freed: number; founded: boolean } {
  let taken = 0, freed = 0;
  for (const sub of subjectsOf(s, g)) {
    if (canHold(s, ruler, sub)) { setSubject(s, ruler, sub); taken++; }
    else { freeSubject(sub); freed++; }
  }
  setSubject(s, ruler, g);
  g.realmRank = 0;
  // Alliances against one's own realm, or between a realm and the group that now rules it, end.
  s.alliances = s.alliances.filter((x) => {
    const [ga, gb, gc] = [x.a, x.b, x.against].map((id) => s.groups.find((o) => o.id === id));
    return !ga || !gb || !gc || (headOf(gc) !== headOf(ga) && headOf(gc) !== headOf(gb));
  });
  const founded = ruler.realmRank === 0;
  if (founded) {
    ruler.realmRank = 1;
    ruler.realmSince = s.year;
  }
  ruler.realmLastYear = s.year;
  return { taken, freed, founded };
}

/** "Garden founded a chiefdom: 2 villages, 640 people" (after the line that tells how). */
export function logFounded(s: SimState, ruler: Group): void {
  const members = realmOf(s, ruler);
  const pop = members.reduce((t, m) => t + population(m), 0);
  logEvent(s, 'realm', `${ruler.name} founded a chiefdom: ${villages(members.length)}, ${pop.toLocaleString('en-US')} people`, ruler);
}

function setSubject(s: SimState, ruler: Group, g: Group): void {
  g.overlordId = ruler.id;
  g.subjectSince = s.year;
  g.unrest = 0;
  for (const m of realmOf(s, ruler)) if (m !== g) makePeace(s, m, g);
}

export function freeSubject(g: Group): void {
  g.overlordId = -1;
  g.unrest = 0;
}

/**
 * A beaten ruler's villages: each one `ruler` can hold joins it, the rest go free. Used when the
 * old ruler is driven off or scattered (makeSubject does the same when it is kept).
 */
export function takeRealm(s: SimState, ruler: Group | undefined, old: Group): { taken: number; freed: number; founded: boolean } {
  let taken = 0, freed = 0, founded = false;
  for (const sub of subjectsOf(s, old)) {
    if (ruler && canHold(s, ruler, sub)) { founded = makeSubject(s, ruler, sub).founded || founded; taken++; }
    else { freeSubject(sub); freed++; }
  }
  old.realmRank = 0;
  return { taken, freed, founded };
}

/** A ruler's subjects go free (the ruler is beaten and gone, or driven off). Returns how many. */
export function releaseAll(s: SimState, ruler: Group): number {
  const subs = subjectsOf(s, ruler);
  for (const g of subs) freeSubject(g);
  return subs.length;
}

// ---------- unrest ----------

/**
 * Yearly chance a subject revolts (plan §4.5): a base, more when the rest of the realm is too
 * weak to put it down, when it goes hungry, lives far out or speaks another language; less as the
 * generations pass in the realm, between close kin, and in a kingdom. For cowedYears after joining
 * only a weak ruler can lose it: hostages and reprisals kept the newly beaten quiet.
 */
export function unrestOf(s: SimState, g: Group, ruler: Group, realmPow: number, ownPow: number): number {
  const cowed = s.year - g.subjectSince < RC.cowedYears;
  let u = cowed ? 0 : RC.rebelBase;
  if (realmPow - ownPow < RC.rebelWeakRatio * ownPow) u += RC.rebelWeak;
  if (!cowed) {
    u += RC.rebelHunger * (g.hunger / 100);
    const reach = Math.sqrt(dist2(ruler, g)) / controlRange(s, ruler, g);
    u += RC.rebelFar * Math.min(1, Math.max(0, (reach - 0.5) * 2));
    if (!sameLanguage(g, ruler)) u += RC.rebelForeign;
  }
  u *= 1 - RC.assimilateCut * Math.min(1, (s.year - g.subjectSince) / RC.assimilateYears);
  u *= 1 - RC.kinLoyalty * kinship(s, g, ruler);
  if (ruler.realmRank === 2) u *= RC.kingdomRebelMult;
  return Math.min(1, Math.max(0, u));
}

/** A subject revolts: free, and at war with its ruler if they are in contact (a war of independence). */
function revolt(s: SimState, g: Group, ruler: Group): void {
  freeSubject(g);
  const lo = Math.min(g.id, ruler.id), hi = Math.max(g.id, ruler.id);
  const rel: Relation | undefined = s.relations.find((r) => r.a === lo && r.b === hi);
  if (!rel) {
    logEvent(s, 'realm', `${g.name} broke free of ${ruler.name}`, g, ruler);
    return;
  }
  const [a, b] = g.id === lo ? [g, ruler] : [ruler, g];
  rel.kind = 'war';
  rel.sinceYear = s.year;
  rel.reviewYear = s.year + C.reviewYears;
  rel.truceUntil = 0;
  rel.warPopA = population(a);
  rel.warPopB = population(b);
  rel.warDeadA = 0;
  rel.warDeadB = 0;
  logEvent(s, 'realm', `${g.name} rebelled against ${ruler.name}`, g, ruler);
}

const realmWord = (g: Group): string => (g.realmRank === 2 ? 'kingdom' : 'chiefdom');

/** Why a ruler can rule no more, for the log. */
function whyFallen(g: Group): string {
  if (!g.chief) return 'it lost its chief';
  if (g.mode !== Mode.Village) return 'it broke up into bands';
  return 'its fields failed';
}

// ---------- the yearly step ----------

/**
 * Yearly, after contact and hazards (plan §3.3), groups in id order: fallen rulers let go, subjects
 * out of reach go free, revolts, tribute and relief, a ranked society, then chiefdom and kingdom.
 */
export function yearlyRealms(s: SimState): void {
  const byId = new Map(s.groups.map((g) => [g.id, g] as const));
  for (const g of s.groups) g.tributePaid = 0;

  // 1. A ruler that can no longer rule lets its whole realm go.
  for (const r of s.groups) {
    if (r.realmRank === 0 || canRule(r)) continue;
    const n = releaseAll(s, r);
    if (n > 0) logEvent(s, 'realm', `The ${realmWord(r)} of ${r.name} fell apart: ${whyFallen(r)} (${villages(n)} went free)`, r);
    r.realmRank = 0;
  }

  // 2. Subjects that moved, or whose ruler moved, out of reach are free (Scott: flight from the state).
  for (const g of s.groups) {
    if (g.overlordId < 0) continue;
    const ruler = byId.get(g.overlordId);
    if (!ruler) { freeSubject(g); continue; }
    if (inRange(s, ruler, g)) continue;
    freeSubject(g);
    // A daughter village that settled out of reach in its first year was never really ruled: no news.
    if (g.foundedYear === s.year) continue;
    logEvent(s, 'realm', `${g.name} is beyond the reach of ${ruler.name} now and pays no more tribute`, g, ruler);
  }

  // 3. Revolts. Powers are measured once, before anyone leaves.
  const power = new Map<number, number>();
  const pow = (g: Group): number => {
    let v = power.get(g.id);
    if (v === undefined) { v = forceOf(s, g).power; power.set(g.id, v); }
    return v;
  };
  const realmPow = new Map<number, number>();
  for (const g of s.groups) realmPow.set(headOf(g), (realmPow.get(headOf(g)) ?? 0) + pow(g));
  for (const g of s.groups) {
    if (g.overlordId < 0) continue;
    const ruler = byId.get(g.overlordId)!;
    g.unrest = unrestOf(s, g, ruler, realmPow.get(ruler.id) ?? 0, pow(g));
    if (chance(s.rng, g.unrest)) revolt(s, g, ruler);
  }

  // 4. Tribute, waived for a starving village, which gets food from its ruler instead.
  for (const g of s.groups) {
    if (g.overlordId < 0) continue;
    const ruler = byId.get(g.overlordId)!;
    if (g.hunger >= RC.reliefHunger) {
      if (ruler.hunger < RC.reliefHunger && ruler.foodStock > 0) {
        const give = ruler.foodStock * RC.reliefShare;
        ruler.foodStock -= give;
        g.foodStock += give;
        logQuiet(s, `relief:${g.id}`, CONFIG.log.quietYears, 'realm', `${ruler.name} sent food to hungry ${g.name}`, ruler, g);
      }
      continue;
    }
    const t = g.foodStock * (ruler.realmRank === 2 ? RC.kingdomTributeShare : RC.tributeShare);
    g.foodStock -= t;
    ruler.foodStock += t;
    g.tributePaid = t;
    ruler.tributePaid += t;
  }

  // 5. Ranks: a chiefdom while it rules anyone; a kingdom with Writing, a City, villages and people.
  for (const r of s.groups) {
    if (r.overlordId >= 0) continue;
    const subs = subjectsOf(s, r);
    if (subs.length === 0) {
      // A ruler that lost its villages keeps its rank for graceYears: it may win them back.
      if (r.realmRank > 0 && s.year - r.realmLastYear >= RC.graceYears) {
        logEvent(s, 'realm', `The ${realmWord(r)} of ${r.name} is no more`, r);
        r.realmRank = 0;
      }
      continue;
    }
    r.realmLastYear = s.year;
    // A ranked society: the ruling village grows more unequal with every village it rules.
    r.inequality = Math.min(1, r.inequality + RC.inequalityPerSubject * subs.length);
    if (r.realmRank === 0) { r.realmRank = 1; r.realmSince = s.year; }
    const writing = hasActive(r, Discovery.writing);
    if (r.realmRank === 1 && writing && hasActive(r, Discovery.city) && subs.length >= RC.kingdomMinSubjects) {
      const pop = population(r) + subs.reduce((t, m) => t + population(m), 0);
      if (pop >= RC.kingdomMinPop) {
        r.realmRank = 2;
        r.realmSince = s.year;
        logEvent(s, 'realm', `${r.name} became the Kingdom of ${r.name}: ${villages(subs.length + 1)}, ${pop.toLocaleString('en-US')} people`, r);
      }
    } else if (r.realmRank === 2 && !writing) {
      // A kingdom lasts while it rules anyone and keeps its scribes: no flapping at the 3-village line.
      r.realmRank = 1;
      r.realmSince = s.year;
      logEvent(s, 'realm', `The Kingdom of ${r.name} shrank back to a chiefdom`, r);
    }
  }
}
