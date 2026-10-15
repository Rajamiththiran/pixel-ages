// Known tiles, frontier and revealing (§11.7). A group only uses tiles it has seen, and
// can never see across a wall: reveals only cover tiles connected to where it looks.

import { CONFIG } from '../../config';
import { Ground, WallType } from '../../shared/ids';
import { Discovery, has } from '../../shared/discoveries';
import type { Group, SimState } from '../state';
import { tilesConnected } from '../world/regions';

export const isKnown = (g: Group, i: number): boolean => ((g.known[i >> 3]! >> (i & 7)) & 1) === 1;

/** Tile i can be walked on by group g: not an intact wall, and not Water unless it owns Raft. */
export function passableFor(s: SimState, g: Group, i: number): boolean {
  if (s.wall[i] !== WallType.None && s.crossing[i] === 0) return false;
  return s.ground[i] !== Ground.Water || hasActive(g, Discovery.raft);
}

/** Owns discovery d and it isn't inactive for lack of resources (§12.6). */
export const hasActive = (g: Group, d: number): boolean => has(g.discoveries, d) && !has(g.inactive, d);

/** Reveal radius from the explorer's intelligence: int 60 → 2, 100 → 3, 140 → 4. */
export function revealRadius(intActual: number): number {
  const r = CONFIG.people.reveal;
  return Math.min(r.max, Math.max(r.min, r.base + Math.floor((intActual - r.intStart) / r.intStep)));
}

/**
 * Explore range in tiles: 8, × 2 with Cart, × 3 with Riding (both multiply). A band that wants
 * to split or move scouts as far as its migrate range (DECISIONS 3.6): a daughter band needs a
 * site 12+ tiles away, which 8-tile scouting could never reveal.
 */
export function exploreRange(g: Group): number {
  const r = CONFIG.people.range;
  const cart = hasActive(g, Discovery.cart);
  const riding = hasActive(g, Discovery.riding);
  const normal = r.explore * (cart ? r.cartExploreMult : 1) * (riding ? r.ridingExploreMult : 1)
    * (hasActive(g, Discovery.sails) ? CONFIG.future.tools.sailsExplore : 1);
  if (!g.wantsSplit && g.hungryMonths === 0) return normal;
  const far = r.migrate * (cart ? r.cartMigrateMult : 1) * (riding ? r.ridingMigrateMult : 1);
  return Math.max(normal, far);
}

/** Marks tiles as known. Returns the ones that were new. */
function markKnown(g: Group, tiles: number[]): number[] {
  const fresh: number[] = [];
  for (const i of tiles) {
    if (isKnown(g, i)) continue;
    g.known[i >> 3] = g.known[i >> 3]! | (1 << (i & 7));
    fresh.push(i);
  }
  if (fresh.length > 0) {
    g.knownCount += fresh.length;
    g.knownVersion++;
  }
  return fresh;
}

/**
 * Reveals every tile within `radius` of (cx, cy) that is in the same connected area as that
 * tile, plus wall tiles touching the revealed tiles (you can see a river bank, not across it).
 */
export function revealAround(s: SimState, g: Group, cx: number, cy: number, radius: number): number {
  const w = s.width;
  const h = s.height;
  const centre = cy * w + cx;
  const seen: number[] = [];
  const r2 = radius * radius;
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = y * w + x;
      if (i === centre || tilesConnected(s.regionId, s.regionParent, centre, i)) seen.push(i);
    }
  }
  // Walls bordering what was seen.
  const walls: number[] = [];
  for (const i of seen) {
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (s.wall[j] !== WallType.None && s.crossing[j] === 0) walls.push(j);
      }
    }
  }
  const fresh = markKnown(g, seen.concat(walls));
  if (fresh.length > 0) updateFrontier(s, g, fresh);
  return fresh.length;
}

/** Adds known tiles from another group (trade, conquest, splitting copies) and fixes the frontier. */
export function addKnownTiles(s: SimState, g: Group, tiles: number[]): void {
  const fresh = markKnown(g, tiles);
  if (fresh.length > 0) updateFrontier(s, g, fresh);
}

/**
 * Frontier = unknown tiles, passable for this group, next to (8-way) a known passable tile.
 * After new tiles become known: drop them from the frontier and add their unknown neighbours.
 */
function updateFrontier(s: SimState, g: Group, fresh: number[]): void {
  const w = s.width;
  const h = s.height;
  const next = new Set<number>();
  for (const i of g.frontier) if (!isKnown(g, i)) next.add(i);
  for (const i of fresh) {
    if (!passableFor(s, g, i)) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!isKnown(g, j) && passableFor(s, g, j)) next.add(j);
      }
    }
  }
  g.frontier = [...next].sort((a, b) => a - b);
}

/** Rebuilds the frontier from scratch (after gaining Raft, or a breach). */
export function rebuildFrontier(s: SimState, g: Group): void {
  g.frontier = [];
  const all: number[] = [];
  for (let i = 0; i < s.width * s.height; i++) if (isKnown(g, i)) all.push(i);
  updateFrontier(s, g, all);
}

/** Frontier tiles within the explore range of home, ascending. */
export function frontierInRange(s: SimState, g: Group): number[] {
  const range = exploreRange(g);
  const r2 = range * range;
  const w = s.width;
  const out: number[] = [];
  for (const i of g.frontier) {
    const dx = (i % w) - g.homeX;
    const dy = Math.floor(i / w) - g.homeY;
    if (dx * dx + dy * dy <= r2) out.push(i);
  }
  return out;
}
