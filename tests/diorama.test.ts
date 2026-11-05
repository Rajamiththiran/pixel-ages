// Toy Diorama look (docs/diorama-plan): phase 1 colour ramps and shading, phase 2 dither, phase 3 shadows, phase 4 night.
// The design system is in docs/mockups/Pixel Ages UI mockups/_ds/ (readme.md, tokens/*.css).

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Ground, Plant, Resource, WallType } from '../src/shared/ids';
import { HazardMark, Look, Mark } from '../src/shared/protocol';
import { createMap } from '../src/editor/mapState';
import { Mat, NIGHT_HEX, RAMP_HEX, hexRgb, lineageShade, rampColours, rampsOn, shadowOf } from '../src/render/ramps';
import { darken, GROUP_COLORS, usePalette } from '../src/render/palette';
import { drawTilePixels } from '../src/render/terrain';
import { computeDepth, forestCrown } from '../src/render/terrainDetail';
import { castMultiplyAdd, castOf, shadowStrength, spriteShadow } from '../src/render/shadows';
import { buildCrowns, canopyDistance, crownColourAt } from '../src/render/crowns';
import { lightBand, nightLevel, nightMultiplyAdd, nightOf } from '../src/render/light';
import { bayer, ditherPixel, mixGrad, valueNoise } from '../src/render/dither';
import { stippleCells, stippleCounts, TintClass } from '../src/render/season';
import { scenarioA } from './fixtures';

// Node's fs, loaded at run time: the project has no Node typings, and Vitest blanks CSS imports.
interface Fs { readFileSync(p: URL, enc: 'utf8'): string; readdirSync(p: URL): string[] }
const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as Fs;
const DS = new URL('../docs/mockups/Pixel%20Ages%20UI%20mockups/_ds/', import.meta.url);
const dsDir = new URL(fs.readdirSync(DS).find((d) => d.startsWith('pixel-ages-design-system'))! + '/', DS);

/** `--name: #hex` pairs of one CSS block (the part before `[data-theme="night"]`, or after it). */
function tokens(file: string, night = false): Record<string, string> {
  const css = fs.readFileSync(new URL('tokens/' + file, dsDir), 'utf8');
  const split = css.lastIndexOf('[data-theme="night"]');   // the first mention is in the header comment
  const part = split < 0 ? css : night ? css.slice(split) : css.slice(0, split);
  const out: Record<string, string> = {};
  for (const m of part.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}

const NAMES = ['grass', 'forest', 'water', 'sand', 'stone', 'clay', 'mudbrick', 'wood', 'crop', 'snow'];
const tokenRamp = (t: Record<string, string>, name: string): string[] =>
  name === 'crop' ? [t['world-crop-furrow']!, t['world-crop-0']!, t['world-crop-1']!, t['world-crop-ridge']!, t['world-crop-2']!]
    : [0, 1, 2, 3, 4].map((s) => t[`world-${name}-${s}`]).filter((v): v is string => v !== undefined);

describe('Diorama ramps are the design system tokens', () => {
  it('day and night ramps equal tokens/world.css', () => {
    const day = tokens('world.css'), night = tokens('world.css', true);
    NAMES.forEach((name, k) => {
      expect(RAMP_HEX[k], name).toEqual(tokenRamp(day, name));
      expect(NIGHT_HEX[k], `${name} night`).toEqual(tokenRamp(night, name));
    });
  });

  it('lineage shades equal tokens/colors.css, and follow the shade formula', () => {
    const t = tokens('colors.css');
    for (let n = 1; n <= 10; n++) {
      const hex = t[`lin-${n}`]!;
      expect(lineageShade(hex), `lin-${n}`).toBe(t[`lin-${n}-shade`]);
      // The formula the tokens follow, used for the colour-blind set (DECISIONS 23.2), within rounding.
      const c = hexRgb(hex), s = shadowOf(c), k = CONFIG.render.diorama.lineageShadeMix;
      const f = c.map((v, i) => v + (s[i]! - v) * k);
      hexRgb(t[`lin-${n}-shade`]!).forEach((v, i) => expect(Math.abs(v - f[i]!)).toBeLessThanOrEqual(1));
    }
  });

  it('a ramp step 0 is the shade formula of its step 2 (grass, forest, sand, stone, wood)', () => {
    for (const m of [Mat.Grass, Mat.Forest, Mat.Sand, Mat.Stone, Mat.Wood]) {
      const s = shadowOf(hexRgb(RAMP_HEX[m]![2]!));
      hexRgb(RAMP_HEX[m]![0]!).forEach((v, i) => expect(Math.abs(v - s[i]!)).toBeLessThanOrEqual(1));
    }
  });

  it('lineage dark variants use the shade tokens, colour-blind ones the formula', () => {
    expect(rampsOn).toBe(true);
    expect(darken('#d94f4f')).toBe('#98384a');
    usePalette('colourBlind');
    try {
      for (const c of GROUP_COLORS) expect(darken(c)).toMatch(/^#[0-9a-f]{6}$/);
      expect(darken(GROUP_COLORS[0]!)).not.toBe(GROUP_COLORS[0]);
    } finally { usePalette('default'); }
    // Any other multiplier is still a plain multiply.
    expect(darken('#646464', 0.5)).toBe('#323232');
  });
});

/** A small map with every ground, plant, wall, ore, hill, mark, hazard and look. */
function testMap() {
  const W = 40, H = 24, m = createMap(W, H);
  const n = W * H;
  const marks = new Uint8Array(n), hazards = new Uint8Array(n), look = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const band = Math.floor(x / 5);
      m.ground[i] = [Ground.Grassland, Ground.Desert, Ground.Grassland, Ground.Water, Ground.Mountain, Ground.Grassland, Ground.Grassland, Ground.Desert][band]!;
      if (band === 0) { m.plantType[i] = Plant.Forest; m.plantDensity[i] = (y * 11) % 256; }
      if (band === 2) { m.plantType[i] = [Plant.Grass, Plant.FruitBushes, Plant.Farmland][y % 3]!; m.plantDensity[i] = 40 + y * 9; }
      if (band === 5) { m.plantType[i] = Plant.Farmland; marks[i] = y % 2 ? Mark.Terrace : Mark.Road; look[i] = (y % 4) << Look.wornShift | ((y >> 2) % 4) << Look.saltShift; }
      if (band === 6) { marks[i] = [Mark.Path, Mark.Ash, Mark.Ruin, Mark.Quarry, Mark.Canal][y % 5]!; if (y % 7 === 0) hazards[i] = HazardMark.Fire; if (y % 5 === 1) look[i] = 2 << Look.ashShift | (y % 3 ? Look.Silt : 0); }
      if (band === 7 && y < 8) m.wall[i] = [WallType.River, WallType.Mountain, WallType.Sea][x % 3]!;
      if (x % 6 === 1 && y % 4 === 1) { m.resourceType[i] = 1 + ((x + y) % 6) as Resource; m.resourceAmount[i] = 200; }
      m.elevation[i] = Math.max(0, Math.min(9, Math.round(9 - Math.hypot(x - 20, y - 12) / 1.5)));
    }
  }
  return { m, marks, hazards, look, base: createMap(W, H) };
}

function render(m: ReturnType<typeof createMap>, ex: Parameters<typeof drawTilePixels>[5]): Uint8ClampedArray {
  const imgW = m.width * CONFIG.map.tilePx;
  const data = new Uint8ClampedArray(imgW * m.height * CONFIG.map.tilePx * 4);
  for (let i = 0; i < m.width * m.height; i++) drawTilePixels(m, i, data, imgW, { waterStep: 3, riverStep: 5 }, ex);
  return data;
}

function offRamp(data: Uint8ClampedArray): string[] {
  const ok = new Set(rampColours().map(([r, g, b]) => (r << 16) | (g << 8) | b));
  const bad = new Set<string>();
  for (let o = 0; o < data.length; o += 4) {
    const k = (data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!;
    if (!ok.has(k)) bad.add('#' + k.toString(16).padStart(6, '0'));
  }
  return [...bad];
}

describe('palette audit: every terrain pixel is a ramp or accent colour', () => {
  it('a map with every kind of tile, mark, hazard and hill', () => {
    const { m, marks, hazards, look, base } = testMap();
    const depth = new Uint8Array(m.width * m.height);
    computeDepth(m, depth);
    const data = render(m, { depth, crossing: null, marks, hazards, look, base });
    expect(offRamp(data)).toEqual([]);
  });

  it('Scenario A as painted', () => {
    const m = scenarioA().map;
    const depth = new Uint8Array(m.width * m.height);
    computeDepth(m, depth);
    const data = render(m, { depth, crossing: null, marks: null, hazards: null, look: null, base: null });
    expect(offRamp(data)).toEqual([]);
  });

  it('shading moves along the ramp: a hill side facing the light is lighter grass, the far side darker', () => {
    const W = 12, H = 3, m = createMap(W, H);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) m.elevation[y * W + x] = x < 6 ? x * 2 : (11 - x) * 2;
    const depth = new Uint8Array(W * H);
    const data = render(m, { depth, crossing: null, marks: null, hazards: null, look: null, base: null });
    const at = (px: number, py: number): string => {
      const o = (py * W * 8 + px) * 4;
      return '#' + [data[o]!, data[o + 1]!, data[o + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('');
    };
    const grass = RAMP_HEX[Mat.Grass]!;
    // Rising to the east, the slope faces the top-left sun: lighter. Falling to the east: darker.
    expect(grass.indexOf(at(20, 12))).toBeGreaterThan(2);
    expect(grass.indexOf(at(76, 12))).toBeLessThan(2);
  });
});

// ---------- phase 2: dither (docs/diorama-plan/02-dither.md) ----------

describe('Diorama dither (phase 2)', () => {
  it('the Bayer thresholds are the 16 levels of a 4×4 ordered matrix, repeating every 4 px', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      seen.add(bayer(x, y));
      expect(bayer(x + 4, y + 8)).toBe(bayer(x, y));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, k) => (k + 0.5) / 16));
  });

  it('value noise is 0–1, smooth, and fixed per world pixel', () => {
    let maxJump = 0;
    for (let x = 0; x < 400; x++) {
      const n = valueNoise(x, 37);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      maxJump = Math.max(maxJump, Math.abs(valueNoise(x + 1, 37) - n));
      expect(valueNoise(x, 37)).toBe(n);
    }
    expect(maxJump).toBeLessThan(0.35);   // clusters, not grain
  });

  it('tiles redraw identically in any order (no state leaks from one pixel to the next)', () => {
    const { m, marks, hazards, look, base } = testMap();
    const depth = new Uint8Array(m.width * m.height);
    computeDepth(m, depth);
    const ex = { depth, crossing: null, marks, hazards, look, base };
    const imgW = m.width * 8, n = m.width * m.height;
    const a = new Uint8ClampedArray(imgW * m.height * 8 * 4), b = new Uint8ClampedArray(a.length);
    for (let i = 0; i < n; i++) drawTilePixels(m, i, a, imgW, { waterStep: 1, riverStep: 1 }, ex);
    for (let i = n - 1; i >= 0; i--) drawTilePixels(m, i, b, imgW, { waterStep: 1, riverStep: 1 }, ex);
    let diff = 0;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
    expect(diff).toBe(0);
  });

  it('flat grass shows clustered texture of neighbouring ramp steps, never other colours', () => {
    const W = 20, H = 12, m = createMap(W, H);
    const data = render(m, { depth: new Uint8Array(W * H), crossing: null, marks: null, hazards: null, look: null, base: null });
    const count = new Map<string, number>();
    for (let o = 0; o < data.length; o += 4) {
      const k = '#' + [data[o]!, data[o + 1]!, data[o + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('');
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    const g = RAMP_HEX[Mat.Grass]!;
    expect(count.get(g[2]!)! / (data.length / 4)).toBeGreaterThan(0.5);   // mostly the base step
    expect(count.get(g[1]!) ?? 0).toBeGreaterThan(0);                      // darker clusters
    expect(count.get(g[3]!) ?? 0).toBeGreaterThan(0);                      // lighter clusters (and blades)
    const flowers = ['#f4d35e', '#f4f1e8', '#b8323a'];
    for (const k of count.keys()) expect([...g, ...flowers]).toContain(k);
  });

  it('a gradient blend dithers between the two nearest steps in the right share', () => {
    const g0 = hexRgb(RAMP_HEX[Mat.Grass]![0]!), g2 = hexRgb(RAMP_HEX[Mat.Grass]![2]!);
    const out: [number, number, number] = [0, 0, 0];
    let sum = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      ditherPixel(x, y);
      mixGrad(g2, g0, 0.3, out);                     // 30% of the way from step 2 to step 0 = step 1.4
      const step = RAMP_HEX[Mat.Grass]!.indexOf('#' + out.map((v) => v.toString(16).padStart(2, '0')).join(''));
      expect([1, 2]).toContain(step);
      sum += step;
    }
    expect(sum / 16).toBeCloseTo(1.4, 1);
  });

  it('season stipple: each season covers its share of the 16 cells, spread out, growing only by adding cells', () => {
    let prev = stippleCells([0, 0, 0, 0]);
    for (let n = 1; n <= 16; n++) {
      const c = stippleCells([n, 0, 0, 0]);
      expect(c.filter((s) => s === 0).length).toBe(n);
      for (let k = 0; k < 16; k++) if (prev[k] === 0) expect(c[k]).toBe(0);
      prev = c;
    }
    // Half coverage is a checkerboard-like spread: every 2×2 block has two covered cells.
    const half = stippleCells([8, 0, 0, 0]);
    for (const [x, y] of [[0, 0], [2, 0], [0, 2], [2, 2]] as const) {
      expect([half[y * 4 + x], half[y * 4 + x + 1], half[(y + 1) * 4 + x], half[(y + 1) * 4 + x + 1]].filter((s) => s === 0).length).toBe(2);
    }
    // Two seasons share without overlapping.
    const mixed = stippleCells([5, 4, 0, 0]);
    expect(mixed.filter((s) => s === 0).length).toBe(5);
    expect(mixed.filter((s) => s === 1).length).toBe(4);
    // Up to half coverage the stipple only uses cells the ground texture never moves (Bayer
    // threshold above its strongest share), so tint dots and texture don't cover each other.
    const share = CONFIG.render.diorama.dither.stepShare;
    stippleCells([8, 0, 0, 0]).forEach((s, k) => { if (s === 0) expect(bayer(k & 3, k >> 2)).toBeGreaterThan(share); });
    // Counts follow weight × the class's tint strength (farmland in summer: 0.55 → 9 of 16 cells).
    expect(stippleCounts(TintClass.Farm, [0, 1, 0, 0])).toEqual([0, 9, 0, 0]);
    expect(stippleCounts(TintClass.None, [1, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });
});

// ---------- phase 3: shadows (docs/diorama-plan/03-shadows.md) ----------

describe('Diorama shadows (phase 3)', () => {
  it('the cast colour is the --cast-* tokens, and the GPU multiply + add gives the same', () => {
    const t = tokens('world.css');
    const pairs: Array<[string, string]> = [['world-grass-2', 'cast-grass'], ['world-sand-2', 'cast-sand'], ['world-crop-1', 'cast-crop'], ['world-stone-2', 'cast-stone']];
    const { mul, add } = castMultiplyAdd(CONFIG.render.diorama.shadows.strength);
    for (const [ground, cast] of pairs) {
      const c = hexRgb(t[ground]!), want = hexRgb(t[cast]!), got = castOf(c);
      got.forEach((v, i) => expect(Math.abs(v - want[i]!), `${cast}`).toBeLessThanOrEqual(0.5));
      // GPU: multiply by the rounded colour, then add the rounded colour, within 1 of the token.
      c.forEach((v, i) => expect(Math.abs(Math.round(v * Math.round(mul[i]!) / 255) + Math.round(add[i]!) - want[i]!)).toBeLessThanOrEqual(1));
    }
  });

  it('sun shadows are day only: full by day, stepping down over dusk, none at night', () => {
    const S = CONFIG.render.diorama.shadows.strength, n = CONFIG.render.diorama.duskSteps;
    expect(shadowStrength(0)).toBe(S);
    expect(shadowStrength(1)).toBe(0);
    const seen = new Set<number>();
    for (let d = 0; d <= 1; d += 0.01) seen.add(shadowStrength(d));
    expect(seen.size).toBe(n + 1);                                  // stepped, not smooth
    for (let d = 0.01; d < 1; d += 0.01) expect(shadowStrength(d)).toBeLessThan(S);
  });

  it('a sprite casts down-right at 0.45 px per px of height, with a contact line under its footprint', () => {
    const w = 2, h = 6;
    const sh = spriteShadow({ w, h, data: new Uint32Array(w * h).fill(0xff0000ff) });
    const pts = (a: Int16Array): Array<[number, number]> => Array.from({ length: a.length / 2 }, (_, k) => [a[k * 2]!, a[k * 2 + 1]!]);
    const cast = pts(sh.cast);
    for (const [x, y] of cast) { expect(y).toBeGreaterThanOrEqual(h - 1); expect(x).toBeGreaterThanOrEqual(0); }
    // The top pixel is 5 px up: its shadow lands round(5 × 0.45) = 2 px right and down of the foot.
    expect(cast).toContainEqual([1 + 2, h - 1 + 2]);
    expect(Math.max(...cast.map(([x]) => x))).toBe(3);
    expect(pts(sh.contact).sort()).toEqual([[1, h], [2, h]]);
  });

  it('the crown field draws exactly the crowns forestCrown draws', () => {
    const W = 12, H = 8, m = createMap(W, H);
    for (let i = 0; i < W * H; i++) if ((i % W) > 2 && (i % W) < 9) { m.plantType[i] = Plant.Forest; m.plantDensity[i] = (i * 37) % 256; }
    const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0];
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        buildCrowns(m, tx, ty);
        for (let py = ty * 8; py < ty * 8 + 8; py++) {
          for (let px = tx * 8; px < tx * 8 + 8; px++) {
            const fa = crownColourAt(px, py, a), fb = forestCrown(m, px, py, b);
            expect(fa).toBe(fb);
            if (fa) expect(a).toEqual(b);
          }
        }
      }
    }
  });

  it('trees and peaks cast down-right only, never onto the crowns or peaks themselves', () => {
    const W = 12, H = 10, m = createMap(W, H);
    const forest = (x: number, y: number): boolean => x >= 3 && x <= 4 && y >= 3 && y <= 4;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (forest(x, y)) { m.plantType[y * W + x] = Plant.Forest; m.plantDensity[y * W + x] = 255; }
      if (x >= 8 && y >= 2 && y <= 6) m.ground[y * W + x] = Ground.Mountain;
    }
    const imgW = W * 8, shadow = new Uint8ClampedArray(imgW * H * 8 * 4);
    const data = render(m, { depth: new Uint8Array(W * H), crossing: null, marks: null, hazards: null, look: null, base: null, shadow });
    let treeShade = 0, peakShade = 0;
    for (let py = 0; py < H * 8; py++) {
      for (let px = 0; px < imgW; px++) {
        if (shadow[(py * imgW + px) * 4 + 3] !== 255) continue;
        const tx = px >> 3, ty = py >> 3;
        if (tx >= 7) { peakShade++; continue; }
        treeShade++;
        // Tree shadows lie on or down-right of the wood, never above or left of it.
        expect(tx >= 3 && ty >= 3 && tx <= 5 && ty <= 5, `(${px}, ${py})`).toBe(true);
      }
    }
    expect(treeShade).toBeGreaterThan(20);
    expect(peakShade).toBeGreaterThan(20);
    expect(data.length).toBe(shadow.length);
  });

  it('the canopy edge: ground right of or below a crown knows how far the crown is', () => {
    const W = 6, H = 4, m = createMap(W, H);
    for (let y = 0; y < H; y++) { m.plantType[y * W + 2] = Plant.Forest; m.plantDensity[y * W + 2] = 255; }
    buildCrowns(m, 3, 1);
    const c: [number, number, number] = [0, 0, 0];
    // Walk right from the forest along a row until a pixel without a crown: the next ones are 1, 2, 3 px off.
    let found = false;
    for (let py = 8; py < 16 && !found; py++) {
      let x = 3 * 8;
      while (x < 3 * 8 + 8 && crownColourAt(x, py, c)) x++;
      if (x >= 3 * 8 + 4 || x === 3 * 8) continue;
      if (crownColourAt(x - 1, py, c) && !crownColourAt(x, py - 1, c)) {
        expect(canopyDistance(x, py)).toBe(1);
        found = true;
      }
    }
    expect(found).toBe(true);
    expect(canopyDistance(3 * 8 + 7, 1 * 8 + 7) === 0 || canopyDistance(3 * 8 + 7, 1 * 8 + 7) <= 3).toBe(true);
  });
});

// ---------- phase 4: night (docs/diorama-plan/04-night.md) ----------

describe('Diorama night (phase 4)', () => {
  it('night(c) is the Night tokens for every ramp colour, on the CPU and as the GPU multiply + add', () => {
    const { mul, add } = nightMultiplyAdd(1);
    RAMP_HEX.forEach((ramp, m) => ramp.forEach((hex, s) => {
      const c = hexRgb(hex), want = hexRgb(NIGHT_HEX[m]![s]!);
      nightOf(c).forEach((v, i) => expect(Math.abs(v - want[i]!), `${hex}`).toBeLessThanOrEqual(0.5));
      c.forEach((v, i) => expect(Math.abs(Math.round(v * Math.round(mul[i]!) / 255) + Math.round(add[i]!) - want[i]!), `${hex} GPU`).toBeLessThanOrEqual(1));
    }));
  });

  it('by day the pass changes nothing; dusk and dawn move in whole steps', () => {
    const day = nightMultiplyAdd(0);
    expect(day.mul).toEqual([255, 255, 255]);
    expect(day.add).toEqual([0, 0, 0]);
    expect(nightLevel(0)).toBe(0);
    expect(nightLevel(1)).toBe(1);
    const seen = new Set<number>();
    for (let d = 0; d <= 1; d += 0.01) seen.add(nightLevel(d));
    expect(seen.size).toBe(CONFIG.render.diorama.duskSteps + 1);
    // Shadows fade on exactly the same steps (phase 3).
    for (let d = 0; d <= 1; d += 0.05) expect(shadowStrength(d)).toBeCloseTo(CONFIG.render.diorama.shadows.strength * (1 - nightLevel(d)));
  });

  it('firelight comes in 3 bands, dithered at their edges, in proportion to the light', () => {
    const bands = CONFIG.render.diorama.night.bands;
    expect(bands).toBe(3);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      expect(lightBand(0, x, y)).toBe(0);
      expect(lightBand(1, x, y)).toBe(bands);
      expect(lightBand(5, x, y)).toBe(bands);
    }
    let prev = 0;
    for (const light of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      let sum = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += lightBand(light, x, y);
      const mean = sum / 16;
      expect(mean).toBeCloseTo(light * bands, 0);              // the dither keeps the average
      expect(mean).toBeGreaterThanOrEqual(prev);
      prev = mean;
    }
  });

  it('the lit colour is the owner rule: day × (1.10, 0.90, 0.66)', () => {
    expect(CONFIG.render.diorama.night.litMul).toEqual([1.10, 0.90, 0.66]);
  });
});
