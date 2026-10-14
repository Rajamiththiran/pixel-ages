// Overlays (§18.7): area outlines (setup), rain view, hover outline, brush preview.

import { CONFIG } from '../config';
import type { MapData } from '../shared/types';
import type { AreaResult } from '../sim/world/regions';
import { areaName } from '../sim/world/regions';
import { RGBS } from './palette';

const TILE = CONFIG.map.tilePx;
const R = CONFIG.render;

/** Pre-rendered area outlines + labels. Rebuilt only when the areas change. */
export class AreaOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private areas: AreaResult | null = null;
  private hoverCanvas: HTMLCanvasElement;
  private hoverRegion = -2;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * TILE;
    this.canvas.height = height * TILE;
    this.ctx = this.canvas.getContext('2d')!;
    this.hoverCanvas = document.createElement('canvas');
    this.hoverCanvas.width = width;
    this.hoverCanvas.height = height;
  }

  get current(): AreaResult | null { return this.areas; }

  setAreas(a: AreaResult, width: number, height: number): void {
    this.areas = a;
    this.hoverRegion = -2;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // A single area has no borders worth showing.
    if (a.count < 2) return;
    ctx.fillStyle = `rgba(232, 226, 212, ${R.areaOutlineAlpha})`;
    const id = a.regionId;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const r = id[i]!;
        if (r < 0) continue;
        const px = x * TILE;
        const py = y * TILE;
        // 1 px line on this tile's side of every edge that leaves the area.
        if (y > 0 && id[i - width] !== r) ctx.fillRect(px, py, TILE, 1);
        if (y < height - 1 && id[i + width] !== r) ctx.fillRect(px, py + TILE - 1, TILE, 1);
        if (x > 0 && id[i - 1] !== r) ctx.fillRect(px, py, 1, TILE);
        if (x < width - 1 && id[i + 1] !== r) ctx.fillRect(px + TILE - 1, py, 1, TILE);
      }
    }
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let r = 0; r < a.count; r++) {
      if (a.tileCount[r]! < CONFIG.editor.areaLabelMinTiles) continue;
      // Top-left corner of the area: the centre is where people usually place groups.
      const first = a.firstTile[r]!;
      const cx = (first % width) * TILE + 3;
      const cy = Math.floor(first / width) * TILE + 3;
      ctx.fillStyle = 'rgba(28, 26, 36, 0.7)';
      ctx.fillText(areaName(r), cx + 1, cy + 1);
      ctx.fillStyle = '#e8e2d4';
      ctx.fillText(areaName(r), cx, cy);
    }
  }

  /** Fills one area at alpha 0.2 (used while picking an event area, step 6). */
  drawHover(ctx: CanvasRenderingContext2D, region: number, width: number, height: number): void {
    if (!this.areas || region < 0) return;
    if (region !== this.hoverRegion) {
      this.hoverRegion = region;
      const hctx = this.hoverCanvas.getContext('2d')!;
      const img = hctx.createImageData(width, height);
      const [r, g, b] = RGBS.stoneLight;
      for (let i = 0; i < width * height; i++) {
        if (this.areas.regionId[i] !== region) continue;
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = Math.round(255 * R.areaHoverAlpha);
      }
      hctx.putImageData(img, 0, 0);
    }
    ctx.drawImage(this.hoverCanvas, 0, 0, width * TILE, height * TILE);
  }
}

/** Rain view: waterLight over each tile with alpha = rain / 100 × 0.6. One pixel per tile, scaled up. */
export class RainOverlay {
  readonly canvas: HTMLCanvasElement;
  private dirty = true;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
  }

  invalidate(): void { this.dirty = true; }

  draw(ctx: CanvasRenderingContext2D, rain: Uint8Array, map: MapData): void {
    if (this.dirty) {
      this.dirty = false;
      const c = this.canvas.getContext('2d')!;
      const img = c.createImageData(map.width, map.height);
      const [r, g, b] = RGBS.waterLight;
      for (let i = 0; i < rain.length; i++) {
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = Math.round(255 * (rain[i]! / 100) * R.rainOverlayAlpha);
      }
      c.putImageData(img, 0, 0);
    }
    ctx.drawImage(this.canvas, 0, 0, map.width * TILE, map.height * TILE);
  }
}

export function drawHoverTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = `rgba(255, 255, 255, ${R.hoverOutlineAlpha})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
}

/** Faint circle showing the brush footprint. */
export function drawBrushPreview(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  if (size <= 1) return;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc((x + 0.5) * TILE, (y + 0.5) * TILE, (size / 2) * TILE, 0, Math.PI * 2);
  ctx.stroke();
}
