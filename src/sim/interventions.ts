// Intervention mode (future blueprint F7, D5): changes the owner makes during a run. Each one is
// stored in the run setup with the month it was made, and applied at the start of that month, so
// a run with interventions replays exactly like any other (§16). Hands-off experiments have none.

import { CONFIG } from '../config';
import { Ground, Hazard, WallType } from '../shared/ids';
import { DISCOVERIES, has } from '../shared/discoveries';
import type { Intervention } from '../shared/types';
import type { Group, SimState } from './state';
import { logEvent } from './people/groups';
import { revealAround } from './people/explore';
import { leaveRuins } from './world/landscape';
import { Farmed } from './people/farming';
import { burnSettlement, fireFrom, floodDamage, floodplains, strike } from './world/hazards';
import { gainDiscovery, updateEra } from './progress/discoveryRules';

const IV = CONFIG.future.interventions;

/** Monthly step 0: every intervention made for this month, in the order it was made. */
export function applyInterventions(s: SimState): void {
  const list = s.setup.interventions;
  if (!list || list.length === 0) return;
  for (const iv of list) if (iv.year === s.year && iv.month === s.month) applyIntervention(s, iv);
}

const groupOf = (s: SimState, id: number): Group | undefined => s.groups.find((g) => g.id === id);

const inside = (s: SimState, x: number, y: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < s.width && y < s.height;

export function applyIntervention(s: SimState, iv: Intervention): void {
  switch (iv.kind) {
    case 'flood': return flood(s, iv.at.x, iv.at.y);
    case 'fire': return fire(s, iv.at.x, iv.at.y);
    case 'gift': return gift(s, iv.groupId, iv.discovery);
    case 'move': return move(s, iv.groupId, iv.to.x, iv.to.y);
  }
}

/**
 * The tiles a flood dropped at (x, y) covers: that river's whole floodplain if the tile is on
 * one, else the land within 3 tiles that lies no more than 1 above the tile (painted heights).
 */
export function floodArea(s: SimState, x: number, y: number): number[] {
  const t = y * s.width + x;
  const fp = floodplains(s);
  const k = fp.stretch[t]!;
  if (k >= 0) return fp.plains[k]!.slice();
  const r = IV.floodRadius;
  const out: number[] = [];
  for (let yy = Math.max(0, y - r); yy <= Math.min(s.height - 1, y + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(s.width - 1, x + r); xx++) {
      if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
      const i = yy * s.width + xx;
      if (s.wall[i] !== WallType.None || s.ground[i] === Ground.Water) continue;
      if (s.elevation[i]! > s.elevation[t]! + 1) continue;
      out.push(i);
    }
  }
  return out;
}

function flood(s: SimState, x: number, y: number): void {
  if (!inside(s, x, y)) return;
  const tiles = floodArea(s, x, y);
  for (const i of tiles) {
    s.floodMonths[i] = IV.floodMonths;
    s.farmedThisYear[i] = s.farmedThisYear[i]! | Farmed.Flooded;   // this year's harvest is lost; silt follows
  }
  logEvent(s, 'intervention', `Intervention: a flood at (${x}, ${y}) covered ${tiles.length} km²`, null, null, x, y);
  const hit = new Set(tiles);
  for (const g of s.groups) {
    if (!hit.has(g.homeY * s.width + g.homeX)) continue;
    const dead = floodDamage(s, g);
    strike(s, g, Hazard.RiverFlood, `The flood reached ${g.name}'s homes (${dead} drowned)`, dead, true); // the owner did it: always shown
  }
}

function fire(s: SimState, x: number, y: number): void {
  if (!inside(s, x, y)) return;
  const { tiles, hit } = fireFrom(s, y * s.width + x);
  logEvent(s, 'intervention', `Intervention: a fire at (${x}, ${y}) burned ${tiles} km²`, null, null, x, y);
  for (const id of hit) {
    const g = groupOf(s, id);
    if (!g) continue;
    const dead = burnSettlement(s, g);
    strike(s, g, Hazard.Wildfire, `The fire reached ${g.name} (${dead} died)`, dead, true);
  }
}

/** A gift needs the discoveries it builds on; what must be found on the land is not needed (it came from outside). */
function gift(s: SimState, groupId: number, d: number): void {
  const g = groupOf(s, groupId);
  const def = DISCOVERIES[d];
  if (!g || !def || has(g.discoveries, d)) return;
  const missing = def.needs.filter((n) => !has(g.discoveries, n)).map((n) => DISCOVERIES[n]!.name);
  if (missing.length > 0) {
    logEvent(s, 'intervention', `Intervention: ${g.name} could not take ${def.name} (it needs ${missing.join(', ')})`, g);
    return;
  }
  logEvent(s, 'intervention', `Intervention: ${g.name} was given ${def.name}`, g);
  gainDiscovery(s, g, d, `${g.name} discovered ${def.name} (a gift)`);
  updateEra(s, g);
}

/** The group moves to (x, y): like a migration, its buildings, fields and walls stay behind as ruins. */
function move(s: SimState, groupId: number, x: number, y: number): void {
  const g = groupOf(s, groupId);
  if (!g || !inside(s, x, y)) return;
  const i = y * s.width + x;
  if (s.ground[i] === Ground.Water || (s.wall[i] !== WallType.None && s.crossing[i] !== 1)) return;
  const from = `(${g.homeX}, ${g.homeY})`;
  leaveRuins(s, g);
  g.homeX = x;
  g.homeY = y;
  g.huts = 0;
  g.houses = 0;
  g.buildProgress = 0;
  g.farmTiles = [];
  g.fortification = 0;
  revealAround(s, g, x, y, CONFIG.people.founderKnownRadius);
  logEvent(s, 'intervention', `Intervention: ${g.name} was moved from ${from} to (${x}, ${y})`, g);
}
