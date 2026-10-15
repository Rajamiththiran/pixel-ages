// Right panel during a run (§20.3, §21): Inspect | Graphs | Log.

import { CONFIG } from '../config';
import type { LogEntry, YearStats } from '../shared/types';
import type { InspectResult } from '../shared/protocol';
import { h } from './layout';
import { buildGraphs, type LineageInfo } from './graphs';
import { buildEventLog } from './eventLog';

export type RunTab = 'Inspect' | 'Graphs' | 'Log';
const RUN_TABS: RunTab[] = ['Inspect', 'Graphs', 'Log'];

export interface RunPanelDeps {
  log: readonly LogEntry[];
  stats: readonly YearStats[];
  lineages: () => LineageInfo[];
  viewYear: () => number | null;            // the year being viewed in the past, else null
  onFollow: (groupId: number) => void;      // fog + territory for that group
  onJump: (year: number) => void;           // graph click
  onLogPick: (e: LogEntry) => void;         // log click
}

export interface RunPanelApi {
  show(t: RunTab): void;
  setInspect(r: InspectResult | null): void;
  logChanged(): void;
  statsChanged(): void;
  /** The viewed year changed (past view or back to now): graphs and log filter to it. */
  viewChanged(): void;
}

export function buildRunPanel(tabsEl: HTMLElement, bodyEl: HTMLElement, d: RunPanelDeps): RunPanelApi {
  let current: RunTab = 'Inspect';
  let inspected: InspectResult | null = null;
  const graphs = buildGraphs(d.stats, d.lineages, d.viewYear, d.onJump);
  const eventLog = buildEventLog(d.log, d.lineages, d.viewYear, d.onLogPick);
  tabsEl.replaceChildren();
  const buttons = RUN_TABS.map((t) => {
    const b = h('button', { text: t, onclick: () => show(t) });
    tabsEl.append(b);
    return b;
  });

  const card = (title: string, rows: Record<string, unknown>, extra?: Node): HTMLElement => {
    const list = h('div', { class: 'kv' });
    for (const [k, v] of Object.entries(rows)) {
      if (k.startsWith('_')) continue;
      list.append(h('span', { class: 'k', text: k }), h('span', { class: 'v', text: String(v) }));
    }
    return h('div', { class: 'group-card' }, h('div', { class: 'title', text: title }), list, extra ?? null);
  };

  function renderInspect(): Node[] {
    if (!inspected) {
      return [
        h('h3', { text: 'Inspect' }),
        h('p', { class: 'hint', text: 'Click a person, a home or any tile on the map.' }),
        h('p', { class: 'hint', text: 'Follow a group to see what it has explored (fog) and its lineage\'s ranges (territory).' }),
      ];
    }
    const out: Node[] = [];
    if (inspected.person) out.push(card('Person', inspected.person));
    if (inspected.group) {
      const gid = inspected.group._groupId as number;
      out.push(card('Group', inspected.group, h('div', { class: 'row' },
        h('button', { text: 'Follow', title: 'Show this group\'s explored land (fog) and its lineage\'s ranges (territory)', onclick: () => d.onFollow(gid) }))));
    }
    out.push(card('Tile', inspected.tile));
    return out;
  }

  // Graphs redraw at most a few times a second; they only matter while visible.
  let graphTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleGraphs(): void {
    if (current !== 'Graphs' || graphTimer !== null) return;
    graphTimer = setTimeout(() => { graphTimer = null; if (current === 'Graphs') graphs.redraw(); }, CONFIG.ui.graphs.redrawMs);
  }
  let logTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleLog(): void {
    if (current !== 'Log' || logTimer !== null) return;
    logTimer = setTimeout(() => { logTimer = null; if (current === 'Log') eventLog.changed(); }, CONFIG.ui.graphs.redrawMs);
  }

  function show(t: RunTab): void {
    current = t;
    buttons.forEach((b, k) => b.classList.toggle('active', RUN_TABS[k] === t));
    if (t === 'Inspect') bodyEl.replaceChildren(...renderInspect());
    else if (t === 'Graphs') { bodyEl.replaceChildren(graphs.element); graphs.redraw(); }
    else { bodyEl.replaceChildren(eventLog.element); eventLog.changed(); }
  }

  show('Inspect');
  return {
    show,
    setInspect(r) { inspected = r; if (current === 'Inspect') show('Inspect'); },
    logChanged: scheduleLog,
    statsChanged: scheduleGraphs,
    viewChanged() {
      if (current === 'Graphs') graphs.redraw();
      if (current === 'Log') eventLog.changed();
    },
  };
}
