// F9 tuning probe (not a test): runs one scenario for the given seeds and appends one JSON line
// per seed to OUT. Env: SCEN (A–H, R = Four Realms), SEEDS (e.g. "1,2,3" or "1-10"), YEARS.
// Config overrides for trials: OVR = JSON of { "dotted.path": value } (leaf keys only).
// Runs only when SCEN is set, so npm test skips it.

import { it } from 'vitest';
import { CONFIG } from '../../src/config';
import { createState, type SimState } from '../../src/sim/state';
import { runTicks } from '../../src/sim/tick';
import { population as groupPop } from '../../src/sim/people/groups';
import { Discovery, DISCOVERIES, has } from '../../src/shared/discoveries';
import { Ground, Plant } from '../../src/shared/ids';
import * as S from '../../src/presets/scenarios';
import { fourRealms } from '../../src/presets/builtins';
import { inbreedMult } from '../../src/sim/society/society';
import type { LogEntry, RunSetup } from '../../src/shared/types';
import { miniGarden } from './mini';

const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; getBuiltinModule?: (m: string) => { appendFileSync(p: string, d: string): void } } }).process;
const env = proc?.env ?? {};
const OUT = env.OUT ?? 'f9probe.jsonl';
const SCEN = env.SCEN ?? '';
const YEARS = Number(env.YEARS ?? 300);
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

const build = (seed: number): RunSetup => {
  if (SCEN === 'R') return fourRealms(seed);
  if (SCEN === 'M') return miniGarden(seed);
  return (S as unknown as Record<string, (s: number) => RunSetup>)[`scenario${SCEN}`]!(seed);
};

const CHECK = [50, 100, 200, 300, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000];
const pop = (s: SimState, lineage?: number): number =>
  s.groups.filter((g) => lineage === undefined || g.lineageId === lineage).reduce((n, g) => n + groupPop(g), 0);

/** Per-scenario measuring: a hook for every new log line, one every year, and numbers at checkpoints. */
interface Meter { log?(e: LogEntry, s: SimState): void; yearly?(s: SimState): void; at?(s: SimState): Record<string, unknown>; end?(s: SimState): Record<string, unknown> }

function meterFor(scen: string, s0: SimState): Meter {
  const n = s0.width * s0.height;
  const firstYear = (m: Map<string, number>, k: string, y: number): void => { if (!m.has(k)) m.set(k, y); };
  if (scen === 'E') {
    const started: Record<string, number> = {};
    const hitBy: Record<string, number> = {};
    const firstFire = new Map<string, number>();
    const safety = new Map<string, number>();
    const burnYear = new Int32Array(n).fill(-1);
    let burned = 0, regrown = 0, forestBack = 0, matured = 0;
    const startForest = Uint8Array.from(s0.plantType, (p) => (p === Plant.Forest ? 1 : 0));
    return {
      log(e) {
        const lin = String(e.lineageId ?? 'lightning');
        if (e.type === 'hazard' && /campfire|spring burn/.test(e.text)) { started[lin] = (started[lin] ?? 0) + 1; firstYear(firstFire, lin, e.year); }
        else if (e.type === 'hazard' && /Lightning/.test(e.text)) started.lightning = (started.lightning ?? 0) + 1;
        else if (e.type === 'hazard' && /wildfire reached/.test(e.text)) { hitBy[lin] = (hitBy[lin] ?? 0) + 1; firstYear(firstFire, lin, e.year); }
        if (e.type === 'discovery' && e.text.includes('Fire Safety')) firstYear(safety, lin, e.year);
      },
      yearly(s) {
        for (let i = 0; i < n; i++) {
          if (s.ash[i] === CONFIG.future.fire.ashYears && burnYear[i]! < 0 && startForest[i]) { burnYear[i] = s.year; burned++; }
          if (burnYear[i]! >= 0 && s.year - burnYear[i]! === 20) {
            matured++;
            if (s.plantType[i] !== Plant.None && s.plantDensity[i]! >= 100) regrown++;
            if (s.plantType[i] === Plant.Forest) forestBack++;
            burnYear[i] = -2;
          }
        }
      },
      at: (s) => ({ p1: pop(s, 1), p2: pop(s, 2), p3: pop(s, 3) }),
      end: () => ({
        started, hitBy, firstFire: Object.fromEntries(firstFire), safety: Object.fromEntries(safety),
        // Fire Safety found after the lineage's first fire.
        safetyAfterFire: [...safety].filter(([lin, y]) => (firstFire.get(lin) ?? Infinity) <= y).map(([l]) => l),
        burned, matured, regrown, forestBack,
      }),
    };
  }
  if (scen === 'F') {
    const floods: Record<string, number> = {};
    const works = new Map<string, number>();
    const yearlyPop: number[][] = [[], []];
    return {
      log(e) {
        const lin = String(e.lineageId);
        if (e.type === 'hazard' && /flood/i.test(e.text)) floods[lin] = (floods[lin] ?? 0) + 1;
        if (e.type === 'discovery' && /Levees|Drainage/.test(e.text)) firstYear(works, `${lin}:${/Levees/.test(e.text) ? 'levees' : 'drainage'}`, e.year);
      },
      yearly(s) { yearlyPop[0]!.push(pop(s, 1)); yearlyPop[1]!.push(pop(s, 2)); },
      at(s) {
        const fert = (lin: number): number => {
          let sum = 0, k = 0;
          for (const g of s.groups) if (g.lineageId === lin) for (const t of g.farmTiles) { sum += s.fertility[t]!; k++; }
          return k ? Math.round((sum / k) * 100) / 100 : -1;
        };
        return { p1: pop(s, 1), p2: pop(s, 2), fert1: fert(1), fert2: fert(2) };
      },
      end() {
        // Steadiness: the share of years in which the population fell by more than 10%.
        const drops = yearlyPop.map((p) => p.filter((v, k) => k > 0 && p[k - 1]! > 20 && v < p[k - 1]! * 0.9).length);
        return { floods, works: Object.fromEntries(works), drops };
      },
    };
  }
  if (scen === 'G') {
    const desert0 = s0.ground.reduce((k, g) => k + (g === Ground.Desert ? 1 : 0), 0);
    return {
      at(s) {
        let desert = 0, grass = 0;
        for (let i = 0; i < n; i++) { if (s.ground[i] === Ground.Desert) desert++; if (s.plantType[i] === Plant.Grass) grass += s.plantDensity[i]!; }
        const herd = (lin: number): number => Math.round(s.groups.filter((g) => g.lineageId === lin).reduce((k, g) => k + g.herd, 0));
        const near = (lin: number): number => {
          let sum = 0, k = 0;
          for (const g of s.groups) {
            if (g.lineageId !== lin) continue;
            for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
              const x = g.homeX + dx, y = g.homeY + dy;
              if (x < 0 || y < 0 || x >= s.width || y >= s.height) continue;
              const i = y * s.width + x;
              sum += s.plantType[i] === Plant.Grass ? s.plantDensity[i]! : 0; k++;
            }
          }
          return k ? Math.round(sum / k) : -1;
        };
        return { p1: pop(s, 1), p2: pop(s, 2), herd1: herd(1), herd2: herd(2), desert: desert - desert0, grassNear1: near(1), grassNear2: near(2), grassAll: Math.round(grass / n) };
      },
    };
  }
  if (scen === 'H') {
    const lost: Record<string, number> = {};
    const gained: Record<string, number> = {};
    let islandLeft: number | null = null;
    return {
      log(e) {
        const lin = String(e.lineageId);
        if (e.type === 'lostDiscovery') lost[lin] = (lost[lin] ?? 0) + 1;
        if (e.type === 'discovery') gained[lin] = (gained[lin] ?? 0) + 1;
      },
      yearly(s) {
        if (islandLeft === null && s.groups.some((g) => g.lineageId === 1 && g.homeX > S.H_ISLAND.seaTo)) islandLeft = s.year;
      },
      at(s) {
        const isl = s.groups.filter((g) => g.lineageId === 1 && g.homeX <= S.H_ISLAND.seaTo);
        const main = s.groups.filter((g) => g.homeX > S.H_ISLAND.seaTo);
        const avg = (gs: typeof isl, f: (g: (typeof isl)[number]) => number): number => (gs.length ? Math.round((gs.reduce((k, g) => k + f(g), 0) / gs.length) * 100) / 100 : -1);
        const cult = (gs: typeof isl): number[] => [0, 1, 2].map((c) => avg(gs, (g) => g.culture[c]!));
        const ci = cult(isl), cm = cult(main);
        const dist = isl.length && main.length ? Math.round(Math.sqrt(ci.reduce((k, v, c) => k + (v - cm[c]!) ** 2, 0))) : -1;
        const nDisc = (g: (typeof isl)[number]): number => DISCOVERIES.filter((d) => has(g.discoveries, d.id)).length;
        return {
          pIsland: isl.reduce((k, g) => k + groupPop(g), 0), pMain: main.reduce((k, g) => k + groupPop(g), 0),
          discIsland: avg(isl, nDisc), discMain: avg(main, nDisc), eraIsland: Math.max(0, ...isl.map((g) => g.era)),
          inbreedIsland: avg(isl, (g) => inbreedMult(g, groupPop(g))), inbreedMain: avg(main, (g) => inbreedMult(g, groupPop(g))),
          isoIsland: avg(isl, (g) => g.isolationYears), isoMain: avg(main, (g) => g.isolationYears), cultureDist: dist,
        };
      },
      end: () => ({ lost, gained, islandLeft }),
    };
  }
  if (scen === 'A') {
    // v1 §26 extras for the 10,000-year look: thinned forest, paths, ruins, regrowth.
    const forest0 = s0.plantType.reduce((k, p) => k + (p === Plant.Forest ? 1 : 0), 0);
    return {
      at(s) {
        let forest = 0, paths = 0, ruins = 0;
        for (let i = 0; i < n; i++) { if (s.plantType[i] === Plant.Forest) forest++; if (s.wear[i]! >= CONFIG.future.wear.path) paths++; if (s.ruinAge[i]! > 0) ruins++; }
        return { forestShare: Math.round((forest / forest0) * 100) / 100, paths, ruins };
      },
    };
  }
  return {};
}

it.skipIf(!SCEN)('f9 probe', () => {
  for (const seed of seeds) {
    const t0 = Date.now();
    const s = createState(build(seed));
    const meter = meterFor(SCEN, s);
    const eraYear: number[] = [];
    const rows: Record<string, unknown>[] = [];
    const logCount: Record<string, number> = {};
    let seen = 0;
    let farming: number | null = null;
    let deadYear: number | null = null;
    let maxPop = 0;
    const readLog = (): void => {
      const total = s.logDropped + s.log.length;
      for (let k = Math.max(seen, s.logDropped); k < total; k++) {
        const e = s.log[k - s.logDropped]!;
        logCount[e.type] = (logCount[e.type] ?? 0) + 1;
        meter.log?.(e, s);
      }
      seen = total;
    };
    for (const y of CHECK.filter((c) => c <= YEARS)) {
      while (s.year < y) {
        runTicks(s, 12);
        readLog();
        meter.yearly?.(s);
        for (const g of s.groups) {
          for (let e = 1; e <= g.era; e++) if (eraYear[e] === undefined) eraYear[e] = s.year;
          if (farming === null && has(g.discoveries, Discovery.farming)) farming = s.year;
        }
        maxPop = Math.max(maxPop, pop(s));
        if (s.groups.length === 0) { deadYear = s.year; break; }
      }
      rows.push({
        y, pop: pop(s), groups: s.groups.length, villages: s.groups.filter((g) => g.village).length,
        era: Math.max(0, ...s.groups.map((g) => g.era)), secs: Math.round((Date.now() - t0) / 1000), ...(meter.at?.(s) ?? {}),
      });
      if (deadYear !== null) break;
    }
    proc!.getBuiltinModule!('fs').appendFileSync(OUT, JSON.stringify({ scen: SCEN, seed, eraYear, farming, deadYear, maxPop, rows, log: logCount, ...(meter.end?.(s) ?? {}), secs: Math.round((Date.now() - t0) / 1000) }) + '\n');
  }
}, 24 * 3600 * 1000);
