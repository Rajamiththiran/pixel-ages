import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Plant, WallType } from '../src/shared/ids';
import { Discovery } from '../src/shared/discoveries';
import { createState } from '../src/sim/state';
import { tilesConnected } from '../src/sim/world/regions';
import { isKnown } from '../src/sim/people/explore';
import { breachChecks, pressure, updateWallTarget, wearWall } from '../src/sim/society/walls';
import { at, fourPeople, runOf } from './fixtures';

const bits = (...ids: number[]): number => ids.reduce((m, d) => m | (1 << d), 0);

/** A river wall (2 wide) at x = 60–61 and a mountain wall at x = 30; sea around the edge. One band at (57, 40). */
function walled(): ReturnType<typeof createState> {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  for (let y = 0; y < 90; y++) {
    for (let x = 0; x < 160; x++) {
      const i = at(x, y);
      if (x === 0 || y === 0 || x === 159 || y === 89) m.wall[i] = WallType.Sea;
      else if (x === 60 || x === 61) m.wall[i] = WallType.River;
      else if (x === 30) m.wall[i] = WallType.Mountain;
    }
  }
  const run = runOf(m);
  run.founders = [{ id: 1, name: 'Shore', colorIndex: 0, x: 57, y: 40, people: fourPeople() }];
  return createState(run);
}

describe('walls (§13)', () => {
  it('only worked with the right discovery and pressure ≥ 0.4', () => {
    const s = walled();
    const g = s.groups[0]!;
    expect(isKnown(g, at(60, 40))).toBe(true);    // the river bank is in sight
    g.crowding = 0;
    g.hunger = 50;                                 // P = 0.5
    updateWallTarget(s, g);
    expect(g.wallTarget).toBeNull();               // no Boat
    g.discoveries = bits(Discovery.mining);
    updateWallTarget(s, g);
    expect(g.wallTarget).toBeNull();               // Mining is for mountains
    g.discoveries = bits(Discovery.raft, Discovery.stoneTools, Discovery.boat);
    g.hunger = 39;                                 // P = 0.39
    updateWallTarget(s, g);
    expect(g.wallTarget).toBeNull();
    g.hunger = 40;
    expect(pressure(g)).toBeCloseTo(0.4);
    updateWallTarget(s, g);
    expect(g.wallTarget).not.toBeNull();
    expect(s.wall[g.wallTarget!.tile]).toBe(WallType.River);
    expect(g.wallTarget!.tile).toBe(at(60, 40));   // the nearest known tile
    // An inactive discovery adds pressure 0.5 on its own.
    g.hunger = 0;
    g.inactive = bits(Discovery.stoneTools);
    expect(pressure(g)).toBe(0.5);
  });

  it('the sea at the map edge is never worth breaking: nothing lies behind it', () => {
    const m = createMap();
    for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) if (x === 0 || y === 0 || x === 159 || y === 89) m.wall[at(x, y)] = WallType.Sea;
    const run = runOf(m);
    run.founders = [{ id: 1, name: 'Coast', colorIndex: 0, x: 3, y: 40, people: fourPeople() }];
    const s = createState(run);
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.raft, Discovery.stoneTools, Discovery.boat);
    g.hunger = 100;
    updateWallTarget(s, g);
    expect(g.wallTarget).toBeNull();
  });

  it('wear = 0.05 × max(1, era) × (0.5 + strength / 100) per worker-month; breach merges the areas', () => {
    const s = walled();
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.raft, Discovery.stoneTools, Discovery.boat);
    g.era = 3;
    g.hunger = 100;
    updateWallTarget(s, g);
    const seg = s.wallSegments[g.wallTarget!.segmentId]!;
    wearWall(s, g, 50, 10);
    expect(seg.health).toBeCloseTo(100 - 10 * 0.05 * 3 * 1.0);
    const west = at(57, 40);
    const east = at(65, 40);
    expect(tilesConnected(s.regionId, s.regionParent, west, east)).toBe(false);
    seg.health = 0.01;
    wearWall(s, g, 50, 1);
    breachChecks(s);
    expect(seg.breached).toBe(true);
    expect(tilesConnected(s.regionId, s.regionParent, west, east)).toBe(true);
    for (const [x, y] of [[60, 39], [60, 40], [61, 41]]) expect(s.crossing[at(x!, y!)]).toBe(1);
    expect(s.log.at(-1)!.text).toBe('Shore breached the River wall');
    // The frontier now reaches across: the crossing is passable.
    expect(g.frontier.some((i) => i % 160 === 62 || s.crossing[i] === 1)).toBe(true);
    // Health never regenerates and the segment is not worked again.
    updateWallTarget(s, g);
    expect(g.wallTarget === null || g.wallTarget.segmentId !== seg.id).toBe(true);
  });
});
