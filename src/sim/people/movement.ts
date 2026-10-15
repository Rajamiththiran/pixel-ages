// Migration and splitting (§11.8).

import { CONFIG } from '../../config';
import { Ground, Sex } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { chance, int } from '../../shared/rng';
import type { Group, SimState } from '../state';
import { tilesConnected } from '../world/regions';
import { hasActive, isKnown, passableFor } from './explore';
import { homeRange, huntFactor, rangeSustainable, rangeTiles, tileSustainable } from './food';
import { logEvent, population, traitAverages } from './groups';
import { partySize, partyViable, shareOfCounts, spawnGroup, takeCounts, takeSlots, type Party } from './transfer';

const P = CONFIG.people;
const MG = P.migrate;
const SP = P.split;

/** Migrate range: 25 tiles, × 2 with Cart, × 2 with Riding. */
export function migrateRange(g: Group): number {
  const r = P.range;
  return r.migrate * (hasActive(g, Discovery.cart) ? r.cartMigrateMult : 1) * (hasActive(g, Discovery.riding) ? r.ridingMigrateMult : 1);
}

/** Can this group live on tile i: known, walkable, not Water, connected to home. */
function siteOk(s: SimState, g: Group, i: number): boolean {
  if (!isKnown(g, i) || !passableFor(s, g, i) || s.ground[i] === Ground.Water) return false;
  return tilesConnected(s.regionId, s.regionParent, i, g.homeY * s.width + g.homeX);
}

/** Monthly migration check (§11.8). Returns true if the group moved. */
export function checkMigration(s: SimState, g: Group): boolean {
  const farmer = g.farmTiles.length > 0;
  const hungry = farmer ? g.hunger > MG.farmerHungerAbove : g.hunger > MG.hungerAbove && g.plantAvail < MG.plantAvailBelow;
  g.hungryMonths = hungry ? g.hungryMonths + 1 : 0;
  if (g.hungryMonths < (farmer ? MG.farmerMonths : MG.months)) return false;

  // Best known site within migrate range: sustainable yield there minus 0.5 per tile of distance.
  // Sampling every 2nd tile keeps this cheap; staying put is the baseline to beat.
  const range = migrateRange(g);
  const here = rangeSustainable(s, homeRange(s, g), g);
  // Don't settle on another band's range (DECISIONS 3.7): same 2R spacing as a split.
  const minD = SP.minDistanceR * P.range.forage;
  const others = s.groups.filter((o) => o.id !== g.id).map((o) => [o.homeX, o.homeY] as const);
  const sites: Site[] = [];
  for (let y = Math.max(0, g.homeY - range); y <= Math.min(s.height - 1, g.homeY + range); y++) {
    if (y % MG.sampleStep !== 0) continue;
    for (let x = Math.max(0, g.homeX - range); x <= Math.min(s.width - 1, g.homeX + range); x++) {
      if (x % MG.sampleStep !== 0) continue;
      const dx = x - g.homeX;
      const dy = y - g.homeY;
      const d2 = dx * dx + dy * dy;
      if (d2 > range * range) continue;
      const i = y * s.width + x;
      if (!siteOk(s, g, i)) continue;
      if (others.some(([hx, hy]) => (hx - x) ** 2 + (hy - y) ** 2 < minD * minD)) continue;
      sites.push({ i, penalty: MG.distancePenalty * Math.sqrt(d2) });
    }
  }
  const best = pickSite(s, g, sites, here);
  g.hungryMonths = 0;
  if (best < 0) return false;

  const nx = best % s.width;
  const ny = Math.floor(best / s.width);
  const dist = Math.round(Math.sqrt((nx - g.homeX) ** 2 + (ny - g.homeY) ** 2));
  g.homeX = nx;
  g.homeY = ny;
  // Shelters and fields stay behind.
  g.huts = 0;
  g.houses = 0;
  g.buildProgress = 0;
  g.farmTiles = [];
  if (dist >= MG.logMinDistance) logEvent(s, 'migrate', `${g.name} moved ${dist} km in search of food`, g);
  return true;
}

/** Monthly split check (§11.8). */
export function checkSplit(s: SimState, g: Group): void {
  const farming = hasActive(g, Discovery.farming);
  g.crowdedMonths = g.crowding > SP.crowdingAbove ? g.crowdedMonths + 1 : 0;
  const pop = population(g);
  const village = g.village !== null;
  const triggered = g.crowdedMonths >= SP.months || (!farming && pop > P.groupSize.bandMax);
  g.wantsSplit = triggered;
  // Both halves must be able to carry on (DECISIONS 4.19), so a tiny band never splits.
  if (!triggered || pop < 2 * SP.minPeople) return;
  const avgCoop = traitAverages(s, g).coop;
  if (!chance(s.rng, (village ? SP.villageChance : SP.bandChance) * (SP.coopBase - avgCoop / 100))) return;

  const site = findSplitSite(s, g);
  if (site < 0) return; // nowhere to go yet: crowding keeps pushing people to explore

  let party: Party;
  if (village) {
    // Villages send 30% of every age group (§11.8).
    const counts = shareOfCounts(s, g.village!, SP.villageShare);
    const probe: Party = { slots: [], counts, sample: [], life: { fed: 1, childFed: 1, childAdversity: 0 } };
    if (!partyViable(s, probe) || partySize(probe) >= pop) return;
    party = takeCounts(g, counts);
  } else {
    const moving = pickFamilies(s, g, Math.round(pop * SP.bandShare));
    if (moving.length === 0 || moving.length >= pop) return;
    const leaving = new Set(moving);
    if (!viable(s, moving) || !viable(s, g.members.filter((slot) => !leaving.has(slot)))) return;
    party = takeSlots(g, moving);
  }
  createSplit(s, g, party, site, partySize(party) / pop);
}

/**
 * A group that can carry on by itself: at least 4 people, including a man 16+ and a woman
 * 16–40 — the same test §14.4 uses for refugees.
 */
export function viable(s: SimState, slots: readonly number[]): boolean {
  if (slots.length < SP.minPeople) return false;
  const p = s.persons;
  const B = P.birth;
  let man = false, woman = false;
  for (const slot of slots) {
    const age = p.ageMonths[slot]! / 12;
    if (p.sex[slot] === Sex.Male) { if (age >= B.minAge) man = true; }
    else if (age >= B.minAge && age <= B.maxAge) woman = true;
  }
  return man && woman;
}

/** Best known site by sustainable yield, connected, at least 2R from every group's home. */
function findSplitSite(s: SimState, g: Group): number {
  return bestSite(s, g, s.groups.map((o) => [o.homeX, o.homeY] as const), SP.minDistanceR * P.range.forage);
}

/**
 * Whole families leave together: a couple and their children under 15, or a single parent
 * and their children. Units are shuffled (seeded) and taken until the target is reached.
 */
export function pickFamilies(s: SimState, g: Group, target: number): number[] {
  const p = s.persons;
  const inGroup = (id: number): number => {
    const slot = p.slotOf.get(id);
    return slot !== undefined && p.groupId[slot] === g.id ? slot : -1;
  };
  const unitOf = new Map<number, number>(); // slot → unit key (a person id)
  const adult = (slot: number): boolean => p.ageMonths[slot]! >= P.ages.adult * 12;
  for (const slot of g.members) {
    if (!adult(slot)) continue;
    const partner = p.partnerId[slot]! >= 0 ? inGroup(p.partnerId[slot]!) : -1;
    unitOf.set(slot, partner >= 0 ? Math.min(p.id[slot]!, p.id[partner]!) : p.id[slot]!);
  }
  for (const slot of g.members) {
    if (adult(slot)) continue;
    const mom = inGroup(p.motherId[slot]!);
    const dad = inGroup(p.fatherId[slot]!);
    const parent = mom >= 0 ? mom : dad;
    unitOf.set(slot, parent >= 0 ? unitOf.get(parent)! : p.id[slot]!);
  }
  const units = new Map<number, number[]>();
  for (const slot of g.members) {
    const key = unitOf.get(slot)!;
    const u = units.get(key);
    if (u) u.push(slot); else units.set(key, [slot]);
  }
  const list = [...units.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  for (let k = list.length - 1; k > 0; k--) {
    const j = int(s.rng, k + 1);
    [list[k], list[j]] = [list[j]!, list[k]!];
  }
  const out: number[] = [];
  for (const u of list) {
    if (out.length >= target) break;
    out.push(...u);
  }
  return out;
}

function createSplit(s: SimState, parent: Group, party: Party, site: number, share: number): void {
  const moving = partySize(party);
  const g = spawnGroup(s, parent, party, site);
  g.herd = Math.floor(parent.herd / 2);
  parent.herd -= g.herd;
  g.foodStock = parent.foodStock * share;
  parent.foodStock -= g.foodStock;
  parent.crowdedMonths = 0;
  parent.wantsSplit = false;
  const dist = Math.round(Math.sqrt((g.homeX - parent.homeX) ** 2 + (g.homeY - parent.homeY) ** 2));
  logEvent(s, 'split', `${parent.name} split: ${g.name} set off ${dist} km away with ${moving} people`, parent, g);
}

/**
 * Best known site for `g` by sustainable yield: walkable, connected to home, and at least
 * `minDist` from every listed home. Every 2nd tile is sampled. −1 if none.
 */
export function bestSite(s: SimState, g: Group, homes: ReadonlyArray<readonly [number, number]>, minDist: number): number {
  const sites: Site[] = [];
  for (let y = 0; y < s.height; y += MG.sampleStep) {
    for (let x = 0; x < s.width; x += MG.sampleStep) {
      const i = y * s.width + x;
      if (!siteOk(s, g, i)) continue;
      if (homes.some(([hx, hy]) => (hx - x) ** 2 + (hy - y) ** 2 < minDist * minDist)) continue;
      sites.push({ i, penalty: 0 });
    }
  }
  return pickSite(s, g, sites, 0);
}

/** A candidate home: tile index and the score taken off its range yield (distance). */
interface Site { i: number; penalty: number }

/**
 * The site with the highest range yield − penalty that beats `floor`; on equal scores the
 * earliest site in the list (the old scan order). Exact, but fast: every site first gets a
 * cheap upper bound — the yield of all known walkable tiles in the square around it, from a
 * summed-area table — and the exact forage-range walk only runs while a site could still win.
 */
function pickSite(s: SimState, g: Group, sites: Site[], floor: number): number {
  if (sites.length === 0) return -1;
  const w = s.width;
  const h = s.height;
  const W1 = w + 1;
  const hf = huntFactor(g);
  const t = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (isKnown(g, i) && passableFor(s, g, i)) row += tileSustainable(s, i, hf);
      t[(y + 1) * W1 + x + 1] = t[y * W1 + x + 1]! + row;
    }
  }
  const R = P.range.forage;
  const bound = (i: number): number => {
    const x = i % w;
    const y = (i - x) / w;
    const x0 = Math.max(0, x - R), x1 = Math.min(w - 1, x + R) + 1;
    const y0 = Math.max(0, y - R), y1 = Math.min(h - 1, y + R) + 1;
    return t[y1 * W1 + x1]! - t[y0 * W1 + x1]! - t[y1 * W1 + x0]! + t[y0 * W1 + x0]!;
  };
  const order = sites.map((c, k) => ({ i: c.i, k, penalty: c.penalty, ub: bound(c.i) - c.penalty }))
    .sort((a, b) => b.ub - a.ub || a.k - b.k);
  const EPS = 1e-6; // float sums in another order may differ by a hair
  let best = -1;
  let bestScore = floor;
  let bestK = Infinity;
  for (const c of order) {
    if (c.ub + EPS < bestScore) break;
    const score = rangeSustainable(s, rangeTiles(s, g, c.i % w, Math.floor(c.i / w)), g) - c.penalty;
    if (score > bestScore || (best >= 0 && score === bestScore && c.k < bestK)) {
      best = c.i;
      bestScore = score;
      bestK = c.k;
    }
  }
  return best;
}
