// Visual fixes (DECISIONS §43): with their terrain switches off in the URL, the terrain is
// pixel-identical to before them (the 6 Nov 2026 hashes of tests/seasons.test.ts). Its own file,
// because the switches are read once when the modules load.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { MapData } from '../src/shared/types';
import type { TileExtras } from '../src/render/terrain';

const OLD: Record<string, string[]> = {
  allTiles: ['c5dee6fe', 'f351a039', '9721c13d', 'a310e027'],
  A: ['b18f65e4', '29f0b43c', '0f8e71a8', '273a6251'],
  F: ['8f5283d2', '19478917', 'aeb0d896', '302cb3cf'],
  H: ['4db6190d', '74ec91dd', 'b0443fcd', 'a8b4b835'],
};
const STEPS = [[0, 0], [1, 3], [3, 5], [7, 2]] as const;

function fnv(d: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < d.length; k++) { h ^= d[k]!; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

type Extra = Pick<TileExtras, 'marks' | 'hazards' | 'look' | 'base'>;
let maps: Array<[string, MapData, Extra]> = [];
let drawTilePixels: typeof import('../src/render/terrain').drawTilePixels;
let computeDepth: typeof import('../src/render/terrainDetail').computeDepth;
let TILE = 8;

beforeAll(async () => {
  vi.stubGlobal('location', { search: '?off=ruins,bushes,pathPatches,clearings,edges' });
  ({ drawTilePixels } = await import('../src/render/terrain'));
  ({ computeDepth } = await import('../src/render/terrainDetail'));
  TILE = (await import('../src/config')).CONFIG.map.tilePx;
  const f = await import('./fixtures');
  const none: Extra = { marks: null, hazards: null, look: null, base: null };
  const all = f.allTilesMap();
  maps = [
    ['allTiles', all.m, { marks: all.marks, hazards: all.hazards, look: all.look, base: all.base }],
    ['A', f.scenarioA().map, none], ['F', f.scenarioF().map, none], ['H', f.scenarioH().map, none],
  ];
});

describe('visual fixes switched off', () => {
  it('the terrain matches the hashes taken before them', () => {
    for (const [name, m, x] of maps) {
      STEPS.forEach((s, k) => {
        const depth = new Uint8Array(m.width * m.height);
        computeDepth(m, depth);
        const imgW = m.width * TILE;
        const data = new Uint8ClampedArray(imgW * m.height * TILE * 4);
        for (let i = 0; i < m.width * m.height; i++) {
          drawTilePixels(m, i, data, imgW, { waterStep: s[0], riverStep: s[1] }, { depth, crossing: null, ...x, mat: null });
        }
        expect(fnv(data), `${name} step ${k}`).toBe(OLD[name]![k]);
      });
    }
  });
});
