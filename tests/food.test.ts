import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Plant } from '../src/shared/ids';
import { createState } from '../src/sim/state';
import { distribute, hungerOf } from '../src/sim/people/food';
import { runOf } from './fixtures';

/** A band with a strong selfish adult, a weak generous adult and a child. */
function band(): ReturnType<typeof createState> {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  const run = runOf(m);
  run.founders = [{
    id: 1, name: 'Test', colorIndex: 0, x: 50, y: 50, people: [
      { sex: 0, age: 30, intelligence: 100, cooperation: 0, strength: 100 },
      { sex: 1, age: 30, intelligence: 100, cooperation: 100, strength: 0 },
      { sex: 1, age: 5, intelligence: 100, cooperation: 50, strength: 50 },
    ],
  }];
  return createState(run);
}

describe('food distribution (§11.5)', () => {
  it('enough food: everyone eats their need, the rest stays in store', () => {
    const s = band();
    const g = s.groups[0]!;
    g.foodStock = 5;
    distribute(s, g, 50, new Set());
    const [a, b, c] = g.members;
    expect([s.persons.fed[a!], s.persons.fed[b!], s.persons.fed[c!]]).toEqual([1, 1, 1]);
    expect(g.foodStock).toBeCloseTo(5 - (1 + 1 + 0.6));
  });

  it('shortage: shares by need × weight; selfish strong adults take more; nothing is wasted', () => {
    const s = band();
    const g = s.groups[0]!;
    const p = s.persons;
    g.foodStock = 1.3;
    distribute(s, g, 50, new Set());
    const [strong, generous, child] = g.members as [number, number, number];
    // Weights: strong 1 + 0.5 × 1 × 1 = 1.5; generous 1 + 0 = 1; child 0.5 + 50/100 = 1.0.
    const W = 1 * 1.5 + 1 * 1 + 0.6 * 1;
    expect(p.fed[strong]).toBeCloseTo((1.3 * 1.5) / W, 5);
    expect(p.fed[generous]).toBeCloseTo((1.3 * 1) / W, 5);
    expect(p.fed[child]).toBeCloseTo((1.3 * 0.6) / W / 0.6, 5);
    expect(p.fed[strong]!).toBeGreaterThan(p.fed[generous]!);
    expect(g.foodStock).toBeCloseTo(0, 6);
  });

  it('cooperative groups protect children', () => {
    const s = band();
    const g = s.groups[0]!;
    const p = s.persons;
    const child = g.members[2]!;
    g.foodStock = 1.3;
    distribute(s, g, 0, new Set());
    const childLowCoop = p.fed[child]!;
    g.foodStock = 1.3;
    distribute(s, g, 100, new Set());
    expect(p.fed[child]!).toBeGreaterThan(childLowCoop);
  });

  it('carers give part of their share away', () => {
    const s = band();
    const g = s.groups[0]!;
    const p = s.persons;
    const generous = g.members[1]!;
    g.foodStock = 1.3;
    distribute(s, g, 50, new Set());
    const before = p.fed[generous]!;
    g.foodStock = 1.3;
    distribute(s, g, 50, new Set([generous]));
    expect(p.fed[generous]!).toBeLessThan(before);
  });

  it('when a share covers someone fully, the rest is re-shared (no waste)', () => {
    const s = band();
    const g = s.groups[0]!;
    g.foodStock = 2.5; // just short of the 2.6 needed
    distribute(s, g, 50, new Set());
    expect(g.foodStock).toBeCloseTo(0, 6);
    expect(g.members.some((m) => s.persons.fed[m] === 1)).toBe(true);
  });

  it('hunger H: fully fed with no store = 30; a quarter short ≈ 80', () => {
    const s = band();
    const g = s.groups[0]!;
    g.need = 2.6;
    g.foodStock = 0;
    g.fedHistory.fill(1);
    expect(hungerOf(g)).toBeCloseTo(30);
    g.fedHistory.fill(0.75);
    expect(hungerOf(g)).toBeCloseTo(80);
  });
});
