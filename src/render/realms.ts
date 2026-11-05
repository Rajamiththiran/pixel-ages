// C4 realms on the map (pixel-ages-c4-plan.md §5), visual only (Math.random is fine: nothing here
// reaches the simulation). Each realm's land is softly washed in its ruler's colour with a 1-px
// border (dotted for a chiefdom, solid for a kingdom), old and new borders cross-fade; the capital
// flies a banner, each subject a pennant in its ruler's colour; tribute bearers walk to the capital.

import { CONFIG } from '../config';
import { WallType } from '../shared/ids';
import { Discovery, has } from '../shared/discoveries';
import type { GroupView } from '../shared/protocol';
import type { MapData } from '../shared/types';
import { GROUP_COLORS, darken, hexToRgb } from './palette';
import { getSprite } from './sprites';
import { Carriers } from './carriers';

const RR = CONFIG.render.realms;
const TILE = CONFIG.map.tilePx;

/** Layers of one drawing of the borders: the wash (1 px per tile) and the border (map px). */
interface Drawing { fill: HTMLCanvasElement; border: HTMLCanvasElement }

const colourOf = (k: number): string => GROUP_COLORS[k % GROUP_COLORS.length]!;

export class RealmLayer {
  private key = '';
  private current: Drawing | null = null;
  private previous: Drawing | null = null;
  private changedMs = -Infinity;
  private flags: Array<{ x: number; y: number; name: string; C: string }> = [];
  private readonly bearers = new Carriers(RR.maxBearers, RR.bearerSpeedPx, RR.bearerRestMs);

  /** The frame's groups: rebuilds borders, flags and bearers when realms or homes change. */
  update(map: MapData, groups: readonly GroupView[], nowMs: number): void {
    const inRealm = groups.filter((g) => g.realmHead >= 0);
    const key = inRealm.map((g) => `${g.id}:${g.homeX},${g.homeY},${g.realmHead},${g.realmRank},${g.realmColour}`).join('|')
      + '/' + groups.filter((g) => g.realmHead < 0).map((g) => `${g.homeX},${g.homeY}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.previous = this.current;
    this.current = inRealm.length > 0 ? draw(map, groups) : null;
    this.changedMs = nowMs;
    this.flags = inRealm.map((g) => {
      const head = g.realmHead === g.id;
      return {
        x: (g.homeX + 1) * TILE, y: (g.homeY + 0.3) * TILE,
        name: head ? (g.realmRank === 2 ? 'banner_royal' : 'banner') : 'pennant',
        C: colourOf(g.realmColour),
      };
    });
    // One tribute bearer per subject, walking to its capital (a cart with the Cart).
    const byId = new Map(groups.map((g) => [g.id, g] as const));
    this.bearers.update(inRealm.filter((g) => g.realmHead !== g.id && byId.has(g.realmHead)).map((g) => {
      const ruler = byId.get(g.realmHead)!;
      return { fromX: g.homeX, fromY: g.homeY, toX: ruler.homeX, toY: ruler.homeY, cart: has(g.discoveries, Discovery.cart), colorIndex: g.colourIndex };
    }));
  }

  animate(dtMs: number, playing: boolean): void { this.bearers.animate(dtMs, playing); }


  /** The wash and border, over the ground and under sprites; cross-fading after a change. */
  drawGround(ctx: CanvasRenderingContext2D, nowMs: number): void {
    const t = Math.min(1, (nowMs - this.changedMs) / RR.fadeMs);
    if (this.previous && t < 1) paint(ctx, this.previous, 1 - t);
    else this.previous = null;
    if (this.current) paint(ctx, this.current, t);
  }

  /** Banners, pennants and bearers into the y-sorted sprite list. */
  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    const frame = Math.floor(nowMs / RR.bannerFrameMs) % 2 + 1;
    this.flags.forEach((f, k) => {
      push(getSprite(`${f.name}_${(frame + k) % 2 + 1}`, { C: f.C, D: darken(f.C) }), f.x, f.y);
    });
    this.bearers.collect(nowMs, push);
  }

  clear(): void {
    this.key = '';
    this.current = null;
    this.previous = null;
    this.flags = [];
    this.bearers.clear();
  }
}

function paint(ctx: CanvasRenderingContext2D, d: Drawing, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(d.fill, 0, 0, d.fill.width * TILE, d.fill.height * TILE);
  ctx.drawImage(d.border, 0, 0);
  ctx.restore();
}

/**
 * Each land tile within reach of a home belongs to the nearest home (ties → the lower id), as in
 * the territory fill; a realm's land is its members' tiles. Wall tiles (rivers, sea, mountains)
 * belong to nobody, so borders follow them.
 */
function draw(map: MapData, groups: readonly GroupView[]): Drawing {
  const w = map.width, h = map.height, n = w * h;
  const best = new Float64Array(n).fill(Infinity);
  const owner = new Int32Array(n).fill(-1);       // index into groups
  const R = RR.reachTiles;
  const sorted = groups.map((g, k) => [g, k] as const).sort((a, b) => a[0].id - b[0].id);
  for (const [g, k] of sorted) {
    for (let y = Math.max(0, g.homeY - R); y <= Math.min(h - 1, g.homeY + R); y++) {
      for (let x = Math.max(0, g.homeX - R); x <= Math.min(w - 1, g.homeX + R); x++) {
        const d = (x - g.homeX) ** 2 + (y - g.homeY) ** 2;
        const i = y * w + x;
        if (d > R * R || map.wall[i] !== WallType.None || d >= best[i]!) continue;
        best[i] = d;
        owner[i] = k;
      }
    }
  }
  // Realm id per tile (the ruler's group id), −1 for nobody's or a free group's land.
  const realm = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (owner[i]! >= 0) realm[i] = groups[owner[i]!]!.realmHead;
  const rank = new Map(groups.filter((g) => g.realmHead === g.id).map((g) => [g.id, g.realmRank] as const));
  const colour = new Map(groups.filter((g) => g.realmHead === g.id).map((g) => [g.id, g.realmColour] as const));

  const fill = document.createElement('canvas');
  fill.width = w; fill.height = h;
  const fctx = fill.getContext('2d')!;
  const img = fctx.createImageData(w, h);
  for (let i = 0; i < n; i++) {
    const r = realm[i]!;
    if (r < 0) continue;
    const [cr, cg, cb] = hexToRgb(colourOf(colour.get(r) ?? 0));
    img.data[i * 4] = cr; img.data[i * 4 + 1] = cg; img.data[i * 4 + 2] = cb;
    img.data[i * 4 + 3] = Math.round(255 * (rank.get(r) === 2 ? RR.kingdomFillAlpha : RR.fillAlpha));
  }
  fctx.putImageData(img, 0, 0);

  const border = document.createElement('canvas');
  border.width = w * TILE; border.height = h * TILE;
  const bctx = border.getContext('2d')!;
  bctx.globalAlpha = RR.borderAlpha;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = realm[i]!;
      if (r < 0) continue;
      bctx.fillStyle = colourOf(colour.get(r) ?? 0);
      const solid = rank.get(r) === 2;
      const px = x * TILE, py = y * TILE;
      // A 1-px line on this tile's side of every edge that leaves the realm; a chiefdom's is dotted.
      const line = (x0: number, y0: number, horizontal: boolean): void => {
        for (let k = 0; k < TILE; k += solid ? TILE : 2) {
          if (horizontal) bctx.fillRect(x0 + k, y0, solid ? TILE : 1, 1);
          else bctx.fillRect(x0, y0 + k, 1, solid ? TILE : 1);
        }
      };
      if (y === 0 || realm[i - w] !== r) line(px, py, true);
      if (y === h - 1 || realm[i + w] !== r) line(px, py + TILE - 1, true);
      if (x === 0 || realm[i - 1] !== r) line(px, py, false);
      if (x === w - 1 || realm[i + 1] !== r) line(px + TILE - 1, py, false);
    }
  }
  return { fill, border };
}
