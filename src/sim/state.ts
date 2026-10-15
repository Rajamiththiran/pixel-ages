// SimState (§7.3) and creating it from a RunSetup. Worker-only data.
// Villages and relations between groups are added in step 5.

import { CONFIG } from '../config';
import { WallType } from '../shared/ids';
import type { LogEntry, PlannedEvent, RunSetup, YearStats } from '../shared/types';
import { createRng, type RngState } from '../shared/rng';
import { computeAreas, computeWallSegments } from './world/regions';
import { initClimate, updateRainNow } from './world/climate';
import { initPlantFood } from './world/plants';
import { createPool, type PersonPool } from './people/persons';
import { createFounders } from './people/founders';

export interface WallSegment {
  id: number;
  type: number;                  // WallType
  health: number;
  maxHealth: number;
  breached: boolean;
}

export interface ActiveEvent {
  event: PlannedEvent;
  areaRoot: number;              // region root id (or -1 for whole map)
  endYear: number;
}

export interface Lineage {
  id: number;                    // = founder group id
  name: string;
  colorIndex: number;
  extinctYear: number | null;
  splitCounter: number;          // for naming "Desert 2", "Desert 3"…
}

export interface Group {
  id: number;
  name: string;
  lineageId: number;
  mode: number;                  // Mode id
  homeX: number;
  homeY: number;
  foundedYear: number;
  known: Uint8Array;             // bitset, ceil(width*height / 8) bytes
  knownCount: number;
  knownVersion: number;          // +1 whenever known tiles change (fog updates)
  frontier: number[];            // tile indices, kept sorted ascending
  discoveries: number;           // bitmask (bit = discovery id)
  inactive: number;              // bitmask: owned but missing resource
  era: number;                   // 0–6
  belowLimitYears: Uint8Array;   // per discovery, years under forget limit
  foodStock: number;             // FU
  fedHistory: Float32Array;      // last 12 months of group average fed ratio (ring buffer)
  fedIndex: number;              // next write position in fedHistory
  herd: number;                  // owned herd animals
  herders: number;               // last month's herders (for sustainable yield, §11.5)
  farmTiles: number[];           // tile indices, in the order farmers fill them (best first)
  hasHunted: boolean;
  huts: number;
  houses: number;                // mud-brick houses
  buildProgress: number;         // worker-months toward the next building
  hungryMonths: number;          // consecutive months over the migrate threshold
  crowdedMonths: number;         // consecutive months over the split threshold
  wantsSplit: boolean;           // split triggered this month (scouts go farther, DECISIONS 3.6)
  wallTarget: { segmentId: number; tile: number } | null; // step 5
  teachBonus: number;            // this year's teaching multiplier
  teacherMonths: number;         // teachers summed over this year's months
  carers: number;                // this month's carers
  cannotReproduceLogged: boolean;
  village: null;                 // VillageData in step 5
  members: number[];             // pool slots, ascending by person id
  // Signals computed at the start of each month (§11.5), used by the brain and inspector.
  need: number;                  // FU per month
  hunger: number;                // H, 0–100
  plantAvail: number;            // PA
  preyAvail: number;             // YA
  sustainable: number;           // sustainable yield of the range, FU/month
  crowding: number;
  lowestFed: number;             // lowest fed ratio in the group last month
  fedYearSum: number;            // for yearly stats
}

export interface SimState {
  year: number;                  // starts at 0
  month: number;                 // 0–11
  rng: RngState;
  setup: RunSetup;               // original, read-only (shared between keyframes, never copied)
  width: number;
  height: number;

  // tiles (mutable copies of MapData layers + live data)
  ground: Uint8Array;
  plantType: Uint8Array;
  plantDensity: Uint8Array;
  plantFood: Float32Array;       // FU stock per tile
  resourceType: Uint8Array;
  resourceAmount: Uint8Array;
  baseRain: Uint8Array;          // painted rain
  rainNow: Uint8Array;           // after drift and events
  animal: [Float32Array, Float32Array, Float32Array, Float32Array]; // density 0–1
  wall: Uint8Array;
  crossing: Uint8Array;          // 1 = breached, passable
  regionId: Int32Array;          // -1 on intact wall tiles
  regionParent: Int32Array;      // union-find over region ids (crossings merge regions)
  originalRegionId: Int32Array;  // regions at run start; planned events keep this shape (§15)
  wallSegmentId: Int32Array;     // -1 if not a wall
  wallSegments: WallSegment[];
  dryYears: Uint16Array;         // ground change counters
  wetYears: Uint16Array;
  farmIdleYears: Uint8Array;
  farmedThisYear: Uint8Array;    // 1 if a farmer worked the tile this year (idle farmland rule, §10.2)
  climate: Float32Array;       // cellsX × cellsY drift values
  driftMult: Float32Array;       // per tile, interpolated from `climate` once a year

  groups: Group[];               // always sorted by id
  nextGroupId: number;
  lineages: Lineage[];           // sorted by id
  persons: PersonPool;           // band-mode people only

  activeEvents: ActiveEvent[];
  log: LogEntry[];
  logDropped: number;            // entries dropped from the front of `log` (cap §21.3)
  stats: YearStats[];
}

const WALL_HEALTH: Record<number, number> = {
  [WallType.River]: CONFIG.walls.health.river,
  [WallType.Mountain]: CONFIG.walls.health.mountain,
  [WallType.Sea]: CONFIG.walls.health.sea,
};

export function createState(setup: RunSetup): SimState {
  const m = setup.map;
  const n = m.width * m.height;
  const areas = computeAreas(m.wall, m.width, m.height);
  const segs = computeWallSegments(m.wall, m.width, m.height);
  const regionParent = new Int32Array(areas.count);
  for (let r = 0; r < areas.count; r++) regionParent[r] = r;

  const animal: SimState['animal'] = [
    new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n),
  ];
  for (let s = 0; s < 4; s++) {
    const src = m.animals[s]!;
    const dst = animal[s]!;
    for (let i = 0; i < n; i++) dst[i] = src[i]! / 255;
  }

  const s: SimState = {
    year: 0,
    month: 0,
    rng: createRng(setup.seed >>> 0),
    setup,
    width: m.width,
    height: m.height,
    ground: m.ground.slice(),
    plantType: m.plantType.slice(),
    plantDensity: m.plantDensity.slice(),
    plantFood: new Float32Array(n),
    resourceType: m.resourceType.slice(),
    resourceAmount: m.resourceAmount.slice(),
    baseRain: m.rain.slice(),
    rainNow: new Uint8Array(n),
    animal,
    wall: m.wall.slice(),
    crossing: new Uint8Array(n),
    regionId: areas.regionId,
    regionParent,
    originalRegionId: areas.regionId.slice(),
    wallSegmentId: segs.segmentId,
    wallSegments: segs.types.map((type, id) => ({
      id, type, health: WALL_HEALTH[type]!, maxHealth: WALL_HEALTH[type]!, breached: false,
    })),
    dryYears: new Uint16Array(n),
    wetYears: new Uint16Array(n),
    farmIdleYears: new Uint8Array(n),
    farmedThisYear: new Uint8Array(n),
    climate: new Float32Array(CONFIG.climate.cellsX * CONFIG.climate.cellsY),
    driftMult: new Float32Array(n),
    groups: [],
    nextGroupId: 1,
    lineages: [],
    persons: createPool(),
    activeEvents: [],
    log: [],
    logDropped: 0,
    stats: [],
  };
  initClimate(s);
  updateRainNow(s);
  // Plants start full, as if the painted world had been growing for a long time.
  initPlantFood(s);
  createFounders(s);
  return s;
}
