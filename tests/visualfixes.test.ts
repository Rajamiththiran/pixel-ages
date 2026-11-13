// Visual fixes (docs/pixel-ages-visual-fixes-plan.md, DECISIONS §43). Drawing and UI only.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Ground, Plant, WallType } from '../src/shared/ids';
import type { MapData } from '../src/shared/types';
import { createMap } from '../src/editor/mapState';
import { Mark } from '../src/shared/protocol';
import { drawTilePixels, type TileExtras } from '../src/render/terrain';
import { computeDepth, crownIn, edgeSource, setClearedMask, shoreWaterMask } from '../src/render/terrainDetail';
import { Role, createMatBuf, isCrown, type MatBuf } from '../src/render/materials';
import { labelBox, placeLabels, type GroupLabel } from '../src/render/people';
import { circlePixels } from '../src/render/pixelCircle';
import { keepsDayColour } from '../src/render/blit';
import { GROUP_COLORS, PALETTE, SKIN_COLORS, darken } from '../src/render/palette';

const TILE = CONFIG.map.tilePx;
const FE = CONFIG.render.fixes.edges;

/** Draws every tile of `m` into a material buffer (roles per pixel). */
function draw(m: MapData, ex: Partial<TileExtras> = {}): MatBuf {
  const depth = new Uint8Array(m.width * m.height);
  computeDepth(m, depth);
  const imgW = m.width * TILE;
  const data = new Uint8ClampedArray(imgW * m.height * TILE * 4);
  const mat = createMatBuf(imgW, m.height * TILE);
  for (let i = 0; i < m.width * m.height; i++) {
    drawTilePixels(m, i, data, imgW, { waterStep: 0, riverStep: 0 }, { depth, crossing: null, marks: null, hazards: null, look: null, base: null, ...ex, mat });
  }
  return mat;
}

/** The roles of tile (tx, ty), row by row. */
function tileRoles(mat: MatBuf, tx: number, ty: number): number[] {
  const out: number[] = [];
  for (let oy = 0; oy < TILE; oy++) for (let ox = 0; ox < TILE; ox++) out.push(mat.role[(ty * TILE + oy) * mat.w + tx * TILE + ox]!);
  return out;
}

describe('visual fixes A: group labels', () => {
  const labels: GroupLabel[] = [];
  for (let k = 0; k < 60; k++) labels.push({ name: `Riverfolk ${k}`, x: 10 + (k % 8), y: 10 + Math.floor(k / 8), colorIndex: 1, sub: 'Hunters', rank: k });
  labels[5]!.selected = true;
  const project = (mx: number, my: number): [number, number] => [mx, my];

  it('no two labels overlap, and the selected one is always placed', () => {
    const placed = placeLabels(labels, project, { full: false, hover: null });
    expect(placed.length).toBeLessThan(labels.length);
    expect(placed.some((p) => p.g.selected)).toBe(true);
    const boxes = placed.map((p) => labelBox(p.g, p.x, p.y));
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const [l1, t1, r1, b1] = boxes[a]!, [l2, t2, r2, b2] = boxes[b]!;
        expect(l1 >= r2 || l2 >= r1 || t1 >= b2 || t2 >= b1).toBe(true);
      }
    }
  });

  it('the hovered group always shows; zoomed out a plain group shows its name only', () => {
    const placed = placeLabels(labels, project, { full: false, hover: { x: 17, y: 16 } });
    expect(placed.some((p) => p.g.name === 'Riverfolk 55')).toBe(true);
    expect(placed.filter((p) => !p.g.selected && p.g.name !== 'Riverfolk 55').every((p) => p.g.sub === undefined)).toBe(true);
    const full = placeLabels(labels, project, { full: true, hover: null });
    expect(full.every((p) => p.g.sub === 'Hunters')).toBe(true);
  });

  it('the most important label wins a place', () => {
    const two: GroupLabel[] = [
      { name: 'Hamlet', x: 10, y: 10, colorIndex: 0, rank: 5 },
      { name: 'Kingdom', x: 10, y: 10, colorIndex: 1, rank: 9 },
    ];
    expect(placeLabels(two, project, { full: false, hover: null }).map((p) => p.g.name)).toEqual(['Kingdom']);
  });
});

describe('visual fixes B: ruins, walked areas and fruit bushes', () => {
  it('a block of ruins draws no ring round each tile, only a few stones', () => {
    const m = createMap(5, 5);
    const marks = new Uint8Array(25);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) marks[y * 5 + x] = Mark.Ruin;
    const mat = draw(m, { marks });
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        const r = tileRoles(mat, x, y);
        const stones = r.filter((v) => v === Role.Mark).length;
        expect(stones).toBeLessThan(16);
        // The old ring: 24 pixels one in from the edge.
        let ring = 0;
        for (let oy = 1; oy <= TILE - 2; oy++) for (let ox = 1; ox <= TILE - 2; ox++) {
          if ((ox === 1 || ox === TILE - 2 || oy === 1 || oy === TILE - 2) && r[oy * TILE + ox] === Role.Mark) ring++;
        }
        expect(ring).toBeLessThan(12);
      }
    }
  });

  it('a 2 × 2 block of paths is a worn patch, not a square of lines; a straight path stays a line', () => {
    const m = createMap(6, 6);
    const marks = new Uint8Array(36);
    for (const i of [7, 8, 13, 14]) marks[i] = Mark.Path;
    for (let x = 0; x < 6; x++) marks[4 * 6 + x] = Mark.Path;   // a straight path along row 4
    const mat = draw(m, { marks });
    const mid = TILE / 2 - 1;
    for (const [tx, ty] of [[1, 1], [2, 1], [1, 2], [2, 2]] as const) {
      const r = tileRoles(mat, tx, ty);
      // No full centre row or column of path.
      const row = [...Array(TILE).keys()].every((ox) => r[mid * TILE + ox] === Role.Mark);
      const col = [...Array(TILE).keys()].every((oy) => r[oy * TILE + mid] === Role.Mark);
      expect(row || col).toBe(false);
    }
    const line = tileRoles(mat, 3, 4);
    expect([...Array(TILE).keys()].every((ox) => line[mid * TILE + ox] === Role.Mark)).toBe(true);
  });

  it('berries grow on bushes, with meadow between', () => {
    const m = createMap(6, 6);
    m.plantType.fill(Plant.FruitBushes);
    m.plantDensity.fill(200);
    const mat = draw(m);
    const W = mat.w;
    let berries = 0, meadow = 0, lone = 0;
    for (let y = 1; y < mat.h - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const r = mat.role[y * W + x]!;
        if (r === Role.Grass) meadow++;
        if (r !== Role.FruitSpeck) continue;
        berries++;
        let bush = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const q = mat.role[(y + dy) * W + x + dx]!;
          if (q === Role.Fruit || q === Role.FruitTwig || q === Role.FruitBlossom || q === Role.FruitSpeck) bush++;
        }
        if (bush <= 1) lone++;
      }
    }
    expect(berries).toBeGreaterThan(0);
    expect(meadow).toBeGreaterThan(0);
    expect(lone).toBe(0);
  });
});

describe('visual fixes C: people at night', () => {
  it('lineage colours, their shades and skin keep their day colour; grass does not', () => {
    for (const c of GROUP_COLORS) { expect(keepsDayColour(c)).toBe(true); expect(keepsDayColour(darken(c))).toBe(true); }
    for (const s of SKIN_COLORS) expect(keepsDayColour(s)).toBe(true);
    expect(keepsDayColour(PALETTE.fireYellow)).toBe(true);
    expect(keepsDayColour(PALETTE.grass)).toBe(false);
  });

  it('the night is shorter: dark for 40% of the day', () => {
    const L = CONFIG.render.f8.light;
    expect(L.nightShare + 2 * L.dusk).toBeCloseTo(0.4, 5);
  });
});

describe('visual fixes D: pixel circles', () => {
  it('a ring is closed, one pixel thick, and walks round in order', () => {
    for (const r of [3, 8, 20, 47]) {
      const px = circlePixels(r);
      const set = new Set(px.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of px) {
        expect(Math.abs(Math.hypot(x, y) - r)).toBeLessThanOrEqual(0.5);
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && set.has(`${x + dx},${y + dy}`)) n++;
        expect(n).toBeGreaterThanOrEqual(2);
      }
      // In angle order: each pixel touches the next (so a 2-on 3-off dash makes even dots).
      for (let k = 0; k < px.length; k++) {
        const [x1, y1] = px[k]!, [x2, y2] = px[(k + 1) % px.length]!;
        expect(Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2))).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('visual fixes F: clearings', () => {
  it('no tree grows on a cleared tile, and its middle is trodden earth', () => {
    const m = createMap(5, 5);
    m.plantType.fill(Plant.Forest);
    m.plantDensity.fill(255);
    const cleared = new Uint8Array(25);
    cleared[12] = 1;
    setClearedMask(cleared);
    try {
      const c = { x: 0, y: 0, r: 0, tone: 0 };
      for (let cy = 0; cy < (5 * TILE) / CONFIG.render.detail.treeCell; cy++) {
        for (let cx = 0; cx < (5 * TILE) / CONFIG.render.detail.treeCell; cx++) {
          if (crownIn(m, cx, cy, c)) expect(edgeSource(m, c.x, c.y)).not.toBe(12);
        }
      }
      const mat = draw(m, { cleared });
      const r = tileRoles(mat, 2, 2);
      // The middle 4 × 4: earth (or a crown overhanging from a neighbour), never forest floor.
      for (let oy = 2; oy < 6; oy++) for (let ox = 2; ox < 6; ox++) {
        const v = r[oy * TILE + ox]!;
        expect(v === Role.Mark || isCrown(v)).toBe(true);
      }
      expect(r.filter((v) => v === Role.Mark).length).toBeGreaterThan(20);
    } finally {
      setClearedMask(null);
    }
  });
});

describe('visual fixes G: soft edges', () => {
  it('a border between grass and desert frays within reach; fields keep their tile edge', () => {
    const m = createMap(4, 4);
    for (let y = 0; y < 4; y++) for (let x = 2; x < 4; x++) m.ground[y * 4 + x] = Ground.Desert;
    m.plantType[0] = Plant.Farmland; m.plantDensity[0] = 200;
    const mat = draw(m);
    const W = mat.w;
    const desert = (p: number): boolean => mat.role[p] === Role.Desert;
    let crossed = 0;
    for (let y = 0; y < mat.h; y++) {
      for (let x = 0; x < W; x++) {
        const d = desert(y * W + x), side = x >= 2 * TILE;
        if (d !== side) {
          crossed++;
          expect(Math.abs(x + 0.5 - 2 * TILE)).toBeLessThanOrEqual(FE.reachPx + 0.5);
        }
      }
    }
    expect(crossed).toBeGreaterThan(0);
    // The field tile (0, 0): every pixel a field.
    expect(tileRoles(mat, 0, 0).every((v) => v === Role.Farm)).toBe(true);
    // Its neighbour shows no field pixel.
    expect(tileRoles(mat, 1, 0).includes(Role.Farm)).toBe(false);
  });

  it('a small pond comes out round: its tile corners are land, its middle water', () => {
    const m = createMap(9, 9);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const d2 = (x - 4) ** 2 + (y - 4) ** 2;
      if (d2 <= 4) m.ground[y * 9 + x] = Ground.Water;
    }
    const wet = new Uint8Array(81 * TILE * TILE);
    shoreWaterMask(m, wet);
    const W = 9 * TILE;
    const at = (x: number, y: number): number => wet[y * W + x]!;
    expect(at(4 * TILE + 4, 4 * TILE + 4)).toBe(1);
    // The outer corner of an arm tip (tile 6, 4) is land; the outer corner of tile (5, 5) too.
    expect(at(7 * TILE - 1, 4 * TILE)).toBe(0);
    expect(at(6 * TILE - 1, 6 * TILE - 1)).toBe(0);
    // And the inner corner where two arms meet (land tile 6, 5 by the water of 5, 5 and 6, 4) is water.
    expect(at(6 * TILE, 5 * TILE)).toBe(1);
    // Walls and rivers keep their tiles.
    const r = createMap(4, 4);
    r.wall[5] = WallType.River;
    const rw = new Uint8Array(16 * TILE * TILE);
    shoreWaterMask(r, rw);
    for (let p = 0; p < rw.length; p++) {
      const x = p % (4 * TILE), y = Math.floor(p / (4 * TILE));
      expect(rw[p]).toBe(Math.floor(x / TILE) === 1 && Math.floor(y / TILE) === 1 ? 1 : 0);
    }
  });
});
