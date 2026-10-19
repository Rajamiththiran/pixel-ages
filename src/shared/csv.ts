// CSV export of the graphs (yearly stats) and the event log (future blueprint F7, §13).

import type { LogEntry, YearStats } from './types';
import { DISCOVERIES, idsOf } from './discoveries';

type Row = YearStats['perLineage'][number];

/** One column per YearStats field, in this order; `discoveries` becomes a count and a name list. */
export const STAT_COLUMNS = [
  'lineageId', 'population', 'groups', 'bestEra', 'avgEra',
  'intActual', 'intPotential', 'coopActual', 'coopPotential', 'strActual', 'strPotential', 'fed', 'discoveries',
] as const satisfies ReadonlyArray<keyof Row>;

/** A CSV field: quoted when it holds a comma, quote or line break. */
export function csvField(v: string | number | null): string {
  if (v === null) return '';
  const t = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : v;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const line = (fields: Array<string | number | null>): string => fields.map(csvField).join(',');

/** year, lineage, then every STAT_COLUMNS field (discoveries as a count), then the discovery names. */
export function statsCsv(rows: readonly YearStats[], lineageName: (id: number) => string): string {
  const header = ['year', 'lineage', ...STAT_COLUMNS, 'discoveryNames'];
  const out = [header.join(',')];
  for (const row of rows) {
    for (const r of row.perLineage) {
      const ids = idsOf(r.discoveries);
      const values = STAT_COLUMNS.map((k) => (k === 'discoveries' ? ids.length : r[k]));
      out.push(line([row.year, lineageName(r.lineageId), ...values, ids.map((d) => DISCOVERIES[d]!.name).join('; ')]));
    }
  }
  return `${out.join('\n')}\n`;
}

/** year, month, type, groupId, otherId, lineageId, x, y, text. */
export function logCsv(entries: readonly LogEntry[]): string {
  const out = ['year,month,type,groupId,otherId,lineageId,x,y,text'];
  for (const e of entries) out.push(line([e.year, e.month + 1, e.type, e.groupId, e.otherId, e.lineageId, e.x, e.y, e.text]));
  return `${out.join('\n')}\n`;
}
