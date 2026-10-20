// Farming and herding (§11.5). Farm tiles are fields a group creates on good land in its
// range; herds are wild herd animals captured and kept near home.

import { CONFIG } from '../../config';
import { Ground, Plant, Species, WallType } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import type { Group, SimState } from '../state';
import { rainFactor } from '../world/climate';
import { hasActive } from './explore';
import { woodOfDensity } from './wood';
import { farmToolMult } from './foodJobs';
import { yieldMult } from './food';
import { blightMult } from '../world/hazards';
import { domesticMult } from '../society/society';

const F = CONFIG.people.food;
const SO = CONFIG.future.soil;
const SA = CONFIG.future.salt;

/** Flags in `farmedThisYear` (F3): what kind of farming each tile saw this year. */
export const Farmed = { Worked: 1, Irrigated: 2, Rotation: 4, Drained: 8, Terraced: 16, Flooded: 32 } as const;

/** Soil quality of a field (F3 §9.4–9.5): yield × (0.4 + 0.6 × fertility) × (1 − salinity). */
export const soilMult = (s: SimState, i: number): number =>
  (SO.yieldBase + (1 - SO.yieldBase) * s.fertility[i]!) * (1 - s.salinity[i]!);

// Water ground never changes and walls keep their type, so "near water" is fixed for a run.
const nearWaterCache = new WeakMap<Uint8Array, Uint8Array>();

/** Within irrigation distance (2 tiles) of Water ground or a River wall. */
export function nearWater(s: SimState, i: number): boolean {
  let c = nearWaterCache.get(s.ground);
  if (!c) {
    c = new Uint8Array(s.ground.length);
    for (let k = 0; k < c.length; k++) c[k] = nearWaterScan(s, k) ? 1 : 0;
    nearWaterCache.set(s.ground, c);
  }
  return c[i] === 1;
}

function nearWaterScan(s: SimState, i: number): boolean {
  const r = F.irrigationDistance;
  const w = s.width;
  const cx = i % w;
  const cy = (i - cx) / w;
  for (let y = Math.max(0, cy - r); y <= Math.min(s.height - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
      const j = y * w + x;
      if (s.ground[j] === Ground.Water || s.wall[j] === WallType.River) return true;
    }
  }
  return false;
}

/** Could tile i become a new field: Grassland with rain ≥ 30, or (Irrigation) dry land near water. */
export function farmableTile(s: SimState, i: number, irrigation: boolean): boolean {
  if (s.wall[i] !== WallType.None || s.plantType[i] === Plant.Farmland) return false;
  if (s.salinity[i]! > SA.barrenAbove) return false;    // salted land is barren (F3)
  const ground = s.ground[i];
  if (ground === Ground.Grassland && s.rainNow[i]! >= F.farmMinRain) return true;
  return irrigation && (ground === Ground.Grassland || ground === Ground.Desert) && nearWater(s, i);
}

/**
 * Field order: best rain × soil first (F3: worn-out and salty land last); then open land before
 * forest or fruit bushes (clearing them throws away foragers' food); then lowest index
 * (DECISIONS 4.2).
 */
const plantValue = (s: SimState, i: number): number => CONFIG.plants.maxStock[s.plantType[i]!]! * s.plantDensity[i]!;
const fieldQuality = (s: SimState, i: number): number => s.rainNow[i]! * soilMult(s, i);
const fieldOrder = (s: SimState) => (a: number, b: number): number =>
  fieldQuality(s, b) - fieldQuality(s, a) || plantValue(s, a) - plantValue(s, b) || a - b;

/** Tiles in the forage range that could become new fields, best first. The camp tile stays open. */
export function farmCandidates(s: SimState, g: Group, range: number[]): number[] {
  if (!hasActive(g, Discovery.farming)) return [];
  const irrigation = hasActive(g, Discovery.irrigation);
  const home = g.homeY * s.width + g.homeX;
  return range.filter((i) => i !== home && farmableTile(s, i, irrigation)).sort(fieldOrder(s));
}

/**
 * The group keeps ceil(farmers / 10) fields: new ones are cleared from the best candidates.
 * Fields are never given up just because fewer people farm this month (winter); unused
 * fields go back to grass after 3 idle years (§10.2, DECISIONS 4.1).
 */
export function ensureFarmTiles(s: SimState, g: Group, farmers: number, candidates: number[]): void {
  const want = Math.ceil(farmers / F.farmersPerTile);
  for (let k = 0; k < candidates.length && g.farmTiles.length < want; k++) {
    const i = candidates[k]!;
    if (s.plantType[i] === Plant.Farmland) continue;
    // Clearing a forest for a field yields its wood (F1: wood cut is the density lost).
    if (s.plantType[i] === Plant.Forest) g.wood += woodOfDensity(s.plantDensity[i]!);
    s.plantType[i] = Plant.Farmland;
    s.plantDensity[i] = 255;
    s.plantFood[i] = 0;
    s.farmIdleYears[i] = 0;
    g.farmTiles.push(i);
  }
  g.farmTiles.sort(fieldOrder(s));
}

/** The k-th farmer this month works field floor(k / 10). Adds their harvest; returns the field (−1 if none). */
export function farmWork(s: SimState, g: Group, slot: number, k: number): number {
  const tile = g.farmTiles[Math.floor(k / F.farmersPerTile)];
  if (tile === undefined) return -1;
  g.foodStock += fieldYield(s, g, tile, yieldMult(s, g, slot));
  return tile;
}

/**
 * One farmer-month on field `tile` (§11.5): 2 FU × season × rain (irrigated ≥ 1) × yield × tools
 * × soil (F3). Marks how the field was farmed this year (soil and salt, F3).
 */
/**
 * What the group's fields give a month, averaged over the year (the seasons average 1), fully
 * worked, at today's rain, canals and soil: the fields' part of the sustainable yield (§11.5).
 * It counts worn soil like the harvest does, so a village on tired fields feels crowded and
 * sends people to new land (DECISIONS 17.7).
 */
export function fieldsSustainable(s: SimState, g: Group): number {
  const irrigation = hasActive(g, Discovery.irrigation);
  let sum = 0;
  for (const tile of g.farmTiles) {
    const rf = rainFactor(s.rainNow[tile]!);
    const watered = irrigation && nearWater(s, tile) ? rf + (Math.max(rf, 1) - rf) * g.maintenance : rf;
    sum += watered * soilMult(s, tile);
  }
  return sum * F.farmersPerTile * F.farmerCap;
}

export function fieldYield(s: SimState, g: Group, tile: number, mult: number): number {
  const rf = rainFactor(s.rainNow[tile]!);
  const irrigated = hasActive(g, Discovery.irrigation) && nearWater(s, tile);
  const season = CONFIG.seasonOfMonth[s.month]!;
  s.farmedThisYear[tile] = s.farmedThisYear[tile]! | Farmed.Worked
    | (irrigated && rf < 1 ? Farmed.Irrigated : 0)            // water was actually brought in
    | (hasActive(g, Discovery.cropRotation) ? Farmed.Rotation : 0)
    | (hasActive(g, Discovery.drainage) && g.maintenance >= 0.5 ? Farmed.Drained : 0)   // drains need upkeep (F5)
    | (hasActive(g, Discovery.terraces) ? Farmed.Terraced : 0);
  // F5: a flood this year took the harvest; blight cuts it; canals deliver water as well as they are kept up.
  if (s.farmedThisYear[tile]! & Farmed.Flooded) return 0;
  const watered = irrigated ? rf + (Math.max(rf, 1) - rf) * g.maintenance : rf;
  return F.farmerCap * F.farmSeason[season]! * watered * blightMult(s, g)
    * mult * farmToolMult(g) * soilMult(s, tile);
}

/**
 * Yearly soil and salt (F3 §9.4–9.5), before idle fields are counted:
 * farmed fields lose fertility (less with Crop Rotation), all other land rests and regains it,
 * fields of herding groups get manure; irrigation without drainage leaves salt, drainage
 * washes it out; land above 0.8 salt is barren and abandoned.
 */
export function yearlySoil(s: SimState): void {
  for (const g of s.groups) {
    if (g.herd < 1) continue;
    for (const i of g.farmTiles) s.fertility[i] = s.fertility[i]! + SO.manureGain;
  }
  for (let i = 0; i < s.fertility.length; i++) {
    const flags = s.farmedThisYear[i]!;
    let fert = s.fertility[i]!;
    if (flags & Farmed.Worked) {
      fert -= SO.cropDrain * (flags & Farmed.Rotation ? SO.rotationMult : 1);
      if (flags & Farmed.Drained) s.salinity[i] = Math.max(0, s.salinity[i]! - SA.drainage);
      else if (flags & Farmed.Irrigated) s.salinity[i] = Math.min(1, s.salinity[i]! + SA.rate);
    } else {
      fert += SO.fallowGain;
    }
    if (flags & Farmed.Flooded) fert += SO.siltGain;   // flood silt (F5, the Nile)
    s.fertility[i] = Math.min(1, Math.max(0, fert));
    if (s.plantType[i] === Plant.Farmland && s.salinity[i]! > SA.barrenAbove) {
      s.plantType[i] = Plant.None;
      s.plantDensity[i] = 0;
      s.plantFood[i] = 0;
      s.farmIdleYears[i] = 0;
    }
  }
}

/** Yearly (§10.2): a field nobody farmed for 3 years turns back into grass. Groups drop lost fields. */
export function farmlandIdle(s: SimState): void {
  const P = CONFIG.plants;
  yearlySoil(s);
  for (let i = 0; i < s.plantType.length; i++) {
    if (s.plantType[i] !== Plant.Farmland) continue;
    s.farmIdleYears[i] = s.farmedThisYear[i] ? 0 : Math.min(255, s.farmIdleYears[i]! + 1);
    if (s.farmIdleYears[i]! >= P.farmlandIdleYears) {
      s.plantType[i] = Plant.Grass;
      s.plantDensity[i] = P.farmlandRevertDensity;
      s.plantFood[i] = 0;
      s.farmIdleYears[i] = 0;
    }
  }
  s.farmedThisYear.fill(0);
  for (const g of s.groups) {
    if (g.farmTiles.length > 0) g.farmTiles = g.farmTiles.filter((i) => s.plantType[i] === Plant.Farmland);
  }
}

// ---------- herding ----------

/** Herd capacity: 5 per grazing tile in range (Grassland/Desert/Mountain with Grass or no plants) × home rain. */
export function herdCapacity(s: SimState, g: Group, range: number[]): number {
  let tiles = 0;
  for (const i of range) {
    const ground = s.ground[i];
    const plant = s.plantType[i];
    if (ground === Ground.Water || (plant !== Plant.Grass && plant !== Plant.None)) continue;
    tiles++;
  }
  return F.herdCapacityPerTile * tiles * rainFactor(s.rainNow[g.homeY * s.width + g.homeX]!);
}

/** Wild herd animals worth taming somewhere in range. */
export function herdFoundInRange(s: SimState, range: number[]): boolean {
  const herd = s.animal[Species.Herd];
  for (const i of range) if (herd[i]! >= CONFIG.animals.foundAtDensity) return true;
  return false;
}

/** This month's herding, shared by every herder in the group. */
export interface HerdMonth { capacity: number; tended: number }

/**
 * One herder (§11.5): while the herd is below capacity, catch up to 2 wild animals from the
 * range tile with the most; then tend up to 20 of the herd for food (× the herder's yield
 * multiplier). Returns the work tile.
 */
export function herdWork(s: SimState, g: Group, mult: number, range: number[], hm: HerdMonth): number {
  const wild = s.animal[Species.Herd];
  let best = -1;
  let bestD = 0;
  for (const i of range) {
    if (wild[i]! > bestD) { bestD = wild[i]!; best = i; }
  }
  if (best >= 0 && g.herd < hm.capacity) {
    const caught = Math.min(F.herdCapturePerHerder, bestD * F.herdAnimalsPerDensity);
    g.herd += caught;
    wild[best] = Math.max(0, bestD - caught / F.herdAnimalsPerDensity);
  }
  const tend = Math.max(0, Math.min(F.herdPerHerder, g.herd - hm.tended));
  hm.tended += tend;
  g.foodStock += tend * F.herdYieldPerAnimal * mult * domesticMult(g);   // F6: tamer herds give more
  return best >= 0 ? best : g.homeY * s.width + g.homeX;
}

/** Monthly herd growth (1.5%), capped at capacity. */
export function growHerd(g: Group, capacity: number): void {
  if (g.herd <= 0) return;
  g.herd = Math.min(capacity, g.herd * (1 + F.herdGrowth));
}
