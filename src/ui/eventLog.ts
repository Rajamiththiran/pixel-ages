// Event log (§21.3): filter by lineage and type group, newest or oldest first, and click a
// line to jump to that year. Virtualised: only the rows in view exist in the DOM.

import { CONFIG } from '../config';
import type { LogEntry, LogType } from '../shared/types';
import type { LineageInfo } from './graphs';
import { h } from './layout';

export const LOG_GROUPS: ReadonlyArray<readonly [string, readonly LogType[]]> = [
  ['Discoveries & eras', ['discovery', 'lostDiscovery', 'eraUp', 'eraDown', 'ranOut']],
  ['Movement', ['split', 'migrate', 'becameVillage', 'becameBand']],
  ['Contact', ['firstContact', 'tradeStart', 'war', 'conquered', 'absorbed']],
  ['World', ['breach', 'event']],
  ['Life', ['groupExtinct', 'lineageExtinct', 'cannotReproduce']],
  ['System', ['perf']],
];

const WORLD_DOT = '#a39d92';

export interface EventLogApi {
  element: HTMLElement;
  /** New entries arrived, or the viewed year changed. */
  changed(): void;
}

export function buildEventLog(
  log: readonly LogEntry[], lineages: () => LineageInfo[], viewYear: () => number | null,
  onPick: (e: LogEntry) => void,
): EventLogApi {
  const ROW = CONFIG.ui.logRowPx;
  let newestFirst = true;
  const hiddenTypes = new Set<LogType>();
  const hiddenLineages = new Set<number>();
  let visible: number[] = [];      // indices into `log`, in display order

  const title = h('h3');
  const order = h('button', { text: 'Newest first', onclick: () => { newestFirst = !newestFirst; order.textContent = newestFirst ? 'Newest first' : 'Oldest first'; changed(); } });
  const types = h('div', { class: 'log-filters' }, ...LOG_GROUPS.map(([name, list]) => {
    const box = h('input', { type: 'checkbox' });
    box.checked = true;
    box.addEventListener('change', () => {
      for (const t of list) if (box.checked) hiddenTypes.delete(t); else hiddenTypes.add(t);
      changed();
    });
    return h('label', { class: 'legend-item' }, box, h('span', { text: name }));
  }));
  const lins = h('div', { class: 'log-filters' });
  const spacer = h('div', { class: 'log-spacer' });
  const scroller = h('div', { class: 'log-scroll' }, spacer);
  const empty = h('p', { class: 'hint', text: 'Nothing has happened yet: discoveries, contact, moves and events appear here.' });
  const element = h('div', { class: 'event-log' }, title, h('div', { class: 'row' }, order), types, lins, empty, scroller);
  scroller.addEventListener('scroll', () => renderRows());

  let linKey = '';
  function renderLineages(): void {
    const ls = lineages();
    const key = ls.map((l) => l.id).join(',');
    if (key === linKey) return;
    linKey = key;
    lins.replaceChildren(...ls.map((l) => {
      const box = h('input', { type: 'checkbox' });
      box.checked = !hiddenLineages.has(l.id);
      box.addEventListener('change', () => { if (box.checked) hiddenLineages.delete(l.id); else hiddenLineages.add(l.id); changed(); });
      const dot = h('span', { class: 'swatch-dot' });
      dot.style.background = l.colour;
      return h('label', { class: 'legend-item' }, box, dot, h('span', { text: l.name }));
    }));
  }

  const colourOf = new Map<number, string>();

  function changed(): void {
    renderLineages();
    colourOf.clear();
    for (const l of lineages()) colourOf.set(l.id, l.colour);
    const vy = viewYear();
    const out: number[] = [];
    for (let k = 0; k < log.length; k++) {
      const e = log[k]!;
      if (vy !== null && e.year > vy) continue;           // viewing the past: only what had happened
      if (hiddenTypes.has(e.type)) continue;
      if (e.lineageId !== null && hiddenLineages.has(e.lineageId)) continue;
      out.push(k);
    }
    if (newestFirst) out.reverse();
    visible = out;
    title.textContent = `Event log (${out.length.toLocaleString('en-US')}${out.length !== log.length ? ` of ${log.length.toLocaleString('en-US')}` : ''})`;
    empty.style.display = log.length === 0 ? '' : 'none';
    spacer.style.height = `${visible.length * ROW}px`;
    renderRows();
  }

  function renderRows(): void {
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW) - 2);
    const last = Math.min(visible.length, Math.ceil((scroller.scrollTop + scroller.clientHeight) / ROW) + 2);
    const rows: HTMLElement[] = [];
    for (let k = first; k < last; k++) {
      const e = log[visible[k]!]!;
      const dot = h('span', { class: 'swatch-dot' });
      dot.style.background = e.lineageId !== null ? colourOf.get(e.lineageId) ?? WORLD_DOT : WORLD_DOT;
      const row = h('div', { class: 'log-row clickable', title: `Year ${e.year.toLocaleString('en-US')} — ${e.text}\nClick to go to this year`, onclick: () => onPick(e) },
        h('span', { class: 'log-year', text: `Year ${e.year.toLocaleString('en-US')}` }), dot, h('span', { class: 'log-text', text: e.text }));
      row.style.top = `${k * ROW}px`;
      rows.push(row);
    }
    spacer.replaceChildren(...rows);
  }

  changed();
  return { element, changed };
}
