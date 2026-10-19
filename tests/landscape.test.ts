// F4 — people change the landscape (future blueprint §10.9). Hand-checked numbers from the §10 rules.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createMap } from '../src/editor/mapState';
import { paintTile } from '../src/editor/brushes';
import { StrokeRecorder } from '../src/editor/undo';
import { Ground, Plant, Resource, WallType } from '../src/shared/ids';
import { Discovery, maskOf } from '../src/shared/discoveries';
import { Mark } from '../src/shared/protocol';
import { createState, type SimState } from '../src/sim/state';
import { cloneState, hashState } from '../src/sim/serialize';
import { runTicks } from '../src/sim/tick';
import { updateRainNow } from '../src/sim/world/climate';
import { capacity } from '../src/sim/world/animals';
import {
  addWear, burnTarget, burnTile, cellOf, computeMarks, leaveRuins, roadBetween, slopes, walk, yearlyLandscape,
} from '../src/sim/world/landscape';
import { Farmed } from '../src/sim/people/farming';
import { takeResource } from '../src/sim/progress/deposits';
import { removeGroups } from '../src/sim/people/groups';
import { homeRange } from '../src/sim/people/food';
import { at, fourPeople, runOf } from './fixtures';

const FU = CONFIG.future;

function world(edit?: (m: ReturnType<typeof createMap>) => void): SimState {
  const m = createMap();
  edit?.(m);
  const run = runOf(m);
  run.founders = [{ id: 1, name: 'Oak', colorIndex: 0, x: 50, y: 40, people: fourPeople() }];
  return createState(run);
}

const year = (s: SimState): void => yearlyLandscape(s, (g) => homeRange(s, g));

describe('elevation (D7)', () => {
  it('the Elevation brush paints height 0–9 from the strength', () => {
    const m = createMap();
    const rec = new StrokeRecorder(m);
    paintTile(m, rec, { kind: 'elevation' }, 5, 100);
    paintTile(m, rec, { kind: 'elevation' }, 6, 50);
    paintTile(m, rec, { kind: 'elevation' }, 7, 0);
    expect([m.elevation[5], m.elevation[6], m.elevation[7]]).toEqual([9, 5, 0]);
  });

  it('slope = largest height difference to a neighbour; mountains are at least slope 2', () => {
    const s = world((m) => {
      m.elevation[at(20, 20)] = 5;
      m.elevation[at(21, 20)] = 2;
      m.ground[at(40, 40)] = Ground.Mountain;
      m.wall[at(60, 60)] = WallType.Mountain;
    });
    const sl = slopes(s);
    expect(sl[at(20, 20)]).toBe(5);
    expect(sl[at(21, 20)]).toBe(3);                       // its neighbour (20, 20) is 3 higher
    expect(sl[at(22, 20)]).toBe(2);                       // next to the height-2 tile
    expect(sl[at(40, 40)]).toBe(FU.erosion.mountainSlope);
    expect(sl[at(61, 60)]).toBe(FU.erosion.mountainSlope); // next to a mountain range
    expect(sl[at(80, 80)]).toBe(0);
  });
});

describe('erosion and terraces (§10.3, §10.7)', () => {
  it('farmed slopes lose 0.03 × slope a year; terraced fields and flat land do not', () => {
    const s = world((m) => { for (let x = 10; x <= 14; x++) m.elevation[at(x, 10)] = x === 12 ? 3 : 0; });
    const a = at(12, 10), b = at(11, 10), flat = at(30, 30);
    for (const i of [a, b, flat]) { s.plantType[i] = Plant.Farmland; s.plantDensity[i] = 255; s.fertility[i] = 1; }
    s.farmedThisYear[b] = Farmed.Worked | Farmed.Terraced;
    year(s);
    expect(s.fertility[a]).toBeCloseTo(1 - 0.03 * 3, 6);
    expect(s.terrace[b]).toBe(1);
    expect(s.fertility[b]).toBe(1);
    expect(s.fertility[flat]).toBe(1);
  });
});

describe('overgrazing and desert (§10.2)', () => {
  it('grazing = herd per grazing tile / (5 × rain factor); above 1 a year strips 20 grass', () => {
    const s = world((m) => {
      m.plantType.fill(Plant.Grass);
      m.plantDensity.fill(100);
      m.rain.fill(30);                                     // rain factor 0.5: 2.5 animals a tile
    });
    updateRainNow(s);
    const g = s.groups[0]!;
    const tiles = homeRange(s, g).length;
    g.herd = tiles * 2;                                    // 2 a tile: below 2.5, no damage
    year(s);
    expect(s.plantDensity[at(50, 41)]).toBe(100);
    g.herd = tiles * 3;                                    // 3 a tile: 1.2 > 1
    year(s);
    expect(s.plantDensity[at(50, 41)]).toBe(80);
    expect(s.plantDensity[at(10, 10)]).toBe(100);           // out of range
  });

  it('grazed-bare dry land counts 3 years toward desert a year after 10 bare years', () => {
    const s = world((m) => { m.rain.fill(25); });
    updateRainNow(s);
    const i = at(20, 20);
    s.plantType[i] = Plant.None;
    s.bareYears[i] = 1;                                   // grazed bare
    for (let y = 0; y < 9; y++) year(s);
    expect(s.bareYears[i]).toBe(10);
    // From now on each year adds 3 to the desert counter: 50 / 3 → desert in 17 years.
    for (let y = 0; y < 16; y++) runTicks(s, 12);
    expect(s.ground[i]).toBe(Ground.Grassland);
    runTicks(s, 12);
    expect(s.ground[i]).toBe(Ground.Desert);
    // Ungrazed bare land at the same rain never turns to desert.
    expect(s.ground[at(30, 30)]).toBe(Ground.Grassland);
  });
});

describe('paths and roads (§10.6)', () => {
  it('walking wears the straight line; wear fades × 0.8 a year; path at 60, road at 160 with the Wheel', () => {
    const s = world();
    addWear(s, 10, 10, 13, 10, 70, false);
    expect([10, 11, 12, 13].map((x) => s.wear[at(x, 10)])).toEqual([70, 70, 70, 70]);
    year(s);
    expect(s.wear[at(11, 10)]).toBe(56);                  // 70 × 0.8
    addWear(s, 10, 10, 13, 10, 200, false);
    addWear(s, 20, 20, 20, 25, 200, true);
    const marks = computeMarks(s, new Uint8Array(s.wear.length));
    expect(marks[at(11, 10)]! & Mark.Path).toBe(Mark.Path);
    expect(marks[at(11, 10)]! & Mark.Road).toBe(0);         // nobody with the Wheel walked it
    expect(marks[at(20, 22)]! & Mark.Road).toBe(Mark.Road);
    expect(s.wear[at(11, 10)]).toBe(255);                  // capped
  });

  it('band workers wear the line from home to their work tile', () => {
    const s = world();
    const g = s.groups[0]!;
    walk(s, g, at(54, 40));
    expect([50, 51, 52, 53, 54].map((x) => s.wear[at(x, 40)])).toEqual([1, 1, 1, 1, 1]);
    walk(s, g, at(50, 40));                               // home: no walk
    expect(s.wear[at(50, 40)]).toBe(1);
  });

  it('groups joined by a road meet from 1.5× as far', () => {
    const s = world();
    const a = s.groups[0]!;
    const b = { ...a, homeX: 66, homeY: 40 } as typeof a;
    expect(roadBetween(s, a, b)).toBe(false);
    addWear(s, 50, 40, 66, 40, 200, true);
    expect(roadBetween(s, a, b)).toBe(true);
  });
});

describe('ruins, quarries, canals, burning (§10.4–10.8)', () => {
  it('an abandoned settlement leaves ruins that fade after 300 years', () => {
    const s = world();
    const g = s.groups[0]!;
    g.huts = 4;
    removeGroups(s, [g]);
    expect(s.ruinAge[at(50, 40)]).toBe(1);
    expect(s.ruinAge[at(51, 41)]).toBe(1);
    expect(s.ruinAge[at(52, 40)]).toBe(0);
    for (let y = 0; y < 298; y++) year(s);
    expect(s.ruinAge[at(50, 40)]).toBe(299);
    year(s);
    expect(s.ruinAge[at(50, 40)]).toBe(0);
  });

  it('a camp without buildings leaves nothing; a big village leaves a wider ruin', () => {
    const s = world();
    const g = s.groups[0]!;
    leaveRuins(s, g);
    expect(s.ruinAge.every((v) => v === 0)).toBe(true);
    g.houses = 20;
    leaveRuins(s, g);
    expect(s.ruinAge[at(52, 42)]).toBe(1);
  });

  it('a used-up deposit leaves a pit', () => {
    const tile = at(51, 40);
    const s = world((m) => { m.resourceType[tile] = Resource.Clay; m.resourceAmount[tile] = 3; });
    expect(takeResource(s, s.groups[0]!, Resource.Clay, 3)).toBe(true);
    expect(s.quarry[tile]).toBe(1);
    expect(computeMarks(s, new Uint8Array(s.wear.length))[tile]! & Mark.Quarry).toBe(Mark.Quarry);
  });

  it('irrigated fields get a canal to their water; canals follow this year\'s irrigation', () => {
    const s = world((m) => { m.ground[at(23, 20)] = Ground.Water; });
    const field = at(21, 20);
    s.farmedThisYear[field] = Farmed.Worked | Farmed.Irrigated;
    year(s);
    expect([s.canal[at(21, 20)], s.canal[at(22, 20)], s.canal[at(23, 20)]]).toEqual([1, 1, 0]);
    s.farmedThisYear.fill(0);
    year(s);
    expect(s.canal[at(22, 20)]).toBe(0);
  });

  it('burning turns the nearest forest edge into grass on ash: double grass growth, more grazers', () => {
    const s = world((m) => {
      for (let x = 53; x <= 60; x++) for (let y = 30; y <= 50; y++) { m.plantType[at(x, y)] = Plant.Forest; m.plantDensity[at(x, y)] = 255; }
    });
    const g = s.groups[0]!;
    g.discoveries = maskOf(Discovery.fire, Discovery.fireSafety);
    const t = burnTarget(s, g, homeRange(s, g));
    expect(t).toBe(at(53, 40));                            // the edge nearest home
    const before = capacity(s, 2, t);                       // herd animals
    burnTile(s, t);
    expect(s.plantType[t]).toBe(Plant.Grass);
    expect(s.ash[t]).toBe(FU.burn.ashYears);
    expect(capacity(s, 2, t)).toBeGreaterThan(before * 4);  // forest 0.2 → grass 1.0, × 1.2 on ash
  });
});

describe('local drying (§10.1)', () => {
  it('a cell that had ≥20% forest and lost it gets rain × 0.9; never-forested cells do not', () => {
    const s = world((m) => {
      // Forest over the whole top-left climate cell (0–19 × 0–17).
      for (let y = 0; y < 18; y++) for (let x = 0; x < 20; x++) { m.plantType[at(x, y)] = Plant.Forest; m.plantDensity[at(x, y)] = 255; }
    });
    const c = cellOf(5, 5, s.width, s.height);
    year(s);
    expect(s.dryCells[c]).toBe(0);
    for (let y = 0; y < 18; y++) for (let x = 0; x < 20; x++) { s.plantType[at(x, y)] = Plant.None; s.plantDensity[at(x, y)] = 0; }
    year(s);
    expect(s.dryCells[c]).toBe(1);
    expect(s.dryCells[cellOf(100, 50, s.width, s.height)]).toBe(0);
    updateRainNow(s);
    expect(s.rainNow[at(5, 5)]).toBe(45);                   // 50 × 0.9
    expect(s.rainNow[at(100, 50)]).toBe(50);
  });
});

describe('state (§5.6)', () => {
  it('keyframes and the hash cover wear, roads, ruins, pits, canals, terraces, ash and drying', () => {
    const s = world();
    expect(hashState(cloneState(s))).toBe(hashState(s));
    for (const k of ['wear', 'roadOK', 'ruinAge', 'quarry', 'canal', 'terrace', 'ash', 'bareYears', 'dryCells'] as const) {
      const c = cloneState(s);
      c[k][3] = 1;
      expect(s[k][3]).toBe(0);
      expect(hashState(c)).not.toBe(hashState(s));
    }
  });
});
