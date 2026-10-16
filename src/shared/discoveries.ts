// The discovery table (§12.1, extended by future blueprint F2 §8.3), shared by the simulation
// and the UI.

import { CONFIG } from '../config';
import { Hazard, Need, Practice, Resource } from './ids';

// Ids 0–19 are v1 + F1 and never change (§5.3: old ids are kept); F2 adds 20–39 in era order.
export const Discovery = {
  fire: 0, stoneTools: 1, spear: 2, raft: 3, clothing: 4, taming: 5, farming: 6, pottery: 7,
  boat: 8, mudBrick: 9, irrigation: 10, wheel: 11, riding: 12, copperWorking: 13, mining: 14,
  cart: 15, writing: 16, ironWorking: 17, city: 18,
  bronzeWorking: 19,             // F1 (future blueprint §7.3)
  // F2 (§8.3)
  diggingStick: 20, dogs: 21,
  bow: 22, fishing: 23, fireSafety: 24,
  sickle: 25, granary: 26, wells: 27, salting: 28,
  drainage: 29, fishingNets: 30, firebreaks: 31, palisade: 32,
  plough: 33, levees: 34, terraces: 35,
  stoneBuilding: 36, sewers: 37, cropRotation: 38, sails: 39,
} as const;
export type Discovery = (typeof Discovery)[keyof typeof Discovery];

export const DISCOVERY_COUNT = 40;

// ---------- discovery sets: 2 × 32-bit words (§5.3) ----------

/** Words in a discovery set. 64 bits: room for every F-step discovery. */
export const MASK_WORDS = 2;
export type Mask = Uint32Array;

export const newMask = (): Mask => new Uint32Array(MASK_WORDS);

/** True if the set contains discovery d. Works on plain arrays too (frames, stats). */
export const has = (m: ArrayLike<number>, d: number): boolean => ((m[d >> 5]! >>> (d & 31)) & 1) === 1;

export function addBit(m: Mask, d: number): void {
  m[d >> 5] = m[d >> 5]! | (1 << (d & 31));
}

export function clearBit(m: Mask, d: number): void {
  m[d >> 5] = m[d >> 5]! & ~(1 << (d & 31));
}

/** A new set holding the given discoveries. */
export function maskOf(...ids: number[]): Mask {
  const m = newMask();
  for (const d of ids) addBit(m, d);
  return m;
}

export const isEmpty = (m: ArrayLike<number>): boolean => {
  for (let k = 0; k < m.length; k++) if (m[k] !== 0) return false;
  return true;
};

export const sameMask = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  for (let k = 0; k < MASK_WORDS; k++) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
};

/** a |= b */
export function orInto(a: Mask, b: ArrayLike<number>): void {
  for (let k = 0; k < MASK_WORDS; k++) a[k] = a[k]! | (b[k] ?? 0);
}

/** a &= ~b */
export function clearAll(a: Mask, b: ArrayLike<number>): void {
  for (let k = 0; k < MASK_WORDS; k++) a[k] = a[k]! & ~(b[k] ?? 0);
}

/** A short string key of the set (for caches and change checks). */
export const maskKey = (m: ArrayLike<number>): string => `${m[0]}.${m[1]}`;

/** The discovery ids in the set, ascending. */
export function idsOf(m: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let d = 0; d < DISCOVERY_COUNT; d++) if (has(m, d)) out.push(d);
  return out;
}

// ---------- what a group must have found ----------

/** Things a group must have found on its known tiles (§12.2), as bits of one mask. */
export const Found = {
  Forest: 1 << 0,
  Stone: 1 << 1,
  Clay: 1 << 2,
  Copper: 1 << 3,
  Iron: 1 << 4,
  Water: 1 << 5,
  Mountain: 1 << 6,
  WetGrassland: 1 << 7,          // Grassland with rain ≥ 30
  HerdAnimals: 1 << 8,
  RidingAnimals: 1 << 9,
  Hunted: 1 << 10,               // at least one successful hunt
  Tin: 1 << 11,                  // F1
  Salt: 1 << 12,                 // F1 (Salting, F2)
  Predators: 1 << 13,            // F2: wolves, for Dogs
} as const;

export const FOUND_NAMES: ReadonlyArray<readonly [number, string]> = [
  [Found.Forest, 'Forest'], [Found.Stone, 'Stone'], [Found.Clay, 'Clay'], [Found.Copper, 'Copper'],
  [Found.Iron, 'Iron'], [Found.Water, 'Water'], [Found.Mountain, 'Mountain'],
  [Found.WetGrassland, 'Grassland with rain ≥ 30'], [Found.HerdAnimals, 'Herd animals'],
  [Found.RidingAnimals, 'Riding animals'], [Found.Hunted, 'a successful hunt'], [Found.Tin, 'Tin'], [Found.Salt, 'Salt'],
  [Found.Predators, 'Predators (wolves)'],
];

/** The Found bit for a resource id. */
export const FOUND_OF_RESOURCE: Record<number, number> = {
  [Resource.Stone]: Found.Stone,
  [Resource.Clay]: Found.Clay,
  [Resource.Copper]: Found.Copper,
  [Resource.Iron]: Found.Iron,
  [Resource.Tin]: Found.Tin,
  [Resource.Salt]: Found.Salt,
};

// ---------- the table ----------

export interface DiscoveryDef {
  id: number;
  key: keyof typeof Discovery;
  name: string;
  era: number;                   // 1–6
  needsFound: number;            // Found bits
  needs: readonly number[];      // discoveries that must be owned first (always lower ids)
  minPopulation: number;         // City only
  uses: number;                  // Resource used up every year (§12.6), Resource.None if none
  practice: number;              // F2: the activity whose practice makes it likelier (Practice id, −1 none)
  need: number;                  // F2: the pressure that makes it likelier (Need id, −1 none)
  effect: string;                // shown in the inspector
}

const D = Discovery;
const F = Found;
const P = Practice;
const N = Need;

interface Extra { uses?: number; minPopulation?: number; practice?: number; need?: number }

const def = (
  key: keyof typeof Discovery, name: string, era: number, needsFound: number, needs: readonly number[],
  effect: string, x: Extra = {},
): DiscoveryDef => ({
  id: D[key], key, name, era, needsFound, needs, effect,
  minPopulation: x.minPopulation ?? 0, uses: x.uses ?? Resource.None, practice: x.practice ?? -1, need: x.need ?? -1,
});

/**
 * Indexed by discovery id. Practice and need links follow §8.2: inventions come from people
 * already doing the related work (practice), under pressure (need). Effects marked "(F3)" etc.
 * arrive with that update; until then the discovery counts for eras and as a requirement.
 */
export const DISCOVERIES: readonly DiscoveryDef[] = [
  def('fire', 'Fire', 1, F.Forest, [], 'All food ×1.15 (cooked); no extra winter deaths', { practice: P.gathering, need: N.cold }),
  def('stoneTools', 'Stone Tools', 1, F.Stone, [], 'Gather ×1.2; full hunting', { uses: Resource.Stone, practice: P.gathering, need: N.hunger }),
  def('spear', 'Spear', 1, F.Forest, [D.stoneTools], 'Hunt success ×1.5; predator attacks ×0.5', { practice: P.hunting, need: N.hunger }),
  def('raft', 'Raft', 2, F.Forest | F.Water, [], 'Water tiles become passable', { practice: P.woodWork }),
  def('clothing', 'Clothing', 2, F.Hunted, [D.spear], 'No extra deaths living in desert or mountains', { practice: P.hunting, need: N.cold }),
  def('taming', 'Taming', 2, F.HerdAnimals, [], 'Herd action: capture and keep herd animals', { practice: P.hunting, need: N.hunger }),
  def('farming', 'Farming', 3, F.WetGrassland, [], 'Farm action and farm tiles', { practice: P.gathering, need: N.hunger }),
  def('pottery', 'Pottery', 3, F.Clay, [D.fire], 'Food spoils 6% a month instead of 10%; no pests in big stores', { uses: Resource.Clay, practice: P.fireUse }),
  def('boat', 'Boat', 3, 0, [D.raft, D.stoneTools], 'Can work on River and Sea walls', { practice: P.woodWork }),
  def('mudBrick', 'Mud Brick', 4, F.Clay, [D.farming], 'Deaths ×0.8; builds mud-brick houses', { uses: Resource.Clay, practice: P.building }),
  def('irrigation', 'Irrigation', 4, F.Water, [D.farming], 'Farm dry land near water', { practice: P.farming, need: N.hunger }),
  def('wheel', 'Wheel', 4, 0, [D.pottery, D.farming], 'Needed for Cart', { practice: P.clayWork }),
  def('riding', 'Riding', 4, F.RidingAnimals, [D.taming], 'Explore ×3, migrate ×2, war ×1.3, wall wear ×1.2', { practice: P.herding }),
  def('copperWorking', 'Copper Working', 5, F.Copper, [D.pottery], 'All food ×1.15, war ×1.2', { uses: Resource.Copper, practice: P.fireUse }),
  def('mining', 'Mining', 5, F.Mountain, [D.copperWorking], 'Can work on Mountain walls', { practice: P.metalWork }),
  def('cart', 'Cart', 5, 0, [D.wheel, D.taming], 'Explore ×2, migrate ×2', { practice: P.woodWork }),
  def('writing', 'Writing', 6, 0, [D.pottery, D.farming], 'Discovery chance ×1.3, forget limits halved, +3 intelligence', { practice: P.clayWork }),
  def('ironWorking', 'Iron Working', 6, F.Iron, [D.copperWorking], 'War ×1.4, farm yield ×1.2', { uses: Resource.Iron, practice: P.metalWork, need: N.war }),
  def('city', 'City', 6, 0, [D.writing, D.mudBrick], 'Top era; city buildings', { minPopulation: CONFIG.discoveries.cityMinPop, practice: P.building }),
  // F1: copper + tin. Tin is rare, so bronze makes far-off deposits worth reaching (real Bronze Age).
  def('bronzeWorking', 'Bronze Working', 5, F.Tin, [D.copperWorking], 'All food ×1.05 (better tools), war ×1.25', { uses: Resource.Tin, practice: P.metalWork, need: N.war }),
  // ---- F2 (§8.3) ----
  def('diggingStick', 'Digging Stick', 1, F.Forest, [], 'Gather ×1.1 (roots and tubers)', { practice: P.gathering, need: N.hunger }),
  def('dogs', 'Dogs', 1, F.Predators | F.Hunted, [], 'Hunt success ×1.2; wolves take 70% fewer herd animals', { practice: P.hunting, need: N.hunger }),
  def('bow', 'Bow', 2, F.Forest, [D.spear], 'Hunt success ×1.3', { practice: P.hunting, need: N.hunger }),
  // Shore gathering leads to hooks; once people fish, fishing practice leads to nets (F3).
  def('fishing', 'Fishing', 2, F.Water, [D.stoneTools], 'Hooks: fish lakes, rivers and coasts', { practice: P.gathering, need: N.hunger }),
  def('fireSafety', 'Fire Safety', 2, F.Forest, [D.fire], 'Burns forest edges in spring for fresh grazing; 80% fewer wildfires from its own fires', { practice: P.fireUse, need: N.fires }),
  def('sickle', 'Sickle', 3, 0, [D.farming, D.stoneTools], 'Farm yield ×1.1', { practice: P.farming, need: N.hunger }),
  def('granary', 'Granary', 3, 0, [D.farming], 'Stored food spoils half as fast (up to 12 months of need); no pests', { practice: P.farming, need: N.hunger }),
  def('wells', 'Wells', 3, 0, [D.diggingStick, D.farming], 'Clean water: endemic disease halved', { practice: P.building, need: N.hunger }),
  def('salting', 'Salting', 3, F.Salt, [D.pottery], 'Food spoils ×0.8', { uses: Resource.Salt, practice: P.hunting, need: N.hunger }),
  def('drainage', 'Drainage', 4, F.Water, [D.irrigation], 'Washes salt out of fields; town drains against flash floods', { practice: P.farming, need: N.floods }),
  def('fishingNets', 'Fishing Nets', 4, F.Water, [D.fishing], 'Fish catch ×1.5', { practice: P.fishing, need: N.hunger }),
  def('firebreaks', 'Firebreaks', 4, 0, [D.fireSafety, D.farming], 'Town fires halved', { practice: P.building, need: N.fires }),
  def('palisade', 'Palisade', 4, F.Forest, [D.farming, D.spear], 'Wooden walls (200 wood) when threatened: defence ×1.3', { practice: P.woodWork, need: N.war }),
  def('plough', 'Plough', 5, 0, [D.farming, D.taming], 'Oxen plough: farm yield up to ×1.5 with 2 herd animals a field', { practice: P.farming, need: N.hunger }),
  def('levees', 'Levees', 5, F.Water, [D.irrigation, D.mudBrick], 'River floods held back while kept up', { practice: P.building, need: N.floods }),
  def('terraces', 'Terraces', 5, F.Mountain, [D.farming], 'Farmed slopes keep their soil (terraces)', { practice: P.farming, need: N.hunger }),
  def('stoneBuilding', 'Stone Building', 6, F.Stone, [D.mudBrick, D.copperWorking], 'Stone houses; stone walls (500 stone) when threatened: defence ×1.8; town fires halved', { practice: P.building, need: N.war }),
  def('sewers', 'Sewers', 6, 0, [D.drainage, D.mudBrick], 'Clean towns: endemic disease halved; drains against flash floods', { practice: P.building, need: N.floods }),
  def('cropRotation', 'Crop Rotation', 6, 0, [D.plough], 'Fields wear out 60% slower', { practice: P.farming, need: N.hunger }),
  def('sails', 'Sails', 6, F.Water, [D.boat], 'Explore range ×1.5', { practice: P.sailing }),
];

/** Number of discoveries in each era, indexed by era (index 0 unused). */
export const ERA_SIZES: readonly number[] = [0, 1, 2, 3, 4, 5, 6].map((e) => DISCOVERIES.filter((d) => d.era === e).length);

/** Discoveries of era e a group needs to be in that era: at least 60% of them (F2, replaces "all but one"). */
export const ERA_NEEDED: readonly number[] = ERA_SIZES.map((n) => Math.ceil(n * CONFIG.future.eraShareNeeded - 1e-9));

export const ERA_NAMES = [
  'Early people', 'Foragers', 'Hunters', 'Farmers', 'Villages', 'Copper Age', 'Iron & Writing',
] as const;

/**
 * Prevention discoveries for each hazard (§11.1): after a hazard strikes, these get a lesson
 * boost (§4.5). Hazards strike from F5; the planned Plague teaches too.
 */
export const HAZARD_PREVENTION: Readonly<Record<number, readonly number[]>> = {
  [Hazard.Wildfire]: [D.fireSafety],
  [Hazard.TownFire]: [D.firebreaks, D.stoneBuilding],
  [Hazard.RiverFlood]: [D.levees],
  [Hazard.FlashFlood]: [D.drainage, D.sewers],
  [Hazard.Landslide]: [D.terraces],
  [Hazard.DustStorm]: [],
  [Hazard.Outbreak]: [D.wells, D.sewers],
  [Hazard.Pests]: [D.pottery, D.granary],
  [Hazard.Blight]: [D.cropRotation],
  [Hazard.MineCollapse]: [],
};

/** For each discovery, the hazards whose lessons make it likelier. */
export const LESSONS_FOR: readonly number[][] = DISCOVERIES.map((d) =>
  Object.entries(HAZARD_PREVENTION).filter(([, ids]) => ids.includes(d.id)).map(([h]) => Number(h)));
