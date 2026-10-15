// The discovery table (§12.1), shared by the simulation and the UI.

import { CONFIG } from '../config';
import { Resource } from './ids';

export const Discovery = {
  fire: 0, stoneTools: 1, spear: 2, raft: 3, clothing: 4, taming: 5, farming: 6, pottery: 7,
  boat: 8, mudBrick: 9, irrigation: 10, wheel: 11, riding: 12, copperWorking: 13, mining: 14,
  cart: 15, writing: 16, ironWorking: 17, city: 18,
} as const;
export type Discovery = (typeof Discovery)[keyof typeof Discovery];

export const DISCOVERY_COUNT = 19;

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
} as const;

export const FOUND_NAMES: ReadonlyArray<readonly [number, string]> = [
  [Found.Forest, 'Forest'], [Found.Stone, 'Stone'], [Found.Clay, 'Clay'], [Found.Copper, 'Copper'],
  [Found.Iron, 'Iron'], [Found.Water, 'Water'], [Found.Mountain, 'Mountain'],
  [Found.WetGrassland, 'Grassland with rain ≥ 30'], [Found.HerdAnimals, 'Herd animals'],
  [Found.RidingAnimals, 'Riding animals'], [Found.Hunted, 'a successful hunt'],
];

/** The Found bit for a resource id. */
export const FOUND_OF_RESOURCE: Record<number, number> = {
  [Resource.Stone]: Found.Stone,
  [Resource.Clay]: Found.Clay,
  [Resource.Copper]: Found.Copper,
  [Resource.Iron]: Found.Iron,
};

export interface DiscoveryDef {
  id: number;
  key: keyof typeof Discovery;
  name: string;
  era: number;                   // 1–6
  needsFound: number;            // Found bits
  needs: number;                 // bitmask of discoveries that must be owned first
  minPopulation: number;         // City only
  uses: number;                  // Resource used up every year (§12.6), Resource.None if none
  effect: string;                // shown in the inspector
}

const bit = (...ids: number[]): number => ids.reduce((m, d) => m | (1 << d), 0);
const D = Discovery;
const F = Found;

const def = (
  key: keyof typeof Discovery, name: string, era: number, needsFound: number, needs: number,
  effect: string, uses: number = Resource.None, minPopulation = 0,
): DiscoveryDef => ({ id: D[key], key, name, era, needsFound, needs, minPopulation, uses, effect });

/** Indexed by discovery id. */
export const DISCOVERIES: readonly DiscoveryDef[] = [
  def('fire', 'Fire', 1, F.Forest, 0, 'All food ×1.15 (cooked); no extra winter deaths'),
  def('stoneTools', 'Stone Tools', 1, F.Stone, 0, 'Gather ×1.2; full hunting', Resource.Stone),
  def('spear', 'Spear', 1, F.Forest, bit(D.stoneTools), 'Hunt success ×1.5; predator attacks ×0.5'),
  def('raft', 'Raft', 2, F.Forest | F.Water, 0, 'Water tiles become passable'),
  def('clothing', 'Clothing', 2, F.Hunted, bit(D.spear), 'No extra deaths living in desert or mountains'),
  def('taming', 'Taming', 2, F.HerdAnimals, 0, 'Herd action: capture and keep herd animals'),
  def('farming', 'Farming', 3, F.WetGrassland, 0, 'Farm action and farm tiles'),
  def('pottery', 'Pottery', 3, F.Clay, bit(D.fire), 'Food spoils 6% a month instead of 10%', Resource.Clay),
  def('boat', 'Boat', 3, 0, bit(D.raft, D.stoneTools), 'Can work on River and Sea walls'),
  def('mudBrick', 'Mud Brick', 4, F.Clay, bit(D.farming), 'Deaths ×0.8; builds mud-brick houses', Resource.Clay),
  def('irrigation', 'Irrigation', 4, F.Water, bit(D.farming), 'Farm dry land near water'),
  def('wheel', 'Wheel', 4, 0, bit(D.pottery, D.farming), 'Needed for Cart'),
  def('riding', 'Riding', 4, F.RidingAnimals, bit(D.taming), 'Explore ×3, migrate ×2, war ×1.3, wall wear ×1.2'),
  def('copperWorking', 'Copper Working', 5, F.Copper, bit(D.pottery), 'All food ×1.15, war ×1.2', Resource.Copper),
  def('mining', 'Mining', 5, F.Mountain, bit(D.copperWorking), 'Can work on Mountain walls'),
  def('cart', 'Cart', 5, 0, bit(D.wheel, D.taming), 'Explore ×2, migrate ×2'),
  def('writing', 'Writing', 6, 0, bit(D.pottery, D.farming), 'Discovery chance ×1.3, forget limits halved, +3 intelligence'),
  def('ironWorking', 'Iron Working', 6, F.Iron, bit(D.copperWorking), 'War ×1.4, farm yield ×1.2', Resource.Iron),
  def('city', 'City', 6, 0, bit(D.writing, D.mudBrick), 'Top era; city buildings', Resource.None, CONFIG.discoveries.cityMinPop),
];

/** Number of discoveries in each era, indexed by era (index 0 unused). */
export const ERA_SIZES: readonly number[] = [0, 1, 2, 3, 4, 5, 6].map((e) => DISCOVERIES.filter((d) => d.era === e).length);

export const ERA_NAMES = [
  'Early people', 'Foragers', 'Hunters', 'Farmers', 'Villages', 'Copper Age', 'Iron & Writing',
] as const;

/** True if the bitmask contains discovery d. */
export const has = (mask: number, d: number): boolean => ((mask >>> d) & 1) === 1;
