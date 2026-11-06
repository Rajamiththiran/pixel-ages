// Seasons and weather wave (docs/pixel-ages-seasons-plan.md). Drawing only.
// Phase 1a: the material buffer. Every terrain pixel keeps its ramp step and role, and the image is
// resolved from it through a lookup table. With today's table nothing on screen may change.
// Phase 1b: the seasonal ramps, the season arriving rank by rank, and grass moisture.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config';
import { Ground, Plant } from '../src/shared/ids';
import type { MapData } from '../src/shared/types';
import { createMap } from '../src/editor/mapState';
import { TerrainLayer, drawTilePixels, dissolveTile, readTile, type TileExtras } from '../src/render/terrain';
import { computeDepth } from '../src/render/terrainDetail';
import {
  NO_TAG, Role, createLook, createMatBuf, dissolveMat, matbufOn, readMatTile, resolveTile, sameMatLook, type MatBuf,
} from '../src/render/materials';
import { allTilesMap, scenarioA, scenarioF, scenarioH } from './fixtures';
import { Mat, RAMP_HEX, SEASON_HEX, hexRgb, rampColours, rampTag, shadowOf, tagCount, tagRgb, tagValid, type SeasonRampName } from '../src/render/ramps';
import { LookState, Moist, lookColour } from '../src/render/materials';
import { MoistureField, tileWetness } from '../src/render/moisture';
import { SeasonDriver, frontAt, parsePin } from '../src/render/seasonLook';
import { nightOf } from '../src/render/light';
import { GROUP_COLORS, PALETTE, usePalette } from '../src/render/palette';

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

/** Today's colours: every rank shows the painted state. */
const painted = createLook();

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
  for (let ty = 0; ty < m.height; ty++) for (let tx = 0; tx < m.width; tx++) resolveTile(mat, painted, px, tx, ty);
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
    resolveTile(mat, painted, px, 0, 0);
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
    const imgW = m.width * TILE;
    for (const [tx, ty] of [[0, 0], [7, 3], [17, 12], [33, 20], [38, 5]] as const) {
      const o = readMatTile(oldMat, tx, ty), nw = readMatTile(neuMat, tx, ty);
      expect(sameMatLook(oldMat, painted, tx, ty, o, nw)).toBe(fnv(readTile(oldImg, imgW, tx, ty)) === fnv(readTile(neuImg, imgW, tx, ty)));
      for (let s = 0; s <= CONFIG.render.gradual.fadeSteps; s++) {
        const rgba = new Uint8ClampedArray(oldImg.length);
        dissolveTile(rgba, imgW, tx, ty, readTile(oldImg, imgW, tx, ty), readTile(neuImg, imgW, tx, ty), s);
        const buf = createMatBuf(imgW, m.height * TILE);
        dissolveMat(buf, tx, ty, o, nw, s);
        const px = new Uint32Array(oldImg.length / 4);
        resolveTile(buf, painted, px, tx, ty);
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

// ---------- Phase 1b: seasonal ramps ----------

const MOCK_NIGHT_MUL = [0.2, 0.252, 0.42], MOCK_NIGHT_ADD = [10, 13.5, 40];   // the mockup code's night formula
// The mockup's ramp rule (seasons-render.js rampFrom): the warm light of step 4.
const WARM = [281, 235, 105], WARM_MIX = 0.372;
// Ramps the mockup lists by hand rather than building from one colour.
const LISTED = new Set<SeasonRampName>(['fruitSu', 'snowDust', 'snowFull', 'waterSpring', 'waterWinter', 'ice', 'iceRim']);

describe('seasons Phase 1b: the seasonal ramps are the mockup ramps', () => {
  it('ramps built from one colour follow the rule: step 0 = shadowOf(step 2), 1 halfway, 4 the warm light, 3 halfway', () => {
    for (const name of Object.keys(SEASON_HEX) as SeasonRampName[]) {
      if (LISTED.has(name)) continue;
      const r = SEASON_HEX[name].map(hexRgb);
      const c = r[2]!, s0 = shadowOf(c), s4 = c.map((v, i) => v + (WARM[i]! - v) * WARM_MIX);
      const want = [s0, c.map((v, i) => (v + s0[i]!) / 2), c, c.map((v, i) => (v + s4[i]!) / 2), s4];
      want.forEach((w, s) => w.forEach((v, i) => expect(Math.abs(v - r[s]![i]!), `${name} step ${s}`).toBeLessThanOrEqual(1)));
    }
  });

  it('full snow keeps the three snow tokens at steps 0, 2 and 4', () => {
    expect([SEASON_HEX.snowFull[0], SEASON_HEX.snowFull[2], SEASON_HEX.snowFull[4]]).toEqual([...RAMP_HEX[Mat.Snow]!]);
  });

  it('their night colours are the mockup night swatches, within 1/255 (night formulas, DECISIONS 26.1)', () => {
    for (const name of Object.keys(SEASON_HEX) as SeasonRampName[]) {
      for (const hex of SEASON_HEX[name]) {
        const c = hexRgb(hex), ours = nightOf(c);
        c.forEach((v, i) => expect(Math.abs(Math.round(ours[i]!) - Math.round(v * MOCK_NIGHT_MUL[i]! + MOCK_NIGHT_ADD[i]!)), `${name} ${hex}`).toBeLessThanOrEqual(1));
      }
    }
  });
});

const rgbOf = (c: readonly number[]): string => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const stepTag = (m: number, s: number): number => m * 8 + s;

describe('seasons Phase 1b: each material takes the ramp of its season', () => {
  const at = (state: number, cls: number, role: number, m: number, s: number): string => rgbOf(lookColour(state as LookState, cls, role, stepTag(m, s)));
  const sys = (m: number, s: number): string => RAMP_HEX[m]![s]!;

  it('painted is the colour of today for every role and tag', () => {
    for (let role = 0; role <= Role.Fire; role++) {
      for (let tag = 0; tag < tagCount(); tag++) if (tagValid(tag)) expect(lookColour(LookState.Painted, 1, role, tag)).toBe(tagRgb(tag));
    }
  });

  it('grass takes its season and moisture ramp; summer-normal is the system grass', () => {
    const names = [['grassSpDry', 'grassSpNormal', 'grassSpLush'], ['grassSuDry', null, 'grassSuLush'], ['grassAuDry', 'grassAuNormal', 'grassAuLush'], ['grassWiDry', 'grassWiNormal', 'grassWiLush']] as const;
    for (let season = 0; season < 4; season++) {
      for (let cls = 0; cls < 3; cls++) {
        const n = names[season]![cls];
        for (let s = 0; s < 5; s++) {
          const want = n ? SEASON_HEX[n][s] : sys(Mat.Grass, s);
          expect(at(LookState.Spring + season, cls, Role.Grass, Mat.Grass, s)).toBe(want);
          expect(at(LookState.Spring + season, cls, Role.Forest, Mat.Grass, s), 'forest floor grass').toBe(want);
        }
      }
    }
  });

  it('crowns turn with the evergreen ramp, fruit bushes with theirs (dormant grass in winter)', () => {
    expect(at(LookState.Spring, 1, Role.Crown, Mat.Forest, 2)).toBe(SEASON_HEX.evergreenSp[2]);
    expect(at(LookState.Summer, 1, Role.Crown, Mat.Forest, 2)).toBe(sys(Mat.Forest, 2));
    expect(at(LookState.Winter, 1, Role.Crown, Mat.Forest, 3)).toBe(SEASON_HEX.evergreenWi[3]);
    expect(at(LookState.Summer, 1, Role.Fruit, Mat.Grass, 1)).toBe(SEASON_HEX.fruitSu[1]);
    expect(at(LookState.Autumn, 0, Role.Fruit, Mat.Grass, 2)).toBe(SEASON_HEX.fruitAu[2]);
    expect(at(LookState.Winter, 2, Role.Fruit, Mat.Grass, 2)).toBe(SEASON_HEX.grassWiLush[2]);
  });

  it('fields: furrows stay soil; sprouts, green, gold, stubble by season; the held look keeps gold', () => {
    const want3 = [SEASON_HEX.cropSprout[3], SEASON_HEX.cropGreen[3], sys(Mat.Crop, 3), SEASON_HEX.cropStubble[3]];
    for (let season = 0; season < 4; season++) {
      expect(at(LookState.Spring + season, 1, Role.Farm, Mat.Crop, 0)).toBe(sys(Mat.Crop, 0));
      expect(at(LookState.Spring + season, 1, Role.Farm, Mat.Crop, 3)).toBe(want3[season]);
    }
    for (let s = 0; s < 5; s++) expect(at(LookState.Held, 1, Role.Farm, Mat.Crop, s)).toBe(sys(Mat.Crop, s));
  });

  it('water: rivers run with meltwater in spring; every water is colder in winter; sand and stone turn', () => {
    expect(at(LookState.Spring, 1, Role.River, Mat.Water, 2)).toBe(SEASON_HEX.waterSpring[2]);
    expect(at(LookState.Spring, 1, Role.Lake, Mat.Water, 2)).toBe(sys(Mat.Water, 2));
    for (const role of [Role.Lake, Role.River, Role.Sea]) expect(at(LookState.Winter, 1, role, Mat.Water, 1)).toBe(SEASON_HEX.waterWinter[1]);
    expect(at(LookState.Autumn, 1, Role.Desert, Mat.Sand, 4)).toBe(SEASON_HEX.sandAu[4]);
    expect(at(LookState.Winter, 1, Role.Mountain, Mat.Stone, 0)).toBe(SEASON_HEX.stoneWi[0]);
    expect(at(LookState.Summer, 1, Role.Mountain, Mat.Stone, 0)).toBe(sys(Mat.Stone, 0));
  });

  it('accents (ink, flowers, flames, ore, fruit) and wood and snow never change', () => {
    const fixed = [PALETTE.ink, PALETTE.flowerWhite, PALETTE.fireYellow, PALETTE.copper, PALETTE.fruit, RAMP_HEX[Mat.Wood]![2]!, RAMP_HEX[Mat.Snow]![1]!];
    for (const hex of fixed) {
      const tag = rampTag(hexRgb(hex));
      for (let state = 0; state <= LookState.Held; state++) expect(rgbOf(lookColour(state as LookState, 0, Role.Grass, tag)), `${hex} state ${state}`).toBe(hex);
    }
  });

  it('palette audit: every colour a season gives is a design colour (system ramp, accent or seasonal ramp)', () => {
    const ok = new Set<string>([...rampColours().map(rgbOf), ...Object.values(SEASON_HEX).flat()]);
    for (let state = 0; state <= LookState.Held; state++) {
      for (let cls = 0; cls < 3; cls++) {
        for (let role = 0; role <= Role.Fire; role++) {
          for (let tag = 0; tag < tagCount(); tag++) if (tagValid(tag)) expect(ok.has(rgbOf(lookColour(state as LookState, cls, role, tag)))).toBe(true);
        }
      }
    }
  });
});

describe('seasons Phase 1b: a season arrives rank by rank, each pixel once', () => {
  it('spring starts at month 0 and reaches every rank over its front', () => {
    const fr = CONFIG.render.seasons.fronts;
    expect(frontAt(0)).toEqual({ from: LookState.Winter, to: LookState.Spring, level: 0 });
    expect(frontAt(fr[0]!.months / 2).level).toBe(8);
    expect(frontAt(fr[0]!.months).level).toBe(16);
    expect(frontAt(2.9)).toEqual({ from: LookState.Winter, to: LookState.Spring, level: 16 });
    expect(frontAt(3)).toEqual({ from: LookState.Spring, to: LookState.Summer, level: 0 });
    expect(frontAt(11.99).to).toBe(LookState.Winter);
  });

  it('over two years each rank changes exactly once per season', () => {
    const d = new SeasonDriver(null);
    const changes = new Array<number>(16).fill(0);
    let prev = Array.from(d.update(0, 0, 1, true, true));
    for (let t = 0.01; t < 24; t += 0.01) {
      const now = Array.from(d.update(t * 1000, t % 12, 1, true, false));
      now.forEach((s, r) => { if (s !== prev[r]) changes[r]!++; });
      prev = now;
    }
    expect(changes).toEqual(new Array(16).fill(8));
  });

  it('setup shows the painted map; the fast speeds hold one look; a change of mode dissolves rank by rank', () => {
    const d = new SeasonDriver(null);
    expect([...d.update(0, 4.5, 1, false, false)].every((s) => s === LookState.Painted)).toBe(true);
    expect([...d.update(10, 4.5, 1, true, true)].every((s) => s === LookState.Summer)).toBe(true);   // a jump snaps
    const ms = CONFIG.render.seasons.modeFadeMs;
    d.update(1000, 7.5, 0, true, false);                     // Ride: to the held look
    const half = [...d.update(1000 + ms / 2, 7.5, 0, true, false)];
    expect(half.filter((s) => s === LookState.Held).length).toBe(8);
    expect([...d.update(1000 + ms, 7.5, 0, true, false)].every((s) => s === LookState.Held)).toBe(true);
    expect([...d.update(5000, 7.5, 0.5, true, false)].every((s) => s === LookState.Held)).toBe(true);   // Trot holds too (Phase 1b)
  });

  it('a dev pin freezes a season or a front', () => {
    expect([...parsePin('winter')!].every((s) => s === LookState.Winter)).toBe(true);
    const f = [...parsePin('front:spring:0.5')!];
    expect(f.filter((s) => s === LookState.Spring).length).toBe(8);
    expect(f.filter((s) => s === LookState.Winter).length).toBe(8);
    expect(parsePin('nonsense')).toBeNull();
    const d = new SeasonDriver(parsePin('autumn'));
    expect([...d.update(0, 0, 0, false, false)].every((s) => s === LookState.Autumn)).toBe(true);
  });
});

describe('seasons Phase 1b: grass moisture follows the rain', () => {
  const MO = CONFIG.render.seasons.moisture;

  /** A map of one rain, with an optional pond in the middle; returns the share of pixels per class. */
  function classes(rain: number, pond: boolean): number[] {
    const m = createMap(24, 16);
    m.rain.fill(rain);
    if (pond) for (let y = 7; y <= 8; y++) for (let x = 11; x <= 12; x++) m.ground[y * 24 + x] = Ground.Water;
    const buf = createMatBuf(24 * TILE, 16 * TILE);
    new MoistureField(24, 16).update(m, m.rain, buf, () => {});
    const n = [0, 0, 0];
    for (const c of buf.moist) n[c]!++;
    return n.map((v) => v / buf.moist.length);
  }

  it('dry ground is dry, wet ground lush, middling rain mostly normal', () => {
    expect(classes(20, false)[Moist.Dry]).toBe(1);
    expect(classes(95, false)[Moist.Lush]).toBe(1);
    expect(classes(50, false)[Moist.Normal]!).toBeGreaterThan(0.8);
  });

  it('grass near water is wetter', () => {
    expect(tileWetness(55, 1, 0.5)).toBeGreaterThan(tileWetness(55, MO.waterReachTiles + 1, 0.5));
    expect(classes(55, true)[Moist.Lush]!).toBeGreaterThan(classes(55, false)[Moist.Lush]!);
  });

  it('the edge between two classes is dithered, not a line', () => {
    const m = createMap(16, 4);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) m.rain[y * 16 + x] = x < 8 ? 25 : 55;
    const buf = createMatBuf(16 * TILE, 4 * TILE);
    new MoistureField(16, 4).update(m, m.rain, buf, () => {});
    // Across the edge, dry and normal pixels interleave in the Bayer pattern: a straight line would
    // flip exactly once per row.
    let flips = 0;
    const rows = 2 * TILE;
    for (let y = TILE; y < TILE + rows; y++) {
      for (let x = 1; x < 16 * TILE; x++) if (buf.moist[y * buf.w + x] !== buf.moist[y * buf.w + x - 1]) flips++;
    }
    expect(flips).toBeGreaterThan(rows);
  });

  it('only tiles whose classes changed are reported', () => {
    const m = createMap(20, 10);
    m.rain.fill(20);
    const buf = createMatBuf(20 * TILE, 10 * TILE);
    const f = new MoistureField(20, 10);
    const first: number[] = [];
    f.update(m, m.rain, buf, (i) => first.push(i));
    expect(first.length).toBe(200);          // everything was normal, now dry
    const again: number[] = [];
    f.update(m, m.rain, buf, (i) => again.push(i));
    expect(again).toEqual([]);
    m.rain[5 * 20 + 10] = 90;
    const one: number[] = [];
    f.update(m, m.rain, buf, (i) => one.push(i));
    expect(one.length).toBeGreaterThan(0);
    expect(one.length).toBeLessThanOrEqual(9);
  });
});

describe('seasons Phase 1b: the terrain layer shows the season', () => {
  /** The image a fresh full draw gives in `states`, with moisture from `rain`. */
  function reference(m: MapData, rain: ArrayLike<number>, states: number[]): string {
    const mat = createMatBuf(m.width * TILE, m.height * TILE);
    draw(m, none, STEPS[0], mat);
    new MoistureField(m.width, m.height).update(m, rain, mat, () => {});
    const look = createLook();
    look.shown.set(states);
    const data = new Uint8ClampedArray(mat.w * mat.h * 4), px = new Uint32Array(data.buffer);
    for (let ty = 0; ty < m.height; ty++) for (let tx = 0; tx < m.width; tx++) resolveTile(mat, look, px, tx, ty);
    return fnv(data);
  }

  it('recolouring ranks in place gives the same image as drawing in that season', () => {
    const m = scenarioA().map;
    clock = 0;
    const l = new TerrainLayer(m, true);
    l.setRain(m.rain);
    l.flush();
    expect(fnv(imageOf(l))).toBe(GOLDEN.A![0]);              // painted: the look of today
    const winter = new Array<number>(16).fill(LookState.Winter);
    l.setLook(winter); l.flush();
    expect(fnv(imageOf(l))).toBe(reference(m, m.rain, winter));
    const front = winter.map((s, r) => (r < 5 ? LookState.Spring : s));
    l.setLook(front); l.flush();
    expect(fnv(imageOf(l))).toBe(reference(m, m.rain, front));
    expect(fnv(imageOf(l))).not.toBe(reference(m, m.rain, winter));
  });

  it('a wetter year turns grass lush in place', () => {
    const m = scenarioA().map;
    clock = 0;
    const l = new TerrainLayer(m, true);
    const summer = new Array<number>(16).fill(LookState.Summer);
    l.setRain(m.rain); l.setLook(summer); l.flush();
    const before = fnv(imageOf(l));
    const wet = m.rain.map((v) => Math.min(100, v + 25));
    l.setRain(wet); l.flush();
    expect(fnv(imageOf(l))).not.toBe(before);
    expect(fnv(imageOf(l))).toBe(reference(m, wet, summer));
  });
});

// ---------- lineage colours on the seasonal ground ----------

/** CIE76 distance between two sRGB colours (render-side test maths). */
function deltaE(a: readonly number[], b: readonly number[]): number {
  const lab = (c: readonly number[]): number[] => {
    const lin = c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    const X = (0.4124 * lin[0]! + 0.3576 * lin[1]! + 0.1805 * lin[2]!) / 0.95047, Y = 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
    const Z = (0.0193 * lin[0]! + 0.1192 * lin[1]! + 0.9505 * lin[2]!) / 1.08883;
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
}

describe('seasons Phase 1b: lineage colours against the seasonal ground (report)', () => {
  it('lists the lineage colours that come close to a ground colour, by day and at night', () => {
    const LIMIT = 12;   // ΔE76 below this is hard to tell apart at sprite size
    const ground: Array<[string, string]> = [];
    for (const name of Object.keys(SEASON_HEX) as SeasonRampName[]) SEASON_HEX[name].forEach((h, s) => ground.push([`${name}-${s}`, h]));
    RAMP_HEX.forEach((r, m) => r.forEach((h, s) => ground.push([`system${m}-${s}`, h])));
    const close: string[] = [];
    for (const set of ['default', 'colourBlind'] as const) {
      usePalette(set);
      try {
        for (const lin of GROUP_COLORS) {
          for (const [name, h] of ground) {
            const day = deltaE(hexRgb(lin), hexRgb(h));
            const night = deltaE(nightOf(hexRgb(lin)), nightOf(hexRgb(h)));
            if (day < LIMIT || night < LIMIT / 3) close.push(`${set} ${lin} ~ ${name} ${h} (day ${day.toFixed(1)}, night ${night.toFixed(1)})`);
          }
        }
      } finally { usePalette('default'); }
    }
    console.log('LINEAGE\n' + close.join('\n'));
    expect(close.length).toBeGreaterThan(0);   // a report for the owner (step report and DECISIONS), not a rule
  });
});
