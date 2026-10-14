// Numeric ids stored in typed arrays. `as const` objects instead of enums (see §4).

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
export type Season = (typeof Season)[keyof typeof Season];

// Display names, indexed by id.
export const GROUND_NAMES = ['Grassland', 'Desert', 'Water', 'Mountain'] as const;
export const PLANT_NAMES = ['None', 'Forest', 'Fruit bushes', 'Grass', 'Farmland'] as const;
export const RESOURCE_NAMES = ['None', 'Stone', 'Clay', 'Copper', 'Iron'] as const;
export const WALL_NAMES = ['None', 'River', 'Mountain', 'Sea'] as const;
export const SPECIES_NAMES = ['Prey', 'Predator', 'Herd', 'Riding'] as const;
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export const ACTION_NAMES = [
  'None', 'Gather', 'Hunt', 'Farm', 'Herd', 'Explore', 'Care', 'Build', 'Wall work', 'Rest', 'Teach', 'Child',
] as const;
