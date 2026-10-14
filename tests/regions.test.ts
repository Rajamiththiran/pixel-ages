import { describe, expect, it } from 'vitest';
import {
  computeAreas, computeWallSegments, findRoot, openCrossing, tilesConnected, unionRegions,
} from '../src/sim/world/regions';
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

describe('wall segments (§8.3)', () => {
  it('joins same-type wall tiles with 8-connectivity, keeps types apart', () => {
    const wall = new Uint8Array(W * H);
    // A diagonal river line is one segment (8-connected).
    for (let k = 0; k < 10; k++) wall[k * W + k] = WallType.River;
    // A mountain wall touching the river's end is a different segment.
    wall[10 * W + 10] = WallType.Mountain;
    wall[10 * W + 11] = WallType.Mountain;
    // A separate river piece far away.
    wall[50 * W + 50] = WallType.River;
    const seg = computeWallSegments(wall, W, H);
    expect(seg.types).toEqual([WallType.River, WallType.Mountain, WallType.River]);
    expect(seg.segmentId[0]).toBe(seg.segmentId[9 * W + 9]);
    expect(seg.segmentId[10 * W + 10]).toBe(1);
    expect(seg.segmentId[50 * W + 50]).toBe(2);
    expect(seg.segmentId[1]).toBe(-1);
  });
});

describe('union-find and crossings (§8.3)', () => {
  it('merges regions with the lower id as root', () => {
    const parent = Int32Array.from([0, 1, 2, 3]);
    expect(unionRegions(parent, 3, 1)).toBe(1);
    expect(unionRegions(parent, 1, 2)).toBe(1);
    expect(findRoot(parent, 3)).toBe(1);
    expect(findRoot(parent, 0)).toBe(0);
  });

  it('a crossing through a river merges the two sides', () => {
    const wall = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { wall[y * W + 80] = WallType.River; wall[y * W + 81] = WallType.River; }
    const a = computeAreas(wall, W, H);
    const t = {
      width: W, height: H, wall, crossing: new Uint8Array(W * H),
      regionId: a.regionId, regionParent: Int32Array.from({ length: a.count }, (_, k) => k),
    };
    const west = 45 * W + 10;
    const east = 45 * W + 150;
    expect(tilesConnected(t.regionId, t.regionParent, west, east)).toBe(false);
    const opened = openCrossing(t, 80, 45, 1);
    // Radius 1 → 3×3 square; only wall tiles open (columns 80–81, rows 44–46).
    expect(opened.length).toBe(6);
    expect(tilesConnected(t.regionId, t.regionParent, west, east)).toBe(true);
    expect(tilesConnected(t.regionId, t.regionParent, 45 * W + 80, west)).toBe(true);
    // Unopened wall tiles stay unconnected.
    expect(t.regionId[10 * W + 80]).toBe(-1);
  });
});
