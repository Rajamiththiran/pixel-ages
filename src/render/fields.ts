// Fields and the harvest (seasons plan Phase 2b, mockup B). Each block of farmland tiles goes
// through the year's stages, bare furrows → sprouts → green → gold → stubble, by one hash per block,
// so fields read as plots. The harvest is driven by the simulation's farmers: in autumn a field
// with farmers on it is cut a little further each month, stubble behind a ragged edge, sheaves
// standing. Drawing only: the simulation's farming is read, never changed.

import { CONFIG } from '../config';
import { Action, Plant, Season } from '../shared/ids';
import { hash01 } from '../shared/hash';
import { PERSON_FLOATS } from '../shared/protocol';
import type { MapData } from '../shared/types';

const FC = CONFIG.render.seasons.fields;
const MONTHS = CONFIG.time.ticksPerYear;

/** A field's stage. */
export const Stage = { Bare: 0, Sprouts: 1, Green: 2, Gold: 3, Stubble: 4 } as const;
export type Stage = (typeof Stage)[keyof typeof Stage];

// A block's hash falls between these (sorted) thresholds; every hash in one interval gives the same
// stage in every season, so the interval is the block's field class (at most 5).
const BOUNDS = [...new Set([FC.springSprouts, FC.summerGold, FC.autumnGold, FC.winterStubble, FC.heldGold])].sort((a, b) => a - b);
/** How many field classes there are. */
export const FIELD_CLASSES = BOUNDS.length + 1;

/** The field class of farmland tile (tx, ty): one hash per block of cellTiles × cellTiles. */
export function fieldClass(tx: number, ty: number): number {
  const h = hash01(Math.floor(tx / FC.cellTiles), Math.floor(ty / FC.cellTiles), FC.salt);
  let c = 0;
  while (c < BOUNDS.length && h >= BOUNDS[c]!) c++;
  return c;
}

/** A field's stage in `season` (0 spring … 3 winter), for field class `cls`. */
export function stageOf(cls: number, season: number): Stage {
  const h = cls === 0 ? 0 : BOUNDS[cls - 1]!;   // any hash in the class decides alike; take its lower end
  switch (season) {
    case 0: return h < FC.springSprouts ? Stage.Sprouts : Stage.Bare;
    case 1: return h < FC.summerGold ? Stage.Gold : Stage.Green;
    case 2: return h < FC.autumnGold ? Stage.Gold : Stage.Stubble;
    default: return h < FC.winterStubble ? Stage.Stubble : Stage.Bare;
  }
}

/** Phase 4: a field's stage in the held fast-forward look: gold or green, half and half (mockup D). */
export function heldStageOf(cls: number): Stage {
  const h = cls === 0 ? 0 : BOUNDS[cls - 1]!;
  return h < FC.heldGold ? Stage.Gold : Stage.Green;
}

/** How many of a tile's pixel columns are cut in row `ly`, at harvest progress `cut` (0–255). */
export function rowCut(cut: number, tx: number, ty: number, ly: number, tile: number): number {
  if (cut <= 0) return 0;
  if (cut >= 255) return tile;
  const wander = (hash01(tx * tile + ly, ty, FC.salt + 1) - 0.5) * 2 * FC.raggedPx;
  return Math.max(0, Math.min(tile, Math.round((cut / 255) * tile + wander)));
}

/**
 * The harvest on the screen: per tile, how far it is cut (0–255). Fed each frame with the
 * simulation's month and people; returns the tiles whose cut changed (to redraw).
 */
export class FieldState {
  readonly cut: Uint8Array;
  private lastMonth = -1;    // the absolute month last seen

  constructor(private readonly w: number, private readonly h: number) {
    this.cut = new Uint8Array(w * h);
  }

  /** A jump in time or a new run: no harvest is known. Returns the tiles that were cut. */
  reset(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.cut.length; i++) if (this.cut[i]! > 0) { this.cut[i] = 0; out.push(i); }
    this.lastMonth = -1;
    return out;
  }

  /**
   * A frame at absolute month `abs` (year × 12 + month). Each new autumn month, every farmland
   * tile with a Farm worker on it or next to it is cut `cutPerMonth` further; a new spring resets
   * the year's harvest (the stubble is the stage of the season by then).
   */
  update(map: MapData, abs: number, people: Float32Array): number[] {
    const changed: number[] = [];
    if (abs === this.lastMonth) return changed;
    const first = this.lastMonth < 0;
    const months = first ? 1 : Math.max(0, Math.min(MONTHS, abs - this.lastMonth));
    this.lastMonth = abs;
    const season = CONFIG.seasonOfMonth[((abs % MONTHS) + MONTHS) % MONTHS]!;
    if (season === Season.Spring) {
      for (let i = 0; i < this.cut.length; i++) if (this.cut[i]! > 0) { this.cut[i] = 0; changed.push(i); }
      return changed;
    }
    if (season !== Season.Autumn || first || months === 0) return changed;
    const step = Math.round(FC.cutPerMonth * 255 * months);
    const seen = new Set<number>();
    for (let k = 0; k + PERSON_FLOATS <= people.length; k += PERSON_FLOATS) {
      if (people[k + 7] !== Action.Farm) continue;
      const x = Math.floor(people[k + 1]!), y = Math.floor(people[k + 2]!);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = x + dx, ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
          const i = ty * this.w + tx;
          if (seen.has(i) || map.plantType[i] !== Plant.Farmland) continue;
          seen.add(i);
          const was = this.cut[i]!;
          if (was >= 255) continue;
          this.cut[i] = Math.min(255, was + step);
          changed.push(i);
        }
      }
    }
    return changed;
  }
}
