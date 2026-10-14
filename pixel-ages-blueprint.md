# Pixel Ages — Full Game Blueprint (v1.0)

*Working title, rename anytime. Design locked with the owner (Vinush) on 14 October 2026.*

This document is the complete plan for building the game. It is written for **Claude Code** (the builder) and for the **owner** (who decides). Every rule, number, sprite, screen and build step is here.

---

## Contents

0. Read this first — rules for Claude Code
1. The game in one page
2. Locked decisions
3. Glossary
4. Tech stack and project setup
5. Architecture
6. Folder structure
7. Data model
8. World and map
9. Time
10. Environment simulation
11. People
12. Discoveries and eras
13. Walls and breaching
14. Contact between groups
15. Planned events
16. Randomness, seeds and determinism
17. Timeline (past view) and saving
18. Rendering
19. Sprite spec sheet
20. UI and controls
21. Results: inspector, graphs, event log
22. Worker message protocol
23. `config.ts` — every tunable number
24. Build plan — 7 steps with acceptance criteria
25. Testing
26. Test scenarios and tuning goals
27. Out of scope for v1
28. Definition of done

---

## 0. Read this first — rules for Claude Code

1. **This file is the single source of truth.** Read it fully before writing any code.
2. **Build in the 7 steps of §24, in order.** Finish a step, run its tests, show the result, then **stop and let the owner try it** before starting the next step. Do not build features from later steps early (empty interfaces/stubs are fine).
3. **Every tunable number lives in `src/config.ts` (§23).** Never hard-code a tunable number anywhere else. If you need a new number, add it to `config.ts` with a comment.
4. **The simulation must be deterministic (§16).** Inside `src/sim/` never use `Math.random`, `Date`, `performance.now`, `Math.pow`, `Math.exp`, `Math.log`, `Math.sin`, `Math.cos`, or `**` with non-integer exponents. Use the seeded RNG and the helpers in `src/shared/`.
5. **Simulation code never touches the DOM or Canvas. Rendering code never changes simulation state.** The simulation runs in a Web Worker.
6. **Dependencies:** only Vite, TypeScript and Vitest. Ask the owner before adding any other package.
7. **If something here is ambiguous or contradicts itself, ask the owner. Do not guess.** If you see a better way that keeps the same behaviour, propose it before doing it.
8. Create a `CLAUDE.md` in the repo root that copies rules 1–7 and links to this file.
9. Units used everywhere: **1 tile = 1 km**, **1 tick = 1 month**, **1 FU (food unit) = food one adult eats in one month**.
10. Code style: TypeScript `strict`, small pure functions, short comments that explain *why*. No classes for hot data (people, tiles) — use typed arrays (struct-of-arrays).

---

## 1. The game in one page

**Pixel Ages** is a browser-based, top-down pixel **god-sim experiment**.

1. You **paint a world**: ground, plants, resources, rain, animals and walls.
2. You **place small groups of people** and choose their traits: intelligence, cooperation, strength.
3. You **schedule events** (drought, plague, harsh winters…), pick a **seed**, and press **Run**.
4. Then you **watch, hands-off**. Each group explores, finds resources, makes discoveries, grows from a small band into villages and cities, meets other groups, trades, wars, absorbs others, or collapses — over up to **10,000 years**.
5. You compare results with graphs, an event log, and a timeline you can scroll back through.

**The owner's example experiment:** two areas separated by a river wall. Rich forest land gets 4 people (2 men, 2 women) with intelligence 70. The desert gets 4 people with intelligence 140. Run with seed 48213 and compare year 300 and year 10,000. Then change only one thing, keep the same seed, and run again.

**The core loop:**

```
explore → find resources → make discoveries → new abilities (food, survival, movement)
   ↑                                                        ↓
meet others (trade / war / absorb) ← grow, split, migrate ← more people
```

**What "real" means here:** rules are built on real-world patterns — forager birth/death rates, Dunbar's number (150), nature + nurture for traits, farming feeding far more people per km² than foraging, disease hitting dense settlements with livestock. They are simplified models, never claimed to be exact science.

**Note on intelligence:** intelligence is a game stat on an IQ-like scale (100 = baseline). It controls game rules only and does not model any real human population.

---

## 2. Locked decisions

These were decided with the owner. Do not change them without asking.

| # | Topic | Decision |
|---|---|---|
| 1 | Genre | Top-down pixel god-sim, hands-off experiment |
| 2 | Platform | Desktop web browser only. For the owner first, then free on itch.io |
| 3 | Tech | TypeScript + HTML Canvas 2D, no engine. Simulation in a Web Worker |
| 4 | Focus | People are the heart. Materials are simple tile layers |
| 5 | Map | 160 × 90 tiles, 1 tile = 1 km, 8×8 px tiles, whole map fits 1280×720, optional 2× zoom |
| 6 | Map making | Player paints everything with brushes (drag, brush size, fill bucket, eraser, undo). Maps saved as presets |
| 7 | Layers | Ground (Grassland, Desert, Water, Mountain) · Plants (Forest, Fruit bushes, Grass) · Resources (Stone, Clay, Copper, Iron) · Rain 0–100 · Animals (Prey, Predator, Herd, Riding) · Walls (River, Mountain, Sea) · People |
| 8 | Living world | Plants and animals react to rain and people. Climate drift setting: off / slow / strong |
| 9 | Simulation model | Hybrid: individuals while a group is under 150; village record at 150+; back to individuals below 100 |
| 10 | Traits | Intelligence 60–160 (setup), Cooperation 0–100, Strength 0–100 |
| 11 | Inheritance | Genes + environment: inherited potential, actual trait shaped by food, safety and knowledge |
| 12 | Brain | Needs + scores (utility AI) for individuals and villages |
| 13 | Birth/death | Age-based, real forager numbers. Each person has age and sex |
| 14 | Knowledge of map | Each group only knows tiles it has explored |
| 15 | Development | Era ladder (6 eras) + 19 discoveries tied to resources the group has found |
| 16 | Discovery | Yearly chance, only after the needed resource is found. Can be forgotten |
| 17 | Walls | Natural barriers. Need a discovery, then health worn down only under pressure |
| 18 | Contact | Stats decide: war, trade, absorb (or coexist) |
| 19 | Animals | Stored as density numbers per tile. Used via hunting, taming, herding, riding |
| 20 | Time | Tick = 1 month. 1 sec = 1 year by default, optional 8× button, pause, step |
| 21 | Past | Timeline slider to view any past year. View only — the past cannot be changed |
| 22 | Player role | Hands-off during the run. Planned events set before the run |
| 23 | Events | Drought, Wet period, Plague, Harsh winters, Animal die-off, Earthquake |
| 24 | Repeatable | Seed number. Same setup + same seed = same history |
| 25 | Results | Inspect panel, graphs per lineage, event log (click → jump to year) |
| 26 | Art | Terrain = color + grain, drawn in code. People, animals, buildings = rough pixel sprites (§19) |
| 27 | Sizes | Tiles 8×8, adults 4×6, children 3×4, animals 5×4 to 7×5, buildings 8×8 to 16×24 |
| 28 | Build order | 1 Map → 2 Living world → 3 People → 4 Discoveries → 5 Villages, walls, contact → 6 Events, graphs → 7 Tune + publish |

---

## 3. Glossary

| Term | Meaning |
|---|---|
| Tile | One map cell, 1 km × 1 km, drawn as 8×8 px |
| Area | A region of tiles fully enclosed by walls / map edges. Computed, never painted |
| Wall | A painted barrier tile: River, Mountain or Sea |
| Wall segment | A connected set of wall tiles of the same type. Has one health value |
| Crossing | Wall tiles opened by a breach. Passable for everyone |
| Group | A set of people living together with one home tile |
| Band | A group in individual mode (under 150 people, each person simulated) |
| Village | A group in village mode (150+ people, simulated as counts + a sample) |
| Lineage | All groups descended from one founder group (by splitting). Graphs are per lineage |
| Founder group | A group the player placed at setup |
| Home | The group's home tile (camp or village centre) |
| Range | All tiles within the forage radius `R` of home |
| Known tiles | The tiles a group has seen. Only known tiles can be used |
| Frontier | Unknown tiles next to known passable tiles — where exploring happens |
| FU | Food unit = what one adult eats in one month |
| Tick | One month of simulation |
| Potential | Inherited trait value (genes) |
| Actual | Trait value after environment (used by all rules) |
| H (hunger) | Group food pressure, 0–100 |
| Crowding | Food needed ÷ food the range can sustainably give |
| Pressure | 0–1 measure of need: hunger, crowding or missing resources |
| Keyframe | A full saved copy of the simulation state, used for the timeline |
| Seed | A number that fixes all randomness in a run |

---

## 4. Tech stack and project setup

- **Vite** (current stable) + **TypeScript** (`strict: true`) + **Vitest**.
- No game engine, no UI framework. DOM elements for panels and dialogs; Canvas 2D for the map and graphs.
- Simulation in a **module Web Worker**.
- Target browsers: current desktop Chrome, Edge, Firefox. Minimum window: **1680 × 820**.

```bash
npm create vite@latest pixel-ages -- --template vanilla-ts
cd pixel-ages
npm install
npm install -D vitest
```

`package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',              // relative paths so the build works on itch.io
  worker: { format: 'es' },
});
```

`tsconfig.json` essentials: `"strict": true`, `"target": "ES2022"`, `"lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]`, `"isolatedModules": true`.

**Do not use TypeScript `enum` or `const enum`.** Use `as const` objects (see §7) — they work cleanly with Vite's per-file compiling.

Creating the worker:

```ts
const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
```

---

## 5. Architecture

```
 MAIN THREAD                                         WORKER THREAD
┌───────────────────────────┐    commands     ┌──────────────────────────┐
│ UI panels (DOM)           │ ──────────────► │ Sim loop (ticks)         │
│ Editor (painting, setup)  │                 │ SimState (live)          │
│ Renderer (Canvas 2D)      │ ◄────────────── │ Timeline (keyframes)     │
│ Visual animation state    │    frames       │ Stats + event log        │
└───────────────────────────┘                 └──────────────────────────┘
```

**Ownership rules**

- **Setup mode:** the map and setup live on the main thread (the editor owns them). Nothing runs in the worker.
- **Run:** main sends the full `RunSetup` to the worker. From then on the worker owns all simulation state. Main only sends commands (play, pause, speed, view year, inspect) and draws the frames it receives.
- **Rendering** runs on `requestAnimationFrame` (60 fps). It draws the latest frame and animates sprites smoothly between simulation ticks (§18.6). Visual-only randomness (sprite wandering) may use `Math.random` because it never feeds back into the simulation.

### 5.1 Exact tick order (one month)

Order matters for determinism. Always process groups in **ascending group id**, and people in **ascending person id**.

**Every month:**

1. Activate / deactivate planned events whose start or end is this month (§15).
2. Update current rain for every tile (§10.1).
3. Plants: regenerate food stock (§10.2).
4. Animals: growth, predation, diffusion (§10.4).
5. For each group:
   - **Band:** pairing → brain decisions → do actions (produce food, explore, build, wall work, care, teach, rest) → spoilage → food distribution → births → deaths → aging → health update.
   - **Village:** labour allocation → produce → explore / wall work / build → spoilage → distribution → births → deaths → aging.
6. Wall breach checks (§13).
7. Mode switches: band ≥ 150 → village; village < 100 → band (§11.10).
8. Migration and split checks (§11.8).
9. Advance month. If month becomes 12 → run the **yearly steps**, then set month = 0 and year += 1.

**Every year (after month 11):**

1. Climate drift update (§10.1).
2. Plant spread / death, ground change counters (§10.2, §10.3).
3. Resource consumption (§12.6).
4. Discoveries: forgetting checks, then new discovery rolls, then era update (§12).
5. Contact: detect pairs, decide or continue relations, resolve wars / absorbs / trade (§14).
6. Village sample update (§11.10).
7. Record yearly stats; flush event log entries (§21).
8. If `year % keyframeEveryYears === 0` → store a keyframe (§17).

---

## 6. Folder structure

```
pixel-ages/
  CLAUDE.md
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  presets/                      # test scenarios as .run.json files (§26)
  src/
    main.ts                     # bootstraps UI, editor, renderer, worker
    config.ts                   # ALL tunable numbers (§23)
    shared/
      ids.ts                    # Ground, Plant, Resource, WallType, Species, Sex, Mode, Action, Discovery ids
      types.ts                  # shared interfaces (§7)
      protocol.ts               # worker messages (§22)
      rng.ts                    # seeded PRNG + gaussian + stochastic rounding (§16)
      grid.ts                   # index ↔ x,y, neighbours, disk iteration, distance
      hash.ts                   # integer hash for grain (render) and ids
      save.ts                   # JSON encode/decode, base64 typed arrays, versions
      discoveries.ts            # discovery table (§12) — shared by sim and UI
    sim/
      worker.ts                 # worker entry: loop, commands, frames
      state.ts                  # create SimState from RunSetup
      tick.ts                   # monthly + yearly order (§5.1)
      world/
        regions.ts              # areas, wall segments, crossings, union-find
        climate.ts              # rain now, drift
        plants.ts               # stock regen, spread, death, ground change
        animals.ts              # densities, growth, predation, diffusion
      people/
        persons.ts              # PersonPool (struct of arrays)
        founders.ts             # create founder people
        brain.ts                # utility scores (§11.6)
        actions.ts              # carrying out actions
        food.ts                 # production, spoilage, distribution
        lifecycle.ts            # pairing, births, deaths, aging, health
        inheritance.ts          # potential + environment → actual
        explore.ts              # known tiles, frontier, reveal
        movement.ts             # migration and splitting
        village.ts              # village mode, sample, switching
      progress/
        discoveryRules.ts       # chances, effects, forgetting, eras, resources
      society/
        walls.ts                # wall work, breach
        contact.ts              # war, trade, absorb, coexist
      events.ts                 # planned events
      stats.ts                  # yearly stats, event log
      timeline.ts               # keyframes, replay, live vs view state
      serialize.ts              # SimState ↔ keyframe
    render/
      renderer.ts               # main draw loop
      palette.ts                # colours (§18.1)
      terrain.ts                # tile colours + grain into an offscreen canvas
      spriteData.ts             # pixel grids from §19 as strings
      sprites.ts                # parse grids, tint, cache as small canvases
      people.ts                 # visual positions, walk animation
      decor.ts                  # village walkers, buildings, animals, objects
      overlays.ts               # fog, rain view, territory, selection, hover
      camera.ts                 # 1× / 2× zoom and pan
    editor/
      mapState.ts               # MapData create/clone
      brushes.ts                # all brushes
      fill.ts                   # fill bucket
      undo.ts                   # undo stack
      regionsPreview.ts         # live area outlines during setup
    ui/
      layout.ts
      toolbar.ts                # brush buttons and options
      setupPanel.ts             # groups, events, seed, drift, maps
      peopleDialog.ts
      eventDialog.ts
      runControls.ts            # play, pause, 8×, step, timeline
      inspector.ts
      graphs.ts
      eventLog.ts
      styles.css
  tests/
    rng.test.ts
    grid.test.ts
    save.test.ts
    determinism.test.ts
    plants.test.ts
    animals.test.ts
    lifecycle.test.ts
    inheritance.test.ts
    food.test.ts
    explore.test.ts
    discoveries.test.ts
    village.test.ts
    walls.test.ts
    contact.test.ts
    events.test.ts
    timeline.test.ts
    scenarios.test.ts           # headless long runs (§25)
```

---

## 7. Data model

### 7.1 Ids (`src/shared/ids.ts`)

```ts
export const Ground = { Grassland: 0, Desert: 1, Water: 2, Mountain: 3 } as const;
export type Ground = (typeof Ground)[keyof typeof Ground];

// Farmland is created by people (Farming), never painted.
export const Plant = { None: 0, Forest: 1, FruitBushes: 2, Grass: 3, Farmland: 4 } as const;
export type Plant = (typeof Plant)[keyof typeof Plant];

export const Resource = { None: 0, Stone: 1, Clay: 2, Copper: 3, Iron: 4 } as const;
export type Resource = (typeof Resource)[keyof typeof Resource];

export const WallType = { None: 0, River: 1, Mountain: 2, Sea: 3 } as const;
export type WallType = (typeof WallType)[keyof typeof WallType];

export const Species = { Prey: 0, Predator: 1, Herd: 2, Riding: 3 } as const;
export type Species = (typeof Species)[keyof typeof Species];

export const Sex = { Male: 0, Female: 1 } as const;
export type Sex = (typeof Sex)[keyof typeof Sex];

export const Mode = { Band: 0, Village: 1 } as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export const Action = {
  None: 0, Gather: 1, Hunt: 2, Farm: 3, Herd: 4, Explore: 5,
  Care: 6, Build: 7, Wall: 8, Rest: 9, Teach: 10, Child: 11,
} as const;
export type Action = (typeof Action)[keyof typeof Action];

export const Season = { Spring: 0, Summer: 1, Autumn: 2, Winter: 3 } as const;
```

Discovery ids are in §12.1.

### 7.2 Map and setup (`src/shared/types.ts`)

```ts
export interface MapData {
  version: 1;
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

export interface RunSetup {
  version: 1;
  name: string;
  map: MapData;
  founders: FounderGroup[];
  events: PlannedEvent[];
  seed: number;                  // uint32
  climateDrift: ClimateDrift;
}
```

### 7.3 Simulation state (worker only)

```ts
export interface SimState {
  year: number;                  // starts at 0
  month: number;                 // 0–11
  rng: RngState;                 // §16
  setup: RunSetup;               // original, read-only

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
  wallSegmentId: Int32Array;     // -1 if not a wall
  wallSegments: WallSegment[];
  dryYears: Uint16Array;         // ground change counters
  wetYears: Uint16Array;
  farmIdleYears: Uint8Array;
  climate: Float32Array;         // cellsX × cellsY drift values

  groups: Group[];               // always sorted by id
  nextGroupId: number;
  lineages: Lineage[];
  persons: PersonPool;           // band-mode people only
  relations: Relation[];         // sorted by (a, b)
  activeEvents: ActiveEvent[];
  log: LogEntry[];
  stats: YearStats[];
}

export interface WallSegment {
  id: number;
  type: WallType;
  health: number;
  maxHealth: number;
  breached: boolean;
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
  mode: Mode;
  homeX: number;
  homeY: number;
  foundedYear: number;
  known: Uint8Array;             // bitset, (width*height)/8 bytes
  frontier: number[];            // tile indices, kept sorted ascending
  discoveries: number;           // bitmask (bit = discovery id)
  inactive: number;              // bitmask: owned but missing resource
  era: number;                   // 0–6
  belowLimitYears: Uint8Array;   // per discovery, years under forget limit
  foodStock: number;             // FU
  fedHistory: Float32Array;      // last 12 months of group average fed ratio (ring buffer)
  herd: number;                  // owned herd animals
  farmTiles: number[];           // tile indices
  hasHunted: boolean;
  huts: number;                  // built huts
  houses: number;                // built mud-brick houses
  buildProgress: number;         // worker-months toward the next building
  hungryMonths: number;          // consecutive months over migrate threshold
  crowdedMonths: number;         // consecutive months over split threshold
  wallTarget: { segmentId: number; tile: number } | null;
  teachBonus: number;            // this year's teaching multiplier
  carers: number;                // this month's carers
  cannotReproduceLogged: boolean;
  village: VillageData | null;   // only in village mode
  memberCount: number;           // band mode: cached count
}

export interface VillageData {
  // counts[sex * 6 + bucket]; buckets: 0:0–4, 1:5–14, 2:15–49, 3:50–59, 4:60–69, 5:70+
  counts: Int32Array;            // length 12
  sample: SampleMember[];        // representative people, length = sampleSize
  fed: number;                   // last month's fed ratio
  childAdversity: number;        // 0–1 share of recent months with war/plague/starvation
}

export interface SampleMember {
  sex: Sex;
  ageYears: number;
  pot: [number, number, number]; // potential [int, coop, str]
  act: [number, number, number]; // actual    [int, coop, str]
}

export interface Relation {
  a: number;                     // group id (a < b)
  b: number;
  kind: 'coexist' | 'trade' | 'war';
  sinceYear: number;
  reviewYear: number;
}

export interface ActiveEvent {
  event: PlannedEvent;
  areaRoot: number;              // region root id (or -1 for whole map)
  endYear: number;
}

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
  | 'firstContact' | 'tradeStart' | 'war' | 'conquered' | 'absorbed'
  | 'breach' | 'event' | 'groupExtinct' | 'lineageExtinct' | 'cannotReproduce' | 'perf';

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
    discoveries: number;         // union bitmask across the lineage
  }>;
}
```

### 7.4 PersonPool (struct of arrays)

All band-mode people live in one pool. Grow capacity by doubling. Reuse freed slots via a free list. **Person ids are never reused** (keep `id` separate from slot index) so ordering stays stable.

| Field | Type | Meaning |
|---|---|---|
| `id` | Int32 | Unique, increasing |
| `alive` | Uint8 | 0/1 |
| `groupId` | Int32 | |
| `sex` | Uint8 | Sex id |
| `ageMonths` | Uint16 | |
| `motherId`, `fatherId` | Int32 | -1 for founders |
| `partnerId` | Int32 | -1 if none |
| `pot` int/coop/str | Float32 × 3 | Potential |
| `act` int/coop/str | Float32 × 3 | Actual |
| `health` | Float32 | 0–100 |
| `fed` | Float32 | Last month's fed ratio 0–1 |
| `nutrition` | Float32 | 12-month moving average of `fed` |
| `childFedSum` | Float32 | Sum of monthly `fed` while age < 15 |
| `childAdversity` | Uint16 | Months as a child with war, plague or starving |
| `nursing` | Uint8 | Months left before she can conceive again |
| `action` | Uint8 | Action id this month |
| `workTile` | Int32 | Tile index where they work this month |
| `skin` | Uint8 | 0–2 visual skin tone |
| `hair` | Uint8 | 0–2 visual hair colour |

Keep a per-group member list (array of slot indices, ascending by id) for fast iteration.

---

## 8. World and map

### 8.1 Grid

- Size **160 × 90**. Tile index `i = y * 160 + x`.
- **1 tile = 1 km.** The map is 160 × 90 km.
- Neighbours: **8-way**, but a diagonal step is only allowed if **both** orthogonal neighbours are passable (no corner cutting through walls).
- Distance: Euclidean, in tiles. "Within radius R" = `dx*dx + dy*dy <= R*R`.

### 8.2 Tile layers and painting rules

| Layer | Values | Painting rules |
|---|---|---|
| Ground | Grassland, Desert, Water, Mountain | Painting Water clears plants, resources and animals on that tile |
| Plants | Forest, Fruit bushes, Grass (+ eraser) | Sets type, density = brush strength × 255. Allowed anywhere except Water; the living world decides if it survives |
| Resources | Stone, Clay, Copper, Iron (+ eraser) | Sets type, amount = brush strength × 255. Not on Water |
| Rain | 0–100 | Brush sets value to the brush strength (0–100), soft edge: outer ring blends 50% |
| Animals | Prey, Predator, Herd, Riding (+ eraser) | Sets that species' density = strength × 255. Not on Water |
| Walls | River, Mountain, Sea (+ eraser) | Sets wall type. Clears plants and resources on the tile |
| People | Click to place a group | Opens the People dialog (§20.4). Not on Water or wall tiles |

**New map default:** all Grassland, no plants, no resources, rain 50, no animals, no walls.

### 8.3 Areas, wall segments, crossings

- **Areas (regions):** flood fill over all non-wall tiles using **4-connectivity**. Each connected set gets a `regionId`. Using 4-connectivity means a diagonal line of wall tiles still blocks. Water tiles belong to regions (crossing them needs Raft, §11.7).
- **Wall segments:** flood fill over wall tiles of the **same type** using **8-connectivity**. Each segment gets an id, a type and health (`config.walls.health`).
- **Crossings:** when a wall is breached (§13) or hit by an earthquake (§15), the wall tiles in a square of radius `config.walls.breachRadius` (3×3) around the point get `crossing = 1`. Crossing tiles are passable. Their neighbouring regions are merged with **union-find** (`regionParent`). Two tiles are "connected" if their regions share a union-find root.
- In **setup mode**, compute areas live (debounced 200 ms after painting) so the player sees area outlines and can pick areas for events.

### 8.4 Passability (per group)

A tile is passable for a group if:

- it is not an intact wall (`wall === None` or `crossing === 1`), and
- it is not Water, **or** the group owns **Raft**.

Mountain ground is passable (no movement cost in v1).

---

## 9. Time

- **Tick = 1 month**, 12 ticks per year. Year 0 month 0 is the start.
- **Seasons:** months 0–2 spring, 3–5 summer, 6–8 autumn, 9–11 winter.
- **Speeds:** Pause; **1× = 12 ticks per second (1 year per second, default)**; **8× = 96 ticks per second**.
- **Step** button (when paused): advance exactly 1 month.
- Speed **never** changes results. If the computer can't keep up, the worker runs as fast as it can and the UI shows the real speed (e.g., "5.2 years/s").
- Worker loop: a `setTimeout(loop, 0)` accumulator. Each loop iteration runs as many ticks as the elapsed real time allows (max 50 ms of work per iteration), then posts at most one frame (max 30 frames per second).
- Real time of a run at 1×: 300 years ≈ 5 min, 10,000 years ≈ 2 h 47 min. At 8×: 10,000 years ≈ 21 min.

---

## 10. Environment simulation

### 10.1 Rain and climate drift

**Rain factor** used by plants, farming and animals:

```
rainFactor = clamp(rainNow / 60, 0, 1.3)
```

**Current rain** each month:

```
rainNow = clamp(round(baseRain × driftMult(tile) × eventMult(tile)), 0, 100)
```

**Climate drift** (yearly). The map is divided into a coarse grid of **8 × 5 climate cells** (each about 20 × 18 tiles). Each cell holds a value `v` (starts at 0):

```
v = v × 0.995 + gaussian() × sigma          sigma: off 0, slow 0.01, strong 0.025
cellMult = clamp(1 + v, 0.3, 1.7)
driftMult(tile) = bilinear interpolation of the 4 nearest cell centres
```

With `0.995` reversion, changes build up over centuries: typical swings are about ±10% (slow) or ±25% (strong). This allows "green Sahara" style shifts without random year-to-year noise.

**Event multiplier** (§15): drought `× (1 − strength/100)`, wet period `× (1 + strength/100)`, with a 1-year ramp at the start and end (half effect in the first and last year).

### 10.2 Plants

Each tile has `plantType`, `plantDensity` (0–255) and `plantFood` (FU stock).

**Monthly food regeneration:**

```
maxStock = maxStockByType[plantType] × (plantDensity / 255) × rainFactor
maxStockByType: Forest 1.5, Fruit bushes 3.0, Grass 0.4, Farmland 0 (farms produce differently)
seasonRegen: spring 1.2, summer 1.0, autumn 0.8, winter 0.2   (× 0.5 in winter during Harsh winters)

if plantFood < maxStock:  plantFood += 0.2 × (maxStock − plantFood) × seasonRegen
else:                      plantFood = maxStock
```

For calibration: a full forest range (R = 6, about 113 tiles) sustainably gives about 34 FU/month, so a forager band there tops out around 30–40 people. Fruit bushes give about double. This matches real forager densities of roughly 0.1–0.5 people per km².

**Yearly spread and death (living world).** For each tile, compute a target density from rain and ground:

| Plant | Dies below rain | Full density at rain | Ground multiplier [Grassland, Desert, Water, Mountain] |
|---|---|---|---|
| Forest | 25 | 50 | 1, 0, 0, 0.5 |
| Fruit bushes | 30 | 40 | 1, 0, 0, 0 |
| Grass | 10 | 30 | 1, 0.4, 0, 0.5 |

```
t = (rainNow − dieBelow) / (fullAt − dieBelow), clamped 0..1
target = round(255 × t × groundMult[ground])
if density < target: density = min(target, density + 26)    // ~10 years to full
if density > target: density = max(target, density − 13)    // ~20 years to die
if density == 0: plantType = None
```

**Spread** (yearly, after growth): for a tile with `plantType` None or Grass, on Grassland, not a wall, not farmland — for each of its 8 neighbours with Forest density ≥ 128, if this tile's rain ≥ 55, roll 2% → becomes Forest at density 26. Then the same for Fruit bushes (rain ≥ 40, 1%). Then Grass (only for `None` tiles, any non-Water ground, rain ≥ 15, 5%). Stop at the first success. Process tiles in index order and read neighbour densities from the **previous year's** copy (double buffer) so the order doesn't bias spread.

**Farmland** is created and removed only by people (§11.5). If a farm tile has had no farmers for 3 years, it becomes Grass at density 128.

### 10.3 Ground change (yearly)

- **Grassland → Desert:** if rainNow < 10 for **50 consecutive years**.
- **Desert → Grassland:** if rainNow ≥ 30 for **50 consecutive years**.
- Water and Mountain never change. Walls never change except crossings.

### 10.4 Animals

Each tile holds a density 0–1 for each species. Painted values become the starting density (`painted / 255`).

**Habitat capacity K** for Prey, Herd and Riding:

```
suitability = groundValue[ground]   (or the forest value if the tile has Forest density ≥ 128)
K = suitability × clamp(0.3 + rainNow / 100, 0.3, 1.0)
```

| Species | Grassland | Desert | Water | Mountain | Forest tile |
|---|---|---|---|---|---|
| Prey (deer-like) | 0.8 | 0.1 | 0 | 0.3 | 1.0 |
| Herd (goat-like) | 1.0 | 0.4 | 0 | 0.8 | 0.2 |
| Riding (horse-like) | 1.0 | 0.2 | 0 | 0.1 | 0.1 |

**Monthly update** (double buffer, tile index order):

```
// Prey, Herd, Riding — logistic growth
if K > 0: d += growth × d × (1 − d / K)        growth: prey 0.03, herd 0.02, riding 0.015
else:     d −= 0.05 × d

// Predator–prey (wolf-like predators)
prey     −= 0.05 × predator × prey
predator += 0.02 × predator × prey − 0.01 × predator

// Diffusion: 3% of each tile's density spreads equally to its 4 orthogonal neighbours.
// Shares toward Water or intact wall tiles stay on the tile.
clamp all densities to 0..1
```

People affect animals: hunting removes prey density (§11.5); taming captures wild herd density (§11.5).

A species counts as **"found"** by a group when the group knows a tile with that density ≥ **0.05**.

---

## 11. People

### 11.1 Groups and lineages

- Each founder group starts as a **band** with its painted people, at its home tile. It knows all tiles within radius **3** of home (only tiles connected to home, §11.7).
- A founder group's id is also its **lineage id**. Groups created by splitting keep the parent's lineage and colour, and are named `"<lineage name> <n>"` (e.g., "Desert 2").
- Captured or absorbed people join the winner's group and lineage.
- A group with 0 people is removed (log `groupExtinct`). When the last group of a lineage dies, log `lineageExtinct`.
- If a band has no man aged 16+ or no woman aged 16–40 and no children who will grow into one, log `cannotReproduce` once.

### 11.2 Traits

Every person has three traits, each with a **potential** (genes) and an **actual** (used by rules).

| Trait | Setup range | Hard range | Main effects |
|---|---|---|---|
| Intelligence | 60–160 | 40–180 | Discovery chance, exploring reveal radius, explore drive, small yield bonus, learning by trade |
| Cooperation | 0–100 | 0–100 | Food sharing, care for children, trade vs war, splitting less, group hunting |
| Strength | 0–100 | 0–100 | Hunting, war power, wall work, predator defence, harsh land survival |

Founders: `potential = actual = value from setup` (plus optional spread, §20.4).

### 11.3 Inheritance (genes)

When a child is born:

```
childPotential = (motherPotential + fatherPotential) / 2 + gaussian() × mendelSd
mendelSd: intelligence 7.5, cooperation 5, strength 5
clamp to the hard range
```

This is the real "breeding value" rule: a child gets the parents' average plus random variation (half of the inherited spread). With an IQ-like population spread of 15 and about half of it inherited, the variation is 7.5.

### 11.4 Environment (nurture) → actual traits

While a child (< 15), a person records `childFedSum` and `childAdversity` (months with war, plague or starving). Children's actual traits are shown as "developing". At **age 15**, actual traits are fixed:

```
cn = childFedSum / childMonths                 // childhood nutrition 0–1
ca = childAdversity / childMonths              // share of hard months 0–1

intActual  = intPot  + clamp(−40 × max(0, 0.9 − cn), −20, 0)
                     + min(10, 1.5 × groupEra + (hasWriting ? 3 : 0))
strActual  = strPot  + clamp(−30 × max(0, 0.9 − cn), −25, 0)
coopActual = coopPot − 15 × ca + (cn >= 0.9 && ca === 0 ? 5 : 0)
clamp each to its hard range
```

**Adults:** strength changes with age and food:

```
strengthNow = strActual × (0.7 + 0.3 × nutrition)
              × (age > 50 ? max(0.4, 1 − (age − 50) × 0.015) : 1)
```

This makes the owner's experiment a real nature-vs-nurture test: a high-potential group that grows up starving ends up less capable than its genes; a well-fed group with lower potential can catch up partly through food and learning.

### 11.5 Food

**Need per month:** child (< 15) 0.6 FU, adult 1.0 FU, elder (60+) 0.8 FU.

**Yield modifiers** (apply to all food a worker gains):

```
yieldMult = (Fire ? 1.15 : 1) × (Copper Working ? 1.15 : 1) × (1 + (intActual − 100) / 400)
         × (trading this year ? 1.05 : 1)
```

**Gather:** a gatherer picks the known tile in range with the most `plantFood` (ties → lowest index), and takes `min(2.0 × yieldMult × (Stone Tools ? 1.2 : 1), plantFood)`. Gatherers are processed in id order, so later ones pick the next best tile.

**Hunt:** a hunter picks the known tile in range with the highest prey density.

```
success = 0.5 × (0.5 + strengthNow / 100) × (Stone Tools ? 1 : 0.5) × (Spear ? 1.5 : 1)
          × (1 + groupAvgCoop / 200)          capped at 0.95
roll < success → gain 3.0 × preyDensity × yieldMult; preyDensity −= 0.01; group.hasHunted = true
```

**Farm** (needs Farming). Farm tiles are chosen from known Grassland tiles in range with `rainNow ≥ 30`, or — with Irrigation — any known Grassland or Desert tile in range within 2 tiles of Water ground or a River wall. The group keeps `ceil(farmers / 10)` farm tiles, choosing the best rain first (ties → lowest index); new ones get `plantType = Farmland`, density 255.

```
per farmer per month = 2.0 × farmSeason[season] × farmRain × yieldMult × (Iron Working ? 1.2 : 1)
farmSeason: spring 0.4, summer 0.93, autumn 2.67, winter 0      (averages 1.0 over a year)
farmRain = irrigated ? max(rainFactor, 1.0) : rainFactor
max 10 farmers per farm tile
```

Winter gives zero farm food, so storage (and Pottery) matters. One farm tile can feed about 20 people, versus 0.1–0.5 people per tile for foraging — the real reason farming changed history.

**Herd** (needs Taming).

```
capacity = 5 × (known Grassland/Desert/Mountain tiles in range with Grass or no plant) × rainFactor(home)
each herder: if herd < capacity, capture min(2, wild herd density on best tile × 10) animals
             and reduce that tile's herd density by captured / 10
herd grows 1.5% per month, capped at capacity
food = min(herd, herders × 20) × 0.08 × yieldMult
```

**Spoilage:** each month, `foodStock × 0.10` is lost (`0.06` with Pottery).

**Distribution** (band, each month after production):

```
need = sum of every member's monthly need
if foodStock ≥ need: everyone gets their need (fed = 1); foodStock −= need
else (shortage): share foodStock using weights
   weight = need × w
   adult w = 1 + 0.5 × (strengthNow / 100) × (1 − coopActual / 100)   // selfish strong people take more
   child w = 0.5 + groupAvgCoop / 100                                // cooperative groups protect children
   carers this month: w × 0.7                                        // they give part of theirs away
   fed = received / need (max 1); foodStock = 0
nutrition = nutrition × 11/12 + fed / 12
```

This creates a real two-level tension: inside a group, selfish people survive shortages better; but cooperative groups protect children, hunt better, trade more and split less.

**Group hunger H** (0–100), used by the brain, migration and walls:

```
fed3 = average group fed ratio over the last 3 months
stockMonths = foodStock / monthly need
H = min(100, 200 × (1 − fed3) + max(0, 30 − 7.5 × stockMonths))
```

A group that is fully fed with no stored food has H = 30. Missing a quarter of its food gives H ≈ 80.

**Range food signals** (used by the brain):

```
plantAvail PA = clamp(Σ plantFood of known passable tiles in range / (2 × monthly need), 0, 1)
preyAvail  YA = clamp(4 × average prey density of known passable tiles in range, 0, 1)
crowding      = monthly need / sustainableYield
sustainableYield = Σ over known passable tiles in range of (maxStock × 0.2 × 0.5 + preyDensity × 0.3)
                   + farmTiles × 10 × 2.0 + min(herd, herders × 20) × 0.08
```

### 11.6 The brain (needs + scores)

**Band mode:** every month, every person aged 15+ scores each allowed action and takes the highest. A seeded random nudge `U(0, 10)` is added to every score so people are not identical. Ties → lowest action id.

Variables: `H` group hunger, `PA`, `YA`, `crowding`, `P` pressure (§13), `int`, `coop` = actual traits, `str` = strengthNow, `kidsRatio` = children / adults.

| Action | Allowed when | Score |
|---|---|---|
| Gather | always | `15 + H × PA` |
| Hunt | age 15–59 | `(15 + H) × YA × (str / 100) × (StoneTools ? 1 : 0.5) × (Spear ? 1.3 : 1)` |
| Farm | Farming, farm tile available, not winter | `25 + 0.8 × H + (spring or autumn ? 20 : 0)` |
| Herd | Taming, herd > 0 or herd animals found in range, herders × 20 < max(herd, 20) | `20 + 0.5 × H` |
| Explore | age 15–45, frontier tile within explore range | `10 + (int − 100) / 2 + 40 × max(0, crowding − 0.9) + 0.5 × H × (1 − PA)` |
| Care | children in group | `(40 × kidsRatio + 0.5 × hungriestMemberHunger) × coop / 100` |
| Build | families without shelter > 0 | `25 + 5 × familiesWithoutShelter` |
| Wall | wall conditions met (§13) | `70 × P × (str / 100)` |
| Rest | health < 70 | `1.5 × (70 − health)` |
| Teach | age ≥ 50, int ≥ 90 | `20 + (int − 100) / 2 + 20 × kidsRatio` |

`hungriestMemberHunger = 100 × (1 − lowest fed ratio in group last month)`.

**Age rules:** under 15 → action `Child` (follows mother, no work). 60+ → only Gather, Care, Rest, Teach. Scores below 0 count as 0.

**Example tick for one person** (hunger 75, food nearby, Stone Tools, coop 30):

```
Person: int 120, coop 30, str 60, health 100. Group: H 75, PA 1.0, YA 0.8, kidsRatio 0.5
Gather  = 15 + 75 × 1.0                         = 90.0  ← picked (plus nudge)
Hunt    = (15 + 75) × 0.8 × 0.6 × 1 × 1          = 43.2
Explore = 10 + 20/2 + 0 + 0.5 × 75 × 0          = 20.0
Care    = (40 × 0.5 + 0.5 × 40) × 30/100        = 12.0
```

With coop 90 instead, Care = 36 — still lower than Gather here, but in a fed group with many children, cooperative people choose Care far more often.

**Action effects** (band):

| Action | Effect |
|---|---|
| Gather / Hunt / Farm / Herd | Produce food (§11.5) into the group stock. `workTile` = the chosen tile |
| Explore | Reveal around a frontier tile (§11.7). `workTile` = that tile |
| Care | Group child death chance × `max(0.7, 1 − 0.02 × carers)` this month; carer's food weight × 0.7 |
| Build | `buildProgress += 1`. A hut needs 2 worker-months (shelters 1 family). With Mud Brick, build houses instead: 6 worker-months, shelters 3 families |
| Wall | Wear the target wall segment (§13) |
| Rest | Health +20 this month instead of +10 |
| Teach | Counts as a teacher: `teachBonus = 1 + min(0.3, 3 × teachers / population)` for this year's discovery rolls |

A **family** = a couple, or a single parent with children under 15.

**Predators:** each month, each person whose action is Gather, Hunt, Herd or Explore is attacked with chance:

```
0.01 × predatorDensity(workTile) × (Spear ? 0.5 : 1) × (Hunt ? 1.5 : 1)
     × (1 − str / 200) × (1 − groupAvgCoop / 300)
attack → 50% death, 50% injury (health −30)
```

### 11.7 Exploring

- Each group has a `known` bitset and a `frontier` list (unknown tiles adjacent to at least one known tile that is passable for this group).
- **Explore range:** 8 tiles from home, × 2 with Cart, × 3 with Riding (multiply if both).
- **Explore action:** pick a random frontier tile (seeded) within explore range of home. Reveal every tile within **reveal radius** of it that is in the same connected area as the frontier tile (§8.3), plus any wall tiles touching revealed tiles. You cannot see across walls.

```
revealRadius = clamp(2 + floor((intActual − 60) / 40), 1, 5)      // int 60 → 2, 100 → 3, 140 → 4
```

- After revealing, update the frontier: add unknown neighbours of newly known passable tiles; remove tiles that became known.
- When a group gains **Raft**, rebuild its frontier once (water tiles are now passable). When a wall breach happens, rebuild the frontier for groups that know any of the new crossing tiles.

### 11.8 Migration and splitting

**Migration (move home)** — checked monthly:

- **Bands without farm tiles:** if `H > 60` and `PA < 0.4` for **3 consecutive months**, move home.
- **Groups with farm tiles:** only if `H > 80` for **12 consecutive months**. They abandon their farm tiles.
- **New home:** among known passable non-Water tiles within the migrate range (25 tiles, × 2 with Cart, × 2 with Riding), connected to the current home, pick the one with the highest `sustainableYield(tile) − 0.5 × distance`. Sample every 2nd tile in x and y for speed. If the best is not better than staying, don't move.
- Log `migrate` only if the move is ≥ 10 tiles.

**Splitting** — checked monthly:

- Trigger: `crowding > 1.1` for **12 consecutive months**, **or** (band without Farming **and** population > 60).
- Chance per month: bands `10% × (1.2 − avgCoop / 100)`; villages `5% × (1.2 − avgCoop / 100)`.
- The new group takes **40%** (bands) or **30%** (villages) of people, moving whole families (a couple + their children under 15 together).
- New home: best known site (by sustainable yield) that is connected and at least `2 × R` (12 tiles) from every other group's home. If there is none, no split this month (the group's explore score will rise because of crowding).
- The new group copies: known tiles, frontier, discoveries, era, half the herd, a proportional share of food. It gets a new id and the next lineage name.
- If the new group would be ≥ 150, it starts as a village.

### 11.9 Life cycle (band)

**Pairing** (monthly): unpaired women 16+ are processed in id order; each pairs with a random (seeded) unpaired man 16+ in the same group who is not her parent, child, sibling or half-sibling. Partners stay together until one dies; widowed people can pair again. (Inbreeding effects are out of scope for v1.)

**Births** (monthly): a woman aged 16–40 with a living partner and `nursing == 0` gives birth with chance **5% per month** (2.5% if group `H > 60`). After a birth, `nursing = 24`. This gives about one child every 3–4 years. The child's sex is 50/50, age 0, traits from §11.3.

**Deaths** (monthly), using the real forager table (annual → monthly converted):

| Age | Annual | Monthly |
|---|---|---|
| 0–4 | 6% | 0.514% |
| 5–14 | 1% | 0.0837% |
| 15–49 | 1.5% | 0.1259% |
| 50–59 | 3% | 0.2535% |
| 60–69 | 6% | 0.514% |
| 70+ | 15% | 1.345% |

Multipliers (multiply together):

| Condition | × |
|---|---|
| Starving this month (fed < 0.5) | 3 |
| Malnourished (fed 0.5–0.8) | 1.5 |
| Home tile is Desert or Mountain and no Clothing | 1.5 |
| Winter month and no Fire | 1.3 |
| Group has Mud Brick | 0.8 |
| Health < 30 | 2 |
| Child (< 15) and carers this month | `max(0.7, 1 − 0.02 × carers)` |
| Plague, Harsh winters | §15 |

Max age 100 (dies).

**Health:** −20 when starving, −30 from a predator injury or war wound, otherwise +10 per month (+20 when resting), capped at 100.

**Aging:** `ageMonths += 1`. At exactly 180 months (age 15), fix actual traits (§11.4).

### 11.10 Villages (150+) and switching

**Switch band → village** when population ≥ **150** (checked monthly, step 7):

- `counts` = people counted by sex and age bucket (0–4, 5–14, 15–49, 50–59, 60–69, 70+).
- `sample` = **64** people picked at random (seeded) from the band, copying sex, age, potential and actual traits.
- Remove all band persons from the pool. Log `becameVillage`.

**Switch village → band** when population < **100**:

- For each sex and bucket, create `counts[...]` persons with ages uniform (seeded) inside the bucket. Each copies traits from a random sample member plus `gaussian() × mendelSd / 2`. Pair adults at random. Health 100, nursing 0. Log `becameBand`.

**Village monthly simulation:**

- **Labour:** adults = people aged 15–59. Score Gather, Hunt, Farm, Herd, Explore, Care, Build and Wall with the brain formulas using group averages (from the sample's adults) and no nudge. Each allowed action gets a share of adults ∝ `score²`. Workers per action = adults × share (fractional is fine). Villages have no Rest action (no per-person health).
- **Teaching:** teachers = people aged 50+ × (share of sample members aged 50+ with intelligence ≥ 90) × 0.3.
- **Production:** same per-worker formulas as bands, using expected values (no dice per worker). Gathering takes food from the known tiles in range proportionally to their stock. Hunting uses expected success and removes `0.01 × expected successes` prey density spread over the best tiles.
- **Explore:** number of reveals this month = stochasticRound(explorers × 0.2). Each reveal works like a band explorer with the average intelligence.
- **Wall work:** wall workers = labour share for Wall, at the average strength.
- **Buildings:** with Mud Brick, target houses = `ceil(population / 10)`; otherwise huts = `ceil(population / 5)`. Building progress uses the Build share.
- **Distribution:** one fed ratio for the whole village: `fed = min(1, foodStock / need)`.
- **Births:** fertile women ≈ women aged 15–49 × (25 / 35). Expected births = fertile × (1/44) per month (halved if `H > 60`) → stochastic rounding.
- **Deaths:** for each bucket, expected deaths = count × monthly rate × multipliers → stochastic rounding.
- **Aging:** each month, `count / (bucketYears × 12)` people move to the next bucket (stochastic rounding). Bucket years: 5, 10, 35, 10, 10, and the 70+ bucket only loses people to death.

**Village sample update (yearly)** — keeps genes and natural selection working in village mode:

1. Each sample member dies with chance = its bucket's annual death rate × that year's average multipliers × a trait factor:
   `(1 + (50 − strength) / 250) × (shortage this year ? 1 + (coop − 50) / 250 : 1)`
2. Births: `stochasticRound(64 × birthsThisYear / population)` new members, each from a random sample woman aged 16–40 and a random sample man 16+, using §11.3. Their actual traits use the village's nutrition and adversity (§11.4).
3. Everyone ages 1 year.
4. Resize to exactly 64: remove random members, or duplicate random members with `gaussian() × mendelSd / 2` noise.

Group averages shown in the UI (and used by village rules) come from the sample's adults.

**Performance guard:** if total band-mode persons exceed **30,000**, switch the largest band to a village early (even below 150) and log `perf`. Repeat until under the limit.

---

## 12. Discoveries and eras

### 12.1 The discovery table (`src/shared/discoveries.ts`)

| Id | Key | Name | Era | Needs found | Needs discoveries | Effect |
|---|---|---|---|---|---|---|
| 0 | `fire` | Fire | 1 | Forest | — | All food × 1.15 (cooked). Removes the winter death ×1.3 |
| 1 | `stoneTools` | Stone Tools | 1 | Stone | — | Gather × 1.2. Full hunting (×0.5 without) |
| 2 | `spear` | Spear | 1 | Forest | Stone Tools | Hunt success × 1.5. Predator attacks × 0.5 |
| 3 | `raft` | Raft | 2 | Forest + Water | — | Water tiles become passable (not walls) |
| 4 | `clothing` | Clothing | 2 | — | Spear + has hunted | Removes the Desert/Mountain death ×1.5. Legs drawn in clothing colour |
| 5 | `taming` | Taming | 2 | Herd animals | — | Herd action: capture and keep herd animals |
| 6 | `farming` | Farming | 3 | Grassland with rain ≥ 30 | — | Farm action and farm tiles |
| 7 | `pottery` | Pottery | 3 | Clay | Fire | Spoilage 10% → 6% per month |
| 8 | `boat` | Boat | 3 | — | Raft + Stone Tools | Can work on River and Sea walls |
| 9 | `mudBrick` | Mud Brick | 4 | Clay | Farming | Deaths × 0.8. Builds mud-brick houses |
| 10 | `irrigation` | Irrigation | 4 | Water | Farming | Farm on low-rain land near water (§11.5) |
| 11 | `wheel` | Wheel | 4 | — | Pottery + Farming | Needed for Cart |
| 12 | `riding` | Riding | 4 | Riding animals | Taming | Explore range × 3, migrate range × 2, war × 1.3, wall wear × 1.2 |
| 13 | `copperWorking` | Copper Working | 5 | Copper | Pottery | All food × 1.15, war × 1.2 |
| 14 | `mining` | Mining | 5 | Mountain | Copper Working | Can work on Mountain walls |
| 15 | `cart` | Cart | 5 | — | Wheel + Taming | Explore range × 2, migrate range × 2 |
| 16 | `writing` | Writing | 6 | — | Pottery + Farming | Discovery chance × 1.3, forget limits halved, +3 intelligence learning |
| 17 | `ironWorking` | Iron Working | 6 | Iron | Copper Working | War × 1.4, farm yield × 1.2 |
| 18 | `city` | City | 6 | — | Writing + Mud Brick, population ≥ 500 | Top era. City buildings drawn |

**Era names:** 0 Early people · 1 Foragers · 2 Hunters · 3 Farmers · 4 Villages · 5 Copper Age · 6 Iron & Writing.

### 12.2 "Found" means

A requirement is found when the group's **known** tiles include at least one tile with:

| Requirement | Tile condition |
|---|---|
| Forest | `plantType = Forest`, density > 0 |
| Stone / Clay / Copper / Iron | that `resourceType` with `resourceAmount > 0` |
| Water | Water ground, or a River or Sea wall tile |
| Mountain | Mountain ground, or a Mountain wall tile |
| Grassland with rain ≥ 30 | Grassland ground and `rainNow ≥ 30` |
| Herd / Riding animals | that species' density ≥ 0.05 |
| Has hunted | `group.hasHunted === true` (at least one successful hunt) |

### 12.3 Yearly discovery chance

Each year, for every discovery the group doesn't own, whose required discoveries it owns and whose requirements are found:

```
chance = baseChanceByEra[discoveryEra − 1]
       × (avgIntActual / 100)
       × (sqrt(population) / 5)
       × spareFood
       × (Writing ? 1.3 : 1)
       × teachBonus

baseChanceByEra = [2%, 1.5%, 1%, 0.7%, 0.5%, 0.3%]
spareFood = clamp((fed12 − 0.5) × 2, 0, 1)        // fed12 = 12-month average fed ratio
```

Roll each discovery in id order. Several discoveries can happen in one year. Log each: `Year 212  Desert 2  discovered Taming`.

**Worked example (Pottery):**

```
Pottery: era 3 → base 1%. Group: 40 people, avg intelligence 110, fed12 0.8 → spareFood 0.6
chance = 1% × 1.10 × (√40 / 5 = 1.265) × 0.6 ≈ 0.83% per year → expected in about 120 years
```

`sqrt(population)` means more people bring more ideas with diminishing returns: 400 people are about 3.2× more inventive than 40, not 10×.

### 12.4 Eras

```
era = the largest E in 0..6 such that, for every era k from 1 to E,
      owned discoveries of era k ≥ (number of era-k discoveries − 1)
```

So: era 1 needs 2 of 3 era-1 discoveries; era 4 needs 3 of 4; the others need 2 of 3. Era 0 ("Early people") is the starting state. Recalculate after forgetting and after new discoveries each year. Log `eraUp` / `eraDown`.

### 12.5 Forgetting

Each year, for each owned discovery `d` of era `e`:

```
limit = forgetLimitByEra[e − 1]           // [5, 10, 20, 40, 80, 150]
if group owns Writing and d ≠ Writing: limit = ceil(limit / 2)
if population < limit: belowLimitYears[d] += 1  else belowLimitYears[d] = 0
if belowLimitYears[d] ≥ 10: lose d, and every owned discovery that needs d (directly or through others)
```

Log `lostDiscovery`: `Year 931  Forest 3  forgot Boat (too few people)`. This creates real collapses: a famine halves a group, it forgets Boat, and it's stuck behind the river again.

### 12.6 Resource use

Some discoveries use up resources each year:

| Discovery | Uses |
|---|---|
| Stone Tools | Stone |
| Pottery, Mud Brick | Clay (each separately) |
| Copper Working | Copper |
| Iron Working | Iron |

```
units per year = ceil(population / 50)
take units from known tiles with that resource, nearest to home first (ties → lowest index)
```

If there isn't enough, the discovery becomes **inactive**: its effects stop, but it still counts for eras and as a requirement for other discoveries. Log `ranOut` once: `Year 1530  Forest 4  ran out of Clay`. Each year an inactive discovery checks again and becomes active when the resource is available. Any inactive discovery adds pressure (§13). Painted resources are finite, so large old civilizations slowly dig through their deposits.

### 12.7 Learning from others

- **Trade:** §14.5.
- **Conquest and absorbing:** §14.4 and §14.6.

In all cases a group can only gain a discovery if it owns the required discoveries and has found the required resource tile. Learned discoveries are logged as `discovery` with "learned from …".

---

## 13. Walls and breaching

| Wall | Health | Needs (active) | Crossing look |
|---|---|---|---|
| River | 100 | Boat | Bridge sprite |
| Sea | 300 | Boat | Bridge sprite |
| Mountain | 200 | Mining | Sand-coloured pass |

**Pressure P** (0–1):

```
P = max(H / 100, clamp((crowding − 0.9) × 5, 0, 1), anyInactiveDiscovery ? 0.5 : 0)
```

**A group works on a wall when all are true:**

1. It owns the needed discovery (active) for the wall type.
2. It knows at least one tile of that segment within its explore range of home.
3. The segment is not already breached.
4. `P ≥ 0.4`.

**Target:** the known tile of a qualifying segment nearest to home (ties → lowest index). Keep it until breach or until the conditions fail.

**Wear per wall worker per month:**

```
wear = 0.05 × max(1, era) × (0.5 + strengthNow / 100) × (Riding ? 1.2 : 1)
segment.health −= wear
```

Example: 10 workers, era 3, strength 50 → 1.5 per month → a River wall (100) opens in about 67 months (5.5 years). A comfortable group (P < 0.4) never bothers, even with Boat.

**Breach** (health ≤ 0): the 3×3 square of wall tiles around the target tile becomes a crossing (§8.3). Mark the segment breached, merge regions, rebuild affected frontiers, log `breach`: `Year 641  Desert 2  breached the River wall`. Health never regenerates. Any group can use a crossing.

---

## 14. Contact between groups

### 14.1 Detection (yearly)

Two groups are **in contact** when their homes are within `R_a + R_b` tiles (12 with R = 6) and their home tiles are connected (§8.3). Use a spatial grid of 16×16-tile cells to find pairs. Process pairs in order of (lower id, higher id).

The first time two different **lineages** meet, log `firstContact`: `Year 650  Desert 2 met Forest 5`.

### 14.2 Deciding the relationship

Decide when a pair is new, at its `reviewYear` (every 10 years), or when either side's pressure changed by more than 0.3 since the last decision.

```
coopAvg = min(100, (avgCoopA + avgCoopB) / 2 + (same lineage ? 30 : 0))
Ppair   = (P_A + P_B) / 2
power   = adults × (0.5 + avgStrength / 100) × warMult
warMult = (Riding ? 1.3 : 1) × (Copper Working ? 1.2 : 1) × (Iron Working ? 1.4 : 1)
ratio   = max(powerA, powerB) / max(1, min(powerA, powerB))

War     = 60 × Ppair + 0.4 × (100 − coopAvg) + (ratio ≥ 1.5 ? 10 : 0)
Trade   = 0.6 × coopAvg + (H_A < 30 and H_B < 30 ? 20 : 0) + (discovery sets differ ? 10 : 0)
Absorb  = ratio ≥ 3 ? 30 + 5 × min(ratio, 10) + 0.3 × H_weaker : 0
Coexist = 35

Add U(0, 10) to each. Highest wins. Ties → Coexist, Trade, War, Absorb (in that order).
```

- **War:** relation becomes `war`. One battle per year (starting this year) until a review picks something else or one side is conquered.
- **Trade:** relation becomes `trade`. Effects every year (§14.5). Log `tradeStart`.
- **Absorb:** resolved immediately (§14.6).
- **Coexist:** nothing happens.

If two groups are no longer in contact at a yearly check, remove their relation.

### 14.3 Example

```
A: 120 adults, strength 60, coop 30, P 0.8, Riding.   B: 40 adults, strength 50, coop 40, P 0.5
powerA = 120 × 1.1 × 1.3 = 171.6   powerB = 40 × 1.0 × 1 = 40   ratio = 4.29
coopAvg = 35   Ppair = 0.65
War    = 39 + 26 + 10          = 75
Trade  = 21 + 0 + 10           = 31
Absorb = 30 + 21.45 + 0.3 × H_B (say 60 → 18) = 69.45
→ War (75) vs Absorb (69) is close; the random nudge can tip it either way.
```

### 14.4 Battles

```
effA = powerA × (0.8 + 0.4 × U)      effB = powerB × (0.8 + 0.4 × U)
winner = higher eff (tie → lower id); share = effW / (effW + effL)
loser deaths  = (0.10 + 0.20 × share)       × loser adults
winner deaths = (0.05 + 0.10 × (1 − share)) × winner adults
```

- **Who dies:** bands → adults picked at random with weight `(150 − strengthNow)`; villages → adult buckets proportionally, and sample members at random in the same proportion.
- Every child in both groups gets +3 adversity months.
- Log `war`: `Year 812  Forest 3 beat Desert 2 (Desert 2 lost 34 people)`.

**Conquered** if the loser's population after the battle is < 20 or `effL < 0.5 × effW`:

1. **Captives:** 50% of the loser's survivors (random) join the winner's group.
2. **Refugees:** the rest form a new group (loser's lineage) at the best connected known site ≥ 12 tiles from the winner, **if** they are ≥ 4 people including a man 16+ and a woman 16–40. Otherwise they are removed.
3. The winner gains each of the loser's discoveries with 50% chance (requirements in §12.7 apply).
4. The winner adds the loser's known tiles to its own.
5. Remove the relation. Log `conquered`.

### 14.5 Trade (every year while trading)

- Each side, for each discovery the other owns and it lacks (requirements §12.7): gain it with chance `10% × avgInt / 100`.
- Each side learns a random 20% of the other's known tiles that are connected to it (maps are shared).
- Both get food × 1.05 that year (§11.5).

### 14.6 Absorb

The weaker group joins the stronger one: all people move over (band persons change `groupId`; village counts and sample members are merged and the sample resized to 64), food stock and herd are added, known tiles merged, discoveries merged (requirements apply), lineage = stronger's. If the result is ≥ 150 it becomes a village. Log `absorbed`: `Year 1203  Forest 2 absorbed Desert 4 (61 people)`.

---

## 15. Planned events

Events are set in setup and never change during the run. `at` is resolved at run start to the tile's **original** `regionId`; the event affects tiles whose original `regionId` matches (so it keeps the same shape even after breaches).

| Event | Settings | Effect |
|---|---|---|
| Drought | Area, start year, length (years), strength 1–100 | Rain × (1 − s/100). First and last year at half strength: × (1 − s/200) |
| Wet period | Area, start year, length, strength 1–100 | Rain × (1 + s/100), same ramp |
| Plague | Area, start year, strength 1–100 | Lasts `2 + round(3 × s / 100)` years (2–5). Monthly death × `1 + (s/50) × clamp(population/150, 0.2, 2) × (Taming ? 1.5 : 1)` for groups whose home is in the area. Each plague month counts as adversity for children |
| Harsh winters | Start year, length | Whole map. In winter months: plant regen ×0.5; gather, hunt and herd food ×0.5; deaths × 1.5 without Fire and × 1.2 without Clothing (on top of normal winter rules) |
| Animal die-off | Area, species, year | Month 0 of that year: that species' density × 0.2 in the area |
| Earthquake | Wall point, year | Month 0 of that year: breach at that wall tile (3×3 crossing). Forced contact |

Log at start and end: `Year 500  Planned event: Drought in Area 2 (strength 70) began`.

**Setup validation:** an earthquake point must be a wall tile; area events need a valid area; start years 0–10,000. Show errors inline in the event dialog.

---

## 16. Randomness, seeds and determinism

### 16.1 The RNG (`src/shared/rng.ts`)

One generator for the whole simulation: **sfc32**, seeded through **splitmix32**. The 4 × uint32 state is part of `SimState` and of every keyframe.

```ts
export type RngState = Uint32Array; // length 4

function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function createRng(seed: number): RngState {
  const sm = splitmix32(seed);
  const s = new Uint32Array([sm(), sm(), sm(), sm()]);
  for (let i = 0; i < 12; i++) nextU32(s); // warm up
  return s;
}

export function nextU32(s: RngState): number {
  let a = s[0]!, b = s[1]!, c = s[2]!, d = s[3]!;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  s[0] = a; s[1] = b; s[2] = c; s[3] = d;
  return t >>> 0;
}

export const float = (s: RngState) => nextU32(s) / 4294967296;          // [0, 1)
export const chance = (s: RngState, p: number) => float(s) < p;
export const int = (s: RngState, n: number) => Math.floor(float(s) * n);  // 0..n-1

// Irwin–Hall: sum of 4 uniforms, scaled to mean 0, sd 1. No log/sin needed.
export function gaussian(s: RngState): number {
  return (float(s) + float(s) + float(s) + float(s) - 2) * 1.7320508075688772;
}

// 2.3 → 2 or 3, with a 30% chance of 3
export function stochasticRound(s: RngState, x: number): number {
  const f = Math.floor(x);
  return f + (float(s) < x - f ? 1 : 0);
}
```

### 16.2 Rules

1. All simulation randomness comes from `state.rng`, in tick order. Nothing else.
2. Process groups by ascending id, persons by ascending id, tiles by ascending index, relations by (a, b).
3. Every sort must have a full tie-break (by id or index).
4. Use double buffers for tile updates that read neighbours (plants spread, animals).
5. Allowed math: `+ − × ÷`, `Math.sqrt`, `Math.floor`, `Math.ceil`, `Math.round`, `Math.min`, `Math.max`, `Math.abs`, `Math.imul`. Forbidden in `src/sim/`: `Math.random`, `Math.pow`, `Math.exp`, `Math.log`, trig, `Date`, `performance.now`. Add a unit test that scans `src/sim/**/*.ts` for these names.
6. Speed, pausing, viewing the past and rendering must never change simulation results.

### 16.3 Determinism test

Run a scenario for 300 years twice with the same seed → the **state hash** (FNV-1a over all typed arrays, plus a JSON of groups sorted by id) must be identical. Run with a different seed → the hash must differ. Run 300 years straight vs. "100 years, save keyframe, restore, 200 more" → identical.

---

## 17. Timeline (past view) and saving

### 17.1 Live state and view state

The worker keeps **`live`** (the real run) and, while the player looks at the past, a separate **`view`** state. `live` is never touched by viewing.

### 17.2 Keyframes

- Store a keyframe at year 0 and every **200 years** (`config.timeline.keyframeEveryYears`): a deep copy of `SimState` (typed arrays copied, objects cloned) including the RNG state.
- Memory cap **150 MB** (estimate by summing typed array byte lengths). If exceeded, drop every second keyframe except year 0 (the interval doubles).

### 17.3 Viewing a past year

1. Player drags the timeline to year Y (≤ live year) or clicks a log entry / graph point.
2. Worker copies the nearest keyframe ≤ Y into `view` and runs ticks **silently** (no frames) until year Y, month 0. It posts progress every 50 simulated years ("Rebuilding year 3,412…").
3. Worker posts a full frame of `view`. UI shows a "Viewing the past — year Y" banner, and filters log and graphs to ≤ Y (graphs show a vertical marker at Y).
4. **Play** while viewing continues `view` forward. Because of determinism it replays exactly what happened. When `view` reaches the live year and month, switch back to `live` and drop `view`.
5. **Back to now** drops `view` and shows `live` immediately.
6. Nothing can be edited while viewing the past.

### 17.4 Saving

| What | Where | Format |
|---|---|---|
| Map preset | `localStorage` key `pixelAges.map.<name>`, plus Export/Import file | `.map.json` = `MapData` |
| Run setup | Export/Import file, plus "recent runs" in `localStorage` | `.run.json` = `RunSetup` |

- Wrap every `localStorage` call in `try/catch` and show a clear message if storage is full or blocked.
- Typed arrays are stored as base64 strings of their bytes.
- Every file has `"version": 1`. Loading an unknown version shows "This file was made by a different version" and does nothing.
- A run is **not** saved as history: loading a `.run.json` and pressing Run with the same seed replays the exact same history.

Example (shortened):

```json
{
  "version": 1,
  "name": "Smart desert vs rich forest",
  "seed": 48213,
  "climateDrift": "slow",
  "map": { "version": 1, "width": 160, "height": 90, "ground": "AAAB…", "plantType": "…" },
  "founders": [
    { "id": 1, "name": "Forest", "colorIndex": 0, "x": 30, "y": 45,
      "people": [ { "sex": 0, "age": 22, "intelligence": 70, "cooperation": 50, "strength": 50 } ] }
  ],
  "events": [ { "kind": "drought", "at": { "x": 120, "y": 40 }, "startYear": 500, "lengthYears": 30, "strength": 70 } ]
}
```

---

## 18. Rendering

### 18.1 Palette (`src/render/palette.ts`)

**16 base colours:**

| Key | Hex | Used for |
|---|---|---|
| `ink` | `#1c1a24` | Outlines, doors, windows |
| `darkWood` | `#3e2b22` | Hair, antlers, legs, dark wood |
| `wood` | `#6e4a2e` | Wood, horse, soil |
| `clay` | `#a65e3a` | Clay resource, house walls, roofs |
| `mudBrick` | `#c98d5a` | House roof edge, deer |
| `sand` | `#e0c48a` | Desert, thatch, flat roofs |
| `skinLight` | `#f0c8a0` | Skin tone 0 |
| `skinMid` | `#c98f62` | Skin tone 1 |
| `skinDark` | `#8c5a3a` | Skin tone 2 |
| `forest` | `#2f5a2a` | Forest |
| `grass` | `#5a8f3c` | Grassland |
| `grassLight` | `#8cb84e` | Grass plant, crops |
| `water` | `#2c5d8f` | Water, river walls |
| `waterLight` | `#5d9cc9` | Water shimmer, rain overlay |
| `stone` | `#7f7f86` | Mountain ground, stone, wolves |
| `stoneLight` | `#b5b5ae` | Stone specks, goats, elder hair, city walls |

**Accents:** `copper #d07a2c`, `iron #6b3a3a`, `fruit #b8323a`, `fireOrange #e8833a`, `fireYellow #f4d35e`, `deepWater #1f4570`, `mountainDark #4a4a52`.

**Lineage (group) colours**, in this order: `#d94f4f` red, `#4f7fd9` blue, `#e0b030` yellow, `#9b59d0` purple, `#39b6a6` teal, `#e07b2f` orange, `#e05fa0` pink, `#6fcf4f` lime, `#f2f2f2` white, `#45c4e0` cyan. The dark variant `D` = each RGB channel × 0.7.

**Hair:** tone 0 `ink`, 1 `darkWood`, 2 `wood`; elders (60+) always `stoneLight`. **Skin:** tone 0–2 = `skinLight`, `skinMid`, `skinDark`. Both chosen at birth with the seeded RNG (visual only).

### 18.2 Canvases and scaling

- Main canvas: **1280 × 720** pixels, CSS size 1280 × 720, `image-rendering: pixelated`. Disable image smoothing in the 2D context.
- **Terrain** is drawn into an offscreen 1280 × 720 canvas and only redrawn for tiles that changed (dirty list). Each frame: draw terrain → sprites (sorted by y) → overlays.

### 18.3 Terrain: colour + grain

Each tile's base colour, then every pixel gets grain:

```
pixelColour = baseColour × (1 + 0.10 × (2 × hash01(px, py) − 1))     // ±10% brightness
```

`hash01` is a fixed integer hash of the **pixel** coordinates, so grain never flickers:

```ts
export function hash01(x: number, y: number, salt = 0): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
```

**Tile appearance:**

| Tile | Base colour | Extra |
|---|---|---|
| Grassland | `grass` | — |
| Desert | `sand` | — |
| Mountain ground | `stone` | 10% `stoneLight` specks, 10% `mountainDark` specks |
| Water ground | `water` | 6% `waterLight` specks; speck positions shift every 500 ms (use time as salt) |
| Grass plant | blend(ground, `grassLight`, density/255) | On Desert, blend only up to 40% |
| Forest | blend(ground, `forest`, density/255) | 8% `darkWood` specks × density |
| Fruit bushes | blend(ground, `#4f8a38`, density/255) | `fruit` specks: 8% × density |
| Farmland | stripes | Every 3rd pixel row `wood` (soil); other rows: spring `grassLight`, summer `grass`, autumn `sand`, winter `wood` |
| Resource | (on top of the above) | Specks of the resource colour: `(0.05 + 0.25 × amount/255)` of pixels. Stone `stoneLight`, Clay `clay`, Copper `copper`, Iron `iron` |
| River wall | `water` | Diagonal streaks: pixels where `(px + py + t) % 5 === 0` are `waterLight`; `t` steps every 300 ms |
| Mountain wall | `mountainDark` | 15% `ink` specks, 5% `stoneLight` specks |
| Sea wall | `deepWater` | 3% `waterLight` specks |
| Crossing on River/Sea wall | River/Sea look | Bridge sprite on top (§19.5) |
| Crossing on Mountain wall | `sand` | 10% `stone` specks (a pass) |

"Specks" = pixels where `hash01(px, py, salt) < share`. Use a different salt for each speck type.

**Extra terrain detail (decided with the owner, 14 October 2026).** Drawn in code in `src/render/terrainDetail.ts`, numbers in `config.render.detail`. These replace the water specks, sea-wall specks and forest `darkWood` specks above:

| Look | Rule |
|---|---|
| Water depth | Water ground and Sea walls shade from shallow (near land) through `water` to `deepWater`, using each tile's distance to land (8-way, capped at 4), blended smoothly between tile centres. Sea walls never look shallower than half depth and are a little darker, so they still read as walls |
| Waves | Small ⌒ marks (one per 14×7 px cell, 55% of cells) in `waterLight`, drifting right 1 px per water step; alternate rows drift at half speed. River walls keep their streaks |
| Shoreline foam | On water pixels touching land: `foam` at the edge, a second row that flickers (lapping) |
| Wet edge | Land pixels touching water: × 0.75 at the edge, × 0.88 one pixel in |
| Grass | Small 2 px blades with a shadow pixel on Grassland (more with the Grass plant), and a few yellow, white or red flowers |
| Forest | Dark forest floor, with round tree crowns (one possible per 4×4 px cell, more with density) lit top-left and shaded bottom-right. Crowns may overhang neighbouring land tiles |
| Mountains | Triangular peaks (5–8 px tall) with a light left slope, dark right slope and snow on tall peaks. Mountain walls use darker colours. Peaks only form where base and apex are the same mountain kind |
| Desert | Broken wavy dune crests (dark line with a lit row above) and scattered pebbles |

Because these looks reach one tile across, a changed tile also redraws its 8 neighbours.

### 18.4 Sprites

- Sprite grids from §19 live in `spriteData.ts` as string arrays.
- At startup, parse each grid and pre-render every needed variant (per lineage colour, skin, hair, legs/clothing state) into a small offscreen canvas. Cache by key, e.g., `adult_m|1|c3|s1|h0|clothed`.
- Draw at integer pixel positions. **Anchor = bottom-centre** (feet at the position). Sort all sprites by y before drawing.

### 18.5 What gets drawn

| Thing | Rule |
|---|---|
| Band people | Each person (cap 6,000 drawn; if more, draw the lowest ids). Sprite by sex and age: child (< 15), adult, elder (60+ = adult grid with elder hair) |
| Hunters | Person + spear overlay |
| Explorers with Riding | Rider composite |
| Village walkers | `min(ceil(population / 10), 40)` decorative adults (random sex/skin/hair from the village colour), wandering within 3 tiles of home |
| Huts / houses | Band: huts = shelters built (max 12 drawn). Village: houses (Mud Brick) or huts (max 30 drawn) |
| City buildings | With City: up to 30% of drawn houses become city buildings (max 12) |
| Building layout | Candidate tiles around home sorted by (distance², dy, dx). Place each building at the next candidate whose footprint (hut 1×1, house 2×2, city 2×3 tiles) is all land and free. Recompute only when counts change |
| Campfire | On the home tile when the group owns Fire (animated) |
| Herd | Goats near home: `min(ceil(herd / 10), 12)` |
| Raft / Boat | One at the water tile nearest home (within 3 tiles), if owned (Boat replaces Raft) |
| Cart | One next to the home tile if owned |
| Wild animals | Per 4×4-tile block and species: `floor(sum of density in block / 4 + Math.random())`, max 2 per block per species, max 400 total. They wander inside their block. Recompute when densities arrive (yearly) |
| Crossings | Bridge sprite on each River/Sea crossing tile |

### 18.6 Smooth movement (visual only)

- The renderer keeps a visual position for each person id.
- **Target** = centre of `workTile` + a fixed per-person offset (`hash01(id)` → ±3 px).
- The visual position moves toward the target at **24 px/s** (× 4 at 8× speed). While moving, walk frames alternate every 250 ms; when idle, show frame 1 and make a tiny random step (≤ 2 px) every 2 s.
- Children follow their mother's visual position (offset −3, +1 px). New babies appear at the mother. Dead people disappear.

### 18.7 Overlays and view modes

| Mode | Look |
|---|---|
| Normal | No overlay |
| Rain | `waterLight` over each tile with alpha = `rainNow / 100 × 0.6`. Turns on automatically while the Rain brush is selected |
| Fog | When a group is selected: its unknown tiles darkened (black, alpha 0.6) |
| Territory | Dotted circle of radius R around each home of the selected lineage |
| Areas (setup only) | 1 px light outline along area borders. Hovering an area while picking an event area fills it at alpha 0.2 |
| Hover | 1 px white outline on the hovered tile |

### 18.8 Zoom

`Z` toggles 2× zoom: shows a 640 × 360 pixel part of the map scaled 2×, centred on the cursor. Pan with right-mouse drag or arrow keys / WASD. Clamp to the map edges.

### 18.9 Performance targets

60 fps at 1× on a mid-range laptop with 6,000 people sprites, 400 animals and 300 buildings. Use cached sprite canvases and avoid allocating objects in the draw loop.

---

## 19. Sprite spec sheet

Every sprite is a pixel grid. Copy these grids **exactly** into `src/render/spriteData.ts` as string arrays. Each block is: `name`, `size: WxH`, then H rows of W characters.

### 19.1 Legend

| Char | Colour |
|---|---|
| `.` | Transparent |
| `K` | `ink` |
| `H` | Person's hair colour (elders: `stoneLight`) |
| `S` | Person's skin colour |
| `C` | Lineage colour |
| `D` | Lineage colour dark (× 0.7) |
| `L` | Legs: `S` before the group has Clothing, `D` after |
| `W` | `wood` |
| `w` | `darkWood` |
| `Y` | `sand` |
| `M` | `mudBrick` |
| `m` | `clay` |
| `G` | `stone` |
| `g` | `stoneLight` |
| `F` | `fireOrange` |
| `f` | `fireYellow` |

**Facing:** people face the viewer. Animals, raft, boat and cart face **right**; flip them horizontally when moving left.
**Anchor:** bottom-centre of the grid = the sprite's position (feet / ground contact).

### 19.2 People

```sprite
name: adult_m_1
size: 4x6
.HH.
.SS.
SCCS
.CC.
.LL.
L..L
```

```sprite
name: adult_m_2
size: 4x6
.HH.
.SS.
SCCS
.CC.
.LL.
.LL.
```

```sprite
name: adult_f_1
size: 4x6
.HH.
HSSH
SCCS
.CC.
.CC.
L..L
```

```sprite
name: adult_f_2
size: 4x6
.HH.
HSSH
SCCS
.CC.
.CC.
.LL.
```

```sprite
name: child_1
size: 3x4
.H.
.S.
SCS
L.L
```

```sprite
name: child_2
size: 3x4
.H.
.S.
SCS
.L.
```

```sprite
name: spear
size: 1x5
G
W
W
W
W
```

- **Elder (60+):** the adult grid of their sex with `H` = `stoneLight`.
- **Hunter:** adult + `spear` drawn at offset (+4, 0) from the adult's top-left → 5×6 total.
- **Walk cycle:** frame 1 ↔ frame 2 every 250 ms while moving.

### 19.3 Animals

```sprite
name: deer_1
size: 6x5
.....w
....MM
YMMMM.
.MMMM.
.w..w.
```

```sprite
name: deer_2
size: 6x5
.....w
....MM
YMMMM.
.MMMM.
w..w..
```

```sprite
name: wolf_1
size: 6x4
G...GG
GGGGG.
.GGGG.
.K..K.
```

```sprite
name: wolf_2
size: 6x4
G...GG
GGGGG.
.GGGG.
K..K..
```

```sprite
name: goat_1
size: 5x4
...wg
gggg.
gggg.
.w.w.
```

```sprite
name: goat_2
size: 5x4
...wg
gggg.
gggg.
w..w.
```

```sprite
name: horse_1
size: 7x5
.....wW
.....WW
wWWWWW.
.WWWWW.
.w...w.
```

```sprite
name: horse_2
size: 7x5
.....wW
.....WW
wWWWWW.
.WWWWW.
w...w..
```

- **Rider** (explorers with Riding): draw `horse_n` at offset (0, +2), then the top 4 rows of `adult_m_1` or `adult_f_1` (head, face, arms, body) at offset (+1, 0) → 7×7 total. Animate with the horse frames.

### 19.4 Buildings

```sprite
name: hut
size: 8x8
...WW...
..WYYW..
.WYYYYW.
WYYYYYYW
WYYKKYYW
WYYKKYYW
.WWWWWW.
........
```

```sprite
name: house
size: 16x16
................
.MMMMMMMMMMMMMM.
.MYYYYYYYYYYYYM.
.MYYYYYYYYYYYYM.
.MYYYYYYYYYYYYM.
.MYYYYYYYYYYYYM.
.MMMMMMMMMMMMMM.
.mmmmmmmmmmmmmm.
.mmKKmmmmmmKKmm.
.mmKKmmmmmmKKmm.
.mmmmmmKKmmmmmm.
.mmmmmmKKmmmmmm.
.mmmmmmKKmmmmmm.
.mmmmmmKKmmmmmm.
.wwwwwwwwwwwwww.
................
```

```sprite
name: city
size: 16x24
....wwwwwwww....
...wmmmmmmmmw...
..wmmmmmmmmmmw..
.wmmmmmmmmmmmmw.
wmmmmmmmmmmmmmmw
wmmmmmmmmmmmmmmw
wwwwwwwwwwwwwwww
.gggggggggggggg.
.gKKgggKKgggKKg.
.gKKgggKKgggKKg.
.gggggggggggggg.
.GGGGGGGGGGGGGG.
.gggggggggggggg.
.gKKgggKKgggKKg.
.gKKgggKKgggKKg.
.gggggggggggggg.
.GGGGGGGGGGGGGG.
.gggggggggggggg.
.gKKggggggggKKg.
.gKKgggKKgggKKg.
.ggggggKKgggggg.
.ggggggKKgggggg.
.ggggggKKgggggg.
.GGGGGGGGGGGGGG.
```

Hut = 1 tile. House = 2×2 tiles. City building = 2×3 tiles.

### 19.5 Objects

```sprite
name: campfire_1
size: 3x3
.F.
FfF
WwW
```

```sprite
name: campfire_2
size: 3x3
.fF
Ff.
WwW
```

```sprite
name: raft
size: 6x3
WWWWWW
wWwWwW
WWWWWW
```

```sprite
name: boat
size: 8x3
W......W
WWWWWWWW
.wwwwww.
```

```sprite
name: cart
size: 7x4
WWWWW..
WwwwW..
WWWWWWw
.K..K..
```

```sprite
name: bridge
size: 8x8
wWWWWWWw
wWWWWWWw
wwwwwwww
wWWWWWWw
wWWWWWWw
wwwwwwww
wWWWWWWw
wWWWWWWw
```

The campfire alternates frames every 250 ms. The bridge fills one crossing tile exactly (top-left anchored, not bottom-centre).

### 19.6 Parsing rule

```ts
// spriteData.ts
export const SPRITES: Record<string, { w: number; h: number; rows: string[] }> = {
  adult_m_1: { w: 4, h: 6, rows: ['.HH.', '.SS.', 'SCCS', '.CC.', '.LL.', 'L..L'] },
  // … every sprite from §19.2–19.5
};
```

Add a unit test: every sprite's row count equals `h`, every row length equals `w`, and every character is in the legend.

---

## 20. UI and controls

### 20.1 Screen layout

```
┌────────┬────────────────────────────────────────────┬──────────────────┐
│ Tools  │                                            │ Right panel      │
│ 72 px  │          Map canvas 1280 × 720             │ 320 px, tabs     │
│        │                                            │                  │
├────────┴────────────────────────────────────────────┴──────────────────┤
│ Bottom bar 80 px:  ▶/❚❚  1×  8×  Step │ Year 412 · Summer │ timeline ──│
└────────────────────────────────────────────────────────────────────────┘
```

Total 1672 × 800 px. Dark UI theme (`#1c1a24` background, `#e8e2d4` text), pixel-style font for headings is optional; body text uses the system UI font at 13 px.

### 20.2 Setup mode

**Toolbar** (left), grouped by layer. Each button = a colour swatch + tooltip name:

| Group | Buttons |
|---|---|
| Ground | Grassland, Desert, Water, Mountain |
| Plants | Forest, Fruit bushes, Grass, Eraser |
| Resources | Stone, Clay, Copper, Iron, Eraser |
| Rain | Rain |
| Animals | Prey, Predator, Herd, Riding, Eraser |
| Walls | River, Mountain, Sea, Eraser |
| People | Place group |
| Options | Brush size 1 / 3 / 5 / 9 / 15 · Strength 0–100% · Fill bucket · Undo · Redo |

- Brush = filled circle of diameter "size" tiles. Interpolate between mouse positions while dragging so fast strokes have no gaps.
- **Strength** sets plant density, resource amount, rain value and animal density.
- **Fill bucket** fills the 4-connected region of tiles that share the clicked tile's value **in the current layer**.
- **Undo/redo:** 50 strokes. Each stroke stores (layer, tile index, old value, new value).
- Hovering shows the tile info in a small tooltip (ground, plant, resource, rain, area).

**Right panel tabs:**

| Tab | Contents |
|---|---|
| Groups | List of placed groups (colour, name, men/women, traits). Edit, Move (then click the map), Delete |
| Events | List sorted by year. Add (+), Edit, Delete |
| Run | Run name, Seed (number + 🎲 random), Climate drift (Off / Slow / Strong), validation messages, big **Run ▶** button |
| Maps | New map, Save preset, Load preset, Export map, Import map, Export run, Import run |

### 20.3 Run mode

- **Toolbar** becomes view controls: Normal / Rain / Fog / Territory, Zoom 2×, and **Stop run** (confirm: "Stop and return to setup? You can replay this exact run any time with the same seed.").
- **Right panel tabs:** Inspect | Graphs | Log (§21).
- **Bottom bar:** Play/Pause, 1×, 8×, Step (paused only), "Year 412 · Summer", real speed ("1.0 years/s"), timeline slider 0 → live year, **Back to now** (visible when viewing the past), and the past banner.
- Painting is disabled during a run.

### 20.4 People dialog

| Field | Default | Range |
|---|---|---|
| Name | "Group N" | 1–20 characters |
| Colour | Next unused lineage colour | 10 colours |
| Men | 2 | 0–20 |
| Women | 2 | 0–20 |
| Ages | 18 to 30 | 0–60 |
| Intelligence | 100 | 60–160 |
| Cooperation | 50 | 0–100 |
| Strength | 50 | 0–100 |
| Natural variation | Off | When on, each person gets ± `gaussian × setupSpreadSd` |

- Pressing **Create** generates the explicit list of `FounderPerson` (ages uniform in the range). Using `Math.random` here is fine: the generated people are saved in the setup, so runs stay repeatable.
- An "Edit each person" section lists the people so the owner can change any single person.
- Warning if Men = 0 or Women = 0: "This group can't have children and will die out." Error if total is 0 or more than 40.

### 20.5 Event dialog

- Kind selector, then the fields from §15.
- **Pick area on map:** the cursor changes, hovered area highlights, click selects ("Area 2").
- **Pick wall point** (earthquake): only wall tiles can be clicked.
- Inline validation errors.

### 20.6 Run validation

| Level | Check |
|---|---|
| Error | No groups |
| Error | A group's home is on Water or a wall |
| Error | Any invalid event |
| Warning | A group can't have children |
| Warning | A group has no Forest, Fruit bushes, Grass or prey within 6 tiles ("may starve quickly") |
| Warning | Two groups' homes are within 12 tiles in the same area ("they'll meet immediately") |

Errors disable the Run button; warnings show but allow running.

### 20.7 Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| 1 / 8 | Speed 1× / 8× |
| . | Step one month (paused) |
| Z | Zoom 2× on/off |
| Arrows / WASD | Pan when zoomed |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo (setup) |
| [ / ] | Brush size down / up |
| F | Fill bucket on/off |
| I / G / L | Inspect / Graphs / Log tab |
| Esc | Cancel picking, deselect |

### 20.8 Tutorial (step 7)

On first launch, a 5-card overlay: 1 Paint the world → 2 Place people → 3 Add events (optional) → 4 Seed & Run → 5 Read the results. Buttons: "Next", "Skip", and **"Load the example"** (Scenario B, §26). Remember "seen" in `localStorage` (with `try/catch`).

---

## 21. Results: inspector, graphs, event log

### 21.1 Inspector

Click the map: selects the tile, plus the clicked person (band mode, within 3 px) or the group whose home or buildings were clicked. Refresh about 4 times per second.

| Card | Fields |
|---|---|
| Tile | Position (km), area, ground, plant + density %, food stock, resource + amount, rain (painted / now), animal densities, wall / crossing, groups that know it |
| Group | Name, lineage, mode (band/village), population (men / women / children / elders), era name, discoveries (inactive ones marked), average potential vs actual for intelligence, cooperation, strength, food stock, hunger H, crowding, pressure, herd, farm tiles, home, known tiles (% of its area), relations (with whom, kind, since), founded year, "can't have children" flag, **Follow** button (turns on fog + territory for it) |
| Person | Sex, age, partner, children count, potential vs actual traits ("developing" if under 15), health, fed, nutrition, current action, work tile |

### 21.2 Graphs

- Charts: **Population** (log-scale toggle), **Intelligence** (actual solid line, potential dashed), **Cooperation**, **Strength**, **Era** (best and average), **Food** (average fed ratio).
- One line per lineage in its colour. Legend checkboxes hide/show lineages.
- X axis: years 0 → live year. Hover shows a tooltip with every lineage's value at that year. **Click → jump the timeline to that year.** A vertical marker shows the viewed year.
- Drawn with Canvas 2D (no library). If a lineage has more than 2,000 points, draw every n-th year.

### 21.3 Event log

- One line per entry: `Year 412   Desert 2   discovered Taming` with a lineage colour dot.
- Order toggle: newest first / oldest first.
- Filters: lineages (checkboxes) and type groups:

| Filter group | Log types |
|---|---|
| Discoveries & eras | discovery, lostDiscovery, eraUp, eraDown, ranOut |
| Movement | split, migrate, becameVillage, becameBand |
| Contact | firstContact, tradeStart, war, conquered, absorbed |
| World | breach, event |
| Life | groupExtinct, lineageExtinct, cannotReproduce |
| System | perf |

- **Click a line → jump to that year**, select that group, and centre on it if zoomed.
- Virtualised list (only visible rows are in the DOM). Keep at most 50,000 entries (drop the oldest).

---

## 22. Worker message protocol (`src/shared/protocol.ts`)

```ts
export type ToWorker =
  | { type: 'start'; setup: RunSetup }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; value: 1 | 8 }
  | { type: 'step' }
  | { type: 'viewYear'; year: number }
  | { type: 'backToNow' }
  | { type: 'inspect'; x: number; y: number }          // tile coordinates
  | { type: 'select'; groupId: number | null }
  | { type: 'stop' };

export type FromWorker =
  | { type: 'started'; areas: AreaInfo[] }
  | { type: 'frame'; frame: Frame }
  | { type: 'stats'; rows: YearStats[] }               // new rows since the last message
  | { type: 'log'; entries: LogEntry[] }               // new entries since the last message
  | { type: 'inspectResult'; result: InspectResult }
  | { type: 'progress'; label: string; done: number; total: number }
  | { type: 'error'; message: string };

export interface AreaInfo { regionId: number; name: string; tileCount: number; centerX: number; centerY: number }

export interface Frame {
  year: number;
  month: number;
  isPast: boolean;
  liveYear: number;
  yearsPerSecond: number;
  // 7 bytes per tile: ground, plantType, plantDensity, resourceType, resourceAmount, rainNow, wall | (crossing << 4)
  fullTiles?: Uint8Array;        // all tiles: on start and after a timeline jump
  tileUpdates?: Uint8Array;      // only changed tiles: [index lo, index hi, 7 bytes] repeated
  people: Float32Array;          // 8 floats per person, see below
  groups: GroupView[];
  animalDensity?: Uint8Array;    // 4 × tiles, 0–255, sent once per year and on jumps
  selectedKnown?: Uint8Array;    // known bitset of the selected group, when it changes
}
// people: [id, workX, workY, colourIndex, flags, motherId, skin * 3 + hair, action]
// flags bits: 0 sex (1 = female), 1–2 age class (0 child, 1 adult, 2 elder), 3 clothed, 4 riding

export interface GroupView {
  id: number; name: string; lineageId: number; colourIndex: number; mode: number;
  homeX: number; homeY: number; population: number; era: number; discoveries: number;
  huts: number; houses: number; herd: number; range: number;
}

export interface InspectResult {
  tile: Record<string, string | number>;
  group: Record<string, unknown> | null;
  person: Record<string, unknown> | null;
}
```

- Transfer typed-array buffers (`postMessage(msg, [buffers])`) — never copy large arrays.
- At most 30 frames per second. Tile updates collect between frames.
- The area-finding function in `src/sim/world/regions.ts` is pure, so the editor's live area preview imports and reuses it on the main thread.

---

## 23. `config.ts` — every tunable number

This is the starting configuration. Tuning (step 7) changes values here only.

```ts
// src/config.ts — every tunable number lives here. Units: tiles (1 km), months, FU.
export const CONFIG = {
  map: { width: 160, height: 90, tilePx: 8 },

  time: {
    ticksPerYear: 12,
    ticksPerSecond1x: 12,        // 1 year per second
    fastMultiplier: 8,           // the 8× button
    maxFramesPerSecond: 30,
    maxWorkMsPerLoop: 50,
  },

  seasonOfMonth: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3], // 0 spring, 1 summer, 2 autumn, 3 winter

  rain: { factorDivisor: 60, factorMax: 1.3 },

  climate: {
    cellsX: 8, cellsY: 5,
    reversion: 0.995,
    sigma: { off: 0, slow: 0.01, strong: 0.025 },
    minMult: 0.3, maxMult: 1.7,
  },

  plants: {
    maxStock: [0, 1.5, 3.0, 0.4, 0],  // FU by Plant id: None, Forest, FruitBushes, Grass, Farmland
    regenRate: 0.2,
    seasonRegen: [1.2, 1.0, 0.8, 0.2],
    growPerYear: 26,
    diePerYear: 13,
    forest: { dieBelowRain: 25, fullAtRain: 50, spreadMinRain: 55, spreadChance: 0.02, groundMult: [1, 0, 0, 0.5] },
    fruit:  { dieBelowRain: 30, fullAtRain: 40, spreadMinRain: 40, spreadChance: 0.01, groundMult: [1, 0, 0, 0] },
    grass:  { dieBelowRain: 10, fullAtRain: 30, spreadMinRain: 15, spreadChance: 0.05, groundMult: [1, 0.4, 0, 0.5] },
    spreadSourceMinDensity: 128,
    newPlantDensity: 26,
    farmlandIdleYears: 3,
    farmlandRevertDensity: 128,
  },

  ground: { desertifyBelowRain: 10, desertifyYears: 50, greenAtRain: 30, greenYears: 50 },

  animals: {
    // suitability by Ground id [Grassland, Desert, Water, Mountain]; tiles with Forest density ≥ forestMinDensity use `forest`
    prey:   { ground: [0.8, 0.1, 0, 0.3], forest: 1.0, growth: 0.03 },
    herd:   { ground: [1.0, 0.4, 0, 0.8], forest: 0.2, growth: 0.02 },
    riding: { ground: [1.0, 0.2, 0, 0.1], forest: 0.1, growth: 0.015 },
    forestMinDensity: 128,
    capacityRainBase: 0.3,       // K = suitability × clamp(0.3 + rain/100, 0.3, 1)
    noHabitatDecay: 0.05,
    predation: 0.05,
    predatorGain: 0.02,
    predatorDeath: 0.01,
    diffusion: 0.03,
    foundAtDensity: 0.05,
  },

  people: {
    founderKnownRadius: 3,
    ages: { adult: 15, elder: 60, maxAge: 100, explorerMaxAge: 45, hunterMaxAge: 59 },
    foodNeed: { child: 0.6, adult: 1.0, elder: 0.8 },
    birth: { minAge: 16, maxAge: 40, monthlyChance: 0.05, hungryMonthlyChance: 0.025, nursingMonths: 24, hungryAboveH: 60 },
    // annual 6%, 1%, 1.5%, 3%, 6%, 15% → monthly = 1 − (1 − annual)^(1/12), precomputed
    deathMonthly: [
      { upToAge: 5, p: 0.00514 },
      { upToAge: 15, p: 0.000837 },
      { upToAge: 50, p: 0.001259 },
      { upToAge: 60, p: 0.002535 },
      { upToAge: 70, p: 0.00514 },
      { upToAge: 101, p: 0.01345 },
    ],
    deathMult: { starving: 3, malnourished: 1.5, harshHomeNoClothing: 1.5, winterNoFire: 1.3, mudBrick: 0.8, lowHealth: 2 },
    fed: { starvingBelow: 0.5, malnourishedBelow: 0.8 },
    health: { max: 100, starvingLoss: 20, injuryLoss: 30, regen: 10, restRegen: 20, lowBelow: 30, restBelow: 70 },
    predators: { attackBase: 0.01, spearMult: 0.5, hunterExposure: 1.5, deathShare: 0.5, strDivisor: 200, coopDivisor: 300 },
    traits: {
      intelligence: { min: 40, max: 180, setupMin: 60, setupMax: 160, mendelSd: 7.5, setupSpreadSd: 7.5 },
      cooperation:  { min: 0, max: 100, setupMin: 0, setupMax: 100, mendelSd: 5, setupSpreadSd: 5 },
      strength:     { min: 0, max: 100, setupMin: 0, setupMax: 100, mendelSd: 5, setupSpreadSd: 5 },
    },
    environment: {
      goodNutrition: 0.9,
      intNutritionSlope: 40, intNutritionMin: -20,
      intLearningPerEra: 1.5, intLearningWriting: 3, intLearningMax: 10,
      strNutritionSlope: 30, strNutritionMin: -25,
      coopAdversityPenalty: 15, coopGoodChildhoodBonus: 5,
      strFoodFloor: 0.7, strAgingFromAge: 50, strAgingPerYear: 0.015, strAgingMin: 0.4,
    },
    food: {
      spoilage: 0.10, spoilagePottery: 0.06,
      gatherCap: 2.0, stoneToolsGatherMult: 1.2,
      huntBaseSuccess: 0.5, huntNoToolsMult: 0.5, huntSpearMult: 1.5, huntCoopDivisor: 200,
      huntMaxSuccess: 0.95, huntYield: 3.0, huntDepletion: 0.01,
      farmerCap: 2.0, farmersPerTile: 10, farmMinRain: 30, irrigationDistance: 2,
      farmSeason: [0.4, 0.93, 2.67, 0], ironFarmMult: 1.2,
      herdPerHerder: 20, herdYieldPerAnimal: 0.08, herdGrowth: 0.015, herdCapturePerHerder: 2, herdCapacityPerTile: 5,
      cookedMult: 1.15, copperMult: 1.15, intYieldDivisor: 400, tradeMult: 1.05,
    },
    distribution: { selfishness: 0.5, childBase: 0.5, carerMult: 0.7 },
    hunger: { fedWeight: 200, storageWorry: 30, storageWorryPerMonth: 7.5, fedMonths: 3 },
    care: { reductionPerCarer: 0.02, minMult: 0.7 },
    teach: { minAge: 50, minInt: 90, perShare: 3, maxBonus: 0.3, villageShare: 0.3 },
    build: { hutMonths: 2, houseMonths: 6, familiesPerHut: 1, familiesPerHouse: 3, villagePeoplePerHouse: 10, villagePeoplePerHut: 5 },
    range: { forage: 6, explore: 8, migrate: 25, cartExploreMult: 2, ridingExploreMult: 3, cartMigrateMult: 2, ridingMigrateMult: 2 },
    reveal: { base: 2, intStart: 60, intStep: 40, min: 1, max: 5 },
    brain: {
      nudge: 10,
      gatherBase: 15,
      huntBase: 15, huntNoToolsMult: 0.5, huntSpearMult: 1.3,
      farmBase: 25, farmHungerWeight: 0.8, farmSeasonBonus: 20,
      herdBase: 20, herdHungerWeight: 0.5,
      exploreBase: 10, exploreIntDivisor: 2, exploreCrowdWeight: 40, exploreCrowdStart: 0.9, exploreHungerWeight: 0.5,
      careKidsWeight: 40, careHungerWeight: 0.5,
      buildBase: 25, buildPerFamily: 5,
      wallWeight: 70,
      restWeight: 1.5,
      teachBase: 20, teachIntDivisor: 2, teachKidsWeight: 20,
    },
    groupSize: { bandMax: 60, toVillageAt: 150, toBandBelow: 100 },
    split: { crowdingAbove: 1.1, months: 12, bandChance: 0.10, villageChance: 0.05, coopBase: 1.2, bandShare: 0.4, villageShare: 0.3, minDistanceR: 2 },
    migrate: { hungerAbove: 60, months: 3, plantAvailBelow: 0.4, farmerHungerAbove: 80, farmerMonths: 12, logMinDistance: 10, distancePenalty: 0.5, sampleStep: 2 },
    village: { sampleSize: 64, revealsPerExplorer: 0.2, birthIntervalMonths: 44, fertileShare: 25 / 35, traitHazardDivisor: 250 },
    sustainable: { plantShare: 0.1, preyValue: 0.3 },   // plantShare = regenRate × 0.5
  },

  discoveries: {
    baseChanceByEra: [0.02, 0.015, 0.01, 0.007, 0.005, 0.003],
    forgetLimitByEra: [5, 10, 20, 40, 80, 150],
    forgetYears: 10,
    writingChanceMult: 1.3,
    resourceUsePer: 50,
    cityMinPop: 500,
  },

  walls: {
    health: { river: 100, mountain: 200, sea: 300 },
    minPressure: 0.4,
    wearPerWorkerMonth: 0.05,
    ridingWearMult: 1.2,
    breachRadius: 1,
    inactivePressure: 0.5,
    crowdingPressureStart: 0.9,
    crowdingPressureScale: 5,
  },

  contact: {
    reviewYears: 10, pressureChangeReview: 0.3,
    sameLineageCoopBonus: 30,
    powerStrBase: 0.5,
    warPressureWeight: 60, warCoopWeight: 0.4, warRatioBonusAt: 1.5, warRatioBonus: 10,
    tradeCoopWeight: 0.6, tradeFedBonus: 20, tradeFedBelowH: 30, tradeDiffBonus: 10,
    absorbRatio: 3, absorbBase: 30, absorbRatioWeight: 5, absorbRatioCap: 10, absorbHungerWeight: 0.3,
    coexistScore: 35, nudge: 10,
    battleBase: 0.8, battleRandom: 0.4,          // eff = power × (0.8 + 0.4 × U)
    loserLossBase: 0.10, loserLossScale: 0.20, winnerLossBase: 0.05, winnerLossScale: 0.10,
    deathWeightStrength: 150,
    conquerMinPop: 20, conquerPowerShare: 0.5,
    captureShare: 0.5, refugeeMinPeople: 4, refugeeMinDistance: 12,
    gainDiscoveryChance: 0.5,
    tradeLearnChance: 0.10, tradeTileShare: 0.2,
    warAdversityMonths: 3,
    warMult: { riding: 1.3, copperWorking: 1.2, ironWorking: 1.4 },
    gridCell: 16,
  },

  events: {
    rampYears: 1,
    plagueMinYears: 2, plagueExtraYears: 3,      // years = 2 + round(3 × s / 100)
    plagueDensityPop: 150, plagueDensityMin: 0.2, plagueDensityMax: 2, plagueTamingMult: 1.5,
    harshWinterRegenMult: 0.5, harshWinterFoodMult: 0.5, harshWinterNoFireMult: 1.5, harshWinterNoClothingMult: 1.2,
    dieOffMult: 0.2,
    maxYear: 10000,
  },

  timeline: { keyframeEveryYears: 200, memoryCapMB: 150, progressEveryYears: 50 },

  perf: { maxIndividuals: 30000 },

  log: { maxEntries: 50000 },

  render: {
    grain: 0.10,
    maxPeopleSprites: 6000,
    maxAnimalSprites: 400, animalBlock: 4, animalsPerBlockMax: 2,
    villageWalkersPer: 10, villageWalkersMax: 40, villageWalkRadius: 3,
    walkSpeedPx: 24, fastWalkMult: 4, walkFrameMs: 250, idleStepMs: 2000, personOffsetPx: 3,
    maxHutsDrawnBand: 12, maxBuildingsDrawn: 30, cityShare: 0.3, maxCityDrawn: 12,
    herdPerSprite: 10, maxHerdDrawn: 12,
    waterShimmerMs: 500, riverFlowMs: 300,
    fogAlpha: 0.6, rainOverlayAlpha: 0.6, areaHoverAlpha: 0.2,
  },
} as const;
```

If you find a constant inside a formula in this document that isn't listed here, add it to `config.ts` with a comment rather than hard-coding it.

---

## 24. Build plan — 7 steps with acceptance criteria

After each step: run all tests, start the dev server, show the owner what to try, and **wait for approval**.

### Step 1 — Map and brushes (no simulation)

**Build:**
1. Project setup (§4), `CLAUDE.md`, folder skeleton (§6), `config.ts`, `ids.ts`, `types.ts`.
2. Layout (§20.1) with placeholder panels. Canvas 1280×720, pixelated.
3. Palette, `hash01`, terrain renderer with grain and every tile look in §18.3, dirty-tile redraw.
4. Sprite parser + cache (§18.4) with the people and animal grids.
5. `MapData` create/clone, default new map.
6. All brushes (§8.2, §20.2): size, strength, drag interpolation, erasers, fill bucket, undo/redo.
7. Live area preview (§8.3) with outlines.
8. People placement + People dialog (§20.4). Placed groups drawn as standing adult sprites in their colour.
9. Painted animals drawn as decorative wild animal sprites (§18.5).
10. Rain overlay while the Rain brush is selected.
11. Maps tab: new, save/load preset, export/import map and run files (§17.4).

**Tests:** grid helpers, `hash01` stability, sprite grid sizes, save round trip (byte-identical), fill bucket, area computation (a diagonal wall line splits areas).

**Acceptance:**
- Every layer can be painted; fast strokes have no gaps.
- Fill bucket only fills the connected same-value region.
- Undo/redo works for 50 strokes.
- Grain looks identical after reload; water shimmers; rivers flow.
- Area outlines update after painting walls.
- Save → reload gives an identical map.
- Group placement is refused on Water/walls; missing-sex warning shows.
- 60 fps while painting.

### Step 2 — Living world (no people yet)

**Build:**
1. Worker, protocol (§22), loop, speeds (1×, 8×), pause, step (§9).
2. RNG (§16), `SimState` from `RunSetup`, serialize/restore.
3. Regions, wall segments, union-find (§8.3).
4. Climate drift and rain now (§10.1).
5. Plants: regen, yearly growth/death/spread, ground change (§10.2–10.3).
6. Animals (§10.4) + animal sprites from densities.
7. Tile diffs to the renderer.
8. Run tab: seed + dice, drift setting, Run / Stop.
9. Timeline: keyframes, view year, play from past, back to now (§17).
10. Bottom bar: year · season, real speed.

**Tests:** RNG sequence fixed for seed 1 (snapshot), determinism (§16.3), plants die at rain 0, plants spread, ground change after 50 years, animal capacity, timeline replay equals live, batch-size independence (run 100 years 1 tick at a time vs 96 at a time → same hash), forbidden-API scan.

**Acceptance:**
- Forest painted at rain 0 is gone within about 20 years. Forest at rain 70 spreads into grassland next to it.
- Grassland at rain 5 becomes desert after 50 years.
- Prey settle near capacity; predators and prey rise and fall.
- Same seed → identical result at year 500. Different seed with drift on → different result.
- Viewing year 250 and playing forward reaches exactly the live state.
- 1× shows 1 year per second; 8× works.

### Step 3 — People (band mode)

**Build:**
1. `PersonPool` (§7.4), founders (§11.1), lineages and names.
2. Pairing, births, deaths, aging, health, predators (§11.9, §11.6).
3. Inheritance and environment (§11.3–11.4).
4. Food: gather, hunt, spoilage, distribution, hunger, range signals (§11.5). Farm/Herd return "not allowed" until step 4.
5. Brain (§11.6) with Gather, Hunt, Explore, Care, Build (huts), Rest, Teach.
6. Exploring: known, frontier, reveal radius, no seeing across walls (§11.7).
7. Migration and splitting (§11.8).
8. Renderer: people sprites, walk animation, children follow mothers, spears for hunters, huts (§18.5–18.6).
9. Fog overlay for the selected group. Basic inspector (tile, group, person) and basic log (split, migrate, extinct, cannotReproduce).
10. Test fixture generators for Scenario A and B in `tests/fixtures.ts` (§26).

**Tests:** survival curve from the death table (100,000 simulated people, no modifiers, within ±10% of the table), inheritance mean and spread (10,000 children), distribution shares under shortage, frontier never crosses a wall, splits move whole families, determinism with people.

**Acceptance:**
- Scenario A: the lineage is alive at year 100 in at least 7 of 10 seeds; bands stay roughly 15–60 people and split.
- A group placed in empty desert declines and dies or migrates.
- The fog shows exploration spreading over time.
- People walk smoothly between work spots; hunters carry spears.
- 5,000 band people at 1× keep 60 fps.

### Step 4 — Discoveries and eras

**Build:**
1. Discovery table (§12.1), "found" checks (§12.2), yearly rolls with teach bonus (§12.3).
2. Every effect wired, including Farm and Herd actions, farm tiles and farmland look, Pottery spoilage, Mud Brick houses, Raft passability + frontier rebuild, Clothing visuals.
3. Eras (§12.4), forgetting with cascade (§12.5), resource use and inactive discoveries (§12.6).
4. Campfire, raft, boat, cart sprites.
5. Logs and inspector discovery list; era name shown on groups.

**Tests:** no discovery without its found requirement; chance formula equals the §12.3 example; era rule cases; forgetting cascade; running out of a resource makes a discovery inactive and adds pressure; Raft opens water tiles in the frontier.

**Acceptance:**
- Scenario A: first discoveries usually within the first 50–150 years.
- Farming only appears where Grassland with rain ≥ 30 is known. Farm tiles change colour with the seasons; winter is survived on stored food.
- A map without Stone never gets Stone Tools.
- Forcing a population crash makes a discovery disappear after 10 years, the era drops, and the log says so.

### Step 5 — Villages, walls and contact

**Build:**
1. Village mode (§11.10): counts, sample, labour, births/deaths/aging, yearly sample update; switching both ways; performance guard.
2. Village visuals: walkers, houses, city buildings, herd goats.
3. Walls (§13): pressure, targets, wear, breach, crossings, bridge and pass visuals, frontier rebuild.
4. Contact (§14): detection, decisions, battles, conquest, refugees, trade, absorb; relations in the inspector; logs.

**Tests:** switching band ↔ village keeps population exactly and trait averages within 2%; walls only worn with the right discovery and pressure ≥ 0.4; breach merges regions; battle numbers match §14.4; absorb only when ratio ≥ 3; trade teaches discoveries; determinism with everything on.

**Acceptance:**
- A group passing 150 shows village visuals; dropping below 100 shows individuals again with no jumps in the graphs.
- Scenario B: the river is breached only after Boat and under pressure.
- Across 10 seeds, contact produces a mix of trade, war and absorb (not always war).
- Scenario D runs 10,000 years at 8× without errors and stays under 1 GB of memory.

### Step 6 — Events, graphs, full inspector

**Build:**
1. Event dialog, list and validation (§20.5); all six event effects and logs (§15).
2. Graphs (§21.2).
3. Log filters, click-to-jump (§21.3).
4. Full inspector (§21.1), Follow button, territory overlay.
5. Run validation (§20.6). Run files include events.

**Tests:** drought lowers rain only in its area; wet period raises it; plague raises deaths more in villages with Taming; die-off cuts density to 20%; earthquake breaches; events replay deterministically; saving and loading a run reproduces the same hash.

**Acceptance:**
- Scenario C: the drought visibly lowers rain and population in its area; the plague hits villages harder than bands.
- Clicking a log line or a graph point jumps the timeline to that year.
- A saved run, loaded and run again, produces the identical history.

### Step 7 — Tune and publish

**Build:**
1. Run the scenarios (§26) with `LONG=1 npm test`. Change **only** `config.ts` values. Record each tuning pass in `TUNING.md` (what changed, why, results).
2. Tutorial overlay (§20.8) and the example run file "Smart desert vs rich forest" (Scenario B).
3. Export Scenarios A–D as `.run.json` files in `presets/`.
4. About panel (version, seed info, credits).
5. Performance pass; production build (`npm run build`); zip `dist/` for itch.io (HTML5, "This file will be played in the browser").
6. `README.md`: how to run, build, test and publish.

**Acceptance:**
- Tuning goals in §26 are met, or the owner accepts the differences.
- A new player can load the example and see results within 2 minutes.
- The zipped build runs on itch.io.

---

## 25. Testing

- **Unit tests** (Vitest) for every module listed in §6 `tests/`.
- **Determinism tests** (§16.3) in every step from step 2 on.
- **Forbidden-API scan:** a test reads `src/sim/**/*.ts` and fails if it finds `Math.random`, `Math.pow`, `Math.exp`, `Math.log`, `Math.sin`, `Math.cos`, `Date`, or `performance.now`.
- **Headless scenario runs:** `tests/scenarios.test.ts` builds scenarios from `tests/fixtures.ts`, runs them with `tick()` directly (no worker, no rendering) and prints a summary table (population, era, discoveries per lineage at years 100, 300, 1,000, 2,000, 10,000). Long runs are wrapped in `describe.skipIf(!process.env.LONG)` and run with `LONG=1 npm test`.
- **Manual checklist:** each step's acceptance list in §24.

---

## 26. Test scenarios and tuning goals

Build these as generator functions in `tests/fixtures.ts` (step 3), and export them as `.run.json` presets in step 7.

### Scenario A — "Garden" (baseline)

- **Map:** Sea wall along all map edges (1 tile). Inside: Grassland, rain 60. Forest over the left half (density 100%), fruit-bush patches (three 8×8 patches near the centre), Grass on the right half. A Water-ground river (not a wall) from top to bottom at x = 80, 2 tiles wide. Stone patches (5×5, amount 100%) at (70, 40) and (100, 60). Clay along the river banks (amount 100%). Prey density 60% in forest, 30% on grassland; predators 10% in forest; herd animals 40% and riding animals 30% on the right half. Copper in a 6×6 Mountain block at (130, 20); Iron in a 6×6 Mountain block at (30, 70).
- **Founders:** "Garden" at (76, 45): 2 men + 2 women, ages 18–30, intelligence 100, cooperation 50, strength 50.
- **Settings:** seeds 1–10, drift off, no events.

| By year | Goal (tune toward this) |
|---|---|
| 100 | Lineage alive in ≥ 7 of 10 seeds; population 8–80 |
| 300 | Population 30–500; era 1 reached in most seeds |
| 2,000 | Farming in at least half of the seeds |
| 10,000 | Era 4 or higher in at least half of the seeds; era 6 not before about year 3,000 |

If eras come much too fast, lower `discoveries.baseChanceByEra`; if groups die out too often, look at food first (`plants.maxStock`, `people.food.gatherCap`). Change numbers, not rules.

### Scenario B — "Smart desert vs rich forest" (the owner's experiment)

- **Map:** Sea wall along all map edges. A River wall, 2 tiles wide, from top to bottom at x = 80.
  - **Left (rich):** Grassland, rain 65, forest over 60% of it, fruit-bush patches, stone and clay patches, prey, herd and riding animals, a few predators.
  - **Right (desert):** Desert, rain 8. An oasis at (120, 45): a Water-ground lake of radius 3 with Grassland and Grass around it (radius 8, rain 35). Herd animals 30% around the oasis. One stone patch at (110, 30). A Mountain block with copper at (145, 70).
- **Founders:** "Forest" at (40, 45): 2 men + 2 women, intelligence **70**, cooperation 50, strength 50. "Desert" at (120, 48): 2 men + 2 women, intelligence **140**, cooperation 50, strength 50.
- **Settings:** seed 48213, drift slow, no events.
- **Goal:** runs 10,000 years without errors. This is the experiment, **not** a tuning target — record the results, don't tune toward any winner.

### Scenario C — "Collapse"

- Scenario A plus a Drought (whole area, start 500, 50 years, strength 70) and a Plague (start 800, strength 80).
- **Goal:** population drops by at least 30% during the drought in most seeds; at least one forgotten discovery in some seeds; recovery afterwards.

### Scenario D — "Performance"

- Three walled areas (two River walls), all rich land, 6 founder groups (2 per area), drift strong, 10,000 years at 8×.
- **Goal:** no errors, memory under 1 GB, real speed at least 4 years per second in the late game on a mid-range laptop.

---

## 27. Out of scope for v1

Not built in v1 (possible later ideas):

- Inbreeding effects, languages, religion, culture, named individuals.
- Diplomacy beyond war / trade / absorb / coexist.
- Fishing, diseases other than the Plague event.
- A fourth trait (e.g., curiosity), more eras beyond Iron & Writing.
- Paths and roads worn by walking.
- Sound and music.
- Mobile/touch, multiplayer, modding.
- Hand-drawn terrain tiles.
- Saving full run history (seeds replace it).

---

## 28. Definition of done (v1)

- [ ] All 7 steps accepted by the owner.
- [ ] All tests pass; determinism tests pass; forbidden-API scan passes.
- [ ] Scenario B runs 10,000 years without errors, and the same seed always gives the same history.
- [ ] Every number used by rules is in `config.ts`.
- [ ] Every sprite in §19 is used and matches its grid.
- [ ] Event log, graphs and timeline agree with each other (clicking any of them shows the same year).
- [ ] The itch.io build works from a zip upload.
- [ ] `README.md`, `CLAUDE.md` and `TUNING.md` are up to date.
