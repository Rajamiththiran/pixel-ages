// Item 2b — walking routes on screen (render/paths.ts). Tiny hand-made maps, no simulation.

import { describe, expect, it } from 'vitest';
import { Ground, WallType } from '../src/shared/ids';
import { RouteCache, findRoute, lineClear, walkable, type WalkMap } from '../src/render/paths';

/** A w × h map from rows: '.' land, '~' water, '#' river wall, '=' crossing (breached wall). */
function mapOf(rows: string[]): WalkMap {
  const h = rows.length, w = rows[0]!.length;
  const m: WalkMap = { width: w, height: h, ground: new Uint8Array(w * h), wall: new Uint8Array(w * h), crossing: new Uint8Array(w * h) };
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    const i = y * w + x;
    if (c === '~') m.ground[i] = Ground.Water;
    if (c === '#' || c === '=') m.wall[i] = WallType.River;
    if (c === '=') m.crossing![i] = 1;
  }));
  return m;
}
const at = (m: WalkMap, x: number, y: number): number => y * m.width + x;

describe('walking routes (item 2b)', () => {
  it('walls block unless breached; water needs a Raft', () => {
    const m = mapOf(['.#=~']);
    expect(walkable(m, 0, false)).toBe(true);
    expect(walkable(m, 1, false)).toBe(false);
    expect(walkable(m, 2, false)).toBe(true);
    expect(walkable(m, 3, false)).toBe(false);
    expect(walkable(m, 3, true)).toBe(true);
  });

  it('a clear straight line needs no waypoints', () => {
    const m = mapOf(['......', '......', '......']);
    expect(findRoute(m, at(m, 0, 0), at(m, 5, 2), false)).toEqual([]);
  });

  it('a wall in the way is walked round, through its crossing', () => {
    const m = mapOf([
      '...#...',
      '...#...',
      '...#...',
      '...=...',
      '...#...',
    ]);
    const from = at(m, 1, 0), to = at(m, 5, 0);
    expect(lineClear(m, from, to, false)).toBe(false);
    const route = findRoute(m, from, to, false)!;
    expect(route.length).toBeGreaterThan(0);
    // Every leg of the route is a clear line, and the route crosses at the breach.
    const legs = [from, ...route, to];
    for (let k = 0; k + 1 < legs.length; k++) expect(lineClear(m, legs[k]!, legs[k + 1]!, false)).toBe(true);
    expect(route.some((i) => i % m.width === 3 || Math.abs((i % m.width) - 3) <= 1)).toBe(true);
  });

  it('no squeezing diagonally between two wall corners', () => {
    const m = mapOf(['.#', '#.']);
    expect(lineClear(m, at(m, 0, 0), at(m, 1, 1), false)).toBe(false);
    expect(findRoute(m, at(m, 0, 0), at(m, 1, 1), false)).toBeNull();
  });

  it('a lake is walked round on foot, crossed with a Raft', () => {
    const m = mapOf([
      '.......',
      '..~~~..',
      '..~~~..',
      '..~~~..',
      '.......',
    ]);
    const from = at(m, 0, 2), to = at(m, 6, 2);
    expect(findRoute(m, from, to, true)).toEqual([]);
    const route = findRoute(m, from, to, false)!;
    expect(route.length).toBeGreaterThan(0);
    expect(route.every((i) => m.ground[i] !== Ground.Water)).toBe(true);
  });

  it('an unreachable target gives null; the cache forgets routes when a breach opens', () => {
    const m = mapOf(['..#..', '..#..']);
    const cache = new RouteCache();
    cache.check(m);
    expect(cache.get(m, at(m, 0, 0), at(m, 4, 0), false)).toBeNull();
    m.crossing![at(m, 2, 1)] = 1;
    cache.check(m);
    expect(cache.get(m, at(m, 0, 0), at(m, 4, 0), false)).not.toBeNull();
  });
});
