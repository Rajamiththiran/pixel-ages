// Which season the terrain shows (seasons plan Phase 1b). The season lives in the materials: each
// of 256 keys shows one state (materials.ts LookState), and a season arrives key by key over its
// front window of screen-clock months (config render.seasons.fronts), so every pixel changes once.
// Phase 3a: a pixel's key is its arrival in the seeded front of the season's field (seasonFront.ts);
// without the front, its Bayer rank. Drawing only.

import { CONFIG } from '../config';
import { KEYS, LookState } from './materials';
import { FRONT_KIND, FrontKind } from './seasonFront';
import type { SeasonMode } from './speedLook';

const SC = CONFIG.render.seasons;
const RANKS = KEYS;
const MONTHS = CONFIG.time.ticksPerYear;
const SEASONS = [LookState.Spring, LookState.Summer, LookState.Autumn, LookState.Winter] as const;

/**
 * The season arriving at month `m` of the year (0–12, with a fraction): from, to, how many keys show
 * `to`, and the front field it follows (seasonFront.ts FrontKind).
 */
export function frontAt(m: number): { from: LookState; to: LookState; level: number; kind: number } {
  let k = 0, best = Infinity;
  for (let s = 0; s < 4; s++) {
    const d = (((m - SC.fronts[s]!.start) % MONTHS) + MONTHS) % MONTHS;
    if (d < best) { best = d; k = s; }
  }
  const p = Math.min(1, best / SC.fronts[k]!.months);
  return { from: SEASONS[(k + 3) % 4]!, to: SEASONS[k]!, level: Math.floor(p * RANKS), kind: FRONT_KIND[k]! };
}

/**
 * Two looks a year (Phase 3b, owner decision S3: Walk, where four seasons a second would flash): the
 * green look (summer) arrives with the spring front, the winter look with the winter front.
 */
export function twoLooksAt(m: number): { from: LookState; to: LookState; level: number; kind: number } {
  const sp = SC.fronts[0]!, wi = SC.fronts[3]!;
  const since = (start: number): number => (((m - start) % MONTHS) + MONTHS) % MONTHS;
  const green = since(sp.start) <= since(wi.start);
  const f = green ? sp : wi;
  const p = Math.min(1, since(f.start) / f.months);
  return green
    ? { from: LookState.Winter, to: LookState.Summer, level: Math.floor(p * RANKS), kind: FrontKind.Warm }
    : { from: LookState.Summer, to: LookState.Winter, level: Math.floor(p * RANKS), kind: FrontKind.Cold };
}

const NAMES: Record<string, LookState> = {
  painted: LookState.Painted, spring: LookState.Spring, summer: LookState.Summer, autumn: LookState.Autumn, winter: LookState.Winter, held: LookState.Held,
};

/** A pinned look: the state of each key and the front field the keys follow. */
export interface Pin { states: Int8Array; kind: number }

/**
 * A pinned look from the URL, dev builds only (`?pin=winter`, `?pin=held`, `?pin=front:spring:0.5`,
 * `?pin=front:snow:0.5` for the winter front): a frozen state to compare with the mockups on a real
 * map. Null otherwise.
 */
export function parsePin(q: string | null): Pin | null {
  if (!q) return null;
  const out = new Int8Array(RANKS);
  const f = /^front:(spring|summer|autumn|winter|snow):([\d.]+)$/.exec(q);
  if (f) {
    const k = SEASONS.indexOf(NAMES[f[1] === 'snow' ? 'winter' : f[1]!] as (typeof SEASONS)[number]);
    const level = Math.round(Math.min(1, Math.max(0, Number(f[2]))) * RANKS);
    for (let r = 0; r < RANKS; r++) out[r] = r < level ? SEASONS[k]! : SEASONS[(k + 3) % 4]!;
    return { states: out, kind: FRONT_KIND[k]! };
  }
  const s = NAMES[q];
  return s === undefined ? null : { states: out.fill(s), kind: FRONT_KIND[0] };
}

const pinFromUrl = (): Pin | null =>
  import.meta.env.DEV && typeof location !== 'undefined' ? parsePin(new URLSearchParams(location.search).get('pin')) : null;

// ---------- Phase 2c: how far winter has come ----------

/**
 * How far winter has come at month `m` (0–12): 0 before `start`, rising to 1 at `full`, and 1 until
 * the spring front has passed (the snow and ice melt as spring reaches each pixel); 0 the rest of the year.
 */
export function winterProgress(m: number, start: number, full: number): number {
  const since = (((m - start) % MONTHS) + MONTHS) % MONTHS;               // months since winter's start
  const until = MONTHS - start + SC.fronts[0]!.start + SC.fronts[0]!.months; // …until spring has reached every pixel
  if (since > until) return 0;
  return Math.min(1, since / (full - start));
}

/** The snow and ice lines (0–255) at month `m`; a harsh winter lays more snow (owner decision S5). */
export function coverLines(m: number, harsh: boolean): [number, number] {
  const SN = SC.snow, IC = SC.ice;
  const snow = winterProgress(m, SN.startMonth, SN.fullMonth) * (harsh ? SN.harshCover : SN.cover);
  return [Math.round(snow * 255), Math.round(winterProgress(m, IC.startMonth, IC.fullMonth) * 255)];
}

/** Dev pin's lines (`&snow=0.6&ice=1`, shares of the land and of the ice's reach); a pinned winter defaults to 0.6 and 1. */
export function parsePinLines(snow: string | null, ice: string | null): [number, number] {
  const share = (v: string | null, d: number): number => Math.round(Math.min(1, Math.max(0, v === null ? d : Number(v) || 0)) * 255);
  return [share(snow, 0.6), share(ice, 1)];
}

const pinLinesFromUrl = (): [number, number] => {
  if (!import.meta.env.DEV || typeof location === 'undefined') return [0, 0];
  const q = new URLSearchParams(location.search);
  return parsePinLines(q.get('snow'), q.get('ice'));
};

type Mode = 'painted' | 'held' | 'year' | 'two' | 'pin';

/**
 * Works out, each frame, the state each key shows and the front field the keys follow. A season
 * arrives with the screen clock; a change of mode (setup ↔ run, to or from the held look) dissolves
 * key by key over `modeFadeMs` of real time instead of popping; a jump in time snaps.
 */
export class SeasonDriver {
  readonly shown = new Int8Array(RANKS);
  private readonly target = new Int8Array(RANKS);
  private readonly old = new Int8Array(RANKS);
  private readonly next = new Int8Array(RANKS);
  private mode: Mode | null = null;
  private blendStart = -1;
  private lastStep = -1;
  /** Phase 2c: the snow and ice lines shown now (0–255), stepped with the keys. */
  snowLine = 0;
  iceLine = 0;
  /** Phase 2c: a planned Harsh winters event runs this year. */
  harsh = false;
  /** Phase 3a: the front field the keys follow now (seasonFront.ts FrontKind), and the year it began in. */
  kind: number = FRONT_KIND[0];
  year = 0;

  constructor(private readonly pin: Pin | null = pinFromUrl(), private readonly pinLines: [number, number] = pinLinesFromUrl()) {}

  /**
   * `month`: the screen clock's month of the year. `look` (Phase 3b, the speed's season look): every
   * season, two looks a year, or the held look. `year`: the screen clock's year (Phase 3a: each
   * year's front differs a little).
   */
  update(nowMs: number, month: number, look: SeasonMode, running: boolean, jump: boolean, year = 0): Int8Array {
    const mode: Mode = this.pin ? 'pin' : !running ? 'painted' : look === 'held' ? 'held' : look === 'two' ? 'two' : 'year';
    const t = this.target;
    // Setup and the held look keep the field they had (every key shows one state, so it does not matter).
    let kind = this.kind, fy = this.year;
    if (mode === 'pin') { t.set(this.pin!.states); kind = this.pin!.kind; fy = 0; }
    else if (mode === 'painted') t.fill(LookState.Painted);
    else if (mode === 'held') t.fill(LookState.Held);
    else {
      const f = mode === 'two' ? twoLooksAt(month) : frontAt(month);
      for (let r = 0; r < RANKS; r++) t[r] = r < f.level ? f.to : f.from;
      kind = f.kind; fy = year;
    }
    if (this.mode === null || jump) {
      this.blendStart = -1;
    } else if (mode !== this.mode) {
      this.old.set(this.shown);
      this.blendStart = nowMs;
    }
    this.mode = mode;
    let level = RANKS;
    if (this.blendStart >= 0) {
      level = Math.floor(((nowMs - this.blendStart) / SC.modeFadeMs) * RANKS);
      if (level >= RANKS) { this.blendStart = -1; level = RANKS; }
    }
    // Keys move on at most every lookStepMs: each step re-uploads the whole terrain image, and a
    // few batches a front look the same (each pixel still changes once). A jump shows at once.
    const next = this.next;
    for (let r = 0; r < RANKS; r++) next[r] = r < level ? t[r]! : this.old[r]!;
    const [snow, ice] = mode === 'pin' ? this.pinLines : mode === 'year' || mode === 'two' ? coverLines(month, this.harsh) : [0, 0];
    let same = snow === this.snowLine && ice === this.iceLine && kind === this.kind && fy === this.year;
    for (let r = 0; r < RANKS; r++) if (next[r] !== this.shown[r]) { same = false; break; }
    if (!same && (jump || this.lastStep < 0 || nowMs - this.lastStep >= SC.lookStepMs)) {
      this.shown.set(next);
      this.kind = kind;
      this.year = fy;
      this.snowLine = snow;
      this.iceLine = ice;
      this.lastStep = nowMs;
    }
    return this.shown;
  }
}
