// Moving people between groups (splits, captives, refugees, absorbed groups), whatever the
// mode on either side: band people move as individuals; village people move as counts plus
// the sample that stands for them.

import { CONFIG } from '../../config';
import { Mode, Sex } from '../../shared/ids';
import { stochasticRound } from '../../shared/rng';
import type { Group, SampleMember, SimState, VillageData } from '../state';
import { cloneVillage } from '../serialize';
import { BUCKETS, addGroup, newGroup, population } from './groups';
import { freePerson } from './persons';
import { bucketOf, memberOf, mergeSamples, personFromVillage, sampleDealer, toVillage } from './village';
import { inheritSociety } from '../society/society';

const P = CONFIG.people;

/** People on the move: band individuals (`slots`, still alive in the pool) and/or village counts. */
export interface Party {
  slots: number[];
  counts: Int32Array;            // [sex * 6 + bucket], like VillageData.counts
  sample: SampleMember[];        // stands for `counts`
  life: { fed: number; childFed: number; childAdversity: number };
}

const emptyCounts = (): Int32Array => new Int32Array(2 * BUCKETS);

export function partySize(pt: Party): number {
  let n = pt.slots.length;
  for (const c of pt.counts) n += c;
  return n;
}

/** At least 4 people, including a man 16+ and a woman 16–40 (§14.4 refugees, DECISIONS 4.19). */
export function partyViable(s: SimState, pt: Party): boolean {
  if (partySize(pt) < P.split.minPeople) return false;
  const p = s.persons;
  const B = P.birth;
  // Village buckets: men 15+ (buckets 2–5) and women 15–49 (bucket 2) stand in for 16+ / 16–40.
  let man = pt.counts[2]! + pt.counts[3]! + pt.counts[4]! + pt.counts[5]! > 0;
  let woman = pt.counts[BUCKETS + 2]! > 0;
  for (const slot of pt.slots) {
    const age = p.ageMonths[slot]! / 12;
    if (p.sex[slot] === Sex.Male) { if (age >= B.minAge) man = true; }
    else if (age >= B.minAge && age <= B.maxAge) woman = true;
  }
  return man && woman;
}

/** Takes these band members out of the group (they stay alive until they join another). */
export function takeSlots(g: Group, slots: number[]): Party {
  const leaving = new Set(slots);
  g.members = g.members.filter((slot) => !leaving.has(slot));
  return { slots: slots.slice(), counts: emptyCounts(), sample: [], life: { fed: 1, childFed: 1, childAdversity: 0 } };
}

/** How many of each village cell a `share` would take (stochastic rounding), without taking them. */
export function shareOfCounts(s: SimState, v: VillageData, share: number): Int32Array {
  const out = emptyCounts();
  for (let c = 0; c < out.length; c++) out[c] = Math.min(v.counts[c]!, stochasticRound(s.rng, v.counts[c]! * share));
  return out;
}

/** Takes these counts out of a village; the party carries a copy of its sample. */
export function takeCounts(g: Group, counts: Int32Array): Party {
  const v = g.village!;
  for (let c = 0; c < counts.length; c++) v.counts[c] = v.counts[c]! - counts[c]!;
  return {
    slots: [], counts: counts.slice(), sample: cloneVillage(v).sample,
    life: { fed: v.fed, childFed: v.childFed, childAdversity: v.childAdversity },
  };
}

/** Everyone in the group, as a party (the group is left empty). */
export function takeAll(g: Group): Party {
  if (g.village) return takeCounts(g, g.village.counts.slice());
  return takeSlots(g, g.members.slice());
}

/**
 * Adds a party to a group. Into a band: individuals join, village counts become individuals.
 * Into a village: individuals are counted (and freed), counts are added, and the samples are
 * merged in proportion to the people they stand for (DECISIONS 5.6).
 */
export function addParty(s: SimState, target: Group, pt: Party): void {
  const p = s.persons;
  const v = target.village;
  if (v) {
    const popBefore = population(target);
    const incoming = pt.sample.slice();
    for (let c = 0; c < pt.counts.length; c++) v.counts[c] = v.counts[c]! + pt.counts[c]!;
    for (const slot of pt.slots) {
      v.counts[p.sex[slot]! * BUCKETS + bucketOf(p.ageMonths[slot]! / 12)]! += 1;
      incoming.push(memberOf(s, slot));
      freePerson(p, slot);
    }
    v.sample = mergeSamples(s.rng, v.sample, popBefore, incoming, partySize(pt));
    return;
  }
  for (const slot of pt.slots) {
    p.groupId[slot] = target.id;
    target.members.push(slot);
  }
  if (pt.sample.length > 0) {
    const from: VillageData = {
      counts: pt.counts, sample: pt.sample, fed: pt.life.fed, childFed: pt.life.childFed,
      childAdversity: pt.life.childAdversity, birthsThisYear: 0, deathMultSum: 0, deathMultMonths: 0, shortage: false,
    };
    const deal = sampleDealer(s.rng, pt.sample.length);
    for (let c = 0; c < pt.counts.length; c++) {
      for (let k = 0; k < pt.counts[c]!; k++) {
        target.members.push(personFromVillage(s, target, from, Math.floor(c / BUCKETS), c % BUCKETS, deal()));
      }
    }
  }
  target.members.sort((a, b) => p.id[a]! - p.id[b]!);
}

/**
 * A new group of `source`'s lineage at tile `site`, made of `party` (splits and refugees).
 * It knows what the source knew and keeps its skills. 150+ people start as a village.
 */
export function spawnGroup(s: SimState, source: Group, party: Party, site: number): Group {
  const lin = s.lineages.find((l) => l.id === source.lineageId)!;
  lin.splitCounter++;
  const g = newGroup(s, s.nextGroupId++, `${lin.name} ${lin.splitCounter}`, lin.id, site % s.width, Math.floor(site / s.width));
  g.known.set(source.known);
  g.knownCount = source.knownCount;
  g.frontier = source.frontier.slice();
  g.discoveries.set(source.discoveries);
  g.inactive.set(source.inactive);
  g.inactiveWhy.set(source.inactiveWhy);
  // Rafts, boats and carts stay with the old group (built = 0): the new one builds its own (F1).
  g.era = source.era;
  g.belowLimitYears.set(source.belowLimitYears);
  g.hasHunted = source.hasHunted;
  g.fedHistory.set(source.fedHistory);
  g.fedIndex = source.fedIndex;
  g.teachBonus = source.teachBonus;
  const size = partySize(party);
  // Practice goes with the people (F2): the party takes its share, so practice per person stays
  // the same in both groups. The party has already left `source`.
  const share = size / Math.max(1, size + population(source));
  for (let k = 0; k < g.practice.length; k++) {
    g.practice[k] = source.practice[k]! * share;
    source.practice[k] = source.practice[k]! - g.practice[k]!;
  }
  g.idleYears.set(source.idleYears);
  g.needs.set(source.needs);
  g.lessons.set(source.lessons);
  g.maintenance = source.maintenance;
  // Culture (drifting a little), language and history go with the people; walls and chiefs stay (F6).
  inheritSociety(s, g, source);
  if (size >= P.groupSize.toVillageAt && party.slots.length === 0) {
    // A village from a village: keep counts and sample as they are.
    g.mode = Mode.Village;
    g.village = {
      counts: emptyCounts(), sample: [], ...party.life,
      birthsThisYear: 0, deathMultSum: 0, deathMultMonths: 0, shortage: false,
    };
  }
  addParty(s, g, party);
  if (g.mode === Mode.Band && g.members.length >= P.groupSize.toVillageAt) toVillage(s, g);
  addGroup(s, g);
  return g;
}
