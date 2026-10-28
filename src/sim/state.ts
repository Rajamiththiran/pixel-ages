// SimState (§7.3) and creating it from a RunSetup. Worker-only data.

import { CONFIG } from '../config';
import { WallType } from '../shared/ids';
import type { LogEntry, PlannedEvent, RunSetup, YearStats } from '../shared/types';
import type { Mask } from '../shared/discoveries';
import { createRng, type RngState } from '../shared/rng';
import { computeAreas, computeWallSegments } from './world/regions';
import { initClimate, updateRainNow } from './world/climate';
import { initPlantFood } from './world/plants';
import { initFish } from './world/fish';
import { initAreaAnimals } from './world/animals';
import { cellForestShares } from './world/landscape';
import { createPool, type PersonPool } from './people/persons';
import { createFounders } from './people/founders';

export interface WallSegment {
  id: number;
  type: number;                  // WallType
  health: number;
  maxHealth: number;
  breached: boolean;
  breachTile: number;            // tile last worn (where the breach opens), -1 if never worked
  breachGroup: number;           // group that wore it last, -1 if none
}

/** A representative member of a village (§7.3): keeps genes and selection working in village mode. */
export interface SampleMember {
  sex: number;                   // Sex
  ageYears: number;
  pot: [number, number, number]; // potential [int, coop, str]
  act: [number, number, number]; // actual    [int, coop, str]
}

export interface VillageData {
  // counts[sex * 6 + bucket]; buckets: 0:0–4, 1:5–14, 2:15–49, 3:50–59, 4:60–69, 5:70+
  counts: Int32Array;            // length 12
  sample: SampleMember[];        // representative people, length = sampleSize
  fed: number;                   // last month's fed ratio
  childFed: number;              // childhood nutrition, average over the last 15 years (§11.4 cn)
  childAdversity: number;        // 0–1 share of hard months (war, plague, starving) over the last 15 years (ca)
  birthsThisYear: number;        // for the yearly sample update
  deathMultSum: number;          // sum of this year's monthly group death multipliers
  deathMultMonths: number;       // months summed in deathMultSum
  shortage: boolean;             // a month this year with fed < 1
}

export interface Relation {
  a: number;                     // group id (a < b)
  b: number;
  kind: 'coexist' | 'trade' | 'war';
  sinceYear: number;
  reviewYear: number;
  pa: number;                    // pressures at the last decision (re-decide on a change > 0.3)
  pb: number;
  // A war runs until one side is worn out or it has lasted too long, then a truce (DECISIONS 20.6).
  warPopA: number;               // populations when the war began
  warPopB: number;
  warDeadA: number;              // killed in this war's battles so far
  warDeadB: number;
  truceUntil: number;            // no war between the two before this year
}

/** A hazard that lasts (F5): an outbreak (deaths × 3) or a blight (harvest × 0.3) in one group. */
export interface ActiveHazard {
  kind: number;                  // Hazard id
  groupId: number;
  endYear: number;               // runs while year < endYear
}

/** Two groups at peace allied against a much stronger third (F6 §12.7). */
export interface Alliance {
  a: number;                     // group ids, a < b
  b: number;
  against: number;               // the threatening group
  sinceYear: number;
  lastYear: number;              // last year the threat was there; the alliance lasts some years more (DECISIONS 20.8)
}

/** A language (F6 §12.5): each founder lineage has its own; long-separated groups grow new ones. */
export interface Language {
  id: number;
  name: string;
  parentId: number;              // −1 for a founder lineage's language
  sinceYear: number;
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
  parentId: number;              // the group it split or fled from (−1 for founders): close kin (DECISIONS 20.4)
  mode: number;                  // Mode id
  homeX: number;
  homeY: number;
  foundedYear: number;
  known: Uint8Array;             // bitset, ceil(width*height / 8) bytes
  knownCount: number;
  knownVersion: number;          // +1 whenever known tiles change (fog updates)
  frontier: number[];            // tile indices, kept sorted ascending
  discoveries: Mask;             // set of owned discoveries (2 words, F2)
  inactive: Mask;                // owned but missing a resource or wood
  inactiveWhy: Uint8Array;       // per discovery: what it lacks while inactive (Lack id)
  era: number;                   // 0–6
  foodStock: number;             // FU
  fedHistory: Float32Array;      // last 12 months of group average fed ratio (ring buffer)
  fedIndex: number;              // next write position in fedHistory
  wood: number;                  // stored wood units (F1)
  spareFuel: number;             // dung and straw gathered this year but not burned: kiln fuel (DECISIONS 17.6)
  metal: number;                 // stored smelted metal units: tools and weapons (F1)
  built: Mask;                   // raft, boat, cart built, by discovery id (F1)
  boatYear: number;              // year the boat was built; it wears out (F1)
  herd: number;                  // owned herd animals
  herders: number;               // last month's herders (for sustainable yield, §11.5)
  farmTiles: number[];           // tile indices, in the order farmers fill them (best first)
  hasHunted: boolean;
  // F2 (§8): practice in each activity (worker-months, fading), this year's gain, years with no gain.
  practice: Float32Array;        // by Practice id
  practiceYear: Float32Array;    // gained this year
  idleYears: Uint16Array;        // years in a row with no practice gained
  needAcc: Float32Array;         // this year's needs, summed month by month (Need id)
  needs: Float32Array;           // last year's needs, 0–1 (Need id)
  lessons: Uint16Array;          // by Hazard id: year until which its lesson lasts (0 = none)
  maintenance: number;           // F5: upkeep 0–1 of canals, levees and drains (1 = fresh works)
  // F6 (§12): society.
  specialists: number;           // share of workers who craft (0–0.15)
  chief: boolean;                // has a leader
  inequality: number;            // 0–1
  culture: Float32Array;         // by Culture id: sharing, warlike, openness (0–100)
  languageId: number;            // Language id
  kinContactYear: number;        // last year it met a group of its own language (or was founded)
  isolationYears: number;        // years since outsiders last joined (marriage, captives, absorbed)
  domestication: number;         // 0–1: how tame and productive its herd has become
  fortification: number;         // 0 none, 1 palisade, 2 stone wall
  storeMonthsSum: number;        // Σ this year's monthly food stock in months of need (specialists, chief)
  warWinsYear: number;           // battles and raids won this year (inequality)
  underThreat: boolean;          // at war or raided at the last contact: builds walls
  hungerPeak: number;            // this year's worst monthly hunger H (raids)
  huts: number;
  houses: number;                // mud-brick houses
  buildProgress: number;         // worker-months toward the next building
  hungryMonths: number;          // consecutive months over the migrate threshold
  crowdedMonths: number;         // consecutive months over the split threshold
  wantsSplit: boolean;           // split triggered this month (scouts go farther, DECISIONS 3.6)
  wallTarget: { segmentId: number; tile: number } | null;
  wallScanKey: string;           // what a fruitless wall search last saw; no rescan until it changes
  teachBonus: number;            // this year's teaching multiplier
  teacherMonths: number;         // teachers summed over this year's months
  carers: number;                // this month's carers
  cannotReproduceLogged: boolean;
  village: VillageData | null;    // only in village mode
  trading: boolean;              // traded at the last yearly contact: food × 1.05 this year
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
  farmedThisYear: Uint8Array;    // Farmed flags this year (idle farmland rule §10.2; soil and salt, F3)
  // F3 (§9): the land remembers how it was used.
  fish: Float32Array;            // fish density 0–1 on water tiles
  fertility: Float32Array;       // soil fertility 0–1 (fields wear out, rest restores)
  salinity: Float32Array;        // salt 0–1 left by irrigation without drainage
  animalLowYears: Uint8Array;    // [species × tiles]: years in a row below extinctBelow (deer, goats, horses)
  areaAnimals: Uint8Array;       // [area × 4 + species]: 1 if the species lived in the area last year
  // F4 (§10): people change the land.
  elevation: Uint8Array;         // painted height 0–9 (D7); never changes, shared like the setup
  wear: Uint8Array;              // path wear 0–255 (walking); fades 20% a year
  roadOK: Uint8Array;            // 1 if walked by a group with the Wheel this year (a road at high wear)
  ruinAge: Uint16Array;          // years since a settlement here was abandoned (0 = no ruin)
  quarry: Uint8Array;            // 1 = a used-up deposit left a pit
  canal: Uint8Array;             // 1 = an irrigation canal this year
  terrace: Uint8Array;           // 1 = terraced slope (kept once built)
  ash: Uint8Array;               // years of ash left after a burn
  bareYears: Uint8Array;         // years a grazed-bare dry tile has stayed bare (desert clock)
  cellForest0: Float32Array;     // forest share of each climate cell at the start (never changes)
  dryCells: Uint8Array;          // 1 = this climate cell lost its forest: rain × 0.9
  // F5 (§11): hazards.
  fireState: Uint8Array;         // months a tile still burns (0 = not burning)
  floodMonths: Uint8Array;       // months of standing flood water
  weatherYear: Float32Array;     // per climate cell: this year's rain anomaly (−0.8…1.5)
  hazardsActive: ActiveHazard[]; // outbreaks and blights running, sorted by (groupId, kind)
  climate: Float32Array;       // cellsX × cellsY drift values
  driftMult: Float32Array;       // per tile, interpolated from `climate` once a year

  groups: Group[];               // always sorted by id
  nextGroupId: number;
  lineages: Lineage[];           // sorted by id
  persons: PersonPool;           // band-mode people only
  relations: Relation[];         // sorted by (a, b)
  lineagesMet: number[];         // lineage pairs that have met (lo × 65536 + hi), sorted
  alliances: Alliance[];         // F6: sorted by (a, b, against)
  languages: Language[];         // F6: sorted by id
  nextLanguageId: number;

  activeEvents: ActiveEvent[];
  log: LogEntry[];
  logDropped: number;            // entries dropped from the front of `log` (cap §21.3)
  logQuiet: Map<string, number>; // repeat-prone log lines: key → year last logged (DECISIONS 20.9)
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
      id, type, health: WALL_HEALTH[type]!, maxHealth: WALL_HEALTH[type]!, breached: false, breachTile: -1, breachGroup: -1,
    })),
    dryYears: new Uint16Array(n),
    wetYears: new Uint16Array(n),
    farmIdleYears: new Uint8Array(n),
    farmedThisYear: new Uint8Array(n),
    fish: new Float32Array(n),
    fertility: new Float32Array(n).fill(1),
    salinity: new Float32Array(n),
    animalLowYears: new Uint8Array(4 * n),
    areaAnimals: new Uint8Array(4 * areas.count),
    elevation: m.elevation,
    wear: new Uint8Array(n),
    roadOK: new Uint8Array(n),
    ruinAge: new Uint16Array(n),
    quarry: new Uint8Array(n),
    canal: new Uint8Array(n),
    terrace: new Uint8Array(n),
    ash: new Uint8Array(n),
    bareYears: new Uint8Array(n),
    cellForest0: cellForestShares(m.width, m.height, m.plantType, m.plantDensity),
    dryCells: new Uint8Array(CONFIG.climate.cellsX * CONFIG.climate.cellsY),
    fireState: new Uint8Array(n),
    floodMonths: new Uint8Array(n),
    weatherYear: new Float32Array(CONFIG.climate.cellsX * CONFIG.climate.cellsY),
    hazardsActive: [],
    climate: new Float32Array(CONFIG.climate.cellsX * CONFIG.climate.cellsY),
    driftMult: new Float32Array(n),
    groups: [],
    nextGroupId: 1,
    lineages: [],
    persons: createPool(),
    relations: [],
    lineagesMet: [],
    alliances: [],
    languages: [],
    nextLanguageId: 1,
    activeEvents: [],
    log: [],
    logDropped: 0,
    logQuiet: new Map(),
    stats: [],
  };
  initClimate(s);
  updateRainNow(s);
  // Plants start full, as if the painted world had been growing for a long time.
  initPlantFood(s);
  initFish(s);
  initAreaAnimals(s);
  createFounders(s);
  return s;
}
