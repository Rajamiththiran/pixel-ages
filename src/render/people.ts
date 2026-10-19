// People drawing. Setup: placed founders stand around their home. Run: every band person
// walks smoothly toward their work tile (§18.6); children follow their mothers; hunters carry
// spears; explorers with Riding ride horses. Visual-only randomness (idle steps) may use Math.random: it never reaches the sim.
// F8 (§14.3): work poses at the work tile (bending gatherer, farmer with hoe, woodcutter, fisher
// with rod on the shore, builder with a log), items carried on the way home, a deer fleeing
// hunters, goats walking with herders, bands round the campfire at night, battle crowds.

import { CONFIG } from '../config';
import { Action, Ground, Sex, WallType } from '../shared/ids';
import { hash01 } from '../shared/hash';
import { PERSON_FLOATS, type GroupView, type RelationView } from '../shared/protocol';
import type { FounderGroup, MapData } from '../shared/types';
import {
  AgeClass, carrySprite, herderSprite, hunterSprite, personSprite, poseSprite, riderSprite,
  type Carry, type PersonLook, type Pose,
} from './sprites';
import { GROUP_COLORS } from './palette';
import { animalSprite } from './decor';
import { Species } from '../shared/ids';
import { drawPixelText } from './pixelFont';

const TILE = CONFIG.map.tilePx;
const R = CONFIG.render;
const P8 = R.f8.people;
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

/**
 * Group names above their homes, with a small second line (the era) above the name. F8: in the
 * pixel font; `project` turns a map point into the drawing space (labels are drawn in screen space).
 */
export function drawGroupLabels(
  ctx: CanvasRenderingContext2D, groups: readonly GroupLabel[],
  project: (mx: number, my: number) => [number, number] = (mx, my) => [mx, my],
): void {
  for (const g of groups) {
    const [x, y] = project((g.x + 0.5) * TILE, g.y * TILE - R.founderSpreadPx - 2);
    const colour = g.selected ? '#ffffff' : GROUP_COLORS[g.colorIndex % GROUP_COLORS.length]!;
    drawPixelText(ctx, g.name, x, y, colour, 'center', 'bottom');
    if (g.sub) drawPixelText(ctx, g.sub, x, y - 9, '#e8e2d4', 'center', 'bottom');
  }
}

/** The pose a person shows while working at their tile (F8). */
const POSE: Partial<Record<number, Pose>> = {
  [Action.Gather]: 'gather', [Action.Farm]: 'farm', [Action.CutWood]: 'cut', [Action.Fish]: 'fish',
  [Action.Build]: 'build', [Action.Wall]: 'build', [Action.Maintain]: 'build', [Action.Burn]: 'gather',
};
/** What a person carries on the way home (F8). */
const CARRY: Partial<Record<number, Carry>> = {
  [Action.Gather]: 'basket', [Action.Farm]: 'basket', [Action.Hunt]: 'meat', [Action.Fish]: 'fish',
  [Action.CutWood]: 'wood', [Action.Care]: 'pot', [Action.Craft]: 'pot',
};

interface VisualPerson {
  id: number;
  x: number; y: number;          // current visual position (feet), map px
  tx: number; ty: number;        // target (the work spot)
  motherId: number;
  groupId: number;
  action: number;
  child: boolean;
  rider: boolean;
  facingLeft: boolean;           // riders face the way they move (people face the viewer)
  moving: boolean;
  homeward: boolean;             // walking toward home (carries the day's haul)
  poseLeft: boolean;             // fishers face the water
  nearHome: boolean;             // works close enough to home to come back to the fire at night
  nextIdleMs: number;
  lookKey: number;
  walk: [HTMLCanvasElement, HTMLCanvasElement];
  riderLeft: [HTMLCanvasElement, HTMLCanvasElement] | null;
  tool: [HTMLCanvasElement, HTMLCanvasElement] | null;   // walking out: spear (hunters), crook (herders)
  carry: [HTMLCanvasElement, HTMLCanvasElement] | null;
  pose: [HTMLCanvasElement, HTMLCanvasElement] | null;
  poseFlip: [HTMLCanvasElement, HTMLCanvasElement] | null; // fishers facing water on their left
  flock: Float32Array | null;    // herders: two goats following (x, y, x, y)
  flockLeft: Uint8Array | null;
  seen: number;
}

/** Run-mode people: visual positions keyed by person id, updated from frames. */
export class PeopleLayer {
  private readonly people = new Map<number, VisualPerson>();
  private list: VisualPerson[] = [];
  private frameNo = 0;
  private speedMult = 1;
  private map: MapData | null = null;
  private homes = new Map<number, [number, number]>();
  private shore = new Map<number, [number, number, boolean]>();
  // F8 night: darkness and each group's campfire.
  private darkness = 0;
  private fires = new Map<number, [number, number]>();
  /** F8: a splash at a fisher's line (the effects layer draws it). */
  splash: ((x: number, y: number) => void) | null = null;

  clear(): void {
    this.people.clear();
    this.list = [];
    this.shore.clear();
  }

  setMap(map: MapData): void {
    this.map = map;
    this.shore.clear();
  }

  /** Forget cached sprites (the lineage palette changed). */
  restyle(): void {
    for (const v of this.list) v.lookKey = -1;
  }

  setNight(darkness: number, fires: Map<number, [number, number]>): void {
    this.darkness = darkness;
    this.fires = fires;
  }

  /** A land spot beside water tile `i` for a fisher, and whether the water lies to its left (the land is east of the water). */
  private shoreOf(i: number): [number, number, boolean] | null {
    const m = this.map;
    if (!m) return null;
    let s = this.shore.get(i);
    if (s) return s;
    const x0 = i % m.width, y0 = (i - x0) / m.width;
    for (let r = 1; r <= 2 && !s; r++) {
      for (let dy = -r; dy <= r && !s; dy++) {
        for (let dx = -r; dx <= r && !s; dx++) {
          const x = x0 + dx, y = y0 + dy;
          if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
          const j = y * m.width + x;
          if (m.ground[j] === Ground.Water || m.wall[j] !== WallType.None) continue;
          // Stand at the land tile's edge nearest the water.
          s = [(x + 0.5) * TILE - Math.sign(dx) * 2, (y + 0.5) * TILE - Math.sign(dy) * 2 + TILE / 2, dx > 0];
        }
      }
    }
    if (s) this.shore.set(i, s);
    return s ?? null;
  }

  /** Applies a frame's people array (§22: PERSON_FLOATS per person) and the groups' homes. */
  update(data: Float32Array, fast: boolean, nowMs: number, groups: readonly GroupView[] = []): void {
    this.frameNo++;
    this.speedMult = fast ? R.fastWalkMult : 1;
    this.homes = new Map(groups.map((g) => [g.id, [(g.homeX + 0.5) * TILE, (g.homeY + 0.5) * TILE + TILE / 2]]));
    const m = this.map;
    const range = P8.nightGatherTiles * TILE;
    for (let o = 0; o < data.length; o += PERSON_FLOATS) {
      const id = data[o]!;
      const flags = data[o + 4]!;
      const colour = data[o + 3]!;
      const skinHair = data[o + 6]!;
      const action = data[o + 7]!;
      const groupId = data[o + 8]!;
      const wx = data[o + 1]!, wy = data[o + 2]!;
      // Target: centre of the work tile plus a fixed per-person offset, so a crowd spreads out.
      let tx = (wx + 0.5) * TILE + (2 * hash01(id, 0, 201) - 1) * R.personOffsetPx;
      let ty = (wy + 0.5) * TILE + (2 * hash01(id, 0, 202) - 1) * R.personOffsetPx + TILE / 2;
      let poseLeft = false;
      // F8: fishers on a water tile stand on the shore beside it.
      if (action === Action.Fish && m) {
        const i = wy * m.width + wx;
        if (m.ground[i] === Ground.Water || m.wall[i] !== WallType.None) {
          const s = this.shoreOf(i);
          if (s) { tx = s[0] + (hash01(id, 0, 203) - 0.5) * 3; ty = s[1]; poseLeft = s[2]; }
        }
      }
      let v = this.people.get(id);
      const rider = (flags & 16) === 16;
      const lookKey = flags * 1000 + colour * 10 + skinHair + action * 1000000;
      if (!v) {
        // Babies appear at their mother; everyone else appears where they work.
        const mom = this.people.get(data[o + 5]!);
        v = {
          id, x: mom ? mom.x : tx, y: mom ? mom.y : ty, tx, ty, motherId: data[o + 5]!, groupId, action,
          child: false, rider, facingLeft: false, moving: false, homeward: false, poseLeft, nearHome: true,
          nextIdleMs: nowMs + Math.random() * R.idleStepMs, lookKey: -1,
          walk: undefined as unknown as [HTMLCanvasElement, HTMLCanvasElement], riderLeft: null, tool: null, carry: null, pose: null, poseFlip: null,
          flock: null, flockLeft: null, seen: 0,
        };
        this.people.set(id, v);
      }
      v.tx = tx;
      v.ty = ty;
      v.rider = rider;
      v.groupId = groupId;
      v.action = action;
      v.poseLeft = poseLeft;
      const home = this.homes.get(groupId);
      v.nearHome = !home || Math.abs(home[0] - tx) + Math.abs(home[1] - ty) <= range;
      v.seen = this.frameNo;
      if (v.lookKey !== lookKey) {
        // Look changed (grew up, got clothes, new job): re-fetch cached sprites once.
        const look: PersonLook = {
          female: (flags & 1) === 1,
          ageClass: ((flags >> 1) & 3) as AgeClass,
          colorIndex: colour,
          skin: Math.floor(skinHair / 3),
          hair: skinHair % 3,
          clothed: (flags & 8) === 8,
        };
        v.child = look.ageClass === AgeClass.Child;
        v.riderLeft = null; v.tool = null; v.carry = null; v.pose = null; v.poseFlip = null;
        if (rider) {
          v.walk = [riderSprite(look, 1, false), riderSprite(look, 2, false)];
          v.riderLeft = [riderSprite(look, 1, true), riderSprite(look, 2, true)];
        } else {
          v.walk = [personSprite(look, 1), personSprite(look, 2)];
          if (!v.child) {
            if (action === Action.Hunt) v.tool = [hunterSprite(look, 1), hunterSprite(look, 2)];
            if (action === Action.Herd) v.tool = [herderSprite(look, 1), herderSprite(look, 2)];
            const item = CARRY[action];
            if (item) v.carry = [carrySprite(look, item, 1), carrySprite(look, item, 2)];
            const pose = POSE[action];
            if (pose) v.pose = [poseSprite(look, pose, 1), poseSprite(look, pose, 2)];
            if (pose === 'fish') v.poseFlip = [poseSprite(look, pose, 1, true), poseSprite(look, pose, 2, true)];
          }
        }
        if (action === Action.Herd && !v.child && !v.flock) {
          v.flock = new Float32Array([v.x - P8.herdFollowPx, v.y + 1, v.x + P8.herdFollowPx, v.y + 2]);
          v.flockLeft = new Uint8Array(2);
        } else if (action !== Action.Herd) { v.flock = null; v.flockLeft = null; }
        v.lookKey = lookKey;
      }
    }
    // People missing from the frame have died (or left band mode).
    for (const [id, v] of this.people) if (v.seen !== this.frameNo) this.people.delete(id);
    this.list = [...this.people.values()];
  }

  /** Moves everyone toward their target (children toward their mother; at night, to the fire). */
  animate(nowMs: number, dtMs: number): void {
    const step = (R.walkSpeedPx * this.speedMult * dtMs) / 1000;
    const [cox, coy] = R.childOffsetPx;
    const night = this.darkness > P8.nightGatherAbove;
    const [r0, r1] = P8.fireRingPx;
    for (const v of this.list) {
      let tx = v.tx, ty = v.ty;
      if (v.child) {
        const mom = this.people.get(v.motherId);
        if (mom) { tx = mom.x + cox; ty = mom.y + coy; }
      } else if (night && v.nearHome && !v.rider) {
        const fire = this.fires.get(v.groupId);
        if (fire) {
          // A seat round the fire: a fixed angle and distance per person (render-only trig).
          const a = hash01(v.id, 0, 205) * Math.PI * 2;
          const d = r0 + hash01(v.id, 0, 206) * (r1 - r0);
          tx = fire[0] + Math.cos(a) * d;
          ty = fire[1] + Math.sin(a) * d * 0.6 + 2;
        }
      }
      const dx = tx - v.x;
      const dy = ty - v.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > step) {
        v.x += (dx / len) * step;
        v.y += (dy / len) * step;
        v.moving = true;
        if (Math.abs(dx) > 0.5) v.facingLeft = dx < 0;
        const home = this.homes.get(v.groupId);
        v.homeward = home !== undefined && (home[0] - v.x) * dx + (home[1] - v.y) * dy > 0;
      } else {
        v.x = tx;
        v.y = ty;
        v.moving = false;
        if (!v.child && nowMs >= v.nextIdleMs && !night) {
          // A tiny shuffle now and then, so a standing crowd looks alive.
          v.tx += (Math.random() * 2 - 1) * R.idleStepPx;
          v.ty += (Math.random() * 2 - 1) * R.idleStepPx;
          v.nextIdleMs = nowMs + R.idleStepMs;
        }
      }
      if (v.flock) {
        // The herder's two goats amble after them.
        for (let k = 0; k < 2; k++) {
          const gx = v.x + (k === 0 ? -P8.herdFollowPx : P8.herdFollowPx), gy = v.y + 1 + k;
          const fx = gx - v.flock[k * 2]!, fy = gy - v.flock[k * 2 + 1]!;
          const fl = Math.sqrt(fx * fx + fy * fy);
          if (fl > step * 0.8) {
            v.flock[k * 2] = v.flock[k * 2]! + (fx / fl) * step * 0.8;
            v.flock[k * 2 + 1] = v.flock[k * 2 + 1]! + (fy / fl) * step * 0.8;
            if (Math.abs(fx) > 0.5) v.flockLeft![k] = fx < 0 ? 1 : 0;
          }
        }
      }
    }
  }

  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    const walk2 = Math.floor(nowMs / R.walkFrameMs) % 2 === 1 ? 1 : 0;
    const work = Math.floor(nowMs / P8.poseFrameMs) % 2;
    const night = this.darkness > P8.nightGatherAbove;
    const hunts = new Map<number, [number, number]>();
    for (const v of this.list) {
      const f = v.moving ? walk2 : 0;
      if (v.rider) {
        push((v.facingLeft && v.riderLeft ? v.riderLeft : v.walk)[f]!, v.x, v.y);
      } else if (v.moving) {
        const frames = v.homeward && v.carry ? v.carry : v.tool ?? v.walk;
        push(frames[f]!, v.x, v.y);
      } else if (v.pose && !night) {
        // Work poses alternate out of step, so a field of workers doesn't move as one.
        const k = (work + (v.id & 1)) % 2;
        push((v.poseLeft && v.poseFlip ? v.poseFlip : v.pose)[k]!, v.x, v.y);
        if (v.action === Action.Fish && this.splash && Math.random() < 0.01) this.splash(v.x + (v.poseLeft ? -5 : 5), v.y - 1);
      } else {
        push((v.tool ?? v.walk)[0]!, v.x, v.y);
        if (v.action === Action.Hunt && !night) {
          const key = Math.round(v.tx / TILE) * 1000 + Math.round(v.ty / TILE);
          if (!hunts.has(key)) hunts.set(key, [v.x, v.y]);
        }
      }
      if (v.flock) {
        for (let k = 0; k < 2; k++) push(animalSprite(Species.Herd, v.moving ? (walk2 + 1) as 1 | 2 : 1, v.flockLeft![k] === 1), v.flock[k * 2]!, v.flock[k * 2 + 1]!);
      }
    }
    // F8 hunting scene: a deer darts to and fro just out of reach (render-only trig).
    for (const [key, [hx, hy]] of hunts) {
      const t = nowMs / 700 + (key % 97);
      const x = hx + Math.cos(t) * P8.huntDeerPx;
      const left = Math.sin(t) > 0;
      push(animalSprite(Species.Prey, Math.floor(nowMs / 120) % 2 === 0 ? 1 : 2, left), x, hy - 3);
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

  /** People in a map-px rectangle doing one of `actions` (for sound). */
  countIn(x: number, y: number, w: number, h: number, actions: ReadonlySet<number>): number {
    let n = 0;
    for (const v of this.list) if (!v.moving && actions.has(v.action) && v.x >= x && v.y >= y && v.x <= x + w && v.y <= y + h) n++;
    return n;
  }

  get count(): number { return this.list.length; }
}

interface Fighter { x: number; y: number; bx: number; by: number; dir: number; phase: number; imgs: [HTMLCanvasElement, HTMLCanvasElement] }

/**
 * Battle crowds (F8 §14.3): while two groups are at war, a crowd from each side clashes on the
 * land between their homes, spears out, with dust kicked up. Visual only.
 */
export class Battles {
  private key = '';
  private fighters: Fighter[] = [];
  /** A puff of dust (the effects layer draws it). */
  dust: ((x: number, y: number) => void) | null = null;

  update(map: MapData, groups: readonly GroupView[], relations: readonly RelationView[]): void {
    const wars = relations.filter((r) => r.kind === 'war');
    const key = wars.map((r) => `${r.a}-${r.b}`).join('|') + '/' + groups.map((g) => `${g.id}:${g.homeX},${g.homeY},${g.colourIndex}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.fighters = [];
    const byId = new Map(groups.map((g) => [g.id, g]));
    for (const r of wars) {
      const a = byId.get(r.a), b = byId.get(r.b);
      if (!a || !b) continue;
      const spot = landBetween(map, a.homeX, a.homeY, b.homeX, b.homeY);
      if (!spot) continue;
      const n = Math.floor(P8.battleMax / 2);
      const leftFirst = a.homeX <= b.homeX;
      for (const [g, side] of [[a, leftFirst ? -1 : 1], [b, leftFirst ? 1 : -1]] as const) {
        for (let k = 0; k < n; k++) {
          const look: PersonLook = {
            female: Math.random() < 0.3, ageClass: AgeClass.Adult, colorIndex: g.colourIndex,
            skin: Math.floor(Math.random() * 3), hair: Math.floor(Math.random() * 3), clothed: true,
          };
          const bx = spot[0] + side * (3 + Math.random() * P8.battleSpreadPx * 0.5);
          const by = spot[1] + (Math.random() - 0.5) * P8.battleSpreadPx;
          this.fighters.push({ x: bx, y: by, bx, by, dir: -side, phase: Math.random() * Math.PI * 2, imgs: [hunterSprite(look, 1), hunterSprite(look, 2)] });
        }
      }
    }
  }

  animate(nowMs: number): void {
    for (const f of this.fighters) {
      // Lunge toward the enemy and back (render-only trig).
      const t = nowMs / 260 + f.phase;
      f.x = f.bx + f.dir * (1 + Math.sin(t) * 2.5);
      f.y = f.by + Math.cos(t * 0.7) * 0.8;
      if (this.dust && Math.random() < 0.004) this.dust(f.x, f.y);
    }
  }

  collect(nowMs: number, push: (img: HTMLCanvasElement, x: number, y: number) => void): void {
    const frame = Math.floor(nowMs / P8.battleFrameMs) % 2;
    for (let k = 0; k < this.fighters.length; k++) {
      const f = this.fighters[k]!;
      push(f.imgs[(frame + k) % 2]!, f.x, f.y);
    }
  }

  clear(): void {
    this.key = '';
    this.fighters = [];
  }
}

/** The land tile nearest the midpoint of two homes along the line between them (map px of its centre). */
function landBetween(map: MapData, ax: number, ay: number, bx: number, by: number): [number, number] | null {
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
  const order: number[] = [];
  for (let k = 0; k <= steps; k++) order.push(k);
  order.sort((p, q) => Math.abs(p - steps / 2) - Math.abs(q - steps / 2));
  for (const k of order) {
    const x = Math.round(ax + ((bx - ax) * k) / steps), y = Math.round(ay + ((by - ay) * k) / steps);
    const i = y * map.width + x;
    if (map.ground[i] !== Ground.Water && map.wall[i] === WallType.None) return [(x + 0.5) * TILE, (y + 0.5) * TILE + TILE / 2];
  }
  return null;
}
