// Colours (§18.1).

import { CONFIG } from '../config';

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
  fruit: '#b8323a',
  fireOrange: '#e8833a',
  fireYellow: '#f4d35e',
  deepWater: '#1f4570',
  mountainDark: '#4a4a52',
  fruitBush: '#4f8a38',          // §18.3 fruit-bush blend colour
  foam: '#d6e8ef',               // shoreline foam
  snow: '#eef2f4',               // mountain peaks
  flowerWhite: '#f4f1e8',        // grass flowers
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Lineage (group) colours, in order. */
export const GROUP_COLORS = [
  '#d94f4f', '#4f7fd9', '#e0b030', '#9b59d0', '#39b6a6',
  '#e07b2f', '#e05fa0', '#6fcf4f', '#f2f2f2', '#45c4e0',
] as const;
export const GROUP_COLOR_NAMES = [
  'Red', 'Blue', 'Yellow', 'Purple', 'Teal', 'Orange', 'Pink', 'Lime', 'White', 'Cyan',
] as const;

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

/** The dark variant D of a lineage colour: each channel × 0.7. */
export function darken(hex: string, mult: number = CONFIG.render.darkColorMult): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([Math.round(r * mult), Math.round(g * mult), Math.round(b * mult)]);
}

/** RGB triples for every palette key, for fast per-pixel terrain work. */
export const RGBS: Record<PaletteKey, RGB> = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, hexToRgb(v)]),
) as Record<PaletteKey, RGB>;
