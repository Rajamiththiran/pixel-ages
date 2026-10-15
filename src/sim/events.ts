// Planned events (§15): set up before the run, they start and end on fixed years. An event's
// area is the area its `at` tile had when the run started, so it keeps its shape after breaches.

import { CONFIG } from '../config';
import { Season, SPECIES_NAMES, WALL_NAMES } from '../shared/ids';
import { Discovery } from '../shared/discoveries';
import type { PlannedEvent } from '../shared/types';
import type { ActiveEvent, Group, SimState } from './state';
import { areaName } from './world/regions';
import { hasActive } from './people/explore';
import { logEvent, population } from './people/groups';
import { openBreach } from './society/walls';

const EV = CONFIG.events;

const tileOf = (s: SimState, at: { x: number; y: number }): number => at.y * s.width + at.x;

/** The (original) area an event's `at` tile is in; −1 for whole-map events or an invalid tile. */
export function eventArea(s: SimState, ev: PlannedEvent): number {
  if (!('at' in ev) || ev.kind === 'earthquake') return -1;
  const { x, y } = ev.at;
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return -1;
  return s.originalRegionId[tileOf(s, ev.at)]!;
}

/** First year and the year after the last: [start, end). Instant events last their one year. */
export function eventYears(ev: PlannedEvent): { start: number; end: number } {
  switch (ev.kind) {
    case 'drought':
    case 'wetPeriod':
    case 'harshWinters':
      return { start: ev.startYear, end: ev.startYear + Math.max(1, ev.lengthYears) };
    case 'plague':
      return { start: ev.startYear, end: ev.startYear + EV.plagueMinYears + Math.round((EV.plagueExtraYears * ev.strength) / 100) };
    case 'animalDieOff':
    case 'earthquake':
      return { start: ev.year, end: ev.year + 1 };
  }
}

const KIND_NAMES: Record<PlannedEvent['kind'], string> = {
  drought: 'Drought', wetPeriod: 'Wet period', plague: 'Plague', harshWinters: 'Harsh winters',
  animalDieOff: 'Animal die-off', earthquake: 'Earthquake',
};

/** "Drought in Area 2 (strength 70)" */
export function describeEvent(ev: PlannedEvent, area: number): string {
  const where = area >= 0 ? ` in ${areaName(area)}` : '';
  switch (ev.kind) {
    case 'drought':
    case 'wetPeriod':
    case 'plague':
      return `${KIND_NAMES[ev.kind]}${where} (strength ${ev.strength})`;
    case 'harshWinters':
      return KIND_NAMES[ev.kind];
    case 'animalDieOff':
      return `${SPECIES_NAMES[ev.species]} die-off${where}`;
    case 'earthquake':
      return `Earthquake at (${ev.at.x}, ${ev.at.y})`;
  }
}

/**
 * Monthly step 1 (§5.1). At month 0: events whose time is up end, events that begin this
 * year start (in setup order), and instant ones (die-off, earthquake) strike.
 */
export function updateEvents(s: SimState): void {
  if (s.month !== 0) return;
  const ending = s.activeEvents.filter((a) => a.endYear <= s.year);
  if (ending.length > 0) {
    s.activeEvents = s.activeEvents.filter((a) => a.endYear > s.year);
    for (const a of ending) {
      logEvent(s, 'event', `Planned event: ${describeEvent(a.event, a.areaRoot)} ended`, null, null, ...eventXY(a.event));
    }
  }
  for (const ev of s.setup.events) {
    const { start, end } = eventYears(ev);
    if (start !== s.year) continue;
    const area = eventArea(s, ev);
    if (ev.kind === 'animalDieOff') {
      dieOff(s, area, ev.species);
      logEvent(s, 'event', `Planned event: ${describeEvent(ev, area)}`, null, null, ev.at.x, ev.at.y);
    } else if (ev.kind === 'earthquake') {
      const tile = tileOf(s, ev.at);
      const wall = s.wall[tile]!;
      openBreach(s, tile);
      logEvent(s, 'event', `Planned event: an earthquake broke the ${WALL_NAMES[wall]} wall at (${ev.at.x}, ${ev.at.y})`, null, null, ev.at.x, ev.at.y);
    } else {
      s.activeEvents.push({ event: ev, areaRoot: area, endYear: end });
      logEvent(s, 'event', `Planned event: ${describeEvent(ev, area)} began`, null, null, ...eventXY(ev));
    }
  }
}

const eventXY = (ev: PlannedEvent): [number | null, number | null] => ('at' in ev ? [ev.at.x, ev.at.y] : [null, null]);

/** Animal die-off: that species' density × 0.2 on every tile of the area. */
function dieOff(s: SimState, area: number, species: number): void {
  const d = s.animal[species]!;
  for (let i = 0; i < d.length; i++) if (s.originalRegionId[i] === area) d[i] = d[i]! * EV.dieOffMult;
}

/** Strength now of a drought or wet period: half in its first and last year (§10.1). */
function rampedStrength(a: ActiveEvent, year: number): number {
  const ev = a.event as Extract<PlannedEvent, { strength: number }>;
  const { start, end } = eventYears(ev);
  const half = year - start < EV.rampYears || end - 1 - year < EV.rampYears;
  return (ev.strength / 100) * (half ? 0.5 : 1);
}

/**
 * Rain multiplier per tile from droughts and wet periods this year, or null when none is
 * active (most of the time). Several events on one area multiply.
 */
export function eventRainMult(s: SimState): Float32Array | null {
  const rainEvents = s.activeEvents.filter((a) => a.event.kind === 'drought' || a.event.kind === 'wetPeriod');
  if (rainEvents.length === 0) return null;
  const mult = new Float32Array(s.width * s.height).fill(1);
  for (const a of rainEvents) {
    const k = rampedStrength(a, s.year);
    const f = a.event.kind === 'drought' ? 1 - k : 1 + k;
    for (let i = 0; i < mult.length; i++) if (s.originalRegionId[i] === a.areaRoot) mult[i] = mult[i]! * f;
  }
  return mult;
}

/** Harsh winters are on and this is a winter month. */
export function harshWinterNow(s: SimState): boolean {
  if (CONFIG.seasonOfMonth[s.month % 12] !== Season.Winter) return false;
  return s.activeEvents.some((a) => a.event.kind === 'harshWinters');
}

/** The group's home is in an area with an active plague. */
export function plagued(s: SimState, g: Group): boolean {
  const area = s.originalRegionId[g.homeY * s.width + g.homeX]!;
  return area >= 0 && s.activeEvents.some((a) => a.event.kind === 'plague' && a.areaRoot === area);
}

/**
 * Extra monthly death multiplier from events (§15): plague × (1 + (s/50) × clamp(pop/150, 0.2, 2)
 * × (Taming ? 1.5 : 1)) — crowded settlements with livestock suffer most — and, in a harsh
 * winter, × 1.5 without Fire and × 1.2 without Clothing.
 */
export function eventDeathMult(s: SimState, g: Group): number {
  let mult = 1;
  const area = s.originalRegionId[g.homeY * s.width + g.homeX]!;
  for (const a of s.activeEvents) {
    if (a.event.kind !== 'plague' || area < 0 || a.areaRoot !== area) continue;
    const density = Math.min(EV.plagueDensityMax, Math.max(EV.plagueDensityMin, population(g) / EV.plagueDensityPop));
    mult *= 1 + (a.event.strength / 50) * density * (hasActive(g, Discovery.taming) ? EV.plagueTamingMult : 1);
  }
  if (harshWinterNow(s)) {
    if (!hasActive(g, Discovery.fire)) mult *= EV.harshWinterNoFireMult;
    if (!hasActive(g, Discovery.clothing)) mult *= EV.harshWinterNoClothingMult;
  }
  return mult;
}

/** Problems with one planned event (§15 setup validation), as messages. Empty when valid. */
export function validateEvent(
  ev: PlannedEvent, map: { width: number; height: number; wall: Uint8Array }, regionId: Int32Array,
): string[] {
  const errs: string[] = [];
  const yearOk = (y: number): boolean => Number.isInteger(y) && y >= 0 && y <= EV.maxYear;
  const start = 'startYear' in ev ? ev.startYear : ev.year;
  if (!yearOk(start)) errs.push(`The year must be 0–${EV.maxYear.toLocaleString('en-US')}.`);
  if ('lengthYears' in ev && (!Number.isInteger(ev.lengthYears) || ev.lengthYears < 1 || ev.lengthYears > EV.maxYear)) {
    errs.push('The length must be at least 1 year.');
  }
  if ('strength' in ev && (!Number.isInteger(ev.strength) || ev.strength < 1 || ev.strength > 100)) {
    errs.push('The strength must be 1–100.');
  }
  if ('at' in ev) {
    const { x, y } = ev.at;
    const inside = Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
    const i = y * map.width + x;
    if (ev.kind === 'earthquake') {
      if (!inside || map.wall[i] === 0) errs.push('Pick a wall tile for the earthquake.');
    } else if (!inside || regionId[i]! < 0) {
      errs.push('Pick an area on the map.');
    }
  }
  return errs;
}
