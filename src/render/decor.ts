// Decorative wild animals, buildings and camp objects (§18.5). Visual only: Math.random is
// fine here because nothing in this file feeds back into the simulation.
// F8 (§14.3–14.4): buildings by era, special buildings, palisades and stone walls, night
// windows, chimney smoke sources, trampled ground around camps, and animal behaviour (herds
// keep together, horses gallop, wolves stalk deer and deer flee).

import { CONFIG } from '../config';
import { Ground, Mode, Plant, Species, WallType } from '../shared/ids';
import { Discovery, has } from '../shared/discoveries';
import type { MapData } from '../shared/types';
import { getSprite, type Carry } from './sprites';
import { hash01 } from '../shared/hash';
import { RGBS } from './palette';

const R = CONFIG.render;
const F8 = R.f8;
const TILE = CONFIG.map.tilePx;

const SPRITE_BASE: Record<number, string> = {
  [Species.Prey]: 'deer',
  [Species.Predator]: 'wolf',
  [Species.Herd]: 'goat',
  [Species.Riding]: 'horse',
};

const AN = F8.animals;

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
  // F8: the herd leader each animal follows (itself for leaders), its place in the herd, and its speed now.
  private leader = new Int16Array(R.maxAnimalSprites);
  private offX = new Float32Array(R.maxAnimalSprites);
  private offY = new Float32Array(R.maxAnimalSprites);
  private speed = new Float32Array(R.maxAnimalSprites);
  private nextHuntMs = 0;
  private map: MapData | null = null;
  // densities in 0..1 per species, read when picking wander targets
  private density: Float32Array[] = [];
  /** F8 behaviour on (herds, gallops, stalking); off in setup so placed animals stay calm. */
  lively = false;

  /**
   * Rebuilds the animal list from densities (0..1 per tile, per species).
   * Per 4×4-tile block and species: floor(sum / 4 + random), max 2 per block, max 400 total.
   * The first animal of a block and species leads; the others keep near it (a herd).
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
          const first = this.count;
          for (let k = 0; k < n && this.count < R.maxAnimalSprites; k++) {
            const a = this.count++;
            this.species[a] = s;
            this.blockX[a] = bx;
            this.blockY[a] = by;
            this.leader[a] = s === Species.Predator ? a : first;
            this.offX[a] = a === first ? 0 : (Math.random() * 2 - 1) * AN.herdSpreadPx;
            this.offY[a] = a === first ? 0 : (Math.random() * 2 - 1) * AN.herdSpreadPx * 0.6;
            this.speed[a] = R.animalSpeedPx;
            this.pickSpot(a);
            if (a !== first) { this.tx[a] = this.tx[first]! + this.offX[a]!; this.ty[a] = this.ty[first]! + this.offY[a]!; }
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

  /** F8: wolves pick the nearest deer to stalk; deer near a wolf run from it. Every 250 ms. */
  private hunt(nowMs: number): void {
    if (nowMs < this.nextHuntMs) return;
    this.nextHuntMs = nowMs + 250;
    for (let a = 0; a < this.count; a++) {
      if (this.species[a] !== Species.Predator) continue;
      let best = -1, bestD = AN.wolfSeekPx * AN.wolfSeekPx;
      for (let b = 0; b < this.count; b++) {
        if (this.species[b] !== Species.Prey) continue;
        const dx = this.x[b]! - this.x[a]!, dy = this.y[b]! - this.y[a]!;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best < 0) { this.speed[a] = R.animalSpeedPx; continue; }
      // Creep up slowly, then dash the last few pixels.
      const close = bestD < AN.fleePx * AN.fleePx;
      this.speed[a] = R.animalSpeedPx * (close ? AN.wolfDashMult : AN.wolfStalkMult);
      this.tx[a] = this.x[best]!;
      this.ty[a] = this.y[best]!;
      this.nextTurnMs[a] = nowMs + 400;
      if (close) {
        // The deer bolts away from the wolf, and its herd follows.
        const l = this.leader[best]!;
        const dx = this.x[best]! - this.x[a]!, dy = this.y[best]! - this.y[a]!;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        this.tx[l] = this.x[l]! + (dx / len) * AN.wolfSeekPx;
        this.ty[l] = this.y[l]! + (dy / len) * AN.wolfSeekPx;
        this.speed[l] = R.animalSpeedPx * AN.gallopMult;
        this.nextTurnMs[l] = nowMs + 1500;
      }
    }
  }

  update(nowMs: number, dtMs: number): void {
    if (this.lively) this.hunt(nowMs);
    for (let a = 0; a < this.count; a++) {
      const l = this.lively ? this.leader[a]! : a;
      if (l === a) {
        if (nowMs >= this.nextTurnMs[a]!) {
          this.pickSpot(a);
          this.nextTurnMs[a] = nowMs + R.animalWanderMs * (0.5 + Math.random());
          // Horses break into a gallop now and then; everyone else ambles.
          const gallop = this.lively && this.species[a] === Species.Riding && Math.random() < 0.35;
          if (this.species[a] !== Species.Predator) this.speed[a] = R.animalSpeedPx * (gallop ? AN.gallopMult : 1);
        }
      } else {
        // Followers keep their place in the herd, a little faster so they catch up.
        this.tx[a] = this.x[l]! + this.offX[a]!;
        this.ty[a] = this.y[l]! + this.offY[a]!;
        this.speed[a] = this.speed[l]! * 1.25;
      }
      const step = (this.speed[a]! * dtMs) / 1000;
      const dx = this.tx[a]! - this.x[a]!;
      const dy = this.ty[a]! - this.y[a]!;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len <= Math.max(step, 0.3)) {
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
    const walk = Math.floor(nowMs / R.walkFrameMs) % 2 === 0 ? 1 : 2;
    const gallop = Math.floor(nowMs / AN.gallopFrameMs) % 2 === 0 ? 1 : 2;
    for (let a = 0; a < this.count; a++) {
      const fast = this.speed[a]! > R.animalSpeedPx * 1.5;
      const f = this.moving[a] ? (fast ? gallop : walk) : 1;
      const img = animalSprite(this.species[a]!, f, this.facingLeft[a] === 1);
      push(img, this.x[a]!, this.y[a]!);
    }
  }

  /** Animals within `r` px of (x, y) (for sound and hunting scenes). */
  near(x: number, y: number, r: number): number {
    let n = 0;
    for (let a = 0; a < this.count; a++) {
      const dx = this.x[a]! - x, dy = this.y[a]! - y;
      if (dx * dx + dy * dy <= r * r) n++;
    }
    return n;
  }
}

// Lookup table so the draw loop doesn't build cache-key strings per animal.
const spriteTable: HTMLCanvasElement[] = [];
export function animalSprite(species: number, frame: 1 | 2, flip: boolean): HTMLCanvasElement {
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

export interface BuildingGroup {
  id: number; homeX: number; homeY: number; mode: number; discoveries: ArrayLike<number>;
  huts: number; houses: number; farms: number; era: number; fortification: number; chief: boolean;
}

export type BuildingKind =
  | 'leanTo' | 'hut' | 'longhouse' | 'house' | 'stoneHouse' | 'city'
  | 'temple' | 'granary' | 'well' | 'kiln' | 'smithy' | 'scriptorium';
interface Building { x: number; y: number; w: number; h: number; img: BuildingKind }
interface WallPiece { x: number; y: number; stone: boolean }

const FOOTPRINT: Record<BuildingKind, [number, number]> = {
  leanTo: [1, 1], hut: [1, 1], longhouse: [2, 2], house: [2, 2], stoneHouse: [2, 2], city: [2, 3],
  temple: [2, 2], granary: [1, 1], well: [1, 1], kiln: [1, 1], smithy: [1, 1], scriptorium: [1, 1],
};
/** Buildings with a hearth inside: they smoke by day and their windows glow at night. */
const HEARTH = new Set<BuildingKind>(['longhouse', 'house', 'stoneHouse', 'city', 'kiln', 'smithy']);
const LIT = new Set<BuildingKind>(['hut', 'longhouse', 'house', 'stoneHouse', 'city', 'temple', 'scriptorium', 'smithy', 'kiln']);

/** Special buildings (§14.4) and the discoveries (or chief) that bring them. */
function specials(g: BuildingGroup): BuildingKind[] {
  const out: BuildingKind[] = [];
  if (g.chief) out.push('temple');
  if (has(g.discoveries, Discovery.granary)) out.push('granary');
  if (has(g.discoveries, Discovery.wells)) out.push('well');
  if (has(g.discoveries, Discovery.pottery)) out.push('kiln');
  if (has(g.discoveries, Discovery.copperWorking) || has(g.discoveries, Discovery.bronzeWorking) || has(g.discoveries, Discovery.ironWorking)) out.push('smithy');
  if (has(g.discoveries, Discovery.writing)) out.push('scriptorium');
  return out;
}

/**
 * Buildings around each home (§18.5). Candidate tiles sorted by (distance², dy, dx); each
 * building takes the next candidate whose footprint (top-left at the candidate) is dry,
 * wall-free and free. Fields are avoided, and only used when a village runs out of other room
 * (DECISIONS 5.12). Bands draw at most 12 buildings, villages 30. F8: what is drawn follows the
 * era — lean-tos (bands below era 2), huts, longhouses (a village without Mud Brick, one per 4
 * huts), mud-brick houses, stone houses (Stone Building), city blocks (City, up to 30% of the
 * houses) — plus one of each special building, and a ring of palisade or stone wall pieces
 * around a fortified group. Biggest first, nearest the camp. Recomputed only when something drawn changes.
 */
export class BuildingLayer {
  private key = '';
  private list: Building[] = [];
  private walls: WallPiece[] = [];
  private readonly imgs = new Map<string, HTMLCanvasElement>();
  /** Chimney smoke sources and night window lights (map px), rebuilt with the buildings. */
  chimneys: number[] = [];
  windows: number[] = [];

  update(map: MapData, groups: readonly BuildingGroup[]): void {
    const key = groups.map((g) => `${g.id}:${g.homeX},${g.homeY},${g.mode},${g.huts},${g.houses},${g.farms},${g.era},${g.fortification},${g.chief ? 1 : 0},${specials(g).join('')},${has(g.discoveries, Discovery.city) ? 1 : 0},${has(g.discoveries, Discovery.stoneBuilding) ? 1 : 0}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.list = [];
    this.walls = [];
    const used = new Set<number>();
    for (const g of groups) used.add(g.homeY * map.width + g.homeX); // the home tile stays open
    const r = CONFIG.people.range.forage;
    const candidates: Array<[number, number, number]> = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) candidates.push([dx * dx + dy * dy, dy, dx]);
    candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const free = (x: number, y: number, onFields: boolean): boolean => {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
      const i = y * map.width + x;
      return !used.has(i) && map.ground[i] !== Ground.Water && map.wall[i] === WallType.None
        && (onFields || map.plantType[i] !== Plant.Farmland);
    };
    const B = F8.buildings;
    for (const g of groups) {
      const village = g.mode === Mode.Village;
      const max = village ? R.maxBuildingsDrawn : R.maxHutsDrawnBand;
      const houses = Math.min(g.houses, max);
      let huts = Math.min(g.huts, max - houses);
      const city = village && has(g.discoveries, Discovery.city) ? Math.min(R.maxCityDrawn, Math.floor(houses * R.cityShare)) : 0;
      const houseKind: BuildingKind = has(g.discoveries, Discovery.stoneBuilding) ? 'stoneHouse' : 'house';
      // A village still in huts lives in longhouses, several families each (Neolithic Europe).
      const longhouses = village && g.houses === 0 ? Math.floor(huts / B.longhouseHuts) : 0;
      huts -= longhouses * B.longhouseHuts;
      const hutKind: BuildingKind = !village && g.era < B.leanToBelowEra ? 'leanTo' : 'hut';
      const extra = village ? specials(g) : [];
      const temple = extra.includes('temple') ? ['temple' as const] : [];
      const want: BuildingKind[] = [
        ...temple,
        ...Array<BuildingKind>(city).fill('city'),
        ...Array<BuildingKind>(houses - city).fill(houseKind),
        ...Array<BuildingKind>(longhouses).fill('longhouse'),
        ...extra.filter((k) => k !== 'temple'),
        ...Array<BuildingKind>(huts).fill(hutKind),
      ];
      let next = 0;
      let farthest = 0;
      for (const onFields of village ? [false, true] : [false]) {
        for (const [d2, dy, dx] of candidates) {
          if (next >= want.length) break;
          const kind = want[next]!;
          const [fw, fh] = FOOTPRINT[kind];
          const x = g.homeX + dx;
          const y = g.homeY + dy;
          let ok = true;
          for (let yy = 0; yy < fh && ok; yy++) for (let xx = 0; xx < fw && ok; xx++) ok = free(x + xx, y + yy, onFields);
          if (!ok) continue;
          for (let yy = 0; yy < fh; yy++) for (let xx = 0; xx < fw; xx++) used.add((y + yy) * map.width + x + xx);
          this.list.push({ x, y, w: fw, h: fh, img: kind });
          farthest = Math.max(farthest, Math.sqrt(d2) + Math.max(fw, fh) - 1);
          next++;
        }
      }
      if (g.fortification > 0) this.ring(map, g, Math.max(B.wallMinTiles, farthest + B.wallMarginTiles), g.fortification >= 2);
    }
    this.chimneys = [];
    this.windows = [];
    for (const b of this.list) {
      const left = b.x * TILE, top = (b.y + b.h) * TILE - SPRITE_H[b.img];
      if (HEARTH.has(b.img)) this.chimneys.push(left + b.w * TILE * 0.7, top + 3);
      if (LIT.has(b.img)) this.windows.push(left + (b.w * TILE) / 2, (b.y + b.h) * TILE - 4);
    }
  }

  /** Wall pieces on a circle of `rTiles` around home, skipping water and walls, with a gate facing south. */
  private ring(map: MapData, g: BuildingGroup, rTiles: number, stone: boolean): void {
    const B = F8.buildings;
    const cx = (g.homeX + 0.5) * TILE, cy = (g.homeY + 0.5) * TILE;
    const r = rTiles * TILE;
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / B.wallPostStepPx));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      // Render-only, so trig is fine. Angle π/2 points down the screen: the gate.
      if (Math.abs(a - Math.PI / 2) < B.gateHalfAngle) continue;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.85;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      const i = ty * map.width + tx;
      if (map.ground[i] === Ground.Water || map.wall[i] !== WallType.None) continue;
      this.walls.push({ x, y: y + 2, stone });
    }
  }

  collect(push: (img: HTMLCanvasElement, x: number, y: number) => void, night = false): void {
    for (const b of this.list) {
      const name = `${b.img}|${night ? 1 : 0}`;
      let img = this.imgs.get(name);
      if (!img) { img = getSprite(b.img, {}, false, night); this.imgs.set(name, img); }
      push(img, (b.x + b.w / 2) * TILE, (b.y + b.h) * TILE);
    }
    for (const w of this.walls) {
      const name = w.stone ? 'stoneWallPiece' : 'palisadePost';
      let img = this.imgs.get(name);
      if (!img) { img = getSprite(name); this.imgs.set(name, img); }
      push(img, w.x, w.y);
    }
  }

  /** True if a building stands on tile (x, y). */
  buildingAt(x: number, y: number): boolean {
    return this.list.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  }

  get count(): number { return this.list.length; }

  clear(): void {
    this.key = '';
    this.list = [];
    this.walls = [];
    this.chimneys = [];
    this.windows = [];
  }
}

const SPRITE_H: Record<BuildingKind, number> = {
  leanTo: 8, hut: 8, longhouse: 16, house: 16, stoneHouse: 16, city: 24,
  temple: 16, granary: 8, well: 8, kiln: 8, smithy: 8, scriptorium: 8,
};

export interface LifeGroup {
  id: number; homeX: number; homeY: number; mode: number; population: number; herd: number; colourIndex: number;
  discoveries: ArrayLike<number>;
}

/** Look of a decorative walker; the caller turns it into sprites (people.ts owns person sprites). */
export type WalkerSprite = (look: { female: boolean; colorIndex: number; skin: number; hair: number; clothed: boolean }, frame: 1 | 2, carry: Carry | null) => HTMLCanvasElement;

interface Wanderer {
  x: number; y: number; tx: number; ty: number;
  cx: number; cy: number; radiusPx: number;
  img: [HTMLCanvasElement, HTMLCanvasElement];
  imgLeft: [HTMLCanvasElement, HTMLCanvasElement] | null; // animals face the way they walk
  facingLeft: boolean; moving: boolean; nextMs: number;
}

const WALKER_ITEMS: Carry[] = ['basket', 'pot', 'wood'];

/**
 * Life around a camp (§18.5): a village's decorative walkers (min(ceil(pop / 10), 40), random
 * looks in the village colour, within 3 tiles of home; F8: some carry a basket, pot or wood)
 * and every group's herd goats (min(ceil(herd / 10), 12), within 2 tiles of home). Visual only.
 */
export class CampLife {
  private readonly groups = new Map<number, { key: string; list: Wanderer[] }>();
  private all: Wanderer[] = [];
  private map: MapData | null = null;

  update(map: MapData, groups: readonly LifeGroup[], walker: WalkerSprite): void {
    this.map = map;
    let changed = false;
    const seen = new Set<number>();
    for (const g of groups) {
      seen.add(g.id);
      const walkers = g.mode === Mode.Village ? Math.min(Math.ceil(g.population / R.villageWalkersPer), R.villageWalkersMax) : 0;
      const goats = Math.min(Math.ceil(g.herd / R.herdPerSprite), R.maxHerdDrawn);
      const clothed = has(g.discoveries, Discovery.clothing);
      const key = `${g.homeX},${g.homeY},${walkers},${goats},${g.colourIndex},${clothed}`;
      if (this.groups.get(g.id)?.key === key) continue;
      changed = true;
      const cx = (g.homeX + 0.5) * TILE;
      const cy = (g.homeY + 0.5) * TILE;
      const list: Wanderer[] = [];
      for (let k = 0; k < walkers; k++) {
        const look = { female: Math.random() < 0.5, colorIndex: g.colourIndex, skin: Math.floor(Math.random() * 3), hair: Math.floor(Math.random() * 3), clothed };
        const carry = Math.random() < F8.people.walkerCarryShare ? WALKER_ITEMS[Math.floor(Math.random() * WALKER_ITEMS.length)]! : null;
        list.push(this.make(cx, cy, R.villageWalkRadius * TILE, [walker(look, 1, carry), walker(look, 2, carry)], null));
      }
      for (let k = 0; k < goats; k++) {
        list.push(this.make(cx, cy, R.herdRadiusTiles * TILE,
          [getSprite('goat_1'), getSprite('goat_2')], [getSprite('goat_1', {}, true), getSprite('goat_2', {}, true)]));
      }
      this.groups.set(g.id, { key, list });
    }
    for (const id of [...this.groups.keys()]) if (!seen.has(id)) { this.groups.delete(id); changed = true; }
    if (changed) this.all = [...this.groups.values()].flatMap((e) => e.list);
  }

  private make(cx: number, cy: number, radiusPx: number, img: Wanderer['img'], imgLeft: Wanderer['imgLeft']): Wanderer {
    const w: Wanderer = { x: cx, y: cy, tx: cx, ty: cy, cx, cy, radiusPx, img, imgLeft, facingLeft: false, moving: false, nextMs: 0 };
    this.pick(w);
    w.x = w.tx;
    w.y = w.ty;
    return w;
  }

  /** A random dry spot within the wanderer's radius of home. */
  private pick(w: Wanderer): void {
    const map = this.map!;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * w.radiusPx;
      const x = w.cx + Math.cos(a) * d;
      const y = w.cy + Math.sin(a) * d;
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      const i = ty * map.width + tx;
      if (map.ground[i] === Ground.Water || map.wall[i] !== WallType.None) continue;
      w.tx = x;
      w.ty = y + TILE / 2;
      return;
    }
  }

  animate(nowMs: number, dtMs: number): void {
    const step = (R.animalSpeedPx * dtMs) / 1000;
    for (const w of this.all) {
      if (nowMs >= w.nextMs) {
        this.pick(w);
        w.nextMs = nowMs + R.animalWanderMs * (0.5 + Math.random());
      }
      const dx = w.tx - w.x;
      const dy = w.ty - w.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len <= step) { w.x = w.tx; w.y = w.ty; w.moving = false; continue; }
      w.x += (dx / len) * step;
      w.y += (dy / len) * step;
      w.moving = true;
      if (Math.abs(dx) > 0.5) w.facingLeft = dx < 0;
    }
  }

  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    const f = Math.floor(nowMs / R.walkFrameMs) % 2;
    for (const w of this.all) {
      const frames = w.facingLeft && w.imgLeft ? w.imgLeft : w.img;
      push(frames[w.moving ? f : 0]!, w.x, w.y);
    }
  }

  clear(): void {
    this.groups.clear();
    this.all = [];
  }
}

export interface CampGroup { id: number; homeX: number; homeY: number; discoveries: ArrayLike<number> }

/**
 * The campfire at each camp (§18.5): animated, on the home tile, with Fire. (Rafts, boats and
 * carts move about since F8: traffic.ts.)
 */
export class CampLayer {
  private key = '';
  /** Campfire positions (map px, x/y pairs) and the group each belongs to. */
  fires: number[] = [];
  fireGroup = new Map<number, [number, number]>();
  private readonly imgs: HTMLCanvasElement[] = [];

  update(groups: readonly CampGroup[]): void {
    const key = groups.map((g) => `${g.id}:${g.homeX},${g.homeY},${has(g.discoveries, Discovery.fire) ? 1 : 0}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.fires = [];
    this.fireGroup = new Map();
    for (const g of groups) {
      if (!has(g.discoveries, Discovery.fire)) continue;
      const x = (g.homeX + 0.5) * TILE, y = (g.homeY + 0.5) * TILE + 2;
      this.fires.push(x, y);
      this.fireGroup.set(g.id, [x, y]);
    }
  }

  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    const frame = Math.floor(nowMs / R.campfireFrameMs) % 2;
    const img = (this.imgs[frame] ??= getSprite(`campfire_${frame + 1}`));
    for (let k = 0; k < this.fires.length; k += 2) push(img, this.fires[k]!, this.fires[k + 1]!);
  }

  clear(): void {
    this.key = '';
    this.fires = [];
    this.fireGroup = new Map();
  }
}

/**
 * Trampled clearings (F8 §14.1): bare, worn earth around every camp, bigger for bigger
 * villages, with a ragged edge. Drawn once per change of homes into its own canvas.
 */
export class TrampleLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly img: ImageData;
  private key = '';
  /** Nothing drawn (no groups): the renderer skips the canvas. */
  empty = true;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * TILE;
    this.canvas.height = height * TILE;
    this.img = this.canvas.getContext('2d')!.createImageData(this.canvas.width, this.canvas.height);
  }

  update(map: MapData, groups: ReadonlyArray<{ homeX: number; homeY: number; mode: number; population: number }>): void {
    const T = F8.trample;
    const radius = (g: { mode: number; population: number }): number =>
      Math.round(Math.min(T.maxRadiusPx, T.radiusPx + (g.mode === Mode.Village ? T.villagePerSqrtPop * Math.sqrt(g.population) : 0)));
    const key = groups.map((g) => `${g.homeX},${g.homeY},${radius(g)}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.empty = groups.length === 0;
    const d = this.img.data;
    d.fill(0);
    const W = this.canvas.width;
    for (const g of groups) {
      const r = radius(g);
      const cx = (g.homeX + 0.5) * TILE, cy = (g.homeY + 0.5) * TILE;
      for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(this.canvas.height, cy + r); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(W, cx + r); x++) {
          const dist = Math.sqrt((x - cx) ** 2 + ((y - cy) * 1.2) ** 2) / r;
          if (dist >= 1 || hash01(x, y, 401) < T.ragged * dist * 2) continue;
          const i = Math.floor(y / TILE) * map.width + Math.floor(x / TILE);
          if (map.ground[i] === Ground.Water || map.wall[i] !== WallType.None) continue;
          const c = hash01(x, y, 402) < 0.5 ? RGBS.sand : RGBS.wood;
          const o = (y * W + x) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
          d[o + 3] = Math.round(255 * T.alpha * (1 - dist * dist));
        }
      }
    }
    this.canvas.getContext('2d')!.putImageData(this.img, 0, 0);
  }

  clear(): void {
    this.key = '';
    this.empty = true;
    this.img.data.fill(0);
    this.canvas.getContext('2d')!.putImageData(this.img, 0, 0);
  }
}
