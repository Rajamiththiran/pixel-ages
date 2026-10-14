// Discovery ids (§12.1). The full table (eras, needs, effects) arrives in build step 4;
// step 3 only needs the ids so rules can already ask "does this group own X?".

export const Discovery = {
  fire: 0, stoneTools: 1, spear: 2, raft: 3, clothing: 4, taming: 5, farming: 6, pottery: 7,
  boat: 8, mudBrick: 9, irrigation: 10, wheel: 11, riding: 12, copperWorking: 13, mining: 14,
  cart: 15, writing: 16, ironWorking: 17, city: 18,
} as const;
export type Discovery = (typeof Discovery)[keyof typeof Discovery];

export const DISCOVERY_COUNT = 19;

export const ERA_NAMES = [
  'Early people', 'Foragers', 'Hunters', 'Farmers', 'Villages', 'Copper Age', 'Iron & Writing',
] as const;

/** True if the bitmask contains discovery d. */
export const has = (mask: number, d: number): boolean => ((mask >>> d) & 1) === 1;
