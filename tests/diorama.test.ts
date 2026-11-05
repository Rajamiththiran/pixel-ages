// Toy Diorama look, phase 1 (docs/diorama-plan/01-ramps.md): colour ramps and shading.
// The design system is in docs/mockups/Pixel Ages UI mockups/_ds/ (readme.md, tokens/*.css).

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Ground, Plant, Resource, WallType } from '../src/shared/ids';
import { HazardMark, Look, Mark } from '../src/shared/protocol';
import { createMap } from '../src/editor/mapState';
import { Mat, NIGHT_HEX, RAMP_HEX, hexRgb, lineageShade, rampColours, rampsOn, shadowOf } from '../src/render/ramps';
import { darken, GROUP_COLORS, usePalette } from '../src/render/palette';
import { drawTilePixels } from '../src/render/terrain';
import { computeDepth } from '../src/render/terrainDetail';
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
