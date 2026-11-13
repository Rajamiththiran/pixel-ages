// Dawn mist (seasons plan Phase 7, mockup E). Bands of mist lie over water and the low land within
// reach of it, thickening late in the night and clearing as the dawn steps fall: the mockup's band
// formula, two mist-ramp steps, the Bayer matrix at the thin end. Owner decision S10 (the plan's
// recommendation): at dawns in spring and autumn, denser where the shown rain is high, and under the
// people (ground fog), so they stay readable. Drawing only.

import { CONFIG } from '../config';
import { hash01 } from '../shared/hash';
import type { MapData } from '../shared/types';
import { WallType } from '../shared/ids';
import { bayer } from './dither';
import { seasonRampRgb } from './ramps';
import { isWaterTile } from './terrainDetail';
import { heightAt } from './winter';

const TILE = CONFIG.map.tilePx;
const MC = CONFIG.render.seasons.mist;

/** Smooth value noise on an (sx, sy)-scaled lattice (the mockup's vn(x / 70, y / 26)). */
function noise(fx: number, fy: number, salt: number): number {
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay);
  const a = hash01(x0, y0, salt), b = hash01(x0 + 1, y0, salt), c = hash01(x0, y0 + 1, salt), d = hash01(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** Each pixel's mist density at full strength, 0–1 (the mockup's band formula). */
export function mistDensity(map: MapData): Float32Array {
  const w = map.width, h = map.height, pw = w * TILE, ph = h * TILE;
  // Tiles to the nearest water tile (8-way), capped past the mist's reach.
  const cap = Math.ceil(Math.max(MC.reachPx, MC.lowReachPx) / TILE) + 1;
  const dist = new Uint8Array(w * h).fill(cap);
  const queue: number[] = [];
  // Lakes, ponds and rivers; not the sea (the map's frame would wear a ring of mist).
  for (let i = 0; i < w * h; i++) if (isWaterTile(map, i) && map.wall[i] !== WallType.Sea) { dist[i] = 0; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!, x = i % w, y = (i - x) / w, d = dist[i]! + 1;
    if (d >= cap) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j]! > d) { dist[j] = d; queue.push(j); }
    }
  }
  const [bx, by] = MC.bandNoiseCellPx;
  const out = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) / TILE - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ay = fy - y0;
    for (let x = 0; x < pw; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) / TILE - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), ax = fx - x0;
      // Distance to water in px, smoothed between tile centres.
      const dpx = TILE * ((dist[y0 * w + x0]! * (1 - ax) + dist[y0 * w + x1]! * ax) * (1 - ay) + (dist[y1 * w + x0]! * (1 - ax) + dist[y1 * w + x1]! * ax) * ay);
      const near = Math.max(0, 1 - dpx / MC.reachPx);
      // Low land only within reach of water: on a flat map every pixel is low (the mockup's valley held water).
      const low = Math.max(0, Math.min(1, 1 - heightAt(map, x, y) / MC.lowBelow)) * Math.max(0, 1 - dpx / MC.lowReachPx);
      // Render only: Math.sin is fine here.
      const band = 0.5 + 0.5 * Math.sin(y / MC.bandPx + noise(x / bx!, y / by!, MC.salt) * MC.bandNoiseAmp);
      out[y * pw + x] = Math.max(MC.lowWeight * low, near) * band;
    }
  }
  return out;
}

/** The mist overlay: rebuilt only when its strength crosses a level or the rain changes. */
export class Mist {
  private density: Float32Array | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private img: ImageData | null = null;
  private key = '';
  private any = false;

  constructor(private map: MapData) {}

  /** A new map (the density is worked out again when next needed). */
  setMap(map: MapData): void { this.map = map; this.density = null; this.key = ''; }

  /**
   * Mist at `strength` (0–1: the dawn's thickness, 0 out of season), denser where `rain` (per tile,
   * 0–100) is high; `rainVersion` changes when the rain does.
   */
  update(strength: number, rain: ArrayLike<number>, rainVersion: number): void {
    const level = Math.round(Math.max(0, Math.min(1, strength)) * MC.levels);
    const key = level === 0 ? '0' : `${level}|${rainVersion}`;
    if (key === this.key) return;
    this.key = key;
    if (level === 0) { this.any = false; return; }
    const map = this.map, w = map.width, pw = w * TILE, ph = map.height * TILE;
    this.density ??= mistDensity(map);
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = pw; this.canvas.height = ph;
      this.img = this.canvas.getContext('2d')!.createImageData(pw, ph);
    }
    const px = new Uint32Array(this.img!.data.buffer);
    const ramp = seasonRampRgb('mist');
    const word = (s: number): number => ((255 << 24) | (ramp[s]![2] << 16) | (ramp[s]![1] << 8) | ramp[s]![0]) >>> 0;
    const thick = word(4), mid = word(3);
    const s = level / MC.levels;
    let any = false;
    for (let y = 0; y < ph; y++) {
      const row = Math.floor(y / TILE) * w;
      for (let x = 0; x < pw; x++) {
        const p = y * pw + x;
        const d = this.density[p]! * s * (MC.rainBase + MC.rainGain * rain[row + Math.floor(x / TILE)]! / 100);
        let c = 0;
        if (d > MC.thick) c = d > MC.thicker ? thick : mid;
        else if (d > MC.thin && bayer(x, y) < (d - MC.thin) * MC.ditherGain) c = mid;
        px[p] = c;
        if (c !== 0) any = true;
      }
    }
    this.any = any;
    if (any) this.canvas.getContext('2d')!.putImageData(this.img!, 0, 0);
  }

  /** Draws the mist (under the sprites: ground fog). */
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.any && this.canvas) ctx.drawImage(this.canvas, 0, 0);
  }

  /** Is there mist on screen now (tests)? */
  get showing(): boolean { return this.any; }
}
