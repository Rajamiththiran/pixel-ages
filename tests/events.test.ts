import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Plant, Species, WallType } from '../src/shared/ids';
import { Discovery, maskOf } from '../src/shared/discoveries';
import type { FounderPerson, PlannedEvent } from '../src/shared/types';
import { decodeRun, encodeRun } from '../src/shared/save';
import { createState } from '../src/sim/state';
import { runTicks, tick } from '../src/sim/tick';
import { cloneState, hashState } from '../src/sim/serialize';
import { tilesConnected } from '../src/sim/world/regions';
import { eventDeathMult, harshWinterNow, validateEvent } from '../src/sim/events';
import { toVillage } from '../src/sim/people/village';
import { validateRun } from '../src/ui/validation';
import { at, fourPeople, runOf, scenarioC } from './fixtures';

const W = { x: 30, y: 40 };   // a tile in the west area
const E = { x: 120, y: 40 };  // a tile in the east area

/** Rain 60 everywhere, a river wall at x = 80 splitting west from east, forest and prey everywhere. */
function split(events: PlannedEvent[], founders = false): ReturnType<typeof createState> {
  const m = createMap();
  m.rain.fill(60);
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  m.animals[Species.Prey].fill(128);
  for (let y = 0; y < 90; y++) { m.wall[at(80, y)] = WallType.River; m.wall[at(81, y)] = WallType.River; }
  const run = runOf(m);
  run.events = events;
  if (founders) run.founders = [{ id: 1, name: 'West', colorIndex: 0, x: 30, y: 40, people: fourPeople() }];
  return createState(run);
}

const rainAt = (s: ReturnType<typeof createState>, p: { x: number; y: number }): number => s.rainNow[at(p.x, p.y)]!;

describe('planned events (§15)', () => {
  it('a drought lowers rain only in its area, at half strength in its first and last year', () => {
    const s = split([{ kind: 'drought', at: W, startYear: 1, lengthYears: 3, strength: 50 }]);
    runTicks(s, 12);                     // year 0: nothing yet
    expect([rainAt(s, W), rainAt(s, E)]).toEqual([60, 60]);
    tick(s);                             // year 1 (first year): × 0.75
    expect([rainAt(s, W), rainAt(s, E)]).toEqual([45, 60]);
    runTicks(s, 12);                     // year 2: full strength × 0.5
    expect(rainAt(s, W)).toBe(30);
    runTicks(s, 12);                     // year 3 (last year): × 0.75
    expect(rainAt(s, W)).toBe(45);
    runTicks(s, 12);                     // year 4: over
    expect(rainAt(s, W)).toBe(60);
    expect(s.log.filter((e) => e.type === 'event').map((e) => [e.year, e.text])).toEqual([
      [1, 'Planned event: Drought in Area 1 (strength 50) began'],
      [4, 'Planned event: Drought in Area 1 (strength 50) ended'],
    ]);
  });

  it('a wet period raises rain in its area', () => {
    const s = split([{ kind: 'wetPeriod', at: E, startYear: 0, lengthYears: 5, strength: 40 }]);
    runTicks(s, 2 * 12 + 1);             // year 2: full strength
    expect([rainAt(s, W), rainAt(s, E)]).toEqual([60, 84]);
  });

  it('a plague raises deaths, most in big villages that keep animals; not outside its area', () => {
    const s = split([{ kind: 'plague', at: W, startYear: 0, strength: 80 }], true);
    tick(s);
    const g = s.groups[0]!;
    // Band of 4, no Taming: 1 + (80/50) × clamp(4/150 → 0.2) = 1.32
    expect(eventDeathMult(s, g)).toBeCloseTo(1 + 1.6 * 0.2);
    g.discoveries = maskOf(Discovery.taming);
    expect(eventDeathMult(s, g)).toBeCloseTo(1 + 1.6 * 0.2 * 1.5);
    // The same group as a village of 400 with Taming: 1 + 1.6 × 2 × 1.5 = 5.8
    for (let k = 0; k < 396; k++) g.members.push(g.members[k % 4]!);
    toVillage(s, g);
    expect(eventDeathMult(s, g)).toBeCloseTo(5.8);
    // Moved to the east: no plague there.
    g.homeX = E.x;
    expect(eventDeathMult(s, g)).toBe(1);
    // The plague lasts 2 + round(3 × 80 / 100) = 4 years.
    runTicks(s, 4 * 12);
    expect(s.activeEvents).toEqual([]);
    expect(s.log.filter((e) => e.type === 'event').map((e) => e.year)).toEqual([0, 4]);
  });

  it('an animal die-off cuts that species to 20% in its area at the start of the year', () => {
    const s = split([{ kind: 'animalDieOff', at: W, year: 2, species: Species.Prey }]);
    runTicks(s, 2 * 12);                 // to the end of year 1
    const before = [s.animal[Species.Prey][at(W.x, W.y)]!, s.animal[Species.Prey][at(E.x, E.y)]!];
    tick(s);                             // year 2, month 0: × 0.2, then a month of growth
    expect(s.animal[Species.Prey][at(W.x, W.y)]!).toBeLessThan(before[0]! * 0.25);
    expect(s.animal[Species.Prey][at(E.x, E.y)]!).toBeGreaterThan(before[1]! * 0.9);
  });

  it('an earthquake breaks the wall at its point: the areas connect', () => {
    const s = split([{ kind: 'earthquake', at: { x: 80, y: 40 }, year: 1 }]);
    runTicks(s, 12);
    expect(tilesConnected(s.regionId, s.regionParent, at(W.x, W.y), at(E.x, E.y))).toBe(false);
    tick(s);
    expect(s.crossing[at(80, 40)]).toBe(1);
    expect(s.crossing[at(81, 41)]).toBe(1);
    expect(tilesConnected(s.regionId, s.regionParent, at(W.x, W.y), at(E.x, E.y))).toBe(true);
    expect(s.log.at(-1)!.text).toBe('Planned event: an earthquake broke the River wall at (80, 40)');
  });

  it('harsh winters: only in winter months; deaths × 1.5 without Fire, × 1.2 without Clothing', () => {
    const s = split([{ kind: 'harshWinters', startYear: 0, lengthYears: 2 }], true);
    tick(s);                             // month 0 → events start
    const g = s.groups[0]!;
    s.month = 4;
    expect(harshWinterNow(s)).toBe(false);
    expect(eventDeathMult(s, g)).toBe(1);
    s.month = 10;
    expect(harshWinterNow(s)).toBe(true);
    expect(eventDeathMult(s, g)).toBeCloseTo(1.5 * 1.2);
    g.discoveries = maskOf(Discovery.fire, Discovery.clothing);
    expect(eventDeathMult(s, g)).toBe(1);
  });

  it('events replay deterministically, and a keyframe in the middle of a drought replays exactly', () => {
    const a = createState(scenarioC(2));
    const b = createState(scenarioC(2));
    a.setup.events.push({ kind: 'drought', at: { x: 76, y: 45 }, startYear: 20, lengthYears: 30, strength: 60 });
    b.setup.events.push({ kind: 'drought', at: { x: 76, y: 45 }, startYear: 20, lengthYears: 30, strength: 60 });
    runTicks(a, 60 * 12);
    runTicks(b, 30 * 12);
    const kf = cloneState(b);
    runTicks(b, 30 * 12);
    runTicks(kf, 30 * 12);
    expect(hashState(b)).toBe(hashState(a));
    expect(hashState(kf)).toBe(hashState(a));
  });

  it('a saved run, loaded and run again, gives the identical history', () => {
    const run = scenarioC(3);
    run.events.push({ kind: 'harshWinters', startYear: 5, lengthYears: 10 }, { kind: 'animalDieOff', at: { x: 76, y: 45 }, year: 8, species: Species.Prey });
    const loaded = decodeRun(encodeRun(run));
    const a = createState(run);
    const b = createState(loaded);
    runTicks(a, 40 * 12);
    runTicks(b, 40 * 12);
    expect(hashState(b)).toBe(hashState(a));
    expect(b.log.map((e) => e.text)).toEqual(a.log.map((e) => e.text));
  });
});

describe('validation (§15, §20.6)', () => {
  const s = split([]);
  const map = { width: s.width, height: s.height, wall: s.wall };

  it('event checks: years 0–10,000, strength 1–100, a wall tile for earthquakes, an area for the rest', () => {
    expect(validateEvent({ kind: 'drought', at: W, startYear: 10, lengthYears: 5, strength: 50 }, map, s.regionId)).toEqual([]);
    expect(validateEvent({ kind: 'drought', at: W, startYear: 10001, lengthYears: 5, strength: 50 }, map, s.regionId)).toHaveLength(1);
    expect(validateEvent({ kind: 'plague', at: W, startYear: 10, strength: 0 }, map, s.regionId)).toHaveLength(1);
    expect(validateEvent({ kind: 'earthquake', at: W, year: 10 }, map, s.regionId)).toHaveLength(1);
    expect(validateEvent({ kind: 'earthquake', at: { x: 80, y: 10 }, year: 10 }, map, s.regionId)).toEqual([]);
    expect(validateEvent({ kind: 'animalDieOff', at: { x: 80, y: 10 }, year: 3, species: 0 }, map, s.regionId)).toHaveLength(1);
    expect(validateEvent({ kind: 'harshWinters', startYear: 0, lengthYears: 0 }, map, s.regionId)).toHaveLength(1);
  });

  it('run checks: errors stop the run, warnings only warn', () => {
    const m = createMap();
    expect(validateRun(m, [], [], new Int32Array(m.width * m.height)).errors).toHaveLength(1);
    const people: FounderPerson[] = fourPeople();
    const v = validateRun(m, [
      { id: 1, name: 'A', colorIndex: 0, x: 10, y: 10, people },
      { id: 2, name: 'B', colorIndex: 1, x: 15, y: 10, people: people.filter((p) => p.sex === 0) },
    ], [], new Int32Array(m.width * m.height));
    expect(v.errors).toEqual([]);
    expect(v.warnings.some((w) => w.includes("B can't have children"))).toBe(true);
    expect(v.warnings.some((w) => w.includes('may starve'))).toBe(true);        // an empty map
    expect(v.warnings.some((w) => w.includes("they'll meet immediately"))).toBe(true);
    m.wall[at(10, 10)] = WallType.River;
    expect(validateRun(m, [{ id: 1, name: 'A', colorIndex: 0, x: 10, y: 10, people }], [], new Int32Array(m.width * m.height)).errors).toHaveLength(1);
  });
});
