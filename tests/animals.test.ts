import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Ground, Plant, Species, WallType } from '../src/shared/ids';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { capacity } from '../src/sim/world/animals';
import { at, fillRect, runOf } from './fixtures';

const YEAR = 12;

describe('animal capacity (§10.4)', () => {
  it('K = suitability × clamp(0.3 + rain/100, 0.3, 1)', () => {
    const m = createMap();
    m.rain.fill(50);
    m.ground[at(1, 0)] = Ground.Desert;
    m.ground[at(2, 0)] = Ground.Water;
    m.ground[at(3, 0)] = Ground.Mountain;
    m.plantType[at(4, 0)] = Plant.Forest; m.plantDensity[at(4, 0)] = 200;
    m.plantType[at(5, 0)] = Plant.Forest; m.plantDensity[at(5, 0)] = 100; // too thin to count as forest
    m.wall[at(6, 0)] = WallType.River;
    m.rain[at(7, 0)] = 95;
    m.rain[at(8, 0)] = 0;
    const s = createState(runOf(m));
    const k = (sp: number, x: number): number => capacity(s, sp, at(x, 0));
    expect(k(Species.Prey, 0)).toBeCloseTo(0.8 * 0.8);
    expect(k(Species.Prey, 1)).toBeCloseTo(0.1 * 0.8);
    expect(k(Species.Prey, 2)).toBe(0);
    expect(k(Species.Prey, 3)).toBeCloseTo(0.3 * 0.8);
    expect(k(Species.Prey, 4)).toBeCloseTo(1.0 * 0.8);
    expect(k(Species.Prey, 5)).toBeCloseTo(0.8 * 0.8);
    expect(k(Species.Herd, 4)).toBeCloseTo(0.2 * 0.8);
    expect(k(Species.Riding, 1)).toBeCloseTo(0.2 * 0.8);
    expect(k(Species.Prey, 6)).toBe(0);
    expect(k(Species.Prey, 7)).toBeCloseTo(0.8 * 1.0);
    expect(k(Species.Prey, 8)).toBeCloseTo(0.8 * 0.3);
    expect(k(Species.Predator, 0)).toBe(0); // predators have no habitat K
  });
});

describe('animal dynamics (§10.4)', () => {
  it('prey alone settles near capacity', () => {
    const m = createMap();
    m.rain.fill(50);
    m.animals[Species.Prey].fill(25);
    const s = createState(runOf(m));
    runTicks(s, 100 * YEAR);
    const d = s.animal[Species.Prey][at(80, 45)]!;
    expect(d).toBeGreaterThan(0.62);
    expect(d).toBeLessThan(0.66);
  });

  it('predators and prey rise and fall, and both survive', () => {
    const m = createMap();
    m.rain.fill(60);
    m.animals[Species.Prey].fill(130);
    m.animals[Species.Predator].fill(13);
    const s = createState(runOf(m));
    const prey: number[] = [];
    const pred: number[] = [];
    for (let y = 0; y < 300; y++) {
      runTicks(s, YEAR);
      prey.push(s.animal[Species.Prey][at(80, 45)]!);
      pred.push(s.animal[Species.Predator][at(80, 45)]!);
    }
    // Both swing by a clear amount (a cycle), and neither dies out.
    expect(Math.max(...prey) - Math.min(...prey)).toBeGreaterThan(0.1);
    expect(Math.max(...pred) - Math.min(...pred)).toBeGreaterThan(0.02);
    // Predators first grow on the plentiful prey, then prey drop below where they started.
    expect(Math.max(...pred)).toBeGreaterThan(13 / 255);
    expect(Math.min(...prey)).toBeLessThan(130 / 255);
    expect(pred[pred.length - 1]).toBeGreaterThan(0);
    expect(prey[prey.length - 1]).toBeGreaterThan(0);
  });

  it('animals never diffuse across Water or an intact wall', () => {
    const m = createMap();
    m.rain.fill(50);
    fillRect(m, 60, 0, 60, 89, (i) => { m.ground[i] = Ground.Water; });
    fillRect(m, 100, 0, 100, 89, (i) => { m.wall[i] = WallType.Mountain; });
    fillRect(m, 0, 0, 59, 89, (i) => { m.animals[Species.Prey][i] = 200; });
    fillRect(m, 61, 0, 99, 89, (i) => { m.animals[Species.Herd][i] = 200; });
    const s = createState(runOf(m));
    runTicks(s, 50 * YEAR);
    let preyEast = 0, herdOutside = 0;
    for (let y = 0; y < 90; y++) {
      for (let x = 61; x < 160; x++) preyEast += s.animal[Species.Prey][at(x, y)]!;
      for (let x = 0; x < 60; x++) herdOutside += s.animal[Species.Herd][at(x, y)]!;
      for (let x = 101; x < 160; x++) herdOutside += s.animal[Species.Herd][at(x, y)]!;
    }
    expect(preyEast).toBe(0);
    expect(herdOutside).toBe(0);
  });

  it('animals spread into empty habitat next to them (about 0.4 tiles per year)', () => {
    const m = createMap();
    m.rain.fill(50);
    fillRect(m, 0, 0, 9, 89, (i) => { m.animals[Species.Prey][i] = 200; });
    const s = createState(runOf(m));
    runTicks(s, 40 * YEAR);
    // Fisher wave speed 2√(growth × diffusion/4) ≈ 0.03 tiles/month: the front moves ~15 tiles in 40 years.
    expect(s.animal[Species.Prey][at(15, 45)]!).toBeGreaterThan(0.05);
    expect(s.animal[Species.Prey][at(40, 45)]!).toBeLessThan(0.05);
  });

  it('densities always stay within 0..1', () => {
    const m = createMap();
    m.rain.fill(100);
    m.animals[Species.Prey].fill(255);
    m.animals[Species.Predator].fill(255);
    m.animals[Species.Herd].fill(255);
    const s = createState(runOf(m));
    runTicks(s, 20 * YEAR);
    for (let sp = 0; sp < 4; sp++) {
      for (const d of s.animal[sp]!) expect(d >= 0 && d <= 1).toBe(true);
    }
  });
});
