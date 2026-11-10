// The material buffer (seasons plan Phase 1a, docs/pixel-ages-seasons-plan.md §6.1). Beside the
// terrain image, every pixel keeps what it is made of: its ramp step (the tag: group × 8 + step,
// ramps.ts) and its role (grass, crown, lake…). The colour is picked last, through lookup tables,
// as in the seasons mockup ("the buffer holds (material, step), effects move steps, and only then
// is a colour picked"). Phase 1b: one table per season state and grass moisture class, so a pixel
// swaps from one seasonal ramp to the next at the same step; nothing is laid over it. Phase 2a: trees
// and bushes, as roles (evergreen, deciduous by autumn colour, branch, fruit, blossom, twig); a bare
// deciduous crown shows its alt entry. Drawing only.

import { CONFIG } from '../config';
import { bayer } from './dither';
import {
  Mat, RAMP_HEX, SEASON_HEX, hexRgb, rampTag, rampsOn, seasonRampRgb, styleOff, tagCount, tagRgb, tagValid, type SeasonRampName,
} from './ramps';
import { RGBS, type RGB } from './palette';
import { FIELD_CLASSES, Stage, heldStageOf, stageOf } from './fields';

const TILE = CONFIG.map.tilePx;
const TILE_PX = TILE * TILE;
const G = CONFIG.render.gradual;
const SC = CONFIG.render.seasons;

/** Phase 1a switch. Needs the ramps (the classic look has no tags). */
export const matbufOn: boolean = rampsOn && SC.matbuf.on && !styleOff('matbuf');

/** Phase 1b switch: the seasons live in the materials, not in a tint on top. Needs the buffer. */
export const seasonRampsOn: boolean = matbufOn && SC.seasonRamps.on && !styleOff('seasonRamps');

/** Phase 2a switch: crowns turn as evergreen or deciduous trees, bushes blossom and fruit. */
export const treesOn: boolean = seasonRampsOn && SC.trees.on && !styleOff('trees');

/**
 * What a terrain pixel is, so a later phase can recolour it by season (a crown turns copper, a
 * lake ices, a field goes to stubble). The last thing drawn over a pixel sets it.
 */
export const Role = {
  None: 0,       // not drawn yet
  Grass: 1,      // grassland: open ground and grass
  Forest: 2,     // the floor between trees
  Crown: 3,      // a tree crown (own tile or overhanging); from Phase 2a an evergreen's
  Fruit: 4,      // fruit bushes (their leaves)
  Farm: 5,       // farmland rows
  Desert: 6,     // desert sand (and grass on it)
  Mountain: 7,   // mountain ground
  Wall: 8,       // a mountain wall's body, or a pass through it
  Peak: 9,       // a mountain peak (ground or wall)
  Lake: 10,      // still water: lakes, ponds, streams
  River: 11,     // river water
  Sea: 12,       // sea water
  Bank: 13,      // mud at a river or stream where a water tile's corner is rounded off
  Beach: 14,     // sand round a lake or the sea
  Mark: 15,      // what people left on the land: paths, roads, canals, pits, ruins
  Fire: 16,      // a burning tile's flames and char
  // Phase 2a: trees and bushes.
  CrownSnow: 17,   // an evergreen's lit upper pixel where winter snow lies: snow in winter
  DecGreen: 18,    // a deciduous crown that stays green in autumn …
  DecYellow: 19,   // … turns yellow …
  DecCopper: 20,   // … or copper; bare in winter (the pixel shows its `alt` entry)
  Branch: 21,      // a bare crown's trunk or branch (an `alt` role: wood)
  BranchSnow: 22,  // a branch pixel where winter snow lies: snow
  FruitSpeck: 23,  // a fruit bush's fruit: blossom in spring, berries in summer and autumn, a twig in winter
  FruitTwig: 24,   // a bush pixel that is a bare twig in winter
  FruitBlossom: 25, // a bush pixel in blossom in spring
  FloorBare: 26,   // the floor of a mostly deciduous wood: in winter, with the canopy gone, the grass's winter ramp a step darker (mockup)
  Pond: 27,        // Phase 2c: still water in a body small enough to freeze right through
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Phase 2b switch: fields go through their stages, and the farmers' harvest shows. */
export const fieldsOn: boolean = seasonRampsOn && SC.fields.on && !styleOff('fields');

/** Phase 3a switch: a season arrives as the seeded front (seasonFront.ts), not the plain Bayer dissolve. */
export const frontOn: boolean = seasonRampsOn && SC.front.on && !styleOff('front');

/**
 * Phase 4 switches: the held fast-forward look of mockup D (fields half green and half gold, the grass
 * moisture following years-long rain, no falling rain or snow), and the caption under the year.
 */
export const heldOn: boolean = seasonRampsOn && SC.held.on && !styleOff('held');
export const seasonNoteOn: boolean = heldOn && SC.held.note.on && !styleOff('seasonNote');

/** Phase 2d switch: dry grass on high ground, spring flowers, autumn leaf litter. */
export const groundOn: boolean = seasonRampsOn && SC.ground.on && !styleOff('groundDetail');

/** Phase 2c switches: snow by height, ice on water, snow on roofs. */
export const snowOn: boolean = seasonRampsOn && SC.snow.on && !styleOff('snow');
export const iceOn: boolean = seasonRampsOn && SC.ice.on && !styleOff('ice');
export const roofsOn: boolean = snowOn && SC.roofs.on && !styleOff('roofs');

/**
 * Phase 2b: where a field pixel sits in the rows (mockup fieldPixel): a furrow row, or a ridge row
 * pixel that sprouts in spring (even columns), stands as stubble (odd columns), or neither.
 */
export const FieldPos = { Furrow: 0, Sprout: 1, Stubble: 2, Ridge: 3 } as const;
const FIELD_POS = 4;
/** Field roles follow the others: per field class × position × cut (harvested), then a sheaf per class. */
export const FIELD_ROLE_BASE = 28;
const FIELD_ROLES = FIELD_CLASSES * FIELD_POS * 2;
/** The role of a field pixel. */
export const fieldRole = (cls: number, pos: number, cut: boolean): number => FIELD_ROLE_BASE + (cls * FIELD_POS + pos) * 2 + (cut ? 1 : 0);
/** The role of a sheaf pixel in a harvested field of class `cls`. */
export const sheafRole = (cls: number): number => FIELD_ROLE_BASE + FIELD_ROLES + cls;
const FIELD_END = FIELD_ROLE_BASE + FIELD_ROLES + FIELD_CLASSES;

/**
 * Phase 2d: details on the ground that show in one season only, after the field roles. Each keeps the
 * ground under it in its `alt` entry, which shows out of season. A grass flower drawn all year until
 * now (its tag the flower; spring only), a spring flower of the mockup's clusters (its tag the flower;
 * setup keeps today's ground), and autumn leaf litter (its tag the ground): gold, yellow or copper.
 */
export const GroundRole = {
  Flower: FIELD_END, Bloom: FIELD_END + 1, LitterGold: FIELD_END + 2, LitterYellow: FIELD_END + 3, LitterCopper: FIELD_END + 4,
} as const;
const GROUND_ROLES = 5;
/** Is this role a Phase 2d ground detail? */
export const isGroundRole = (role: number): boolean => role >= FIELD_END && role < FIELD_END + GROUND_ROLES;

/** How many roles there are (tables are indexed by role). */
export const ROLES = FIELD_END + GROUND_ROLES;

/** A field role's parts, or null for any other role. */
export function fieldRoleParts(role: number): { cls: number; pos: number; cut: boolean; sheaf: boolean } | null {
  if (role < FIELD_ROLE_BASE || role >= FIELD_END) return null;
  const k = role - FIELD_ROLE_BASE;
  if (k >= FIELD_ROLES) return { cls: k - FIELD_ROLES, pos: FieldPos.Furrow, cut: true, sheaf: true };
  return { cls: Math.floor(k / (FIELD_POS * 2)), pos: (k >> 1) % FIELD_POS, cut: (k & 1) === 1, sheaf: false };
}

/** Is this role a deciduous crown? */
export const isDeciduous = (role: number): boolean => role >= Role.DecGreen && role <= Role.DecCopper;
/** Is this role a tree crown of any kind? */
export const isCrown = (role: number): boolean => role === Role.Crown || role === Role.CrownSnow || isDeciduous(role);

/** What the buffer resolves to: today's colours (setup, and the switch off), a season, or the held fast-forward look. */
export const LookState = { Painted: 0, Spring: 1, Summer: 2, Autumn: 3, Winter: 4, Held: 5 } as const;
export type LookState = (typeof LookState)[keyof typeof LookState];
const STATES = 6;

/** How wet the grass is (Phase 1b): picks the dry, normal or lush grass ramp of the season. */
export const Moist = { Dry: 0, Normal: 1, Lush: 2 } as const;
export type Moist = (typeof Moist)[keyof typeof Moist];
const CLASSES = 3;

/** One map's material buffer, one entry per terrain pixel (same layout as the image). */
export interface MatBuf {
  readonly w: number;    // px
  readonly h: number;
  readonly tag: Uint16Array;
  readonly role: Uint8Array;
  readonly moist: Uint8Array;   // Phase 1b: the pixel's grass moisture class (rain, not the tile's drawing)
  // Phase 2a: the key (0–255) whose state the pixel shows: Phase 3a: the front's arrival at its anchor,
  // without the front its Bayer key (bayerKey). The anchor: the pixel itself, or its tree's centre (a tree
  // turns as one), or its field tile's centre (Phase 3a), as an offset (anchorCode).
  readonly rank: Uint8Array;
  readonly anchor: Uint8Array;
  // For a deciduous crown, what shows when it is bare: a branch, or the ground under it.
  readonly alt: Uint16Array;
  readonly altRole: Uint8Array;
}

/** The tag of a pixel not drawn yet: it resolves to transparent, as the image's undrawn pixels are. */
export const NO_TAG = 0xffff;

export function createMatBuf(w: number, h: number): MatBuf {
  const n = w * h;
  return {
    w, h, tag: new Uint16Array(n).fill(NO_TAG), role: new Uint8Array(n), moist: new Uint8Array(n).fill(Moist.Normal),
    rank: new Uint8Array(n), anchor: new Uint8Array(n).fill(SELF), alt: new Uint16Array(n).fill(NO_TAG), altRole: new Uint8Array(n),
  };
}

/** A pixel's anchor: the offset (−8…7 each way) to the pixel whose arrival it takes. */
export const anchorCode = (dx: number, dy: number): number => ((Math.max(-8, Math.min(7, dy)) + 8) << 4) | (Math.max(-8, Math.min(7, dx)) + 8);
/** The anchor of a pixel that takes its own arrival. */
export const SELF = 0x88;
/** Buffer index offset for each anchor code, in a buffer `w` pixels wide. */
export function anchorOffsets(w: number): Int32Array {
  const o = new Int32Array(256);
  for (let c = 0; c < 256; c++) o[c] = ((c >> 4) - 8) * w + ((c & 15) - 8);
  return o;
}

/** The key of a pixel without the front: its Bayer rank, spread over the 256 keys (rank × 16 + 15 turns at the same level as Phase 1b's 16 ranks did). */
export const bayerKey = (x: number, y: number): number => bayerRank(x, y) * 16 + 15;

/** A tile's entries, copied out (for a tile dissolving from its old look). */
export interface MatTile { tag: Uint16Array; role: Uint8Array; rank: Uint8Array; anchor: Uint8Array; alt: Uint16Array; altRole: Uint8Array }

// Bayer rank (0–15) of each 4×4 cell, the same matrix as dither.ts.
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The Bayer rank of a pixel (0–15). */
export const bayerRank = (x: number, y: number): number => B4[(y & 3) * 4 + (x & 3)]!;

/** Packs a colour as the image's little-endian RGBA word, opaque (as blit.ts packs sprite pixels). */
const packRgba = (c: RGB): number => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;

// ---------- which ramp a pixel takes in each season ----------

/** A ramp: a system ramp (its Mat) or a seasonal one (its name in SEASON_HEX). */
type Ramp = Mat | SeasonRampName;

// Per season (spring, summer, autumn, winter) and moisture class (dry, normal, lush).
const GRASS: readonly (readonly Ramp[])[] = [
  ['grassSpDry', 'grassSpNormal', 'grassSpLush'],
  ['grassSuDry', Mat.Grass, 'grassSuLush'],
  ['grassAuDry', 'grassAuNormal', 'grassAuLush'],
  ['grassWiDry', 'grassWiNormal', 'grassWiLush'],
];
const EVERGREEN: readonly Ramp[] = ['evergreenSp', Mat.Forest, 'evergreenAu', 'evergreenWi'];
const FRUIT: readonly (Ramp | null)[] = ['fruitSp', 'fruitSu', 'fruitAu', null];   // winter: dormant, the grass's ramp
const SAND: readonly Ramp[] = ['sandSp', Mat.Sand, 'sandAu', 'sandWi'];
const STONE: readonly Ramp[] = [Mat.Stone, Mat.Stone, Mat.Stone, 'stoneWi'];
const CROP: readonly Ramp[] = ['cropSprout', 'cropGreen', Mat.Crop, 'cropStubble'];   // one stage per season until Phase 2b
const RIVER: readonly Ramp[] = ['waterSpring', Mat.Water, Mat.Water, 'waterWinter'];  // spring meltwater
const STILL: readonly Ramp[] = [Mat.Water, Mat.Water, Mat.Water, 'waterWinter'];
// Phase 2a: deciduous crowns by season (autumn by the crown's own colour; winter: bare).
const DECIDUOUS: readonly Ramp[] = ['deciduousSp', 'deciduousSu', 'deciduousAuGreen', 'deciduousSu'];
const AUTUMN: Readonly<Record<number, Ramp>> = {
  [Role.DecGreen]: 'deciduousAuGreen', [Role.DecYellow]: 'deciduousAuYellow', [Role.DecCopper]: 'deciduousAuCopper',
};

/** The role a variant falls back to for its plain colours (a bush's twig is a bush leaf in summer). */
const baseRole = (role: number): number =>
  role === Role.FruitTwig || role === Role.FruitBlossom || role === Role.FruitSpeck ? Role.Fruit
    : role === Role.CrownSnow ? Role.Crown : role === Role.BranchSnow ? Role.Branch : role === Role.FloorBare ? Role.Forest
      : role === Role.Pond ? Role.Lake
      : role >= FIELD_ROLE_BASE && role < FIELD_END ? Role.Farm : isGroundRole(role) ? Role.Grass : role;

/**
 * The ramp a pixel of group `g` with `role` takes in `season` (0 spring … 3 winter) and moisture
 * class `cls`, or null to keep its own colour. Things lying on the ground (ore, salt, ash, marks)
 * keep their ramp's season; accents (ink, flowers, flames, fruit) never change.
 */
export function seasonalRamp(g: number, role: number, season: number, cls: number): Ramp | null {
  const base = baseRole(role);
  switch (g) {
    case Mat.Grass:
      return base === Role.Fruit && FRUIT[season] !== null ? FRUIT[season]! : GRASS[season]![cls]!;
    case Mat.Forest:
      if (isDeciduous(role)) return season === 2 ? AUTUMN[role]! : DECIDUOUS[season]!;
      return EVERGREEN[season]!;
    case Mat.Sand: return SAND[season]!;
    case Mat.Stone: return STONE[season]!;
    case Mat.Crop: return CROP[season]!;
    case Mat.Water: return role === Role.River ? RIVER[season]! : STILL[season]!;
    default: return null;
  }
}

function rampColour(r: Ramp, step: number): RGB {
  if (typeof r === 'number') return tagRgb(r * 8 + step);
  const c = seasonRampRgb(r);
  return c[Math.max(0, Math.min(c.length - 1, step))]!;
}

/**
 * A field pixel's colour at a stage (mockup fieldPixel). Fields are drawn as the gold stage (the
 * system crop ramp: furrows at steps 0–1, ridges at 3–4), so gold is the pixel's own colour; green
 * takes the same step of the green crop ramp; bare furrows are soil (wood 1, ridges wood 2–3), with
 * sprouts on the sprouting ridge pixels and stubble on the stubble ones.
 */
function stageColour(stage: Stage, pos: number, step: number): RGB {
  if (stage === Stage.Gold) return tagRgb(Mat.Crop * 8 + step);
  if (stage === Stage.Green) return rampColour('cropGreen', pos === FieldPos.Furrow ? Math.max(1, step) : step);
  if (stage === Stage.Sprouts && pos === FieldPos.Sprout) return rampColour('cropSprout', step >= 4 ? 4 : 3);
  if (stage === Stage.Stubble && pos === FieldPos.Stubble) return rampColour('cropStubble', step >= 4 ? 4 : 3);
  return tagRgb(Mat.Wood * 8 + (pos === FieldPos.Furrow ? 1 : step >= 4 ? 2 : 3));
}

/** "Show the pixel's `alt` entry": a bare deciduous crown in winter (a table value no colour has: colours are opaque). */
export const ALT = 1;

let fruitTag = -1;

/**
 * The colour of (role, tag) in a state and moisture class, or ALT where the pixel shows its
 * `alt` entry instead (a deciduous crown in winter: its branches and the ground under it).
 */
export function lookColour(state: LookState, cls: number, role: number, tag: number): RGB | typeof ALT {
  const g = tag >> 3, step = tag & 7;
  if (isGroundRole(role)) return groundColour(state, role, tag);
  if (state === LookState.Painted) return tagRgb(tag);
  const held = state === LookState.Held;
  // The held fast-forward look (seasons brief D): summer, gold fields, normal moisture; Phase 4: the
  // moisture of years-long rain, and fields half green and half gold.
  const season = held ? 1 : state - 1;
  const c = held && !heldOn ? Moist.Normal : cls;
  const winter = season === 3;
  // Phase 2a: trees and bushes.
  if (isDeciduous(role) && g === Mat.Forest && winter) return ALT;
  if (role === Role.FruitSpeck && tag === fruitTag) {
    if (season === 0) return seasonRampRgb('blossom')[3]!;
    if (winter) return tagRgb(Mat.Wood * 8 + 1);
    return tagRgb(tag);   // the berries: the fruit colour, berries step 2
  }
  // Phase 2b: fields through their stages; a harvested part is stubble in autumn, its sheaves gold.
  const field = fieldRoleParts(role);
  if (field && g === Mat.Crop) {
    if (held && heldOn) return stageColour(field.sheaf ? Stage.Gold : heldStageOf(field.cls), field.pos, step);
    if (held) return tagRgb(tag);
    const stage = field.sheaf ? (season === 2 ? Stage.Gold : stageOf(field.cls, season))
      : field.cut && season === 2 ? Stage.Stubble : stageOf(field.cls, season);
    return stageColour(stage, field.pos, step);
  }
  if (role === Role.FloorBare && g === Mat.Forest && winter) return rampColour(GRASS[3]![c]!, Math.min(4, step + 1));
  if (role === Role.FruitTwig && g === Mat.Grass && winter) return tagRgb(Mat.Wood * 8 + (step >= 2 ? 2 : 1));
  if (role === Role.FruitBlossom && g === Mat.Grass && season === 0 && !held) return seasonRampRgb('blossom')[step >= 3 ? 4 : 3]!;
  const r = held && g === Mat.Crop ? null : seasonalRamp(g, role, season, c);
  // The crop furrow (step 0) is soil all year; Phase 2b gives the fields their stages.
  if (r === null || (g === Mat.Crop && step === 0)) return tagRgb(tag);
  return rampColour(r, step);
}

/**
 * Phase 2d: a ground detail in its season (flowers in spring, litter in autumn), else ALT: the ground
 * under it, which takes the season as any ground does. Setup shows today's look (a cluster flower is
 * new, so its ground); the held look has neither (mockup: no details when fast).
 */
function groundColour(state: LookState, role: number, tag: number): RGB | typeof ALT {
  const flower = role === GroundRole.Flower || role === GroundRole.Bloom;
  if (state === LookState.Painted) return role === GroundRole.Bloom ? ALT : tagRgb(tag);
  if (state !== (flower ? LookState.Spring : LookState.Autumn)) return ALT;
  if (flower) return tagRgb(tag);
  return seasonRampRgb(role === GroundRole.LitterCopper ? 'deciduousAuCopper' : 'deciduousAuYellow')[role === GroundRole.LitterGold ? 3 : 2]!;
}

let tables: Uint32Array[] | null = null;
let span = 0;

/** The lookup tables, one per state × moisture class, indexed by role × tags + tag. Built once. */
function lookTables(): Uint32Array[] {
  if (tables) return tables;
  span = tagCount();
  fruitTag = rampTag([...RGBS.fruit] as RGB);
  tables = [];
  for (let s = 0; s < STATES; s++) {
    for (let c = 0; c < CLASSES; c++) {
      const t = new Uint32Array(ROLES * span);
      for (let role = 0; role < ROLES; role++) {
        for (let tag = 0; tag < span; tag++) {
          if (!tagValid(tag)) continue;
          const col = lookColour(s as LookState, c, role, tag);
          t[role * span + tag] = col === ALT ? ALT : packRgba(col);
        }
      }
      tables.push(t);
    }
  }
  return tables;
}

// ---------- Phase 2c: what lies on a pixel in winter ----------

/** Snow (light dusting or full cover) on land, ice on water: only on pixels showing winter. */
export const Cover = { None: 0, Dust: 1, Snow: 2, Ice: 3, IceEdge: 4, PondIce: 5 } as const;
const COVERS = 6;

/** Is this role water (it ices; it never takes snow)? */
export const isWaterRole = (role: number): boolean => role === Role.Lake || role === Role.Pond || role === Role.River || role === Role.Sea;

const RAMP_GROUPS = 10;   // groups past the ramps (RAMP_HEX) are accents
const clampStep = (s: number): number => Math.max(0, Math.min(4, s));

/**
 * The colour of (role, tag) under a cover, or null where the cover leaves the pixel as it is (mockup
 * B): full snow one step lighter than the ground's shading, dusting at the same step; paths and roads
 * only dusted; field furrows filled while the ridges show; snow caps on the evergreen and branch
 * pixels marked for it; flames, accents, peak snow, crowns and branches showing through. Lake and
 * river ice is the ice rim ramp, its front a darker line; a pond freezes as the lake ice ramp.
 */
export function coverColour(cover: number, role: number, tag: number): RGB | null {
  const g = tag >> 3, step = tag & 7;
  const snowFull = seasonRampRgb('snowFull'), dust = seasonRampRgb('snowDust');
  if (cover === Cover.Ice || cover === Cover.IceEdge || cover === Cover.PondIce) {
    if (!isWaterRole(role)) return null;
    const s = g === Mat.Water ? step : 4;   // foam and glints are the shallowest
    if (cover === Cover.IceEdge) return seasonRampRgb('iceRim')[1]!;
    return seasonRampRgb(cover === Cover.PondIce ? 'ice' : 'iceRim')[s >= 4 ? 4 : 3]!;
  }
  if (isWaterRole(role) || role === Role.Fire || role === Role.Crown || role === Role.Branch || isDeciduous(role)) return null;
  if (g >= RAMP_GROUPS || g === Mat.Snow) return null;
  const full = cover === Cover.Snow;
  if (role === Role.CrownSnow) return full && g === Mat.Forest ? snowFull[step >= 3 ? 4 : 3]! : null;
  if (role === Role.BranchSnow) return full && g === Mat.Wood ? snowFull[4]! : null;
  if (role === Role.Mark) return dust[clampStep(step)]!;
  const field = fieldRoleParts(role);
  if (field) return !field.sheaf && field.pos === FieldPos.Furrow ? (full ? snowFull[3]! : dust[2]!) : null;
  return full ? snowFull[clampStep(step + 1)]! : dust[clampStep(step)]!;
}

let covers: Uint32Array[] | null = null;

/** One table per cover, indexed like the look tables; 0 where the cover leaves the pixel as it is. */
function coverTables(): Uint32Array[] {
  if (covers) return covers;
  lookTables();
  covers = [];
  for (let k = 0; k < COVERS; k++) {
    const t = new Uint32Array(ROLES * span);
    if (k !== Cover.None) {
      for (let role = 0; role < ROLES; role++) {
        for (let tag = 0; tag < span; tag++) {
          if (!tagValid(tag)) continue;
          const c = coverColour(k, role, tag);
          if (c) t[role * span + tag] = packRgba(c);
        }
      }
    }
    covers.push(t);
  }
  return covers;
}

// ---------- the look: which state each Bayer rank shows ----------

/** How many keys a front has: a pixel shows the state of its key (Phase 1b: 16 Bayer ranks). */
export const KEYS = 256;

/**
 * What the image shows now: the state of each key. A season arrives as a front, key by key, so each
 * pixel changes once: Phase 3a's keys are each pixel's arrival in the front (seasonFront.ts), and
 * without it the Bayer keys (bayerKey). A pixel shows the state of its anchor's key (a tree its centre's).
 */
export interface Look {
  readonly tables: Uint32Array[];
  readonly span: number;
  readonly shown: Int8Array;   // state per key
  // Phase 2c: winter's snow and ice. Per pixel, the order snow and ice reach it (winter.ts; null: none),
  // and the lines (0–255) the winter has reached; a pixel showing winter is covered below them.
  readonly cover: Uint32Array[];
  cold: Uint8Array | null;
  // Phase 5: how many ramp steps each pixel drops under a cloud's shadow (or a storm's gloom), 0–3; null without clouds.
  shade: Uint8Array | null;
  ice: Uint8Array | null;
  snowLine: number;
  iceLine: number;
}

export function createLook(state: LookState = LookState.Painted): Look {
  const t = lookTables();
  return { tables: t, span, shown: new Int8Array(KEYS).fill(state), cover: coverTables(), cold: null, ice: null, snowLine: 0, iceLine: 0, shade: null };
}

const SN = CONFIG.render.seasons.snow;
const EDGE = SN.edgeShare * 255, DUST = SN.dustShare * 255;

/** The cover on pixel `p` at (x, y) with `role`, for a pixel showing winter. */
function coverAt(buf: MatBuf, look: Look, role: number, p: number, x: number, y: number): number {
  if (isWaterRole(role)) {
    const ice = look.ice;
    if (!ice || ice[p]! >= look.iceLine) return Cover.None;
    // The ice front: a frozen pixel beside open water of its own body.
    if ((x > 0 && openWater(buf, look, ice, p - 1)) || (x < buf.w - 1 && openWater(buf, look, ice, p + 1))
      || (y > 0 && openWater(buf, look, ice, p - buf.w)) || (y < buf.h - 1 && openWater(buf, look, ice, p + buf.w))) return Cover.IceEdge;
    return role === Role.Pond ? Cover.PondIce : Cover.Ice;
  }
  const cold = look.cold;
  if (!cold || look.snowLine <= 0 || cold[p] === 255) return Cover.None;
  if (look.snowLine >= 255) return Cover.Snow;   // a full line covers all the land, its dithered edge too
  const v = cold[p]! + (bayer(x, y) - 0.5) * EDGE;
  return v < look.snowLine ? Cover.Snow : v < look.snowLine + DUST ? Cover.Dust : Cover.None;
}

/** Is pixel q water that is not frozen? */
const openWater = (buf: MatBuf, look: Look, ice: Uint8Array, q: number): boolean => isWaterRole(buf.role[q]!) && ice[q]! >= look.iceLine;

/**
 * Recolours the pixels listed in `order` from `from` to `to` (exclusive) that show winter: the ones
 * a moved snow or ice line can change (winter.ts keeps the land and water pixels sorted by the order
 * snow and ice reach them, so a step touches a thin band, not the map). `around`: their 4 neighbours
 * too (the ice front moves with the ice).
 */
export function resolveBand(buf: MatBuf, look: Look, px: Uint32Array, order: Int32Array, from: number, to: number, around: boolean): void {
  const w = buf.w, n = buf.w * buf.h;
  const one = (p: number): void => {
    if (p < 0 || p >= n || look.shown[buf.rank[p]!] !== LookState.Winter || buf.tag[p] === NO_TAG) return;
    const x = p % w;
    px[p] = colourAt(buf, look, p, x, (p - x) / w);
  };
  for (let k = from; k < to; k++) {
    const p = order[k]!;
    one(p);
    if (around) { one(p - 1); one(p + 1); one(p - w); one(p + w); }
  }
}

/** Flags in `out` the keys showing winter (the ones a moved snow or ice line recolours); true if any. */
export function winterKeys(look: Look, out: Uint8Array): boolean {
  let any = false;
  for (let k = 0; k < KEYS; k++) { const w = look.shown[k] === LookState.Winter; out[k] = w ? 1 : 0; any ||= w; }
  return any;
}

/** Is pixel `p` at (x, y) under snow now (a building there wears it on its roof)? */
export function snowAt(buf: MatBuf, look: Look, p: number, x: number, y: number): boolean {
  return look.shown[buf.rank[p]!] === LookState.Winter && !isWaterRole(buf.role[p]!) && coverAt(buf, look, buf.role[p]!, p, x, y) === Cover.Snow;
}

/** Is pixel `p` frozen now (boats keep off)? */
export function iceAt(buf: MatBuf, look: Look, p: number): boolean {
  return look.shown[buf.rank[p]!] === LookState.Winter && isWaterRole(buf.role[p]!) && !!look.ice && look.ice[p]! < look.iceLine;
}

/** The colour word of an entry (tag, role, alt) at buffer pixel `p` (at x, y), whose rank is `rank`. */
function colourOf(buf: MatBuf, look: Look, tag: number, role: number, rank: number, alt: number, altRole: number, p: number, x: number, y: number): number {
  if (tag === NO_TAG) return 0;
  const st = look.shown[rank]!;
  const t = look.tables[st * CLASSES + buf.moist[p]!]!;
  let c = t[role * look.span + tag]!;
  if (c === ALT) {
    if (alt === NO_TAG) return 0;
    role = altRole; tag = alt;
    c = t[role * look.span + tag]!;
  }
  if (st === LookState.Winter) {
    const k = coverAt(buf, look, role, p, x, y);
    if (k !== Cover.None) { const cc = look.cover[k]![role * look.span + tag]!; if (cc !== 0) c = cc; }
  }
  if (look.shade) { const d = look.shade[p]!; if (d !== 0) c = shadeWord(c, d); }
  return c;
}

// ---------- Phase 5: cloud shadows, as ramp steps ----------

let rampOf: Map<number, { ramp: number[]; step: number }> | null = null;
const shaded: Map<number, number>[] = [new Map(), new Map(), new Map(), new Map()];
const FAST_BITS = 12;
const fastIn = new Uint32Array(4 << FAST_BITS), fastOut = new Uint32Array(4 << FAST_BITS);

/**
 * Colour word `c` `d` ramp steps darker (a cloud's shadow, mockup E: the buffer's step moves down,
 * then the colour is picked; step 0 stays, so the darkest ground shows no shadow). Every system and
 * seasonal ramp is known; accents and anything else stay as they are. Cached per colour.
 */
export function shadeWord(c: number, d: number): number {
  if (c === 0 || c === ALT) return c;
  // A small direct-mapped cache in front of the map: a storm shades every pixel, and a season step
  // then looks up a million colours (a Map lookup each was ~7% of a frame, measured).
  const slot = (Math.min(3, d) << FAST_BITS) | (Math.imul(c, 0x9e3779b1) >>> (32 - FAST_BITS));
  if (fastIn[slot] === c) return fastOut[slot]!;
  const cache = shaded[Math.min(3, d)]!;
  const hit = cache.get(c);
  if (hit !== undefined) { fastIn[slot] = c; fastOut[slot] = hit; return hit; }
  if (!rampOf) {
    rampOf = new Map();
    const ramps = [...RAMP_HEX.slice(0, RAMP_GROUPS), ...Object.values(SEASON_HEX)];
    for (const hexes of ramps) {
      const words = hexes.map((h) => packRgba(hexRgb(h)));
      // A colour in two ramps keeps the first (the system ramp): its shade is then the same everywhere.
      words.forEach((w, step) => { if (!rampOf!.has(w)) rampOf!.set(w, { ramp: words, step }); });
    }
  }
  const r = rampOf.get(c);
  const out = r ? r.ramp[Math.max(0, r.step - d)]! : c;
  cache.set(c, out);
  fastIn[slot] = c; fastOut[slot] = out;
  return out;
}

export const colourAt = (buf: MatBuf, look: Look, p: number, x: number, y: number): number =>
  colourOf(buf, look, buf.tag[p]!, buf.role[p]!, buf.rank[p]!, buf.alt[p]!, buf.altRole[p]!, p, x, y);

/** Writes tile (tx, ty)'s colours from the buffer into the image (`px` = its pixels as words). */
export function resolveTile(buf: MatBuf, look: Look, px: Uint32Array, tx: number, ty: number): void {
  for (let y = 0; y < TILE; y++) {
    const o = (ty * TILE + y) * buf.w + tx * TILE;
    for (let x = 0; x < TILE; x++) px[o + x] = colourAt(buf, look, o + x, tx * TILE + x, ty * TILE + y);
  }
}

/**
 * Writes the colours of every pixel whose key is flagged in `dirty` (1 = recolour). One pass over the
 * map: keys follow the front and the trees, not a lattice.
 */
export function resolveRanks(buf: MatBuf, look: Look, px: Uint32Array, dirty: Uint8Array): void {
  const { tag, role, rank, moist, alt, altRole } = buf, n = buf.w * buf.h, span = look.span, shade = look.shade;
  // The three moisture tables each key shows, picked once (a late-game map changes keys often:
  // a function call per pixel here was 9% of a frame, measured).
  const byRank: Uint32Array[] = [];
  for (let r = 0; r < KEYS; r++) for (let c = 0; c < CLASSES; c++) byRank.push(look.tables[look.shown[r]! * CLASSES + c]!);
  for (let p = 0; p < n; p++) {
    const r = rank[p]!;
    if (dirty[r] === 0) continue;
    const g = tag[p]!;
    if (g === NO_TAG) continue;
    // Winter pixels may lie under snow or ice: the full path.
    if (look.shown[r] === LookState.Winter) { const x = p % buf.w; px[p] = colourAt(buf, look, p, x, (p - x) / buf.w); continue; }
    const t = byRank[r * CLASSES + moist[p]!]!;
    const c = t[role[p]! * span + g]!;
    const col = c !== ALT ? c : alt[p] === NO_TAG ? 0 : t[altRole[p]! * span + alt[p]!]!;
    px[p] = shade && shade[p] !== 0 ? shadeWord(col, shade[p]!) : col;
  }
}

const newMatTile = (): MatTile => ({
  tag: new Uint16Array(TILE_PX), role: new Uint8Array(TILE_PX), rank: new Uint8Array(TILE_PX), anchor: new Uint8Array(TILE_PX), alt: new Uint16Array(TILE_PX), altRole: new Uint8Array(TILE_PX),
});

/** Copies tile (tx, ty)'s entries out of the buffer. */
export function readMatTile(buf: MatBuf, tx: number, ty: number, out: MatTile = newMatTile()): MatTile {
  for (let y = 0; y < TILE; y++) {
    const o = (ty * TILE + y) * buf.w + tx * TILE, d = y * TILE;
    out.tag.set(buf.tag.subarray(o, o + TILE), d);
    out.role.set(buf.role.subarray(o, o + TILE), d);
    out.rank.set(buf.rank.subarray(o, o + TILE), d);
    out.anchor.set(buf.anchor.subarray(o, o + TILE), d);
    out.alt.set(buf.alt.subarray(o, o + TILE), d);
    out.altRole.set(buf.altRole.subarray(o, o + TILE), d);
  }
  return out;
}

/** Would two snapshots of tile (tx, ty) look the same now? (A tile only fades when it would look different.) */
export function sameMatLook(buf: MatBuf, look: Look, tx: number, ty: number, a: MatTile, b: MatTile): boolean {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const k = y * TILE + x, p = (ty * TILE + y) * buf.w + tx * TILE + x;
      const px = tx * TILE + x, py = ty * TILE + y;
      const ca = colourOf(buf, look, a.tag[k]!, a.role[k]!, a.rank[k]!, a.alt[k]!, a.altRole[k]!, p, px, py);
      if (ca !== colourOf(buf, look, b.tag[k]!, b.role[k]!, b.rank[k]!, b.alt[k]!, b.altRole[k]!, p, px, py)) return false;
    }
  }
  return true;
}

/**
 * Writes tile (tx, ty) at dissolve `step` of `fadeSteps` into the buffer: the same Bayer order as
 * terrain.ts dissolveTile (speeds plan Phase 5), so a pixel takes its new entry once and the look
 * through the painted table is what dissolveTile shows.
 */
export function dissolveMat(buf: MatBuf, tx: number, ty: number, old: MatTile, neu: MatTile, step: number): void {
  const share = step / G.fadeSteps;
  for (let y = 0; y < TILE; y++) {
    const py = ty * TILE + y;
    const o = py * buf.w + tx * TILE;
    for (let x = 0; x < TILE; x++) {
      const src = bayer(tx * TILE + x, py) < share ? neu : old, k = y * TILE + x;
      buf.tag[o + x] = src.tag[k]!; buf.role[o + x] = src.role[k]!; buf.rank[o + x] = src.rank[k]!; buf.anchor[o + x] = src.anchor[k]!;
      buf.alt[o + x] = src.alt[k]!; buf.altRole[o + x] = src.altRole[k]!;
    }
  }
}
