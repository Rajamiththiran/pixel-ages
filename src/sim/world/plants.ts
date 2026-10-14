// Plants (§10.2) and ground change (§10.3).

import { CONFIG } from '../../config';
import { Ground, Plant, WallType } from '../../shared/ids';
import { chance } from '../../shared/rng';
import type { SimState } from '../state';
import { rainFactor } from './climate';

const P = CONFIG.plants;
const G = CONFIG.ground;

interface PlantRule {
  dieBelowRain: number; fullAtRain: number; spreadMinRain: number; spreadChance: number;
  groundMult: readonly number[];
}
const RULES: Record<number, PlantRule> = {
  [Plant.Forest]: P.forest,
  [Plant.FruitBushes]: P.fruit,
  [Plant.Grass]: P.grass,
};

/** Food stock the tile's plants can hold right now. */
export function maxStock(s: SimState, i: number): number {
  return P.maxStock[s.plantType[i]!]! * (s.plantDensity[i]! / 255) * rainFactor(s.rainNow[i]!);
}

export function initPlantFood(s: SimState): void {
  for (let i = 0; i < s.plantFood.length; i++) s.plantFood[i] = maxStock(s, i);
}

/** Monthly regrowth toward the current maximum. `regenMult` is 0.5 during Harsh winters (step 6). */
export function regenPlants(s: SimState, season: number, regenMult = 1): void {
  const seasonRegen = P.seasonRegen[season]! * regenMult;
  for (let i = 0; i < s.plantFood.length; i++) {
    if (s.plantType[i] === Plant.None) continue;
    const max = maxStock(s, i);
    const food = s.plantFood[i]!;
    s.plantFood[i] = food < max ? food + P.regenRate * (max - food) * seasonRegen : max;
  }
}

/** Density this plant moves toward on tile i, from rain and ground. */
export function targetDensity(s: SimState, plant: number, i: number): number {
  const r = RULES[plant];
  if (!r) return 0;
  const t = Math.min(1, Math.max(0, (s.rainNow[i]! - r.dieBelowRain) / (r.fullAtRain - r.dieBelowRain)));
  return Math.round(255 * t * r.groundMult[s.ground[i]!]!);
}

/** Yearly: growth/death toward target density, then spread, then ground change. */
export function yearlyPlants(s: SimState): void {
  growAndDie(s);
  spread(s);
  groundChange(s);
}

function growAndDie(s: SimState): void {
  for (let i = 0; i < s.plantType.length; i++) {
    const type = s.plantType[i]!;
    if (type === Plant.None || type === Plant.Farmland) continue;
    const d = s.plantDensity[i]!;
    const target = targetDensity(s, type, i);
    let next = d;
    if (d < target) next = Math.min(target, d + P.growPerYear);
    else if (d > target) next = Math.max(target, d - P.diePerYear);
    s.plantDensity[i] = next;
    if (next === 0) {
      s.plantType[i] = Plant.None;
      s.plantFood[i] = 0;
    }
  }
}

// Double buffer for spread, reused between years.
let prevType = new Uint8Array(0);
let prevDens = new Uint8Array(0);

/**
 * Spread reads neighbours from a copy taken before spreading starts, so processing tiles in
 * index order doesn't let a plant hop several tiles in one year.
 */
function spread(s: SimState): void {
  const n = s.plantType.length;
  if (prevType.length !== n) { prevType = new Uint8Array(n); prevDens = new Uint8Array(n); }
  prevType.set(s.plantType);
  prevDens.set(s.plantDensity);
  const w = s.width;
  const h = s.height;
  for (let i = 0; i < n; i++) {
    const type = s.plantType[i]!;
    if (s.wall[i] !== WallType.None) continue;
    if (type !== Plant.None && type !== Plant.Grass) continue;
    const rain = s.rainNow[i]!;
    const ground = s.ground[i]!;
    const grassland = ground === Ground.Grassland;
    if (grassland && rain >= P.forest.spreadMinRain && trySpread(s, i, w, h, Plant.Forest, P.forest.spreadChance)) continue;
    if (grassland && rain >= P.fruit.spreadMinRain && trySpread(s, i, w, h, Plant.FruitBushes, P.fruit.spreadChance)) continue;
    if (type === Plant.None && ground !== Ground.Water && rain >= P.grass.spreadMinRain) {
      trySpread(s, i, w, h, Plant.Grass, P.grass.spreadChance);
    }
  }
}

/** One roll per neighbour that is a dense source of `plant`; stops at the first success. */
function trySpread(s: SimState, i: number, w: number, h: number, plant: number, p: number): boolean {
  const x = i % w;
  const y = (i - x) / w;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      if (nx < 0 || nx >= w) continue;
      const j = ny * w + nx;
      if (prevType[j] !== plant || prevDens[j]! < P.spreadSourceMinDensity) continue;
      if (chance(s.rng, p)) {
        s.plantType[i] = plant;
        s.plantDensity[i] = P.newPlantDensity;
        s.plantFood[i] = 0;
        return true;
      }
    }
  }
  return false;
}

function groundChange(s: SimState): void {
  for (let i = 0; i < s.ground.length; i++) {
    if (s.wall[i] !== WallType.None) continue;
    const g = s.ground[i]!;
    const rain = s.rainNow[i]!;
    if (g === Ground.Grassland) {
      s.wetYears[i] = 0;
      s.dryYears[i] = rain < G.desertifyBelowRain ? Math.min(65535, s.dryYears[i]! + 1) : 0;
      if (s.dryYears[i]! >= G.desertifyYears) { s.ground[i] = Ground.Desert; s.dryYears[i] = 0; }
    } else if (g === Ground.Desert) {
      s.dryYears[i] = 0;
      s.wetYears[i] = rain >= G.greenAtRain ? Math.min(65535, s.wetYears[i]! + 1) : 0;
      if (s.wetYears[i]! >= G.greenYears) { s.ground[i] = Ground.Grassland; s.wetYears[i] = 0; }
    }
  }
}
