// Elements and hazards (future blueprint F5, §11). Every hazard follows one shape (§4.1):
//
//   chance = base × natural driver × human driver × (1 − prevention)
//
// and leaves aftermath on the map and in the group: losses, a log line, a raised need, and a
// lesson that makes its prevention discoveries likelier (§4.5).

import { CONFIG } from '../../config';
import { Ground, Hazard, HAZARD_NAMES, Need, Plant, Practice, Resource, Season, WallType } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { chance, gaussian, int, stochasticRound } from '../../shared/rng';
import type { Group, SimState } from '../state';
import { hasActive } from '../people/explore';
import { buryDead, logEvent, logQuiet, population } from '../people/groups';
import { learnLesson } from '../progress/discoveryRules';
import { knownResourceTiles, resourceTiles } from '../progress/deposits';
import { cellOf, slopes } from './landscape';
import { Farmed } from '../people/farming';
import { HazardMark, type RiskLayer } from '../../shared/protocol';

const FU = CONFIG.future;
const FI = FU.fire;
const FL = FU.flood;
const DI = FU.disease;

/** The need each hazard raises (§8.2): fires and floods; the others teach without a need. */
const HAZARD_NEED: Readonly<Record<number, number>> = {
  [Hazard.Wildfire]: Need.fires, [Hazard.TownFire]: Need.fires,
  [Hazard.RiverFlood]: Need.floods, [Hazard.FlashFlood]: Need.floods,
};

/**
 * A hazard hit group g: log it, raise the matching need, start the lesson. A disaster that killed
 * log.majorDead+ people (or a `major` one) is a big event; a smaller one is a small event, logged
 * once per group and hazard in hazardQuietYears (DECISIONS 20.9).
 */
export function strike(s: SimState, g: Group, hazard: number, text: string, dead = 0, major = false): void {
  const LG = CONFIG.log;
  if (major || dead >= LG.majorDead) logEvent(s, 'hazard', text, g);
  else logQuiet(s, `hz:${g.id}:${hazard}`, LG.hazardQuietYears, 'hazard', text, g);
  learnLesson(s, g, hazard);
  const need = HAZARD_NEED[hazard];
  if (need !== undefined) g.needAcc[need] = g.needAcc[need]! + 1;
}

/** Kills each person with chance p (bands), or that share of every age group (villages). Returns deaths. */
export function killShare(s: SimState, g: Group, p: number): number {
  if (p <= 0) return 0;
  if (g.village) {
    const c = g.village.counts;
    let dead = 0;
    for (let k = 0; k < c.length; k++) {
      const d = Math.min(c[k]!, stochasticRound(s.rng, c[k]! * p));
      c[k] = c[k]! - d;
      dead += d;
    }
    return dead;
  }
  const dead: number[] = [];
  for (const slot of g.members) if (chance(s.rng, p)) { s.persons.alive[slot] = 0; dead.push(slot); }
  buryDead(s, g, dead);
  return dead.length;
}

/** Crowding used by town fires and disease: population / 150, at most 2. */
const crowd = (g: Group): number => Math.min(CONFIG.events.plagueDensityMax, population(g) / CONFIG.events.plagueDensityPop);

// ---------- weather (§5.4) ----------

/** Yearly: each climate cell gets a new rain anomaly for the coming year (wet and dry years). */
export function rollWeather(s: SimState): void {
  const W = FU.weather;
  for (let c = 0; c < s.weatherYear.length; c++) {
    s.weatherYear[c] = Math.min(W.max, Math.max(W.min, gaussian(s.rng) * W.sigma));
  }
}

/** How much wetter than normal tile i is this year: weather + drift + events (−1…). */
export function anomaly(s: SimState, i: number): number {
  const w = s.width;
  const x = i % w;
  const base = s.baseRain[i]!;
  const trend = base > 0 ? s.rainNow[i]! / base - 1 : 0;
  return trend + s.weatherYear[cellOf(x, (i - x) / w, w, s.height)]!;
}

/** This month's rain on tile i, with this year's weather. */
const rainThisMonth = (s: SimState, i: number): number => s.rainNow[i]! * (1 + s.weatherYear[cellOf(i % s.width, Math.floor(i / s.width), s.width, s.height)]!);

// ---------- fire (§11.2) ----------

/** dryness = clamp(1 − rain / 60, 0, 1) × season (spring 0.3, summer 1, autumn 0.8, winter 0.1). */
export function dryness(s: SimState, i: number): number {
  const d = Math.min(1, Math.max(0, 1 - rainThisMonth(s, i) / FI.dryRainFull));
  return d * FI.seasonDry[CONFIG.seasonOfMonth[s.month]!]!;
}

/** Building tiles this month (−1 = none, else the owner's group id). */
function buildingOwners(s: SimState): Int32Array {
  const out = new Int32Array(s.ground.length).fill(-1);
  for (const g of s.groups) {
    const b = g.huts + g.houses;
    if (b === 0) continue;
    const r = b <= 12 ? 1 : 2;
    for (let y = Math.max(0, g.homeY - r); y <= Math.min(s.height - 1, g.homeY + r); y++) {
      for (let x = Math.max(0, g.homeX - r); x <= Math.min(s.width - 1, g.homeX + r); x++) out[y * s.width + x] = g.id;
    }
  }
  return out;
}

/** Fuel of tile i: forest × 1, grass and bushes × 0.6, buildings 0.8. Water and walls have none. */
export function fuel(s: SimState, i: number, owners: Int32Array | null): number {
  if (s.ground[i] === Ground.Water || (s.wall[i] !== WallType.None && s.crossing[i] === 0)) return 0;
  const d = s.plantDensity[i]! / 255;
  const plant = s.plantType[i];
  const veg = plant === Plant.Forest ? d : plant === Plant.Grass || plant === Plant.FruitBushes ? d * 0.6 : 0;
  return veg + (owners && owners[i]! >= 0 ? FI.buildingFuel : 0);
}

/** Escaped-burn candidates queued by this month's burners (consumed by the monthly hazard step). */
const pendingBurns = new WeakMap<SimState, Array<{ tile: number; groupId: number }>>();

/** A band burned tile `tile` this month (§10.4): the burn may escape at the hazard step. */
export function queueBurn(s: SimState, tile: number, groupId: number): void {
  let q = pendingBurns.get(s);
  if (!q) { q = []; pendingBurns.set(s, q); }
  q.push({ tile, groupId });
}

interface Ignition { tile: number; kind: 'town' | 'campfire' | 'burn' | 'lightning'; groupId: number }

const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

/**
 * One fire: burns its start tile, then spreads for up to 6 rounds; each burning tile lights each
 * 8-neighbour with 0.35 × fuel × dryness. Rounds read the previous round's front, so the order
 * tiles are processed in never biases the result. Returns tiles burned and groups whose
 * settlements burned.
 */
function spreadFire(s: SimState, start: number, owners: Int32Array): { tiles: number; hit: number[] } {
  const w = s.width;
  const hit: number[] = [];
  let tiles = 0;
  const burn = (i: number): void => {
    const f = fuel(s, i, owners);
    s.fireState[i] = 2 + Math.floor(f * 2);
    tiles++;
    if (s.plantType[i] !== Plant.Farmland) {
      // Ash: fresh grass shoots on land, no plants elsewhere.
      const land = s.ground[i] === Ground.Grassland || s.ground[i] === Ground.Desert;
      s.plantType[i] = land ? Plant.Grass : Plant.None;
      s.plantDensity[i] = land ? CONFIG.plants.newPlantDensity : 0;
    }
    s.plantFood[i] = 0;
    s.ash[i] = FI.ashYears;
    const owner = owners[i]!;
    if (owner >= 0 && !hit.includes(owner)) hit.push(owner);
  };
  if (fuel(s, start, owners) <= 0 || s.fireState[start] !== 0 || s.ash[start] !== 0) return { tiles: 0, hit };
  burn(start);
  let front = [start];
  for (let step = 0; step < FI.maxSpreadSteps && front.length > 0; step++) {
    const next: number[] = [];
    for (const i of front) {
      const x = i % w, y = (i - x) / w;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= s.height) continue;
        const j = ny * w + nx;
        if (s.fireState[j] !== 0 || s.ash[j] !== 0) continue;
        const f = fuel(s, j, owners);
        if (f <= 0) continue;
        if (chance(s.rng, FI.spreadBase * Math.min(1, f) * dryness(s, j))) { burn(j); next.push(j); }
      }
    }
    front = next;
  }
  return { tiles, hit };
}

/** A settlement burned: half its buildings, 30% of its food, 2% of its people; a palisade burns down (F6). */
export function burnSettlement(s: SimState, g: Group): number {
  if (g.fortification === 1) g.fortification = 0;
  g.huts = Math.floor(g.huts * (1 - FI.buildingLoss));
  g.houses = Math.floor(g.houses * (1 - FI.buildingLoss));
  g.foodStock *= 1 - FI.storeLoss;
  return killShare(s, g, FI.deathChance);
}

/** Forest share (density-weighted) within 2 tiles of home, and the forest tile nearest home. */
function forestNear(s: SimState, g: Group): { share: number; tile: number } {
  let sum = 0, n = 0, tile = -1, best = Infinity;
  for (let y = Math.max(0, g.homeY - 2); y <= Math.min(s.height - 1, g.homeY + 2); y++) {
    for (let x = Math.max(0, g.homeX - 2); x <= Math.min(s.width - 1, g.homeX + 2); x++) {
      const i = y * s.width + x;
      n++;
      if (s.plantType[i] !== Plant.Forest) continue;
      sum += s.plantDensity[i]! / 255;
      const d = (x - g.homeX) ** 2 + (y - g.homeY) ** 2;
      if (d < best) { best = d; tile = i; }
    }
  }
  return { share: n > 0 ? sum / n : 0, tile };
}

/**
 * A settlement's own fire this month (§4.1): 0.002 × dryness × crowding × thatch share
 * (huts 1, mud-brick houses ½) × (1 − Firebreaks ½) × (1 − Stone Building ½).
 */
export function townFireChance(s: SimState, g: Group): number {
  const b = g.huts + g.houses;
  if (b === 0) return 0;
  const thatch = (g.huts + 0.5 * g.houses) / b;
  return FI.townBase * dryness(s, g.homeY * s.width + g.homeX) * crowd(g) * thatch
    * (1 - (hasActive(g, Discovery.firebreaks) ? FI.firebreakCut : 0))
    * (1 - (hasActive(g, Discovery.stoneBuilding) ? FI.stoneCut : 0));
}

/** Starts a fire at tile i now (also for tests): returns tiles burned and settlements hit. */
export const fireFrom = (s: SimState, i: number): { tiles: number; hit: number[] } => spreadFire(s, i, buildingOwners(s));

const safety = (g: Group): number => (hasActive(g, Discovery.fireSafety) ? FI.safetyCut : 0);

/** Monthly fires (§11.2): ignitions in a fixed order, each spread in turn, then logged. */
export function updateFires(s: SimState): void {
  for (let i = 0; i < s.fireState.length; i++) if (s.fireState[i] !== 0) s.fireState[i] = s.fireState[i]! - 1;
  const ignitions: Ignition[] = [];
  // 1. Settlements' own fires (§4.1): dry season × crowding × thatch × (1 − firebreaks) × (1 − stone).
  for (const g of s.groups) {
    const p = townFireChance(s, g);
    if (p > 0 && chance(s.rng, p)) ignitions.push({ tile: g.homeY * s.width + g.homeX, kind: 'town', groupId: g.id });
  }
  // 2. Campfires near forest.
  for (const g of s.groups) {
    if (!hasActive(g, Discovery.fire)) continue;
    const near = forestNear(s, g);
    if (near.tile < 0) continue;
    const p = FI.igniteBase * dryness(s, g.homeY * s.width + g.homeX) * near.share * (1 - safety(g));
    if (p > 0 && chance(s.rng, p)) ignitions.push({ tile: near.tile, kind: 'campfire', groupId: g.id });
  }
  // 3. Spring burns that escape.
  const burns = pendingBurns.get(s) ?? [];
  pendingBurns.delete(s);
  for (const b of burns) {
    const g = s.groups.find((o) => o.id === b.groupId);
    if (!g) continue;
    const x = b.tile % s.width, y = Math.floor(b.tile / s.width);
    // The fire jumps to the forest next to the burned patch.
    let target = -1;
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= s.width || ny >= s.height) continue;
      const j = ny * s.width + nx;
      if (s.plantType[j] === Plant.Forest) { target = j; break; }
    }
    if (target >= 0 && chance(s.rng, FI.burnEscape * dryness(s, target) * (1 - safety(g)))) {
      ignitions.push({ tile: target, kind: 'burn', groupId: g.id });
    }
  }
  // 4. Lightning on forest in summer.
  if (CONFIG.seasonOfMonth[s.month] === Season.Summer) {
    for (let i = 0; i < s.plantType.length; i++) {
      if (s.plantType[i] !== Plant.Forest || s.fireState[i] !== 0) continue;
      const d = dryness(s, i);
      if (d > 0 && chance(s.rng, FI.lightning * d)) ignitions.push({ tile: i, kind: 'lightning', groupId: -1 });
    }
  }
  if (ignitions.length === 0) return;

  const owners = buildingOwners(s);
  for (const ig of ignitions) {
    const { tiles, hit } = spreadFire(s, ig.tile, owners);
    if (tiles === 0) continue;
    const starter = s.groups.find((o) => o.id === ig.groupId) ?? null;
    if (ig.kind === 'town' && starter) {
      const dead = hit.includes(starter.id) ? burnSettlement(s, starter) : 0;
      strike(s, starter, Hazard.TownFire, `A fire swept through ${starter.name} (${dead} died, ${tiles} km² burned)`, dead);
    } else if (starter && (tiles >= FI.logMinTiles || hit.length > 0)) {
      const how = ig.kind === 'burn' ? `${starter.name}'s spring burn escaped` : `A wildfire from ${starter.name}'s campfire`;
      strike(s, starter, Hazard.Wildfire, `${how}: ${tiles} km² burned`);
    } else if (!starter && (tiles >= FI.logMinTiles || hit.length > 0)) {
      logEvent(s, 'hazard', `Lightning started a wildfire: ${tiles} km² burned`, null, null, ig.tile % s.width, Math.floor(ig.tile / s.width), true);
    }
    for (const id of hit) {
      const g = s.groups.find((o) => o.id === id);
      if (!g || (ig.kind === 'town' && id === ig.groupId)) continue;
      const dead = burnSettlement(s, g);
      strike(s, g, Hazard.Wildfire, `A wildfire reached ${g.name} (${dead} died)`, dead);
    }
  }
}

// ---------- floods (§11.3) ----------

interface Floodplain {
  stretch: Int32Array;           // per tile: the river stretch whose floodplain it is (−1 none)
  waters: number[][];            // per stretch: its water tiles
  plains: number[][];            // per stretch: its floodplain tiles
}

const plainCache = new WeakMap<Uint8Array, Floodplain>();

/**
 * River stretches (connected River walls and lakes) and their floodplains: land within 2 tiles,
 * no more than 1 higher than the water (painted heights, D7). Fixed for a run.
 */
export function floodplains(s: SimState): Floodplain {
  const cached = plainCache.get(s.wall);
  if (cached) return cached;
  const w = s.width, h = s.height, n = w * h;
  const isRiver = (i: number): boolean => s.wall[i] === WallType.River || (s.wall[i] === WallType.None && s.ground[i] === Ground.Water);
  const comp = new Int32Array(n).fill(-1);
  const waters: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (!isRiver(i) || comp[i] !== -1) continue;
    const id = waters.length;
    const list: number[] = [];
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const j = stack.pop()!;
      list.push(j);
      const x = j % w;
      for (const k of [j - w, x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j + w]) {
        if (k >= 0 && k < n && comp[k] === -1 && isRiver(k)) { comp[k] = id; stack.push(k); }
      }
    }
    waters.push(list.sort((a, b) => a - b));
  }
  const r = FL.floodplainTiles;
  const stretch = new Int32Array(n).fill(-1);
  const plains: number[][] = waters.map(() => []);
  for (let i = 0; i < n; i++) {
    if (isRiver(i) || s.wall[i] !== WallType.None) continue;
    const x = i % w, y = (i - x) / w;
    let best = Infinity, water = -1;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        const j = yy * w + xx;
        if (!isRiver(j)) continue;
        const d = (xx - x) ** 2 + (yy - y) ** 2;
        if (d > r * r) continue;
        if (d < best || (d === best && j < water)) { best = d; water = j; }
      }
    }
    if (water < 0 || s.elevation[i]! > s.elevation[water]! + 1) continue;
    stretch[i] = comp[water]!;
    plains[comp[water]!]!.push(i);
  }
  const fp = { stretch, waters, plains };
  plainCache.set(s.wall, fp);
  return fp;
}


/**
 * Spring (month 0): each river stretch in a wet year floods with 0.04 × anomaly × (1 − levees
 * × upkeep). Its floodplain stands under water 1–3 months: this year's harvest there is lost,
 * buildings on it are damaged, a few people drown, and the fields get silt (§11.3).
 */
export function riverFloods(s: SimState): void {
  const fp = floodplains(s);
  for (let k = 0; k < fp.waters.length; k++) {
    const plain = fp.plains[k]!;
    if (plain.length === 0) continue;
    const water = fp.waters[k]!;
    let an = 0;
    for (const i of water) an += anomaly(s, i);
    an /= water.length;
    if (an <= 0) continue;
    const living = s.groups.filter((g) => fp.stretch[g.homeY * s.width + g.homeX] === k);
    let protect = 0;
    for (const g of living) if (hasActive(g, Discovery.levees)) protect = Math.max(protect, g.maintenance);
    if (!chance(s.rng, FL.base * an * (1 - protect))) continue;
    const months = FL.minMonths + int(s.rng, FL.maxMonths - FL.minMonths + 1);
    for (const i of plain) {
      s.floodMonths[i] = months;
      s.farmedThisYear[i] = s.farmedThisYear[i]! | Farmed.Flooded;
    }
    if (living.length === 0) {
      const at = plain[0]!;
      logQuiet(s, `flood:${k}`, CONFIG.log.hazardQuietYears, 'hazard', `A river flooded ${plain.length} km² of empty land`, null, null, at % s.width, Math.floor(at / s.width));
      continue;
    }
    for (const g of living) {
      const dead = floodDamage(s, g);
      strike(s, g, Hazard.RiverFlood, `The river flooded ${g.name}'s fields and homes (${dead} drowned)`, dead);
    }
  }
}

/** A flood reached a group's home: half its buildings damaged, a few drown. Returns deaths. */
export function floodDamage(s: SimState, g: Group): number {
  g.huts = Math.floor(g.huts * (1 - FL.hutLoss));
  g.houses = Math.floor(g.houses * (1 - FL.hutLoss));
  return killShare(s, g, FL.deathChance);
}

/** Drains (Drainage, Sewers) working at their upkeep, 0–1. */
const drains = (g: Group): number =>
  (hasActive(g, Discovery.drainage) || hasActive(g, Discovery.sewers) ? g.maintenance : 0);

/** Monthly: a big village without working drains in a heavy-rain month may flash-flood (§11.3). */
export function flashFloods(s: SimState): void {
  for (const g of s.groups) {
    if (population(g) < FL.flashMinPop) continue;
    const home = g.homeY * s.width + g.homeX;
    if (rainThisMonth(s, home) < FL.flashRain) continue;
    if (!chance(s.rng, FL.flashBase * crowd(g) * (1 - drains(g)))) continue;
    const dead = killShare(s, g, FL.flashDeaths);
    // Flood water in the streets brings sickness: twice the outbreak risk this year.
    s.hazardsActive.push({ kind: Hazard.FlashFlood, groupId: g.id, endYear: s.year + 1 });
    sortHazards(s);
    strike(s, g, Hazard.FlashFlood, `Heavy rain flooded the streets of ${g.name} (${dead} died)`, dead);
  }
}

// ---------- disease (§11.4) ----------

const sortHazards = (s: SimState): void => { s.hazardsActive.sort((a, b) => a.groupId - b.groupId || a.kind - b.kind); };

export const hazardOn = (s: SimState, g: Group, kind: number): boolean =>
  s.hazardsActive.some((h) => h.groupId === g.id && h.kind === kind && s.year < h.endYear);

/** An outbreak is running in this group (also hard times for its children). */
export const sick = (s: SimState, g: Group): boolean => hazardOn(s, g, Hazard.Outbreak);

/**
 * Extra monthly death multiplier from disease: an outbreak × 3; in villages, endemic disease
 * × (1 + 0.2 × crowding × herds near home × (1 − wells) × (1 − sewers)).
 */
export function hazardDeathMult(s: SimState, g: Group): number {
  let mult = sick(s, g) ? DI.outbreakMult : 1;
  if (g.village) {
    const herds = 0.5 + 0.5 * Math.min(1, g.herd / DI.herdFull);
    const clean = (hasActive(g, Discovery.wells) ? 1 - DI.cleanWaterCut : 1) * (hasActive(g, Discovery.sewers) ? 1 - DI.cleanWaterCut : 1);
    mult *= 1 + DI.endemicWeight * crowd(g) * herds * clean;
  }
  return mult;
}

function startOutbreak(s: SimState, g: Group, text: string, major: boolean): void {
  if (sick(s, g)) return;
  const years = DI.minYears + int(s.rng, DI.maxYears - DI.minYears + 1);
  s.hazardsActive.push({ kind: Hazard.Outbreak, groupId: g.id, endYear: s.year + 1 + years });
  sortHazards(s);
  strike(s, g, Hazard.Outbreak, text, 0, major);
}

/**
 * Yearly: villages roll for an outbreak (crowding × herds × trade links; twice after a flash
 * flood); every running outbreak spreads to each trade partner with 30% a year.
 */
export function yearlyDisease(s: SimState): void {
  const partners = (g: Group): Group[] => s.relations
    .filter((r) => r.kind === 'trade' && (r.a === g.id || r.b === g.id))
    .map((r) => s.groups.find((o) => o.id === (r.a === g.id ? r.b : r.a))!)
    .filter((o) => o !== undefined);
  const sickNow = s.groups.filter((g) => sick(s, g));
  for (const g of s.groups) {
    if (!g.village || sick(s, g)) continue;
    const p = DI.outbreakBase * crowd(g) * (g.herd >= 1 ? DI.herdOutbreakMult : 1) * (1 + partners(g).length)
      * (hazardOn(s, g, Hazard.FlashFlood) ? 2 : 1);
    if (chance(s.rng, p)) startOutbreak(s, g, `A sickness broke out in ${g.name}`, true);
  }
  for (const g of sickNow) {
    for (const o of partners(g)) {
      if (!sick(s, o) && chance(s.rng, DI.spreadChance)) startOutbreak(s, o, `${o.name} caught a sickness from its trade with ${g.name}`, false);
    }
  }
}

// ---------- blight, landslides, dust, mines (§11.1) ----------

/** Yearly: a farming group without Crop Rotation in a wet year may lose next year's harvest to blight. */
export function yearlyBlight(s: SimState): void {
  const B = FU.blight;
  for (const g of s.groups) {
    if (g.farmTiles.length < B.minFields || hasActive(g, Discovery.cropRotation) || hazardOn(s, g, Hazard.Blight)) continue;
    const an = anomaly(s, g.homeY * s.width + g.homeX);
    if (!chance(s.rng, B.base * (1 + B.wetWeight * Math.max(0, an)))) continue;
    s.hazardsActive.push({ kind: Hazard.Blight, groupId: g.id, endYear: s.year + 2 });
    sortHazards(s);
    strike(s, g, Hazard.Blight, `Blight struck ${g.name}'s crops: next year's harvest will be poor`);
  }
}

/** Harvest multiplier for a group's fields: blight × 0.3 while it lasts. */
export const blightMult = (s: SimState, g: Group): number => (hazardOn(s, g, Hazard.Blight) ? FU.blight.harvestMult : 1);

/**
 * Yearly: cleared slopes (no forest, no terraces) may slide in a wet year: 0.01 × anomaly ×
 * slope / 9. The tile is buried (no plants, no soil); people living there may die.
 */
export function yearlyLandslides(s: SimState): void {
  const L = FU.landslide;
  const sl = slopes(s);
  const max = CONFIG.editor.maxElevation;
  for (let i = 0; i < sl.length; i++) {
    if (sl[i]! < 2 || s.plantType[i] === Plant.Forest || s.terrace[i] !== 0) continue;
    if (s.ground[i] === Ground.Water || s.wall[i] !== WallType.None) continue;
    const an = anomaly(s, i);
    if (an <= 0 || !chance(s.rng, L.base * an * (sl[i]! / max))) continue;
    const field = s.plantType[i] === Plant.Farmland;
    s.plantType[i] = Plant.None;
    s.plantDensity[i] = 0;
    s.plantFood[i] = 0;
    s.fertility[i] = 0;
    for (const g of s.groups) {
      const home = g.homeY * s.width + g.homeX === i;
      if (home) {
        const dead = killShare(s, g, L.deathChance);
        strike(s, g, Hazard.Landslide, `A landslide buried part of ${g.name} (${dead} died)`, dead);
      } else if (field && g.farmTiles.includes(i)) {
        strike(s, g, Hazard.Landslide, `A landslide buried a field of ${g.name}`);
      }
    }
  }
}

/**
 * Yearly: in a dry year, a climate cell with much bare or ploughed dry land may have a dust
 * storm: its fields lose 0.1 fertility (the Dust Bowl).
 */
export function yearlyDust(s: SimState): void {
  const D = FU.dust;
  const cells = s.weatherYear.length;
  const bare = new Float32Array(cells), land = new Float32Array(cells), an = new Float32Array(cells);
  for (let i = 0; i < s.ground.length; i++) {
    if (s.ground[i] === Ground.Water || s.wall[i] !== WallType.None) continue;
    const x = i % s.width;
    const c = cellOf(x, (i - x) / s.width, s.width, s.height);
    land[c] = land[c]! + 1;
    an[c] = an[c]! + anomaly(s, i);
    const plant = s.plantType[i];
    if ((plant === Plant.None || plant === Plant.Farmland) && s.rainNow[i]! < FU.grazing.dryBelowRain + 10) bare[c] = bare[c]! + 1;
  }
  for (let c = 0; c < cells; c++) {
    if (land[c] === 0) continue;
    const a = an[c]! / land[c]!;
    if (a >= D.dryBelow) continue;
    const share = bare[c]! / land[c]!;
    if (!chance(s.rng, D.base * (-a / FU.weather.sigma) * Math.min(1, share / D.bareFull))) continue;
    const hit = new Set<number>();
    for (let i = 0; i < s.ground.length; i++) {
      const x = i % s.width;
      if (s.plantType[i] !== Plant.Farmland || cellOf(x, (i - x) / s.width, s.width, s.height) !== c) continue;
      s.fertility[i] = Math.max(0, s.fertility[i]! - D.fertilityLoss);
    }
    for (const g of s.groups) if (g.farmTiles.some((i) => cellOf(i % s.width, Math.floor(i / s.width), s.width, s.height) === c)) hit.add(g.id);
    for (const g of s.groups) if (hit.has(g.id)) strike(s, g, Hazard.DustStorm, `A dust storm stripped soil from ${g.name}'s fields`);
  }
}

/**
 * Yearly: a group with Mining digs deep; with little metal-work practice a mine may collapse
 * (1% a year × (1 − practice share)): some miners die and the deposit is lost.
 */
export function yearlyMines(s: SimState): void {
  const M = FU.mine;
  let deposits: number[] | null = null;
  for (const g of s.groups) {
    if (!hasActive(g, Discovery.mining)) continue;
    const pop = population(g);
    const share = Math.min(1, g.practice[Practice.metalWork]! / (FU.practice.full * Math.max(1, pop)));
    if (!chance(s.rng, M.base * (1 - share))) continue;
    deposits ??= resourceTiles(s);
    const mine = [Resource.Copper, Resource.Iron, Resource.Tin].map((r) => knownResourceTiles(s, g, r, deposits!)[0]).find((i) => i !== undefined);
    if (mine === undefined) continue;
    s.resourceAmount[mine] = 0;
    s.resourceType[mine] = Resource.None;
    s.quarry[mine] = 1;
    const dead = killShare(s, g, Math.max(M.deathShare, 1 / Math.max(1, pop)));
    strike(s, g, Hazard.MineCollapse, `A mine of ${g.name} collapsed (${dead} died)`, dead);
  }
}

// ---------- upkeep (§11.5) ----------

/** Canals, levees and drains to keep up: Irrigation, Levees, Drainage or Sewers. */
export const hasWorks = (g: Group): boolean =>
  hasActive(g, Discovery.irrigation) || hasActive(g, Discovery.levees) || hasActive(g, Discovery.drainage) || hasActive(g, Discovery.sewers);

/** A month of upkeep work. */
export function maintain(g: Group, workers: number): void {
  g.maintenance = Math.min(1, g.maintenance + workers * FU.maintenance.perWorkerMonth);
}

/** Yearly: works fall into disrepair (5%). A crash or a long war lets canals silt and levees fail. */
export function yearlyUpkeep(s: SimState): void {
  for (const g of s.groups) g.maintenance *= 1 - FU.maintenance.decayPerYear;
}

// ---------- the monthly and yearly steps ----------

/** Monthly hazards (tick step 5b): standing water drains, fires, spring river floods, flash floods. */
export function monthlyHazards(s: SimState): void {
  for (let i = 0; i < s.floodMonths.length; i++) if (s.floodMonths[i] !== 0) s.floodMonths[i] = s.floodMonths[i]! - 1;
  updateFires(s);
  if (s.month === 0) riverFloods(s);
  flashFloods(s);
}

/** Yearly hazards (after contact): disease, blight, landslides, dust storms, mines, upkeep; old hazards end. */
export function yearlyHazards(s: SimState): void {
  yearlyDisease(s);
  yearlyBlight(s);
  yearlyLandslides(s);
  yearlyDust(s);
  yearlyMines(s);
  yearlyUpkeep(s);
  // Hazards of groups that are gone, or that end with this year, are dropped.
  s.hazardsActive = s.hazardsActive.filter((h) => h.endYear > s.year + 1 && s.groups.some((g) => g.id === h.groupId));
  rollWeather(s);
}

/** Names used by the inspector. */
export const hazardName = (h: number): string => HAZARD_NAMES[h] ?? '?';

// ---------- predators on herds (§11.1) ----------

/** Monthly: wolves take herd animals: herd × (1 − predator density in range × 0.03 × (Dogs ? 0.3 : 1)). */
export function herdPredation(s: SimState, g: Group, range: readonly number[]): void {
  if (g.herd <= 0 || range.length === 0) return;
  const pred = s.animal[1]!;
  let sum = 0;
  for (const i of range) sum += pred[i]!;
  const loss = (sum / range.length) * FU.herdPredation * (hasActive(g, Discovery.dogs) ? FU.dogsHerdLoss : 1);
  g.herd *= 1 - Math.min(1, loss);
}

/** Maintain job score (§11.5): only with works to keep; worth more the worse they are. */
export const maintainScore = (g: Group): number =>
  (hasWorks(g) && g.maintenance < 1 ? FU.maintenance.base + FU.maintenance.weight * (1 - g.maintenance) : 0);

/** The hazards byte of every tile for the renderer: burning, flooded. */
export function computeHazardMarks(s: SimState, out: Uint8Array): Uint8Array {
  for (let i = 0; i < out.length; i++) {
    out[i] = (s.fireState[i] !== 0 ? HazardMark.Fire : 0) | (s.floodMonths[i] !== 0 ? HazardMark.Flood : 0);
  }
  return out;
}

/**
 * Risk views (F5): fire risk = summer dryness × fuel; flood risk = floodplain land, more in a wet
 * year, less behind kept-up levees. 0–255 per tile.
 */
export function riskLayer(s: SimState, kind: RiskLayer): Uint8Array {
  const n = s.ground.length;
  const out = new Uint8Array(n);
  if (kind === 'fireRisk') {
    const owners = buildingOwners(s);
    for (let i = 0; i < n; i++) {
      const dry = Math.min(1, Math.max(0, 1 - rainThisMonth(s, i) / FI.dryRainFull)) * FI.seasonDry[Season.Summer]!;
      out[i] = Math.round(255 * Math.min(1, dry * fuel(s, i, owners)));
    }
    return out;
  }
  const fp = floodplains(s);
  for (let k = 0; k < fp.plains.length; k++) {
    const water = fp.waters[k]!;
    let an = 0;
    for (const i of water) an += anomaly(s, i);
    an /= Math.max(1, water.length);
    let protect = 0;
    for (const g of s.groups) {
      if (fp.stretch[g.homeY * s.width + g.homeX] === k && hasActive(g, Discovery.levees)) protect = Math.max(protect, g.maintenance);
    }
    const v = Math.round(255 * Math.min(1, 0.35 + 2 * Math.max(0, an)) * (1 - protect));
    for (const i of fp.plains[k]!) out[i] = v;
  }
  return out;
}
