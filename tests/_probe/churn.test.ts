// Pace probe (not a test): why discoveries are lost and gained. Env CHURN=seed, SCEN (default A),
// YEARS, OVR, CHURNOUT. Tallies log lines by kind and reason, per 500-year window.
import { it } from 'vitest';
import { CONFIG } from '../../src/config';
import { createState } from '../../src/sim/state';
import { runTicks } from '../../src/sim/tick';
import { population } from '../../src/sim/people/groups';
import { DISCOVERIES, has } from '../../src/shared/discoveries';
import * as S from '../../src/presets/scenarios';
import type { RunSetup } from '../../src/shared/types';

const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; getBuiltinModule?: (m: string) => { writeFileSync(p: string, d: string): void } } }).process;
const env = proc?.env ?? {};
const SEED = env.CHURN;
for (const [path, value] of Object.entries(JSON.parse(env.OVR || '{}') as Record<string, unknown>)) {
  const keys = path.split('.');
  let o = CONFIG as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
}

/** A short reason key for a log line. */
function reason(type: string, text: string): string {
  if (type === 'lostDiscovery') {
    const m = /\(([^)]*)\)$/.exec(text);
    const r = m ? m[1]! : '?';
    if (r.startsWith('it needs')) return 'lost: cascade';
    if (r.startsWith('nobody practised')) return 'lost: unused';
    return `lost: ${r}`;
  }
  if (type === 'discovery') return / learned /.test(text) ? 'gain: learned' : / discovered /.test(text) ? 'gain: invented' : 'gain: other';
  return type;
}

it.skipIf(!SEED)('churn', () => {
  const build = (S as unknown as Record<string, (s: number) => RunSetup>)[`scenario${env.SCEN ?? 'A'}`]!;
  const s = createState(build(Number(SEED)));
  const years = Number(env.YEARS ?? 1000);
  const win = 500;
  const tallies: Array<Record<string, number>> = [];
  const examples: Record<string, string> = {};
  const all: string[] = [];
  let seen = 0;
  while (s.year < years && s.groups.length > 0) {
    runTicks(s, 12);
    const total = s.logDropped + s.log.length;
    const t = (tallies[Math.floor((s.year - 1) / win)] ??= {});
    for (let k = Math.max(seen, s.logDropped); k < total; k++) {
      const e = s.log[k - s.logDropped]!;
      const key = reason(e.type, e.text);
      t[key] = (t[key] ?? 0) + 1;
      examples[key] ??= `y${e.year} ${e.text}`;
      if (env.ALL && (e.type === "lostDiscovery" || e.type === "discovery" || e.type === "ranOut" || e.type === "eraDown" || e.type === "eraUp")) all.push(`y${e.year} ${e.text}`);
    }
    seen = total;
    if (env.YEARLY && s.year % 50 === 0) for (const g of s.groups) all.push(`y${s.year} ${g.name} pop ${population(g)} H ${g.hunger.toFixed(0)} crowd ${g.crowding.toFixed(2)} need ${g.need.toFixed(0)} sust ${g.sustainable.toFixed(0)} farms ${g.farmTiles.length} wood ${g.wood.toFixed(0)} herd ${g.herd.toFixed(0)} huts ${g.huts} houses ${g.houses} off: ${DISCOVERIES.filter((d) => has(g.inactive, d.id)).map((d) => d.name).join(",")}`);
  }
  const out = tallies.map((t, w) => `years ${w * win}-${(w + 1) * win}: ` + Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
  out.push("", ...all, "", ...Object.entries(examples).map(([k, v]) => `${k}: ${v}`));
  proc!.getBuiltinModule!('fs').writeFileSync(env.CHURNOUT ?? 'churn.txt', out.join('\n') + '\n');
}, 3600000);
