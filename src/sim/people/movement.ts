// Migration and splitting (§11.8).

import { CONFIG } from '../../config';
import { Ground } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { chance, int } from '../../shared/rng';
import type { Group, SimState } from '../state';
import { tilesConnected } from '../world/regions';
import { hasActive, isKnown, passableFor } from './explore';
import { rangeSustainable, rangeTiles } from './food';
import { addGroup, logEvent, newGroup, traitAverages } from './groups';

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
  const here = rangeSustainable(s, rangeTiles(s, g), g);
  // Don't settle on another band's range (DECISIONS 3.7): same 2R spacing as a split.
  const minD = SP.minDistanceR * P.range.forage;
  const others = s.groups.filter((o) => o.id !== g.id).map((o) => [o.homeX, o.homeY] as const);
  let best = -1;
  let bestScore = here;
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
      const score = rangeSustainable(s, rangeTiles(s, g, x, y), g) - MG.distancePenalty * Math.sqrt(d2);
      if (score > bestScore) { bestScore = score; best = i; }
    }
  }
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
  const pop = g.members.length;
  const triggered = g.crowdedMonths >= SP.months || (!farming && pop > P.groupSize.bandMax);
  g.wantsSplit = triggered;
  if (!triggered || pop < 2) return;
  const avgCoop = traitAverages(s, g).coop;
  if (!chance(s.rng, SP.bandChance * (SP.coopBase - avgCoop / 100))) return;

  const site = findSplitSite(s, g);
  if (site < 0) return; // nowhere to go yet: crowding keeps pushing people to explore

  const moving = pickFamilies(s, g, Math.round(pop * SP.bandShare));
  if (moving.length === 0 || moving.length >= pop) return;
  createSplit(s, g, moving, site);
}

/** Best known site by sustainable yield, connected, at least 2R from every group's home. */
function findSplitSite(s: SimState, g: Group): number {
  const minD = SP.minDistanceR * P.range.forage;
  const homes = s.groups.map((o) => [o.homeX, o.homeY] as const);
  let best = -1;
  let bestScore = 0;
  for (let y = 0; y < s.height; y += MG.sampleStep) {
    for (let x = 0; x < s.width; x += MG.sampleStep) {
      const i = y * s.width + x;
      if (!siteOk(s, g, i)) continue;
      if (homes.some(([hx, hy]) => (hx - x) ** 2 + (hy - y) ** 2 < minD * minD)) continue;
      const score = rangeSustainable(s, rangeTiles(s, g, x, y), g);
      if (score > bestScore) { bestScore = score; best = i; }
    }
  }
  return best;
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
  const unitOf = new Map<number, number>(); // slot â†’ unit key (a person id)
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

function createSplit(s: SimState, parent: Group, moving: number[], site: number): void {
  const p = s.persons;
  const lin = s.lineages.find((l) => l.id === parent.lineageId)!;
  lin.splitCounter++;
  const x = site % s.width;
  const y = Math.floor(site / s.width);
  const g = newGroup(s, s.nextGroupId++, `${lin.name} ${lin.splitCounter}`, lin.id, x, y);
  // The new group knows what its parent knew, and keeps its skills.
  g.known.set(parent.known);
  g.knownCount = parent.knownCount;
  g.frontier = parent.frontier.slice();
  g.discoveries = parent.discoveries;
  g.inactive = parent.inactive;
  g.era = parent.era;
  g.belowLimitYears.set(parent.belowLimitYears);
  g.hasHunted = parent.hasHunted;
  g.fedHistory.set(parent.fedHistory);
  g.fedIndex = parent.fedIndex;
  g.teachBonus = parent.teachBonus;
  g.herd = Math.floor(parent.herd / 2);
  parent.herd -= g.herd;
  const share = moving.length / parent.members.length;
  g.foodStock = parent.foodStock * share;
  parent.foodStock -= g.foodStock;

  const leaving = new Set(moving);
  for (const slot of moving) p.groupId[slot] = g.id;
  parent.members = parent.members.filter((slot) => !leaving.has(slot));
  g.members = [...moving].sort((a, b) => p.id[a]! - p.id[b]!);
  parent.crowdedMonths = 0;
  parent.wantsSplit = false;
  addGroup(s, g);
  const dist = Math.round(Math.sqrt((x - parent.homeX) ** 2 + (y - parent.homeY) ** 2));
  logEvent(s, 'split', `${parent.name} split: ${g.name} set off ${dist} km away with ${moving.length} people`, parent, g);
}
