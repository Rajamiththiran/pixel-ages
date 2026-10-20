// Pace probe (not a test): what each group owns, has found and practises at the end of a run.
// Env STATE=seed, SCEN (default A), YEARS, OVR, STATEOUT.
import { it } from 'vitest';
import { CONFIG } from '../../src/config';
import { createState } from '../../src/sim/state';
import { runTicks } from '../../src/sim/tick';
import { DISCOVERIES, has } from '../../src/shared/discoveries';
import { PRACTICE_NAMES } from '../../src/shared/ids';
import { canDiscover, foundMask } from '../../src/sim/progress/discoveryRules';
import { population } from '../../src/sim/people/groups';
import * as S from '../../src/presets/scenarios';
import type { RunSetup } from '../../src/shared/types';

const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; getBuiltinModule?: (m: string) => { writeFileSync(p: string, d: string): void } } }).process;
const env = proc?.env ?? {};
for (const [path, value] of Object.entries(JSON.parse(env.OVR || '{}') as Record<string, unknown>)) {
  const keys = path.split('.');
  let o = CONFIG as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
}

it.skipIf(!env.STATE)('state', () => {
  const build = (S as unknown as Record<string, (s: number) => RunSetup>)[`scenario${env.SCEN ?? 'A'}`]!;
  const s = createState(build(Number(env.STATE)));
  runTicks(s, Number(env.YEARS ?? 1000) * 12);
  const out: string[] = [];
  for (const g of s.groups) {
    const pop = population(g);
    const found = foundMask(s, g);
    const owned = DISCOVERIES.filter((d) => has(g.discoveries, d.id)).map((d) => `${d.name}${has(g.inactive, d.id) ? '(off)' : ''}`);
    const missing = DISCOVERIES.filter((d) => !has(g.discoveries, d.id) && d.era >= 4).map((d) => {
      const why: string[] = [];
      if (!d.needs.every((n) => has(g.discoveries, n))) why.push('needs ' + d.needs.filter((n) => !has(g.discoveries, n)).map((n) => DISCOVERIES[n]!.name).join('+'));
      if ((found & d.needsFound) !== d.needsFound) why.push('not found');
      if (pop < d.minPopulation) why.push('pop');
      if (d.practice >= 0 && g.idleYears[d.practice]! >= CONFIG.future.diffusion.unusedForgetYears) why.push(`idle ${PRACTICE_NAMES[d.practice]}`);
      return `${d.name}[e${d.era}${canDiscover(g, d, found, pop) ? ' OK' : ': ' + why.join(', ')}]`;
    });
    out.push(`${g.name} pop ${pop} era ${g.era} home (${g.homeX},${g.homeY}) known ${g.knownCount}\n  owns: ${owned.join(', ')}\n  missing 4+: ${missing.join('; ')}`);
  }
  proc!.getBuiltinModule!('fs').writeFileSync(env.STATEOUT ?? 'state.txt', out.join('\n') + '\n');
}, 3600000);
