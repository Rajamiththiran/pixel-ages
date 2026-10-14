import { describe, expect, it } from 'vitest';
import { computeAreas } from '../src/sim/world/regions';
import { WallType } from '../src/shared/ids';

const W = 160;
const H = 90;

describe('areas (§8.3)', () => {
  it('an empty map is one area', () => {
    const a = computeAreas(new Uint8Array(W * H), W, H);
    expect(a.count).toBe(1);
    expect(a.tileCount[0]).toBe(W * H);
  });

  it('a diagonal wall line splits areas (4-connectivity)', () => {
    const wall = new Uint8Array(W * H);
    // Diagonal from (0,0) to (89,89): tiles only touch at corners.
    for (let k = 0; k < H; k++) wall[k * W + k] = WallType.Mountain;
    const a = computeAreas(wall, W, H);
    expect(a.count).toBe(2);
    expect(a.regionId[1 * W + 0]).not.toBe(a.regionId[0 * W + 1]); // below vs above the line
    expect(a.regionId[0]).toBe(-1);
  });

  it('a full river splits the map; a gap joins it again', () => {
    const wall = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { wall[y * W + 80] = WallType.River; wall[y * W + 81] = WallType.River; }
    const split = computeAreas(wall, W, H);
    expect(split.count).toBe(2);
    expect(split.tileCount[0]! + split.tileCount[1]!).toBe(W * H - 2 * H);

    const crossing = new Uint8Array(W * H);
    crossing[45 * W + 80] = 1;
    crossing[45 * W + 81] = 1;
    expect(computeAreas(wall, W, H, crossing).count).toBe(1);
  });

  it('numbers areas by their lowest tile index', () => {
    const wall = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) wall[y * W + 100] = WallType.Sea;
    const a = computeAreas(wall, W, H);
    expect(a.regionId[0]).toBe(0);       // left side contains tile 0
    expect(a.regionId[101]).toBe(1);
    expect(a.centerX[0]).toBeCloseTo(49.5);
  });
});
