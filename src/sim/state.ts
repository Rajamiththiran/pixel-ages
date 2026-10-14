// SimState (§7.3) and creating it from a RunSetup. Worker-only data.
// Step 2 holds the world (tiles, climate, plants, animals). People, groups, lineages and
// relations are added in step 3+.

import { CONFIG } from '../config';
import { WallType } from '../shared/ids';
import type { LogEntry, PlannedEvent, RunSetup, YearStats } from '../shared/types';
import { createRng, type RngState } from '../shared/rng';
import { computeAreas, computeWallSegments } from './world/regions';
import { initClimate, updateRainNow } from './world/climate';
import { initPlantFood } from './world/plants';

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
  climate: Float32Array;         // cellsX × cellsY drift values
  driftMult: Float32Array;       // per tile, interpolated from `climate` once a year

  activeEvents: ActiveEvent[];
  log: LogEntry[];
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
    climate: new Float32Array(CONFIG.climate.cellsX * CONFIG.climate.cellsY),
    driftMult: new Float32Array(n),
    activeEvents: [],
    log: [],
    stats: [],
  };
  initClimate(s);
  updateRainNow(s);
  // Plants start full, as if the painted world had been growing for a long time.
  initPlantFood(s);
  return s;
}
