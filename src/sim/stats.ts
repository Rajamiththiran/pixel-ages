// Yearly stats per lineage (§7.3 YearStats), used by graphs (step 6) and scenario tests.

import { CONFIG } from '../config';
import type { YearStats } from '../shared/types';
import type { SimState } from './state';
import { newMask, orInto } from '../shared/discoveries';
import { population, traitAverages } from './people/groups';

export function recordYearStats(s: SimState): void {
  const row: YearStats = { year: s.year, perLineage: [] };
  // C4: villages per ruling lineage — each ruler and its subjects count for the ruler's lineage.
  const ruled = new Map<number, number>();
  const capitals = new Set<number>();
  for (const g of s.groups) {
    if (g.overlordId < 0) continue;
    const ruler = s.groups.find((o) => o.id === g.overlordId);
    if (!ruler) continue;
    const capital = capitals.has(ruler.id) ? 0 : 1;   // the capital counts once, with its first subject
    capitals.add(ruler.id);
    ruled.set(ruler.lineageId, (ruled.get(ruler.lineageId) ?? 0) + 1 + capital);
  }
  for (const lin of s.lineages) {
    const groups = s.groups.filter((g) => g.lineageId === lin.id);
    let pop = 0, adults = 0, bestEra = 0, eraSum = 0, fed = 0;
    const disc = newMask();
    let int = 0, coop = 0, str = 0, pInt = 0, pCoop = 0, pStr = 0;
    for (const g of groups) {
      const n = population(g);
      pop += n;
      bestEra = Math.max(bestEra, g.era);
      eraSum += g.era * n;
      fed += (g.fedYearSum / CONFIG.time.ticksPerYear) * n;
      orInto(disc, g.discoveries);
      const t = traitAverages(s, g);
      adults += t.adults;
      int += t.int * t.adults; coop += t.coop * t.adults; str += t.str * t.adults;
      pInt += t.potInt * t.adults; pCoop += t.potCoop * t.adults; pStr += t.potStr * t.adults;
    }
    const a = Math.max(1, adults);
    const q = Math.max(1, pop);
    row.perLineage.push({
      lineageId: lin.id, population: pop, groups: groups.length,
      bestEra, avgEra: eraSum / q,
      intActual: int / a, intPotential: pInt / a,
      coopActual: coop / a, coopPotential: pCoop / a,
      strActual: str / a, strPotential: pStr / a,
      fed: fed / q, discoveries: Array.from(disc), ruled: ruled.get(lin.id) ?? 0,
    });
  }
  s.stats.push(row);
  for (const g of s.groups) g.fedYearSum = 0;
}
