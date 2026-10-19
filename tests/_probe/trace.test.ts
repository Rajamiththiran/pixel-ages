// F9 diagnosis probe (not a test): yearly trace of one band. Env TRACE=seed, YEARS, SCEN (default A), OVR.
import { it } from 'vitest';
import { CONFIG } from '../../src/config';
import { createState } from '../../src/sim/state';
import { runTicks } from '../../src/sim/tick';
import { ACTION_NAMES } from '../../src/shared/ids';
import { DISCOVERIES, has } from '../../src/shared/discoveries';
import * as S from '../../src/presets/scenarios';
import type { RunSetup } from '../../src/shared/types';

const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; getBuiltinModule?: (m: string) => { writeFileSync(p: string, d: string): void } } }).process;
const env = proc?.env ?? {};
const SEED = env.TRACE;
for (const [path, value] of Object.entries(JSON.parse(env.OVR || '{}') as Record<string, unknown>)) {
  const keys = path.split('.');
  let o = CONFIG as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
}

it.skipIf(!SEED)('trace', () => {
  const build = (S as unknown as Record<string, (s: number) => RunSetup>)[`scenario${env.SCEN ?? 'A'}`]!;
  const s = createState(build(Number(SEED)));
  const out: string[] = [];
  let seen = 0;
  for (let y = 0; y < Number(env.YEARS ?? 120) && s.groups.length > 0; y++) {
    const acts: Record<string, number> = {};
    let hunger = 0, fed = 0, months = 0;
    for (let m = 0; m < 12; m++) {
      runTicks(s, 1);
      for (const g of s.groups) {
        hunger += g.hunger; months++;
        for (const slot of g.members) { const a = ACTION_NAMES[s.persons.action[slot]!]!; acts[a] = (acts[a] ?? 0) + 1; fed += s.persons.fed[slot]!; }
      }
    }
    const p = s.persons;
    const people = s.groups.flatMap((g) => g.members.map((slot) => `${p.sex[slot] ? 'F' : 'M'}${Math.floor(p.ageMonths[slot]! / 12)}${p.partnerId[slot]! >= 0 ? '*' : ''}`));
    const n = Object.values(acts).reduce((a, b) => a + b, 0) || 1;
    const g = s.groups[0];
    const disc = g ? DISCOVERIES.filter((d) => has(g.discoveries, d.id)).map((d) => d.name).join(',') : '';
    const logs = s.log.slice(seen - s.logDropped).filter((e) => e.type !== 'perf').map((e) => `${e.type}:${e.text}`);
    seen = s.logDropped + s.log.length;
    out.push(`y${s.year} n=${people.length} H=${(hunger / Math.max(1, months)).toFixed(0)} fed=${(fed / n).toFixed(2)} stock=${g ? g.foodStock.toFixed(0) : '-'} wood=${g ? g.wood.toFixed(0) : '-'} [${people.join(' ')}] ${Object.entries(acts).map(([k, v]) => `${k}${Math.round((100 * v) / n)}`).join(' ')} {${disc}} ${logs.join(' | ')}`);
  }
  proc!.getBuiltinModule!('fs').writeFileSync(env.TRACEOUT ?? 'trace.txt', out.join('\n') + '\n');
}, 3600000);
