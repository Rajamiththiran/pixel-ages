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

/**
 * Seasonal ramps (seasons plan Phase 1b), copied from the seasons mockup (docs/mockups/Seasons and
 * Weather UI mockups-handoff/…/seasons-render.js, section A). Five steps each, darkest first.
 * Built by the mockup's rule from one base colour (its step 2): step 0 = shadowOf(step 2), step 1
 * halfway, step 4 a warm light (281, 235, 105) mixed in at 0.372, step 3 halfway (checked in
 * tests/seasons.test.ts); the snow, water and ice ramps are the mockup's own lists. Summer-normal
 * grass, summer evergreen, summer sand, stone, summer water, gold crops and bare deciduous wood are
 * the system ramps above. Night colours come from night(c), as for every colour.
 */
export const SEASON_HEX = {
  grassSpLush: ['#3b6341', '#488142', '#55a043', '#79ae4a', '#9ebc51'],
  grassSpNormal: ['#435f3e', '#537c3f', '#63993f', '#85a847', '#a7b84f'],
  grassSpDry: ['#555f43', '#6a7d44', '#7f9a46', '#9ca94d', '#b8b853'],
  grassSuLush: ['#355c3f', '#41783f', '#4c9440', '#72a448', '#98b44f'],
  grassSuDry: ['#675b45', '#817647', '#9c9249', '#b3a34f', '#cbb355'],
  grassAuLush: ['#48563c', '#59703c', '#6a8a3c', '#8b9c44', '#abae4d'],
  grassAuNormal: ['#55553e', '#6b6e3f', '#80883f', '#9c9a47', '#b9ad4f'],
  grassAuDry: ['#6a5545', '#866f48', '#a2894a', '#b89b50', '#cead56'],
  grassWiLush: ['#464f55', '#56675b', '#677e62', '#889263', '#a9a765'],
  grassWiNormal: ['#52505a', '#666862', '#7a806a', '#98946a', '#b5a86a'],
  grassWiDry: ['#5e545e', '#766e67', '#8e8770', '#a89a6f', '#c2ac6d'],
  evergreenSp: ['#253f35', '#2c5032', '#326230', '#5d7b3b', '#889545'],
  evergreenAu: ['#223735', '#274632', '#2d5530', '#59713b', '#858d45'],
  evergreenWi: ['#203239', '#253e37', '#2a4b36', '#56693f', '#838749'],
  deciduousSp: ['#46673c', '#57883c', '#68a83c', '#89b444', '#aac14d'],
  deciduousSu: ['#2c4935', '#355f32', '#3e7430', '#678a3b', '#8fa045'],
  deciduousAuGreen: ['#3f4d33', '#4e6331', '#5c7a2e', '#7f8f39', '#a2a444'],
  deciduousAuYellow: ['#876536', '#ab8534', '#d0a432', '#deb13c', '#ebbe46'],
  deciduousAuCopper: ['#7c3d31', '#9e4d2d', '#bf5e2a', '#d07836', '#e09241'],
  fruitSp: ['#3e5e40', '#4c7b41', '#5a9842', '#7ea749', '#a1b751'],
  fruitSu: ['#344e34', '#41693a', '#4f8a38', '#76a040', '#9cb04c'],   // the mockup's list (labelled "system"; no such token)
  fruitAu: ['#534d39', '#676337', '#7c7a36', '#998f3f', '#b6a449'],
  blossom: ['#956685', '#bd869a', '#e6a6ae', '#efb3a1', '#f9c094'],
  berries: ['#78233b', '#982b3b', '#b8323a', '#ca5443', '#dc774b'],
  cropSprout: ['#597145', '#709448', '#86b84a', '#a1c150', '#bdcb56'],
  cropGreen: ['#415f3a', '#507d39', '#5f9a38', '#82a941', '#a4b84a'],
  cropStubble: ['#816b5e', '#a38c67', '#c6ae70', '#d5b96f', '#e5c56d'],
  sandSp: ['#8c7570', '#b29b7e', '#d8c08c', '#e4c885', '#f0d07f'],
  sandAu: ['#8b706a', '#b09377', '#d6b684', '#e2c07f', '#efca7a'],
  sandWi: ['#827176', '#a59486', '#c8b896', '#d7c18e', '#e6cb85'],
  stoneWi: ['#504e70', '#64657e', '#787c8c', '#969185', '#b4a57f'],
  snowDust: ['#7c8296', '#9aa0b2', '#b8bdca', '#d2d5dc', '#e6e8ea'],
  snowFull: ['#9a92b2', '#b0aac4', '#c4c2d3', '#dcdee6', '#eef2f4'],   // the 3 snow tokens at steps 0, 2, 4
  waterSpring: ['#22385e', '#33527a', '#4a7092', '#6c94a8', '#a8ccd0'],  // meltwater
  waterWinter: ['#142a52', '#1b3562', '#244e7c', '#3c7496', '#6ea8c0'],
  ice: ['#5a7292', '#6e8eaa', '#8cacc4', '#a8c6d6', '#c6dee6'],
  iceRim: ['#8898b2', '#a6bacc', '#c6d8e4', '#e0ecf0', '#f4f8f8'],
  // Phase 5: cloud bodies (mockup E: the cloud and storm-cloud ramps).
  cloud: ['#8a8fa8', '#a7abbf', '#c8ccd8', '#e2e4ea', '#f6f5f0'],
  cloudStorm: ['#3c4058', '#4c526a', '#626880', '#7c8296', '#969cae'],
  // Phase 6: falling rain (steps 0–1) and snowflakes (steps 3–4) (mockup E).
  precip: ['#5d9cc9', '#82c4d6', '#c4c2d3', '#dcdee6', '#eef2f4'],
} as const satisfies Record<string, readonly string[]>;

export type SeasonRampName = keyof typeof SEASON_HEX;

/** Seasonal ramp `name` at `step`, as RGB. */
const seasonRgb = new Map<string, RGB[]>();
export function seasonRampRgb(name: SeasonRampName): readonly RGB[] {
  let r = seasonRgb.get(name);
  if (!r) { r = SEASON_HEX[name].map(hexRgb); seasonRgb.set(name, r); }
  return r;
}

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
