// G1 towns probe (not a test): runs one scenario for the given seeds and appends one JSON line per
// seed and checkpoint to OUT. Env: SCEN (A–H or M), SEEDS ("1-6"), YEARS, OVR (config overrides,
// leaf keys). Runs only when SCEN is set, so npm test skips it.

import { it } from 'vitest';
import { CONFIG } from '../../src/config';
import { createState } from '../../src/sim/state';
import { runTicks } from '../../src/sim/tick';
import { population } from '../../src/sim/people/groups';
import * as S from '../../src/presets/scenarios';
import type { RunSetup } from '../../src/shared/types';
import { miniGarden } from './mini';

const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; getBuiltinModule?: (m: string) => { appendFileSync(p: string, d: string): void } } }).process;
const env = proc?.env ?? {};
const SCEN = env.SCEN ?? '';
const YEARS = Number(env.YEARS ?? 1500);
const STEP = Number(env.STEP ?? 500);
const seeds = (env.SEEDS ?? '1').split(',').flatMap((p) => {
  const [a, b] = p.split('-').map(Number);
  return b === undefined ? [a!] : Array.from({ length: b - a! + 1 }, (_, k) => a! + k);
});
for (const [path, value] of Object.entries(JSON.parse(env.OVR || '{}') as Record<string, unknown>)) {
  const keys = path.split('.');
  let o = CONFIG as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
}
const build = (seed: number): RunSetup =>
  (SCEN === 'M' ? miniGarden(seed) : (S as unknown as Record<string, (s: number) => RunSetup>)[`scenario${SCEN}`]!(seed));

it.skipIf(!SCEN)('towns probe', () => {
  const fs = proc!.getBuiltinModule!('node:fs');
  for (const seed of seeds) {
    const s = createState(build(seed));
    const eraYear: Record<number, number> = {};
    const count: Record<string, number> = {};
    let seen = 0;
    while (s.year < YEARS && s.groups.length > 0) {
      runTicks(s, STEP * 12);
      const total = s.logDropped + s.log.length;
      for (let k = Math.max(seen, s.logDropped); k < total; k++) {
        const e = s.log[k - s.logDropped]!;
        const key = e.type === 'war' ? (e.minor ? 'battle' : /^War broke out/.test(e.text) ? 'warStart' : 'warOther')
          : e.type === 'town' ? (/market/.test(e.text) ? 'marketOpened' : /city/.test(e.text) ? 'city' : 'townLine') : e.type;
        count[key] = (count[key] ?? 0) + 1;
        if (e.type === 'eraUp') { const m = /era (\d)/.exec(e.text); if (m && eraYear[Number(m[1])] === undefined) eraYear[Number(m[1])] = e.year; }
      }
      seen = total;
      const pops = s.groups.map((g) => population(g)).sort((a, b) => b - a);
      fs.appendFileSync(env.OUT ?? 'towns.jsonl', JSON.stringify({
        scen: SCEN, seed, year: s.year, groups: s.groups.length, people: pops.reduce((a, b) => a + b, 0),
        largest: pops[0] ?? 0, top5: pops.slice(0, 5), markets: s.groups.filter((g) => g.market).length,
        towns: s.groups.filter((g) => g.sizeClass === 2).length, cities: s.groups.filter((g) => g.sizeClass === 3).length,
        sellers: s.groups.filter((g) => g.marketId >= 0).length, bestEra: Math.max(0, ...s.groups.map((g) => g.era)),
        // Market towns: people, and the share of a year's need that came in from outside.
        marketSupply: s.groups.filter((g) => g.market).map((g) => [population(g), +(g.imports / Math.max(1, g.need * 12)).toFixed(2)]),
        eraYear, count: { ...count },
      }) + '\n');
    }
  }
}, 24 * 3600 * 1000);
