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

function render(def: SpriteDef, vars: SpriteVars, flip: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = def.w;
  c.height = def.h;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < def.h; y++) {
    const row = def.rows[y]!;
    for (let x = 0; x < def.w; x++) {
      const col = charColor(row[x]!, vars);
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(flip ? def.w - 1 - x : x, y, 1, 1);
    }
  }
  return c;
}

const cache = new Map<string, HTMLCanvasElement>();

export function getSprite(name: string, vars: SpriteVars = {}, flip = false): HTMLCanvasElement {
  const key = `${name}|${vars.C ?? ''}|${vars.S ?? ''}|${vars.H ?? ''}|${vars.L ?? ''}|${flip ? 1 : 0}`;
  let c = cache.get(key);
  if (!c) {
    const def = SPRITES[name];
    if (!def) throw new Error(`Unknown sprite ${name}`);
    c = render(def, vars, flip);
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

/** Person sprite for walk frame 1 or 2. Elders use the adult grid with stoneLight hair. */
export function personSprite(p: PersonLook, frame: 1 | 2): HTMLCanvasElement {
  const C = GROUP_COLORS[p.colorIndex % GROUP_COLORS.length]!;
  const D = darken(C);
  const S = SKIN_COLORS[p.skin] ?? SKIN_COLORS[0];
  const H = p.ageClass === AgeClass.Elder ? ELDER_HAIR : (HAIR_COLORS[p.hair] ?? HAIR_COLORS[0]);
  const L = p.clothed ? D : S;
  const name = p.ageClass === AgeClass.Child
    ? `child_${frame}`
    : `${p.female ? 'adult_f' : 'adult_m'}_${frame}`;
  return getSprite(name, { C, D, S, H, L });
}

/** Draws a sprite with its bottom-centre at (x, y), on integer pixels. */
export function drawAnchored(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number): void {
  ctx.drawImage(img, Math.round(x) - (img.width >> 1), Math.round(y) - img.height);
}
