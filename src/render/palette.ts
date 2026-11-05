// Colours (§18.1).

import { CONFIG } from '../config';
import { Mat, accent, alias, lineageShade, rampsOn, RAMP_HEX } from './ramps';

export const PALETTE = {
  ink: '#1c1a24',
  darkWood: '#3e2b22',
  wood: '#6e4a2e',
  clay: '#a65e3a',
  mudBrick: '#c98d5a',
  sand: '#e0c48a',
  skinLight: '#f0c8a0',
  skinMid: '#c98f62',
  skinDark: '#8c5a3a',
  forest: '#2f5a2a',
  grass: '#5a8f3c',
  grassLight: '#8cb84e',
  water: '#2c5d8f',
  waterLight: '#5d9cc9',
  stone: '#7f7f86',
  stoneLight: '#b5b5ae',
  // accents
  copper: '#d07a2c',
  iron: '#6b3a3a',
  tin: '#c3c9d1',                // F1: pale silver ore
  salt: '#f3efe2',               // F1: white salt crust
  fruit: '#b8323a',
  fireOrange: '#e8833a',
  fireYellow: '#f4d35e',
  deepWater: '#1f4570',
  mountainDark: '#4a4a52',
  fruitBush: '#4f8a38',          // §18.3 fruit-bush blend colour
  foam: '#d6e8ef',               // shoreline foam
  snow: '#eef2f4',               // mountain peaks
  flowerWhite: '#f4f1e8',        // grass flowers
  frost: '#c9d6df',              // F8: winter frost on low land
  mud: '#5a4632',                // F8: silt left by a flood, river banks
  night: '#0b1030',              // F8: night tint
  sick: '#8fbf3a',               // F8: disease tint over sick villages
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Lineage colours: the default set, and a colour-blind-safe set (Okabe–Ito plus Tol), F8 §14.7. */
const DEFAULT_LINEAGE = ['#d94f4f', '#4f7fd9', '#e0b030', '#9b59d0', '#39b6a6', '#e07b2f', '#e05fa0', '#6fcf4f', '#f2f2f2', '#45c4e0'];
const DEFAULT_NAMES = ['Red', 'Blue', 'Yellow', 'Purple', 'Teal', 'Orange', 'Pink', 'Lime', 'White', 'Cyan'];
const SAFE_LINEAGE = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#f2f2f2', '#999999', '#aa4499'];
const SAFE_NAMES = ['Orange', 'Sky blue', 'Green', 'Yellow', 'Blue', 'Vermilion', 'Pink', 'White', 'Grey', 'Purple'];

/**
 * Lineage (group) colours, in order. Changed in place by usePalette, so every reader sees the
 * current set; colour indices (what runs store) stay the same.
 */
export const GROUP_COLORS: string[] = [...DEFAULT_LINEAGE];
export const GROUP_COLOR_NAMES: string[] = [...DEFAULT_NAMES];

export type LineagePalette = 'default' | 'colourBlind';
let current: LineagePalette = 'default';
export const currentPalette = (): LineagePalette => current;

/** Switches the lineage colours. Callers redraw whatever cached the old colours. */
export function usePalette(p: LineagePalette): void {
  current = p;
  GROUP_COLORS.splice(0, GROUP_COLORS.length, ...(p === 'colourBlind' ? SAFE_LINEAGE : DEFAULT_LINEAGE));
  GROUP_COLOR_NAMES.splice(0, GROUP_COLOR_NAMES.length, ...(p === 'colourBlind' ? SAFE_NAMES : DEFAULT_NAMES));
}

export const SKIN_COLORS = [PALETTE.skinLight, PALETTE.skinMid, PALETTE.skinDark] as const;
export const HAIR_COLORS = [PALETTE.ink, PALETTE.darkWood, PALETTE.wood] as const;
export const ELDER_HAIR = PALETTE.stoneLight;

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/**
 * The dark variant D of a lineage colour: the design system's lineage shade (Diorama look), or
 * each channel × 0.7 (classic look, or any other multiplier).
 */
export function darken(hex: string, mult: number = CONFIG.render.darkColorMult): string {
  if (rampsOn && mult === CONFIG.render.darkColorMult) return lineageShade(hex);
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([Math.round(r * mult), Math.round(g * mult), Math.round(b * mult)]);
}

/** RGB triples for every palette key, for fast per-pixel terrain work. */
export const RGBS: Record<PaletteKey, RGB> = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, hexToRgb(v)]),
) as Record<PaletteKey, RGB>;

/**
 * Diorama look (phase 1): the ramp step each classic palette colour stands for. Colours the
 * design system gives no ramp (ink, ores, flowers, flames, fruit, foam…) are accents: they never
 * shade. Nearest token, except grass-light (grass-3: the mockup blends lush grass at most 60%
 * toward it, and step 4 stays the highlight), deep water (water-0, the mockup's deep colour) and
 * the mud of banks and silt (wood-1). DECISIONS 23.1.
 */
const RAMP_OF: Partial<Record<PaletteKey, readonly [Mat, number]>> = {
  grass: [Mat.Grass, 2], grassLight: [Mat.Grass, 3], fruitBush: [Mat.Grass, 1],
  forest: [Mat.Forest, 2],
  water: [Mat.Water, 2], waterLight: [Mat.Water, 4], deepWater: [Mat.Water, 0],
  sand: [Mat.Sand, 2],
  stone: [Mat.Stone, 2], stoneLight: [Mat.Stone, 4], mountainDark: [Mat.Stone, 0],
  clay: [Mat.Clay, 2], mudBrick: [Mat.Mudbrick, 2],
  wood: [Mat.Wood, 2], darkWood: [Mat.Wood, 0], mud: [Mat.Wood, 1],
  snow: [Mat.Snow, 2],
};

for (const key of Object.keys(PALETTE) as PaletteKey[]) {
  const r = RAMP_OF[key];
  if (r) alias(RGBS[key], r[0], r[1]);
  else accent(RGBS[key]);
}

/** A palette colour as drawn: its ramp step in the Diorama look, else the classic colour (sprites). */
export function worldHex(key: PaletteKey): string {
  const r = RAMP_OF[key];
  return rampsOn && r ? RAMP_HEX[r[0]]![r[1]]! : PALETTE[key];
}
