import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Ground, WallType } from '../src/shared/ids';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { isKnown, revealAround, revealRadius } from '../src/sim/people/explore';
import { rangeTiles } from '../src/sim/people/food';
import { W, at, fourPeople, runOf } from './fixtures';

function walled(): ReturnType<typeof createState> {
  const m = createMap();
  for (let y = 0; y < 90; y++) m.wall[at(20, y)] = WallType.Mountain;
  const run = runOf(m);
  run.founders = [{ id: 1, name: 'West', colorIndex: 0, x: 12, y: 40, people: fourPeople(160) }];
  return createState(run);
}

describe('exploring (§11.7)', () => {
  it('founders know radius 3 around home', () => {
    const s = walled();
    const g = s.groups[0]!;
    expect(isKnown(g, at(12, 40))).toBe(true);
    expect(isKnown(g, at(15, 40))).toBe(true);
    expect(isKnown(g, at(16, 40))).toBe(false);
  });

  it('reveal radius grows with intelligence: 60 → 2, 100 → 3, 140 → 4', () => {
    expect(revealRadius(60)).toBe(2);
    expect(revealRadius(100)).toBe(3);
    expect(revealRadius(140)).toBe(4);
    expect(revealRadius(40)).toBe(1);
    expect(revealRadius(180)).toBe(5);
  });

  it('a reveal next to a wall sees the wall but nothing behind it', () => {
    const s = walled();
    const g = s.groups[0]!;
    revealAround(s, g, 18, 40, 5);
    expect(isKnown(g, at(20, 40))).toBe(true);   // the wall itself
    expect(isKnown(g, at(21, 40))).toBe(false);  // behind it
    expect(g.frontier.every((i) => i % W < 20)).toBe(true);
  });

  it('after 60 years, nothing past the wall is known and the frontier never crosses it', () => {
    const s = walled();
    runTicks(s, 60 * 12);
    for (const g of s.groups) {
      for (let y = 0; y < 90; y++) for (let x = 21; x < 160; x++) expect(isKnown(g, at(x, y))).toBe(false);
      expect(g.frontier.every((i) => i % W < 20)).toBe(true);
    }
  });

  it('water blocks the forage range without a raft', () => {
    const m = createMap();
    for (let y = 0; y < 90; y++) { m.ground[at(14, y)] = Ground.Water; m.ground[at(15, y)] = Ground.Water; }
    const run = runOf(m);
    run.founders = [{ id: 1, name: 'Bank', colorIndex: 0, x: 12, y: 40, people: fourPeople() }];
    const s = createState(run);
    const g = s.groups[0]!;
    revealAround(s, g, 12, 40, 6);
    expect(isKnown(g, at(17, 40))).toBe(true);   // seen across the water (same area)…
    const range = rangeTiles(s, g);
    expect(range.length).toBeGreaterThan(0);
    expect(range.every((i) => i % W < 14)).toBe(true); // …but not reachable to forage
  });
});
