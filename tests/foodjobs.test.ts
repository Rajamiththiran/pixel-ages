// Future blueprint F0: food jobs scored by expected food, camps moved off stripped land.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createMap } from '../src/editor/mapState';
import { Action, Plant, Species } from '../src/shared/ids';
import { Discovery, maskOf } from '../src/shared/discoveries';
import type { FounderPerson } from '../src/shared/types';
import { createState } from '../src/sim/state';
import { tick } from '../src/sim/tick';
import { expectedGather, expectedHunt, foodScore, type FoodOutlook } from '../src/sim/people/foodJobs';
import { homeRange } from '../src/sim/people/food';
import { revealAround } from '../src/sim/people/explore';
import { checkMigration } from '../src/sim/people/movement';
import { at, runOf } from './fixtures';

const bits = maskOf;
const adults = (n: number): FounderPerson[] =>
  Array.from({ length: n }, (_, k) => ({ sex: (k % 2) as 0 | 1, age: 25, intelligence: 100, cooperation: 50, strength: 50 }));

/** Forest with deer everywhere; one band at (50, 40). */
function forest(n = 12): ReturnType<typeof createState> {
  const m = createMap();
  m.rain.fill(60);
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  m.animals[Species.Prey].fill(153);
  const run = runOf(m, 3);
  run.founders = [{ id: 1, name: 'Deer', colorIndex: 0, x: 50, y: 40, people: adults(n) }];
  return createState(run);
}

describe('food jobs scored by expected food (F0 §6.1)', () => {
  it('the formula: a full gatherer at H = 0 scores 15, like v1; hunger raises it in proportion to the food', () => {
    const J = CONFIG.people.brain.food;
    expect(foodScore(J.gatherBase, 0, CONFIG.people.food.gatherCap)).toBe(15);
    expect(foodScore(J.gatherBase, 50, 1)).toBeCloseTo(5 + 60 * 0.5);
  });

  it('gatherers share what the range has left; hunters are capped by the prey the range can give', () => {
    const o: FoodOutlook = { plantFood: 3, prey: 30, bestPrey: 0.6, bestWildHerd: 0, fieldRain: 0, fish: 0, bestFish: 0 };
    const share = CONFIG.people.brain.food.preyMonthlyShare;
    expect(expectedGather(2, o, 0)).toBe(2);
    expect(expectedGather(2, o, 2)).toBeCloseTo(1);
    expect(expectedHunt(0.9, 1, o, 0)).toBeCloseTo(0.9 * CONFIG.people.food.huntYield * 0.6);
    expect(expectedHunt(0.9, 1, o, 99)).toBeCloseTo((30 * CONFIG.people.food.huntYield * share) / 100);
  });

  it('with the plants eaten and deer all around, hungry hunters with tools go hunting', () => {
    const s = forest();
    const g = s.groups[0]!;
    g.discoveries = bits(Discovery.stoneTools, Discovery.spear);
    for (const i of homeRange(s, g)) s.plantFood[i] = 0;
    g.fedHistory.fill(0.6);                      // hungry
    tick(s);
    const p = s.persons;
    const hunters = g.members.filter((slot) => p.action[slot] === Action.Hunt).length;
    // Plants regrow a little each month, so some keep gathering; at least a third hunt.
    expect(hunters).toBeGreaterThanOrEqual(g.members.length / 3);
  });
});

describe('moving camp off stripped land (F0 §6.2)', () => {
  it('a hungry band on an eaten-out range moves to known fresh land', () => {
    const s = forest(8);
    const g = s.groups[0]!;
    revealAround(s, g, 50, 40, 25);              // it knows the land around
    const home = homeRange(s, g);
    for (const i of home) s.plantFood[i] = 0;    // its own range is stripped
    for (const i of home) s.animal[Species.Prey][i] = 0;
    g.hunger = 80;
    g.plantAvail = 0.1;
    let moved = false;
    for (let m = 0; m < CONFIG.people.migrate.months && !moved; m++) moved = checkMigration(s, g);
    expect(moved).toBe(true);
    expect(home).not.toContain(at(g.homeX, g.homeY));
  });

  it('a band on fresh land does not move', () => {
    const s = forest(8);
    const g = s.groups[0]!;
    revealAround(s, g, 50, 40, 25);
    g.hunger = 80;
    g.plantAvail = 0.1;
    let moved = false;
    for (let m = 0; m < 6; m++) moved = checkMigration(s, g) || moved;
    expect(moved).toBe(false);
  });
});
