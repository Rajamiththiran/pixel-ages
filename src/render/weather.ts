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
import { Clouds, bodySprite, cloudDitherOn, cloudsOn, rainFramesOn, washSprite, type CloudAt } from './clouds';
import { nightMultiplyAdd } from './light';
import { seasonRampRgb } from './ramps';
import { droughtOn, wetYearOn } from './materials';

const RC = CONFIG.render.seasons.rain;

/** Phase 6: what falls at a map pixel: rain, snow (land showing winter), or nothing (frozen water). */
export const Fall = { Rain: 0, Snow: 1, None: 2 } as const;

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
  /** Phase 7: bumped when any tile's ground state changes (the terrain draws it into the land). */
  groundVersion = 0;
  /** Phase 7: the mean shown rain over the land (0–100), for the storm's chance. */
  meanRain = 0;
  private groundTiles = 0;                     // tiles with cracks or puddles (nothing to draw at 0)
  private lastUpdate = -Infinity;
  private t = 0;                               // seconds of drift
  private map: MapData;
  private base: Uint8Array | null = null;      // painted rain
  /** Speeds plan Phase 5: the rain the screen draws (eased over the year); null = the map's rain. */
  rainSource: ArrayLike<number> | null = null;
  // Particles: struct of arrays.
  private readonly px = new Float32Array(W.maxDrops);
  private readonly py = new Float32Array(W.maxDrops);
  private readonly age = new Float32Array(W.maxDrops);
  private readonly life = new Float32Array(W.maxDrops);
  private readonly kind = new Uint8Array(W.maxDrops);
  private count = 0;
  enabled = true;
  /** Seasons Phase 4: rain and snow fall (off in the held fast-forward look; the clouds still drift). */
  falling = true;
  // Phase 6: the cached particle image, what it was drawn for, and a count of cloud moves.
  private precipCanvas: HTMLCanvasElement | null = null;
  private precipImg: ImageData | null = null;
  private precipKey = '';
  private precipAny = false;
  private skyVersion = 0;
  /** Seasons Phase 5: pixel clouds (null with `?off=clouds`: the F8 noise wash). */
  readonly sky: Clouds | null;
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
    this.sky = cloudsOn ? new Clouds(map.width * TILE, map.height * TILE) : null;
    this.rainChanged();
  }

  /** Phase 5: the clouds now (empty while the weather is off). */
  get cloudsNow(): readonly CloudAt[] { return this.enabled && this.sky ? this.sky.now : []; }

  /** Phase 5: a storm's gloom lies over the land. */
  get storm(): boolean { return this.enabled && !!this.sky?.storm; }

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
    const rain = this.rainSource ?? m.rain;
    const C = W.cellTiles;
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        let sum = 0, n = 0, cold = 0;
        for (let y = cy * C; y < Math.min(m.height, cy * C + C); y++) {
          for (let x = cx * C; x < Math.min(m.width, cx * C + C); x++) {
            const i = y * m.width + x;
            sum += rain[i]!; n++;
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

  /** Phase 7: per tile, 0 none, 1 far drier than painted, 2 far wetter (open land only). */
  get groundStates(): Uint8Array { return this.groundState; }

  private updateGround(): void {
    const m = this.map;
    const base = this.base;
    let sum = 0, land = 0;
    const r = this.rainSource ?? m.rain;
    for (let i = 0; i < r.length; i++) if (m.ground[i] !== Ground.Water && m.wall[i] === WallType.None) { sum += r[i]!; land++; }
    this.meanRain = land > 0 ? sum / land : 0;
    if (!base) return;
    const rain = this.rainSource ?? m.rain;
    const d = this.groundImg.data;
    const imgW = this.ground.width;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let i = 0; i < this.groundState.length; i++) {
      let st = 0;
      const open = m.wall[i] === WallType.None && m.plantType[i] !== Plant.Forest
        && (m.ground[i] === Ground.Grassland || m.ground[i] === Ground.Desert);
      if (open && base[i]! > 0) {
        const ratio = rain[i]! / base[i]!;
        if (ratio < W.droughtBelow) st = 1;
        else if (ratio > W.wetAbove && m.ground[i] === Ground.Grassland) st = 2;
      }
      if (st === this.groundState[i]) continue;
      this.groundTiles += (st !== 0 ? 1 : 0) - (this.groundState[i] !== 0 ? 1 : 0);
      this.groundState[i] = st;
      this.groundVersion++;
      const tx = i % m.width, ty = (i - tx) / m.width;
      for (let oy = 0; oy < TILE; oy++) {
        for (let ox = 0; ox < TILE; ox++) {
          const x = tx * TILE + ox, y = ty * TILE + oy;
          const o = (y * imgW + x) * 4;
          d[o + 3] = 0;
          if (st === 1 && !droughtOn && isCrack(x, y)) { d[o] = RGBS.darkWood[0]; d[o + 1] = RGBS.darkWood[1]; d[o + 2] = RGBS.darkWood[2]; d[o + 3] = 150; }
          if (st === 2 && !wetYearOn && isPuddle(x, y)) { d[o] = RGBS.waterLight[0]; d[o + 1] = RGBS.waterLight[1]; d[o + 2] = RGBS.waterLight[2]; d[o + 3] = 200; }
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
        if (dens <= 0 || rain < W.rainAbove || !this.falling) continue;
        const snow = winter > 0.5 && this.cellCold[c] === 1;
        if (snow) snowy++; else rainy++;
        if (rainFramesOn) continue;   // Phase 6: the clouds carry their own rain (drawPrecip)
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
    const sky = this.sky;
    if (sky) {
      // Phase 5: the pixel clouds move on; rain falls from the cells under their bodies.
      const cellPx = W.cellTiles * TILE;
      this.skyVersion++;
      sky.update(this.t, (y) => {
        const cy = Math.max(0, Math.min(this.ch - 1, Math.floor(y / cellPx)));
        let sum = 0;
        for (let cx = 0; cx < this.cw; cx++) sum += this.cellRain[cy * this.cw + cx]!;
        return (sum / this.cw) * 100;
      });
      for (let cy = 0; cy < this.ch; cy++) {
        for (let cx = 0; cx < this.cw; cx++) this.cloud[cy * this.cw + cx] = sky.storm || sky.covers((cx + 0.5) * cellPx, (cy + 0.5) * cellPx, rainFramesOn) ? 1 : 0;
      }
      return;
    }
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

  /**
   * Cloud shadows and falling rain or snow: over everything on the ground. Phase 5: the shadows are
   * in the terrain (ramp steps); the cloud bodies are drawn over the rain and the people (S12).
   */
  drawSky(ctx: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    const sky = this.sky;
    if (!sky) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      const cellPx = W.cellTiles * TILE;
      ctx.drawImage(this.shadow, W.shadowOffsetPx, W.shadowOffsetPx, this.cw * cellPx, this.ch * cellPx);
      ctx.restore();
    } else if (!cloudDitherOn) {
      // `?off=cloudDither`: a crisp-edged navy wash under each cloud instead of ramp steps.
      const [ox, oy] = CONFIG.render.seasons.clouds.shadowOffsetPx;
      for (const c of sky.now) ctx.drawImage(washSprite(c.shape), c.x + c.shape.ox + ox!, c.y + c.shape.oy + oy!);
    }
    this.drawFalling(ctx);
    if (sky) {
      for (const c of sky.now) {
        const x = c.x + c.shape.ox, y = c.y + c.shape.oy;
        ctx.drawImage(bodySprite(c.shape, (x + y) & 1), x, y);
      }
    }
  }

  /**
   * Visual fixes C: clears the cloud bodies out of the night's glow image, so lit people and flames
   * under a cloud stay hidden by it (the bodies are drawn before the night pass, the glow after).
   */
  maskBodies(glow: HTMLCanvasElement): void {
    const sky = this.sky;
    if (!this.enabled || !sky || sky.now.length === 0) return;
    const g = glow.getContext('2d')!;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    for (const c of sky.now) {
      const x = c.x + c.shape.ox, y = c.y + c.shape.oy;
      g.drawImage(bodySprite(c.shape, (x + y) & 1), x, y);
    }
    g.restore();
  }

  /**
   * Phase 6 (mockup E): rain and snow from the raining clouds (everywhere in a storm), each spot playing
   * 3 frames of frameMs: a streak stepping down then a splash, or a flake stepping down. `fall(x, y)`
   * says what falls at a pixel. `nightQ`: drawn after the night pass, at nightMix of the night
   * (owner decision S13), so they read in the dark. Opaque, no randomness: a capture repeats.
   */
  drawPrecip(ctx: CanvasRenderingContext2D, view: { x: number; y: number; w: number; h: number }, nowMs: number, nightQ: number, fall: (x: number, y: number) => number): void {
    const sky = this.sky;
    if (!this.enabled || !this.falling || !sky || !rainFramesOn) return;
    const frame = Math.floor(nowMs / RC.frameMs);
    // The particles only change when their frame steps, the clouds move, the view moves or the night
    // deepens: drawn once into an image then, and that image is drawn each screen frame (thousands of
    // single-pixel rects every screen frame cost ~20 ms in a storm, measured).
    const vx = Math.floor(view.x) - 8, vy = Math.floor(view.y) - 8, vw = Math.ceil(view.w) + 16, vh = Math.ceil(view.h) + 16;
    const key = `${frame}|${vx}|${vy}|${vw}|${vh}|${this.skyVersion}|${Math.round(nightQ * 32)}`;
    if (key !== this.precipKey) {
      this.precipKey = key;
      this.paintPrecip(this.precipPixels({ x: vx, y: vy, w: vw, h: vh }, frame, fall), vx, vy, vw, vh, nightQ);
    }
    if (this.precipCanvas && this.precipAny) ctx.drawImage(this.precipCanvas, vx, vy);
  }

  /** Into the cached image: pixels per precip ramp step (x, y pairs), the view's top-left (vx, vy). */
  private paintPrecip(out: number[][], vx: number, vy: number, vw: number, vh: number, nightQ: number): void {
    if (!this.precipCanvas || this.precipCanvas.width !== vw || this.precipCanvas.height !== vh) {
      this.precipCanvas = document.createElement('canvas');
      this.precipCanvas.width = vw; this.precipCanvas.height = vh;
      this.precipImg = this.precipCanvas.getContext('2d')!.createImageData(vw, vh);
    }
    const img = this.precipImg!, px = new Uint32Array(img.data.buffer);
    px.fill(0);
    const ramp = seasonRampRgb('precip');
    const nm = nightQ > 0 ? nightMultiplyAdd(nightQ) : null;
    let any = false;
    for (let st = 0; st < 5; st++) {
      const pts = out[st]!;
      if (pts.length === 0) continue;
      any = true;
      const c = ramp[st]!;
      // S13: half-way between the colour and its night colour.
      const col = nm ? c.map((v, i) => Math.round(v + (Math.min(255, (v * nm.mul[i]!) / 255 + nm.add[i]!) - v) * RC.nightMix)) : c;
      const word = ((255 << 24) | (col[2]! << 16) | (col[1]! << 8) | col[0]!) >>> 0;
      for (let k = 0; k < pts.length; k += 2) {
        const x = pts[k]! - vx, y = pts[k + 1]! - vy;
        if (x >= 0 && y >= 0 && x < vw && y < vh) px[y * vw + x] = word;
      }
    }
    this.precipAny = any;
    if (any) this.precipCanvas.getContext('2d')!.putImageData(img, 0, 0);
  }

  /**
   * Phase 6: the particle pixels of animation frame `frame` within `view`, per precip ramp step (x, y
   * pairs): rain streaks and splashes on steps 1 and 0, flakes on 4 and 3.
   */
  precipPixels(view: { x: number; y: number; w: number; h: number }, frame: number, fall: (x: number, y: number) => number): number[][] {
    const sky = this.sky!;
    const step = RC.streakPx, flakeStep = RC.snowStepPx;
    const snowAll = sky.forced === 'snowfall';
    const out: number[][] = [[], [], [], [], []];
    let budget = RC.maxParticles;
    const x0 = view.x, y0v = view.y, x1 = view.x + view.w, y1 = view.y + view.h;
    /**
     * One spot; `rainOk`: it may rain here (rain is sparser than snow: the first share of the spots);
     * `open`: a storm's spot, which lies anywhere: none is drawn under a cloud's body.
     */
    const spot = (x: number, y: number, ph: number, pair: number, len: number, rainOk: boolean, open = false): void => {
      if (x < x0 || y < y0v || x > x1 || y > y1 || budget <= 0) return;
      if (open && sky.covers(x, y)) return;
      const what = snowAll ? Fall.Snow : fall(x, y);
      if (what === Fall.None || (what === Fall.Rain && !rainOk)) return;
      budget--;
      const p = (ph + frame) % 3;
      if (what === Fall.Snow) {
        const fy = y + p * flakeStep, fx = x + (p === 1 ? 1 : 0);
        out[4]!.push(fx, fy);
        if (pair) out[3]!.push(fx + 1, fy);
        return;
      }
      if (p === 2) { out[1]!.push(x - 1, y + 2 * step, x + 1, y + 2 * step, x, y + 2 * step - 1); return; }   // the splash
      const sy = y + p * step;
      for (let s = 0; s < len; s++) out[s === 0 ? 1 : 0]!.push(x - (s >> 1), sy + s);
    };
    if (sky.storm) {
      // Rain everywhere, from world-fixed spots (cells of 32 px); thinned evenly when the view holds more
      // than maxParticles (zoomed out), never cut off part of the way down.
      const C = 32, cells = (Math.floor(x1 / C) - Math.floor(x0 / C) + 1) * (Math.floor(y1 / C) - Math.floor(y0v / C) + 1);
      const n = Math.min(Math.round(C * C * RC.stormDensity), Math.floor(RC.maxParticles / cells));
      for (let cy = Math.floor(y0v / C); cy * C < y1; cy++) {
        for (let cx = Math.floor(x0 / C); cx * C < x1; cx++) {
          for (let k = 0; k < n; k++) {
            spot(cx * C + Math.floor(hash01(cx * 64 + k, cy, RC.salt + 7) * C), cy * C + Math.floor(hash01(cx * 64 + k, cy, RC.salt + 8) * C),
              Math.floor(hash01(cx * 64 + k, cy, RC.salt + 9) * 3), 0, RC.stormStreakPx, true, true);
          }
        }
      }
    } else {
      const rainShare = RC.rainDensity / RC.snowDensity;
      for (const c of sky.now) {
        const s = c.shape;
        if (!s.rainy) continue;
        const n = s.spots.length / 4, rainN = Math.round(n * rainShare);
        for (let k = 0; k < n; k++) {
          const o = k * 4;
          // Rain uses the first rainDensity ÷ snowDensity of the spots; snow all of them (mockup densities).
          spot(c.x + s.spots[o]!, c.y + s.spots[o + 1]!, s.spots[o + 2]!, s.spots[o + 3]!, RC.streakPx, k < rainN);
        }
      }
    }
    return out;
  }

  /** Falling rain and snow (the F8 particles; with Phase 6's frames, drawPrecip instead). */
  private drawFalling(ctx: CanvasRenderingContext2D): void {
    if (rainFramesOn) return;
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
