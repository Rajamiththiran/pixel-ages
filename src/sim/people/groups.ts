// Groups and lineages: creation, membership, averages and the event log.

import { CONFIG } from '../../config';
import { CULTURE_COUNT, HAZARD_COUNT, Mode, NEED_COUNT, PRACTICE_COUNT } from '../../shared/ids';
import { DISCOVERY_COUNT, newMask } from '../../shared/discoveries';
import type { LogType } from '../../shared/types';
import type { Group, SimState } from '../state';
import { freePerson } from './persons';
import { leaveRuins } from '../world/landscape';

const A = CONFIG.people.ages;

export function newGroup(s: SimState, id: number, name: string, lineageId: number, homeX: number, homeY: number): Group {
  const fed = new Float32Array(CONFIG.time.ticksPerYear).fill(1);
  return {
    id, name, lineageId, parentId: -1, mode: Mode.Band, homeX, homeY, foundedYear: s.year,
    known: new Uint8Array(Math.ceil((s.width * s.height) / 8)), knownCount: 0, knownVersion: 0,
    frontier: [],
    discoveries: newMask(), inactive: newMask(), inactiveWhy: new Uint8Array(DISCOVERY_COUNT), era: 0,
    foodStock: 0, fedHistory: fed, fedIndex: 0, wood: 0, spareFuel: 0, metal: 0, built: newMask(), boatYear: 0,
    herd: 0, herders: 0, farmTiles: [], hasHunted: false,
    practice: new Float32Array(PRACTICE_COUNT), practiceYear: new Float32Array(PRACTICE_COUNT), idleYears: new Uint16Array(PRACTICE_COUNT),
    needAcc: new Float32Array(NEED_COUNT), needs: new Float32Array(NEED_COUNT), lessons: new Uint16Array(HAZARD_COUNT), maintenance: 1,
    specialists: 0, chief: false, inequality: 0,
    culture: new Float32Array(CULTURE_COUNT).fill(CONFIG.future.society.cultureStart),
    languageId: 0, kinContactYear: s.year, isolationYears: 0, domestication: 0, fortification: 0,
    storeMonthsSum: 0, warWinsYear: 0, underThreat: false, hungerPeak: 0,
    overlordId: -1, subjectSince: 0, tributePaid: 0, unrest: 0, realmRank: 0, realmSince: 0, realmLastYear: 0,
    huts: 0, houses: 0, buildProgress: 0,
    hungryMonths: 0, crowdedMonths: 0, wantsSplit: false, wallTarget: null, wallScanKey: '',
    teachBonus: 1, teacherMonths: 0, carers: 0, cannotReproduceLogged: false, village: null, trading: false,
    members: [],
    need: 0, hunger: 0, plantAvail: 0, preyAvail: 0, sustainable: 0, crowding: 0, lowestFed: 1, fedYearSum: 0,
  };
}

/** "1 village", "3 villages" (realm log lines). */
export const villages = (n: number): string => `${n} ${n === 1 ? 'village' : 'villages'}`;

/** Inserts a group keeping s.groups sorted by id. */
export function addGroup(s: SimState, g: Group): void {
  let k = s.groups.length;
  while (k > 0 && s.groups[k - 1]!.id > g.id) k--;
  s.groups.splice(k, 0, g);
}

export function groupColor(s: SimState, g: Group): number {
  return s.lineages.find((l) => l.id === g.lineageId)?.colorIndex ?? 0;
}

/** Appends a log entry (§7.3). `text` is the line after "Year N". Oldest entries drop past the cap. */
export function logEvent(
  s: SimState, type: LogType, text: string,
  g: Group | null = null, other: Group | null = null, x: number | null = null, y: number | null = null,
  minor = false,
): void {
  s.log.push({
    year: s.year, month: s.month, type, text,
    groupId: g?.id ?? null, otherId: other?.id ?? null, lineageId: g?.lineageId ?? null,
    x: x ?? g?.homeX ?? null, y: y ?? g?.homeY ?? null,
    ...(minor ? { minor: true } : {}),
  });
  if (s.log.length > CONFIG.log.maxEntries) {
    s.log.shift();
    s.logDropped++;
  }
}

/**
 * Logs an event (small unless `minor` is false) unless the same `key` was logged in the last
 * `years` years: a state that flips back and forth (wood runs out, trade restarts, a sickness
 * returns) is one story, not a line every year (DECISIONS 20.9).
 */
export function logQuiet(
  s: SimState, key: string, years: number, type: LogType, text: string,
  g: Group | null = null, other: Group | null = null, x: number | null = null, y: number | null = null,
  minor = true,
): void {
  const until = s.logQuiet.get(key);
  if (until !== undefined && s.year < until) return;
  if (s.logQuiet.size >= CONFIG.log.quietKeysMax) {
    for (const [k, u] of s.logQuiet) if (u <= s.year) s.logQuiet.delete(k);
  }
  s.logQuiet.set(key, s.year + years);
  logEvent(s, type, text, g, other, x, y, minor);
}

/** Removes dead people (alive = 0) from the member list and frees their slots. */
export function buryDead(s: SimState, g: Group, dead: number[]): void {
  if (dead.length === 0) return;
  const p = s.persons;
  for (const slot of dead) freePerson(p, slot);
  g.members = g.members.filter((slot) => p.alive[slot] === 1);
}

export interface GroupCounts {
  men: number; women: number; children: number; elders: number; adults: number;
}

/** Village age buckets (§7.3): 0:0–4, 1:5–14, 2:15–49, 3:50–59, 4:60–69, 5:70+. */
export const BUCKETS = 6;
export const BUCKET_START = [0, 5, 15, 50, 60, 70] as const;

/** People in the group: band members, or the village's counts. */
export function population(g: Group): number {
  if (!g.village) return g.members.length;
  let n = 0;
  for (const c of g.village.counts) n += c;
  return n;
}

export function countMembers(s: SimState, g: Group): GroupCounts {
  const c: GroupCounts = { men: 0, women: 0, children: 0, elders: 0, adults: 0 };
  if (g.village) {
    const k = g.village.counts;
    for (let sex = 0; sex < 2; sex++) {
      for (let b = 0; b < BUCKETS; b++) {
        const n = k[sex * BUCKETS + b]!;
        if (b < 2) { c.children += n; continue; }
        c.adults += n;
        if (b >= 4) c.elders += n;
        if (sex === 0) c.men += n; else c.women += n;
      }
    }
    return c;
  }
  const p = s.persons;
  for (const slot of g.members) {
    const age = p.ageMonths[slot]! / 12;
    if (age < A.adult) { c.children++; continue; }
    c.adults++;
    if (age >= A.elder) c.elders++;
    if (p.sex[slot] === 0) c.men++; else c.women++;
  }
  return c;
}

/**
 * Average actual and potential traits over adults (children's actual traits are still
 * developing). Villages use their sample's adults; `adults` is then the village's adult count.
 */
export function traitAverages(s: SimState, g: Group): {
  int: number; coop: number; str: number; potInt: number; potCoop: number; potStr: number; adults: number;
} {
  let n = 0, i = 0, c = 0, st = 0, pi = 0, pc = 0, ps = 0;
  if (g.village) {
    for (const m of g.village.sample) {
      if (m.ageYears < A.adult) continue;
      n++;
      i += m.act[0]; c += m.act[1]; st += m.act[2];
      pi += m.pot[0]; pc += m.pot[1]; ps += m.pot[2];
    }
    if (n === 0) return { int: 0, coop: 0, str: 0, potInt: 0, potCoop: 0, potStr: 0, adults: 0 };
    return { int: i / n, coop: c / n, str: st / n, potInt: pi / n, potCoop: pc / n, potStr: ps / n, adults: countMembers(s, g).adults };
  }
  const p = s.persons;
  for (const slot of g.members) {
    if (p.ageMonths[slot]! < A.adult * 12) continue;
    n++;
    i += p.actInt[slot]!; c += p.actCoop[slot]!; st += p.actStr[slot]!;
    pi += p.potInt[slot]!; pc += p.potCoop[slot]!; ps += p.potStr[slot]!;
  }
  if (n === 0) return { int: 0, coop: 0, str: 0, potInt: 0, potCoop: 0, potStr: 0, adults: 0 };
  return { int: i / n, coop: c / n, str: st / n, potInt: pi / n, potCoop: pc / n, potStr: ps / n, adults: n };
}

/** Removes empty groups; logs group and lineage extinction (§11.1). */
export function removeEmptyGroups(s: SimState): void {
  const empty = s.groups.filter((g) => population(g) === 0);
  if (empty.length === 0) return;
  for (const g of empty) logEvent(s, 'groupExtinct', `${g.name} died out`, g);
  removeGroups(s, empty);
}

/**
 * Takes groups off the map (died out, conquered, absorbed): leaves ruins of their buildings
 * (F4), drops their relations and logs the end of a lineage that has no group left.
 */
export function removeGroups(s: SimState, gone: Group[]): void {
  const ids = new Set(gone.map((g) => g.id));
  s.groups = s.groups.filter((g) => !ids.has(g.id));
  s.relations = s.relations.filter((r) => !ids.has(r.a) && !ids.has(r.b));
  s.alliances = s.alliances.filter((x) => !ids.has(x.a) && !ids.has(x.b) && !ids.has(x.against));
  // C4: a ruler that is gone lets its villages go.
  for (const g of gone) {
    const freed = s.groups.filter((o) => o.overlordId === g.id);
    for (const o of freed) o.overlordId = -1;
    if (freed.length > 0) logEvent(s, 'realm', `The ${g.realmRank === 2 ? 'kingdom' : 'chiefdom'} of ${g.name} fell apart (${villages(freed.length)} went free)`, g);
  }
  for (const g of gone) {
    leaveRuins(s, g);
    const lin = s.lineages.find((l) => l.id === g.lineageId);
    if (lin && lin.extinctYear === null && !s.groups.some((o) => o.lineageId === lin.id)) {
      lin.extinctYear = s.year;
      logEvent(s, 'lineageExtinct', `The ${lin.name} lineage is extinct`, g);
    }
  }
}
