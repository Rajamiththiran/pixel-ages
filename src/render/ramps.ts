// Toy Diorama colour ramps (docs/diorama-plan/01-ramps.md). Values are the design system's
// tokens, copied from docs/mockups/Pixel Ages UI mockups/_ds/…/tokens/world.css and colors.css.
// Every material has five steps, 0 deep shade … 4 top light: shades shift cool, lights shift
// warm. Shading moves a colour along its ramp instead of multiplying it (readme: "Shade cool,
// light warm. Never multiply to darken; take the ramp step").

import { CONFIG } from '../config';
import type { RGB } from './palette';

const DR = CONFIG.render.diorama;

export const Mat = {
  Grass: 0, Forest: 1, Water: 2, Sand: 3, Stone: 4, Clay: 5, Mudbrick: 6, Wood: 7, Crop: 8, Snow: 9,
} as const;
export type Mat = (typeof Mat)[keyof typeof Mat];

/**
 * Day ramps, by Mat, darkest first. Crop has three tones plus a furrow and a lit ridge; ordered by
 * lightness they make its five steps (furrow, crop-0, crop-1, ridge, crop-2). Snow has three.
 */
export const RAMP_HEX: readonly (readonly string[])[] = [
  ['#3e593c', '#4c743c', '#5a8f3c', '#7da146', '#a1b350'], // grass
  ['#233a31', '#294a2d', '#2f5a2a', '#5b7435', '#868e3f'], // forest
  ['#183460', '#213c72', '#2c5d8f', '#4a87aa', '#82c4d6'], // water
  ['#91786e', '#b89e7c', '#e0c48a', '#eace90', '#f4d896'], // sand
  ['#55506c', '#6a6779', '#7f7f86', '#9b938c', '#b8a792'], // stone
  ['#6d3d3b', '#894d3b', '#a65e3a', '#bb7744', '#d0904e'], // clay
  ['#835850', '#a67255', '#c98d5a', '#d79f62', '#e6b16b'], // mudbrick
  ['#4a3133', '#5c3d31', '#6e4a2e', '#8e6638', '#ad8243'], // wood
  ['#68492f', '#c4a846', '#d6b651', '#debe57', '#e8c45c'], // crop: furrow, 0, 1, ridge, 2
  ['#9a92b2', '#c4c2d3', '#eef2f4'],                       // snow
];

/** Night ramps (world.css [data-theme="night"]), same layout. Used from phase 4. */
export const NIGHT_HEX: readonly (readonly string[])[] = [
  ['#162441', '#192b41', '#1c3241', '#233645', '#2a3b4a'],
  ['#111d3d', '#12213b', '#13253a', '#1c2b3e', '#253242'],
  ['#0f1b50', '#111d58', '#132564', '#19306f', '#243f82'],
  ['#272c56', '#2f365c', '#373f62', '#394264', '#3b4467'],
  ['#1b2255', '#1f285b', '#232e60', '#293363', '#2f3865'],
  ['#201d41', '#252141', '#2b2640', '#2f2c45', '#343249'],
  ['#24244a', '#2b2b4c', '#32314e', '#353651', '#383a55'],
  ['#191a3d', '#1c1d3d', '#20213b', '#262840', '#2d2f44'],
  ['#1f203c', '#313845', '#353c4a', '#363e4d', '#383f4f'],
  ['#293373', '#313f81', '#3a4b8e'],
];

/** Lineage shades (colors.css --lin-N-shade) for the default lineage colours. */
const LINEAGE_SHADE: Record<string, string> = {
  '#d94f4f': '#98384a', '#4f7fd9': '#3b57a9', '#e0b030': '#9d7634', '#9b59d0': '#6e3ea3', '#39b6a6': '#2c7a86',
  '#e07b2f': '#9d5433', '#e05fa0': '#9d4282', '#6fcf4f': '#508a4a', '#f2f2f2': '#a9a1bb', '#45c4e0': '#3483ae',
};

// ---------- switches ----------

/** An effect turned off in the URL (`?off=ramps,dither`), for comparing looks without editing config. */
export function styleOff(name: string): boolean {
  if (typeof location === 'undefined') return false;
  const off = new URLSearchParams(location.search).get('off');
  return off !== null && off.split(',').includes(name);
}

/** Phase 1 switch: read once at load, since terrain constants are built from it. */
export const rampsOn: boolean = DR.ramps.on && !styleOff('ramps');

// ---------- colours ----------

export function hexRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const toHex = (c: RGB): string => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** The design system's shade colour: cool and darker (pixel-scenes.js shadowOf; ramp step 0 = shadowOf(step 2)). */
export function shadowOf(c: RGB): RGB {
  const m = DR.shadeMul, a = DR.shadeAdd;
  return [c[0] * m[0]! + a[0]!, c[1] * m[1]! + a[1]!, c[2] * m[2]! + a[2]!];
}

/**
 * A lineage colour's shade: the token for the default set; for colours without a token (the
 * colour-blind set) the formula the tokens follow, mix(c, shadowOf(c), 0.85) (DECISIONS 23.2).
 */
export function lineageShade(hex: string): string {
  const t = LINEAGE_SHADE[hex.toLowerCase()];
  if (t) return t;
  const c = hexRgb(hex), s = shadowOf(c), k = DR.lineageShadeMix;
  return toHex([c[0] + (s[0] - c[0]) * k, c[1] + (s[1] - c[1]) * k, c[2] + (s[2] - c[2]) * k]);
}

// ---------- groups and tags ----------
// Every terrain colour belongs to a group: a ramp (several steps) or an accent (one colour that
// never shades: ink, fruit, flowers, flames, ores). A tag = group × 8 + step, found by exact RGB,
// so the shading helpers can move a colour along its own ramp.

const groups: RGB[][] = RAMP_HEX.map((r) => r.map(hexRgb));
const tags = new Map<number, number>();

const pack = (c: RGB): number => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);

for (let g = 0; g < groups.length; g++) groups[g]!.forEach((c, s) => tags.set(pack(c), g * 8 + s));

/** The RGB of ramp `mat` at `step`. */
export function rampRgb(mat: Mat, step: number): RGB {
  const r = groups[mat]!;
  return r[Math.max(0, Math.min(r.length - 1, step))]!;
}

/** Makes a classic palette colour stand for a ramp step (grass-light → grass-4, …). */
export function alias(c: RGB, mat: Mat, step: number): void {
  const k = pack(c);
  if (!tags.has(k)) tags.set(k, mat * 8 + step);
}

/** Registers a colour that never shades. */
export function accent(c: RGB): void {
  const k = pack(c);
  if (tags.has(k)) return;
  groups.push([[c[0], c[1], c[2]]]);
  tags.set(k, (groups.length - 1) * 8);
}

function put(c: RGB, out: RGB): void { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; }

const dist2 = (a: RGB, b: RGB): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Nearest tag among `gs` (all groups when empty). */
function nearest(c: RGB, gs: readonly number[]): number {
  let best = 0, bestD = Infinity;
  const scan = (g: number): void => {
    groups[g]!.forEach((col, s) => {
      const d = dist2(c, col);
      if (d < bestD) { bestD = d; best = g * 8 + s; }
    });
  };
  if (gs.length === 0) for (let g = 0; g < groups.length; g++) scan(g);
  else for (const g of gs) scan(g);
  return best;
}

const snapCache = new Map<number, number>();

/** The colour's tag; an unknown colour snaps to the nearest tagged one (cached). */
function tagOf(c: RGB): number {
  const k = pack(c);
  const t = tags.get(k);
  if (t !== undefined) return t;
  let s = snapCache.get(k);
  if (s === undefined) { s = nearest(c, []); snapCache.set(k, s); }
  return s;
}

const colourOf = (tag: number): RGB => groups[tag >> 3]![tag & 7]!;

/** Moves `out` `steps` along its ramp (accents stay as they are). */
export function rampShift(out: RGB, steps: number): void {
  const t = tagOf(out);
  const r = groups[t >> 3]!;
  put(r[Math.max(0, Math.min(r.length - 1, (t & 7) + steps))]!, out);
}

const mixCache = new Map<number, number>();

/**
 * Blend `t` of the way from a to b, on the ramps: within one ramp, the step in between; across
 * materials (grass into forest floor, sand into road), the nearest step of either ramp to the
 * blended colour. Writes a ramp or accent colour, never one in between.
 */
export function rampMix(a: RGB, b: RGB, t: number, out: RGB): void {
  const ta = tagOf(a), tb = tagOf(b);
  const k = Math.max(0, Math.min(1, t));
  const ga = ta >> 3, gb = tb >> 3;
  if (ga === gb) {
    const s = Math.round((ta & 7) + ((tb & 7) - (ta & 7)) * k);
    put(groups[ga]![s]!, out);
    return;
  }
  const key = (ta * 1024 + tb) * 256 + Math.round(k * 255);
  let m = mixCache.get(key);
  if (m === undefined) {
    const ca = colourOf(ta), cb = colourOf(tb);
    m = nearest([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k], [ga, gb]);
    mixCache.set(key, m);
  }
  put(colourOf(m), out);
}

/** Steps between two colours of the same ramp (0 when they are on different ramps or the same step). */
export function rampSpan(a: RGB, b: RGB): number {
  const ta = tagOf(a), tb = tagOf(b);
  return ta >> 3 === tb >> 3 ? Math.abs((tb & 7) - (ta & 7)) : 0;
}

/** The final colour of a pixel: its ramp colour (a classic palette colour turns into its step). */
export function rampFinal(out: RGB): void {
  put(colourOf(tagOf(out)), out);
}

/**
 * rampFinal that also returns the pixel's tag (group × 8 + step): what the material buffer stores
 * (seasons plan Phase 1a), so a colour can be picked later from (material, step).
 */
export function rampTag(out: RGB): number {
  const t = tagOf(out);
  put(colourOf(t), out);
  return t;
}

/** The colour of a tag. */
export const tagRgb = (tag: number): RGB => colourOf(tag);

/** One more than the highest tag in use (tags = group × 8 + step). */
export const tagCount = (): number => groups.length * 8;

/** Is this tag a real step of a group (not a gap after a group's last step)? */
export const tagValid = (tag: number): boolean => (tag >> 3) < groups.length && (tag & 7) < groups[tag >> 3]!.length;

/** Every colour a Diorama terrain pixel may have (for the palette audit). */
export function rampColours(): RGB[] {
  return groups.flat();
}
