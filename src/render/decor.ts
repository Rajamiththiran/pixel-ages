// Decorative wild animals, buildings and camp objects (§18.5). Visual only: Math.random is
// fine here because nothing in this file feeds back into the simulation.

import { CONFIG } from '../config';
import { Ground, Plant, Species, WallType } from '../shared/ids';
import { Discovery, has } from '../shared/discoveries';
import type { MapData } from '../shared/types';
import { getSprite } from './sprites';

const R = CONFIG.render;
const TILE = CONFIG.map.tilePx;

const SPRITE_BASE: Record<number, string> = {
  [Species.Prey]: 'deer',
  [Species.Predator]: 'wolf',
  [Species.Herd]: 'goat',
  [Species.Riding]: 'horse',
};

// Struct-of-arrays so the per-frame update allocates nothing.
export class WildAnimals {
  count = 0;
  private species = new Uint8Array(R.maxAnimalSprites);
  private x = new Float32Array(R.maxAnimalSprites);
  private y = new Float32Array(R.maxAnimalSprites);
  private tx = new Float32Array(R.maxAnimalSprites);
  private ty = new Float32Array(R.maxAnimalSprites);
  private nextTurnMs = new Float64Array(R.maxAnimalSprites);
  private facingLeft = new Uint8Array(R.maxAnimalSprites);
  private moving = new Uint8Array(R.maxAnimalSprites);
  private blockX = new Int16Array(R.maxAnimalSprites);
  private blockY = new Int16Array(R.maxAnimalSprites);
  private map: MapData | null = null;
  // densities in 0..1 per species, read when picking wander targets
  private density: Float32Array[] = [];

  /**
   * Rebuilds the animal list from densities (0..1 per tile, per species).
   * Per 4×4-tile block and species: floor(sum / 4 + random), max 2 per block, max 400 total.
   */
  rebuild(map: MapData, density: Float32Array[]): void {
    this.map = map;
    this.density = density;
    this.count = 0;
    const B = R.animalBlock;
    const bw = Math.ceil(map.width / B);
    const bh = Math.ceil(map.height / B);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        for (let s = 0; s < 4; s++) {
          const d = density[s]!;
          let sum = 0;
          for (let y = by * B; y < Math.min(map.height, by * B + B); y++) {
            for (let x = bx * B; x < Math.min(map.width, bx * B + B); x++) sum += d[y * map.width + x]!;
          }
          if (sum <= 0) continue;
          const n = Math.min(R.animalsPerBlockMax, Math.floor(sum / R.animalDensityDivisor + Math.random()));
          for (let k = 0; k < n && this.count < R.maxAnimalSprites; k++) {
            const a = this.count++;
            this.species[a] = s;
            this.blockX[a] = bx;
            this.blockY[a] = by;
            this.pickSpot(a);
            this.x[a] = this.tx[a]!;
            this.y[a] = this.ty[a]!;
            this.moving[a] = 0;
            this.facingLeft[a] = Math.random() < 0.5 ? 1 : 0;
            this.nextTurnMs[a] = performance.now() + Math.random() * R.animalWanderMs * 2;
          }
        }
      }
    }
  }

  /** Random pixel on a land tile of the animal's block that has some of its species. */
  private pickSpot(a: number): void {
    const map = this.map!;
    const B = R.animalBlock;
    const s = this.species[a]!;
    const d = this.density[s]!;
    for (let tries = 0; tries < 12; tries++) {
      const x = this.blockX[a]! * B + Math.floor(Math.random() * B);
      const y = this.blockY[a]! * B + Math.floor(Math.random() * B);
      if (x >= map.width || y >= map.height) continue;
      const i = y * map.width + x;
      if (map.ground[i] === Ground.Water || map.wall[i] !== WallType.None || d[i]! <= 0) continue;
      this.tx[a] = x * TILE + 1 + Math.random() * (TILE - 2);
      this.ty[a] = y * TILE + 2 + Math.random() * (TILE - 2);
      return;
    }
  }

  update(nowMs: number, dtMs: number): void {
    const step = (R.animalSpeedPx * dtMs) / 1000;
    for (let a = 0; a < this.count; a++) {
      if (nowMs >= this.nextTurnMs[a]!) {
        this.pickSpot(a);
        this.nextTurnMs[a] = nowMs + R.animalWanderMs * (0.5 + Math.random());
      }
      const dx = this.tx[a]! - this.x[a]!;
      const dy = this.ty[a]! - this.y[a]!;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len <= step) {
        this.x[a] = this.tx[a]!;
        this.y[a] = this.ty[a]!;
        this.moving[a] = 0;
      } else {
        this.x[a] = this.x[a]! + (dx / len) * step;
        this.y[a] = this.y[a]! + (dy / len) * step;
        this.moving[a] = 1;
        if (Math.abs(dx) > 0.5) this.facingLeft[a] = dx < 0 ? 1 : 0;
      }
    }
  }

  /** Pushes each animal into the y-sorted draw list. */
  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    const frame = this.walkFrame(nowMs);
    for (let a = 0; a < this.count; a++) {
      const f = this.moving[a] ? frame : 1;
      const img = animalSprite(this.species[a]!, f, this.facingLeft[a] === 1);
      push(img, this.x[a]!, this.y[a]!);
    }
  }

  private walkFrame(nowMs: number): 1 | 2 {
    return Math.floor(nowMs / R.walkFrameMs) % 2 === 0 ? 1 : 2;
  }
}

// Lookup table so the draw loop doesn't build cache-key strings per animal.
const spriteTable: HTMLCanvasElement[] = [];
function animalSprite(species: number, frame: 1 | 2, flip: boolean): HTMLCanvasElement {
  const k = species * 4 + (frame - 1) * 2 + (flip ? 1 : 0);
  return (spriteTable[k] ??= getSprite(`${SPRITE_BASE[species]}_${frame}`, {}, flip));
}

/** Painted densities (0–255) → 0..1, the same conversion the simulation uses (§10.4). */
export function paintedDensities(map: MapData): Float32Array[] {
  return map.animals.map((layer) => {
    const out = new Float32Array(layer.length);
    for (let i = 0; i < layer.length; i++) out[i] = layer[i]! / 255;
    return out;
  });
}

export interface BuildingGroup { id: number; homeX: number; homeY: number; huts: number; houses: number; farms: number }

interface Building { x: number; y: number; w: number; h: number; img: 'hut' | 'house' }

/**
 * Huts and mud-brick houses around each home (§18.5): candidate tiles sorted by (distance²,
 * dy, dx); each building takes the next candidate whose footprint (hut 1×1, house 2×2, top-left
 * at the candidate) is dry, wall-free, not a field, and free. Houses go first, nearest the camp.
 * A band draws at most 12 buildings. Recomputed only when a home, a count or the fields change.
 */
export class BuildingLayer {
  private key = '';
  private list: Building[] = [];
  private readonly imgs: Partial<Record<Building['img'], HTMLCanvasElement>> = {};

  update(map: MapData, groups: readonly BuildingGroup[]): void {
    const key = groups.map((g) => `${g.id}:${g.homeX},${g.homeY},${g.huts},${g.houses},${g.farms}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.list = [];
    const used = new Set<number>();
    for (const g of groups) used.add(g.homeY * map.width + g.homeX); // the home tile stays open
    const r = CONFIG.people.range.forage;
    const candidates: Array<[number, number, number]> = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) candidates.push([dx * dx + dy * dy, dy, dx]);
    candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const free = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
      const i = y * map.width + x;
      return !used.has(i) && map.ground[i] !== Ground.Water && map.wall[i] === WallType.None
        && map.plantType[i] !== Plant.Farmland;
    };
    for (const g of groups) {
      const houses = Math.min(g.houses, R.maxHutsDrawnBand);
      const huts = Math.min(g.huts, R.maxHutsDrawnBand - houses);
      const want: Array<Building['img']> = [...Array<'house'>(houses).fill('house'), ...Array<'hut'>(huts).fill('hut')];
      let next = 0;
      for (const [, dy, dx] of candidates) {
        if (next >= want.length) break;
        const kind = want[next]!;
        const size = kind === 'house' ? 2 : 1;
        const x = g.homeX + dx;
        const y = g.homeY + dy;
        let ok = true;
        for (let yy = 0; yy < size && ok; yy++) for (let xx = 0; xx < size && ok; xx++) ok = free(x + xx, y + yy);
        if (!ok) continue;
        for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) used.add((y + yy) * map.width + x + xx);
        this.list.push({ x, y, w: size, h: size, img: kind });
        next++;
      }
    }
  }

  collect(push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    for (const b of this.list) {
      const img = (this.imgs[b.img] ??= getSprite(b.img));
      push(img, (b.x + b.w / 2) * TILE, (b.y + b.h) * TILE);
    }
  }

  /** True if a building stands on tile (x, y). */
  buildingAt(x: number, y: number): boolean {
    return this.list.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  }

  clear(): void {
    this.key = '';
    this.list = [];
  }
}

export interface CampGroup { id: number; homeX: number; homeY: number; discoveries: number }

interface CampItem { kind: 'fire' | 'raft' | 'boat' | 'cart'; x: number; y: number }

/**
 * Things at each camp (§18.5): an animated campfire on the home tile with Fire, a raft or boat
 * (Boat replaces Raft) on the water tile nearest home within 3 tiles, and a cart beside home.
 */
export class CampLayer {
  private key = '';
  private items: CampItem[] = [];
  private readonly imgs = new Map<string, HTMLCanvasElement>();

  update(map: MapData, groups: readonly CampGroup[]): void {
    const key = groups.map((g) => `${g.id}:${g.homeX},${g.homeY},${g.discoveries}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.items = [];
    for (const g of groups) {
      const cx = (g.homeX + 0.5) * TILE;
      const cy = (g.homeY + 0.5) * TILE;
      if (has(g.discoveries, Discovery.fire)) this.items.push({ kind: 'fire', x: cx, y: cy + 2 });
      if (has(g.discoveries, Discovery.cart)) this.items.push({ kind: 'cart', x: cx + TILE, y: cy + TILE / 2 - 1 });
      const vessel = has(g.discoveries, Discovery.boat) ? 'boat' : has(g.discoveries, Discovery.raft) ? 'raft' : null;
      if (vessel) {
        const w = nearestWater(map, g.homeX, g.homeY);
        if (w) this.items.push({ kind: vessel, x: (w.x + 0.5) * TILE, y: (w.y + 0.5) * TILE + 2 });
      }
    }
  }

  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    const frame = Math.floor(nowMs / R.campfireFrameMs) % 2 === 0 ? 1 : 2;
    for (const it of this.items) {
      const name = it.kind === 'fire' ? `campfire_${frame}` : it.kind;
      let img = this.imgs.get(name);
      if (!img) { img = getSprite(name); this.imgs.set(name, img); }
      push(img, it.x, it.y);
    }
  }

  clear(): void {
    this.key = '';
    this.items = [];
  }
}

/** Water ground, or an intact River / Sea wall, nearest (x, y) within 3 tiles; ties by (dy, dx). */
function nearestWater(map: MapData, hx: number, hy: number): { x: number; y: number } | null {
  const r = R.vesselSearchTiles;
  let best: { x: number; y: number; d: number } | null = null;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = dx * dx + dy * dy;
      if (d > r * r || (best && d >= best.d)) continue;
      const x = hx + dx;
      const y = hy + dy;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const i = y * map.width + x;
      const wall = map.wall[i];
      if (map.ground[i] === Ground.Water || wall === WallType.River || wall === WallType.Sea) best = { x, y, d };
    }
  }
  return best;
}
