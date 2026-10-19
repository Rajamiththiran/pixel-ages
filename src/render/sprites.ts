// Sprite parsing and cache (§18.4). Each variant is pre-rendered once into a small
// canvas and cached by key, so the draw loop only calls drawImage.

import { SPRITES, type SpriteDef } from './spriteData';
import { PALETTE, GROUP_COLORS, SKIN_COLORS, HAIR_COLORS, ELDER_HAIR, darken } from './palette';

/** Colours for the per-sprite legend characters (§19.1). */
export interface SpriteVars { H?: string; S?: string; C?: string; D?: string; L?: string }

const FIXED: Record<string, string> = {
  K: PALETTE.ink,
  W: PALETTE.wood,
  w: PALETTE.darkWood,
  Y: PALETTE.sand,
  M: PALETTE.mudBrick,
  m: PALETTE.clay,
  G: PALETTE.stone,
  g: PALETTE.stoneLight,
  F: PALETTE.fireOrange,
  f: PALETTE.fireYellow,
  // F8 icons and effects
  B: PALETTE.water,
  b: PALETTE.waterLight,
  R: PALETTE.fruit,
  E: PALETTE.grass,
  e: PALETTE.forest,
  X: PALETTE.snow,
  N: PALETTE.copper,
  I: PALETTE.iron,
};

/** Colour of one grid character, or null for transparent. */
export function charColor(ch: string, vars: SpriteVars): string | null {
  if (ch === '.') return null;
  const fixed = FIXED[ch];
  if (fixed) return fixed;
  const v = vars[ch as keyof SpriteVars];
  // A missing variable colour is a programming error; magenta makes it obvious.
  return v ?? '#ff00ff';
}

/** Packed RGBA words (little-endian, as a Uint32Array view of ImageData), alpha 0 = transparent. */
export interface SpritePixels { w: number; h: number; data: Uint32Array }

// Pixels of each sprite canvas, built from the grid at the same time as the canvas, so the
// sprite layer (blit.ts) never has to read pixels back from a canvas (a slow GPU readback).
const pixelsByCanvas = new WeakMap<HTMLCanvasElement, SpritePixels>();

export const spritePixels = (c: HTMLCanvasElement): SpritePixels | undefined => pixelsByCanvas.get(c);

const packRgba = (hex: string): number => {
  const v = parseInt(hex.slice(1), 16);
  return ((255 << 24) | ((v & 255) << 16) | (v & 0xff00) | ((v >> 16) & 255)) >>> 0;
};

function render(def: SpriteDef, vars: SpriteVars, flip: boolean, night: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = def.w;
  c.height = def.h;
  const ctx = c.getContext('2d')!;
  const data = new Uint32Array(def.w * def.h);
  for (let y = 0; y < def.h; y++) {
    const row = def.rows[y]!;
    for (let x = 0; x < def.w; x++) {
      // F8 night variant of a building: dark windows and doors glow with firelight.
      const ch = night && row[x] === 'K' ? 'f' : row[x]!;
      const col = charColor(ch, vars);
      if (!col) continue;
      const px = flip ? def.w - 1 - x : x;
      ctx.fillStyle = col;
      ctx.fillRect(px, y, 1, 1);
      data[y * def.w + px] = packRgba(col);
    }
  }
  pixelsByCanvas.set(c, { w: def.w, h: def.h, data });
  return c;
}

const cache = new Map<string, HTMLCanvasElement>();

export function getSprite(name: string, vars: SpriteVars = {}, flip = false, night = false): HTMLCanvasElement {
  const key = `${name}|${vars.C ?? ''}|${vars.S ?? ''}|${vars.H ?? ''}|${vars.L ?? ''}|${flip ? 1 : 0}|${night ? 1 : 0}`;
  let c = cache.get(key);
  if (!c) {
    const def = SPRITES[name];
    if (!def) throw new Error(`Unknown sprite ${name}`);
    c = render(def, vars, flip, night);
    cache.set(key, c);
  }
  return c;
}

// Age classes used by person sprites (matches Frame flags bits 1–2, §22).
export const AgeClass = { Child: 0, Adult: 1, Elder: 2 } as const;
export type AgeClass = (typeof AgeClass)[keyof typeof AgeClass];

export interface PersonLook {
  female: boolean;
  ageClass: AgeClass;
  colorIndex: number;
  skin: number;                  // 0–2
  hair: number;                  // 0–2
  clothed: boolean;
}

/** The C, D, S, H, L colours of a person's look. */
function lookVars(p: PersonLook): SpriteVars {
  const C = GROUP_COLORS[p.colorIndex % GROUP_COLORS.length]!;
  const D = darken(C);
  const S = SKIN_COLORS[p.skin] ?? SKIN_COLORS[0];
  const H = p.ageClass === AgeClass.Elder ? ELDER_HAIR : (HAIR_COLORS[p.hair] ?? HAIR_COLORS[0]);
  return { C, D, S, H, L: p.clothed ? D : S };
}

/** Person sprite for walk frame 1 or 2. Elders use the adult grid with stoneLight hair. */
export function personSprite(p: PersonLook, frame: 1 | 2): HTMLCanvasElement {
  const name = p.ageClass === AgeClass.Child
    ? `child_${frame}`
    : `${p.female ? 'adult_f' : 'adult_m'}_${frame}`;
  return getSprite(name, lookVars(p));
}

/** F8 work poses (§14.3), facing right; `flip` faces left. */
export type Pose = 'gather' | 'farm' | 'cut' | 'fish' | 'build';

export function poseSprite(p: PersonLook, pose: Pose, frame: 1 | 2, flip = false): HTMLCanvasElement {
  return getSprite(`${pose}_${frame}`, lookVars(p), flip);
}

/** F8 carried items (§14.3). */
export type Carry = 'basket' | 'meat' | 'wood' | 'pot' | 'fish';

/** A walking adult carrying an item at the right hand: the adult at (0, 0), the item at (+3, +2), 6 px wide. */
export function carrySprite(p: PersonLook, item: Carry, frame: 1 | 2): HTMLCanvasElement {
  const body = personSprite(p, frame);
  return compose(`carry|${lookKey(p)}|${item}|${frame}`, 6, body.height,
    [{ img: body, x: 0, y: 0 }, { img: getSprite(`item_${item}`), x: 3, y: 2 }]);
}

/** A herder (§14.3): the adult with a crook at (+3, 0). */
export function herderSprite(p: PersonLook, frame: 1 | 2): HTMLCanvasElement {
  const body = personSprite(p, frame);
  return compose(`herder|${lookKey(p)}|${frame}`, 5, body.height,
    [{ img: body, x: 0, y: 0 }, { img: getSprite('staff'), x: 3, y: 0 }]);
}

const composites = new Map<string, HTMLCanvasElement>();

/** Composite keys hold colour indices, not colours: forget them when the lineage palette changes (F8). */
export function clearComposites(): void { composites.clear(); }

interface Part { img: HTMLCanvasElement; x: number; y: number; rows?: number }

/**
 * Stacks sprites into one w×h canvas (later parts on top, `rows` limits a part to its top
 * rows), optionally mirrored. Builds the packed pixels too, like every other sprite.
 */
function compose(key: string, w: number, h: number, parts: Part[], flip = false): HTMLCanvasElement {
  let c = composites.get(key);
  if (c) return c;
  const data = new Uint32Array(w * h);
  for (const part of parts) {
    const px = spritePixels(part.img)!;
    const rows = Math.min(px.h, part.rows ?? px.h);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < px.w; x++) {
        const v = px.data[y * px.w + x]!;
        const dx = part.x + x;
        const dy = part.y + y;
        if (v === 0 || dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
        data[dy * w + (flip ? w - 1 - dx : dx)] = v;
      }
    }
  }
  c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.slice().buffer), w, h), 0, 0);
  pixelsByCanvas.set(c, { w, h, data });
  composites.set(key, c);
  return c;
}

const lookKey = (p: PersonLook): string =>
  `${p.female ? 1 : 0}|${p.ageClass}|${p.colorIndex}|${p.skin}|${p.hair}|${p.clothed ? 1 : 0}`;

/** Hunter (§19.2): the adult with the spear drawn at (+4, 0) from the adult's top-left, 5×6 in total. */
export function hunterSprite(p: PersonLook, frame: 1 | 2): HTMLCanvasElement {
  const body = personSprite(p, frame);
  return compose(`hunter|${lookKey(p)}|${frame}`, 5, body.height,
    [{ img: body, x: 0, y: 0 }, { img: getSprite('spear'), x: 4, y: 0 }]);
}

/**
 * Rider (§19.3): horse_n at (0, +2), then the top 4 rows of the adult (head, face, arms,
 * body) at (+1, 0) → 7×7. Faces right like the horse; `flip` faces left.
 */
export function riderSprite(p: PersonLook, frame: 1 | 2, flip: boolean): HTMLCanvasElement {
  return compose(`rider|${lookKey(p)}|${frame}|${flip ? 1 : 0}`, 7, 7, [
    { img: getSprite(`horse_${frame}`), x: 0, y: 2 },
    { img: personSprite(p, 1), x: 1, y: 0, rows: 4 },
  ], flip);
}

/** Draws a sprite with its bottom-centre at (x, y), on integer pixels. */
export function drawAnchored(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number): void {
  ctx.drawImage(img, Math.round(x) - (img.width >> 1), Math.round(y) - img.height);
}
