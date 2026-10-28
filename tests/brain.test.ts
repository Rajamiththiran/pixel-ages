// Item 2a — jobs last a season: a job's score counts × (1 + stickBonus) in its first stickMonths.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createState, type SimState } from '../src/sim/state';
import { tick } from '../src/sim/tick';
import { Action } from '../src/shared/ids';
import { scenarioA } from './fixtures';

/** Job switches per adult-month over `months`, and whether jobMonths tracked each run of a job. */
function switches(s: SimState, months: number): { rate: number; counterOk: boolean } {
  const p = s.persons;
  let changes = 0, adultMonths = 0, counterOk = true;
  for (let m = 0; m < months; m++) {
    const before = new Map<number, number>();
    const runBefore = new Map<number, number>();
    for (const g of s.groups) for (const slot of g.members) { before.set(slot, p.action[slot]!); runBefore.set(slot, p.jobMonths[slot]!); }
    tick(s);
    for (const g of s.groups) {
      for (const slot of g.members) {
        const was = before.get(slot);
        if (was === undefined || was === Action.Child || p.action[slot] === Action.Child) continue;
        adultMonths++;
        const same = was === p.action[slot];
        if (!same) changes++;
        const want = same ? Math.min(255, runBefore.get(slot)! + 1) : 1;
        if (p.jobMonths[slot] !== want) counterOk = false;
      }
    }
  }
  return { rate: changes / Math.max(1, adultMonths), counterOk };
}

describe('jobs last a season (item 2a)', () => {
  it('people switch jobs less often, and jobMonths counts months on the job', () => {
    const B = CONFIG.people.brain;
    const bonus = B.stickBonus;
    const sticky = switches(createState(scenarioA(3)), 60);
    (B as { stickBonus: number }).stickBonus = 0;
    const free = switches(createState(scenarioA(3)), 60);
    (B as { stickBonus: number }).stickBonus = bonus;
    expect(sticky.counterOk).toBe(true);
    expect(free.counterOk).toBe(true);
    expect(sticky.rate).toBeLessThan(free.rate * 0.8);
  });
});
