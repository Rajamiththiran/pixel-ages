// Built-in scenarios offered in the Maps tab: each builds a valid run, and the showcase world
// keeps its four peoples apart in three walled lands.

import { describe, expect, it } from 'vitest';
import { BUILTIN_SCENARIOS, fourRealms } from '../src/presets/builtins';
import { computeAreas } from '../src/sim/world/regions';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { population } from '../src/sim/people/groups';
import { hashState } from '../src/sim/serialize';
import { validateRun } from '../src/ui/validation';
import { decodeRun, encodeRun } from '../src/shared/save';

describe('built-in scenarios', () => {
  it('have unique ids and build runs that survive a save round trip', () => {
    expect(new Set(BUILTIN_SCENARIOS.map((b) => b.id)).size).toBe(BUILTIN_SCENARIOS.length);
    for (const b of BUILTIN_SCENARIOS) {
      const run = b.build();
      expect(run.founders.length).toBeGreaterThan(0);
      expect(encodeRun(decodeRun(encodeRun(run)))).toBe(encodeRun(run));
    }
  });

  it('Four Realms passes setup validation with no errors or warnings', () => {
    const run = fourRealms();
    const areas = computeAreas(run.map.wall, run.map.width, run.map.height);
    expect(validateRun(run.map, run.founders, run.events, areas.regionId)).toEqual({ errors: [], warnings: [] });
  });

  it('Four Realms: the two West peoples share an area; Riders and Highland each have their own', () => {
    const run = fourRealms();
    const { regionId } = computeAreas(run.map.wall, run.map.width, run.map.height);
    const area = (name: string): number => {
      const f = run.founders.find((g) => g.name === name)!;
      return regionId[f.y * run.map.width + f.x]!;
    };
    expect(area('Riverfolk')).toBe(area('Woodland'));
    expect(new Set([area('Riverfolk'), area('Riders'), area('Highland')]).size).toBe(3);
  });

  it('Four Realms: all four peoples are alive at year 50, deterministically', () => {
    const a = createState(fourRealms());
    const b = createState(fourRealms());
    runTicks(a, 50 * 12);
    runTicks(b, 50 * 12);
    expect(hashState(a)).toBe(hashState(b));
    for (const lineage of [1, 2, 3, 4]) {
      expect(a.groups.filter((g) => g.lineageId === lineage).reduce((n, g) => n + population(g), 0)).toBeGreaterThan(0);
    }
  });
});
