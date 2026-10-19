// Zoom and pan (§18.8; F8 §14.6: 1× / 2× / 4× with the mouse wheel, smooth movement, follow
// cam). Positions are in map pixels (1280 × 720 at 1×). The camera eases toward its target;
// once it arrives it snaps to whole screen pixels so the pixel art stays crisp.

import { CONFIG } from '../config';

const CAM = CONFIG.render.f8.camera;

export class Camera {
  zoom = 1;
  ox = 0;                        // top-left of the visible part, map px
  oy = 0;
  private zt = 1;                // target zoom and target view centre
  private cxT: number;
  private cyT: number;
  private cx: number;
  private cy: number;
  /** A point to keep in the middle (the followed group's home), or null. */
  follow: { x: number; y: number } | null = null;

  constructor(private readonly mapW: number, private readonly mapH: number) {
    this.cx = this.cxT = mapW / 2;
    this.cy = this.cyT = mapH / 2;
  }

  get viewW(): number { return this.mapW / this.zoom; }
  get viewH(): number { return this.mapH / this.zoom; }
  get targetZoom(): number { return this.zt; }

  /** Next zoom level (1 → 2 → 4 → 1), centred on (cx, cy) in map px. */
  toggle(cx: number, cy: number): void {
    const levels: readonly number[] = CAM.zooms;
    const k = levels.indexOf(this.zt);
    this.setZoom(levels[(k + 1) % levels.length]!, cx, cy, false);
  }

  /** One wheel notch: in or out a level, keeping the map point under the cursor where it is. */
  wheel(dir: number, ax: number, ay: number): void {
    const levels: readonly number[] = CAM.zooms;
    const k = Math.max(0, levels.indexOf(this.zt));
    const next = levels[Math.max(0, Math.min(levels.length - 1, k + (dir < 0 ? 1 : -1)))]!;
    if (next !== this.zt) this.setZoom(next, ax, ay, true);
  }

  /** Zooms to `z`: around (ax, ay) kept in place (`anchor`), or centred on it. */
  setZoom(z: number, ax: number, ay: number, anchor: boolean): void {
    if (anchor) {
      // The anchor's share across the view stays the same.
      const fx = (ax - (this.cxT - this.mapW / this.zt / 2)) / (this.mapW / this.zt);
      const fy = (ay - (this.cyT - this.mapH / this.zt / 2)) / (this.mapH / this.zt);
      this.cxT = ax - (fx - 0.5) * (this.mapW / z);
      this.cyT = ay - (fy - 0.5) * (this.mapH / z);
    } else {
      this.cxT = ax;
      this.cyT = ay;
    }
    this.zt = z;
    this.clampTarget();
  }

  pan(dx: number, dy: number): void {
    this.cxT += dx;
    this.cyT += dy;
    this.clampTarget();
    this.cx = this.cxT;
    this.cy = this.cyT;
    this.place();
  }

  /** Moves the view smoothly to centre (cx, cy); with `minZoom`, zooms in at least that far. */
  centreOn(cx: number, cy: number, minZoom = 1): void {
    if (this.zt < minZoom) this.zt = minZoom;
    if (this.zt === 1) return;
    this.cxT = cx;
    this.cyT = cy;
    this.clampTarget();
  }

  private clampTarget(): void {
    const hw = this.mapW / this.zt / 2, hh = this.mapH / this.zt / 2;
    this.cxT = Math.min(this.mapW - hw, Math.max(hw, this.cxT));
    this.cyT = Math.min(this.mapH - hh, Math.max(hh, this.cyT));
  }

  /** Eases toward the target (and the followed point). */
  update(dtMs: number): void {
    if (this.follow) {
      if (this.zt === 1) this.zt = CAM.zooms[1]!;
      this.cxT = this.follow.x;
      this.cyT = this.follow.y;
      this.clampTarget();
    }
    const k = 1 - Math.exp(-dtMs / (this.follow ? CAM.followEaseMs : CAM.easeMs));
    this.zoom += (this.zt - this.zoom) * k;
    this.cx += (this.cxT - this.cx) * k;
    this.cy += (this.cyT - this.cy) * k;
    if (Math.abs(this.zoom - this.zt) < 0.002 && Math.abs(this.cx - this.cxT) < 0.1 && Math.abs(this.cy - this.cyT) < 0.1) {
      this.zoom = this.zt;
      this.cx = this.cxT;
      this.cy = this.cyT;
    }
    this.place();
  }

  private place(): void {
    const w = this.viewW, h = this.viewH;
    let ox = Math.min(this.mapW - w, Math.max(0, this.cx - w / 2));
    let oy = Math.min(this.mapH - h, Math.max(0, this.cy - h / 2));
    // Settled: whole screen pixels, so pixel art stays crisp.
    if (this.zoom === this.zt) { ox = Math.round(ox * this.zoom) / this.zoom; oy = Math.round(oy * this.zoom) / this.zoom; }
    this.ox = ox;
    this.oy = oy;
  }

  /** Canvas pixel (as drawn at 1×) → map pixel. */
  toMap(canvasX: number, canvasY: number): { x: number; y: number } {
    return { x: this.ox + canvasX / this.zoom, y: this.oy + canvasY / this.zoom };
  }

  apply(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, -this.ox * this.zoom, -this.oy * this.zoom);
  }
}
