// F9 — the preset run files in presets/ (future blueprint §17 F9, §22.2).
// The four v1 files (version 1, step 7) must still load and replay in v2; the v2 files must stay
// equal to the scenarios built in code. UPDATE_PRESETS=1 npm test rewrites the v2 files.

import { describe, expect, it } from 'vitest';
import { decodeRun, encodeRun } from '../src/shared/save';
import type { RunSetup } from '../src/shared/types';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { hashState } from '../src/sim/serialize';
import { computeAreas } from '../src/sim/world/regions';
import { validateRun } from '../src/ui/validation';
import { fourRealms } from '../src/presets/builtins';
import { scenarioA, scenarioB, scenarioC, scenarioD, scenarioE, scenarioF, scenarioG, scenarioH } from './fixtures';

const FILES = import.meta.glob('../presets/*.run.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const file = (name: string): string | undefined => FILES[`../presets/${name}`];

const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; getBuiltinModule?: (m: string) => { writeFileSync(p: string, d: string): void } } }).process;
const UPDATE = Boolean(proc?.env?.UPDATE_PRESETS);

const V1: Array<[string, () => RunSetup]> = [
  ['scenario-a-garden.run.json', () => scenarioA()],
  ['scenario-b-smart-desert-vs-rich-forest.run.json', () => scenarioB()],
  ['scenario-c-collapse.run.json', () => scenarioC()],
  ['scenario-d-performance.run.json', () => scenarioD()],
];

const V2: Array<[string, () => RunSetup]> = [
  ['scenario-e-fire-season.run.json', () => scenarioE()],
  ['scenario-f-floodplain-city.run.json', () => scenarioF()],
  ['scenario-g-overgrazed-steppe.run.json', () => scenarioG()],
  ['scenario-h-island-isolation.run.json', () => scenarioH()],
  ['four-realms.run.json', () => fourRealms()],
];

describe('v1 run files still run in v2', () => {
  for (const [name, build] of V1) {
    it(`${name}: loads as version 3 and replays exactly like the scenario built today`, () => {
      const text = file(name);
      expect(text, name).toBeDefined();
      expect(JSON.parse(text!).version).toBe(1);
      const run = decodeRun(text!);
      expect(run.version).toBe(3);
      const a = createState(run);
      const b = createState(build());
      runTicks(a, 30 * 12);
      runTicks(b, 30 * 12);
      expect(hashState(a)).toBe(hashState(b));
    });
  }
});

describe('v2 scenario files', () => {
  for (const [name, build] of V2) {
    it(`${name}: equal to the scenario in code${UPDATE ? ' (rewritten)' : ''}`, () => {
      const text = encodeRun(build());
      if (UPDATE) proc!.getBuiltinModule!('fs').writeFileSync(`presets/${name}`, text);
      else expect(file(name), `${name} is missing or stale: run UPDATE_PRESETS=1 npm test`).toBe(text);
    });
  }

  it('the new scenarios pass setup validation (the island\'s 6 founders only warn)', () => {
    for (const build of [scenarioE, scenarioF, scenarioG, scenarioH]) {
      const run = build(1);
      const areas = computeAreas(run.map.wall, run.map.width, run.map.height);
      const v = validateRun(run.map, run.founders, run.events, areas.regionId);
      expect(v.errors, run.name).toEqual([]);
      if (build !== scenarioH) expect(v.warnings, run.name).toEqual([]);
    }
  });
});
