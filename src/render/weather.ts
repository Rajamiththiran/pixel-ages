// Weather (F8 §14.2), visual only. Clouds drift across the map; where they pass over land that
// gets rain right now, rain (or, in winter on cold ground, snow) falls under them. Their
// shadows slide over the land. Where this year is far drier than the painted rain the ground
// cracks; far wetter, puddles stand.

import { CONFIG } from '../config';
import { Ground, Plant, WallType } from '../shared/ids';
import { hash01 } from '../shared/hash';
import type { MapData } from '../shared/types';
import { RGBS } from './palette';
import { TintClass, tintClass } from './season';

const W = CONFIG.render.f8.weather;
const TILE = CONFIG.map.tilePx;

/** Smooth value noise 0–1 from hashed lattice points (two octaves). */
export function cloudNoise(x: number, y: number): number {
  const octave = (fx: number, fy: number, salt: number): number => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const ax = fx - x0, ay = fy - y0;
    const sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay);
    const a = hash01(x0, y0, salt), b = hash01(x0 + 1, y0, salt);
    const c = hash01(x0, y0 + 1, salt), d = hash01(x0 + 1, y0 + 1, salt);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  return 0.65 * octave(x, y, 91) + 0.35 * octave(x * 2.1, y * 2.1, 93);
}

const Kind = { Rain: 0, Snow: 1 } as const;

export class Weather {
  private readonly cw: number;
  private readonly ch: number;
  private readonly cloud: Float32Array;        // 0–1 density per cell
  private readonly cellRain: Float32Array;     // rain now 0–1 per cell (land only)
  private readonly cellCold: Uint8Array;       // cell has cold ground (snow in winter)
  private readonly shadow: HTMLCanvasElement;
  private readonly shadowImg: ImageData;
  private readonly ground: HTMLCanvasElement;  // cracks and puddles, full resolution
  private readonly groundImg: ImageData;
  private groundState: Uint8Array;             // per tile: 0 none, 1 cracks, 2 puddles
  private groundTiles = 0;                     // tiles with cracks or puddles (nothing to draw at 0)
  private lastUpdate = -Infinity;
  private t = 0;                               // seconds of drift
  private map: MapData;
  private base: Uint8Array | null = null;      // painted rain
  // Particles: struct of arrays.
  private readonly px = new Float32Array(W.maxDrops);
  private readonly py = new Float32Array(W.maxDrops);
  private readonly age = new Float32Array(W.maxDrops);
  private readonly life = new Float32Array(W.maxDrops);
  private readonly kind = new Uint8Array(W.maxDrops);
  private count = 0;
  enabled = true;
  /** Share of visible cells with rain falling now, and with snow (for sound). */
  rainOnScreen = 0;
  snowOnScreen = 0;

  constructor(map: MapData) {
    this.map = map;
    this.cw = Math.ceil(map.width / W.cellTiles);
    this.ch = Math.ceil(map.height / W.cellTiles);
    this.cloud = new Float32Array(this.cw * this.ch);
    this.cellRain = new Float32Array(this.cw * this.ch);
    this.cellCold = new Uint8Array(this.cw * this.ch);
    this.shadow = document.createElement('canvas');
    this.shadow.width = this.cw;
    this.shadow.height = this.ch;
    this.shadowImg = this.shadow.getContext('2d')!.createImageData(this.cw, this.ch);
    this.ground = document.createElement('canvas');
    this.ground.width = map.width * TILE;
    this.ground.height = map.height * TILE;
    this.groundImg = this.ground.getContext('2d')!.createImageData(this.ground.width, this.ground.height);
    this.groundState = new Uint8Array(map.width * map.height);
    this.rainChanged();
  }

  setMap(map: MapData, base: Uint8Array | null): void {
    this.map = map;
    this.base = base;
    this.count = 0;
    this.groundState.fill(0);
    this.groundTiles = 0;
    this.groundImg.data.fill(0);
    this.ground.getContext('2d')!.putImageData(this.groundImg, 0, 0);
    this.rainChanged();
  }

  /** Rain now changed (or the land did): recompute per-cell rain and the cracks and puddles. */
  rainChanged(): void {
    const m = this.map;
    const C = W.cellTiles;
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        let sum = 0, n = 0, cold = 0;
        for (let y = cy * C; y < Math.min(m.height, cy * C + C); y++) {
          for (let x = cx * C; x < Math.min(m.width, cx * C + C); x++) {
            const i = y * m.width + x;
            sum += m.rain[i]!; n++;
            if (tintClass(m, i) === TintClass.Cold) cold++;
          }
        }
        const k = cy * this.cw + cx;
        this.cellRain[k] = n > 0 ? sum / n / 100 : 0;
        this.cellCold[k] = cold * 2 >= n ? 1 : 0;
      }
    }
    this.updateGround();
  }

  private updateGround(): void {
    const m = this.map;
    const base = this.base;
    if (!base) return;
    const d = this.groundImg.data;
    const imgW = this.ground.width;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let i = 0; i < this.groundState.length; i++) {
      let st = 0;
      const open = m.wall[i] === WallType.None && m.plantType[i] !== Plant.Forest
        && (m.ground[i] === Ground.Grassland || m.ground[i] === Ground.Desert);
      if (open && base[i]! > 0) {
        const ratio = m.rain[i]! / base[i]!;
        if (ratio < W.droughtBelow) st = 1;
        else if (ratio > W.wetAbove && m.ground[i] === Ground.Grassland) st = 2;
      }
      if (st === this.groundState[i]) continue;
      this.groundTiles += (st !== 0 ? 1 : 0) - (this.groundState[i] !== 0 ? 1 : 0);
      this.groundState[i] = st;
      const tx = i % m.width, ty = (i - tx) / m.width;
      for (let oy = 0; oy < TILE; oy++) {
        for (let ox = 0; ox < TILE; ox++) {
          const x = tx * TILE + ox, y = ty * TILE + oy;
          const o = (y * imgW + x) * 4;
          d[o + 3] = 0;
          if (st === 1 && isCrack(x, y)) { d[o] = RGBS.darkWood[0]; d[o + 1] = RGBS.darkWood[1]; d[o + 2] = RGBS.darkWood[2]; d[o + 3] = 150; }
          if (st === 2 && isPuddle(x, y)) { d[o] = RGBS.waterLight[0]; d[o + 1] = RGBS.waterLight[1]; d[o + 2] = RGBS.waterLight[2]; d[o + 3] = 200; }
        }
      }
      minX = Math.min(minX, tx); maxX = Math.max(maxX, tx); minY = Math.min(minY, ty); maxY = Math.max(maxY, ty);
    }
    if (maxX >= 0) {
      this.ground.getContext('2d')!.putImageData(this.groundImg, 0, 0, minX * TILE, minY * TILE, (maxX - minX + 1) * TILE, (maxY - minY + 1) * TILE);
    }
  }

  /**
   * Moves the clouds and the rain. `view` is the visible map rectangle (px); `winter` the
   * eased winter weight (snow instead of rain on cold ground above 0.5).
   */
  update(nowMs: number, dtMs: number, view: { x: number; y: number; w: number; h: number }, winter: number, playing: boolean): void {
    if (!this.enabled) { this.count = 0; return; }
    this.t += (dtMs / 1000) * (playing ? 1 : 0.25);
    if (nowMs - this.lastUpdate >= W.updateMs) {
      this.lastUpdate = nowMs;
      this.updateClouds();
    }
    // Age and drop old particles.
    const dt = dtMs / 1000;
    let k = 0;
    while (k < this.count) {
      this.age[k] = this.age[k]! + dtMs;
      if (this.age[k]! >= this.life[k]!) { this.remove(k); continue; }
      k++;
    }
    // Spawn under clouds in view.
    const cellPx = W.cellTiles * TILE;
    const c0x = Math.max(0, Math.floor(view.x / cellPx)), c1x = Math.min(this.cw - 1, Math.floor((view.x + view.w) / cellPx));
    const c0y = Math.max(0, Math.floor(view.y / cellPx)), c1y = Math.min(this.ch - 1, Math.floor((view.y + view.h) / cellPx));
    let rainy = 0, snowy = 0, cells = 0;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        cells++;
        const c = cy * this.cw + cx;
        const rain = this.cellRain[c]! * 100;
        const dens = this.cloud[c]!;
        if (dens <= 0 || rain < W.rainAbove) continue;
        const snow = winter > 0.5 && this.cellCold[c] === 1;
        if (snow) snowy++; else rainy++;
        // Expected drops this frame; the fraction is drawn by chance (visual only).
        let n = dens * (rain / 100) * W.dropsPerCellPerS * dt * (snow ? 0.6 : 1) * (playing ? 1 : 0.4);
        while (n > 0 && this.count < W.maxDrops) {
          if (n < 1 && Math.random() > n) break;
          n -= 1;
          const j = this.count++;
          this.px[j] = (cx + Math.random()) * cellPx;
          this.py[j] = (cy + Math.random()) * cellPx - (snow ? W.snowFallPx : W.dropFallPx);
          this.age[j] = 0;
          this.kind[j] = snow ? Kind.Snow : Kind.Rain;
          this.life[j] = (snow ? W.snowMs : W.dropMs) * (0.7 + 0.6 * Math.random());
        }
      }
    }
    this.rainOnScreen = cells > 0 ? rainy / cells : 0;
    this.snowOnScreen = cells > 0 ? snowy / cells : 0;
  }

  private remove(k: number): void {
    const last = --this.count;
    this.px[k] = this.px[last]!; this.py[k] = this.py[last]!; this.age[k] = this.age[last]!;
    this.life[k] = this.life[last]!; this.kind[k] = this.kind[last]!;
  }

  private updateClouds(): void {
    const drift = (this.t * W.windPxPerS) / (W.cellTiles * TILE);
    const d = this.shadowImg.data;
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        const c = cy * this.cw + cx;
        const n = cloudNoise((cx - drift) / W.scaleCells, (cy - drift * 0.35) / W.scaleCells);
        // Wetter land is cloudier: the cloud threshold falls as rain rises.
        const threshold = 1 - W.cover * Math.max(0.15, this.cellRain[c]!);
        const dens = n > threshold ? Math.min(1, (n - threshold) / Math.max(0.05, 1 - threshold) * 2) : 0;
        this.cloud[c] = dens;
        d[c * 4] = 10; d[c * 4 + 1] = 12; d[c * 4 + 2] = 30;
        d[c * 4 + 3] = Math.round(255 * dens * W.shadowAlpha);
      }
    }
    this.shadow.getContext('2d')!.putImageData(this.shadowImg, 0, 0);
  }

  /** Cracks and puddles: under the sprites. */
  drawGround(ctx: CanvasRenderingContext2D): void {
    if (this.base && this.groundTiles > 0) ctx.drawImage(this.ground, 0, 0);
  }

  /** Cloud shadows and falling rain or snow: over everything on the ground. */
  drawSky(ctx: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    const cellPx = W.cellTiles * TILE;
    ctx.drawImage(this.shadow, W.shadowOffsetPx, W.shadowOffsetPx, this.cw * cellPx, this.ch * cellPx);
    ctx.restore();
    ctx.fillStyle = `rgba(${RGBS.waterLight.join(',')},0.75)`;
    for (let k = 0; k < this.count; k++) {
      if (this.kind[k] !== Kind.Rain) continue;
      const t = this.age[k]! / this.life[k]!;
      const x = Math.round(this.px[k]! - t * 3), y = Math.round(this.py[k]! + t * W.dropFallPx);
      if (t > 0.9) ctx.fillRect(x - 1, y + 1, 3, 1);     // splash
      else ctx.fillRect(x, y, 1, 2);
    }
    ctx.fillStyle = `rgba(${RGBS.snow.join(',')},0.9)`;
    for (let k = 0; k < this.count; k++) {
      if (this.kind[k] !== Kind.Snow) continue;
      const t = this.age[k]! / this.life[k]!;
      // Render-only, so Math.sin is fine: flakes sway as they fall.
      const x = Math.round(this.px[k]! + Math.sin(t * 9 + k) * 1.5), y = Math.round(this.py[k]! + t * W.snowFallPx);
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** Dried-mud cracks: two sets of broken diagonal lines. */
function isCrack(x: number, y: number): boolean {
  const a = ((x + 2 * y) % 7 + 7) % 7 === 0 && hash01(x >> 2, y >> 1, 95) < 0.7;
  const b = ((2 * x - y) % 9 + 9) % 9 === 0 && hash01(x >> 1, y >> 2, 96) < 0.6;
  return (a || b) && hash01(x, y, 97) < W.crackShare * 6;
}

/** Puddles: a few small ovals per wet tile. */
function isPuddle(x: number, y: number): boolean {
  const cx = Math.floor(x / 4), cy = Math.floor(y / 3);
  if (hash01(cx, cy, 98) >= W.puddleShare * 4) return false;
  const ox = cx * 4 + 1.5, oy = cy * 3 + 1;
  const dx = (x - ox) / 1.6, dy = (y - oy) / 0.9;
  return dx * dx + dy * dy <= 1;
}
