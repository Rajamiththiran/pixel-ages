import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Ground } from '../src/shared/ids';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { pickFamilies } from '../src/sim/people/movement';
import { fourPeople, runOf, scenarioA } from './fixtures';

describe('splitting and migration (§11.8)', () => {
  it('splits move whole families: couples together, children under 15 with a parent', () => {
    const run = scenarioA(2);
    run.founders[0]!.people = Array.from({ length: 20 }, (_, k) => ({ sex: (k % 2) as 0 | 1, age: 18 + (k * 7) % 13, intelligence: 100, cooperation: 50, strength: 50 }));
    const s = createState(run);
    runTicks(s, 25 * 12);
    const g = s.groups.reduce((a, b) => (b.members.length > a.members.length ? b : a));
    const p = s.persons;
    const moving = new Set(pickFamilies(s, g, Math.round(g.members.length * 0.4)));
    expect(moving.size).toBeGreaterThan(0);
    const inGroup = (id: number): number | undefined => {
      const slot = p.slotOf.get(id);
      return slot !== undefined && p.groupId[slot] === g.id ? slot : undefined;
    };
    for (const slot of g.members) {
      const partner = inGroup(p.partnerId[slot]!);
      if (partner !== undefined) expect(moving.has(partner)).toBe(moving.has(slot));
      if (p.ageMonths[slot]! < 180) {
        const parent = inGroup(p.motherId[slot]!) ?? inGroup(p.fatherId[slot]!);
        if (parent !== undefined) expect(moving.has(slot)).toBe(moving.has(parent));
      }
    }
  });

  it('a group placed in empty desert declines and dies out or moves away', () => {
    const m = createMap();
    m.ground.fill(Ground.Desert);
    m.rain.fill(5);
    const run = runOf(m, 3);
    run.founders = [{ id: 1, name: 'Lost', colorIndex: 0, x: 80, y: 45, people: fourPeople() }];
    const s = createState(run);
    runTicks(s, 40 * 12);
    const alive = s.groups.reduce((n, g) => n + g.members.length, 0);
    const moved = s.log.some((e) => e.type === 'migrate');
    expect(alive === 0 || moved).toBe(true);
  });
});
