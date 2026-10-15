// Walls and breaching (§13): under pressure, a group with the right discovery wears down a
// wall segment it knows; at zero health a 3×3 crossing opens and the areas on both sides merge.

import { CONFIG } from '../../config';
import { WallType, WALL_NAMES } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import type { Group, SimState } from '../state';
import { findRoot, openCrossing } from '../world/regions';
import { exploreRange, hasActive, isKnown, rebuildFrontier } from '../people/explore';
import { logEvent } from '../people/groups';

const W = CONFIG.walls;

/** Pressure P (0–1): hunger, crowding, or a discovery that ran out of its resource. */
export function pressure(g: Group): number {
  const crowd = Math.min(1, Math.max(0, (g.crowding - W.crowdingPressureStart) * W.crowdingPressureScale));
  return Math.max(g.hunger / 100, crowd, g.inactive !== 0 ? W.inactivePressure : 0);
}

/** Can the group work on this kind of wall: Boat for rivers and seas, Mining for mountains. */
export function canWorkWall(g: Group, wallType: number): boolean {
  if (wallType === WallType.Mountain) return hasActive(g, Discovery.mining);
  return hasActive(g, Discovery.boat);
}

/**
 * Monthly (§13): a group under pressure (P ≥ 0.4) that can work a wall targets the known
 * tile of an unbreached segment nearest home, within its explore range (ties → lowest
 * index). It keeps that target until the breach or until a condition fails.
 */
export function updateWallTarget(s: SimState, g: Group): void {
  if (pressure(g) < W.minPressure || (!hasActive(g, Discovery.boat) && !hasActive(g, Discovery.mining))) {
    g.wallTarget = null;
    return;
  }
  const range = exploreRange(g);
  const r2 = range * range;
  const w = s.width;
  const homeRoot = findRoot(s.regionParent, s.regionId[g.homeY * w + g.homeX]!);
  const ok = (i: number): boolean => {
    if (s.wall[i] === WallType.None || s.crossing[i] === 1 || !isKnown(g, i)) return false;
    const id = s.wallSegmentId[i]!;
    const seg = s.wallSegments[id];
    if (seg === undefined || seg.breached || !canWorkWall(g, seg.type)) return false;
    // Only worth it if the breach here would reach other land (DECISIONS 5.10): not the map's edge.
    return opensToOtherArea(s, i, homeRoot);
  };
  const near = (i: number): boolean => {
    const dx = (i % w) - g.homeX;
    const dy = Math.floor(i / w) - g.homeY;
    return dx * dx + dy * dy <= r2;
  };
  if (g.wallTarget && ok(g.wallTarget.tile) && near(g.wallTarget.tile)) return;
  // A search that found nothing gives the same answer until the group knows more, gains a
  // discovery, moves, or a wall somewhere is breached; skip it until then (speed only).
  let breaches = 0;
  for (const seg of s.wallSegments) if (seg.breached) breaches++;
  const key = `${g.knownVersion}|${g.discoveries}|${g.inactive}|${g.homeX},${g.homeY}|${range}|${breaches}`;
  if (g.wallTarget === null && g.wallScanKey === key) return;

  let best = -1;
  let bestD = Infinity;
  for (let y = Math.max(0, g.homeY - range); y <= Math.min(s.height - 1, g.homeY + range); y++) {
    for (let x = Math.max(0, g.homeX - range); x <= Math.min(w - 1, g.homeX + range); x++) {
      const d = (x - g.homeX) * (x - g.homeX) + (y - g.homeY) * (y - g.homeY);
      if (d > r2 || d >= bestD) continue;      // index order: an equal distance keeps the lower index
      const i = y * w + x;
      if (ok(i)) { best = i; bestD = d; }
    }
  }
  g.wallTarget = best < 0 ? null : { segmentId: s.wallSegmentId[best]!, tile: best };
  g.wallScanKey = best < 0 ? key : '';
}

/**
 * True if a breach at `tile` would join another area: a tile next to the 3×3 crossing square
 * belongs to an area not yet connected to `homeRoot`.
 */
export function opensToOtherArea(s: SimState, tile: number, homeRoot: number): boolean {
  const r = W.breachRadius + 1;
  const cx = tile % s.width;
  const cy = Math.floor(tile / s.width);
  for (let y = Math.max(0, cy - r); y <= Math.min(s.height - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(s.width - 1, cx + r); x++) {
      const reg = s.regionId[y * s.width + x]!;
      if (reg >= 0 && findRoot(s.regionParent, reg) !== homeRoot) return true;
    }
  }
  return false;
}

/** Wear from `workers` wall workers of the given strength this month (§13). */
export function wearWall(s: SimState, g: Group, strength: number, workers: number): void {
  const t = g.wallTarget;
  if (!t || workers <= 0) return;
  const seg = s.wallSegments[t.segmentId]!;
  if (seg.breached) return;
  seg.health -= workers * W.wearPerWorkerMonth * Math.max(1, g.era) * (0.5 + strength / 100)
    * (hasActive(g, Discovery.riding) ? W.ridingWearMult : 1);
  seg.breachTile = t.tile;
  seg.breachGroup = g.id;
}

/**
 * Opens a crossing at `tile` (§8.3, §13): wall tiles in the 3×3 square become passable, the
 * areas around merge, and groups that know any of the new crossing tiles rebuild their
 * frontier. Used by breaches and (step 6) earthquakes. Returns the opened tiles.
 */
export function openBreach(s: SimState, tile: number): number[] {
  const opened = openCrossing(s, tile % s.width, Math.floor(tile / s.width), W.breachRadius);
  if (opened.length === 0) return opened;
  const segs = new Set(opened.map((i) => s.wallSegmentId[i]!));
  for (const id of segs) {
    const seg = s.wallSegments[id];
    if (seg) seg.breached = true;
  }
  for (const g of s.groups) {
    if (g.wallTarget && segs.has(g.wallTarget.segmentId)) g.wallTarget = null;
    if (opened.some((i) => isKnown(g, i))) rebuildFrontier(s, g);
  }
  return opened;
}

/** Monthly step 6 (§5.1): every worn-through segment opens where it was last worked. */
export function breachChecks(s: SimState): void {
  for (const seg of s.wallSegments) {
    if (seg.breached || seg.health > 0 || seg.breachTile < 0) continue;
    openBreach(s, seg.breachTile);
    seg.breached = true;
    const g = s.groups.find((o) => o.id === seg.breachGroup) ?? null;
    const what = `the ${WALL_NAMES[seg.type]} wall`;
    const x = seg.breachTile % s.width;
    const y = Math.floor(seg.breachTile / s.width);
    logEvent(s, 'breach', g ? `${g.name} breached ${what}` : `${what[0]!.toUpperCase()}${what.slice(1)} was breached`, g, null, x, y);
  }
}
