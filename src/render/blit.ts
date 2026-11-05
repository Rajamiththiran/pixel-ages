// Software sprite layer. Thousands of separate drawImage calls cost far more than copying the
// pixels ourselves: every sprite is pixel art (each pixel fully opaque or fully transparent),
// so each frame we clear one RGBA buffer, copy sprites into it in y order, upload it once
// and draw it once (§18.9: 60 fps with 6,000 people, 400 animals and 300 buildings).

import { spritePixels, type SpritePixels as Pixels } from './sprites';
import { contactOn, shadowsOn, spriteShadow } from './shadows';

const SHADOW = 0xff000000;               // opaque black: a shadow mask pixel (ShadowPass colours it)

const cache = new WeakMap<HTMLCanvasElement, Pixels>();

/** The sprite's pixels as packed RGBA words: built with the sprite, else read once from the canvas. */
function pixelsOf(c: HTMLCanvasElement): Pixels {
  let px = spritePixels(c) ?? cache.get(c);
  if (!px) {
    const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    px = { w: c.width, h: c.height, data: new Uint32Array(img.data.buffer.slice(0)) };
    cache.set(c, px);
  }
  return px;
}

export class SpriteLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly buf: Uint32Array;
  private readonly w: number;
  private readonly h: number;
  // Rows touched this frame, so clearing and uploading skip the empty parts of the map.
  private minY = Infinity;
  private maxY = -1;
  private lastMinY = 0;
  private lastMaxY = -1;
  // Phase 3: cast shadows and contact lines of the sprites drawn this frame (mask, opaque = shadowed).
  readonly shadowCanvas: HTMLCanvasElement | null = null;
  private readonly shadowCtx: CanvasRenderingContext2D | null = null;
  private readonly shadowImg: ImageData | null = null;
  private readonly shadowBuf: Uint32Array | null = null;
  private sMinY = Infinity;
  private sMaxY = -1;
  private sLastMinY = 0;
  private sLastMaxY = -1;
  /** Sprites that cast no shadow (flames: they are light, not things). */
  readonly noShadow = new WeakSet<HTMLCanvasElement>();

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.w = width;
    this.h = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(width, height);
    this.buf = new Uint32Array(this.img.data.buffer);
    if (shadowsOn || contactOn) {
      this.shadowCanvas = document.createElement('canvas');
      this.shadowCanvas.width = width;
      this.shadowCanvas.height = height;
      this.shadowCtx = this.shadowCanvas.getContext('2d')!;
      this.shadowImg = this.shadowCtx.createImageData(width, height);
      this.shadowBuf = new Uint32Array(this.shadowImg.data.buffer);
    }
  }

  begin(): void {
    // Clear only the rows used last frame.
    if (this.lastMaxY >= this.lastMinY) this.buf.fill(0, this.lastMinY * this.w, (this.lastMaxY + 1) * this.w);
    this.minY = Infinity;
    this.maxY = -1;
    if (this.shadowBuf && this.sLastMaxY >= this.sLastMinY) this.shadowBuf.fill(0, this.sLastMinY * this.w, (this.sLastMaxY + 1) * this.w);
    this.sMinY = Infinity;
    this.sMaxY = -1;
  }

  /** Copies a sprite with its top-left at integer (x, y); transparent pixels are skipped. */
  blit(sprite: HTMLCanvasElement, x: number, y: number): void {
    const px = pixelsOf(sprite);
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + px.w);
    const y1 = Math.min(this.h, y + px.h);
    if (x0 >= x1 || y0 >= y1) return;
    const src = px.data;
    const dst = this.buf;
    for (let yy = y0; yy < y1; yy++) {
      let s = (yy - y) * px.w + (x0 - x);
      let d = yy * this.w + x0;
      for (let xx = x0; xx < x1; xx++, s++, d++) {
        const c = src[s]!;
        if (c !== 0) dst[d] = c;
      }
    }
    if (y0 < this.minY) this.minY = y0;
    if (y1 - 1 > this.maxY) this.maxY = y1 - 1;
    if (this.shadowBuf && !this.noShadow.has(sprite)) {
      const sh = spriteShadow(px);
      if (shadowsOn) this.stamp(sh.cast, x, y);
      if (contactOn) this.stamp(sh.contact, x, y);
    }
  }

  /** Marks a sprite's shadow pixels, (dx, dy) pairs from its top-left at (x, y). */
  private stamp(pairs: Int16Array, x: number, y: number): void {
    const buf = this.shadowBuf!;
    for (let k = 0; k < pairs.length; k += 2) {
      const sx = x + pairs[k]!, sy = y + pairs[k + 1]!;
      if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) continue;
      buf[sy * this.w + sx] = SHADOW;
      if (sy < this.sMinY) this.sMinY = sy;
      if (sy > this.sMaxY) this.sMaxY = sy;
    }
  }

  /** Uploads the rows used this frame (and last frame, to erase them) and returns the canvas. */
  end(): HTMLCanvasElement {
    const top = Math.min(this.minY, this.lastMinY);
    const bottom = Math.max(this.maxY, this.lastMaxY);
    if (bottom >= top && Number.isFinite(top)) {
      this.ctx.putImageData(this.img, 0, 0, 0, top, this.w, bottom - top + 1);
    }
    this.lastMinY = Number.isFinite(this.minY) ? this.minY : 0;
    this.lastMaxY = this.maxY;
    if (this.shadowCtx) {
      const st = Math.min(this.sMinY, this.sLastMinY), sb = Math.max(this.sMaxY, this.sLastMaxY);
      if (sb >= st && Number.isFinite(st)) this.shadowCtx.putImageData(this.shadowImg!, 0, 0, 0, st, this.w, sb - st + 1);
      this.sLastMinY = Number.isFinite(this.sMinY) ? this.sMinY : 0;
      this.sLastMaxY = this.sMaxY;
    }
    return this.canvas;
  }
}
