import { describe, expect, it } from 'vitest';
import { createMap, cloneMap } from '../src/editor/mapState';
import {
  decodeMap, decodeRun, encodeMap, encodeRun, base64ToBytes, bytesToBase64,
  SaveError, WRONG_VERSION_MESSAGE,
} from '../src/shared/save';
import type { MapData, RunSetup } from '../src/shared/types';

/** A map with every layer holding varied bytes, so a lost or swapped layer is caught. */
function busyMap(): MapData {
  const m = createMap();
  const n = m.width * m.height;
  for (let i = 0; i < n; i++) {
    m.ground[i] = i % 4;
    m.plantType[i] = (i * 7) % 4;
    m.plantDensity[i] = (i * 13) % 256;
    m.resourceType[i] = (i * 3) % 5;
    m.resourceAmount[i] = (i * 31) % 256;
    m.rain[i] = (i * 17) % 101;
    for (let s = 0; s < 4; s++) m.animals[s]![i] = (i * (s + 5)) % 256;
    m.wall[i] = (i * 11) % 4;
  }
  return m;
}

function expectSameMap(a: MapData, b: MapData): void {
  expect(b.version).toBe(1);
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  expect(b.ground).toEqual(a.ground);
  expect(b.plantType).toEqual(a.plantType);
  expect(b.plantDensity).toEqual(a.plantDensity);
  expect(b.resourceType).toEqual(a.resourceType);
  expect(b.resourceAmount).toEqual(a.resourceAmount);
  expect(b.rain).toEqual(a.rain);
  for (let s = 0; s < 4; s++) expect(b.animals[s]).toEqual(a.animals[s]);
  expect(b.wall).toEqual(a.wall);
}

describe('save', () => {
  it('base64 round-trips every byte value', () => {
    const bytes = new Uint8Array(70000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('new map has the §8.2 defaults', () => {
    const m = createMap();
    expect([m.width, m.height]).toEqual([160, 90]);
    expect(m.ground.every((v) => v === 0)).toBe(true);
    expect(m.rain.every((v) => v === 50)).toBe(true);
    expect(m.plantType.every((v) => v === 0)).toBe(true);
    expect(m.wall.every((v) => v === 0)).toBe(true);
  });

  it('map round trip is byte-identical', () => {
    const m = busyMap();
    const text = encodeMap(m);
    const back = decodeMap(text);
    expectSameMap(m, back);
    expect(encodeMap(back)).toBe(text);
  });

  it('clone is a deep copy', () => {
    const m = busyMap();
    const c = cloneMap(m);
    expectSameMap(m, c);
    c.ground[0] = 3;
    expect(m.ground[0]).toBe(0);
  });

  it('run round trip keeps map, founders, events, seed and drift', () => {
    const run: RunSetup = {
      version: 1,
      name: 'Smart desert vs rich forest',
      map: busyMap(),
      founders: [{
        id: 1, name: 'Forest', colorIndex: 0, x: 30, y: 45,
        people: [{ sex: 0, age: 22, intelligence: 70, cooperation: 50, strength: 50 }],
      }],
      events: [{ kind: 'drought', at: { x: 120, y: 40 }, startYear: 500, lengthYears: 30, strength: 70 }],
      seed: 48213,
      climateDrift: 'slow',
    };
    const text = encodeRun(run);
    const back = decodeRun(text);
    expectSameMap(run.map, back.map);
    expect(back.founders).toEqual(run.founders);
    expect(back.events).toEqual(run.events);
    expect(back.seed).toBe(48213);
    expect(back.climateDrift).toBe('slow');
    expect(back.name).toBe(run.name);
    expect(encodeRun(back)).toBe(text);
  });

  it('rejects unknown versions with the §17.4 message', () => {
    const j = JSON.parse(encodeMap(createMap()));
    j.version = 2;
    expect(() => decodeMap(JSON.stringify(j))).toThrow(WRONG_VERSION_MESSAGE);
    expect(() => decodeMap('not json')).toThrow(SaveError);
  });

  it('rejects a layer of the wrong size', () => {
    const j = JSON.parse(encodeMap(createMap()));
    j.rain = bytesToBase64(new Uint8Array(10));
    expect(() => decodeMap(JSON.stringify(j))).toThrow(SaveError);
  });
});
