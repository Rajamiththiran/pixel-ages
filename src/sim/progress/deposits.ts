// Painted resource deposits (§12.6): finding the ones a group knows and taking units from them.

import { Resource } from '../../shared/ids';
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
    if (s.resourceAmount[i] === 0) s.resourceType[i] = Resource.None;
    left -= take;
  }
}

/** Takes `units` of r from the nearest known deposits if there are enough; false (nothing taken) if not. */
export function takeResource(s: SimState, g: Group, r: number, units: number, deposits = resourceTiles(s)): boolean {
  const tiles = knownResourceTiles(s, g, r, deposits);
  if (availableUnits(s, tiles) < units) return false;
  takeUnits(s, tiles, units);
  return true;
}
