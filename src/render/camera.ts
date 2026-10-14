// 1× / 2× zoom and pan (§18.8). Positions are in map pixels (1280 × 720 at 1×).

import { CONFIG } from '../config';

export class Camera {
  zoom = 1;
  ox = 0;                        // top-left of the visible part, map px
  oy = 0;

  constructor(private readonly mapW: number, private readonly mapH: number) {}

  get viewW(): number { return this.mapW / this.zoom; }
  get viewH(): number { return this.mapH / this.zoom; }

  /** Toggles zoom, centred on (cx, cy) in map px. */
  toggle(cx: number, cy: number): void {
    this.zoom = this.zoom === 1 ? CONFIG.render.zoom : 1;
    this.ox = cx - this.viewW / 2;
    this.oy = cy - this.viewH / 2;
    this.clamp();
  }

  pan(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
    this.clamp();
  }

  /** Centres the view on (cx, cy) when zoomed. */
  centreOn(cx: number, cy: number): void {
    if (this.zoom === 1) return;
    this.ox = cx - this.viewW / 2;
    this.oy = cy - this.viewH / 2;
    this.clamp();
  }

  private clamp(): void {
    this.ox = Math.round(Math.min(this.mapW - this.viewW, Math.max(0, this.ox)));
    this.oy = Math.round(Math.min(this.mapH - this.viewH, Math.max(0, this.oy)));
  }

  /** Canvas pixel (as drawn at 1×) → map pixel. */
  toMap(canvasX: number, canvasY: number): { x: number; y: number } {
    return { x: this.ox + canvasX / this.zoom, y: this.oy + canvasY / this.zoom };
  }

  apply(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, -this.ox * this.zoom, -this.oy * this.zoom);
  }
}
