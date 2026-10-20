// Fast test bench (not a test; runs only when BENCH is set). The simulation is deterministic, so
// a saved state replays exactly: fixes are checked from the moment that matters instead of from
// year 0.
//
//   BENCH=snap  SCEN=A|M SEED=19 AT=500,1000         save states (snapshots) at those years
//   BENCH=run   SNAP=A-19-y500 YEARS=200 STEP=25     run on from a snapshot (or SCEN+SEED from year 0)
//               PROFILE=1                            + the 25 functions that took the most time
//   OVR='{"dotted.path": value}'                     config overrides (leaf keys only)
//   HASH=1                                               print the state hash at the end (same code + same start = same hash)
//   OUT=file                                         report file (default bench.txt)
//
// Snapshots live in SNAPDIR (default ./.snaps, git-ignored by name: keep them out of commits).
// A snapshot made before a rule change replays the old history up to its year, then the new rules.

import { it } from 'vitest';
import { CONFIG } from '../../src/config';
import { createState, type SimState } from '../../src/sim/state';
import { runTicks } from '../../src/sim/tick';
import { hashState } from '../../src/sim/serialize';
import { population } from '../../src/sim/people/groups';
import { DISCOVERIES, has } from '../../src/shared/discoveries';
import * as S from '../../src/presets/scenarios';
import type { RunSetup } from '../../src/shared/types';
import { miniGarden } from './mini';

interface Fs { writeFileSync(p: string, d: string | Uint8Array): void; readFileSync(p: string): Uint8Array; mkdirSync(p: string, o: { recursive: boolean }): void }
interface V8 { serialize(v: unknown): Uint8Array; deserialize(b: Uint8Array): unknown }
interface Session { connect(): void; post(m: string, p: unknown, cb: (e: Error | null, r: { profile?: Profile }) => void): void; post(m: string, cb: (e: Error | null, r: { profile?: Profile }) => void): void }
interface Profile { nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number }>; samples: number[]; timeDeltas: number[] }

const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; getBuiltinModule?: (m: string) => unknown } }).process;
const env = proc?.env ?? {};
const mod = <T>(m: string): T => proc!.getBuiltinModule!(m) as T;
const SNAPDIR = env.SNAPDIR ?? '.snaps';

for (const [path, value] of Object.entries(JSON.parse(env.OVR || '{}') as Record<string, unknown>)) {
  const keys = path.split('.');
  let o = CONFIG as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
}

const build = (scen: string, seed: number): RunSetup =>
  scen === 'M' ? miniGarden(seed) : (S as unknown as Record<string, (s: number) => RunSetup>)[`scenario${scen}`]!(seed);

const snapPath = (name: string): string => `${SNAPDIR}/${name}.bin`;

/** One line per group: what the bench usually needs to see. */
function groupLines(s: SimState): string[] {
  return s.groups.map((g) => `  ${g.name.padEnd(10)} pop ${String(population(g)).padStart(5)} era ${g.era} H ${g.hunger.toFixed(0).padStart(3)} crowd ${g.crowding.toFixed(2)}`
    + ` farms ${g.farmTiles.length} wood ${g.wood.toFixed(0)} herd ${g.herd.toFixed(0)} disc ${DISCOVERIES.filter((d) => has(g.discoveries, d.id)).length}`
    + ` off: ${DISCOVERIES.filter((d) => has(g.inactive, d.id)).map((d) => d.name).join(',') || '-'}`);
}

function topFunctions(p: Profile, n: number): string[] {
  const self = new Map<number, number>();
  p.samples.forEach((id, k) => self.set(id, (self.get(id) ?? 0) + (p.timeDeltas[k] ?? 0)));
  const byFn = new Map<string, number>();
  let total = 0;
  for (const node of p.nodes) {
    const t = self.get(node.id) ?? 0;
    total += t;
    const f = node.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) ?? 0) + t);
  }
  return [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, t]) => `  ${(t / 1000).toFixed(0).padStart(7)} ms  ${((100 * t) / Math.max(1, total)).toFixed(1).padStart(5)}%  ${k}`);
}

it.skipIf(!env.BENCH)('bench', async () => {
  const fs = mod<Fs>('fs');
  const v8 = mod<V8>('v8');
  const out: string[] = [];
  const t0 = Date.now();

  if (env.BENCH === 'snap') {
    const scen = env.SCEN ?? 'A';
    const seed = Number(env.SEED ?? 1);
    fs.mkdirSync(SNAPDIR, { recursive: true });
    const s = createState(build(scen, seed));
    for (const year of (env.AT ?? '500').split(',').map(Number)) {
      while (s.year < year && s.groups.length > 0) runTicks(s, 12);
      fs.writeFileSync(snapPath(`${scen}-${seed}-y${s.year}`), v8.serialize(s));
      out.push(`saved ${scen}-${seed}-y${s.year} (${((Date.now() - t0) / 1000).toFixed(0)} s)`, ...groupLines(s));
      if (s.groups.length === 0) { out.push('  everyone died'); break; }
    }
  } else {
    const s = env.SNAP
      ? v8.deserialize(fs.readFileSync(snapPath(env.SNAP))) as SimState
      : createState(build(env.SCEN ?? 'A', Number(env.SEED ?? 1)));
    const years = Number(env.YEARS ?? 100);
    const step = Number(env.STEP ?? 25);
    const end = s.year + years;
    let session: Session | null = null;
    if (env.PROFILE) {
      const insp = mod<{ Session: new () => Session }>('inspector');
      session = new insp.Session();
      session.connect();
      await new Promise<void>((r) => session!.post('Profiler.enable', () => session!.post('Profiler.start', () => r())));
    }
    const counts: Record<string, number> = {};
    let seen = s.logDropped + s.log.length;
    out.push(`from year ${s.year}${env.SNAP ? ` (snapshot ${env.SNAP})` : ''}`, ...groupLines(s));
    while (s.year < end && s.groups.length > 0) {
      const t = Date.now();
      runTicks(s, Math.min(step, end - s.year) * 12);
      const total = s.logDropped + s.log.length;
      for (let k = Math.max(seen, s.logDropped); k < total; k++) {
        const e = s.log[k - s.logDropped]!;
        counts[e.type] = (counts[e.type] ?? 0) + 1;
        if (env.LOG && new RegExp(env.LOG).test(e.type)) out.push(`    y${e.year} ${e.text}`);
      }
      seen = total;
      out.push(`year ${s.year} (${((Date.now() - t) / 1000).toFixed(1)} s for ${step} years)`, ...groupLines(s));
    }
    if (env.HASH) out.push(`hash ${hashState(s)}`);
    out.push(`log: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (session) {
      const prof = await new Promise<Profile>((r) => session!.post('Profiler.stop', (_e, res) => r(res.profile!)));
      out.push('slowest functions (self time):', ...topFunctions(prof, 25));
    }
  }
  out.push(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  fs.writeFileSync(env.OUT ?? 'bench.txt', out.join('\n') + '\n');
}, 24 * 3600 * 1000);
