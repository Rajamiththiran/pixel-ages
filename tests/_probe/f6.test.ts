// Temporary F6 measurements (removed after the step report).
//   PROBE=surv SEEDS=1-10 OFF=0|1 OUT=file   population at year 100 of Scenario A seeds
//   PROBE=conf SEED=n OUT=file                Scenario D seed n, 400 years: conflict counts
//   PROBE=prof OUT=file                       Scenario D to year 1500, then profile 40 years
import { it } from 'vitest';
import fs from 'node:fs';
import { Session } from 'node:inspector/promises';
import { CONFIG } from '../../src/config';
import { createState } from '../../src/sim/state';
import { runTicks } from '../../src/sim/tick';
import { population } from '../../src/sim/people/groups';
import { scenarioA, scenarioD } from '../fixtures';

const env = process.env;
const out = (line: string): void => { fs.appendFileSync(env.OUT!, `${line}\n`); };

/** Turns F6's people-moving and fighting rules off (culture, specialists and so on stay). */
function f6Off(): void {
  const SO = CONFIG.future.society as unknown as Record<string, number>;
  SO.marriageShare = 0;
  SO.inbreedPenalty = 0;
  SO.raidChance = 0;
  SO.allianceRatio = 1e9;
  SO.languageMult = 1;
  SO.languageCoexist = 0;
  (CONFIG.future.workAnimals as unknown as Record<string, number>).tradeMult = 1;
}

it('probe', async () => {
  if (env.OFF === '1') f6Off();
  // SET="future.society.inequalityWarWeight=0,future.weapons.iron=1.68"
  for (const kv of (env.SET ?? '').split(',').filter(Boolean)) {
    const [path, v] = kv.split('=');
    const keys = path!.split('.');
    let o = CONFIG as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys.at(-1)!] = Number(v);
  }
  if (env.PROBE === 'surv') {
    const [a, b] = env.SEEDS!.split('-').map(Number);
    for (let seed = a!; seed <= b!; seed++) {
      const s = createState(scenarioA(seed));
      runTicks(s, 100 * 12);
      out(`${seed} ${s.groups.reduce((t, g) => t + population(g), 0)}`);
    }
  }
  if (env.PROBE === 'conf') {
    const seed = Number(env.SEED);
    const s = createState(scenarioD(seed));
    const t0 = performance.now();
    runTicks(s, Number(env.YEARS ?? 400) * 12);
    const count = (t: string): number => s.log.filter((e) => e.type === t).length;
    const chiefs = s.groups.filter((g) => g.chief).length;
    const walls = s.groups.filter((g) => g.fortification > 0).length;
    const spec = s.groups.filter((g) => g.specialists > 0).length;
    const tiny = s.groups.filter((g) => population(g) < 50);
    const isolatedTiny = tiny.filter((g) => g.isolationYears >= 200).length;
    const pop = s.groups.reduce((t, g) => t + population(g), 0);
    out(`seed ${seed} year ${s.year}: ${((performance.now() - t0) / 1000).toFixed(0)} s, pop ${pop}, groups ${s.groups.length}, `
      + `war ${count('war')}, raid ${count('raid')}, alliance ${count('alliance')}, conquered ${count('conquered')}, absorbed ${count('absorbed')}, `
      + `trade ${count('tradeStart')}, languages ${s.languages.length}, chiefs ${chiefs}, walls ${walls}, specialists ${spec}, `
      + `tiny ${tiny.length} (isolated ${isolatedTiny})`);
    const lines = s.log.filter((e) => e.type === 'raid' || e.type === 'alliance' || e.type === 'society').slice(0, 12);
    for (const e of lines) out(`  y${e.year} ${e.type}: ${e.text}`);
  }
  if (env.PROBE === 'prof') {
    const s = createState(scenarioD(1));
    const warm = Number(env.AT ?? 1500);
    for (let y = 0; y < warm; y += 250) {
      const t = performance.now();
      runTicks(s, 250 * 12);
      const pop = s.groups.reduce((a, g) => a + population(g), 0);
      const villages = s.groups.filter((g) => g.village).length;
      const big = Math.max(...s.groups.map((g) => population(g)));
      out(`year ${s.year}: ${(250000 / (performance.now() - t)).toFixed(2)} yr/s, pop ${pop}, groups ${s.groups.length} (${villages} villages, biggest ${big}), `
        + `raids ${s.log.filter((e) => e.type === 'raid').length}, wars ${s.log.filter((e) => e.type === 'war').length}, log ${s.log.length}`);
    }
    const session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.start');
    const t0 = performance.now();
    const span = Number(env.SPAN ?? 40);
    runTicks(s, span * 12);
    const ms = (performance.now() - t0) * (40 / span);
    const { profile } = await session.post('Profiler.stop');
    const self = new Map<string, number>();
    let total = 0;
    for (const n of profile.nodes) {
      const hits = n.hitCount ?? 0;
      total += hits;
      const file = n.callFrame.url.split('/').pop() ?? '';
      const key = `${n.callFrame.functionName || '(anon)'} ${file}`;
      self.set(key, (self.get(key) ?? 0) + hits);
    }
    const F6 = ['society.ts'];
    const F6_CONTACT = ['updateAlliances', 'alliesOf', 'raid', 'contactPairs', 'workingAnimals'];
    const rows = [...self.entries()]
      .filter(([k]) => F6.some((f) => k.endsWith(f)) || F6_CONTACT.some((f) => k.startsWith(`${f} `)))
      .sort((a, b) => b[1] - a[1]);
    const share = rows.reduce((t, [, v]) => t + v, 0) / total;
    out(`40 years in ${ms.toFixed(0)} ms = ${(40000 / ms).toFixed(2)} yr/s, ${s.groups.length} groups, ${s.log.filter((e) => e.type === 'raid').length} raids`);
    out(`F6-related self time (incl. all of contactPairs): ${(share * 100).toFixed(1)}%`);
    for (const [k, v] of rows.slice(0, 12)) out(`  ${((v / total) * 100).toFixed(2)}% ${k}`);
    out('top overall:');
    for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) out(`  ${((v / total) * 100).toFixed(2)}% ${k}`);
  }
}, 7200000);
