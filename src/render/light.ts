// Day and night (F8 §14.2). Visual only: the simulation has months, not hours, so the day is a
// real-time cycle that runs while the world plays. Night darkens the map toward deep blue
// (multiply), then fires and lit windows glow on top (additive light).

import { CONFIG } from '../config';
import { hexToRgb, PALETTE } from './palette';

const L = CONFIG.render.f8.light;
const NIGHT = hexToRgb(PALETTE.night);

/**
 * Darkness 0 (day) … 1 (deep night) at `phase` 0–1 of the day. The day starts at sunrise; dusk
 * and dawn each take `dusk` of the cycle; night takes `nightShare`.
 */
export function darknessAt(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const dayEnd = 1 - L.nightShare - 2 * L.dusk;
  if (p < dayEnd) return 0;
  if (p < dayEnd + L.dusk) return (p - dayEnd) / L.dusk;
  if (p < dayEnd + L.dusk + L.nightShare) return 1;
  return 1 - (p - dayEnd - L.dusk - L.nightShare) / L.dusk;
}

/** A soft round light, drawn additively. Built once per radius and colour. */
const glows = new Map<string, HTMLCanvasElement>();
export function glowSprite(radius: number, colour: string): HTMLCanvasElement {
  const key = `${radius}|${colour}`;
  let c = glows.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = radius * 2;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  g.addColorStop(0, colour);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, radius * 2, radius * 2);
  glows.set(key, c);
  return c;
}

export class DayNight {
  private clockMs = L.dayMs * 0.1;   // start in the morning
  enabled = true;
  /** Darkness 0–1 right now (0 when switched off). */
  darkness = 0;

  /** Advances the day while the world plays. */
  update(dtMs: number, playing: boolean): void {
    if (playing) this.clockMs += dtMs;
    this.darkness = this.enabled ? darknessAt(this.clockMs / L.dayMs) : 0;
  }

  /** Night tint over the visible map (`w` × `h` map px from the camera's top-left). */
  drawTint(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const d = this.darkness * L.maxDark;
    if (d <= 0) return;
    const r = Math.round(255 - (255 - NIGHT[0]) * d);
    const g = Math.round(255 - (255 - NIGHT[1]) * d);
    const b = Math.round(255 - (255 - NIGHT[2]) * d);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /** Additive glows: [x, y, radius] triples in map px. */
  drawLights(ctx: CanvasRenderingContext2D, lights: ArrayLike<number>, count: number): void {
    if (this.darkness <= 0 || count === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, this.darkness);
    for (let k = 0; k < count; k++) {
      const x = lights[k * 3]!, y = lights[k * 3 + 1]!, r = lights[k * 3 + 2]!;
      const img = glowSprite(r, 'rgba(255,170,70,0.55)');
      ctx.drawImage(img, x - r, y - r);
    }
    ctx.restore();
  }
}
