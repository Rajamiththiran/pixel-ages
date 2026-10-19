// Built-in scenarios the game offers in the Maps tab: a showcase world made to be fun to watch,
// plus the §26 test scenarios. Built in code, so they need no files and no browser storage.

import { CONFIG } from '../config';
import { createMap } from '../editor/mapState';
import { Ground, Plant, Resource, Species, WallType } from '../shared/ids';
import type { FounderPerson, MapData, RunSetup } from '../shared/types';
import { H, W, at, fillRect, runOf, scenarioA, scenarioB, scenarioC, scenarioD, scenarioE, scenarioF, scenarioG, scenarioH } from './scenarios';

/** A triangle wave from −amp to +amp with the given period: smooth, integer-friendly meanders. */
const tri = (t: number, period: number, amp: number): number => {
  const u = ((t % period) + period) % period;
  const half = period / 2;
  return Math.round(amp * (u < half ? (2 * u) / half - 1 : 3 - (2 * u) / half));
};

const disk = (cx: number, cy: number, r: number, fn: (i: number, x: number, y: number) => void): void => {
  for (let y = Math.max(1, cy - r); y <= Math.min(H - 2, cy + r); y++) {
    for (let x = Math.max(1, cx - r); x <= Math.min(W - 2, cx + r); x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) fn(at(x, y), x, y);
    }
  }
};

/**
 * n founders, men and women alternating, ages 16–34, traits spread a little around the given
 * averages so natural selection has something to work with.
 */
function band(n: number, intelligence: number, cooperation: number, strength: number): FounderPerson[] {
  const spread = [0, 6, -5, 9, -8, 3, -3, 7, -6, 4, -9, 2, 5, -2, 8, -7];
  const ages = [22, 19, 27, 24, 31, 17, 25, 20, 34, 18, 28, 23, 16, 30, 21, 26];
  const T = CONFIG.people.traits;
  const clamp = (v: number, t: { setupMin: number; setupMax: number }): number => Math.min(t.setupMax, Math.max(t.setupMin, v));
  return Array.from({ length: n }, (_, k) => ({
    sex: (k % 2) as 0 | 1,
    age: ages[k % ages.length]!,
    intelligence: clamp(intelligence + spread[k % spread.length]!, T.intelligence),
    cooperation: clamp(cooperation + spread[(k + 5) % spread.length]!, T.cooperation),
    strength: clamp(strength + spread[(k + 11) % spread.length]!, T.strength),
  }));
}

// ---------- "Four Realms" ----------

// The great river (a River wall) runs north to south and splits the west from the east.
const riverX = (y: number): number => 79 + tri(y, 40, 3);
// The mountain range (a Mountain wall) splits the eastern highlands from the plains.
const rangeY = (x: number): number => 29 + tri(x, 24, 2);
// A stream (Water ground, not a wall) winds through the west: crossing it needs a Raft.
const streamX = (y: number): number => 46 + Math.floor(y / 8) + tri(y, 22, 2);
const COAST_Y = 85;              // Sea wall from here down: a southern coast with fish

function clearTile(m: MapData, i: number): void {
  m.plantType[i] = Plant.None; m.plantDensity[i] = 0;
  m.resourceType[i] = Resource.None; m.resourceAmount[i] = 0;
  for (let s = 0; s < 4; s++) m.animals[s]![i] = 0;
}

function water(m: MapData, i: number): void {
  clearTile(m, i);
  m.ground[i] = Ground.Water; m.elevation[i] = 0;
}

/** A disk with a ragged edge (±0.8 tiles), so painted patches don't look stamped. */
function blob(cx: number, cy: number, r: number, fn: (i: number, x: number, y: number) => void): void {
  disk(cx, cy, r + 1, (i, x, y) => {
    const rr = r + (((x * 7 + y * 13) % 5) - 2) * 0.4;
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rr * rr) fn(i, x, y);
  });
}

const grove = (m: MapData, cx: number, cy: number, r: number): void => blob(cx, cy, r, (i) => {
  if (m.ground[i] === Ground.Water || m.wall[i] !== WallType.None) return;
  m.plantType[i] = Plant.FruitBushes; m.plantDensity[i] = 255; m.rain[i] = Math.max(m.rain[i]!, 50);
});

const wood = (m: MapData, cx: number, cy: number, r: number, rain: number): void => blob(cx, cy, r, (i) => {
  if (m.ground[i] !== Ground.Grassland || m.wall[i] !== WallType.None) return;
  m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255; m.rain[i] = rain; m.animals[Species.Prey][i] = 125;
});

/** A mountain peak (Mountain ground, high), optionally holding ore. */
const peak = (m: MapData, cx: number, cy: number, r: number, res: number): void => blob(cx, cy, r, (i) => {
  if (m.wall[i] !== WallType.None || m.ground[i] === Ground.Water) return;
  clearTile(m, i);
  m.ground[i] = Ground.Mountain; m.elevation[i] = 8;
  if (res !== Resource.None) { m.resourceType[i] = res; m.resourceAmount[i] = 255; }
});

/** A stone outcrop on open land. */
const outcrop = (m: MapData, cx: number, cy: number, r: number): void => blob(cx, cy, r, (i) => {
  if (m.wall[i] !== WallType.None || m.ground[i] === Ground.Water) return;
  m.resourceType[i] = Resource.Stone; m.resourceAmount[i] = 255;
});

/**
 * "Four Realms": four peoples in three walled lands. Woodland and the Riverfolk live 14 tiles
 * apart on either side of a stream, so they meet early; the Riders of the eastern plains and the
 * Highlanders behind the mountains grow up alone until someone builds boats or mines through.
 * The west has wood, clay and stone but no metal; the highlands have copper, tin and iron; the
 * plains have horses and salt. A drought on the plains in year 220 pushes the Riders outward.
 * Every home has forest or fruit within forage range: on grass alone, 12 founders starve.
 */
export function fourRealms(seed = 8): RunSetup {
  const m = createMap();
  fillRect(m, 0, 0, W - 1, H - 1, (i, x, y) => {
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || y >= COAST_Y) { m.wall[i] = WallType.Sea; m.rain[i] = 60; return; }
    const rx = riverX(y);
    if (x === rx || x === rx + 1) { m.wall[i] = WallType.River; m.rain[i] = 60; return; }
    if (x < rx) {
      // The West: wet meadows, deep forest on the far side of the stream, wolves in the woods.
      const sx = streamX(y);
      m.rain[i] = 58;
      m.plantType[i] = Plant.Grass; m.plantDensity[i] = 210;
      m.animals[Species.Prey][i] = 100;
      m.animals[Species.Riding][i] = x > sx + 8 ? 40 : 0;
      m.elevation[i] = Math.min(4, Math.floor(Math.abs(x - sx) / 7));
      if (x < 34 + tri(y, 18, 3) || (y < 40 + tri(x, 14, 3) && x < sx)) {
        m.rain[i] = 70;
        m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255;
        m.animals[Species.Prey][i] = 150; m.animals[Species.Predator][i] = 24;
      }
      if (x < 8) m.elevation[i] = 5;
    } else if (y < rangeY(x)) {
      // The Highlands: cool alpine meadows with goats, rolling hills (landslides on bare slopes).
      m.rain[i] = 60;
      m.plantType[i] = Plant.Grass; m.plantDensity[i] = 170;
      m.animals[Species.Herd][i] = 110; m.animals[Species.Prey][i] = 70;
      m.elevation[i] = 5 + tri(x, 32, 2);
    } else {
      // The Plains: dry grassland with herds of horses and goats; desert in the far south-east.
      m.rain[i] = 40;
      m.plantType[i] = Plant.Grass; m.plantDensity[i] = 220;
      m.animals[Species.Riding][i] = 110; m.animals[Species.Herd][i] = 80; m.animals[Species.Prey][i] = 60;
      m.elevation[i] = 1;
      if (x > 128 + tri(y, 16, 3) && y > 58 + tri(x, 20, 3)) { clearTile(m, i); m.ground[i] = Ground.Desert; m.rain[i] = 10; }
    }
  });

  // The mountain range, from the river to the east coast, two tiles thick.
  for (let x = 70; x < W - 1; x++) {
    for (const y of [rangeY(x), rangeY(x) + 1]) {
      const i = at(x, y);
      if (m.wall[i] !== WallType.None || x <= riverX(y)) continue;
      clearTile(m, i);
      m.wall[i] = WallType.Mountain; m.elevation[i] = 9;
    }
  }

  // The stream: two tiles of open water from the northern forest to the southern coast,
  // with clay banks in its middle reach.
  for (let y = 1; y < COAST_Y; y++) {
    const sx = streamX(y);
    water(m, at(sx, y)); water(m, at(sx + 1, y));
    if (y > 36 && y < 72) {
      for (const bx of [sx - 1, sx + 2]) { m.resourceType[at(bx, y)] = Resource.Clay; m.resourceAmount[at(bx, y)] = 255; }
    }
  }

  // West: riverside woods on the east bank, fruit groves, stone outcrops, nothing metal.
  for (let y = 44; y < 68; y++) {
    fillRect(m, streamX(y) + 3, y, streamX(y) + 6, y, (i) => { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255; m.rain[i] = 64; m.animals[Species.Prey][i] = 140; });
  }
  for (const [cx, cy] of [[61, 29], [25, 59], [60, 49], [65, 73]] as const) grove(m, cx, cy, 4);
  outcrop(m, 36, 44, 2);
  outcrop(m, 66, 16, 2);

  // Highlands: peaks with copper, rare tin and iron, a forest, a mountain lake.
  peak(m, 100, 8, 3, Resource.Copper);
  peak(m, 141, 6, 1, Resource.Tin);
  peak(m, 150, 18, 3, Resource.Iron);
  peak(m, 132, 13, 3, Resource.None);
  outcrop(m, 118, 23, 2);
  wood(m, 104, 20, 5, 66);
  wood(m, 129, 5, 5, 60);
  grove(m, 114, 11, 3);
  disk(116, 18, 2, (i) => water(m, i));

  // Plains: a lake with clay shores, a wood, stone, salt flats in the desert.
  disk(104, 52, 5, (i, x, y) => {
    const d2 = (x - 104) * (x - 104) + (y - 52) * (y - 52);
    if (d2 <= 12) water(m, i);
    else { m.resourceType[i] = Resource.Clay; m.resourceAmount[i] = 255; m.rain[i] = 50; }
  });
  wood(m, 98, 74, 5, 55);
  wood(m, 106, 63, 4, 55);
  grove(m, 114, 60, 3);
  outcrop(m, 123, 41, 2);
  blob(143, 72, 3, (i) => { if (m.ground[i] === Ground.Desert) { m.resourceType[i] = Resource.Salt; m.resourceAmount[i] = 255; } });

  const run = runOf(m, seed, 'slow');
  run.name = 'Four Realms';
  const riverfolk = 46;
  run.founders = [
    { id: 1, name: 'Riverfolk', colorIndex: 1, x: streamX(riverfolk) + 4, y: riverfolk, people: band(12, 105, 70, 45) },
    { id: 2, name: 'Woodland', colorIndex: 0, x: 44, y: 36, people: band(12, 95, 35, 65) },
    { id: 3, name: 'Riders', colorIndex: 2, x: 111, y: 57, people: band(12, 90, 30, 70) },
    { id: 4, name: 'Highland', colorIndex: 3, x: 110, y: 14, people: band(12, 125, 60, 50) },
  ];
  run.events = [
    { kind: 'drought', at: { x: 111, y: 57 }, startYear: 220, lengthYears: 30, strength: 60 },
  ];
  return run;
}

// ---------- the list shown in the Maps tab ----------

export interface BuiltinScenario {
  id: string;
  name: string;
  blurb: string;
  build: () => RunSetup;
}

export const BUILTIN_SCENARIOS: readonly BuiltinScenario[] = [
  { id: 'four-realms', name: 'Four Realms', blurb: 'Four peoples, three walled lands, metals in the mountains. Contact, trade, war and breached walls.', build: () => fourRealms() },
  { id: 'scenario-a', name: 'Garden', blurb: 'The baseline: one group in a rich world.', build: () => scenarioA() },
  { id: 'scenario-b', name: 'Smart desert vs rich forest', blurb: 'The owner\'s experiment: intelligence 70 in a forest, 140 in a desert.', build: () => scenarioB() },
  { id: 'scenario-c', name: 'Collapse', blurb: 'The garden with a drought (year 500) and a plague (year 800).', build: () => scenarioC() },
  { id: 'scenario-d', name: 'Six groups', blurb: 'Three walled areas, six groups, strong climate drift.', build: () => scenarioD() },
  // F9: the v2 scenarios (future blueprint §19).
  { id: 'scenario-e', name: 'Fire season', blurb: 'Dry forest; a careful, an average and a careless group. Who starts the fires, who learns?', build: () => scenarioE() },
  { id: 'scenario-f', name: 'Floodplain city', blurb: 'A rich river valley that floods in wet centuries, and a dry upland beside it.', build: () => scenarioF() },
  { id: 'scenario-g', name: 'Overgrazed steppe', blurb: 'Dry grassland full of goats and horses: two herding peoples and the desert they may make.', build: () => scenarioG() },
  { id: 'scenario-h', name: 'Island isolation', blurb: 'Six people on a small island, four groups on a big mainland across the sea.', build: () => scenarioH() },
];
