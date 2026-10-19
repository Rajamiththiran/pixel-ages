// Numeric ids stored in typed arrays. `as const` objects instead of enums (see §4).

export const Ground = { Grassland: 0, Desert: 1, Water: 2, Mountain: 3 } as const;
export type Ground = (typeof Ground)[keyof typeof Ground];

// Farmland is created by people (Farming), never painted.
export const Plant = { None: 0, Forest: 1, FruitBushes: 2, Grass: 3, Farmland: 4 } as const;
export type Plant = (typeof Plant)[keyof typeof Plant];

// Tin and Salt added in F1 (future blueprint §7.3).
export const Resource = { None: 0, Stone: 1, Clay: 2, Copper: 3, Iron: 4, Tin: 5, Salt: 6 } as const;
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
  // Future blueprint §5.1 ids: CutWood (F1), Fish (F3), Burn (F4); Craft and Maintain come later.
  Fish: 12, CutWood: 13, Craft: 14, Maintain: 15, Burn: 16,
} as const;
export type Action = (typeof Action)[keyof typeof Action];

export const Season = { Spring: 0, Summer: 1, Autumn: 2, Winter: 3 } as const;
export type Season = (typeof Season)[keyof typeof Season];

// Display names, indexed by id.
export const GROUND_NAMES = ['Grassland', 'Desert', 'Water', 'Mountain'] as const;
export const PLANT_NAMES = ['None', 'Forest', 'Fruit bushes', 'Grass', 'Farmland'] as const;
export const RESOURCE_NAMES = ['None', 'Stone', 'Clay', 'Copper', 'Iron', 'Tin', 'Salt'] as const;
export const WALL_NAMES = ['None', 'River', 'Mountain', 'Sea'] as const;
export const SPECIES_NAMES = ['Prey', 'Predator', 'Herd', 'Riding'] as const;
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export const ACTION_NAMES = [
  'None', 'Gather', 'Hunt', 'Farm', 'Herd', 'Explore', 'Care', 'Build', 'Wall work', 'Rest', 'Teach', 'Child', 'Fish', 'Cut wood', 'Craft', 'Maintain', 'Burn',
] as const;

// Future blueprint F2 (§8.1): activities a group gets practice in (months of work, decaying).
export const Practice = {
  hunting: 0, gathering: 1, farming: 2, herding: 3, fishing: 4, fireUse: 5,
  clayWork: 6, woodWork: 7, metalWork: 8, building: 9, sailing: 10, fighting: 11,
} as const;
export type Practice = (typeof Practice)[keyof typeof Practice];
export const PRACTICE_COUNT = 12;
export const PRACTICE_NAMES = [
  'Hunting', 'Gathering', 'Farming', 'Herding', 'Fishing', 'Fire use',
  'Clay work', 'Wood work', 'Metal work', 'Building', 'Sailing', 'Fighting',
] as const;

// F2 (§8.2): pressures that make related discoveries likelier ("necessity"), 0–1 over the last year.
export const Need = { hunger: 0, cold: 1, war: 2, fires: 3, floods: 4 } as const;
export type Need = (typeof Need)[keyof typeof Need];
export const NEED_COUNT = 5;
export const NEED_NAMES = ['Hunger', 'Cold', 'War losses', 'Fires', 'Floods'] as const;

// §5.1: disasters with a natural and a human driver. They strike from F5; lessons (F2) are keyed by them.
export const Hazard = {
  Wildfire: 0, TownFire: 1, RiverFlood: 2, FlashFlood: 3, Landslide: 4, DustStorm: 5,
  Outbreak: 6, Pests: 7, Blight: 8, MineCollapse: 9,
} as const;
export type Hazard = (typeof Hazard)[keyof typeof Hazard];
export const HAZARD_COUNT = 10;
export const HAZARD_NAMES = [
  'Wildfire', 'Town fire', 'River flood', 'Flash flood', 'Landslide', 'Dust storm',
  'Outbreak', 'Pests', 'Blight', 'Mine collapse',
] as const;

// F6 (§12.4): a group's inherited habits, 0–100 each.
export const Culture = { sharing: 0, warlike: 1, openness: 2 } as const;
export type Culture = (typeof Culture)[keyof typeof Culture];
export const CULTURE_COUNT = 3;
export const CULTURE_NAMES = ['Sharing', 'Warlike', 'Openness'] as const;

// F6 (§12.6): none, palisade, stone wall.
export const FORTIFICATION_NAMES = ['none', 'palisade', 'stone wall'] as const;

// Everyday names of the painted animals, for log lines (F3: "Deer are gone from Area 2").
export const ANIMAL_NAMES = ['Deer', 'Wolves', 'Goats', 'Horses'] as const;
