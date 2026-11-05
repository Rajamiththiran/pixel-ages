// People (or carts) walking a fixed route back and forth with a load: C4 tribute bearers to a
// capital, G1 villagers taking food to market. Visual only (Math.random is fine here).

import { CONFIG } from '../config';
import { AgeClass, carrySprite, getSprite, personSprite, type PersonLook } from './sprites';

const TILE = CONFIG.map.tilePx;

/** A route between two homes (tiles); the carrier wears the colour of the group it walks for. */
export interface Route { fromX: number; fromY: number; toX: number; toY: number; cart: boolean; colorIndex: number }

interface Carrier {
  fromX: number; fromY: number; toX: number; toY: number;   // map px: feet at the two homes
  t: number;                     // 0–1 along the way
  out: boolean;                  // walking out (carrying) or home (empty-handed)
  restMs: number;                // waiting at an end
  cart: boolean;
  look: PersonLook;
}

export class Carriers {
  private list: Carrier[] = [];

  /** `max` carriers at most; `speedPx` map px a second; `restMs` the average wait at each end. */
  constructor(private readonly max: number, private readonly speedPx: number, private readonly restMs: number) {}

  /** One carrier per route, kept where it was if the same route is still walked. */
  update(routes: readonly Route[]): void {
    const next: Carrier[] = [];
    for (const r of routes) {
      if (next.length >= this.max) break;
      const fromX = (r.fromX + 0.5) * TILE, fromY = (r.fromY + 1) * TILE;
      const toX = (r.toX + 0.5) * TILE, toY = (r.toY + 1) * TILE;
      const old = this.list.find((c) => c.fromX === fromX && c.fromY === fromY && c.toX === toX && c.toY === toY);
      next.push(old ?? {
        fromX, fromY, toX, toY, t: Math.random(), out: Math.random() < 0.5, restMs: 0, cart: r.cart,
        look: { female: Math.random() < 0.3, ageClass: AgeClass.Adult, colorIndex: r.colorIndex,
          skin: Math.floor(Math.random() * 3), hair: Math.floor(Math.random() * 3), clothed: true },
      });
    }
    this.list = next;
  }

  animate(dtMs: number, playing: boolean): void {
    const step = dtMs * (playing ? 1 : 0.3);
    for (const c of this.list) {
      if (c.restMs > 0) { c.restMs -= step; continue; }
      const len = Math.max(1, Math.hypot(c.toX - c.fromX, c.toY - c.fromY));
      c.t += (this.speedPx * step) / 1000 / len;
      if (c.t >= 1) { c.t = 0; c.out = !c.out; c.restMs = this.restMs * (0.5 + Math.random()); }
    }
  }

  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    const walk = (Math.floor(nowMs / 220) % 2 + 1) as 1 | 2;
    for (const c of this.list) {
      const [x0, y0, x1, y1] = c.out ? [c.fromX, c.fromY, c.toX, c.toY] : [c.toX, c.toY, c.fromX, c.fromY];
      const x = x0 + (x1 - x0) * c.t, y = y0 + (y1 - y0) * c.t;
      if (c.cart) push(getSprite('cart', {}, x1 < x0), x, y);
      else push(c.out ? carrySprite(c.look, 'basket', walk) : personSprite(c.look, walk), x, y);
    }
  }

  clear(): void { this.list = []; }
}
