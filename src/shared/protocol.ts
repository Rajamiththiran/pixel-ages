// Worker message protocol (§22).

import type { LogEntry, RunSetup, YearStats } from './types';

export type Speed = 1 | 8;

export type ToWorker =
  | { type: 'start'; setup: RunSetup }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; value: Speed }
  | { type: 'step' }
  | { type: 'viewYear'; year: number }
  | { type: 'backToNow' }
  // tile coordinates; the main thread also says which person or group (if any) was clicked
  | { type: 'inspect'; x: number; y: number; personId: number | null; groupId: number | null }
  | { type: 'select'; groupId: number | null }
  | { type: 'layer'; layer: RiskLayer | null }          // F5 risk views: send this layer every year (null = stop)
  | { type: 'stop' };

export type FromWorker =
  | { type: 'started'; areas: AreaInfo[] }
  | { type: 'frame'; frame: Frame }
  | { type: 'stats'; rows: YearStats[] }               // new rows since the last message
  | { type: 'log'; entries: LogEntry[] }               // new entries since the last message
  | { type: 'inspectResult'; result: InspectResult }
  | { type: 'progress'; label: string; done: number; total: number }
  | { type: 'error'; message: string }
  | { type: 'layer'; layer: RiskLayer; data: Uint8Array };  // F5: 1 byte per tile, 0–255 risk

/** Risk views (F5 §11, future blueprint §15). */
export type RiskLayer = 'fireRisk' | 'floodRisk';

export interface AreaInfo { regionId: number; name: string; tileCount: number; centerX: number; centerY: number }

export interface Frame {
  year: number;
  month: number;
  isPast: boolean;
  liveYear: number;
  liveMonth: number;             // added: lets the UI show how far "now" is
  playing: boolean;              // added: the worker owns play state; the UI mirrors it
  speed: Speed;                  // added
  yearsPerSecond: number;
  // 8 bytes per tile: ground, plantType, plantDensity, resourceType, resourceAmount, rainNow,
  // wall | (crossing << 4), marks (F4: paths, roads, ruins, pits, canals, terraces, ash — Mark),
  // hazards (F5: burning, flooded — HazardMark)
  fullTiles?: Uint8Array;        // all tiles: on start and after a timeline jump
  tileUpdates?: Uint8Array;      // only changed tiles: [index lo, index hi, 9 bytes] repeated
  people: Float32Array;          // 8 floats per person, see below
  groups: GroupView[];
  animalDensity?: Uint8Array;    // 4 × tiles, 0–255, sent once per year and on jumps
  selectedKnown?: Uint8Array;    // known bitset of the selected group, when it changes
}
// people: [id, workX, workY, colourIndex, flags, motherId, skin * 3 + hair, action]
// flags bits: 0 sex (1 = female), 1–2 age class (0 child, 1 adult, 2 elder), 3 clothed, 4 riding

export interface GroupView {
  id: number; name: string; lineageId: number; colourIndex: number; mode: number;
  homeX: number; homeY: number; population: number; era: number;
  discoveries: number[];         // the 2 words of the discovery set (F2); read with has()
  huts: number; houses: number; herd: number; range: number;
  farms: number;                 // added: field count, so buildings are re-laid off new fields
}

export interface InspectResult {
  tile: Record<string, string | number>;
  group: Record<string, unknown> | null;
  person: Record<string, unknown> | null;
}

/** Bits of a tile's marks byte (F4): what people left on the land. */
export const Mark = { Path: 1, Road: 2, Ruin: 4, Quarry: 8, Canal: 16, Terrace: 32, Ash: 64 } as const;

/** Bits of a tile's hazards byte (F5): what is happening there right now. */
export const HazardMark = { Fire: 1, Flood: 2 } as const;

/** Bytes per tile in fullTiles / tileUpdates. */
export const TILE_BYTES = 9;
/** Bytes per entry in tileUpdates: 2-byte index + tile bytes. */
export const TILE_UPDATE_BYTES = 2 + TILE_BYTES;

export interface TileLayers {
  ground: Uint8Array; plantType: Uint8Array; plantDensity: Uint8Array;
  resourceType: Uint8Array; resourceAmount: Uint8Array; wall: Uint8Array;
}

/** Writes tile i's 9 render bytes into `out` at offset `o`. `marks` is null outside a run. */
export function packTile(
  t: TileLayers, rain: Uint8Array, crossing: Uint8Array, marks: Uint8Array | null, hazards: Uint8Array | null,
  i: number, out: Uint8Array, o: number,
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
}

/** Reads 9 render bytes at offset `o` back into tile i. */
export function unpackTile(
  src: Uint8Array, o: number, t: TileLayers, rain: Uint8Array, crossing: Uint8Array, marks: Uint8Array, hazards: Uint8Array,
  i: number,
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
}
