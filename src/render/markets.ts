// G1 markets on the map (pixel-ages-towns-plan.md §5), visual only (Math.random is fine here):
// villagers who sold food last year walk it to their market town and back (carts with the Cart),
// and a small crowd from the selling villages stands at the market's stalls.

import { CONFIG } from '../config';
import { Discovery, has } from '../shared/discoveries';
import type { GroupView } from '../shared/protocol';
import { AgeClass, personSprite, type PersonLook } from './sprites';
import { Carriers } from './carriers';

const RT = CONFIG.render.towns;

interface Shopper { x: number; y: number; phase: number; look: PersonLook }

export class MarketLayer {
  private key = '';
  private readonly carriers = new Carriers(RT.carriersMax, RT.carrierSpeedPx, RT.carrierRestMs);
  private crowd: Shopper[] = [];

  /** The frame's groups, and where the market stalls stand (from the building layer). */
  update(groups: readonly GroupView[], stalls: ReadonlyArray<{ x: number; y: number }>): void {
    const sellers = groups.filter((g) => g.sells && g.marketId >= 0);
    const key = sellers.map((g) => `${g.id}>${g.marketId}:${g.homeX},${g.homeY}`).join('|') + '/' + stalls.map((s) => `${s.x},${s.y}`).join('|');
    if (key === this.key) return;
    this.key = key;
    const byId = new Map(groups.map((g) => [g.id, g] as const));
    this.carriers.update(sellers.filter((g) => byId.has(g.marketId)).map((g) => {
      const m = byId.get(g.marketId)!;
      return { fromX: g.homeX, fromY: g.homeY, toX: m.homeX, toY: m.homeY, cart: has(g.discoveries, Discovery.cart), colorIndex: g.colourIndex };
    }));
    // Shoppers stand in front of the stalls, in the colours of the villages that come to market.
    this.crowd = [];
    for (const m of groups.filter((g) => g.market)) {
      const near = stalls.filter((st) => Math.abs(st.x / CONFIG.map.tilePx - (m.homeX + 0.5)) <= 2 && Math.abs(st.y / CONFIG.map.tilePx - (m.homeY + 1)) <= 2);
      if (near.length === 0) continue;
      const colours = [m.colourIndex, ...sellers.filter((g) => g.marketId === m.id).map((g) => g.colourIndex)];
      const n = Math.min(RT.crowdMax, 2 * colours.length);
      for (let k = 0; k < n; k++) {
        const st = near[k % near.length]!;
        this.crowd.push({
          x: st.x + (Math.random() - 0.5) * 8, y: st.y + 3 + Math.random() * 3, phase: Math.random() * 6.28,
          look: { female: Math.random() < 0.5, ageClass: AgeClass.Adult, colorIndex: colours[k % colours.length]!,
            skin: Math.floor(Math.random() * 3), hair: Math.floor(Math.random() * 3), clothed: true },
        });
      }
    }
  }

  animate(dtMs: number, playing: boolean): void { this.carriers.animate(dtMs, playing); }

  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    this.carriers.collect(nowMs, push);
    for (const p of this.crowd) {
      // Shoppers shift from foot to foot (render-only trig).
      const frame = (Math.sin(nowMs / 400 + p.phase) > 0 ? 1 : 2) as 1 | 2;
      push(personSprite(p.look, frame), p.x, p.y);
    }
  }

  clear(): void {
    this.key = '';
    this.carriers.clear();
    this.crowd = [];
  }
}
