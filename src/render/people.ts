// People drawing. Step 1: placed founder groups stand around their home tile.
// Walking, work tiles and children following mothers arrive with the simulation (step 3).

import { CONFIG } from '../config';
import { Sex } from '../shared/ids';
import { hash01 } from '../shared/hash';
import type { FounderGroup } from '../shared/types';
import { AgeClass, personSprite } from './sprites';
import { GROUP_COLORS } from './palette';

const TILE = CONFIG.map.tilePx;
const R = CONFIG.render;
const A = CONFIG.people.ages;

const ageClassOf = (age: number): AgeClass =>
  age < A.adult ? AgeClass.Child : age >= A.elder ? AgeClass.Elder : AgeClass.Adult;

/** Pushes every founder as a standing sprite (frame 1) around the group's home. */
export function collectFounders(
  groups: readonly FounderGroup[],
  push: (img: HTMLCanvasElement, x: number, y: number) => void,
): void {
  for (const g of groups) {
    const cx = (g.x + 0.5) * TILE;
    const cy = (g.y + 0.5) * TILE;
    g.people.forEach((p, k) => {
      // Stable per-person offsets and looks, so placed people don't jump between frames.
      const ox = (2 * hash01(g.id, k, 101) - 1) * R.founderSpreadPx;
      const oy = (2 * hash01(g.id, k, 102) - 1) * R.founderSpreadPx;
      const img = personSprite({
        female: p.sex === Sex.Female,
        ageClass: ageClassOf(p.age),
        colorIndex: g.colorIndex,
        skin: Math.floor(hash01(g.id, k, 103) * 3),
        hair: Math.floor(hash01(g.id, k, 104) * 3),
        clothed: false,
      }, 1);
      push(img, cx + ox, cy + oy + TILE / 2);
    });
  }
}

/** Group names above their homes. */
export function drawGroupLabels(ctx: CanvasRenderingContext2D, groups: readonly FounderGroup[]): void {
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const g of groups) {
    const x = (g.x + 0.5) * TILE;
    const y = g.y * TILE - R.founderSpreadPx - 2;
    ctx.fillStyle = 'rgba(28, 26, 36, 0.8)';
    ctx.fillText(g.name, x + 1, y + 1);
    ctx.fillStyle = GROUP_COLORS[g.colorIndex % GROUP_COLORS.length]!;
    ctx.fillText(g.name, x, y);
  }
}
