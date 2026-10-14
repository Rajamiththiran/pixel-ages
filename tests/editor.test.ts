import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { stamp, strokeSegment, paintTile, type Tool } from '../src/editor/brushes';
import { fillBucket, regionOfSameValue } from '../src/editor/fill';
import { StrokeRecorder, UndoStack } from '../src/editor/undo';
import { Ground, Plant, Resource, Species, WallType } from '../src/shared/ids';
import { idx } from '../src/shared/grid';
import type { MapData } from '../src/shared/types';

const W = 160;

function paint(m: MapData, tool: Tool, x: number, y: number, size = 1, strength = 100): StrokeRecorder {
  const rec = new StrokeRecorder(m);
  stamp(m, rec, tool, x, y, size, strength, new Set());
  return rec;
}

describe('brushes (§8.2)', () => {
  it('brush size is a filled circle of that diameter', () => {
    const count = (size: number): number => {
      const m = createMap();
      paint(m, { kind: 'ground', value: Ground.Desert }, 50, 50, size);
      return m.ground.filter((v) => v === Ground.Desert).length;
    };
    expect(count(1)).toBe(1);
    expect(count(3)).toBe(9);
    expect(count(5)).toBe(21);
  });

  it('painting Water clears plants, resources and animals', () => {
    const m = createMap();
    const i = idx(10, 10, W);
    m.plantType[i] = Plant.Forest; m.plantDensity[i] = 200;
    m.resourceType[i] = Resource.Stone; m.resourceAmount[i] = 100;
    m.animals[Species.Prey][i] = 90;
    paint(m, { kind: 'ground', value: Ground.Water }, 10, 10);
    expect([m.plantType[i], m.plantDensity[i], m.resourceType[i], m.resourceAmount[i], m.animals[0][i]]).toEqual([0, 0, 0, 0, 0]);
  });

  it('plants, resources and animals are not painted on Water', () => {
    const m = createMap();
    const i = idx(10, 10, W);
    m.ground[i] = Ground.Water;
    paint(m, { kind: 'plant', value: Plant.Forest }, 10, 10);
    paint(m, { kind: 'resource', value: Resource.Clay }, 10, 10);
    paint(m, { kind: 'animal', species: Species.Herd }, 10, 10);
    expect([m.plantType[i], m.resourceType[i], m.animals[Species.Herd][i]]).toEqual([0, 0, 0]);
  });

  it('walls clear plants and resources', () => {
    const m = createMap();
    const i = idx(10, 10, W);
    paint(m, { kind: 'plant', value: Plant.Forest }, 10, 10);
    paint(m, { kind: 'resource', value: Resource.Iron }, 10, 10);
    paint(m, { kind: 'wall', value: WallType.River }, 10, 10);
    expect([m.wall[i], m.plantType[i], m.resourceType[i]]).toEqual([WallType.River, 0, 0]);
  });

  it('strength sets density, amount, rain and animal density', () => {
    const m = createMap();
    const i = idx(20, 20, W);
    paint(m, { kind: 'plant', value: Plant.Grass }, 20, 20, 1, 50);
    paint(m, { kind: 'resource', value: Resource.Copper }, 20, 20, 1, 20);
    paint(m, { kind: 'rain' }, 20, 20, 1, 73);
    paint(m, { kind: 'animal', species: Species.Riding }, 20, 20, 1, 100);
    expect(m.plantDensity[i]).toBe(128);
    expect(m.resourceAmount[i]).toBe(51);
    expect(m.rain[i]).toBe(73);
    expect(m.animals[Species.Riding][i]).toBe(255);
  });

  it('rain brush outer ring blends 50% and is not compounded while dragging', () => {
    const m = createMap(); // rain 50 everywhere
    const rec = new StrokeRecorder(m);
    const full = new Set<number>();
    stamp(m, rec, { kind: 'rain' }, 30, 30, 5, 100, full);
    expect(m.rain[idx(30, 30, W)]).toBe(100);
    expect(m.rain[idx(32, 30, W)]).toBe(75); // ring
    // Stamping again with the ring over the same tile keeps 75, not 87.
    stamp(m, rec, { kind: 'rain' }, 30, 31, 5, 100, full);
    expect(m.rain[idx(32, 30, W)]).toBe(75);
  });

  it('fast strokes leave no gaps', () => {
    const m = createMap();
    const rec = new StrokeRecorder(m);
    const tool: Tool = { kind: 'ground', value: Ground.Mountain };
    const full = new Set<number>();
    stamp(m, rec, tool, 0, 10, 1, 100, full);
    strokeSegment(m, rec, tool, 0, 10, 100, 40, 1, 100, full);
    // Every column from 0..100 has a painted tile.
    for (let x = 0; x <= 100; x++) {
      let found = false;
      for (let y = 0; y < 90; y++) if (m.ground[idx(x, y, W)] === Ground.Mountain) found = true;
      expect(found).toBe(true);
    }
  });
});

describe('fill bucket', () => {
  it('fills only the 4-connected same-value region', () => {
    const m = createMap();
    // A closed desert ring; the inside and outside are both Grassland but not connected.
    for (let x = 10; x <= 20; x++) { m.ground[idx(x, 10, W)] = Ground.Desert; m.ground[idx(x, 20, W)] = Ground.Desert; }
    for (let y = 10; y <= 20; y++) { m.ground[idx(10, y, W)] = Ground.Desert; m.ground[idx(20, y, W)] = Ground.Desert; }
    const rec = new StrokeRecorder(m);
    fillBucket(m, rec, { kind: 'ground', value: Ground.Mountain }, idx(15, 15, W), 100);
    expect(m.ground[idx(15, 15, W)]).toBe(Ground.Mountain);
    expect(m.ground[idx(11, 11, W)]).toBe(Ground.Mountain);
    expect(m.ground[idx(10, 15, W)]).toBe(Ground.Desert);  // ring untouched
    expect(m.ground[idx(5, 5, W)]).toBe(Ground.Grassland); // outside untouched
    expect(m.ground.filter((v) => v === Ground.Mountain).length).toBe(81);
  });

  it('a diagonal gap does not leak (4-connectivity)', () => {
    const vals = new Uint8Array(9);
    // 1 0 0
    // 0 1 0
    // 0 0 1   → the 1s are only diagonally connected
    vals[0] = 1; vals[4] = 1; vals[8] = 1;
    expect(regionOfSameValue((i) => vals[i]!, 3, 3, 0)).toEqual([0]);
  });

  it('compares the current layer only', () => {
    const m = createMap();
    m.ground[idx(5, 5, W)] = Ground.Desert; // different ground, same (no) plant
    const rec = new StrokeRecorder(m);
    fillBucket(m, rec, { kind: 'plant', value: Plant.Grass }, idx(0, 0, W), 100);
    expect(m.plantType.every((v) => v === Plant.Grass)).toBe(true);
  });
});

describe('undo / redo', () => {
  it('undoes and redoes strokes, including side effects on other layers', () => {
    const m = createMap();
    const hist = new UndoStack();
    const i = idx(40, 40, W);
    const r1 = paint(m, { kind: 'plant', value: Plant.Forest }, 40, 40, 3);
    hist.push(r1.finish()!);
    const r2 = paint(m, { kind: 'ground', value: Ground.Water }, 40, 40, 3);
    hist.push(r2.finish()!);
    expect([m.ground[i], m.plantType[i]]).toEqual([Ground.Water, Plant.None]);
    hist.undo(m);
    expect([m.ground[i], m.plantType[i]]).toEqual([Ground.Grassland, Plant.Forest]);
    hist.undo(m);
    expect(m.plantType[i]).toBe(Plant.None);
    hist.redo(m);
    hist.redo(m);
    expect([m.ground[i], m.plantType[i]]).toEqual([Ground.Water, Plant.None]);
  });

  it('keeps the last 50 strokes', () => {
    const m = createMap();
    const hist = new UndoStack(50);
    for (let k = 0; k < 60; k++) {
      const rec = new StrokeRecorder(m);
      paintTile(m, rec, { kind: 'rain' }, k, 60 + (k % 40)); // never 50, so every stroke changes something
      hist.push(rec.finish()!);
    }
    let undone = 0;
    while (hist.undo(m)) undone++;
    expect(undone).toBe(50);
    // Strokes 0–9 fell off the stack, so their tiles keep the new value.
    expect(m.rain[0]).toBe(60);
    expect(m.rain[10]).toBe(50);
  });

  it('a stroke that changes nothing is not recorded', () => {
    const m = createMap();
    const rec = paint(m, { kind: 'ground', value: Ground.Grassland }, 5, 5, 3);
    expect(rec.finish()).toBeNull();
  });
});
