import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Ground, Plant } from '../src/shared/ids';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { maxStock, regenPlants } from '../src/sim/world/plants';
import { at, fillRect, runOf } from './fixtures';

const YEAR = 12;

describe('plants (§10.2)', () => {
  it('maxStock follows type × density × rain factor', () => {
    const m = createMap();
    m.rain.fill(60);
    m.plantType[0] = Plant.Forest; m.plantDensity[0] = 255;
    m.plantType[1] = Plant.FruitBushes; m.plantDensity[1] = 255;
    m.plantType[2] = Plant.Grass; m.plantDensity[2] = 255;
    const s = createState(runOf(m));
    expect(maxStock(s, 0)).toBeCloseTo(1.5);
    expect(maxStock(s, 1)).toBeCloseTo(3.0);
    expect(maxStock(s, 2)).toBeCloseTo(0.4);
    // Starts full.
    expect(s.plantFood[0]).toBeCloseTo(1.5);
  });

  it('regrows 20% of the gap per month, scaled by season', () => {
    const m = createMap();
    m.rain.fill(60);
    m.plantType[0] = Plant.Forest; m.plantDensity[0] = 255;
    const s = createState(runOf(m));
    s.plantFood[0] = 0;
    regenPlants(s, 0); // spring 1.2
    expect(s.plantFood[0]).toBeCloseTo(0.2 * 1.5 * 1.2, 5);
    for (let k = 0; k < 200; k++) regenPlants(s, 1);
    expect(s.plantFood[0]).toBeCloseTo(1.5, 3);
  });

  it('forest at rain 0 is gone after 20 years (13 density per year)', () => {
    const m = createMap();
    m.rain.fill(0);
    fillRect(m, 10, 10, 20, 20, (i) => { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255; });
    const s = createState(runOf(m));
    runTicks(s, 19 * YEAR);
    expect(s.plantType[at(15, 15)]).toBe(Plant.Forest);
    expect(s.plantDensity[at(15, 15)]).toBe(8);
    runTicks(s, YEAR);
    expect(s.plantType[at(15, 15)]).toBe(Plant.None);
    expect(s.plantType.every((t) => t === Plant.None)).toBe(true);
  });

  it('forest at rain 70 spreads into the grassland next to it', () => {
    const m = createMap();
    m.rain.fill(70);
    fillRect(m, 70, 40, 79, 49, (i) => { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255; });
    const s = createState(runOf(m, 3));
    const count = (): number => s.plantType.filter((t) => t === Plant.Forest).length;
    expect(count()).toBe(100);
    runTicks(s, 40 * YEAR);
    expect(count()).toBeGreaterThan(160);
  });

  it('forest does not spread below rain 55, and only onto Grassland', () => {
    const m = createMap();
    m.rain.fill(50);
    fillRect(m, 70, 40, 79, 49, (i) => { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255; });
    const s = createState(runOf(m, 3));
    runTicks(s, 40 * YEAR);
    expect(s.plantType.filter((t) => t === Plant.Forest).length).toBe(100);
  });

  it('grass spreads onto bare ground, including desert', () => {
    const m = createMap();
    m.rain.fill(40);
    m.ground.fill(Ground.Desert);
    fillRect(m, 0, 0, 159, 89, () => {});
    fillRect(m, 10, 10, 14, 14, (i) => { m.ground[i] = Ground.Grassland; m.plantType[i] = Plant.Grass; m.plantDensity[i] = 255; });
    const s = createState(runOf(m, 9));
    runTicks(s, 10 * YEAR);
    expect(s.plantType.filter((t) => t === Plant.Grass).length).toBeGreaterThan(25);
  });

  it('densities move toward the rain/ground target', () => {
    const m = createMap();
    m.rain.fill(40);   // forest target: (40 − 25) / 25 = 0.6 → 153
    fillRect(m, 5, 5, 6, 6, (i) => { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 26; });
    const s = createState(runOf(m));
    runTicks(s, 30 * YEAR);
    expect(s.plantDensity[at(5, 5)]).toBe(153);
  });
});

describe('ground change (§10.3)', () => {
  it('Grassland at rain 5 becomes Desert after exactly 50 years', () => {
    const m = createMap();
    m.rain.fill(5);
    const s = createState(runOf(m));
    runTicks(s, 49 * YEAR);
    expect(s.ground[at(30, 30)]).toBe(Ground.Grassland);
    runTicks(s, YEAR);
    expect(s.ground[at(30, 30)]).toBe(Ground.Desert);
  });

  it('Desert at rain 35 becomes Grassland after 50 years; Water and Mountain never change', () => {
    const m = createMap();
    m.ground.fill(Ground.Desert);
    m.rain.fill(35);
    m.ground[at(1, 1)] = Ground.Water;
    m.ground[at(2, 2)] = Ground.Mountain;
    const s = createState(runOf(m));
    runTicks(s, 50 * YEAR);
    expect(s.ground[at(30, 30)]).toBe(Ground.Grassland);
    expect(s.ground[at(1, 1)]).toBe(Ground.Water);
    expect(s.ground[at(2, 2)]).toBe(Ground.Mountain);
  });

  it('a wet year resets the dry counter', () => {
    const m = createMap();
    m.rain.fill(5);
    const s = createState(runOf(m));
    runTicks(s, 40 * YEAR);
    s.baseRain.fill(50);
    runTicks(s, YEAR);
    s.baseRain.fill(5);
    runTicks(s, 40 * YEAR);
    expect(s.ground[at(30, 30)]).toBe(Ground.Grassland);
  });
});
