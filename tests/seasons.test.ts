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
import { ALT, KEYS, LookState, Moist, ROLES, bayerKey, isCrown, isDeciduous, lookColour } from '../src/render/materials';
import { buildCrowns, crownPixelAt } from '../src/render/crowns';
import { FieldState, Stage, fieldClass, rowCut, stageOf } from '../src/render/fields';
import { FieldPos, GroundRole, fieldRoleParts, isGroundRole, isWaterRole } from '../src/render/materials';
import { NEVER, WinterField } from '../src/render/winter';
import { coverLines } from '../src/render/seasonLook';
import { WallType } from '../src/shared/ids';
import { Action } from '../src/shared/ids';
import { crownKind, evergreenChance } from '../src/render/terrain';
import { MoistureField, tileWetness } from '../src/render/moisture';
import { SeasonDriver, frontAt, parsePin, twoLooksAt } from '../src/render/seasonLook';
import { DayNight } from '../src/render/light';
import { HeldRain } from '../src/render/heldRain';
import { Clouds, Mask, bodyStep, cloudiness, makeCloud } from '../src/render/clouds';
import { PUDDLE_DARK, PUDDLE_LIGHT, shadeWord } from '../src/render/materials';
import { Fall, Weather } from '../src/render/weather';
import { yearLabel } from '../src/ui/runControls';
import { ticksPerSecondAt } from '../src/shared/speeds';
import { FrontFields, FrontKind } from '../src/render/seasonFront';
import { nightOf } from '../src/render/light';
import { GROUP_COLORS, PALETTE, usePalette, type RGB } from '../src/render/palette';

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
    expect([...r].some(isCrown)).toBe(true);
    expect(r.has(Role.Forest) || r.has(Role.FloorBare)).toBe(true);
    only(2, 20, [Role.Crown, Role.CrownSnow, Role.DecGreen, Role.DecYellow, Role.DecCopper, Role.Forest, Role.FloorBare,
      GroundRole.LitterGold, GroundRole.LitterYellow, GroundRole.LitterCopper]);   // Phase 2d: leaves on the floor
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
const LISTED = new Set<SeasonRampName>(['fruitSu', 'snowDust', 'snowFull', 'waterSpring', 'waterWinter', 'ice', 'iceRim', 'cloud', 'cloudStorm', 'precip']);   // listed in full by the mockup

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

const rgbOf = (c: readonly number[] | typeof ALT): string => (c === ALT ? 'alt' : '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
const stepTag = (m: number, s: number): number => m * 8 + s;

describe('seasons Phase 1b: each material takes the ramp of its season', () => {
  const at = (state: number, cls: number, role: number, m: number, s: number): string => rgbOf(lookColour(state as LookState, cls, role, stepTag(m, s)));
  const sys = (m: number, s: number): string => RAMP_HEX[m]![s]!;

  it('painted is the colour of today for every role and tag', () => {
    for (let role = 0; role < ROLES; role++) {
      // Phase 2d: a cluster flower is new, so setup shows the ground under it (its alt).
      const want = (tag: number): RGB | typeof ALT => (role === GroundRole.Bloom ? ALT : tagRgb(tag));
      for (let tag = 0; tag < tagCount(); tag++) if (tagValid(tag)) expect(lookColour(LookState.Painted, 1, role, tag)).toBe(want(tag));
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
        for (let role = 0; role < ROLES; role++) {
          for (let tag = 0; tag < tagCount(); tag++) {
            if (!tagValid(tag)) continue;
            const c = rgbOf(lookColour(state as LookState, cls, role, tag));
            // A bare deciduous crown shows its alt entry (a branch or the ground under it); so does a
            // flower or leaf litter out of its season (Phase 2d).
            const alt = (isDeciduous(role) && state === LookState.Winter) || isGroundRole(role);
            expect(c === 'alt' ? alt : ok.has(c), `state ${state} role ${role} tag ${tag}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('seasons Phase 1b: a season arrives key by key, each pixel once', () => {
  it('spring starts at month 0 and reaches every key over its front', () => {
    const fr = CONFIG.render.seasons.fronts;
    expect(frontAt(0)).toEqual({ from: LookState.Winter, to: LookState.Spring, level: 0, kind: FrontKind.Warm });
    expect(frontAt(fr[0]!.months / 2).level).toBe(KEYS / 2);
    expect(frontAt(fr[0]!.months).level).toBe(KEYS);
    expect(frontAt(2.9)).toEqual({ from: LookState.Winter, to: LookState.Spring, level: KEYS, kind: FrontKind.Warm });
    expect(frontAt(3)).toEqual({ from: LookState.Spring, to: LookState.Summer, level: 0, kind: FrontKind.Warm });
    expect(frontAt(6.5).kind).toBe(FrontKind.Autumn);
    expect(frontAt(11.99).to).toBe(LookState.Winter);
    expect(frontAt(11.99).kind).toBe(FrontKind.Cold);
  });

  it('over two years each key changes exactly once per season', () => {
    const d = new SeasonDriver(null);
    const changes = new Array<number>(KEYS).fill(0);
    let prev = Array.from(d.update(0, 0, 'full', true, true));
    for (let t = 0.01; t < 24; t += 0.01) {
      const now = Array.from(d.update(t * 1000, t % 12, 'full', true, false));
      now.forEach((s, r) => { if (s !== prev[r]) changes[r]!++; });
      prev = now;
    }
    expect(changes).toEqual(new Array(KEYS).fill(8));
  });

  it('setup shows the painted map; the fast speeds hold one look; a change of mode dissolves rank by rank', () => {
    const d = new SeasonDriver(null);
    expect([...d.update(0, 4.5, 'full', false, false)].every((s) => s === LookState.Painted)).toBe(true);
    expect([...d.update(10, 4.5, 'full', true, true)].every((s) => s === LookState.Summer)).toBe(true);   // a jump snaps
    const ms = CONFIG.render.seasons.modeFadeMs;
    d.update(1000, 7.5, 'held', true, false);                     // Ride: to the held look
    const half = [...d.update(1000 + ms / 2, 7.5, 'held', true, false)];
    expect(half.filter((s) => s === LookState.Held).length).toBe(KEYS / 2);
    expect([...d.update(1000 + ms, 7.5, 'held', true, false)].every((s) => s === LookState.Held)).toBe(true);
    expect([...d.update(5000, 7.5, 'held', true, false)].every((s) => s === LookState.Held)).toBe(true);   // Trot holds too (S4)
  });

  it('a dev pin freezes a season or a front', () => {
    expect([...parsePin('winter')!.states].every((s) => s === LookState.Winter)).toBe(true);
    const f = [...parsePin('front:spring:0.5')!.states];
    expect(f.filter((s) => s === LookState.Spring).length).toBe(KEYS / 2);
    expect(f.filter((s) => s === LookState.Winter).length).toBe(KEYS / 2);
    expect(parsePin('front:snow:0.25')!.kind).toBe(FrontKind.Cold);
    expect(parsePin('nonsense')).toBeNull();
    const d = new SeasonDriver(parsePin('autumn'));
    expect([...d.update(0, 0, 'held', false, false)].every((s) => s === LookState.Autumn)).toBe(true);
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

  it('land changes recheck the moisture only when water came or went', () => {
    const m = createMap(10, 6);
    m.ground[3 * 10 + 4] = Ground.Water;
    const buf = createMatBuf(10 * TILE, 6 * TILE);
    const f = new MoistureField(10, 6);
    f.update(m, m.rain, buf, () => {});
    m.plantType[12] = Plant.Forest;
    expect(f.tilesChanged(m, [12])).toBe(false);          // a new wood: wetness is the same
    m.ground[3 * 10 + 4] = Ground.Grassland;
    expect(f.tilesChanged(m, [12, 3 * 10 + 4])).toBe(true); // the pond dried: nearness to water changes
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
    const winter = new Array<number>(KEYS).fill(LookState.Winter);
    l.setLook(winter); l.flush();
    expect(fnv(imageOf(l))).toBe(reference(m, m.rain, winter));
    const front = winter.map((s, r) => (r < 80 ? LookState.Spring : s));
    l.setLook(front); l.flush();
    expect(fnv(imageOf(l))).toBe(reference(m, m.rain, front));
    expect(fnv(imageOf(l))).not.toBe(reference(m, m.rain, winter));
  });

  it('a wetter year turns grass lush in place', () => {
    const m = scenarioA().map;
    clock = 0;
    const l = new TerrainLayer(m, true);
    const summer = new Array<number>(KEYS).fill(LookState.Summer);
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

// ---------- Phase 2a: trees and bushes ----------

const TRS = CONFIG.render.seasons.trees;

/** A W × H map of one plant at full density and one height. */
function plantMap(plant: number, elevation: number, w = 12, h = 8): MapData {
  const m = createMap(w, h);
  for (let i = 0; i < w * h; i++) { m.plantType[i] = plant; m.plantDensity[i] = 255; m.elevation[i] = elevation; }
  return m;
}

/** Draws `m` into a buffer and resolves it in `state`; returns the buffer and the colours as hex. */
function drawIn(m: MapData, state: number): { mat: MatBuf; hex: string[] } {
  const mat = createMatBuf(m.width * TILE, m.height * TILE);
  draw(m, none, STEPS[0], mat);
  const look = createLook();
  look.shown.fill(state);
  const px = new Uint32Array(mat.w * mat.h);
  for (let ty = 0; ty < m.height; ty++) for (let tx = 0; tx < m.width; tx++) resolveTile(mat, look, px, tx, ty);
  const hex = Array.from(px, (v) => '#' + [v & 255, (v >> 8) & 255, (v >> 16) & 255].map((c) => c.toString(16).padStart(2, '0')).join(''));
  return { mat, hex };
}

const inRamp = (name: SeasonRampName): Set<string> => new Set<string>(SEASON_HEX[name]);

describe('seasons Phase 2a: evergreen and deciduous trees', () => {
  it('evergreens grow commoner with height (mockup: 12%, up to 97% on high ground)', () => {
    expect(evergreenChance(0)).toBeCloseTo(TRS.evergreenBase);
    expect(evergreenChance(TRS.evergreenFromElevation)).toBeCloseTo(TRS.evergreenBase);
    expect(evergreenChance(9)).toBeCloseTo(TRS.evergreenBase + TRS.evergreenHigh);
    expect(evergreenChance(Infinity)).toBeCloseTo(TRS.evergreenBase + TRS.evergreenHigh);
  });

  it('deciduous trees turn yellow, copper or stay green in autumn, in the configured shares', () => {
    const n = { [Role.Crown]: 0, [Role.DecYellow]: 0, [Role.DecCopper]: 0, [Role.DecGreen]: 0 } as Record<number, number>;
    for (let x = 0; x < 200; x++) for (let y = 0; y < 100; y++) n[crownKind(x * 7, y * 5, 0)]!++;
    const dec = 20000 - n[Role.Crown]!;
    expect(n[Role.Crown]! / 20000).toBeCloseTo(TRS.evergreenBase, 1);
    expect(n[Role.DecYellow]! / dec).toBeCloseTo(TRS.autumnYellow, 1);
    expect(n[Role.DecCopper]! / dec).toBeCloseTo(TRS.autumnCopper, 1);
  });

  it('a low wood is mostly deciduous, a high one mostly evergreen', () => {
    const share = (elev: number): number => {
      const { mat } = drawIn(plantMap(Plant.Forest, elev), LookState.Summer);
      let crowns = 0, ever = 0;
      for (const r of mat.role) { if (isCrown(r)) { crowns++; if (r === Role.Crown || r === Role.CrownSnow) ever++; } }
      return ever / crowns;
    };
    expect(share(0)).toBeLessThan(0.25);
    expect(share(9)).toBeGreaterThan(0.85);
  });

  it('a tree turns as one: every pixel of a crown takes its centre\'s rank', () => {
    const m = plantMap(Plant.Forest, 0);
    const { mat } = drawIn(m, LookState.Summer);
    const c = { x: 0, y: 0, r: 0, dx: 0, dy: 0, branch: 0 };
    let checked = 0;
    for (let ty = 0; ty < m.height; ty++) {
      for (let tx = 0; tx < m.width; tx++) {
        buildCrowns(m, tx, ty);
        for (let y = ty * TILE; y < ty * TILE + TILE; y++) {
          for (let x = tx * TILE; x < tx * TILE + TILE; x++) {
            const p = y * mat.w + x;
            if (!isCrown(mat.role[p]!)) continue;
            expect(crownPixelAt(x, y, c)).toBe(true);
            expect(mat.rank[p]).toBe(bayerKey(c.x, c.y));   // the centre's key (no front here: its Bayer key)
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('autumn shows yellow and copper crowns among the green; summer none', () => {
    const autumn = new Set(drawIn(plantMap(Plant.Forest, 0), LookState.Autumn).hex);
    const summer = new Set(drawIn(plantMap(Plant.Forest, 0), LookState.Summer).hex);
    for (const name of ['deciduousAuYellow', 'deciduousAuCopper'] as const) {
      expect([...inRamp(name)].some((h) => autumn.has(h)), name).toBe(true);
      expect([...inRamp(name)].some((h) => summer.has(h)), name).toBe(false);
    }
  });

  it('in winter a deciduous crown is bare: its branches in wood, the ground under it elsewhere', () => {
    const m = plantMap(Plant.Forest, 0);
    const { mat, hex } = drawIn(m, LookState.Winter);
    const wood = new Set(RAMP_HEX[Mat.Wood]!.slice(1, 4));
    const leaves = new Set<string>([...inRamp('deciduousSu'), ...inRamp('deciduousSp'), ...inRamp('deciduousAuGreen'), ...inRamp('deciduousAuYellow'), ...inRamp('deciduousAuCopper')]);
    let branches = 0, ground = 0;
    for (let p = 0; p < mat.role.length; p++) {
      if (!isDeciduous(mat.role[p]!)) continue;
      expect(mat.alt[p]).not.toBe(NO_TAG);
      expect(leaves.has(hex[p]!)).toBe(false);
      if (mat.altRole[p] === Role.Branch) { branches++; expect(wood.has(hex[p]!)).toBe(true); }
      else { ground++; expect(isCrown(mat.altRole[p]!)).toBe(false); }
    }
    expect(branches).toBeGreaterThan(100);
    expect(ground).toBeGreaterThan(branches);
  });

  it('in winter a low (deciduous) wood has a grass floor, a high (evergreen) wood keeps its dark floor', () => {
    const grassWinter = new Set<string>([...inRamp('grassWiNormal'), ...inRamp('grassWiDry'), ...inRamp('grassWiLush')]);
    const floorShare = (elev: number): number => {
      const { mat, hex } = drawIn(plantMap(Plant.Forest, elev), LookState.Winter);
      let floor = 0, light = 0;
      for (let p = 0; p < mat.role.length; p++) {
        if (mat.role[p] !== Role.Forest && mat.role[p] !== Role.FloorBare) continue;
        floor++;
        if (grassWinter.has(hex[p]!)) light++;
      }
      return light / floor;
    };
    expect(floorShare(0)).toBeGreaterThan(0.9);
    expect(floorShare(9)).toBeLessThan(0.1);
  });

});

describe('seasons Phase 2a: fruit bushes', () => {
  it('blossom in spring, berries in summer and autumn, bare twigs in winter', () => {
    const at = (state: number): Set<string> => new Set(drawIn(plantMap(Plant.FruitBushes, 0), state).hex);
    const blossom = inRamp('blossom'), berry = PALETTE.fruit, twig = RAMP_HEX[Mat.Wood]![1]!;
    const spring = at(LookState.Spring), summer = at(LookState.Summer), autumn = at(LookState.Autumn), winter = at(LookState.Winter);
    expect([...blossom].some((h) => spring.has(h))).toBe(true);
    expect(spring.has(berry)).toBe(false);
    expect(summer.has(berry) && autumn.has(berry)).toBe(true);
    expect([...blossom].some((h) => summer.has(h))).toBe(false);
    expect(winter.has(berry)).toBe(false);
    expect(winter.has(twig)).toBe(true);
  });

  it('the held look keeps the summer bush (berries, no blossom)', () => {
    const held = new Set(drawIn(plantMap(Plant.FruitBushes, 0), LookState.Held).hex);
    expect(held.has(PALETTE.fruit)).toBe(true);
    expect([...inRamp('blossom')].some((h) => held.has(h))).toBe(false);
  });
});

// ---------- Phase 2b: fields and the harvest ----------

const FC = CONFIG.render.seasons.fields;

/** A farmland map drawn on the new rows with harvest `cut` per tile, resolved in `state`. */
function fieldsIn(m: MapData, cut: Uint8Array, state: number): { mat: MatBuf; hex: string[] } {
  const mat = createMatBuf(m.width * TILE, m.height * TILE);
  const depth = new Uint8Array(m.width * m.height);
  computeDepth(m, depth);
  const imgW = m.width * TILE, data = new Uint8ClampedArray(imgW * m.height * TILE * 4);
  for (let i = 0; i < m.width * m.height; i++) {
    drawTilePixels(m, i, data, imgW, { waterStep: 0, riverStep: 0 }, { depth, crossing: null, ...none, mat, fields: cut });
  }
  const look = createLook();
  look.shown.fill(state);
  const px = new Uint32Array(mat.w * mat.h);
  for (let ty = 0; ty < m.height; ty++) for (let tx = 0; tx < m.width; tx++) resolveTile(mat, look, px, tx, ty);
  return { mat, hex: Array.from(px, (v) => '#' + [v & 255, (v >> 8) & 255, (v >> 16) & 255].map((c) => c.toString(16).padStart(2, '0')).join('')) };
}

/** The colours each stage may show (mockup fieldPixel). */
function stageColours(stage: number): Set<string> {
  const wood = RAMP_HEX[Mat.Wood]!.slice(1, 4);
  switch (stage) {
    case Stage.Gold: return new Set(RAMP_HEX[Mat.Crop]!);
    case Stage.Green: return inRamp('cropGreen');
    case Stage.Sprouts: return new Set([...wood, ...SEASON_HEX.cropSprout]);
    case Stage.Stubble: return new Set([...wood, ...SEASON_HEX.cropStubble]);
    default: return new Set(wood);
  }
}

describe('seasons Phase 2b: fields through the year', () => {
  it('a block of tiles shares one stage, and the stages come in the mockup shares', () => {
    for (let ty = 0; ty < 30; ty += 3) for (let tx = 0; tx < 30; tx += 3) {
      const c = fieldClass(tx, ty);
      for (let dy = 0; dy < FC.cellTiles; dy++) for (let dx = 0; dx < FC.cellTiles; dx++) expect(fieldClass(tx + dx, ty + dy)).toBe(c);
    }
    const n = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    let blocks = 0;
    for (let by = 0; by < 120; by++) for (let bx = 0; bx < 120; bx++) {
      blocks++;
      const c = fieldClass(bx * FC.cellTiles, by * FC.cellTiles);
      for (let s = 0; s < 4; s++) n[s]![stageOf(c, s)]!++;
    }
    expect(n[0]![Stage.Sprouts]! / blocks).toBeCloseTo(FC.springSprouts, 1);
    expect(n[1]![Stage.Gold]! / blocks).toBeCloseTo(FC.summerGold, 1);
    expect(n[2]![Stage.Gold]! / blocks).toBeCloseTo(FC.autumnGold, 1);
    expect(n[3]![Stage.Stubble]! / blocks).toBeCloseTo(FC.winterStubble, 1);
    expect(n[1]![Stage.Bare]! + n[1]![Stage.Sprouts]! + n[1]![Stage.Stubble]!).toBe(0);   // summer is green or gold
  });

  it('fields lie on the mockup rows: a ridge every other row, sprouts on even columns, stubble on odd', () => {
    const m = plantMap(Plant.Farmland, 0);
    const { mat } = fieldsIn(m, new Uint8Array(m.width * m.height), LookState.Summer);
    for (let y = 0; y < mat.h; y++) for (let x = 0; x < mat.w; x++) {
      const f = fieldRoleParts(mat.role[y * mat.w + x]!);
      expect(f).not.toBeNull();
      if (f!.sheaf) continue;
      if ((y & 1) === 0) expect(f!.pos).toBe(FieldPos.Furrow);
      else expect((x & 1) === 1 ? f!.pos === FieldPos.Stubble : f!.pos === FieldPos.Sprout || f!.pos === FieldPos.Ridge).toBe(true);
    }
  });

  it('every field tile shows the colours of its stage in each season, sprouts and stubble only where they grow', () => {
    const m = plantMap(Plant.Farmland, 0, 18, 12);
    for (let season = 0; season < 4; season++) {
      const { mat, hex } = fieldsIn(m, new Uint8Array(m.width * m.height), LookState.Spring + season);
      for (let p = 0; p < hex.length; p++) {
        const x = p % mat.w, y = Math.floor(p / mat.w);
        const stage = stageOf(fieldClass(Math.floor(x / TILE), Math.floor(y / TILE)), season);
        expect(stageColours(stage).has(hex[p]!), `season ${season} stage ${stage} ${hex[p]}`).toBe(true);
        const pos = fieldRoleParts(mat.role[p]!)!.pos;
        if (inRamp('cropSprout').has(hex[p]!)) expect(pos).toBe(FieldPos.Sprout);
        if (inRamp('cropStubble').has(hex[p]!)) expect(pos).toBe(FieldPos.Stubble);
      }
    }
  });

  it('setup shows the fields gold; the held look half gold and half green (Phase 4, mockup D)', () => {
    const m = plantMap(Plant.Farmland, 0, 30, 30);
    const crop = new Set<string>(RAMP_HEX[Mat.Crop]!), green = new Set<string>(SEASON_HEX.cropGreen);
    expect(fieldsIn(m, new Uint8Array(m.width * m.height), LookState.Painted).hex.every((h) => crop.has(h))).toBe(true);
    const held = fieldsIn(m, new Uint8Array(m.width * m.height), LookState.Held).hex;
    // Each tile is one stage: its centre row's ridge pixel (odd row) tells which.
    let gold = 0, greens = 0;
    for (let ty = 0; ty < m.height; ty++) {
      for (let tx = 0; tx < m.width; tx++) {
        const h = held[(ty * TILE + 3) * m.width * TILE + tx * TILE + 3]!;
        if (green.has(h)) greens++; else if (crop.has(h)) gold++;
      }
    }
    expect(gold + greens).toBe(m.width * m.height);
    expect(gold / (gold + greens)).toBeGreaterThan(0.3);
    expect(gold / (gold + greens)).toBeLessThan(0.7);
  });
});

describe('seasons Phase 2b: the harvest follows the farmers', () => {
  /** One person as the frame sends them: [id, workX, workY, colour, flags, mother, look, action, group]. */
  const person = (x: number, y: number, action: number): number[] => [1, x + 0.5, y + 0.5, 0, 2, 0, 0, action, 1];

  it('each autumn month a farmed field (and its farmland neighbours) is cut further; spring starts again', () => {
    const m = plantMap(Plant.Farmland, 0, 10, 6);
    m.plantType[0] = Plant.Grass;
    const f = new FieldState(10, 6);
    const farmer = new Float32Array([...person(1, 1, Action.Farm), ...person(8, 4, Action.Gather)]);
    const autumn = 6;
    expect(f.update(m, 100 * 12 + 5, farmer)).toEqual([]);             // summer: nothing
    let last = 0;
    for (let k = 0; k < 3; k++) {
      const changed = f.update(m, 100 * 12 + autumn + k, farmer);
      expect(f.cut[1 * 10 + 1]!).toBeGreaterThan(last);                  // the farmer's field, further each month
      expect(changed).toContain(1 * 10 + 1);
      expect(f.cut[0]).toBe(0);                                          // grass is never cut
      expect(f.cut[4 * 10 + 8]).toBe(0);                                 // a gatherer cuts nothing
      last = f.cut[1 * 10 + 1]!;
    }
    expect(f.cut[2 * 10 + 2]).toBe(last);                                // the plot round the farmer too
    expect(last).toBe(255);                                              // done within the autumn
    expect(f.update(m, 101 * 12, farmer)).toContain(1 * 10 + 1);         // spring: the year's harvest is over
    expect(f.cut[1 * 10 + 1]).toBe(0);
  });

  it('the cut edge only moves forward, row by row', () => {
    for (let ly = 0; ly < TILE; ly++) {
      let prev = 0;
      for (let c = 0; c <= 255; c += 5) {
        const n = rowCut(c, 3, 4, ly, TILE);
        expect(n).toBeGreaterThanOrEqual(prev);
        prev = n;
      }
      expect(rowCut(0, 3, 4, ly, TILE)).toBe(0);
      expect(rowCut(255, 3, 4, ly, TILE)).toBe(TILE);
    }
  });

  it('in autumn the cut part is stubble with sheaves standing in gold; by winter the field takes its winter stage', () => {
    const m = plantMap(Plant.Farmland, 0, 18, 12);
    const half = new Uint8Array(m.width * m.height).fill(128), done = new Uint8Array(m.width * m.height).fill(255);
    const { mat, hex } = fieldsIn(m, half, LookState.Autumn);
    let cut = 0, uncut = 0;
    for (let p = 0; p < hex.length; p++) {
      const f = fieldRoleParts(mat.role[p]!)!;
      if (f.sheaf) continue;
      if (f.cut) { cut++; expect(stageColours(Stage.Stubble).has(hex[p]!)).toBe(true); }
      else uncut++;
    }
    expect(cut).toBeGreaterThan(0.3 * hex.length);
    expect(uncut).toBeGreaterThan(0.3 * hex.length);
    const full = fieldsIn(m, done, LookState.Autumn);
    const sheaves = full.hex.filter((_h, p) => fieldRoleParts(full.mat.role[p]!)!.sheaf);
    expect(sheaves.length).toBeGreaterThan(50);
    expect(sheaves.every((h) => RAMP_HEX[Mat.Crop]!.includes(h))).toBe(true);
    const winter = fieldsIn(m, done, LookState.Winter);
    for (let p = 0; p < winter.hex.length; p++) {
      const x = p % winter.mat.w, y = Math.floor(p / winter.mat.w);
      expect(stageColours(stageOf(fieldClass(Math.floor(x / TILE), Math.floor(y / TILE)), 3)).has(winter.hex[p]!)).toBe(true);
    }
  });
});

// ---------- Phase 2c: snow by height, roofs and ice ----------

const SNW = CONFIG.render.seasons.snow;
const ICE = CONFIG.render.seasons.ice;

/** Draws `m` with its winter field and resolves it with every rank in `state` and these lines (0–255). */
function winterIn(m: MapData, state: number, snowLine: number, iceLine: number, ex: Partial<TileExtras> = {}): { mat: MatBuf; hex: string[]; field: WinterField } {
  const field = new WinterField(m.width, m.height);
  field.ensure(m);
  const mat = createMatBuf(m.width * TILE, m.height * TILE);
  const depth = new Uint8Array(m.width * m.height);
  computeDepth(m, depth);
  const imgW = m.width * TILE, data = new Uint8ClampedArray(imgW * m.height * TILE * 4);
  for (let i = 0; i < m.width * m.height; i++) {
    drawTilePixels(m, i, data, imgW, { waterStep: 0, riverStep: 0 }, { depth, crossing: null, ...none, mat, ponds: field.ponds, ...ex });
  }
  const look = createLook();
  look.shown.fill(state);
  look.cold = field.cold; look.ice = field.ice; look.snowLine = snowLine; look.iceLine = iceLine;
  const px = new Uint32Array(mat.w * mat.h);
  for (let ty = 0; ty < m.height; ty++) for (let tx = 0; tx < m.width; tx++) resolveTile(mat, look, px, tx, ty);
  return { mat, field, hex: Array.from(px, (v) => '#' + [v & 255, (v >> 8) & 255, (v >> 16) & 255].map((c) => c.toString(16).padStart(2, '0')).join('')) };
}

const snowColours = new Set<string>([...SEASON_HEX.snowFull, ...SEASON_HEX.snowDust]);
const iceColours = new Set<string>([...SEASON_HEX.ice, ...SEASON_HEX.iceRim]);

/** A 20 × 12 grass map with a hill in the east (height up to 9) and, if asked, water. */
function hillMap(water: 'none' | 'pond' | 'lake' | 'sea' = 'none'): MapData {
  const m = createMap(20, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) m.elevation[y * 20 + x] = Math.max(0, Math.min(9, x - 10));
  const wet = (x0: number, y0: number, x1: number, y1: number, sea = false): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * 20 + x; m.ground[i] = Ground.Water; if (sea) m.wall[i] = WallType.Sea; }
  };
  if (water === 'pond') wet(3, 4, 5, 6);
  if (water === 'lake') wet(1, 1, 8, 10);
  if (water === 'sea') wet(0, 0, 4, 11, true);
  return m;
}

describe('seasons Phase 2c: where snow lies first', () => {
  it('high ground and the north snow first; the order spreads evenly over the land; water never snows', () => {
    const f = new WinterField(20, 12);
    const m = hillMap('pond');
    f.ensure(m);
    const meanCold = (x0: number, x1: number, y0: number, y1: number): number => {
      let s = 0, n = 0;
      for (let y = y0 * TILE; y < y1 * TILE; y++) for (let x = x0 * TILE; x < x1 * TILE; x++) { const v = f.cold[y * f.pw + x]!; if (v !== NEVER) { s += v; n++; } }
      return s / n;
    };
    expect(meanCold(16, 20, 0, 12)).toBeLessThan(meanCold(8, 12, 0, 12));   // the hill before the plain
    const flat = new WinterField(20, 12); flat.ensure(createMap(20, 12));
    let north = 0, south = 0;
    for (let x = 0; x < flat.pw; x++) { north += flat.cold[2 * flat.pw + x]!; south += flat.cold[(flat.ph - 3) * flat.pw + x]!; }
    expect(north).toBeLessThan(south);
    // Water never snows; land shares are even (a line at 30% covers about 30% of the land).
    let land = 0, below = 0;
    for (let p = 0; p < f.cold.length; p++) {
      const water = m.ground[Math.floor(Math.floor(p / f.pw) / TILE) * 20 + Math.floor((p % f.pw) / TILE)] === Ground.Water;
      if (water) { expect(f.cold[p]).toBe(NEVER); continue; }
      land++;
      if (f.cold[p]! < 0.3 * 255) below++;
    }
    expect(below / land).toBeCloseTo(0.3, 1);
  });

  it('the snow line rises through the winter, deeper in a harsh one, and is gone once spring has passed', () => {
    let last = -1;
    for (let m = SNW.startMonth; m < 12; m += 0.1) { const [s] = coverLines(m, false); expect(s).toBeGreaterThanOrEqual(last); last = s; }
    expect(last).toBe(Math.round(SNW.cover * 255));
    expect(coverLines(0.5, false)[0]).toBe(last);                    // still lying where spring has not come
    expect(coverLines(5, false)).toEqual([0, 0]);                    // summer
    expect(coverLines(11.9, true)[0]).toBe(Math.round(SNW.harshCover * 255));
    let ice = -1;
    for (let m = ICE.startMonth; m < 12; m += 0.1) { const [, i] = coverLines(m, false); expect(i).toBeGreaterThanOrEqual(ice); ice = i; }
  });
});

describe('seasons Phase 2c: snow on the land', () => {
  it('in winter the snow covers the land below the line, a dusting just past it; never outside winter', () => {
    const m = hillMap();
    const covered = (state: number, line: number): number => winterIn(m, state, line, 0).hex.filter((h) => snowColours.has(h)).length / (m.width * m.height * 64);
    expect(covered(LookState.Winter, 0)).toBe(0);
    const third = covered(LookState.Winter, Math.round(0.33 * 255));
    expect(third).toBeGreaterThan(0.25);
    expect(third).toBeLessThan(0.5);
    expect(covered(LookState.Winter, 255)).toBeGreaterThan(0.9);
    expect(covered(LookState.Autumn, 255)).toBe(0);
    expect(covered(LookState.Held, 255)).toBe(0);
  });

  it('paths and roads stay dusted under deep snow; field ridges show through', () => {
    const t = allTilesMap();
    const { mat, hex } = winterIn(t.m, LookState.Winter, 255, 0, { marks: t.marks, hazards: t.hazards, look: t.look, base: t.base });
    const full = inRamp('snowFull'), dust = inRamp('snowDust');
    let marks = 0;
    for (let p = 0; p < hex.length; p++) {
      if (mat.role[p] === Role.Mark) { marks++; expect(full.has(hex[p]!) && !dust.has(hex[p]!)).toBe(false); }
    }
    expect(marks).toBeGreaterThan(20);
    const f = winterIn(plantMap(Plant.Farmland, 0), LookState.Winter, 255, 0, { fields: new Uint8Array(12 * 8) });
    let furrows = 0, ridges = 0;
    for (let p = 0; p < f.hex.length; p++) {
      const part = fieldRoleParts(f.mat.role[p]!);
      if (!part || part.sheaf) continue;
      if (part.pos === FieldPos.Furrow) { furrows++; expect(full.has(f.hex[p]!)).toBe(true); }
      else { ridges++; expect(snowColours.has(f.hex[p]!)).toBe(false); }
    }
    expect(furrows).toBeGreaterThan(100);
    expect(ridges).toBeGreaterThan(100);
  });

  it('an evergreen wears its snow cap only where the snow lies; a bare tree its snow on the branches', () => {
    const m = plantMap(Plant.Forest, 0, 20, 10);
    for (let y = 0; y < 10; y++) for (let x = 10; x < 20; x++) m.elevation[y * 20 + x] = 9;   // the east is high: it snows first
    const { mat, hex, field } = winterIn(m, LookState.Winter, Math.round(0.3 * 255), 0);
    let capSnow = 0, capBare = 0, branchSnow = 0;
    for (let p = 0; p < hex.length; p++) {
      const covered = field.cold[p]! < 0.3 * 255 - SNW.edgeShare * 255;
      const uncovered = field.cold[p]! > 0.3 * 255 + (SNW.dustShare + SNW.edgeShare) * 255;
      const white = SEASON_HEX.snowFull.includes(hex[p] as never);
      if (mat.role[p] === Role.CrownSnow) { if (covered) { expect(white).toBe(true); capSnow++; } if (uncovered) { expect(white).toBe(false); capBare++; } }
      if (mat.altRole[p] === Role.BranchSnow && isDeciduous(mat.role[p]!) && covered) { expect(white).toBe(true); branchSnow++; }
    }
    expect(capSnow).toBeGreaterThan(0);
    expect(capBare).toBeGreaterThan(0);
    expect(branchSnow).toBeGreaterThan(0);
  });
});

describe('seasons Phase 2c: ice', () => {
  it('a small pond freezes right through; a lake from its shore, its middle open; the sea never', () => {
    const pond = new WinterField(20, 12); pond.ensure(hillMap('pond'));
    const lake = new WinterField(20, 12); lake.ensure(hillMap('lake'));
    const sea = new WinterField(20, 12); sea.ensure(hillMap('sea'));
    const at = (f: WinterField, tx: number, ty: number, ox = 4, oy = 4): number => f.ice[(ty * TILE + oy) * f.pw + tx * TILE + ox]!;
    expect(pond.ponds[5 * 20 + 4]).toBe(1);
    expect(at(pond, 4, 5)).toBeLessThan(NEVER);                         // the pond's middle freezes
    expect(lake.ponds[5 * 20 + 4]).toBe(0);
    expect(at(lake, 1, 5, 0, 4)).toBeLessThan(at(lake, 2, 5, 0, 4));    // the shore before further in
    expect(at(lake, 4, 5)).toBe(NEVER);                                 // the middle stays open
    expect(at(sea, 2, 5, 7, 4)).toBe(NEVER);
    expect(at(sea, 4, 5, 7, 4)).toBe(NEVER);
  });

  it('as the ice line rises no water pixel thaws, the pond ends frozen, and the ice front is a darker line', () => {
    let prev = new Set<number>();
    for (const line of [40, 90, 140, 200, 255]) {
      const { mat, hex } = winterIn(hillMap('pond'), LookState.Winter, 0, line);
      const frozen = new Set<number>();
      for (let p = 0; p < hex.length; p++) if (isWaterRole(mat.role[p]!) && iceColours.has(hex[p]!)) frozen.add(p);
      for (const p of prev) expect(frozen.has(p)).toBe(true);
      prev = frozen;
    }
    const water = winterIn(hillMap('pond'), LookState.Winter, 0, 255);
    const pondPx = water.hex.filter((_h, p) => water.mat.role[p] === Role.Pond);
    expect(pondPx.length).toBeGreaterThan(0);
    expect(pondPx.every((h) => iceColours.has(h))).toBe(true);
    const lake = winterIn(hillMap('lake'), LookState.Winter, 0, 255);
    expect(lake.hex.filter((h) => h === SEASON_HEX.iceRim[1]).length).toBeGreaterThan(20);   // the front
    expect(lake.hex.some((h, p) => isWaterRole(lake.mat.role[p]!) && !iceColours.has(h))).toBe(true);   // open water left
    expect(winterIn(hillMap('pond'), LookState.Spring, 0, 255).hex.some((h) => iceColours.has(h))).toBe(false);
  });

  it('recolouring only the band a moved line crossed gives exactly the full recolour', () => {
    const m = hillMap('lake');
    clock = 0;
    const l = new TerrainLayer(m, true);
    l.setRain(m.rain);
    l.setLook(new Array<number>(KEYS).fill(LookState.Winter));
    l.flush();
    const inner = l as unknown as { mat: MatBuf; look: Parameters<typeof resolveTile>[1] };
    for (const [s, i] of [[40, 30], [90, 80], [160, 170], [255, 255], [120, 60], [0, 0], [70, 200]] as const) {
      l.setCover(s, i); l.flush();
      const ref = new Uint32Array(inner.mat.w * inner.mat.h);
      for (let ty = 0; ty < m.height; ty++) for (let tx = 0; tx < m.width; tx++) resolveTile(inner.mat, inner.look, ref, tx, ty);
      expect(fnv(imageOf(l)), `snow ${s} ice ${i}`).toBe(fnv(new Uint8ClampedArray(ref.buffer)));
    }
  });

  it('the terrain layer reports frozen tiles (boats keep off) and snow at a pixel (roofs)', () => {
    const m = hillMap('pond');
    clock = 0;
    const l = new TerrainLayer(m, true);
    l.setRain(m.rain);
    l.setLook(new Array<number>(KEYS).fill(LookState.Winter));
    l.setCover(255, 255);
    l.flush();
    expect(l.frozenTile(5 * 20 + 4)).toBe(true);
    expect(l.frozenTile(5 * 20 + 12)).toBe(false);                     // land
    expect(l.snowAt(18 * TILE + 3, 6 * TILE + 3)).toBe(true);
    l.setCover(0, 0); l.flush();
    expect(l.frozenTile(5 * 20 + 4)).toBe(false);
    expect(l.snowAt(18 * TILE + 3, 6 * TILE + 3)).toBe(false);
  });
});

// ---------- Phase 2d: ground ----------

const GD = CONFIG.render.seasons.ground;

describe('seasons Phase 2d: the ground through the year', () => {
  const flowers = new Set<string>([PALETTE.flowerWhite, PALETTE.fireYellow, PALETTE.fruit]);
  const litter = new Set<string>([SEASON_HEX.deciduousAuYellow[3]!, SEASON_HEX.deciduousAuYellow[2]!, SEASON_HEX.deciduousAuCopper[2]!]);
  const count = (hex: string[], set: Set<string>, where: (p: number) => boolean = () => true): number =>
    hex.reduce((n, h, p) => n + (set.has(h) && where(p) ? 1 : 0), 0);

  it('spring flowers grow in clusters on open grass, in the mockup share, and only in spring', () => {
    const m = plantMap(Plant.None, 0, 32, 24);
    const spring = drawIn(m, LookState.Spring);
    const blooms = spring.mat.role.reduce((n, r) => n + (r === GroundRole.Bloom ? 1 : 0), 0) / spring.mat.role.length;
    expect(blooms).toBeGreaterThan(0.01);
    expect(blooms).toBeLessThan(GD.flowerShare / 2);
    expect(count(spring.hex, new Set([PALETTE.flowerWhite]))).toBeGreaterThan(count(spring.hex, new Set([PALETTE.fireYellow])));
    // Clusters: the counts per 8 × 8 block vary far more than scattered flowers would (variance ÷
    // mean about 1 for a random scatter), and many blocks have none.
    const per: number[] = [];
    for (let by = 0; by < spring.mat.h; by += 8) {
      for (let bx = 0; bx < spring.mat.w; bx += 8) {
        let n = 0;
        for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) if (spring.mat.role[y * spring.mat.w + x] === GroundRole.Bloom) n++;
        per.push(n);
      }
    }
    const mean = per.reduce((t, n) => t + n, 0) / per.length;
    const variance = per.reduce((t, n) => t + (n - mean) ** 2, 0) / per.length;
    expect(variance / mean).toBeGreaterThan(2);
    expect(per.filter((n) => n === 0).length / per.length).toBeGreaterThan(0.4);
    for (const state of [LookState.Summer, LookState.Autumn, LookState.Winter, LookState.Held]) {
      expect(count(drawIn(m, state).hex, flowers), `state ${state}`).toBe(0);
    }
  });

  it('setup keeps today\'s look: the old grass flowers, none of the new clusters', () => {
    const m = plantMap(Plant.None, 0, 32, 24);
    const { mat, hex } = drawIn(m, LookState.Painted);
    let old = 0;
    for (let p = 0; p < hex.length; p++) {
      if (mat.role[p] === GroundRole.Bloom) expect(flowers.has(hex[p]!)).toBe(false);
      if (mat.role[p] === GroundRole.Flower) { old++; expect(flowers.has(hex[p]!)).toBe(true); }
    }
    expect(old).toBeGreaterThan(0);
  });

  it('the all-year grass flowers flower in spring only; the rest of the year the grass under them shows', () => {
    const m = plantMap(Plant.None, 0, 32, 24);
    const spring = drawIn(m, LookState.Spring), summer = drawIn(m, LookState.Summer);
    const grass = new Set<string>([...RAMP_HEX[Mat.Grass]!]);
    let n = 0;
    for (let p = 0; p < spring.hex.length; p++) {
      if (spring.mat.role[p] !== GroundRole.Flower) continue;
      n++;
      expect(flowers.has(spring.hex[p]!)).toBe(true);
      expect(spring.mat.altRole[p]).toBe(Role.Grass);
      expect(grass.has(summer.hex[p]!)).toBe(true);
    }
    expect(n).toBeGreaterThan(0);
  });

  it('autumn leaf litter lies on the forest floor and the grass next to it, not further out; none in summer', () => {
    // Forest in columns 0–5, open grass from column 6.
    const m = createMap(16, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) { m.plantType[y * 16 + x] = Plant.Forest; m.plantDensity[y * 16 + x] = 255; }
    const autumn = drawIn(m, LookState.Autumn), summer = drawIn(m, LookState.Summer);
    const col = (p: number): number => Math.floor((p % autumn.mat.w) / TILE);
    const isLitter = (p: number): boolean => autumn.mat.role[p]! >= GroundRole.LitterGold && autumn.mat.role[p]! <= GroundRole.LitterCopper;
    const floor = count(autumn.hex, litter, (p) => isLitter(p) && col(p) < 6);
    const edge = count(autumn.hex, litter, (p) => isLitter(p) && col(p) === 6);
    expect(floor).toBeGreaterThan(50);
    expect(edge).toBeGreaterThan(10);
    expect(autumn.mat.role.some((r, p) => col(p) >= 8 && r >= GroundRole.LitterGold && r <= GroundRole.LitterCopper)).toBe(false);
    for (let p = 0; p < summer.hex.length; p++) if (isLitter(p)) expect(litter.has(summer.hex[p]!)).toBe(false);
  });

  it('a high, evergreen wood drops almost no leaves', () => {
    const share = (elev: number): number => {
      const { mat } = drawIn(plantMap(Plant.Forest, elev), LookState.Autumn);
      return mat.role.reduce((n, r) => n + (r >= GroundRole.LitterGold && r <= GroundRole.LitterCopper ? 1 : 0), 0) / mat.role.length;
    };
    expect(share(0)).toBeGreaterThan(0.05);
    expect(share(9)).toBeLessThan(share(0) / 10);
  });

  it('high ground is drier: the dry grass ramp comes sooner as the land rises', () => {
    const cap = CONFIG.render.seasons.moisture.waterReachTiles + 1;
    expect(tileWetness(50, cap, 0.5, CONFIG.editor.maxElevation)).toBeCloseTo(tileWetness(50, cap, 0.5, 0) - GD.dryPerHeight);
    const dryShare = (elev: number): number => {
      const m = createMap(24, 16);
      m.rain.fill(50);
      m.elevation.fill(elev);
      const buf = createMatBuf(24 * TILE, 16 * TILE);
      new MoistureField(24, 16).update(m, m.rain, buf, () => {});
      return buf.moist.reduce((n, c) => n + (c === Moist.Dry ? 1 : 0), 0) / buf.moist.length;
    };
    expect(dryShare(0)).toBeLessThan(0.1);
    expect(dryShare(CONFIG.editor.maxElevation)).toBeGreaterThan(0.8);
  });
});

// ---------- Phase 3a: the season front ----------

const FCF = CONFIG.render.seasons.front;

/** A W × H grass map, flat or rising from west (0) to east (9). */
function frontMap(w: number, h: number, slope: boolean): MapData {
  const m = createMap(w, h);
  if (slope) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m.elevation[y * w + x] = Math.round((x / (w - 1)) * 9);
  return m;
}

function keysOf(m: MapData, kind: number, year = 0): { f: FrontFields; k: Uint8Array } {
  const f = new FrontFields(m.width, m.height);
  f.ensure(m);
  const k = new Uint8Array(f.pw * f.ph);
  f.keys(kind, year, k);
  return { f, k };
}

/** Separate 4-connected patches of pixels with key below `level`, of at least `min` pixels. */
function patches(k: Uint8Array, w: number, level: number, min: number): number {
  const seen = new Uint8Array(k.length);
  let n = 0;
  const stack: number[] = [];
  for (let p0 = 0; p0 < k.length; p0++) {
    if (seen[p0] || k[p0]! >= level) continue;
    let size = 0;
    seen[p0] = 1; stack.push(p0);
    while (stack.length > 0) {
      const p = stack.pop()!; size++;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= k.length || seen[q] || k[q]! >= level) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    if (size >= min) n++;
  }
  return n;
}

describe('seasons Phase 3a: the season front', () => {
  it('the front moves evenly over the land', () => {
    const { k } = keysOf(frontMap(64, 40, false), FrontKind.Warm);
    const share = (level: number): number => k.reduce((n, v) => n + (v < level ? 1 : 0), 0) / k.length;
    expect(share(64)).toBeCloseTo(0.25, 1);
    expect(share(128)).toBeCloseTo(0.5, 1);
    expect(share(192)).toBeCloseTo(0.75, 1);
    expect(share(256)).toBe(1);
  });

  it('on a flat map the front starts in several separate patches, not one band', () => {
    const m = frontMap(80, 45, false);
    for (const kind of [FrontKind.Warm, FrontKind.Autumn, FrontKind.Cold]) {
      const { f, k } = keysOf(m, kind);
      expect(patches(k, f.pw, Math.round(0.05 * 255), 20), `kind ${kind}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('the edge is never a straight line or a tile grid', () => {
    const { f, k } = keysOf(frontMap(64, 40, false), FrontKind.Warm);
    let longest = 0;
    for (let y = 0; y < f.ph - 1; y++) {
      let run = 0;
      for (let x = 0; x < f.pw; x++) {
        const p = y * f.pw + x;
        run = (k[p]! < 128) !== (k[p + f.pw]! < 128) ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
    }
    for (let x = 0; x < f.pw - 1; x++) {
      let run = 0;
      for (let y = 0; y < f.ph; y++) {
        const p = y * f.pw + x;
        run = (k[p]! < 128) !== (k[p + 1]! < 128) ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
    }
    expect(longest).toBeLessThan(2 * TILE);   // short runs where the dither lines up, never a line along the map
  });

  it('spring reaches low ground first; autumn and snow the heights first', () => {
    const m = frontMap(64, 40, true);
    const lowHigh = (kind: number): [number, number] => {
      const { f, k } = keysOf(m, kind);
      let lo = 0, hi = 0, nl = 0, nh = 0;
      for (let p = 0; p < k.length; p++) { if (p % f.pw < f.pw / 2) { lo += k[p]!; nl++; } else { hi += k[p]!; nh++; } }
      return [lo / nl, hi / nh];
    };
    const [wl, wh] = lowHigh(FrontKind.Warm);
    expect(wl).toBeLessThan(wh - 40);
    for (const kind of [FrontKind.Autumn, FrontKind.Cold]) {
      const [l, h] = lowHigh(kind);
      expect(h, `kind ${kind}`).toBeLessThan(l - 40);
    }
  });

  it('each year the front shifts a little in patches, never more than the configured jitter', () => {
    const m = frontMap(48, 30, false);
    const f = new FrontFields(m.width, m.height);
    f.ensure(m);
    const a = new Uint8Array(f.pw * f.ph), b = new Uint8Array(f.pw * f.ph);
    f.keys(FrontKind.Warm, 1, a);
    f.keys(FrontKind.Warm, 2, b);
    let differ = 0, most = 0;
    for (let p = 0; p < a.length; p++) { const d = Math.abs(a[p]! - b[p]!); if (d > 0) differ++; most = Math.max(most, d); }
    expect(differ / a.length).toBeGreaterThan(0.5);
    expect(most).toBeLessThanOrEqual(Math.ceil(FCF.yearJitter * 255) + 1);
  });
});

describe('seasons Phase 3a: the front on the terrain layer', () => {
  const states = (level: number, from: number, to: number): number[] => Array.from({ length: KEYS }, (_, r) => (r < level ? to : from));

  it('a front recolours each pixel once, and in place matches a fresh resolve', () => {
    const m = scenarioF().map;
    clock = 0;
    const l = new TerrainLayer(m, true);
    l.setRain(m.rain);
    l.setLook(states(0, LookState.Winter, LookState.Spring), FrontKind.Warm, 0);
    l.flush();
    let prev = new Uint32Array(imageOf(l).slice().buffer);
    const changes = new Uint8Array(prev.length);
    for (let level = 16; level <= KEYS; level += 16) {
      l.setLook(states(level, LookState.Winter, LookState.Spring), FrontKind.Warm, 0);
      l.flush();
      const now = new Uint32Array(imageOf(l).slice().buffer);
      for (let p = 0; p < now.length; p++) if (now[p] !== prev[p]) changes[p]!++;
      prev = now;
    }
    expect(changes.reduce((a, c) => Math.max(a, c), 0)).toBe(1);
    expect(changes.reduce((n, c) => n + c, 0)).toBeGreaterThan(changes.length / 2);
    // A new field at the start of the next front (every key one state) recolours nothing.
    l.setLook(states(0, LookState.Spring, LookState.Summer), FrontKind.Autumn, 0);
    l.flush();
    expect(fnv(imageOf(l))).toBe(fnv(new Uint8Array(prev.buffer)));
    // Mid-front, the image equals a resolve of every tile from the buffer.
    l.setLook(states(100, LookState.Spring, LookState.Summer), FrontKind.Autumn, 0);
    l.flush();
    const inner = l as unknown as { mat: MatBuf; look: Parameters<typeof resolveTile>[1] };
    const ref = new Uint32Array(inner.mat.w * inner.mat.h);
    for (let ty = 0; ty < m.height; ty++) for (let tx = 0; tx < m.width; tx++) resolveTile(inner.mat, inner.look, ref, tx, ty);
    expect(fnv(imageOf(l))).toBe(fnv(new Uint8ClampedArray(ref.buffer)));
  });

  it('a tree turns as one at the arrival of its centre, a field tile at that of its centre', () => {
    const m = scenarioA().map;
    for (let y = 40; y < 46; y++) for (let x = 100; x < 110; x++) { m.plantType[y * m.width + x] = Plant.Farmland; m.plantDensity[y * m.width + x] = 255; }
    clock = 0;
    const l = new TerrainLayer(m, true);
    l.fields = new Uint8Array(m.width * m.height);
    l.setLook(states(0, LookState.Winter, LookState.Spring), FrontKind.Warm, 0);
    l.flush();
    const { mat, keys } = l as unknown as { mat: MatBuf; keys: Uint8Array };
    const c = { x: 0, y: 0, r: 0, dx: 0, dy: 0, branch: 0 };
    let trees = 0, fields = 0;
    for (let ty = 0; ty < m.height; ty++) {
      for (let tx = 0; tx < m.width; tx++) {
        const i = ty * m.width + tx;
        if (m.plantType[i] === Plant.Forest && trees < 400) {
          buildCrowns(m, tx, ty);
          for (let y = ty * TILE; y < ty * TILE + TILE; y++) for (let x = tx * TILE; x < tx * TILE + TILE; x++) {
            const p = y * mat.w + x;
            if (!isCrown(mat.role[p]!) || !crownPixelAt(x, y, c)) continue;
            expect(mat.rank[p]).toBe(keys[c.y * mat.w + c.x]);
            trees++;
          }
        }
        if (m.plantType[i] === Plant.Farmland) {
          const centre = keys[(ty * TILE + TILE / 2) * mat.w + tx * TILE + TILE / 2];
          for (let y = ty * TILE; y < ty * TILE + TILE; y++) for (let x = tx * TILE; x < tx * TILE + TILE; x++) {
            const p = y * mat.w + x;
            if (!fieldRoleParts(mat.role[p]!)) continue;
            expect(mat.rank[p]).toBe(centre);
            fields++;
          }
        }
      }
    }
    expect(trees).toBeGreaterThan(100);
    expect(fields).toBeGreaterThan(50);
  });

  it('snow lies first where the cold front came first', () => {
    const m = frontMap(64, 40, true);
    clock = 0;
    const l = new TerrainLayer(m, true);
    const inner = l as unknown as { winter: WinterField; fronts: FrontFields };
    expect(inner.fronts.isReady).toBe(false);   // setup never waits for the fields
    l.setLook(new Array<number>(KEYS).fill(LookState.Winter), FrontKind.Cold, 0);
    expect(inner.fronts.isReady).toBe(true);
    let diff = 0, n = 0;
    for (let p = 0; p < inner.winter.cold.length; p++) {
      if (inner.winter.cold[p] === NEVER) continue;
      diff += Math.abs(inner.winter.cold[p]! / 255 - inner.fronts.coldShare[p]!); n++;
    }
    expect(diff / n).toBeLessThan(0.01);
  });
});

// ---------- Phase 3b: a speed for watching the seasons ----------

describe('seasons Phase 3b: a speed for watching the seasons', () => {
  it('at Watch a spring front takes 3 s and a year 24 s of real time (S1)', () => {
    const fr = CONFIG.render.seasons.fronts;
    expect(fr[0]!.months / ticksPerSecondAt(-1)).toBeCloseTo(3, 9);
    expect(CONFIG.time.ticksPerYear / ticksPerSecondAt(-1)).toBeCloseTo(24, 9);
  });

  it('at Walk two looks a year: green from the spring front, winter from the winter front (S3)', () => {
    const fr = CONFIG.render.seasons.fronts;
    expect(twoLooksAt(fr[0]!.start)).toEqual({ from: LookState.Winter, to: LookState.Summer, level: 0, kind: FrontKind.Warm });
    expect(twoLooksAt(6.5)).toEqual({ from: LookState.Winter, to: LookState.Summer, level: KEYS, kind: FrontKind.Warm });
    expect(twoLooksAt(fr[3]!.start)).toEqual({ from: LookState.Summer, to: LookState.Winter, level: 0, kind: FrontKind.Cold });
    expect(twoLooksAt(11.99).level).toBe(KEYS);
    const d = new SeasonDriver(null);
    const changes = new Array<number>(KEYS).fill(0);
    const seen = new Set<number>();
    let prev = Array.from(d.update(0, 0, 'two', true, true));
    for (let t = 0.01; t < 24; t += 0.01) {
      const now = Array.from(d.update(t * 1000, t % 12, 'two', true, false));
      now.forEach((s, r) => { seen.add(s); if (s !== prev[r]) changes[r]!++; });
      prev = now;
    }
    expect([...seen].sort()).toEqual([LookState.Summer, LookState.Winter].sort());
    expect(changes).toEqual(new Array(KEYS).fill(4));   // two changes a year, each key once per front
  });

  it('at Watch the day stops in daylight, and a night ends quickly instead of popping (S2)', () => {
    const L = CONFIG.render.f8.light;
    const dn = new DayNight();
    dn.update(0, true);
    expect(dn.darkness).toBe(0);                       // it starts in the morning
    dn.hold = true;
    for (let k = 0; k < 600; k++) dn.update(100, true);
    expect(dn.darkness).toBe(0);                       // a minute of Watch: still day
    // Into the night at a normal speed, then Watch: dark at first, light within a night ÷ holdCatchUp.
    dn.hold = false;
    let ms = 0;
    while (dn.darkness < 1 && ms < L.dayMs) { dn.update(100, true); ms += 100; }
    expect(dn.darkness).toBe(1);
    dn.hold = true;
    let steps = 0, biggest = 0, before = dn.darkness;
    while (dn.darkness > 0 && steps < 1000) { dn.update(1000 / 60, true); biggest = Math.max(biggest, Math.abs(dn.darkness - before)); before = dn.darkness; steps++; }
    expect(dn.darkness).toBe(0);
    expect((steps * 1000) / 60).toBeLessThan(((L.nightShare + 2 * L.dusk) * L.dayMs) / L.holdCatchUp + 100);
    expect(biggest).toBeLessThan(0.1);                 // a gradual dawn, not a pop
  });
});

// ---------- Phase 4: the fast-forward look ----------

describe('seasons Phase 4: the held fast-forward look', () => {
  /** Plays `years` of screen time at Fly (8 years a second, 60 frames a second) through a HeldRain; returns the lowest rain shown. */
  function playFly(h: HeldRain, rain: (year: number) => number, years: number, t0: number): { low: number; t: number } {
    const n = h.shown.length, now = new Uint8Array(n);
    let low = 255, t = t0, ms = 0;
    const perFrame = (ticksPerSecondAt(8) / 60);
    while (t < t0 + years * 12) {
      t += perFrame; ms += 1000 / 60;
      now.fill(rain(Math.floor(t / 12)));
      h.update(now, t, ms);
      low = Math.min(low, h.shown[0]!);
    }
    return { low, t };
  }

  it('a single dry year at Fly does not reach the screen; a drought of three years does', () => {
    const wet = 60, dry = 24;   // a strong drought: 40% of the usual rain
    const one = new HeldRain(new Uint8Array(4).fill(wet));
    const a = playFly(one, (y) => (y === 5 ? dry : wet), 12, 0);
    expect(a.low).toBeGreaterThan(wet * CONFIG.render.f8.weather.droughtBelow + 4);   // no cracks, the grass about normal
    const three = new HeldRain(new Uint8Array(4).fill(wet));
    const b = playFly(three, (y) => (y >= 5 && y < 8 ? dry : wet), 12, 0);
    expect(b.low).toBeLessThan(wet * CONFIG.render.f8.weather.droughtBelow);          // cracks and dry ramps show
    expect(three.shown[0]).toBeGreaterThan(50);              // and the land recovers after it
  });

  it('the year note: drought or wet when enough of the land is, on the average', () => {
    const base = new Uint8Array(10).fill(50);
    const land = (): boolean => true;
    const h = new HeldRain(base);
    expect(h.note(base, land)).toBeNull();
    h.snap(Array.from({ length: 10 }, (_, i) => (i < 3 ? 20 : 50)), 0);   // 30% far drier than painted
    expect(h.note(base, land)).toBe('drought');
    h.snap(Array.from({ length: 10 }, (_, i) => (i < 2 ? 20 : 50)), 0);   // 20%: below the share
    expect(h.note(base, land)).toBeNull();
    h.snap(new Uint8Array(10).fill(80), 0);
    expect(h.note(base, land)).toBe('wet');
  });

  it('the held look keeps the grass moisture: summer ramps by class (mockup D: dry grass breaks through)', () => {
    for (let s = 0; s < 5; s++) {
      expect(rgbOf(lookColour(LookState.Held, Moist.Dry, Role.Grass, stepTag(Mat.Grass, s)))).toBe(SEASON_HEX.grassSuDry[s]);
      expect(rgbOf(lookColour(LookState.Held, Moist.Lush, Role.Grass, stepTag(Mat.Grass, s)))).toBe(SEASON_HEX.grassSuLush[s]);
      expect(rgbOf(lookColour(LookState.Held, Moist.Normal, Role.Grass, stepTag(Mat.Grass, s)))).toBe(RAMP_HEX[Mat.Grass]![s]);
    }
  });

  it('the bar names the held season, summer', () => {
    expect(yearLabel(1240, 10, true)).toBe('Year 1,240 · Summer');
    expect(yearLabel(1240, 10)).toBe('Year 1,240 · Winter');
  });
});

// ---------- Phase 5: clouds ----------

describe('seasons Phase 5: pixel clouds', () => {
  it('a cloud is a cluster of discs: a core inside its rim; the body lit top-left, dark underneath (mockup)', () => {
    const c = makeCloud(12, 1, false);
    let core = 0, rim = 0;
    for (let k = 0; k < c.mask.length; k++) { const m = c.mask[k]!; if (m & Mask.Core) core++; else if (m & Mask.In) rim++; }
    expect(core).toBeGreaterThan(300);
    expect(rim).toBeGreaterThan(100);
    // The top row of the cloud is its lit rim (step 4); the bottom row its underside (step 1).
    const rows: number[][] = [];
    for (let ly = 0; ly < c.h; ly++) for (let lx = 0; lx < c.w; lx++) {
      const s = bodyStep(c, lx, ly, false);
      if (s >= 0) (rows[ly] ??= []).push(s);
    }
    const filled = rows.map((r, y) => [y, r] as const).filter(([, r]) => r && r.length > 0);
    expect(filled[0]![1].every((s) => s === 4)).toBe(true);
    expect(filled[filled.length - 1]![1].every((s) => s === 1 || s === 4)).toBe(true);
    expect(makeCloud(12, 1, false).mask).toEqual(c.mask);   // the same seed, the same cloud
  });

  it('wetter land carries more and bigger clouds', () => {
    expect(cloudiness(10).share).toBeLessThan(cloudiness(50).share);
    expect(cloudiness(50).share).toBeLessThan(cloudiness(90).share);
    expect(cloudiness(10).size).toBeLessThan(cloudiness(90).size);
    const count = (rain: number): number => {
      let n = 0;
      for (let pass = 0; pass < 20; pass++) {
        const s = new Clouds(1280, 720, null);
        s.update(pass * 1000, () => rain);
        n += s.now.length;
      }
      return n;
    };
    expect(count(90)).toBeGreaterThan(count(10) * 2);
  });

  it('clouds drift with the wind in whole pixels and keep their shape while they cross', () => {
    const s = new Clouds(1280, 720, 'clouds');
    s.update(0, () => 50);
    const first = s.now.map((c) => ({ ...c }));
    s.update(1, () => 50);
    for (const c of s.now) {
      expect(Number.isInteger(c.x) && Number.isInteger(c.y)).toBe(true);
      const was = first.find((f) => f.shape === c.shape);
      if (was) { expect(c.y).toBe(was.y); expect(c.x - was.x).toBeGreaterThanOrEqual(CONFIG.render.f8.weather.windPxPerS - 1); }
    }
    expect(s.now.some((c) => first.some((f) => f.shape === c.shape))).toBe(true);
  });

  it('a shadow steps colours down their own ramp; the darkest step and accents stay', () => {
    const word = (hex: string): number => { const [r, g, b] = hexRgb(hex); return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; };
    const grass = RAMP_HEX[Mat.Grass]!;
    expect(shadeWord(word(grass[3]!), 1)).toBe(word(grass[2]!));
    expect(shadeWord(word(grass[3]!), 2)).toBe(word(grass[1]!));
    expect(shadeWord(word(grass[0]!), 2)).toBe(word(grass[0]!));
    expect(shadeWord(word(SEASON_HEX.grassSpLush[4]), 1)).toBe(word(SEASON_HEX.grassSpLush[3]));
    expect(shadeWord(word(PALETTE.flowerWhite), 2)).toBe(word(PALETTE.flowerWhite));
  });

  it('as a cloud crosses, each ground pixel changes only as an edge passes, and the image equals a fresh resolve', () => {
    const m = scenarioA().map;
    clock = 0;
    const l = new TerrainLayer(m, true);
    l.setRain(m.rain);
    l.setLook(new Array<number>(KEYS).fill(LookState.Summer));
    l.flush();
    const shape = makeCloud(5, 1, false);
    const [ox, oy] = CONFIG.render.seasons.clouds.shadowOffsetPx;
    const w = m.width * TILE, y0 = 300;
    /** The shadow's ramp-step drop at (x, y) with the cloud at cx (the mockup's rim and core on the world checker). */
    const level = (cx: number, x: number, y: number): number => {
      const lx = x - (cx + shape.ox + ox!), ly = y - (y0 + shape.oy + oy!);
      if (lx < 0 || ly < 0 || lx >= shape.w || ly >= shape.h) return 0;
      const mk = shape.mask[ly * shape.w + lx], odd = (x + y) & 1;
      return mk! & Mask.Core ? 1 + odd : mk! & Mask.In ? odd : 0;
    };
    let prev = new Uint32Array(imageOf(l).slice().buffer);
    let changed = 0;
    for (let x = 200; x < 200 + shape.w + 4; x++) {
      l.setClouds([{ shape, x, y: y0 }], false);
      l.flush();
      const now = new Uint32Array(imageOf(l).slice().buffer);
      for (let p = 0; p < now.length; p++) {
        const px = p % w, py = (p - px) / w;
        const moved = x > 200 ? level(x - 1, px, py) !== level(x, px, py) : level(x, px, py) !== 0;
        // A pixel changes only where its drop changed (an edge passed it); never inside a shadow or outside one.
        if (now[p] !== prev[p]) { expect(moved, `pixel ${px},${py} at step ${x}`).toBe(true); changed++; }
      }
      prev = now;
    }
    expect(changed).toBeGreaterThan(shape.w);
    const inner = l as unknown as { mat: MatBuf; look: Parameters<typeof resolveTile>[1] };
    const ref = new Uint32Array(inner.mat.w * inner.mat.h);
    for (let ty = 0; ty < m.height; ty++) for (let tx = 0; tx < m.width; tx++) resolveTile(inner.mat, inner.look, ref, tx, ty);
    expect(fnv(imageOf(l))).toBe(fnv(new Uint8ClampedArray(ref.buffer)));
    // Gone again: the ground as before the cloud came.
    l.setClouds([], false); l.flush();
    l.setLook(new Array<number>(KEYS).fill(LookState.Summer)); l.flush();
    const clear = new TerrainLayer(m, true);
    clear.setRain(m.rain); clear.setLook(new Array<number>(KEYS).fill(LookState.Summer)); clear.flush();
    expect(fnv(imageOf(l))).toBe(fnv(imageOf(clear)));
  });

  it('a storm lays a world-fixed checker one step down over the land', () => {
    const m = scenarioA().map;
    clock = 0;
    const l = new TerrainLayer(m, true);
    l.setRain(m.rain);
    l.setLook(new Array<number>(KEYS).fill(LookState.Summer));
    l.flush();
    const before = new Uint32Array(imageOf(l).slice().buffer);
    l.setClouds([], true); l.flush();
    const after = new Uint32Array(imageOf(l).slice().buffer);
    const w = m.width * TILE;
    let evenChanged = 0, oddChanged = 0;
    for (let p = 0; p < after.length; p++) {
      if (after[p] === before[p]) continue;
      if ((((p % w) + Math.floor(p / w)) & 1) === 1) oddChanged++; else evenChanged++;
    }
    expect(evenChanged).toBe(0);
    expect(oddChanged).toBeGreaterThan(after.length / 4);
  });
});

// ---------- Phase 6: rain and snowfall ----------

describe('seasons Phase 6: rain and snowfall', () => {
  const RNC = CONFIG.render.seasons.rain;
  /** A weather with a forced sky, its clouds placed. */
  function forcedWeather(kind: 'rain' | 'snowfall' | 'storm'): Weather {
    const m = createMap(160, 90);
    const w = new Weather(m);
    (w as unknown as { sky: Clouds }).sky = new Clouds(160 * TILE, 90 * TILE, kind);
    w.update(0, 16, { x: 0, y: 0, w: 1280, h: 720 }, 0, true);
    return w;
  }
  const view = { x: 0, y: 0, w: 1280, h: 720 };
  const lit = (out: number[][]): Set<number> => {
    const s = new Set<number>();
    for (const pts of out) for (let k = 0; k < pts.length; k += 2) s.add(pts[k + 1]! * 10000 + pts[k]!);
    return s;
  };

  it('rain plays in frames: the same three frames over and over, no pixel flashing more than three times a second', () => {
    const w = forcedWeather('rain');
    const n = Math.round(1000 / RNC.frameMs);   // the frames in a second
    const frames = Array.from({ length: n }, (_, f) => lit(w.precipPixels(view, f, () => Fall.Rain)));
    expect(frames[0]!.size).toBeGreaterThan(200);
    expect([...frames[3]!].sort()).toEqual([...frames[0]!].sort());   // a 3-frame cycle
    // A flash: lit, then unlit the next frame (a pixel two drops keep lit is steady, not flashing).
    const all = new Set<number>(frames.flatMap((f) => [...f]));
    let most = 0;
    for (const p of all) {
      let flashes = 0;
      for (let f = 0; f < n; f++) if (frames[f]!.has(p) && !frames[(f + 1) % n]!.has(p)) flashes++;
      most = Math.max(most, flashes);
    }
    expect(most).toBeLessThanOrEqual(3);
    // Rain on the two rain steps only; flakes on the two light steps only.
    const raw = w.precipPixels(view, 0, () => Fall.Rain);
    expect(raw[3]!.length + raw[4]!.length).toBe(0);
    const snow = forcedWeather('snowfall').precipPixels(view, 0, () => Fall.Snow);
    expect(snow[0]!.length + snow[1]!.length).toBe(0);
    expect(snow[4]!.length).toBeGreaterThan(100);
  });

  it('a flake steps down two pixels a frame; nothing falls on frozen water', () => {
    const w = forcedWeather('rain');
    const a = w.precipPixels(view, 0, () => Fall.Snow)[4]!, b = w.precipPixels(view, 3, () => Fall.Snow)[4]!;
    expect(a).toEqual(b);
    expect(w.precipPixels(view, 0, () => Fall.None).every((pts) => pts.length === 0)).toBe(true);
  });

  it('a storm rains everywhere, thinned evenly when zoomed out, never under a cloud body', () => {
    const w = forcedWeather('storm');
    const out = w.precipPixels(view, 0, () => Fall.Rain);
    const sky = (w as unknown as { sky: Clouds }).sky;
    let top = 0, bottom = 0;
    for (let k = 0; k < out[1]!.length; k += 2) { if (out[1]![k + 1]! < 360) top++; else bottom++; }
    expect(bottom).toBeGreaterThan(top / 2);                 // not cut off part of the way down
    expect(top + bottom).toBeLessThanOrEqual(RNC.maxParticles * 3);
    // The spots: each streak's lead pixel (step 1 in frames 0 and 1 of its cycle) is never under a body.
    expect(sky.now.length).toBeGreaterThan(0);
    const leads = w.precipPixels(view, 0, () => Fall.Rain)[1]!;
    let under = 0;
    for (let k = 0; k < leads.length; k += 2) if (sky.covers(leads[k]!, leads[k + 1]!)) under++;
    expect(under).toBeLessThan(leads.length / 2 / 10);   // splash pixels sit beside their spot and may touch a body's edge
  });

  it('at the held speeds nothing falls', () => {
    const w = forcedWeather('rain');
    w.falling = false;
    let drawn = 0;
    const ctx = { drawImage: () => { drawn++; } } as unknown as CanvasRenderingContext2D;
    w.drawPrecip(ctx, view, 0, 0, () => Fall.Rain);
    expect(drawn).toBe(0);
  });

  it('a raining cloud wets the land a step darker and puddles stand in it; not at the held speeds, not in winter', () => {
    const m = scenarioA().map;
    clock = 0;
    const l = new TerrainLayer(m, true);
    l.setRain(m.rain);
    l.setLook(new Array<number>(KEYS).fill(LookState.Summer));
    l.flush();
    const shade = (): Uint8Array => (l as unknown as { shade: Uint8Array }).shade;
    const shape = makeCloud(9, 1.2, false, true);
    const cloud = [{ shape, x: 900, y: 300 }];
    l.setClouds(cloud, false, true); l.flush();
    const s = shade();
    const puddles = s.reduce((n, v) => n + (v === PUDDLE_LIGHT || v === PUDDLE_DARK ? 1 : 0), 0);
    const dry = makeCloud(9, 1.2, false, false);
    const l2 = new TerrainLayer(m, true);
    l2.setRain(m.rain); l2.setLook(new Array<number>(KEYS).fill(LookState.Summer)); l2.flush();
    l2.setClouds([{ shape: dry, x: 900, y: 300 }], false, true); l2.flush();
    const s2 = (l2 as unknown as { shade: Uint8Array }).shade;
    const darker = (a: Uint8Array): number => a.reduce((n, v) => n + (v > 0 && v < 16 ? v : 0), 0);
    expect(puddles).toBeGreaterThan(10);
    expect(darker(s)).toBeGreaterThan(darker(s2));           // wet ground: more steps down than the shadow alone
    l.setClouds(cloud, false, false); l.flush();              // held: rain stops wetting
    expect(shade().some((v) => v >= 16)).toBe(false);
    expect(darker(shade())).toBe(darker(s2));
    l.setClouds(cloud, false, true); l.flush();
    l.setLook(new Array<number>(KEYS).fill(LookState.Winter)); l.flush();
    l.setClouds([{ shape, x: 901, y: 300 }], false, true); l.flush();
    expect(shade().some((v) => v >= 16)).toBe(false);         // winter: no puddles
  });
});
