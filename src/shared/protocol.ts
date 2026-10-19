// Worker message protocol (§22).

import type { Intervention, LogEntry, RunSetup, YearStats } from './types';

export type Speed = 1 | 8;

export type ToWorker =
  | { type: 'start'; setup: RunSetup; headless?: boolean }  // headless (F7 Compare): no frames or keyframes
  | { type: 'runTo'; year: number }                      // headless only: run as fast as possible up to this year
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; value: Speed }
  | { type: 'step' }
  | { type: 'viewYear'; year: number }
  | { type: 'backToNow' }
  // tile coordinates; the main thread also says which person or group (if any) was clicked
  | { type: 'inspect'; x: number; y: number; personId: number | null; groupId: number | null }
  | { type: 'select'; groupId: number | null }
  | { type: 'layer'; layer: MapLayer | null }           // F5 risk views, F7 heatmaps: send this layer every year (null = stop)
  | { type: 'person'; personId: number | null }          // F7: follow this person's life story (null = stop)
  | { type: 'intervene'; intervention: Intervention }    // F7 intervention mode only: applied at the live month
  | { type: 'territory'; on: boolean }                   // F7: send territory fills every year
  | { type: 'timelapse' }                                // F8: replay the whole history fast from year 0, then pause at now
  | { type: 'stop' };

export type FromWorker =
  | { type: 'started'; areas: AreaInfo[] }
  | { type: 'frame'; frame: Frame }
  | { type: 'stats'; rows: YearStats[] }               // new rows since the last message
  | { type: 'log'; entries: LogEntry[] }               // new entries since the last message
  | { type: 'inspectResult'; result: InspectResult }
  | { type: 'progress'; label: string; done: number; total: number }
  | { type: 'error'; message: string }
  | { type: 'layer'; layer: MapLayer; data: Uint8Array }   // 1 byte per tile, 0–255 (territory: colour index + 1)
  | { type: 'person'; story: PersonStory | null }         // F7: the followed person's family and life
  | { type: 'intervened'; intervention: Intervention };   // F7: accepted, now part of the run

/** Risk views (F5 §11, future blueprint §15). */
export type RiskLayer = 'fireRisk' | 'floodRisk';
/** Every per-tile layer the worker can send (F7 heatmaps §13, plus territory fills). */
export type MapLayer = RiskLayer | 'population' | 'food' | 'era' | 'conflict' | 'fertility' | 'salinity' | 'territory';
export type HeatLayer = Exclude<MapLayer, 'territory'>;

/** F7 family tree and life story of one band person (§13). */
export interface PersonStory {
  id: number;
  alive: boolean;
  groupName: string;
  family: Array<{ role: string; id: number; alive: boolean; text: string }>;
  events: Array<{ year: number; month: number; text: string }>;
}

/** F7 relation lines between homes. */
export interface RelationView { a: number; b: number; kind: 'coexist' | 'trade' | 'war' | 'alliance' }

export interface AreaInfo { regionId: number; name: string; tileCount: number; centerX: number; centerY: number }

export interface Frame {
  year: number;
  month: number;
  isPast: boolean;
  liveYear: number;
  liveMonth: number;             // added: lets the UI show how far "now" is
  playing: boolean;              // added: the worker owns play state; the UI mirrors it
  speed: Speed;                  // added
  timelapse: boolean;            // F8: the past is being replayed fast from year 0
  yearsPerSecond: number;
  // 8 bytes per tile: ground, plantType, plantDensity, resourceType, resourceAmount, rainNow,
  // wall | (crossing << 4), marks (F4: paths, roads, ruins, pits, canals, terraces, ash — Mark),
  // hazards (F5: burning, flooded — HazardMark), look (F8: worn soil, salt, ash stage, silt — Look)
  fullTiles?: Uint8Array;        // all tiles: on start and after a timeline jump
  tileUpdates?: Uint8Array;      // only changed tiles: [index lo, index hi, 10 bytes] repeated
  people: Float32Array;          // PERSON_FLOATS per person, see below
  groups: GroupView[];
  animalDensity?: Uint8Array;    // 4 × tiles, 0–255, sent once per year and on jumps
  selectedKnown?: Uint8Array;    // known bitset of the selected group, when it changes
  relations: RelationView[];     // F7: trade, war, coexist and alliance links between groups on screen
}
// people: [id, workX, workY, colourIndex, flags, motherId, skin * 3 + hair, action, groupId (F8)]
// flags bits: 0 sex (1 = female), 1–2 age class (0 child, 1 adult, 2 elder), 3 clothed, 4 riding

export interface GroupView {
  id: number; name: string; lineageId: number; colourIndex: number; mode: number;
  homeX: number; homeY: number; population: number; era: number;
  discoveries: number[];         // the 2 words of the discovery set (F2); read with has()
  huts: number; houses: number; herd: number; range: number;
  farms: number;                 // added: field count, so buildings are re-laid off new fields
  fortification: number;         // F8 drawing: 0 none, 1 palisade, 2 stone wall (F6)
  chief: boolean;                // F8 drawing: a village with a chief gets a temple
  sick: boolean;                 // F8 drawing: an outbreak is running in this group (F5)
}

/** Floats per person in Frame.people. */
export const PERSON_FLOATS = 9;

export interface InspectResult {
  tile: Record<string, string | number>;
  group: Record<string, unknown> | null;
  person: Record<string, unknown> | null;
}

/** Bits of a tile's marks byte (F4): what people left on the land. */
export const Mark = { Path: 1, Road: 2, Ruin: 4, Quarry: 8, Canal: 16, Terrace: 32, Ash: 64 } as const;

/** Bits of a tile's hazards byte (F5): what is happening there right now. */
export const HazardMark = { Fire: 1, Flood: 2 } as const;

/**
 * The look byte (F8): bits 0–1 worn soil level, 2–3 salt level, 4–5 ash stage (2 = fresh, 1 = greening),
 * bit 6 silt (flooded this year, the water gone). Levels 0–3; thresholds in CONFIG.render.f8.look.
 */
export const Look = { wornShift: 0, saltShift: 2, ashShift: 4, Silt: 64 } as const;
export const lookLevel = (look: number, shift: number): number => (look >> shift) & 3;

/** Bytes per tile in fullTiles / tileUpdates. */
export const TILE_BYTES = 10;
/** Bytes per entry in tileUpdates: 2-byte index + tile bytes. */
export const TILE_UPDATE_BYTES = 2 + TILE_BYTES;

export interface TileLayers {
  ground: Uint8Array; plantType: Uint8Array; plantDensity: Uint8Array;
  resourceType: Uint8Array; resourceAmount: Uint8Array; wall: Uint8Array;
}

/** Writes tile i's 10 render bytes into `out` at offset `o`. `marks` (and the rest) are null outside a run. */
export function packTile(
  t: TileLayers, rain: Uint8Array, crossing: Uint8Array, marks: Uint8Array | null, hazards: Uint8Array | null,
  look: Uint8Array | null, i: number, out: Uint8Array, o: number,
): void {
  out[o] = t.ground[i]!;
  out[o + 1] = t.plantType[i]!;
  out[o + 2] = t.plantDensity[i]!;
  out[o + 3] = t.resourceType[i]!;
  out[o + 4] = t.resourceAmount[i]!;
  out[o + 5] = rain[i]!;
  out[o + 6] = t.wall[i]! | (crossing[i]! << 4);
  out[o + 7] = marks ? marks[i]! : 0;
  out[o + 8] = hazards ? hazards[i]! : 0;
  out[o + 9] = look ? look[i]! : 0;
}

/** Reads 10 render bytes at offset `o` back into tile i. */
export function unpackTile(
  src: Uint8Array, o: number, t: TileLayers, rain: Uint8Array, crossing: Uint8Array, marks: Uint8Array, hazards: Uint8Array,
  look: Uint8Array, i: number,
): void {
  t.ground[i] = src[o]!;
  t.plantType[i] = src[o + 1]!;
  t.plantDensity[i] = src[o + 2]!;
  t.resourceType[i] = src[o + 3]!;
  t.resourceAmount[i] = src[o + 4]!;
  rain[i] = src[o + 5]!;
  t.wall[i] = src[o + 6]! & 15;
  crossing[i] = src[o + 6]! >> 4;
  marks[i] = src[o + 7]!;
  hazards[i] = src[o + 8]!;
  look[i] = src[o + 9]!;
}
