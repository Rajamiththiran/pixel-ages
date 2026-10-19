// Compare two runs (future blueprint F7, §13): run B goes in a second, headless worker that
// keeps pace with the run on screen. Its graphs are drawn dotted over run A's, and a table shows
// the differences at the latest year both have reached.

import type { LogEntry, RunSetup, YearStats } from '../shared/types';
import type { FromWorker, ToWorker } from '../shared/protocol';
import { ERA_NAMES, idsOf } from '../shared/discoveries';
import { decodeRun } from '../shared/save';
import { h } from './layout';
import { buildGraphs, type GraphMarker, type LineageInfo } from './graphs';
import { pickTextFile } from './storage';

/** Run B: a headless worker that runs up to the year it is told, sending stats and log only. */
export class CompareSession {
  private readonly worker: Worker;
  readonly stats: YearStats[] = [];
  readonly log: LogEntry[] = [];
  error: string | null = null;

  constructor(readonly setup: RunSetup, private readonly changed: () => void) {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'stats') { this.stats.push(...m.rows); this.changed(); }
      else if (m.type === 'log') this.log.push(...m.entries);
      else if (m.type === 'error') { this.error = m.message; this.changed(); }
    };
    this.send({ type: 'start', setup, headless: true });
  }

  private send(msg: ToWorker): void { this.worker.postMessage(msg); }

  /** Keep pace with run A. */
  runTo(year: number): void { this.send({ type: 'runTo', year }); }

  get year(): number { return this.stats.length ? this.stats[this.stats.length - 1]!.year : 0; }

  stop(): void { this.send({ type: 'stop' }); this.worker.terminate(); }
}

export interface CompareDeps {
  statsA: readonly YearStats[];
  setupA: () => RunSetup;
  lineages: () => LineageInfo[];
  viewYear: () => number | null;
  onJump: (year: number) => void;
  markers: () => readonly GraphMarker[];
  liveYear: () => number;
  toast: (text: string) => void;
}

export interface CompareApi {
  element: HTMLElement;
  /** New stats on either side, or the viewed year changed. */
  redraw(): void;
  /** The run on screen reached a new year: keep run B in step. */
  sync(): void;
  stop(): void;
}

export function buildCompare(d: CompareDeps): CompareApi {
  let b: CompareSession | null = null;
  const status = h('p', { class: 'hint' });
  const table = h('div');
  const graphs = buildGraphs(d.statsA, d.lineages, d.viewYear, d.onJump, { compare: () => b?.stats ?? null, markers: d.markers });
  const seed = h('input', { type: 'number', min: 0, step: 1, value: (d.setupA().seed + 1) >>> 0 });
  seed.style.width = '110px';

  function startB(setup: RunSetup): void {
    b?.stop();
    b = new CompareSession(setup, () => schedule());
    b.runTo(d.liveYear());
    render();
  }

  const sameSetup = h('button', {
    text: 'Start', title: 'The same map, groups, events and interventions with another seed',
    onclick: () => {
      const v = Math.floor(Number(seed.value));
      if (!Number.isFinite(v) || v < 0) { d.toast('Type a seed (0 or more).'); return; }
      startB({ ...d.setupA(), seed: v >>> 0, name: `${d.setupA().name} (seed ${v})` });
    },
  });
  const fromFile = h('button', {
    text: 'Load a run file…', title: 'Compare with any saved run (for example the same seed with one change)',
    onclick: async () => {
      const text = await pickTextFile('.json,application/json');
      if (text === null) return;
      try { startB(decodeRun(text)); } catch (e) { d.toast((e as Error).message); }
    },
  });
  const stopB = h('button', { class: 'danger', text: 'Stop comparing', onclick: () => { b?.stop(); b = null; render(); } });

  const element = h('div', { class: 'compare' },
    h('h3', { text: 'Compare two runs' }),
    h('p', { class: 'hint', text: 'Run B is simulated alongside the run on screen and kept at the same year. Its lines are dotted in the graphs below.' }),
    h('div', { class: 'row' }, h('span', { text: 'Same setup, seed' }), seed, sameSetup),
    h('div', { class: 'row' }, fromFile, stopB),
    status, table, graphs.element);

  let timer: ReturnType<typeof setTimeout> | null = null;
  function schedule(): void {
    if (timer !== null) return;
    timer = setTimeout(() => { timer = null; render(); }, 250);
  }

  /** Per lineage at the latest year both runs reached: people, groups, best era, discoveries. */
  function renderTable(): void {
    if (!b || b.stats.length === 0 || d.statsA.length === 0) { table.replaceChildren(); return; }
    const year = Math.min(b.year, d.statsA[d.statsA.length - 1]!.year);
    const at = (rows: readonly YearStats[]): YearStats | undefined => {
      for (let k = rows.length - 1; k >= 0; k--) if (rows[k]!.year <= year) return rows[k];
      return undefined;
    };
    const ra = at(d.statsA);
    const rb = at(b.stats);
    if (!ra || !rb) { table.replaceChildren(); return; }
    const names = new Map(d.lineages().map((l) => [l.id, l.name]));
    for (const f of b.setup.founders) if (!names.has(f.id)) names.set(f.id, f.name);
    const head = h('tr', {}, ...['Year ' + year.toLocaleString('en-US'), 'People A', 'B', 'Era A', 'B', 'Disc. A', 'B'].map((x) => h('th', { text: x })));
    const rows = [...names.entries()].sort((x, y) => x[0] - y[0]).map(([id, name]) => {
      const a = ra.perLineage.find((r) => r.lineageId === id);
      const c = rb.perLineage.find((r) => r.lineageId === id);
      const cell = (v: number | undefined, other: number | undefined, fmt: (n: number) => string): HTMLElement =>
        h('td', { class: v !== other ? 'diff' : '', text: v === undefined ? '—' : fmt(v) });
      const pop = (n: number): string => n.toLocaleString('en-US');
      const era = (n: number): string => `${n} ${ERA_NAMES[n] ?? ''}`.trim();
      const disc = (n: number): string => String(n);
      const da = a ? idsOf(a.discoveries).length : undefined;
      const dc = c ? idsOf(c.discoveries).length : undefined;
      return h('tr', {}, h('td', { text: name }),
        cell(a?.population, c?.population, pop), cell(c?.population, a?.population, pop),
        cell(a?.bestEra, c?.bestEra, era), cell(c?.bestEra, a?.bestEra, era),
        cell(da, dc, disc), cell(dc, da, disc));
    });
    table.replaceChildren(h('table', { class: 'compare-table' }, head, ...rows));
  }

  function render(): void {
    if (!b) status.textContent = 'Nothing to compare yet.';
    else if (b.error) status.textContent = `Run B stopped with an error: ${b.error.split('\n')[0]}`;
    else {
      const behind = d.liveYear() - b.year;
      status.textContent = `Run B: ${b.setup.name || 'unnamed'}, seed ${b.setup.seed} — year ${b.year.toLocaleString('en-US')}${behind > 1 ? ' (catching up…)' : ''}`;
    }
    stopB.disabled = b === null;
    renderTable();
    graphs.redraw();
  }

  render();
  return {
    element,
    redraw: schedule,
    sync() { if (b) b.runTo(d.liveYear()); },
    stop() { b?.stop(); b = null; },
  };
}
