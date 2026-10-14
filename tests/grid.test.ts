import { describe, expect, it } from 'vitest';
import {
  idx, xOf, yOf, inBounds, dist2, forEach4, forEach8Passable, forEachInDisk, lineTiles,
} from '../src/shared/grid';
import { hash01 } from '../src/shared/hash';

const W = 160;
const H = 90;

describe('grid', () => {
  it('converts index ↔ x,y', () => {
    for (const [x, y] of [[0, 0], [159, 0], [0, 89], [159, 89], [42, 17]] as const) {
      const i = idx(x, y, W);
      expect(i).toBe(y * 160 + x);
      expect(xOf(i, W)).toBe(x);
      expect(yOf(i, W)).toBe(y);
    }
  });

  it('checks bounds', () => {
    expect(inBounds(0, 0, W, H)).toBe(true);
    expect(inBounds(159, 89, W, H)).toBe(true);
    expect(inBounds(-1, 0, W, H)).toBe(false);
    expect(inBounds(160, 0, W, H)).toBe(false);
    expect(inBounds(0, 90, W, H)).toBe(false);
  });

  it('gives 4-neighbours in fixed order and clips at edges', () => {
    const got: number[] = [];
    forEach4(idx(5, 5, W), W, H, (n) => got.push(n));
    expect(got).toEqual([idx(5, 4, W), idx(4, 5, W), idx(6, 5, W), idx(5, 6, W)]);
    const corner: number[] = [];
    forEach4(0, W, H, (n) => corner.push(n));
    expect(corner).toEqual([1, W]);
  });

  it('blocks diagonal steps that cut a wall corner', () => {
    const blocked = new Set([idx(6, 5, W)]); // wall to the east
    const passable = (n: number): boolean => !blocked.has(n);
    const got: number[] = [];
    forEach8Passable(idx(5, 5, W), W, H, passable, (n) => got.push(n));
    expect(got).not.toContain(idx(6, 5, W));
    expect(got).not.toContain(idx(6, 4, W)); // NE needs east open
    expect(got).not.toContain(idx(6, 6, W)); // SE needs east open
    expect(got).toContain(idx(4, 4, W));
    expect(got.length).toBe(5);
  });

  it('iterates a disk with dx²+dy² ≤ r², in index order', () => {
    const got: number[] = [];
    forEachInDisk(10, 10, 4, W, H, (i) => got.push(i));
    expect(got.length).toBe(13); // radius 2 disk
    expect([...got].sort((a, b) => a - b)).toEqual(got);
    expect(got.every((i) => dist2(10, 10, xOf(i, W), yOf(i, W)) <= 4)).toBe(true);
  });

  it('clips disks at the map edge', () => {
    const got: number[] = [];
    forEachInDisk(0, 0, 4, W, H, (i) => got.push(i));
    expect(got.length).toBe(6);
  });

  it('draws gap-free lines including both ends', () => {
    const pts = lineTiles(0, 0, 7, 3);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([7, 3]);
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1]!;
      const [bx, by] = pts[k]!;
      expect(Math.max(Math.abs(bx - ax), Math.abs(by - ay))).toBe(1);
    }
    expect(lineTiles(3, 3, 3, 3)).toEqual([[3, 3]]);
  });
});

describe('hash01', () => {
  it('returns fixed values (grain must look identical after reload)', () => {
    expect(hash01(0, 0)).toBe(0);
    expect(hash01(1, 0)).toBe(0.5081244609318674);
    expect(hash01(0, 1)).toBe(0.7682745542842895);
    expect(hash01(123, 456)).toBe(0.9080349360592663);
    expect(hash01(1279, 719)).toBe(0.13902740250341594);
    expect(hash01(5, 7, 3)).toBe(0.6723138059023768);
    expect(hash01(100, 200, 1000)).toBe(0.7270065585616976);
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    let below = 0;
    const n = 1280 * 72;
    for (let y = 0; y < 72; y++) {
      for (let x = 0; x < 1280; x++) {
        const v = hash01(x, y);
        expect(v >= 0 && v < 1).toBe(true);
        if (v < 0.1) below++;
      }
    }
    expect(below / n).toBeGreaterThan(0.09);
    expect(below / n).toBeLessThan(0.11);
  });
});
