// Effects (F8 §14.5), visual only (Math.random is fine: nothing here reaches the simulation).
// Wildfire flames and smoke on burning tiles; flood water that spreads out from the river and
// drains away (the silt it leaves is the look byte); rocks and dust where walls break or land
// slides; a sickly tint over villages with an outbreak; haze over cities; and a sparkle with
// the discovery's icon, or a golden ring for a new era, at the group's home.

import { CONFIG } from '../config';
import { Mode } from '../shared/ids';
import { Discovery, has } from '../shared/discoveries';
import { HazardMark, type GroupView } from '../shared/protocol';
import type { LogEntry, MapData } from '../shared/types';
import { hash01 } from '../shared/hash';
import { GROUP_COLORS, PALETTE, RGBS } from './palette';
import { getSprite } from './sprites';
import { discoveryIcon, discoveryInText, ERA_ICONS, iconSprite, realmIcon } from './icons';
import { isWaterTile } from './terrainDetail';
import { glowSprite } from './light';

const E = CONFIG.render.f8.effects;
const SM = CONFIG.render.f8.smoke;
const TILE = CONFIG.map.tilePx;
const RR = CONFIG.render.realms;

export const Particle = { Smoke: 0, Dust: 1, Spark: 2, Rock: 3, Ember: 4 } as const;
const COLOURS = [RGBS.stoneLight, RGBS.sand, RGBS.fireYellow, RGBS.stone, RGBS.fireOrange];

interface Burst { kind: 'icon' | 'glow'; x: number; y: number; start: number; ms: number; img: HTMLCanvasElement | null; colour?: string; radius?: number }

export interface View { x: number; y: number; w: number; h: number }

const inView = (v: View, x: number, y: number, pad = TILE * 2): boolean =>
  x >= v.x - pad && y >= v.y - pad && x <= v.x + v.w + pad && y <= v.y + v.h + pad;

export class Effects {
  private map: MapData;
  // Particles, struct of arrays.
  private readonly x = new Float32Array(E.maxParticles);
  private readonly y = new Float32Array(E.maxParticles);
  private readonly vx = new Float32Array(E.maxParticles);
  private readonly vy = new Float32Array(E.maxParticles);
  private readonly age = new Float32Array(E.maxParticles);
  private readonly life = new Float32Array(E.maxParticles);
  private readonly floorY = new Float32Array(E.maxParticles);
  private readonly kind = new Uint8Array(E.maxParticles);
  private count = 0;
  // Fire and flood tiles.
  private burning: number[] = [];
  private floodStart: Float64Array;
  private floodEnd: Float64Array;
  private floodTiles: number[] = [];
  private floodOn: Uint8Array;
  private floodListed: Uint8Array;           // in floodTiles (on, or still draining)
  private bursts: Burst[] = [];
  private groups: readonly GroupView[] = [];
  private nextFireSmoke = 0;
  // Smoke sources: chimneys and campfires (map px), set by the renderer from the decor layers.
  chimneys: ArrayLike<number> = [];
  fires: ArrayLike<number> = [];
  private nextChimney = 0;
  private nextCamp = 0;
  enabled = true;

  constructor(map: MapData) {
    this.map = map;
    const n = map.width * map.height;
    this.floodStart = new Float64Array(n);
    this.floodEnd = new Float64Array(n);
    this.floodOn = new Uint8Array(n);
    this.floodListed = new Uint8Array(n);
  }

  setMap(map: MapData): void { this.map = map; this.clear(); }

  clear(): void {
    this.count = 0;
    this.burning = [];
    this.floodTiles = [];
    this.floodOn.fill(0);
    this.floodListed.fill(0);
    this.bursts = [];
    this.groups = [];
  }

  setGroups(groups: readonly GroupView[]): void { this.groups = groups; }

  /**
   * Fire and flood bits changed on `tiles` ('all' after a jump in time: everything appears at
   * once). A new flood reaches each tile later the farther it lies from water, so it spreads.
   */
  hazardsChanged(hazards: Uint8Array, tiles: Iterable<number> | 'all', nowMs: number): void {
    const all = tiles === 'all';
    const list: Iterable<number> = all ? hazards.keys() : tiles;
    for (const i of list) {
      const flood = (hazards[i]! & HazardMark.Flood) !== 0;
      if (flood && !this.floodOn[i]) {
        this.floodOn[i] = 1;
        this.floodStart[i] = all ? nowMs - E.floodFadeMs : nowMs + this.distanceToWater(i) * E.floodSpreadMsPerTile;
        this.floodEnd[i] = Infinity;
        if (!this.floodListed[i]) { this.floodListed[i] = 1; this.floodTiles.push(i); }
      } else if (!flood && this.floodOn[i]) {
        this.floodOn[i] = 0;
        this.floodEnd[i] = all ? -Infinity : nowMs + this.distanceToWater(i) * E.floodSpreadMsPerTile * 0.5;
      }
    }
    if (all) {
      this.floodTiles = this.floodTiles.filter((i) => this.floodOn[i] === 1);
      this.floodListed.fill(0);
      for (const i of this.floodTiles) this.floodListed[i] = 1;
    }
    this.burning = [];
    for (let i = 0; i < hazards.length; i++) if (hazards[i]! & HazardMark.Fire) this.burning.push(i);
  }

  /** Chebyshev tiles to the nearest water, at most 6. */
  private distanceToWater(i: number): number {
    const m = this.map;
    const x0 = i % m.width, y0 = (i - x0) / m.width;
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = x0 + dx, y = y0 + dy;
          if (x >= 0 && y >= 0 && x < m.width && y < m.height && isWaterTile(m, y * m.width + x)) return r - 1;
        }
      }
    }
    return 6;
  }

  /** Live log entries: discoveries, new eras, breaches, quakes and slides get an effect. */
  onLog(entries: readonly LogEntry[], nowMs: number): void {
    if (!this.enabled) return;
    for (const e of entries) {
      if (e.x === null || e.y === null) continue;
      if (this.bursts.length >= E.maxBursts) break;
      const cx = (e.x + 0.5) * TILE, cy = (e.y + 0.5) * TILE;
      if (e.type === 'discovery') {
        const d = discoveryInText(e.text);
        this.bursts.push({ kind: 'icon', x: cx, y: cy - TILE, start: nowMs, ms: E.sparkleMs, img: iconSprite(d === null ? 'star' : discoveryIcon(d)) });
        for (let k = 0; k < E.sparkles; k++) this.spawn(Particle.Spark, cx + (Math.random() - 0.5) * 14, cy - Math.random() * 12, (Math.random() - 0.5) * 6, -4 - Math.random() * 6, E.sparkleMs * (0.4 + Math.random() * 0.6));
      } else if (e.type === 'eraUp') {
        const m = /era (\d)/.exec(e.text);
        this.bursts.push({ kind: 'glow', x: cx, y: cy, start: nowMs, ms: E.eraGlowMs, img: null });
        this.bursts.push({ kind: 'icon', x: cx, y: cy - TILE * 1.5, start: nowMs, ms: E.eraGlowMs, img: iconSprite(ERA_ICONS[m ? Number(m[1]) : 0] ?? 'star') });
      } else if (e.type === 'realm' && !e.minor) {
        this.realmMoment(e, cx, cy, nowMs);
      } else if (e.type === 'breach' || (e.type === 'event' && /earthquake/i.test(e.text)) || (e.type === 'hazard' && /slide|collapse/i.test(e.text))) {
        this.quake(cx, cy);
      }
    }
  }

  /**
   * C4 realm moments (plan §6): a village joins — a flag rises and a ring in the ruler's colour
   * spreads; a chiefdom — a golden ring, a crown and sparks; a kingdom — two rings and more sparks;
   * a revolt — a red ring, embers and smoke; a fall — dust over the old capital.
   */
  private realmMoment(e: LogEntry, cx: number, cy: number, nowMs: number): void {
    const icon = realmIcon(e.text);
    const ruler = this.groups.find((g) => g.id === e.groupId);
    const colour = GROUP_COLORS[(ruler && ruler.realmHead >= 0 ? ruler.realmColour : ruler?.colourIndex ?? 0) % GROUP_COLORS.length]!;
    const ring = (c: string, delay = 0): void => {
      this.bursts.push({ kind: 'glow', x: cx, y: cy, start: nowMs + delay, ms: RR.ringMs, img: null, colour: c, radius: RR.ringRadiusPx });
    };
    const sparks = (n: number): void => {
      for (let k = 0; k < n; k++) {
        this.spawn(Particle.Spark, cx + (Math.random() - 0.5) * 16, cy - Math.random() * 10, (Math.random() - 0.5) * 10, -5 - Math.random() * 8, RR.ringMs * (0.5 + Math.random() * 0.5));
      }
    };
    this.bursts.push({ kind: 'icon', x: cx, y: cy - TILE * 1.5, start: nowMs, ms: E.eraGlowMs, img: iconSprite(icon) });
    if (/became the Kingdom/.test(e.text)) {
      ring(PALETTE.fireYellow);
      ring(PALETTE.fireYellow, RR.kingdomRingDelayMs);
      sparks(RR.sparks * 2);
    } else if (/founded a chiefdom/.test(e.text)) {
      ring(PALETTE.fireYellow);
      sparks(RR.sparks);
    } else if (/rebelled|broke free/.test(e.text)) {
      ring(PALETTE.fruit);
      for (let k = 0; k < RR.sparks; k++) {
        this.spawn(Particle.Ember, cx + (Math.random() - 0.5) * 12, cy - Math.random() * 6, (Math.random() - 0.5) * 6, -6 - Math.random() * 6, RR.ringMs * (0.6 + Math.random() * 0.6));
        this.spawn(Particle.Smoke, cx + (Math.random() - 0.5) * 10, cy - TILE, (Math.random() - 0.5) * 3, -4 - Math.random() * 3, RR.ringMs * 1.5);
      }
    } else if (/fell apart|is no more/.test(e.text)) {
      for (let k = 0; k < RR.fallDust; k++) {
        this.spawn(Particle.Dust, cx + (Math.random() - 0.5) * TILE * 4, cy + (Math.random() - 0.5) * TILE * 3, (Math.random() - 0.5) * 8, -2 - Math.random() * 3, RR.ringMs * (0.8 + Math.random() * 0.6));
      }
    } else if (icon === 'flag') {
      ring(colour);
    }
  }

  /** Falling rocks and a dust cloud. */
  private quake(cx: number, cy: number): void {
    for (let k = 0; k < E.quakeRocks; k++) {
      const x = cx + (Math.random() - 0.5) * TILE * 3;
      const j = this.spawn(Particle.Rock, x, cy - TILE * 2 - Math.random() * TILE * 2, (Math.random() - 0.5) * 10, 0, E.quakeMs);
      if (j >= 0) this.floorY[j] = cy + (Math.random() - 0.5) * TILE * 2;
    }
    for (let k = 0; k < E.quakeDust; k++) {
      this.spawn(Particle.Dust, cx + (Math.random() - 0.5) * TILE * 3, cy + (Math.random() - 0.5) * TILE * 2, (Math.random() - 0.5) * 8, -2 - Math.random() * 3, E.quakeMs * (0.6 + Math.random() * 0.6));
    }
  }

  /** Adds a particle; returns its slot or -1 if the pool is full. */
  spawn(kind: number, x: number, y: number, vx: number, vy: number, life: number): number {
    if (this.count >= E.maxParticles) return -1;
    const j = this.count++;
    this.kind[j] = kind; this.x[j] = x; this.y[j] = y; this.vx[j] = vx; this.vy[j] = vy;
    this.age[j] = 0; this.life[j] = life; this.floorY[j] = Infinity;
    return j;
  }

  /** Battle dust and other effects other layers ask for. */
  puff(x: number, y: number): void {
    this.spawn(Particle.Dust, x, y, (Math.random() - 0.5) * 6, -3 - Math.random() * 3, 700 + Math.random() * 500);
  }

  update(nowMs: number, dtMs: number, view: View, windPxPerS: number): void {
    const dt = dtMs / 1000;
    let k = 0;
    while (k < this.count) {
      this.age[k] = this.age[k]! + dtMs;
      if (this.age[k]! >= this.life[k]!) { this.remove(k); continue; }
      const kd = this.kind[k]!;
      if (kd === Particle.Rock) {
        this.vy[k] = this.vy[k]! + 120 * dt;              // gravity, map px / s²
        if (this.y[k]! >= this.floorY[k]!) { this.y[k] = this.floorY[k]!; this.vx[k] = 0; this.vy[k] = 0; }
      } else if (kd === Particle.Smoke) {
        this.vx[k] = this.vx[k]! + (windPxPerS - this.vx[k]!) * Math.min(1, dt);
      }
      this.x[k] = this.x[k]! + this.vx[k]! * dt;
      this.y[k] = this.y[k]! + this.vy[k]! * dt;
      k++;
    }
    this.bursts = this.bursts.filter((b) => nowMs - b.start < b.ms);
    if (!this.enabled) return;
    // Smoke: burning tiles, chimneys, campfires (only in view, to spare the pool).
    if (nowMs >= this.nextFireSmoke && this.burning.length > 0) {
      this.nextFireSmoke = nowMs + E.fireSmokeEveryMs / Math.min(8, this.burning.length);
      const i = this.burning[Math.floor(Math.random() * this.burning.length)]!;
      const x = (i % this.map.width + Math.random()) * TILE, y = (Math.floor(i / this.map.width) + Math.random()) * TILE;
      if (inView(view, x, y)) {
        this.smoke(x, y, 1.6);
        this.spawn(Particle.Ember, x, y, (Math.random() - 0.5) * 4, -10 - Math.random() * 8, 600);
      }
    }
    const chimneys = this.chimneys.length / 2;
    if (chimneys > 0 && nowMs >= this.nextChimney) {
      this.nextChimney = nowMs + SM.houseEveryMs / Math.min(20, chimneys);
      const c = Math.floor(Math.random() * chimneys);
      const x = this.chimneys[c * 2]!, y = this.chimneys[c * 2 + 1]!;
      if (inView(view, x, y)) this.smoke(x, y, 1);
    }
    const fires = this.fires.length / 2;
    if (fires > 0 && nowMs >= this.nextCamp) {
      this.nextCamp = nowMs + SM.fireEveryMs / Math.min(12, fires);
      const c = Math.floor(Math.random() * fires);
      const x = this.fires[c * 2]!, y = this.fires[c * 2 + 1]!;
      if (inView(view, x, y)) this.smoke(x, y - 2, 0.8);
    }
  }

  private smoke(x: number, y: number, scale: number): void {
    this.spawn(Particle.Smoke, x, y, (Math.random() - 0.5) * 2, -SM.risePx / (SM.puffMs / 1000) * scale, SM.puffMs * (0.7 + Math.random() * 0.6) * scale);
  }

  private remove(k: number): void {
    const last = --this.count;
    this.kind[k] = this.kind[last]!; this.x[k] = this.x[last]!; this.y[k] = this.y[last]!;
    this.vx[k] = this.vx[last]!; this.vy[k] = this.vy[last]!; this.age[k] = this.age[last]!;
    this.life[k] = this.life[last]!; this.floorY[k] = this.floorY[last]!;
  }

  /** Flames on burning tiles go into the y-sorted sprite list. */
  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    const w = this.map.width;
    for (const i of this.burning) {
      const tx = i % w, ty = (i - tx) / w;
      for (let k = 0; k < E.flamesPerTile; k++) {
        const fx = (tx + 0.15 + 0.7 * hash01(i, k, 301)) * TILE;
        const fy = (ty + 0.3 + 0.7 * hash01(i, k, 302)) * TILE;
        const frame = (Math.floor(nowMs / E.flameFrameMs) + k + i) % 2 === 0 ? 'flame_1' : 'flame_2';
        push(getSprite(frame), fx, fy);
      }
    }
  }

  /** Night lights from burning tiles: [x, y, r] triples appended to `out` from `n`; returns the new count. */
  addLights(out: number[], n: number): number {
    const w = this.map.width;
    const r = CONFIG.render.f8.light.fireGlowRadiusPx;
    for (const i of this.burning) {
      out[n * 3] = (i % w + 0.5) * TILE; out[n * 3 + 1] = (Math.floor(i / w) + 0.5) * TILE; out[n * 3 + 2] = r;
      n++;
    }
    return n;
  }

  /** Flood water (spreading in, draining out) with ripples, city haze and sick villages: over the ground, under sprites. */
  drawGround(ctx: CanvasRenderingContext2D, nowMs: number): void {
    if (this.floodTiles.length > 0) {
      const w = this.map.width;
      const keep: number[] = [];
      ctx.save();
      ctx.fillStyle = PALETTE.water;
      const ripples: number[] = [];
      for (const i of this.floodTiles) {
        const a = Math.min(1, Math.max(0, (nowMs - this.floodStart[i]!) / E.floodFadeMs))
          * Math.min(1, Math.max(0, 1 - (nowMs - this.floodEnd[i]!) / E.floodFadeMs));
        if (this.floodOn[i] || nowMs < this.floodEnd[i]! + E.floodFadeMs) keep.push(i);
        else this.floodListed[i] = 0;
        if (a <= 0) continue;
        ctx.globalAlpha = a * E.floodAlpha;
        const tx = i % w, ty = (i - tx) / w;
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        if (a >= 1 && hash01(i, Math.floor(nowMs / 350), 303) < E.rippleShare * 8) ripples.push(tx, ty);
      }
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = PALETTE.waterLight;
      for (let k = 0; k < ripples.length; k += 2) {
        const tx = ripples[k]!, ty = ripples[k + 1]!;
        ctx.fillRect(tx * TILE + 1 + Math.floor(hash01(tx, ty, 304) * 5), ty * TILE + 2 + Math.floor(hash01(tx, ty, 305) * 4), 2, 1);
      }
      ctx.restore();
      this.floodTiles = keep;
    }
    if (!this.enabled) return;
    for (const g of this.groups) {
      const x = (g.homeX + 0.5) * TILE, y = (g.homeY + 0.5) * TILE;
      if (g.mode === Mode.Village && has(g.discoveries, Discovery.city)) {
        const r = SM.hazeRadiusTiles * TILE;
        ctx.globalAlpha = SM.hazeAlpha * 3;
        ctx.drawImage(glowSprite(r, 'rgba(180,176,170,0.35)'), x - r, y - r - TILE);
        ctx.globalAlpha = 1;
      }
      if (g.sick) {
        // Render-only: Math.sin for the pulse.
        const pulse = 0.65 + 0.35 * Math.sin((nowMs / E.sickPulseMs) * Math.PI * 2);
        const r = E.sickRadiusTiles * TILE;
        ctx.globalAlpha = E.sickAlpha * pulse * 3;
        ctx.drawImage(glowSprite(r, 'rgba(143,191,58,0.4)'), x - r, y - r);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Particles, sparkles, era rings and floating icons: over the sprites. */
  drawSky(ctx: CanvasRenderingContext2D, nowMs: number): void {
    ctx.save();
    for (let k = 0; k < this.count; k++) {
      const kd = this.kind[k]!;
      const t = this.age[k]! / this.life[k]!;
      const c = COLOURS[kd]!;
      let size = 1;
      let alpha = 1 - t;
      if (kd === Particle.Smoke) { size = 1 + Math.floor(t * 3); alpha = 0.55 * (1 - t); }
      else if (kd === Particle.Dust) { size = 2 + Math.floor(t * 3); alpha = 0.5 * (1 - t); }
      else if (kd === Particle.Spark) alpha = Math.floor(nowMs / 90 + k) % 2 === 0 ? 1 - t : 0.2;
      else if (kd === Particle.Rock) { size = 2; alpha = t < 0.8 ? 1 : (1 - t) * 5; }
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(Math.round(this.x[k]! - size / 2), Math.round(this.y[k]! - size / 2), size, size);
    }
    for (const b of this.bursts) {
      const t = (nowMs - b.start) / b.ms;
      if (t < 0) continue;                     // a burst that starts a little later (a kingdom's second ring)
      if (b.kind === 'glow') {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = b.colour ?? PALETTE.fireYellow;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4 + t * (b.radius ?? E.eraGlowRadiusPx), 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.img) {
        ctx.globalAlpha = t < 0.75 ? 1 : (1 - t) * 4;
        const x = Math.round(b.x - b.img.width / 2), y = Math.round(b.y - b.img.height - t * E.iconRisePx);
        ctx.fillStyle = PALETTE.ink;
        ctx.fillRect(x - 1, y - 1, b.img.width + 2, b.img.height + 2);
        ctx.drawImage(b.img, x, y);
      }
    }
    ctx.restore();
  }

  /** Burning tiles in view (for sound). */
  burningIn(view: View): number {
    let n = 0;
    const w = this.map.width;
    for (const i of this.burning) if (inView(view, (i % w) * TILE, Math.floor(i / w) * TILE, 0)) n++;
    return n;
  }
}
