// Probe (not a test): why wars start. Env WHY=seed, SCEN (default M), YEARS, OUT.
// After each year, for each new "War broke out" line, prints the pair's decision inputs and scores.
import { it } from 'vitest';
import { createState } from '../../src/sim/state';
import { runTicks } from '../../src/sim/tick';
import { population } from '../../src/sim/people/groups';
import { decisionScores, inputsFor } from '../../src/sim/society/contact';
import * as S from '../../src/presets/scenarios';
import { miniGarden } from './mini';
import type { RunSetup } from '../../src/shared/types';

const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; getBuiltinModule?: (m: string) => { writeFileSync(p: string, d: string): void } } }).process;
const env = proc?.env ?? {};

it.skipIf(!env.WHY)('why war', () => {
  const scen = env.SCEN ?? 'M';
  const setup = scen === 'M' ? miniGarden(Number(env.WHY)) : (S as unknown as Record<string, (n: number) => RunSetup>)[`scenario${scen}`]!(Number(env.WHY));
  const s = createState(setup);
  const out: string[] = [];
  let seen = 0;
  const f = (v: number): string => v.toFixed(2);
  while (s.year < Number(env.YEARS ?? 800) && s.groups.length > 0) {
    runTicks(s, 12);
    const total = s.logDropped + s.log.length;
    for (let k = Math.max(seen, s.logDropped); k < total; k++) {
      const e = s.log[k - s.logDropped]!;
      if (!/^War broke out/.test(e.text)) continue;
      const a = s.groups.find((g) => g.id === e.groupId), b = s.groups.find((g) => g.id === e.otherId);
      if (!a || !b) continue;
      const rel = s.relations.find((r) => r.a === Math.min(a.id, b.id) && r.b === Math.max(a.id, b.id));
      const x = inputsFor(s, a, b, rel);
      const sc = decisionScores(x);
      out.push(`y${e.year} ${a.name}(${population(a)} H${a.hunger.toFixed(0)} c${f(a.crowding)} par${a.parentId} f${a.foundedYear}) vs ${b.name}(${population(b)} H${b.hunger.toFixed(0)} c${f(b.crowding)} par${b.parentId} f${b.foundedYear})`
        + ` pA ${f(x.pA)} pB ${f(x.pB)} kin ${f(x.kin ?? 0)} ratio ${f(Math.max(x.powerA, x.powerB) / Math.max(1, Math.min(x.powerA, x.powerB)))} coop ${f((x.coopA + x.coopB) / 2)} lin ${x.sameLineage} warlike ${f(x.warlike ?? 0)} ineq ${f(x.inequality ?? 0)}`
        + ` | co ${sc.coexist?.toFixed(0)} tr ${sc.trade?.toFixed(0)} war ${sc.war?.toFixed(0)} abs ${sc.absorb?.toFixed(0) ?? '-'}`);
    }
    seen = total;
  }
  proc!.getBuiltinModule!('fs').writeFileSync(env.OUT ?? 'whywar.txt', out.join('\n') + '\n');
}, 3600000);
