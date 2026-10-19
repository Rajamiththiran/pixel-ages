// Graphs (§21.2): one line per lineage in its colour, drawn with Canvas 2D. Hover shows every
// lineage's value at that year; a click jumps the timeline there; a marker shows the viewed year.
// F7 (§13): planned events and disasters are marked on the timeline, and a second run can be
// drawn over the first (dotted) to compare them.

import { CONFIG } from '../config';
import type { YearStats } from '../shared/types';
import { h } from './layout';

type Row = YearStats['perLineage'][number];

export interface LineageInfo { id: number; name: string; colour: string }

interface Chart {
  title: string;
  solid: (r: Row) => number;
  dashed?: (r: Row) => number;   // potential traits, average era
  dashedName?: string;
  fixed?: [number, number];      // fixed y range (era, food)
  population?: boolean;          // may use a log scale
  format: (v: number) => string;
}

const f0 = (v: number): string => v.toFixed(0);
const f1 = (v: number): string => v.toFixed(1);

const CHARTS: Chart[] = [
  { title: 'Population', solid: (r) => r.population, population: true, format: (v) => Math.round(v).toLocaleString('en-US') },
  { title: 'Intelligence', solid: (r) => r.intActual, dashed: (r) => r.intPotential, dashedName: 'potential', format: f0 },
  { title: 'Cooperation', solid: (r) => r.coopActual, dashed: (r) => r.coopPotential, dashedName: 'potential', format: f0 },
  { title: 'Strength', solid: (r) => r.strActual, dashed: (r) => r.strPotential, dashedName: 'potential', format: f0 },
  { title: 'Era', solid: (r) => r.bestEra, dashed: (r) => r.avgEra, dashedName: 'average', fixed: [0, 6], format: f1 },
  { title: 'Food (fed)', solid: (r) => r.fed, fixed: [0, 1], format: (v) => `${Math.round(v * 100)}%` },
];

const G = CONFIG.ui.graphs;
const PAD = { left: 34, right: 6, top: 16, bottom: 14 };

/** A shaded span (planned event) or a tick (disaster, intervention) on the timeline. */
export interface GraphMarker { start: number; end: number; colour: string; label: string }

export interface GraphExtras {
  /** Run B's stats, drawn dotted over run A (Compare). */
  compare?: () => readonly YearStats[] | null;
  markers?: () => readonly GraphMarker[];
}

export interface GraphsApi {
  element: HTMLElement;
  redraw(): void;
}

export function buildGraphs(
  rows: readonly YearStats[], lineages: () => LineageInfo[], viewYear: () => number | null, onJump: (year: number) => void,
  extras: GraphExtras = {},
): GraphsApi {
  const hidden = new Set<number>();
  let logScale = false;
  const legend = h('div', { class: 'graph-legend' });
  const tip = h('div', { class: 'graph-tip' });
  const logBox = h('input', { type: 'checkbox' });
  logBox.addEventListener('change', () => { logScale = logBox.checked; redraw(); });
  const canvases = CHARTS.map(() => {
    const c = h('canvas', { class: 'graph' });
    c.width = G.width;
    c.height = G.height;
    return c;
  });
  const element = h('div', { class: 'graphs' },
    h('h3', { text: 'Graphs' }),
    legend,
    h('label', { class: 'row hint' }, logBox, h('span', { text: 'Population on a log scale' })),
    ...canvases, tip);

  let legendKey = '';
  function renderLegend(): void {
    const ls = lineages();
    const key = ls.map((l) => `${l.id}${hidden.has(l.id) ? '-' : '+'}`).join(',');
    if (key === legendKey) return;
    legendKey = key;
    legend.replaceChildren(...ls.map((l) => {
      const box = h('input', { type: 'checkbox' });
      box.checked = !hidden.has(l.id);
      box.addEventListener('change', () => { if (box.checked) hidden.delete(l.id); else hidden.add(l.id); legendKey = ''; redraw(); });
      const dot = h('span', { class: 'swatch-dot' });
      dot.style.background = l.colour;
      return h('label', { class: 'legend-item' }, box, dot, h('span', { text: l.name }));
    }));
  }

  /** Rows shown: up to the viewed year when looking at the past. */
  function shown(): { list: readonly YearStats[]; maxYear: number } {
    const b = extras.compare?.() ?? null;
    const last = Math.max(rows.length ? rows[rows.length - 1]!.year : 0, b && b.length ? b[b.length - 1]!.year : 0);
    const vy = viewYear();
    if (vy === null) return { list: rows, maxYear: Math.max(1, last) };
    let n = rows.length;
    while (n > 0 && rows[n - 1]!.year > vy) n--;
    return { list: rows.slice(0, n), maxYear: Math.max(1, last) };
  }

  function yRange(chart: Chart, list: readonly YearStats[], ids: number[]): [number, number] {
    if (chart.fixed) return chart.fixed;
    let lo = Infinity, hi = -Infinity;
    for (const row of list) {
      for (const r of row.perLineage) {
        if (!ids.includes(r.lineageId) || r.population === 0) continue;
        for (const fn of [chart.solid, chart.dashed]) {
          if (!fn) continue;
          const v = fn(r);
          if (chart.population && logScale && v <= 0) continue;
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    if (!Number.isFinite(lo)) return [0, 1];
    if (chart.population) {
      if (logScale) return [Math.max(1, lo), Math.max(10, hi)];
      return [0, Math.max(10, hi)];
    }
    const pad = Math.max(1, (hi - lo) * 0.1);
    return [lo - pad, hi + pad];
  }

  function redraw(): void {
    renderLegend();
    const { list, maxYear } = shown();
    const ls = lineages().filter((l) => !hidden.has(l.id));
    const ids = ls.map((l) => l.id);
    const step = Math.max(1, Math.ceil(list.length / G.maxPoints));
    const vy = viewYear();
    const other = extras.compare?.() ?? null;
    const marks = extras.markers?.() ?? [];
    CHARTS.forEach((chart, k) => {
      const c = canvases[k]!;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      const [lo0, hi0] = yRange(chart, list, ids);
      const [loB, hiB] = other ? yRange(chart, other, ids) : [lo0, hi0];
      const lo = Math.min(lo0, loB);
      const hi = Math.max(hi0, hiB);
      const useLog = chart.population === true && logScale;
      const ty = (v: number): number => {
        const t = useLog ? (Math.log10(Math.max(lo, v)) - Math.log10(lo)) / Math.max(1e-9, Math.log10(hi) - Math.log10(lo)) : (v - lo) / (hi - lo || 1);
        return PAD.top + (1 - t) * (c.height - PAD.top - PAD.bottom);
      };
      const tx = (year: number): number => PAD.left + (year / maxYear) * (c.width - PAD.left - PAD.right);
      // Frame, title, y labels.
      ctx.fillStyle = '#e8e2d4';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(chart.title + (chart.dashedName ? ` (dashed: ${chart.dashedName})` : ''), 2, 1);
      ctx.fillStyle = '#a39d92';
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(chart.format(hi), PAD.left - 3, PAD.top - 2);
      ctx.textBaseline = 'bottom';
      ctx.fillText(chart.format(lo), PAD.left - 3, c.height - PAD.bottom + 2);
      ctx.textAlign = 'left';
      ctx.fillText('0', PAD.left, c.height);
      ctx.textAlign = 'right';
      ctx.fillText(`year ${maxYear.toLocaleString('en-US')}`, c.width - PAD.right, c.height);
      ctx.strokeStyle = '#454052';
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD.left + 0.5, PAD.top + 0.5, c.width - PAD.left - PAD.right - 1, c.height - PAD.top - PAD.bottom - 1);
      // Planned events shaded, disasters and interventions as thin ticks (F7).
      for (const m of marks) {
        const x0 = tx(Math.max(0, m.start));
        const x1 = Math.max(x0 + 1, tx(Math.min(maxYear, m.end)));
        ctx.fillStyle = m.colour;
        ctx.globalAlpha = m.end - m.start > 1 ? 0.18 : 0.45;
        ctx.fillRect(x0, PAD.top, x1 - x0, c.height - PAD.top - PAD.bottom);
      }
      ctx.globalAlpha = 1;
      // Run B (Compare), dotted under run A.
      if (other) {
        const stepB = Math.max(1, Math.ceil(other.length / G.maxPoints));
        for (const l of ls) {
          ctx.strokeStyle = l.colour;
          ctx.globalAlpha = 0.75;
          ctx.setLineDash([1, 2]);
          ctx.beginPath();
          let open = false;
          for (let i = 0; i < other.length; i += stepB) {
            const row = other[i]!;
            const r = row.perLineage.find((q) => q.lineageId === l.id);
            const v = r && (r.population > 0 || chart.population) ? chart.solid(r) : NaN;
            if (!Number.isFinite(v) || (useLog && v <= 0)) { open = false; continue; }
            const x = tx(row.year);
            const y = ty(v);
            if (open) ctx.lineTo(x, y); else { ctx.moveTo(x, y); open = true; }
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // One line per lineage (solid, then dashed); gaps where a lineage has no people.
      for (const l of ls) {
        for (const [fn, dash] of [[chart.solid, false], [chart.dashed, true]] as const) {
          if (!fn) continue;
          ctx.strokeStyle = l.colour;
          ctx.setLineDash(dash ? [3, 3] : []);
          ctx.beginPath();
          let open = false;
          for (let i = 0; i < list.length; i += step) {
            const row = list[i]!;
            const r = row.perLineage.find((p) => p.lineageId === l.id);
            const v = r && (r.population > 0 || chart.population) ? fn(r) : NaN;
            if (!Number.isFinite(v) || (useLog && v <= 0)) { open = false; continue; }
            const x = tx(row.year);
            const y = ty(v);
            if (open) ctx.lineTo(x, y); else { ctx.moveTo(x, y); open = true; }
          }
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      if (vy !== null) {
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(Math.round(tx(vy)) + 0.5, PAD.top);
        ctx.lineTo(Math.round(tx(vy)) + 0.5, c.height - PAD.bottom);
        ctx.stroke();
      }
    });
  }

  /** Year under the mouse on chart k, or null outside the plot. */
  function yearAt(c: HTMLCanvasElement, e: MouseEvent): number | null {
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    if (x < PAD.left || x > c.width - PAD.right) return null;
    const { maxYear } = shown();
    return Math.round(((x - PAD.left) / (c.width - PAD.left - PAD.right)) * maxYear);
  }

  canvases.forEach((c, k) => {
    c.addEventListener('mousemove', (e) => {
      const year = yearAt(c, e);
      const { list } = shown();
      const row = year === null ? undefined : nearestRow(list, year);
      if (!row) { tip.style.display = 'none'; return; }
      const chart = CHARTS[k]!;
      const lines = lineages().filter((l) => !hidden.has(l.id)).map((l) => {
        const r = row.perLineage.find((p) => p.lineageId === l.id);
        const alive = r && r.population > 0;
        const val = !r ? '—' : !alive && !chart.population ? 'extinct'
          : chart.format(chart.solid(r)) + (chart.dashed ? ` / ${chart.format(chart.dashed(r))}` : '');
        return `<span style="color:${l.colour}">■</span> ${escapeHtml(l.name)}: ${val}`;
      });
      const other = extras.compare?.() ?? null;
      const rowB = other ? nearestRow(other, row.year) : undefined;
      if (rowB) {
        for (const l of lineages().filter((q) => !hidden.has(q.id))) {
          const r = rowB.perLineage.find((p) => p.lineageId === l.id);
          if (r) lines.push(`<span style="color:${l.colour}">┈</span> ${escapeHtml(l.name)} (run B): ${chart.format(chart.solid(r))}`);
        }
      }
      const here = (extras.markers?.() ?? []).filter((m) => m.start <= row.year && row.year < Math.max(m.end, m.start + 1)).map((m) => escapeHtml(m.label));
      tip.innerHTML = `<b>Year ${row.year.toLocaleString('en-US')}</b><br>${lines.join('<br>')}${here.length ? `<br><i>${here.slice(0, 4).join('<br>')}</i>` : ''}`;
      const host = element.getBoundingClientRect();
      tip.style.display = 'block';
      tip.style.left = `${Math.min(e.clientX - host.left + 12, host.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${e.clientY - host.top + 14 + element.scrollTop}px`;
    });
    c.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    c.addEventListener('click', (e) => {
      const year = yearAt(c, e);
      if (year !== null) onJump(year);
    });
  });

  redraw();
  return { element, redraw };
}

function nearestRow(list: readonly YearStats[], year: number): YearStats | undefined {
  if (list.length === 0) return undefined;
  let lo = 0, hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.year < year) lo = mid + 1; else hi = mid;
  }
  return list[lo];
}

const escapeHtml = (t: string): string => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
