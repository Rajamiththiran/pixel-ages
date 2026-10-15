// Groups and lineages: creation, membership, averages and the event log.

import { CONFIG } from '../../config';
import { Mode } from '../../shared/ids';
import { DISCOVERY_COUNT } from '../../shared/discoveries';
import type { LogType } from '../../shared/types';
import type { Group, SimState } from '../state';
import { freePerson } from './persons';

const A = CONFIG.people.ages;

export function newGroup(s: SimState, id: number, name: string, lineageId: number, homeX: number, homeY: number): Group {
  const fed = new Float32Array(CONFIG.time.ticksPerYear).fill(1);
  return {
    id, name, lineageId, mode: Mode.Band, homeX, homeY, foundedYear: s.year,
    known: new Uint8Array(Math.ceil((s.width * s.height) / 8)), knownCount: 0, knownVersion: 0,
    frontier: [],
    discoveries: 0, inactive: 0, era: 0, belowLimitYears: new Uint8Array(DISCOVERY_COUNT),
    foodStock: 0, fedHistory: fed, fedIndex: 0,
    herd: 0, herders: 0, farmTiles: [], hasHunted: false, huts: 0, houses: 0, buildProgress: 0,
    hungryMonths: 0, crowdedMonths: 0, wantsSplit: false, wallTarget: null,
    teachBonus: 1, teacherMonths: 0, carers: 0, cannotReproduceLogged: false, village: null,
    members: [],
    need: 0, hunger: 0, plantAvail: 0, preyAvail: 0, sustainable: 0, crowding: 0, lowestFed: 1, fedYearSum: 0,
  };
}

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
): void {
  s.log.push({
    year: s.year, month: s.month, type, text,
    groupId: g?.id ?? null, otherId: other?.id ?? null, lineageId: g?.lineageId ?? null,
    x: x ?? g?.homeX ?? null, y: y ?? g?.homeY ?? null,
  });
  if (s.log.length > CONFIG.log.maxEntries) {
    s.log.shift();
    s.logDropped++;
  }
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

export function countMembers(s: SimState, g: Group): GroupCounts {
  const p = s.persons;
  const c: GroupCounts = { men: 0, women: 0, children: 0, elders: 0, adults: 0 };
  for (const slot of g.members) {
    const age = p.ageMonths[slot]! / 12;
    if (age < A.adult) { c.children++; continue; }
    c.adults++;
    if (age >= A.elder) c.elders++;
    if (p.sex[slot] === 0) c.men++; else c.women++;
  }
  return c;
}

/** Average actual and potential traits over adults (children's actual traits are still developing). */
export function traitAverages(s: SimState, g: Group): {
  int: number; coop: number; str: number; potInt: number; potCoop: number; potStr: number; adults: number;
} {
  const p = s.persons;
  let n = 0, i = 0, c = 0, st = 0, pi = 0, pc = 0, ps = 0;
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
  const empty = s.groups.filter((g) => g.members.length === 0);
  if (empty.length === 0) return;
  for (const g of empty) logEvent(s, 'groupExtinct', `${g.name} died out`, g);
  s.groups = s.groups.filter((g) => g.members.length > 0);
  for (const g of empty) {
    const lin = s.lineages.find((l) => l.id === g.lineageId);
    if (lin && lin.extinctYear === null && !s.groups.some((o) => o.lineageId === lin.id)) {
      lin.extinctYear = s.year;
      logEvent(s, 'lineageExtinct', `The ${lin.name} lineage is extinct`, g);
    }
  }
}
