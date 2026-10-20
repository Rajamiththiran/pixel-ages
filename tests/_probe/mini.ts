// Tuning world for fast probes (not a test): Scenario A's layout at half size (80 × 45) with
// 4 couples instead of 2, so runs are ~4× cheaper and rarely end by founder bad luck.
// Results must be confirmed on Scenario A before numbers are settled (TUNING.md).

import { Ground, Plant, Resource, Species, WallType } from '../../src/shared/ids';
import type { MapData, RunSetup } from '../../src/shared/types';

const W = 80;
const H = 45;

function emptyMap(): MapData {
  const n = W * H;
  const u8 = (): Uint8Array => new Uint8Array(n);
  return {
    version: 3, width: W, height: H, ground: u8(), plantType: u8(), plantDensity: u8(), resourceType: u8(),
    resourceAmount: u8(), rain: u8(), animals: [u8(), u8(), u8(), u8()], wall: u8(), elevation: u8(),
  };
}

const at = (x: number, y: number): number => y * W + x;
const rect = (x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void): void => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(at(x, y));
};

/** Mini Garden: forest west, grass east, a 1-tile river at x = 40 with clay banks, stone, copper, iron. */
export function miniGarden(seed = 1): RunSetup {
  const m = emptyMap();
  rect(0, 0, W - 1, H - 1, (i) => {
    const x = i % W, y = Math.floor(i / W);
    m.rain[i] = 60;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { m.wall[i] = WallType.Sea; return; }
    if (x < 40) {
      m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255;
      m.animals[Species.Prey][i] = 153; m.animals[Species.Predator][i] = 26;
    } else {
      m.plantType[i] = Plant.Grass; m.plantDensity[i] = 255;
      m.animals[Species.Prey][i] = 77; m.animals[Species.Herd][i] = 102; m.animals[Species.Riding][i] = 77;
    }
  });
  for (const [x0, y0] of [[30, 15], [46, 25], [32, 29]] as const) {
    rect(x0, y0, x0 + 3, y0 + 3, (i) => { m.plantType[i] = Plant.FruitBushes; m.plantDensity[i] = 255; });
  }
  rect(40, 1, 40, H - 2, (i) => {
    m.ground[i] = Ground.Water; m.plantType[i] = Plant.None; m.plantDensity[i] = 0;
    for (let s = 0; s < 4; s++) m.animals[s]![i] = 0;
  });
  for (const x of [39, 41]) rect(x, 1, x, H - 2, (i) => { m.resourceType[i] = Resource.Clay; m.resourceAmount[i] = 255; });
  for (const [cx, cy] of [[35, 20], [50, 30]] as const) {
    rect(cx - 1, cy - 1, cx + 1, cy + 1, (i) => { m.resourceType[i] = Resource.Stone; m.resourceAmount[i] = 255; });
  }
  const mountain = (x0: number, y0: number, res: number): void => rect(x0, y0, x0 + 3, y0 + 3, (i) => {
    m.ground[i] = Ground.Mountain; m.plantType[i] = Plant.None; m.plantDensity[i] = 0;
    m.resourceType[i] = res; m.resourceAmount[i] = 255;
  });
  mountain(65, 10, Resource.Copper);
  mountain(15, 35, Resource.Iron);
  // Four couples the pairing rule accepts (each man 1–4 years older than his partner).
  const people = [22, 20, 26, 24, 30, 27, 24, 22].map((age, k) => ({
    sex: (k % 2) as 0 | 1, age, intelligence: 100, cooperation: 50, strength: 50,
  }));
  return {
    version: 3, name: 'Mini Garden', map: m, events: [], seed, climateDrift: 'off',
    founders: [{ id: 1, name: 'Garden', colorIndex: 0, x: 38, y: 22, people }],
  };
}
