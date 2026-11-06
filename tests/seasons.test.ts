// Seasons and weather wave (docs/pixel-ages-seasons-plan.md). Drawing only.
// Phase 1a: the material buffer. Every terrain pixel keeps its ramp step and role, and the image is
// resolved from it through a lookup table. With today's table nothing on screen may change.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config';
import { Ground, Plant } from '../src/shared/ids';
import type { MapData } from '../src/shared/types';
import { createMap } from '../src/editor/mapState';
import { TerrainLayer, drawTilePixels, dissolveTile, readTile, type TileExtras } from '../src/render/terrain';
import { computeDepth } from '../src/render/terrainDetail';
import {
  NO_TAG, Role, createMatBuf, dissolveMat, identityLut, matbufOn, readMatTile, resolveTile, sameMatLook, type MatBuf,
} from '../src/render/materials';
import { allTilesMap, scenarioA, scenarioF, scenarioH } from './fixtures';

const TILE = CONFIG.map.tilePx;
const STEPS = [[0, 0], [1, 3], [3, 5], [7, 2]] as const;   // water and river animation steps

function fnv(d: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < d.length; k++) { h ^= d[k]!; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

type Extra = Pick<TileExtras, 'marks' | 'hazards' | 'look' | 'base'>;
const none: Extra = { marks: null, hazards: null, look: null, base: null };
const all = allTilesMap();
const MAPS: ReadonlyArray<readonly [string, MapData, Extra]> = [
  ['allTiles', all.m, { marks: all.marks, hazards: all.hazards, look: all.look, base: all.base }],
  ['A', scenarioA().map, none],
  ['F', scenarioF().map, none],
  ['H', scenarioH().map, none],
];

// Terrain hashes taken before Phase 1a (6 Nov 2026), one per animation step in STEPS. Every later
// phase must keep them while its own switches are off.
const GOLDEN: Record<string, string[]> = {
  allTiles: ['c5dee6fe', 'f351a039', '9721c13d', 'a310e027'],
  A: ['b18f65e4', '29f0b43c', '0f8e71a8', '273a6251'],
  F: ['8f5283d2', '19478917', 'aeb0d896', '302cb3cf'],
  H: ['4db6190d', '74ec91dd', 'b0443fcd', 'a8b4b835'],
};

/** Draws every tile; with `mat`, the buffer is filled too. */
function draw(m: MapData, x: Extra, step: readonly [number, number], mat: MatBuf | null): Uint8ClampedArray {
  const depth = new Uint8Array(m.width * m.height);
  computeDepth(m, depth);
  const imgW = m.width * TILE;
  const data = new Uint8ClampedArray(imgW * m.height * TILE * 4);
  for (let i = 0; i < m.width * m.height; i++) {
    drawTilePixels(m, i, data, imgW, { waterStep: step[0], riverStep: step[1] }, { depth, crossing: null, ...x, mat });
  }
  return data;
}

/** The whole image resolved from the buffer, from scratch. */
function resolveAll(m: MapData, mat: MatBuf): Uint8ClampedArray {
  const data = new Uint8ClampedArray(mat.w * mat.h * 4);
  const px = new Uint32Array(data.buffer);
  for (let ty = 0; ty < m.height; ty++) for (let tx = 0; tx < m.width; tx++) resolveTile(mat, identityLut(), px, tx, ty);
  return data;
}

describe('seasons Phase 1a: the material buffer changes nothing on screen', () => {
  it('is on by default (it needs the ramps)', () => {
    expect(matbufOn).toBe(true);
  });

  // One test so each map is drawn once per step: the image without and with the buffer, then the
  // image resolved from the buffer, all equal to the terrain before Phase 1a.
  it('the terrain is pixel-identical to before Phase 1a; with the buffer, and resolved from it', () => {
    for (const [name, m, x] of MAPS) {
      STEPS.forEach((s, k) => {
        expect(fnv(draw(m, x, s, null)), `${name} step ${k}`).toBe(GOLDEN[name]![k]);
        const mat = createMatBuf(m.width * TILE, m.height * TILE);
        expect(fnv(draw(m, x, s, mat)), `${name} step ${k}, buffer`).toBe(GOLDEN[name]![k]);
        expect(fnv(resolveAll(m, mat)), `${name} step ${k}, resolved`).toBe(GOLDEN[name]![k]);
        // Every drawn pixel has a real tag and a role.
        expect(mat.tag.includes(NO_TAG), name).toBe(false);
        expect(mat.role.includes(Role.None), name).toBe(false);
      });
    }
  });

  it('a pixel not drawn yet resolves to transparent, as the image is before its first draw', () => {
    const mat = createMatBuf(TILE, TILE);
    const px = new Uint32Array(TILE * TILE).fill(1);
    resolveTile(mat, identityLut(), px, 0, 0);
    expect([...px].every((v) => v === 0)).toBe(true);
  });

  it('the buffer redraws the same in any tile order', () => {
    const [, m, x] = MAPS[0]!;
    const depth = new Uint8Array(m.width * m.height);
    computeDepth(m, depth);
    const imgW = m.width * TILE, n = m.width * m.height;
    const data = new Uint8ClampedArray(imgW * m.height * TILE * 4);
    const a = createMatBuf(imgW, m.height * TILE), b = createMatBuf(imgW, m.height * TILE);
    for (let i = 0; i < n; i++) drawTilePixels(m, i, data, imgW, { waterStep: 1, riverStep: 1 }, { depth, crossing: null, ...x, mat: a });
    for (let i = n - 1; i >= 0; i--) drawTilePixels(m, i, data, imgW, { waterStep: 1, riverStep: 1 }, { depth, crossing: null, ...x, mat: b });
    expect(fnv(a.tag)).toBe(fnv(b.tag));
    expect(fnv(a.role)).toBe(fnv(b.role));
  });

  it('a tile dissolving through the buffer looks exactly as the RGBA dissolve, step by step', () => {
    // Old look: the all-tiles map; new look: the same map with every tile one band over.
    const m = all.m, x = MAPS[0]![2];
    const oldMat = createMatBuf(m.width * TILE, m.height * TILE);
    const oldImg = draw(m, x, STEPS[1], oldMat);
    const m2 = allTilesMap().m;
    for (let i = 0; i < m2.ground.length; i++) {
      const j = i + 5 < m2.ground.length ? i + 5 : i;
      m2.ground[i] = m.ground[j]!; m2.plantType[i] = m.plantType[j]!; m2.plantDensity[i] = m.plantDensity[j]!; m2.wall[i] = m.wall[j]!;
    }
    const neuMat = createMatBuf(m.width * TILE, m.height * TILE);
    const neuImg = draw(m2, x, STEPS[1], neuMat);
    const lut = identityLut();
    const imgW = m.width * TILE;
    for (const [tx, ty] of [[0, 0], [7, 3], [17, 12], [33, 20], [38, 5]] as const) {
      const o = readMatTile(oldMat, tx, ty), nw = readMatTile(neuMat, tx, ty);
      expect(sameMatLook(lut, o, nw)).toBe(fnv(readTile(oldImg, imgW, tx, ty)) === fnv(readTile(neuImg, imgW, tx, ty)));
      for (let s = 0; s <= CONFIG.render.gradual.fadeSteps; s++) {
        const rgba = new Uint8ClampedArray(oldImg.length);
        dissolveTile(rgba, imgW, tx, ty, readTile(oldImg, imgW, tx, ty), readTile(neuImg, imgW, tx, ty), s);
        const buf = createMatBuf(imgW, m.height * TILE);
        dissolveMat(buf, tx, ty, o, nw, s);
        const px = new Uint32Array(oldImg.length / 4);
        resolveTile(buf, lut, px, tx, ty);
        expect(fnv(readTile(new Uint8ClampedArray(px.buffer), imgW, tx, ty)), `tile ${tx},${ty} step ${s}`).toBe(fnv(readTile(rgba, imgW, tx, ty)));
      }
    }
  });
});

// ---------- the terrain layer, both ways, frame by frame ----------

// The layer draws into canvases; a minimal stand-in is enough, since the test reads the image data.
const fakeCtx = {
  createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: () => {},
};
let clock = 0;

beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }),
  };
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterAll(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
  vi.restoreAllMocks();
});

const imageOf = (l: TerrainLayer): Uint8ClampedArray => (l as unknown as { img: { data: Uint8ClampedArray } }).img.data;

describe('seasons Phase 1a: the terrain layer looks the same with the buffer as without', () => {
  it('first draw (in budget slices), water animation, and tiles dissolving mid-fade', () => {
    const m = scenarioA().map;
    clock = 0;
    const withMat = new TerrainLayer(m, true), without = new TerrainLayer(m, false);
    expect(withMat.mat).not.toBeNull();
    expect(without.mat).toBeNull();
    const both = (f: (l: TerrainLayer) => void, label: string): void => {
      f(withMat); f(without);
      expect(fnv(imageOf(withMat)), label).toBe(fnv(imageOf(without)));
    };
    // A first draw cut into slices by the frame budget (-1: stop at the first clock check, since the
    // test clock stands still); tiles left for later stay transparent.
    both((l) => l.flush(-1), 'first slice');
    // While half drawn, the simulation changes tiles that have not been drawn yet.
    const late = [m.width * m.height - 1, m.width * m.height - 2];
    both((l) => { l.fadeOn = true; l.mapChanged(late, true); l.flush(-1); }, 'change before first draw');
    both((l) => l.flush(), 'rest of the first draw');
    // Water and rivers move on their timers.
    for (const t of [500, 900, 1500]) { clock = t; both((l) => { l.animate(t); l.flush(); }, `water ${t}`); }
    // Forest cleared to farmland and a lake filled in; both fade.
    const changed: number[] = [];
    for (let i = 0; i < m.ground.length; i++) {
      if (m.plantType[i] === Plant.Forest && i % 7 === 0) { m.plantType[i] = Plant.Farmland; changed.push(i); }
      else if (m.ground[i] === Ground.Water && i % 5 === 0) { m.ground[i] = Ground.Grassland; m.plantType[i] = Plant.Grass; m.plantDensity[i] = 200; changed.push(i); }
    }
    expect(changed.length).toBeGreaterThan(20);
    clock = 2000;
    both((l) => { l.mapChanged(changed, true); l.flush(); }, 'fade starts');
    const fadeMs = CONFIG.render.gradual.fadeMs;
    clock = 2000 + fadeMs * 0.3;
    both((l) => l.flush(), 'fade 30%');
    // A tile changes again while it fades.
    m.plantType[changed[0]!] = Plant.Forest; m.plantDensity[changed[0]!] = 255;
    clock = 2000 + fadeMs * 0.6;
    both((l) => { l.mapChanged([changed[0]!], true); l.flush(); }, 'changed mid-fade');
    for (const f of [0.8, 1.1, 2.5]) { clock = 2000 + fadeMs * f; both((l) => { l.animate(clock); l.flush(); }, `fade ${f}`); }
  });
});

// ---------- roles ----------

/** The roles of tile (tx, ty)'s pixels. */
function rolesOf(mat: MatBuf, tx: number, ty: number): Set<number> {
  return new Set(readMatTile(mat, tx, ty).role);
}

describe('seasons Phase 1a: each pixel knows what it is', () => {
  const [, m, x] = MAPS[0]!;
  const mat = createMatBuf(m.width * TILE, m.height * TILE);
  draw(m, x, STEPS[0], mat);
  const only = (tx: number, ty: number, roles: number[]): void => {
    for (const r of rolesOf(mat, tx, ty)) expect(roles, `tile ${tx},${ty} has role ${r}`).toContain(r);
  };

  it('water: lake, river and sea', () => {
    only(17, 12, [Role.Lake]);
    only(36, 3, [Role.River]);
    only(35, 3, [Role.Sea]);
  });

  it('land: desert, farmland, mountain ground and peaks, mountain walls', () => {
    only(7, 12, [Role.Desert]);
    only(12, 2, [Role.Farm]);
    only(22, 12, [Role.Mountain, Role.Peak]);
    only(37, 3, [Role.Wall, Role.Peak]);
    expect(mat.role.includes(Role.Peak)).toBe(true);
  });

  it('a forest has crowns and the floor between them', () => {
    const r = rolesOf(mat, 2, 20);
    expect(r.has(Role.Crown)).toBe(true);
    expect(r.has(Role.Forest)).toBe(true);
    only(2, 20, [Role.Crown, Role.Forest]);
  });

  it('marks, fire and beaches override the ground under them', () => {
    expect(rolesOf(mat, 32, 10).has(Role.Mark)).toBe(true);   // a path
    expect(rolesOf(mat, 32, 19).has(Role.Mark)).toBe(true);   // a canal
    only(32, 7, [Role.Fire]);                                  // a burning tile, flames and char
    only(32, 14, [Role.Fire]);                                 // a canal on fire: the fire is drawn over it
    expect(rolesOf(mat, 14, 12).has(Role.Beach)).toBe(true);   // grass next to the lake
  });

  it('a pond of one tile: still water in the middle, mud banks at its rounded corners', () => {
    const p = createMap(5, 5);
    p.ground[12] = Ground.Water;
    const pm = createMatBuf(5 * TILE, 5 * TILE);
    draw(p, none, STEPS[0], pm);
    const r = rolesOf(pm, 2, 2);
    expect(r.has(Role.Lake)).toBe(true);
    expect(r.has(Role.Bank)).toBe(true);
    expect([...rolesOf(pm, 1, 1)]).toEqual([Role.Grass]);
  });
});
