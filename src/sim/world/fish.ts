// Fish (future blueprint F3, §9.1): density 0–1 on Water ground and River/Sea walls, logistic
// growth toward a capacity set by the kind of water, and slow diffusion between water tiles.

import { CONFIG } from '../../config';
import { Ground, WallType } from '../../shared/ids';
import type { SimState } from '../state';

const FI = CONFIG.future.fish;

/** Fish capacity of tile i: river 0.8, lake (Water ground) 0.6, sea 0.5; 0 on land and mountains. */
export function fishCapacity(s: SimState, i: number): number {
  const wall = s.wall[i]!;
  if (wall === WallType.River) return FI.kRiver;
  if (wall === WallType.Sea) return FI.kSea;
  if (wall === WallType.None && s.ground[i] === Ground.Water) return FI.kLake;
  return 0;
}

// Capacity per tile is fixed for a run (water ground and wall types never change).
const capCache = new WeakMap<Uint8Array, Float32Array>();

function capacities(s: SimState): Float32Array {
  let c = capCache.get(s.wall);
  if (!c) {
    c = new Float32Array(s.wall.length);
    for (let i = 0; i < c.length; i++) c[i] = fishCapacity(s, i);
    capCache.set(s.wall, c);
  }
  return c;
}

/** Waters start full, as if they had been left alone for a long time. */
export function initFish(s: SimState): void {
  s.fish.set(capacities(s));
}

let scratch = new Float32Array(0);

/** Monthly: logistic growth, then 3% diffusion to orthogonal water neighbours (read from a copy). */
export function updateFish(s: SimState): void {
  const K = capacities(s);
  const fish = s.fish;
  const n = fish.length;
  for (let i = 0; i < n; i++) {
    const f = fish[i]!;
    if (f === 0) continue;
    const k = K[i]!;
    fish[i] = k > 0 ? f + FI.growth * f * (1 - f / k) : 0;
  }
  if (scratch.length !== n) scratch = new Float32Array(n);
  scratch.set(fish);
  const w = s.width;
  const share = FI.diffusion / 4;
  for (let i = 0; i < n; i++) {
    const d = scratch[i]!;
    if (d === 0) continue;
    const give = d * share;
    const x = i % w;
    if (i >= w && K[i - w]! > 0) { fish[i] = fish[i]! - give; fish[i - w] = fish[i - w]! + give; }
    if (x > 0 && K[i - 1]! > 0) { fish[i] = fish[i]! - give; fish[i - 1] = fish[i - 1]! + give; }
    if (x < w - 1 && K[i + 1]! > 0) { fish[i] = fish[i]! - give; fish[i + 1] = fish[i + 1]! + give; }
    if (i + w < n && K[i + w]! > 0) { fish[i] = fish[i]! - give; fish[i + w] = fish[i + w]! + give; }
  }
  const minD = CONFIG.animals.minDensity;
  for (let i = 0; i < n; i++) {
    const d = fish[i]!;
    if (d !== 0) fish[i] = d < minD ? 0 : d > 1 ? 1 : d;
  }
}

/**
 * Sustainable catch of water tile i in FU a month (F3): the most fish it can give for ever,
 * taken at half its capacity, where it regrows fastest: growth × K/4 regrows, each catch takes
 * 0.01 and brings yield × K/2.
 */
export function fishSustainable(s: SimState, i: number): number {
  const k = capacities(s)[i]!;
  return ((FI.growth * k) / 4 / FI.depletion) * FI.yield * (k / 2);
}

/**
 * Water tiles a group can fish from, within the forage range of home (ascending): every known
 * water tile, and the open water joined to it through water. People only "know" the first row
 * of a river or sea (the bank, §11.7), but they can fish the water they see beyond it. Shore
 * fishing needs no boat (hooks and lines from the bank).
 */
export function fishTiles(s: SimState, homeX: number, homeY: number, known: Uint8Array): number[] {
  const K = capacities(s);
  const r = CONFIG.people.range.forage;
  const w = s.width;
  const inRange = (i: number): boolean => {
    const x = i % w;
    const y = (i - x) / w;
    return (x - homeX) * (x - homeX) + (y - homeY) * (y - homeY) <= r * r;
  };
  const mark = new Set<number>();
  const queue: number[] = [];
  for (let y = Math.max(0, homeY - r); y <= Math.min(s.height - 1, homeY + r); y++) {
    for (let x = Math.max(0, homeX - r); x <= Math.min(w - 1, homeX + r); x++) {
      const i = y * w + x;
      if (K[i]! > 0 && inRange(i) && ((known[i >> 3]! >> (i & 7)) & 1) === 1) { mark.add(i); queue.push(i); }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % w;
    for (const j of [i - w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i + w]) {
      if (j < 0 || j >= K.length || mark.has(j) || K[j]! <= 0 || !inRange(j)) continue;
      mark.add(j);
      queue.push(j);
    }
  }
  return [...mark].sort((a, b) => a - b);
}
