import type { Sex, Species } from './ids';

// Shared interfaces (§7.2). SimState and friends (§7.3) arrive in step 2+.

export interface MapData {
  version: 3;                    // 3 since F4 (elevation); 2 added Tin and Salt (F1); older files still load
  width: number;                 // 160
  height: number;                // 90
  ground: Uint8Array;            // Ground id per tile
  plantType: Uint8Array;         // Plant id (painted: Forest, FruitBushes, Grass)
  plantDensity: Uint8Array;      // 0–255
  resourceType: Uint8Array;      // Resource id
  resourceAmount: Uint8Array;    // 0–255 units
  rain: Uint8Array;              // 0–100, base rain as painted
  animals: [Uint8Array, Uint8Array, Uint8Array, Uint8Array]; // painted density 0–255 per Species
  wall: Uint8Array;              // WallType id
  elevation: Uint8Array;         // F4 (D7): height 0–9, painted; 0 everywhere in older files
}

export interface FounderPerson {
  sex: Sex;
  age: number;                   // years
  intelligence: number;          // 60–160
  cooperation: number;           // 0–100
  strength: number;              // 0–100
}

export interface FounderGroup {
  id: number;                    // 1, 2, 3… (also the lineage id)
  name: string;                  // e.g. "Desert"
  colorIndex: number;            // index into GROUP_COLORS (§18.1)
  x: number;                     // home tile
  y: number;
  people: FounderPerson[];
}

export type PlannedEvent =
  | { kind: 'drought';      at: { x: number; y: number }; startYear: number; lengthYears: number; strength: number }
  | { kind: 'wetPeriod';    at: { x: number; y: number }; startYear: number; lengthYears: number; strength: number }
  | { kind: 'plague';       at: { x: number; y: number }; startYear: number; strength: number }
  | { kind: 'harshWinters'; startYear: number; lengthYears: number }
  | { kind: 'animalDieOff'; at: { x: number; y: number }; year: number; species: Species }
  | { kind: 'earthquake';   at: { x: number; y: number }; year: number };
// `at` is any tile inside the chosen area (resolved to an area when the run starts),
// or, for earthquake, a wall tile.

export type ClimateDrift = 'off' | 'slow' | 'strong';

export interface LogEntry {
  year: number;
  month: number;
  type: LogType;
  groupId: number | null;
  otherId: number | null;
  lineageId: number | null;
  text: string;                  // ready to display
  x: number | null;
  y: number | null;
}

export type LogType =
  | 'discovery' | 'lostDiscovery' | 'eraUp' | 'eraDown' | 'ranOut'
  | 'split' | 'migrate' | 'becameVillage' | 'becameBand'
  | 'firstContact' | 'tradeStart' | 'war' | 'conquered' | 'absorbed' | 'raid' | 'alliance' | 'society'
  | 'breach' | 'event' | 'animalsGone' | 'hazard' | 'groupExtinct' | 'lineageExtinct' | 'cannotReproduce' | 'perf';

export interface YearStats {
  year: number;
  perLineage: Array<{
    lineageId: number;
    population: number;
    groups: number;
    bestEra: number;
    avgEra: number;
    intActual: number;  intPotential: number;
    coopActual: number; coopPotential: number;
    strActual: number;  strPotential: number;
    fed: number;                 // average fed ratio this year
    discoveries: number[];       // union of the lineage's discovery sets (2 words, F2)
  }>;
}

export interface RunSetup {
  version: 3;                    // see MapData.version
  name: string;
  map: MapData;
  founders: FounderGroup[];
  events: PlannedEvent[];
  seed: number;                  // uint32
  climateDrift: ClimateDrift;
}
