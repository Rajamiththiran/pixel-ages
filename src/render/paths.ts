// Walking routes for people on screen (perfection pass, item 2b). Visual only: the simulation
// moves people by work tile; this only decides how a sprite gets there. People walk where the
// simulation lets them (§11.7 passableFor): never across an intact wall, and over water only
// with a Raft. A clear straight line is walked as is; otherwise A* finds a route round the
// obstacle, smoothed to a few turns.

import { CONFIG } from '../config';
import { Ground, WallType } from '../shared/ids';

const PA = CONFIG.render.paths;

/** The parts of the map a route needs. `crossing` marks breached wall tiles (null in setup). */
export interface WalkMap {
  width: number;
  height: number;
  ground: Uint8Array;
  wall: Uint8Array;
  crossing: Uint8Array | null;
}

/** Tile i can be walked on: not an intact wall, and not water unless the walker's group has a Raft. */
export function walkable(m: WalkMap, i: number, raft: boolean): boolean {
  if (m.wall[i] !== WallType.None && !(m.crossing && m.crossing[i] === 1)) return false;
  return raft || m.ground[i] !== Ground.Water;
}

/**
 * True if the straight line between the centres of tiles a and b only passes walkable tiles.
 * Sampled every quarter tile; a diagonal step between two tiles also needs one of the two tiles
 * beside it to be walkable (no squeezing between the corners of two walls).
 */
export function lineClear(m: WalkMap, a: number, b: number, raft: boolean): boolean {
  const w = m.width;
  const ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 4));
  let px = ax, py = ay;
  for (let k = 1; k <= steps; k++) {
    const x = Math.round(ax + ((bx - ax) * k) / steps);
    const y = Math.round(ay + ((by - ay) * k) / steps);
    if (x === px && y === py) continue;
    if (!walkable(m, y * w + x, raft)) return false;
    if (x !== px && y !== py && !walkable(m, py * w + x, raft) && !walkable(m, y * w + px, raft)) return false;
    px = x; py = y;
  }
  return true;
}

const N8: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Binary min-heap of tile indices keyed by f (scratch, reused). */
class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size(): number { return this.items.length; }
  clear(): void { this.items.length = 0; this.keys.length = 0; }
  push(item: number, key: number): void {
    const it = this.items, ks = this.keys;
    let i = it.length;
    it.push(item); ks.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p]! <= key) break;
      it[i] = it[p]!; ks[i] = ks[p]!;
      i = p;
    }
    it[i] = item; ks[i] = key;
  }
  pop(): number {
    const it = this.items, ks = this.keys;
    const top = it[0]!;
    const lastItem = it.pop()!, lastKey = ks.pop()!;
    if (it.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let c = i, ck = lastKey;
        if (l < it.length && ks[l]! < ck) { c = l; ck = ks[l]!; }
        if (r < it.length && ks[r]! < ck) { c = r; ck = ks[r]!; }
        if (c === i) break;
        it[i] = it[c]!; ks[i] = ks[c]!;
        i = c;
      }
      it[i] = lastItem; ks[i] = lastKey;
    }
    return top;
  }
}

const heap = new Heap();
let gScore = new Float32Array(0);
let came = new Int32Array(0);
let stamp = new Uint32Array(0);
let run = 0;

/**
 * Waypoint tiles from `from` to `to` (both excluded from the list when the line is clear: then
 * the list is empty), or null if there is no walkable route within `PA.maxNodes` searched tiles.
 * A route is smoothed: each waypoint is the farthest later tile still in a clear straight line.
 */
export function findRoute(m: WalkMap, from: number, to: number, raft: boolean): number[] | null {
  if (from === to || lineClear(m, from, to, raft)) return [];
  if (!walkable(m, to, raft)) return null;
  const n = m.width * m.height;
  if (gScore.length !== n) { gScore = new Float32Array(n); came = new Int32Array(n); stamp = new Uint32Array(n); run = 0; }
  run++;
  const w = m.width;
  const tx = to % w, ty = (to - tx) / w;
  const h = (i: number): number => {
    const dx = Math.abs((i % w) - tx), dy = Math.abs(Math.floor(i / w) - ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  heap.clear();
  stamp[from] = run; gScore[from] = 0; came[from] = -1;
  heap.push(from, h(from));
  let expanded = 0;
  let found = false;
  while (heap.size > 0 && expanded < PA.maxNodes) {
    const i = heap.pop();
    if (i === to) { found = true; break; }
    expanded++;
    const x = i % w, y = (i - x) / w;
    for (const [dx, dy, cost] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= m.height) continue;
      const j = ny * w + nx;
      if (!walkable(m, j, raft)) continue;
      // No cutting a corner between two blocked tiles.
      if (dx !== 0 && dy !== 0 && !walkable(m, y * w + nx, raft) && !walkable(m, ny * w + x, raft)) continue;
      const g = gScore[i]! + cost;
      if (stamp[j] === run && g >= gScore[j]!) continue;
      stamp[j] = run; gScore[j] = g; came[j] = i;
      heap.push(j, g + h(j));
    }
  }
  if (!found) return null;
  const tiles: number[] = [];
  for (let i = to; i !== -1; i = came[i]!) tiles.push(i);
  tiles.reverse();                                    // from … to
  // Smooth: from each kept point, jump to the farthest tile still in a clear straight line.
  const out: number[] = [];
  let at = 0;
  while (at < tiles.length - 1) {
    let next = at + 1;
    for (let k = tiles.length - 1; k > at + 1; k--) {
      if (lineClear(m, tiles[at]!, tiles[k]!, raft)) { next = k; break; }
    }
    if (next < tiles.length - 1) out.push(tiles[next]!);
    at = next;
  }
  return out;
}

/** Routes by (from, to, raft), forgotten when the map's crossings change. Visual cache only. */
export class RouteCache {
  private readonly routes = new Map<number, number[] | null>();
  private crossingKey = -1;

  /** Forget every route if the crossings changed (a breach opened a way). */
  check(m: WalkMap): void {
    let key = 0;
    if (m.crossing) for (let i = 0; i < m.crossing.length; i++) if (m.crossing[i]) key = (key * 31 + i) >>> 0;
    if (key !== this.crossingKey) { this.routes.clear(); this.crossingKey = key; }
  }

  get(m: WalkMap, from: number, to: number, raft: boolean): number[] | null {
    const k = (from * m.width * m.height + to) * 2 + (raft ? 1 : 0);
    if (this.routes.has(k)) return this.routes.get(k)!;
    if (this.routes.size >= PA.cacheSize) this.routes.clear();
    const r = findRoute(m, from, to, raft);
    this.routes.set(k, r);
    return r;
  }
}
