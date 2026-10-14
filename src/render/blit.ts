// Software sprite layer. Thousands of separate drawImage calls cost far more than copying the
// pixels ourselves: every sprite is pixel art (each pixel fully opaque or fully transparent),
// so each frame we clear one RGBA buffer, copy sprites into it in y order, upload it once
// and draw it once (§18.9: 60 fps with 6,000 people, 400 animals and 300 buildings).

import { spritePixels, type SpritePixels as Pixels } from './sprites';

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

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.w = width;
    this.h = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(width, height);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  begin(): void {
    // Clear only the rows used last frame.
    if (this.lastMaxY >= this.lastMinY) this.buf.fill(0, this.lastMinY * this.w, (this.lastMaxY + 1) * this.w);
    this.minY = Infinity;
    this.maxY = -1;
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
    return this.canvas;
  }
}
