// Right panel during a run (§20.3, §21): Inspect | Graphs | Log | Compare (F7).

import { CONFIG } from '../config';
import type { LogEntry, YearStats } from '../shared/types';
import type { InspectResult, PersonStory } from '../shared/protocol';
import { h } from './layout';
import { buildGraphs, type GraphMarker, type LineageInfo } from './graphs';
import { buildEventLog } from './eventLog';
import type { CompareApi } from './compare';

export type RunTab = 'Inspect' | 'Graphs' | 'Log' | 'Compare';
const RUN_TABS: RunTab[] = ['Inspect', 'Graphs', 'Log', 'Compare'];

export interface RunPanelDeps {
  log: readonly LogEntry[];
  stats: readonly YearStats[];
  lineages: () => LineageInfo[];
  viewYear: () => number | null;            // the year being viewed in the past, else null
  onFollow: (groupId: number) => void;      // fog + territory for that group
  onJump: (year: number) => void;           // graph click
  onLogPick: (e: LogEntry) => void;         // log click
  markers: () => readonly GraphMarker[];    // F7: planned events and disasters on the graphs
  compare: CompareApi;                      // F7: the Compare tab
  exportStats: () => void;                  // F7: CSV downloads
  exportLog: () => void;
}

export interface RunPanelApi {
  show(t: RunTab): void;
  setInspect(r: InspectResult | null): void;
  logChanged(): void;
  statsChanged(): void;
  /** The viewed year changed (past view or back to now): graphs and log filter to it. */
  viewChanged(): void;
  /** F7: the followed person's family and life story. */
  setStory(story: PersonStory | null): void;
}

export function buildRunPanel(tabsEl: HTMLElement, bodyEl: HTMLElement, d: RunPanelDeps): RunPanelApi {
  let current: RunTab = 'Inspect';
  let inspected: InspectResult | null = null;
  let story: PersonStory | null = null;
  const graphs = buildGraphs(d.stats, d.lineages, d.viewYear, d.onJump, { markers: d.markers });
  const eventLog = buildEventLog(d.log, d.lineages, d.viewYear, d.onLogPick);
  const graphsBox = h('div', {}, h('div', { class: 'row' },
    h('button', { text: 'Export CSV', title: 'Download the yearly numbers behind the graphs (one row per lineage and year)', onclick: d.exportStats })),
    graphs.element);
  const logBox = h('div', {}, h('div', { class: 'row' },
    h('button', { text: 'Export CSV', title: 'Download the whole event log', onclick: d.exportLog })),
    eventLog.element);
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
    // The followed person's story stays after they die or join a village's counts.
    if (story && (!inspected.person || inspected.person.Person === `#${story.id}`)) out.push(storyCard(story));
    if (inspected.group) {
      const gid = inspected.group._groupId as number;
      out.push(card('Group', inspected.group, h('div', { class: 'row' },
        h('button', { text: 'Follow', title: 'Show this group\'s explored land (fog) and its lineage\'s ranges (territory)', onclick: () => d.onFollow(gid) }))));
    }
    out.push(card('Tile', inspected.tile));
    return out;
  }

  /** F7 family tree and life story (recorded from the moment the person was clicked). */
  function storyCard(st: PersonStory): HTMLElement {
    const fam = h('div', { class: 'fam' });
    if (st.family.length === 0) fam.append(h('span', { class: 'k', text: 'Family' }), h('span', { text: 'none known' }));
    for (const f of st.family) fam.append(h('span', { class: 'k', text: f.role }), h('span', { class: f.alive ? '' : 'gone', text: f.text }));
    const evs = h('div');
    for (const e of st.events) {
      evs.append(h('div', { class: 'ev' }, h('span', { class: 'y', text: `Year ${e.year.toLocaleString('en-US')}` }), h('span', { text: e.text })));
    }
    return h('div', { class: 'group-card story' },
      h('div', { class: 'title', text: `Family and life of #${st.id}${st.alive ? '' : ' (no longer an individual)'}` }),
      fam, h('div', { class: 'title', text: 'Life story' }), evs,
      h('p', { class: 'hint', text: 'Recorded while this person is selected; band people only (villages keep counts, not individuals).' }));
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
    else if (t === 'Graphs') { bodyEl.replaceChildren(graphsBox); graphs.redraw(); }
    else if (t === 'Log') { bodyEl.replaceChildren(logBox); eventLog.changed(); }
    else { bodyEl.replaceChildren(d.compare.element); d.compare.redraw(); }
  }

  show('Inspect');
  return {
    show,
    setInspect(r) { inspected = r; if (current === 'Inspect') show('Inspect'); },
    logChanged: scheduleLog,
    statsChanged() { scheduleGraphs(); if (current === 'Compare') d.compare.redraw(); },
    viewChanged() {
      if (current === 'Graphs') graphs.redraw();
      if (current === 'Log') eventLog.changed();
      if (current === 'Compare') d.compare.redraw();
    },
    setStory(st) { story = st; if (current === 'Inspect') show('Inspect'); },
  };
}
