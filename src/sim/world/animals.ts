// Animals (§10.4): densities 0–1 per tile and species; logistic growth toward habitat
// capacity, predator–prey, and diffusion to orthogonal neighbours.

import { CONFIG } from '../../config';
import { Ground, Plant, Species, WallType } from '../../shared/ids';
import type { SimState } from '../state';

const A = CONFIG.animals;

interface Habitat { ground: readonly number[]; forest: number; growth: number }
const HABITAT: Record<number, Habitat> = {
  [Species.Prey]: A.prey,
  [Species.Herd]: A.herd,
  [Species.Riding]: A.riding,
};

/** Habitat capacity K for Prey, Herd or Riding on tile i. */
export function capacity(s: SimState, species: number, i: number): number {
  const h = HABITAT[species];
  if (!h) return 0;
  // Intact walls (river, mountain range, sea) are not habitat; animals there slowly vanish.
  if (s.wall[i] !== WallType.None && s.crossing[i] === 0) return 0;
  const forest = s.plantType[i] === Plant.Forest && s.plantDensity[i]! >= A.forestMinDensity;
  const suit = forest ? h.forest : h.ground[s.ground[i]!]!;
  const rainTerm = Math.min(1, Math.max(A.capacityRainBase, A.capacityRainBase + s.rainNow[i]! / 100));
  return suit * rainTerm;
}

/** Tiles animals can diffuse into: not Water, not an intact wall. */
const passable = (s: SimState, j: number): boolean =>
  s.ground[j] !== Ground.Water && (s.wall[j] === WallType.None || s.crossing[j] === 1);

// Scratch buffers, reused every tick (sim-local, never part of the state).
let scratch = new Float32Array(0);
let openDirs = new Uint8Array(0);   // bit 0 up, 1 left, 2 right, 3 down: neighbour accepts animals
let openCount = new Uint8Array(0);

const N_UP = 1, N_LEFT = 2, N_RIGHT = 4, N_DOWN = 8;

/** Which orthogonal neighbours of each tile animals can move into. Rebuilt per tick (ground and crossings change). */
function buildOpenDirs(s: SimState): void {
  const n = s.ground.length;
  if (openDirs.length !== n) { openDirs = new Uint8Array(n); openCount = new Uint8Array(n); }
  const w = s.width;
  const h = s.height;
  for (let i = 0; i < n; i++) {
    const x = i % w;
    const y = (i - x) / w;
    let bits = 0, c = 0;
    if (y > 0 && passable(s, i - w)) { bits |= N_UP; c++; }
    if (x > 0 && passable(s, i - 1)) { bits |= N_LEFT; c++; }
    if (x < w - 1 && passable(s, i + 1)) { bits |= N_RIGHT; c++; }
    if (y < h - 1 && passable(s, i + w)) { bits |= N_DOWN; c++; }
    openDirs[i] = bits;
    openCount[i] = c;
  }
}

export function updateAnimals(s: SimState): void {
  const n = s.ground.length;
  const prey = s.animal[Species.Prey];
  const pred = s.animal[Species.Predator];
  const herd = s.animal[Species.Herd];
  const ride = s.animal[Species.Riding];
  const P = A.prey, Hd = A.herd, R = A.riding;

  // Local growth and predation, tile by tile (each tile only reads itself).
  // Same formulas as capacity(), inlined: this loop runs for every tile every month.
  // Also notes which species exist anywhere, so diffusion can skip empty ones.
  let anyPrey = false, anyPred = false, anyHerd = false, anyRide = false;
  for (let i = 0; i < n; i++) {
    const yv = prey[i]!, hv = herd[i]!, rv = ride[i]!, p = pred[i]!;
    if (yv === 0 && hv === 0 && rv === 0 && p === 0) continue;
    if (yv !== 0) anyPrey = true;
    if (p !== 0) anyPred = true;
    if (hv !== 0) anyHerd = true;
    if (rv !== 0) anyRide = true;
    let ky = 0, kh = 0, kr = 0;
    if (s.wall[i] === WallType.None || s.crossing[i] === 1) {
      const rainTerm = Math.min(1, Math.max(A.capacityRainBase, A.capacityRainBase + s.rainNow[i]! / 100));
      if (s.plantType[i] === Plant.Forest && s.plantDensity[i]! >= A.forestMinDensity) {
        ky = P.forest * rainTerm; kh = Hd.forest * rainTerm; kr = R.forest * rainTerm;
      } else {
        const g = s.ground[i]!;
        ky = P.ground[g]! * rainTerm; kh = Hd.ground[g]! * rainTerm; kr = R.ground[g]! * rainTerm;
      }
    }
    let y = yv;
    if (yv !== 0) y = ky > 0 ? yv + P.growth * yv * (1 - yv / ky) : yv - A.noHabitatDecay * yv;
    if (hv !== 0) herd[i] = kh > 0 ? hv + Hd.growth * hv * (1 - hv / kh) : hv - A.noHabitatDecay * hv;
    if (rv !== 0) ride[i] = kr > 0 ? rv + R.growth * rv * (1 - rv / kr) : rv - A.noHabitatDecay * rv;
    if (p > 0) {
      // Lotka–Volterra step: both lines use the same prey value, so order doesn't matter.
      pred[i] = p + A.predatorGain * p * y - A.predatorDeath * p;
      y = y - A.predation * p * y;
    }
    prey[i] = y;
  }

  // Diffusion: each tile gives 3% of its density, a quarter to each orthogonal neighbour.
  // Reads from a copy so tile order can't bias the result. Shares toward blocked tiles stay.
  buildOpenDirs(s);
  if (scratch.length !== n) scratch = new Float32Array(n);
  const w = s.width;
  const share = A.diffusion / 4;
  const alive = [anyPrey, anyPred, anyHerd, anyRide];
  for (let sp = 0; sp < 4; sp++) {
    if (!alive[sp]) continue;
    const arr = s.animal[sp]!;
    scratch.set(arr);
    for (let i = 0; i < n; i++) {
      const d = scratch[i]!;
      if (d === 0) continue;
      const bits = openDirs[i]!;
      if (bits === 0) continue;
      const give = d * share;
      arr[i] = arr[i]! - give * openCount[i]!;
      if (bits & N_UP) arr[i - w] = arr[i - w]! + give;
      if (bits & N_LEFT) arr[i - 1] = arr[i - 1]! + give;
      if (bits & N_RIGHT) arr[i + 1] = arr[i + 1]! + give;
      if (bits & N_DOWN) arr[i + w] = arr[i + w]! + give;
    }
    for (let i = 0; i < n; i++) {
      const d = arr[i]!;
      if (d !== 0) arr[i] = d < A.minDensity ? 0 : d > 1 ? 1 : d;
    }
  }
}
