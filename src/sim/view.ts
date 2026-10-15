// Read-only views of the state for the main thread: people and groups for frames (§22),
// and the inspector cards (§21.1). Nothing here changes the simulation.

import { CONFIG } from '../config';
import {
  Action, ACTION_NAMES, GROUND_NAMES, Mode, Plant, PLANT_NAMES, Resource, RESOURCE_NAMES, Sex, SPECIES_NAMES, WallType, WALL_NAMES,
} from '../shared/ids';
import { Discovery, DISCOVERIES, ERA_NAMES, has } from '../shared/discoveries';
import { pressure } from './society/walls';
import type { GroupView, InspectResult } from '../shared/protocol';
import type { Group, SimState } from './state';
import { areaName } from './world/regions';
import { countMembers, groupColor, traitAverages } from './people/groups';
import { hasActive, isKnown } from './people/explore';

const A = CONFIG.people.ages;

/** 8 floats per person (§22): id, workX, workY, colour, flags, motherId, skin*3+hair, action. Lowest ids first, capped. */
export function packPeople(s: SimState): Float32Array {
  const p = s.persons;
  const slots: number[] = [];
  for (const g of s.groups) if (g.mode === Mode.Band) for (const slot of g.members) slots.push(slot);
  if (slots.length > CONFIG.render.maxPeopleSprites) {
    slots.sort((a, b) => p.id[a]! - p.id[b]!);
    slots.length = CONFIG.render.maxPeopleSprites;
  }
  const colour = new Map(s.groups.map((g) => [g.id, groupColor(s, g)]));
  const clothed = new Map(s.groups.map((g) => [g.id, hasActive(g, Discovery.clothing)]));
  const riding = new Map(s.groups.map((g) => [g.id, hasActive(g, Discovery.riding)]));
  const out = new Float32Array(slots.length * 8);
  slots.forEach((slot, k) => {
    const o = k * 8;
    const gid = p.groupId[slot]!;
    const months = p.ageMonths[slot]!;
    const ageClass = months < A.adult * 12 ? 0 : months >= A.elder * 12 ? 2 : 1;
    const tile = p.workTile[slot]!;
    const action = p.action[slot]!;
    out[o] = p.id[slot]!;
    out[o + 1] = tile >= 0 ? tile % s.width : 0;
    out[o + 2] = tile >= 0 ? Math.floor(tile / s.width) : 0;
    out[o + 3] = colour.get(gid) ?? 0;
    out[o + 4] = (p.sex[slot] === Sex.Female ? 1 : 0) | (ageClass << 1) | (clothed.get(gid) ? 8 : 0)
      | (riding.get(gid) && action === Action.Explore ? 16 : 0);
    out[o + 5] = p.motherId[slot]!;
    out[o + 6] = p.skin[slot]! * 3 + p.hair[slot]!;
    out[o + 7] = action;
  });
  return out;
}

export function groupViews(s: SimState): GroupView[] {
  return s.groups.map((g) => ({
    id: g.id, name: g.name, lineageId: g.lineageId, colourIndex: groupColor(s, g), mode: g.mode,
    homeX: g.homeX, homeY: g.homeY, population: g.members.length, era: g.era, discoveries: g.discoveries,
    huts: g.huts, houses: g.houses, herd: Math.floor(g.herd), range: CONFIG.people.range.forage,
    farms: g.farmTiles.length,
  }));
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const f1 = (v: number): string => v.toFixed(1);

/** Inspector cards for a clicked tile, plus the clicked person or group (§21.1). */
export function inspect(s: SimState, x: number, y: number, personId: number | null, groupId: number | null): InspectResult {
  const i = y * s.width + x;
  const wall = s.wall[i]!;
  const tile: Record<string, string | number> = { Position: `(${x}, ${y}) km` };
  const region = s.originalRegionId[i]!;
  tile.Area = region >= 0 ? areaName(region) : '—';
  tile.Ground = GROUND_NAMES[s.ground[i]!]!;
  if (s.plantType[i] !== Plant.None) {
    tile.Plants = `${PLANT_NAMES[s.plantType[i]!]} ${pct(s.plantDensity[i]! / 255)}`;
    tile['Food stock'] = `${f1(s.plantFood[i]!)} FU`;
  }
  if (s.resourceType[i] !== Resource.None) tile.Resource = `${RESOURCE_NAMES[s.resourceType[i]!]} ${s.resourceAmount[i]} units`;
  tile.Rain = `${s.baseRain[i]} painted · ${s.rainNow[i]} now`;
  for (let sp = 0; sp < 4; sp++) {
    const d = s.animal[sp]![i]!;
    if (d > 0) tile[SPECIES_NAMES[sp]!] = pct(d);
  }
  if (wall !== WallType.None) tile.Wall = `${WALL_NAMES[wall]}${s.crossing[i] ? ' (crossing)' : ''}`;
  const knowers = s.groups.filter((g) => isKnown(g, i)).map((g) => g.name);
  tile['Known by'] = knowers.length ? knowers.join(', ') : 'nobody';

  const p = s.persons;
  let person: Record<string, unknown> | null = null;
  const slot = personId !== null ? p.slotOf.get(personId) : undefined;
  let gid = groupId;
  if (slot !== undefined) {
    gid = p.groupId[slot]!;
    const months = p.ageMonths[slot]!;
    const child = months < A.adult * 12;
    const partner = p.partnerId[slot]!;
    let children = 0;
    for (const other of p.slotOf.values()) {
      if (p.motherId[other] === personId || p.fatherId[other] === personId) children++;
    }
    const trait = (pot: number, act: number): string => (child ? `${pot.toFixed(0)} (developing)` : `${pot.toFixed(0)} → ${act.toFixed(0)}`);
    const tileW = p.workTile[slot]!;
    person = {
      Person: `#${personId}`,
      Sex: p.sex[slot] === Sex.Female ? 'Woman' : 'Man',
      Age: `${Math.floor(months / 12)} years`,
      Partner: partner >= 0 ? `#${partner}` : 'none',
      Children: children,
      'Intelligence (potential → actual)': trait(p.potInt[slot]!, p.actInt[slot]!),
      'Cooperation (potential → actual)': trait(p.potCoop[slot]!, p.actCoop[slot]!),
      'Strength (potential → actual)': trait(p.potStr[slot]!, p.actStr[slot]!),
      Health: Math.round(p.health[slot]!),
      Fed: pct(p.fed[slot]!),
      Nutrition: pct(p.nutrition[slot]!),
      Doing: ACTION_NAMES[p.action[slot]!] ?? '—',
      'Work tile': tileW >= 0 ? `(${tileW % s.width}, ${Math.floor(tileW / s.width)})` : '—',
    };
  }

  const g = gid !== null ? s.groups.find((o) => o.id === gid) : undefined;
  return { tile, group: g ? groupCard(s, g) : null, person };
}

function groupCard(s: SimState, g: Group): Record<string, unknown> {
  const c = countMembers(s, g);
  const t = traitAverages(s, g);
  const lin = s.lineages.find((l) => l.id === g.lineageId);
  const owned: string[] = [];
  for (const d of DISCOVERIES) {
    if (!has(g.discoveries, d.id)) continue;
    owned.push(has(g.inactive, d.id) ? `${d.name} (inactive: no ${RESOURCE_NAMES[d.uses]})` : d.name);
  }
  // Share of the home area this group has seen.
  const home = g.homeY * s.width + g.homeX;
  const region = s.regionId[home]!;
  let areaTiles = 0, knownInArea = 0;
  for (let i = 0; i < s.regionId.length; i++) {
    if (s.regionId[i] !== region) continue;
    areaTiles++;
    if (isKnown(g, i)) knownInArea++;
  }
  return {
    _groupId: g.id,
    Group: g.name,
    Lineage: lin?.name ?? '—',
    Mode: g.mode === Mode.Band ? 'Band' : 'Village',
    Population: `${g.members.length} (${c.men} men, ${c.women} women, ${c.children} children, ${c.elders} elders)`,
    Era: `${g.era} · ${ERA_NAMES[g.era] ?? '—'}`,
    Discoveries: owned.length ? owned.join(', ') : 'none yet',
    'Intelligence (potential → actual)': `${t.potInt.toFixed(0)} → ${t.int.toFixed(0)}`,
    'Cooperation (potential → actual)': `${t.potCoop.toFixed(0)} → ${t.coop.toFixed(0)}`,
    'Strength (potential → actual)': `${t.potStr.toFixed(0)} → ${t.str.toFixed(0)}`,
    'Food stock': `${f1(g.foodStock)} FU (need ${f1(g.need)} a month)`,
    Hunger: Math.round(g.hunger),
    Crowding: g.crowding.toFixed(2),
    Pressure: pressure(g).toFixed(2),
    ...(hasActive(g, Discovery.taming) || g.herd > 0 ? { Herd: `${Math.floor(g.herd)} animals` } : {}),
    ...(g.farmTiles.length > 0 ? { 'Farm tiles': g.farmTiles.length } : {}),
    Shelters: g.houses > 0 ? `${g.huts} huts, ${g.houses} houses` : `${g.huts} huts`,
    Home: `(${g.homeX}, ${g.homeY})`,
    Known: `${g.knownCount} tiles (${pct(knownInArea / Math.max(1, areaTiles))} of its area)`,
    Founded: `year ${g.foundedYear}`,
    ...(g.cannotReproduceLogged ? { Warning: "Can't have children" } : {}),
  };
}
