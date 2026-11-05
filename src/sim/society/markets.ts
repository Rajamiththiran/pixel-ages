// G1 towns that grow (pixel-ages-towns-plan.md, DECISIONS 22.x). Villages within a day's walk sell
// part of their spare food to the nearest market town and get crafts back (better harvests); the
// town counts what it buys and the tribute it receives as part of its food supply, so it grows on
// its hinterland instead of splitting. Size classes (hamlet, village, town, city) are kept here.
// Real basis: market towns and central places (Christaller), grain for pottery and tools.

import { CONFIG } from '../../config';
import { SizeClass } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import type { Group, SimState } from '../state';
import { hasActive } from '../people/explore';
import { logEvent, logQuiet, population } from '../people/groups';
import { roadBetween } from '../world/landscape';
import { settled } from './realms';

const T = CONFIG.towns;

const dist2 = (a: Group, b: Group): number => (a.homeX - b.homeX) ** 2 + (a.homeY - b.homeY) ** 2;

/** Market reach between a market town and a village: a day's walk, farther by road or with the Cart. */
export function marketReach(s: SimState, town: Group, v: Group): number {
  const r = T.marketReach * (hasActive(town, Discovery.cart) || hasActive(v, Discovery.cart) ? T.cartMult : 1);
  if (dist2(town, v) <= r * r) return r;
  return roadBetween(s, town, v) ? r * T.roadMult : r;
}

export const inMarketReach = (s: SimState, town: Group, v: Group): boolean => {
  const r = marketReach(s, town, v);
  return dist2(town, v) <= r * r;
};

/** Are the two at war with each other (no market across a war). */
function atWar(s: SimState, a: Group, b: Group): boolean {
  const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
  return s.relations.some((r) => r.a === lo && r.b === hi && r.kind === 'war');
}

/** Settled groups at peace with `g` within its market reach (its possible buyers' customers). */
export function marketVillages(s: SimState, g: Group): Group[] {
  return s.groups.filter((o) => o !== g && settled(o) && inMarketReach(s, g, o) && !atWar(s, g, o));
}

/**
 * Could `g` hold a market now: settled, big enough, with villages around at peace. Craftspeople
 * are not required: markets grew where people gathered, and crafts followed (DECISIONS 22.2).
 */
export const marketOk = (s: SimState, g: Group): boolean =>
  settled(g) && population(g) >= T.marketMinPop && marketVillages(s, g).length >= T.marketMinVillages;

/** The size class a group should have now, with a margin before stepping down (no flapping). */
export function sizeClassOf(g: Group): number {
  const pop = population(g);
  const keep = (line: number, now: number): boolean => pop >= line || (g.sizeClass >= now && pop >= line * T.keepClassShare);
  if (hasActive(g, Discovery.city) && keep(T.cityPop, SizeClass.City)) return SizeClass.City;
  if (g.market || keep(T.townPop, SizeClass.Town)) return SizeClass.Town;
  return pop >= CONFIG.people.groupSize.toBandBelow ? SizeClass.Village : SizeClass.Hamlet;
}

/**
 * Yearly, after realms (plan §3.3), groups in id order: markets open and close, each settled
 * group picks the nearest market at peace, sells part of its surplus for crafts, imports are
 * recorded for next year's crowding (with the tribute received), and size classes are updated.
 */
export function yearlyMarkets(s: SimState): void {
  // 1. Markets open when their conditions hold, and close after marketHoldYears without them.
  //    Central places: the biggest settlements are looked at first, and one in reach of a bigger
  //    market sells there instead of holding its own (DECISIONS 22.2).
  const order = s.groups.slice().sort((a, b) => population(b) - population(a) || a.id - b.id);
  const centres: Group[] = [];
  for (const g of order) {
    if (marketOk(s, g) && !centres.some((c) => inMarketReach(s, c, g))) {
      centres.push(g);
      g.marketOkYear = s.year;
      if (!g.market) {
        g.market = true;
        g.marketSince = s.year;
        logQuiet(s, `market:${g.id}`, T.logQuietYears, 'town',
          `${g.name} holds a market: ${marketVillages(s, g).length} villages come to trade`, g, null, null, null, false);
      }
    } else if (g.market && s.year - g.marketOkYear >= T.marketHoldYears) {
      g.market = false;
      logEvent(s, 'town', `${g.name}'s market closed`, g, null, null, null, true);
    }
  }

  // 2–3. Each settled group sells to the nearest market in reach (ties: the bigger, then the
  //      lower id), keeping keepMonths of its own need; the town's crafts come back.
  const markets = s.groups.filter((g) => g.market);
  for (const g of s.groups) {
    g.imports = 0;
    g.exports = 0;
  }
  for (const g of s.groups) {
    g.marketId = -1;
    g.craftBonus = 0;
    if (g.market || !settled(g)) continue;
    let best: Group | null = null;
    for (const m of markets) {
      if (!inMarketReach(s, m, g) || atWar(s, m, g)) continue;
      if (!best || dist2(m, g) < dist2(best, g)
        || (dist2(m, g) === dist2(best, g) && population(m) > population(best))) best = m;
    }
    if (!best) continue;
    g.marketId = best.id;
    const surplus = g.foodStock - g.need * T.keepMonths;
    if (surplus <= 0) continue;
    const sold = surplus * T.sellShare;
    g.foodStock -= sold;
    best.foodStock += sold;
    g.exports = sold;
    best.imports += sold;
    g.craftBonus = T.craftMax * Math.max(T.craftFloor, Math.min(1, best.specialists / T.specialistFull));
  }

  // 4. A ruler's tribute (C4, already moved) is food from outside its land too. (A free group's
  //    tributePaid is what it received; a subject's is what it paid.)
  for (const g of s.groups) if (g.overlordId < 0) g.imports += g.tributePaid;

  // 5. Size classes: growing into a town or a city is news; shrinking is a small event.
  for (const g of s.groups) {
    const next = sizeClassOf(g);
    if (next === g.sizeClass) continue;
    const pop = population(g).toLocaleString('en-US');
    if (next === SizeClass.Town && g.sizeClass < SizeClass.Town) {
      logQuiet(s, `town:${g.id}`, T.logQuietYears, 'town', `${g.name} grew into a town (${pop} people)`, g, null, null, null, false);
    } else if (next === SizeClass.City) {
      logQuiet(s, `city:${g.id}`, T.logQuietYears, 'town', `${g.name} became a city (${pop} people)`, g, null, null, null, false);
    } else if (next < g.sizeClass && g.sizeClass >= SizeClass.Town) {
      logEvent(s, 'town', `${g.name} shrank back to a ${next === SizeClass.Town ? 'town' : 'village'} (${pop} people)`, g, null, null, null, true);
    }
    g.sizeClass = next;
  }
}
