// People drawing. Setup: placed founders stand around their home. Run: every band person
// walks smoothly toward their work tile (§18.6); children follow their mothers; hunters carry
// spears; explorers with Riding ride horses. Visual-only randomness (idle steps) may use Math.random: it never reaches the sim.

import { CONFIG } from '../config';
import { Action, Sex } from '../shared/ids';
import { hash01 } from '../shared/hash';
import type { FounderGroup } from '../shared/types';
import { AgeClass, hunterSprite, personSprite, riderSprite, type PersonLook } from './sprites';
import { GROUP_COLORS } from './palette';

const TILE = CONFIG.map.tilePx;
const R = CONFIG.render;
const A = CONFIG.people.ages;

const ageClassOf = (age: number): AgeClass =>
  age < A.adult ? AgeClass.Child : age >= A.elder ? AgeClass.Elder : AgeClass.Adult;

/** Pushes every founder as a standing sprite (frame 1) around the group's home. */
export function collectFounders(
  groups: readonly FounderGroup[],
  push: (img: HTMLCanvasElement, x: number, y: number) => void,
): void {
  for (const g of groups) {
    const cx = (g.x + 0.5) * TILE;
    const cy = (g.y + 0.5) * TILE;
    g.people.forEach((p, k) => {
      // Stable per-person offsets and looks, so placed people don't jump between frames.
      const ox = (2 * hash01(g.id, k, 101) - 1) * R.founderSpreadPx;
      const oy = (2 * hash01(g.id, k, 102) - 1) * R.founderSpreadPx;
      const img = personSprite({
        female: p.sex === Sex.Female,
        ageClass: ageClassOf(p.age),
        colorIndex: g.colorIndex,
        skin: Math.floor(hash01(g.id, k, 103) * 3),
        hair: Math.floor(hash01(g.id, k, 104) * 3),
        clothed: false,
      }, 1);
      push(img, cx + ox, cy + oy + TILE / 2);
    });
  }
}

export interface GroupLabel { name: string; x: number; y: number; colorIndex: number; selected?: boolean; sub?: string }

/** Group names above their homes, with a small second line (the era) above the name. */
export function drawGroupLabels(ctx: CanvasRenderingContext2D, groups: readonly GroupLabel[]): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const g of groups) {
    const x = (g.x + 0.5) * TILE;
    const y = g.y * TILE - R.founderSpreadPx - 2;
    const colour = g.selected ? '#ffffff' : GROUP_COLORS[g.colorIndex % GROUP_COLORS.length]!;
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(28, 26, 36, 0.8)';
    ctx.fillText(g.name, x + 1, y + 1);
    ctx.fillStyle = colour;
    ctx.fillText(g.name, x, y);
    if (g.sub) {
      ctx.font = '8px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(28, 26, 36, 0.8)';
      ctx.fillText(g.sub, x + 1, y - 9);
      ctx.fillStyle = '#e8e2d4';
      ctx.fillText(g.sub, x, y - 10);
    }
  }
}

interface VisualPerson {
  id: number;
  x: number; y: number;          // current visual position (feet), map px
  tx: number; ty: number;        // target
  motherId: number;
  child: boolean;
  hunter: boolean;
  rider: boolean;
  facingLeft: boolean;           // riders face the way they move (people face the viewer)
  moving: boolean;
  nextIdleMs: number;
  lookKey: number;
  img1: HTMLCanvasElement;
  img2: HTMLCanvasElement;
  img1Left: HTMLCanvasElement;   // riders only: mirrored frames
  img2Left: HTMLCanvasElement;
  seen: number;
}

/** Run-mode people: visual positions keyed by person id, updated from frames. */
export class PeopleLayer {
  private readonly people = new Map<number, VisualPerson>();
  private list: VisualPerson[] = [];
  private frameNo = 0;
  private speedMult = 1;

  clear(): void {
    this.people.clear();
    this.list = [];
  }

  /** Applies a frame's people array (§22: 8 floats per person). */
  update(data: Float32Array, fast: boolean, nowMs: number): void {
    this.frameNo++;
    this.speedMult = fast ? R.fastWalkMult : 1;
    for (let o = 0; o < data.length; o += 8) {
      const id = data[o]!;
      const flags = data[o + 4]!;
      const colour = data[o + 3]!;
      const skinHair = data[o + 6]!;
      const action = data[o + 7]!;
      // Target: centre of the work tile plus a fixed per-person offset, so a crowd spreads out.
      const tx = (data[o + 1]! + 0.5) * TILE + (2 * hash01(id, 0, 201) - 1) * R.personOffsetPx;
      const ty = (data[o + 2]! + 0.5) * TILE + (2 * hash01(id, 0, 202) - 1) * R.personOffsetPx + TILE / 2;
      let v = this.people.get(id);
      const hunter = action === Action.Hunt;
      const rider = (flags & 16) === 16;
      const lookKey = flags * 1000 + colour * 10 + skinHair + (hunter ? 100000 : 0);
      if (!v) {
        // Babies appear at their mother; everyone else appears where they work.
        const mom = this.people.get(data[o + 5]!);
        v = {
          id, x: mom ? mom.x : tx, y: mom ? mom.y : ty, tx, ty, motherId: data[o + 5]!,
          child: false, hunter, rider, facingLeft: false, moving: false, nextIdleMs: nowMs + Math.random() * R.idleStepMs,
          lookKey: -1, img1: undefined as unknown as HTMLCanvasElement, img2: undefined as unknown as HTMLCanvasElement,
          img1Left: undefined as unknown as HTMLCanvasElement, img2Left: undefined as unknown as HTMLCanvasElement,
          seen: 0,
        };
        this.people.set(id, v);
      }
      v.tx = tx;
      v.ty = ty;
      v.hunter = hunter;
      v.rider = rider;
      v.seen = this.frameNo;
      if (v.lookKey !== lookKey) {
        // Look changed (grew up, got clothes, started hunting): re-fetch cached sprites once.
        const look: PersonLook = {
          female: (flags & 1) === 1,
          ageClass: ((flags >> 1) & 3) as AgeClass,
          colorIndex: colour,
          skin: Math.floor(skinHair / 3),
          hair: skinHair % 3,
          clothed: (flags & 8) === 8,
        };
        v.child = look.ageClass === AgeClass.Child;
        if (rider) {
          v.img1 = riderSprite(look, 1, false);
          v.img2 = riderSprite(look, 2, false);
          v.img1Left = riderSprite(look, 1, true);
          v.img2Left = riderSprite(look, 2, true);
        } else {
          v.img1 = hunter ? hunterSprite(look, 1) : personSprite(look, 1);
          v.img2 = hunter ? hunterSprite(look, 2) : personSprite(look, 2);
        }
        v.lookKey = lookKey;
      }
    }
    // People missing from the frame have died (or left band mode).
    for (const [id, v] of this.people) if (v.seen !== this.frameNo) this.people.delete(id);
    this.list = [...this.people.values()];
  }

  /** Moves everyone toward their target (children toward their mother). */
  animate(nowMs: number, dtMs: number): void {
    const step = (R.walkSpeedPx * this.speedMult * dtMs) / 1000;
    const [cox, coy] = R.childOffsetPx;
    for (const v of this.list) {
      let tx = v.tx, ty = v.ty;
      if (v.child) {
        const mom = this.people.get(v.motherId);
        if (mom) { tx = mom.x + cox; ty = mom.y + coy; }
      }
      const dx = tx - v.x;
      const dy = ty - v.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > step) {
        v.x += (dx / len) * step;
        v.y += (dy / len) * step;
        v.moving = true;
        if (Math.abs(dx) > 0.5) v.facingLeft = dx < 0;
      } else {
        v.x = tx;
        v.y = ty;
        v.moving = false;
        if (!v.child && nowMs >= v.nextIdleMs) {
          // A tiny shuffle now and then, so a standing crowd looks alive.
          v.tx += (Math.random() * 2 - 1) * R.idleStepPx;
          v.ty += (Math.random() * 2 - 1) * R.idleStepPx;
          v.nextIdleMs = nowMs + R.idleStepMs;
        }
      }
    }
  }

  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    const walk2 = Math.floor(nowMs / R.walkFrameMs) % 2 === 1;
    for (const v of this.list) {
      const two = v.moving && walk2;
      if (v.rider && v.facingLeft) push(two ? v.img2Left : v.img1Left, v.x, v.y);
      else push(two ? v.img2 : v.img1, v.x, v.y);
    }
  }

  /** The person whose feet are within 3 px of (mx, my), nearest first; null if none. */
  pick(mx: number, my: number): number | null {
    let best: number | null = null;
    let bestD = R.pickRadiusPx * R.pickRadiusPx;
    for (const v of this.list) {
      // Feet are at the bottom; the body is ~3 px above them.
      const dx = v.x - mx;
      const dy = v.y - 3 - my;
      const d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = v.id; }
    }
    return best;
  }

  /** Visual position of a person (for the selection marker). */
  position(id: number): { x: number; y: number } | null {
    const v = this.people.get(id);
    return v ? { x: v.x, y: v.y } : null;
  }

  get count(): number { return this.list.length; }
}
