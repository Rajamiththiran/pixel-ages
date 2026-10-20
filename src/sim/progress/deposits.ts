// Painted resource deposits (§12.6): finding the ones a group knows and taking units from them.

import { CONFIG } from '../../config';
import { Ground, Resource, WallType } from '../../shared/ids';
import type { MapData } from '../../shared/types';
import type { Group, SimState } from '../state';

const isKnownTile = (g: Group, i: number): boolean => ((g.known[i >> 3]! >> (i & 7)) & 1) === 1;

/** Every tile with a resource left, ascending (found once a year for all groups). */
export function resourceTiles(s: SimState): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.resourceAmount.length; i++) if (s.resourceAmount[i]! > 0) out.push(i);
  return out;
}

/** Known tiles holding resource r, nearest to home first (ties → lowest index). */
export function knownResourceTiles(s: SimState, g: Group, r: number, deposits: readonly number[]): number[] {
  const out: Array<[number, number]> = [];
  const w = s.width;
  for (const i of deposits) {
    if (s.resourceType[i] !== r || s.resourceAmount[i] === 0 || !isKnownTile(g, i)) continue;
    const dx = (i % w) - g.homeX;
    const dy = Math.floor(i / w) - g.homeY;
    out.push([dx * dx + dy * dy, i]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.map((e) => e[1]);
}

/** Units of r the group could take right now from deposits it knows. */
export function availableUnits(s: SimState, tiles: readonly number[]): number {
  let n = 0;
  for (const i of tiles) n += s.resourceAmount[i]!;
  return n;
}

/** Takes `units` from the given tiles in order. An emptied deposit is gone from the map. */
export function takeUnits(s: SimState, tiles: readonly number[], units: number): void {
  let left = units;
  for (const i of tiles) {
    if (left <= 0) break;
    const take = Math.min(left, s.resourceAmount[i]!);
    s.resourceAmount[i] = s.resourceAmount[i]! - take;
    // An emptied deposit is gone from the map and leaves a quarry or mine pit (F4 §10.5).
    if (s.resourceAmount[i] === 0) { s.resourceType[i] = Resource.None; s.quarry[i] = 1; }
    left -= take;
  }
}

// Painted clay tiles beside water, with their painted amount; worked out once per painted map
// (it never changes during a run), so it is not part of the state.
const clayBanks = new WeakMap<MapData, Array<[number, number]>>();

function banksOf(m: MapData): Array<[number, number]> {
  let banks = clayBanks.get(m);
  if (banks) return banks;
  banks = [];
  const wet = (j: number): boolean => m.ground[j] === Ground.Water || m.wall[j] === WallType.River || m.wall[j] === WallType.Sea;
  for (let i = 0; i < m.resourceType.length; i++) {
    if (m.resourceType[i] !== Resource.Clay || m.resourceAmount[i] === 0) continue;
    const x = i % m.width, y = (i - x) / m.width;
    let nearWater = false;
    for (let dy = -1; dy <= 1 && !nearWater; dy++) {
      for (let dx = -1; dx <= 1 && !nearWater; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < m.width && ny < m.height) nearWater = wet(ny * m.width + nx);
      }
    }
    if (nearWater) banks.push([i, m.resourceAmount[i]!]);
  }
  clayBanks.set(m, banks);
  return banks;
}

/**
 * Yearly (DECISIONS 17.5): painted clay beside water gains 5 units, up to its painted amount. A
 * dug-out bank (a pit) holds clay again. Clay painted away from water stays finite.
 */
export function renewClay(s: SimState): void {
  const add = CONFIG.discoveries.clayRenewPerYear;
  for (const [i, painted] of banksOf(s.setup.map)) {
    if (s.resourceType[i] !== Resource.Clay && s.resourceType[i] !== Resource.None) continue;
    if (s.resourceAmount[i]! >= painted) continue;
    s.resourceType[i] = Resource.Clay;
    s.quarry[i] = 0;
    s.resourceAmount[i] = Math.min(painted, s.resourceAmount[i]! + add);
  }
}

/** Takes `units` of r from the nearest known deposits if there are enough; false (nothing taken) if not. */
export function takeResource(s: SimState, g: Group, r: number, units: number, deposits = resourceTiles(s)): boolean {
  const tiles = knownResourceTiles(s, g, r, deposits);
  if (availableUnits(s, tiles) < units) return false;
  takeUnits(s, tiles, units);
  return true;
}
