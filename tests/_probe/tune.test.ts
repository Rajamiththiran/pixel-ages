// Tuning harness (temporary): one seed of a scenario with config overrides, writes §26 metrics as JSON.
import { it } from 'vitest';
import { CONFIG } from '../../src/config';
import { createState } from '../../src/sim/state';
import { runTicks } from '../../src/sim/tick';
import { population } from '../../src/sim/people/groups';
import { scenarioA, scenarioB, scenarioC, scenarioD } from '../fixtures';

const env = (globalThis as any).process.env as Record<string, string | undefined>;
const fs = (globalThis as any).process.getBuiltinModule('fs');

/** Applies {"discoveries.baseChanceByEra": [...], ...} to CONFIG in place. */
function applyOverrides(o: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(o)) {
    const keys = path.split('.');
    let obj: any = CONFIG;
    for (const k of keys.slice(0, -1)) obj = obj[k];
    obj[keys.at(-1)!] = value;
  }
}

it('tune', () => {
  applyOverrides(JSON.parse(env.OVERRIDES ?? '{}'));
  const seed = Number(env.SEED ?? 1);
  const years = Number(env.YEARS ?? 2000);
  const scen = env.SCEN ?? 'A';
  const run = scen === 'B' ? scenarioB(seed) : scen === 'C' ? scenarioC(seed) : scen === 'D' ? scenarioD(seed) : scenarioA(seed);
  const s = createState(run);
  const marks = [100, 300, 500, 1000, 2000, 3000, 5000, 7500, 10000].filter((y) => y <= years);
  const at: Record<number, { pop: number; groups: number; villages: number; era: number }> = {};
  const eraFirst: Array<number | null> = [null, null, null, null, null, null, null];
  const t0 = Date.now();
  for (const y of marks) {
    while (s.year < y) {
      runTicks(s, 12);
      const era = Math.max(0, ...s.groups.map((g) => g.era));
      for (let e = 1; e <= era; e++) if (eraFirst[e] === null) eraFirst[e] = s.year;
      if (s.groups.length === 0) break;
    }
    at[y] = {
      pop: s.groups.reduce((n, g) => n + population(g), 0), groups: s.groups.length,
      villages: s.groups.filter((g) => g.village).length, era: Math.max(0, ...s.groups.map((g) => g.era)),
    };
    if (s.groups.length === 0) { for (const m of marks) if (m > y) at[m] = { pop: 0, groups: 0, villages: 0, era: 0 }; break; }
  }
  const disc = s.log.filter((e) => e.type === 'discovery');
  const result = {
    seed, scen, at, eraFirst,
    firstDiscovery: disc[0]?.year ?? null,
    farming: disc.find((e) => e.text.endsWith('discovered Farming'))?.year ?? null,
    forgotten: s.log.filter((e) => e.type === 'lostDiscovery').length,
    ms: Date.now() - t0,
  };
  fs.writeFileSync(env.OUT!, JSON.stringify(result));
}, 36000000);
