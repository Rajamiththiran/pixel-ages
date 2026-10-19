// Boats and carts (F8 §14.4), visual only. A group with a Raft, Boat or Sails has one to three
// vessels drifting tile to tile over the water near home; a group with the Cart sends carts
// along its paths and roads (or parks one beside home when it has none yet).

import { CONFIG } from '../config';
import { Ground, WallType } from '../shared/ids';
import { Discovery, has } from '../shared/discoveries';
import { Mark } from '../shared/protocol';
import type { MapData } from '../shared/types';
import { getSprite } from './sprites';

const TR = CONFIG.render.f8.traffic;
const TILE = CONFIG.map.tilePx;
const N8: ReadonlyArray<readonly [number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const N4: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1]];

export interface TrafficGroup { id: number; homeX: number; homeY: number; population: number; discoveries: ArrayLike<number> }

interface Mover {
  kind: 'raft' | 'boat' | 'sailboat' | 'cart';
  homeX: number; homeY: number; range: number;
  tile: number; next: number;              // tile now and the tile it heads for
  x: number; y: number;                    // map px
  dx: number; dy: number;                  // last step, to keep going straight
  left: boolean; parked: boolean;
}

const isWater = (m: MapData, i: number): boolean => {
  const w = m.wall[i];
  return w === WallType.River || w === WallType.Sea || (w === WallType.None && m.ground[i] === Ground.Water);
};

export class Traffic {
  private key = '';
  private movers: Mover[] = [];
  private map: MapData | null = null;
  marks: Uint8Array | null = null;

  update(map: MapData, groups: readonly TrafficGroup[]): void {
    this.map = map;
    const kindOf = (g: TrafficGroup): Mover['kind'] | null =>
      has(g.discoveries, Discovery.sails) ? 'sailboat' : has(g.discoveries, Discovery.boat) ? 'boat' : has(g.discoveries, Discovery.raft) ? 'raft' : null;
    const key = groups.map((g) => `${g.id}:${g.homeX},${g.homeY},${kindOf(g)},${has(g.discoveries, Discovery.cart) ? 1 : 0},${Math.floor(g.population / 20)}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.movers = [];
    for (const g of groups) {
      const vessel = kindOf(g);
      if (vessel) {
        const n = vessel === 'raft' ? 1 : Math.min(TR.maxBoats, 1 + Math.floor(g.population / TR.boatsPer));
        const start = this.nearest(g.homeX, g.homeY, TR.boatRangeTiles, (i) => isWater(map, i));
        for (let k = 0; k < n && start >= 0; k++) this.movers.push(this.make(vessel, g, TR.boatRangeTiles, start));
      }
      if (has(g.discoveries, Discovery.cart)) {
        const n = Math.min(TR.maxCarts, 1 + Math.floor(g.population / TR.cartsPer));
        for (let k = 0; k < n; k++) {
          const start = this.nearest(g.homeX, g.homeY, TR.cartRangeTiles, (i) => this.onRoad(i));
          const m = this.make('cart', g, TR.cartRangeTiles, start >= 0 ? start : g.homeY * map.width + g.homeX);
          if (start < 0) { m.parked = true; m.x += TILE; m.y -= 1; }
          this.movers.push(m);
        }
      }
    }
  }

  private onRoad(i: number): boolean {
    return this.marks !== null && (this.marks[i]! & (Mark.Road | Mark.Path)) !== 0;
  }

  private make(kind: Mover['kind'], g: TrafficGroup, range: number, tile: number): Mover {
    const w = this.map!.width;
    return {
      kind, homeX: g.homeX, homeY: g.homeY, range, tile, next: tile,
      x: (tile % w + 0.5) * TILE, y: (Math.floor(tile / w) + 0.5) * TILE + 2, dx: 1, dy: 0, left: false, parked: false,
    };
  }

  /** The tile nearest (x, y) within `r` passing `ok`, or -1. */
  private nearest(x: number, y: number, r: number, ok: (i: number) => boolean): number {
    const m = this.map!;
    let best = -1, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD && ok(ny * m.width + nx)) { bestD = d; best = ny * m.width + nx; }
      }
    }
    return best;
  }

  /** Next tile: a neighbour that can be used, within range of home, preferring straight on. */
  private pickNext(mv: Mover): void {
    const m = this.map!;
    const w = m.width;
    const x = mv.tile % w, y = Math.floor(mv.tile / w);
    const cart = mv.kind === 'cart';
    const options: Array<[number, number, number]> = [];
    for (const [dx, dy] of cart ? N4 : N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
      if (Math.max(Math.abs(nx - mv.homeX), Math.abs(ny - mv.homeY)) > mv.range) continue;
      const j = ny * w + nx;
      if (cart ? !this.onRoad(j) : !isWater(m, j)) continue;
      options.push([j, dx, dy]);
    }
    if (options.length === 0) { mv.next = mv.tile; return; }
    const straight = options.find(([, dx, dy]) => dx === mv.dx && dy === mv.dy);
    const pick = straight && Math.random() < 0.7 ? straight : options[Math.floor(Math.random() * options.length)]!;
    mv.next = pick[0];
    mv.dx = pick[1];
    mv.dy = pick[2];
  }

  animate(dtMs: number, playing: boolean): void {
    if (!this.map) return;
    const w = this.map.width;
    for (const mv of this.movers) {
      if (mv.parked) {
        // Now and then a parked cart looks again for a path to drive on (paths appear over time).
        if (Math.random() < dtMs / 2000) {
          const start = this.nearest(mv.homeX, mv.homeY, TR.cartRangeTiles, (i) => this.onRoad(i));
          if (start >= 0) Object.assign(mv, this.make('cart', { id: 0, homeX: mv.homeX, homeY: mv.homeY, population: 0, discoveries: [] }, mv.range, start));
        }
        continue;
      }
      const speed = mv.kind === 'cart' ? TR.cartSpeedPx : TR.boatSpeedPx;
      const step = (speed * dtMs / 1000) * (playing ? 1 : 0.3);
      const tx = (mv.next % w + 0.5) * TILE, ty = (Math.floor(mv.next / w) + 0.5) * TILE + 2;
      const dx = tx - mv.x, dy = ty - mv.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len <= step) {
        mv.x = tx; mv.y = ty;
        mv.tile = mv.next;
        this.pickNext(mv);
      } else {
        mv.x += (dx / len) * step;
        mv.y += (dy / len) * step;
        if (Math.abs(dx) > 0.5) mv.left = dx < 0;
      }
    }
  }

  collect(push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    for (const mv of this.movers) push(getSprite(mv.kind, {}, mv.left), mv.x, mv.y);
  }

  clear(): void {
    this.key = '';
    this.movers = [];
  }
}
