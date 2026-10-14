import { describe, expect, it } from 'vitest';
import { SPRITES, SPRITE_LEGEND } from '../src/render/spriteData';

// Every sprite named in §19 with its size.
const EXPECTED: Record<string, [number, number]> = {
  adult_m_1: [4, 6], adult_m_2: [4, 6], adult_f_1: [4, 6], adult_f_2: [4, 6],
  child_1: [3, 4], child_2: [3, 4], spear: [1, 5],
  deer_1: [6, 5], deer_2: [6, 5], wolf_1: [6, 4], wolf_2: [6, 4],
  goat_1: [5, 4], goat_2: [5, 4], horse_1: [7, 5], horse_2: [7, 5],
  hut: [8, 8], house: [16, 16], city: [16, 24],
  campfire_1: [3, 3], campfire_2: [3, 3], raft: [6, 3], boat: [8, 3], cart: [7, 4], bridge: [8, 8],
};

describe('sprite grids (§19)', () => {
  it('contains exactly the sprites of the spec sheet', () => {
    expect(Object.keys(SPRITES).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [name, def] of Object.entries(SPRITES)) {
    it(`${name}: size, row lengths and legend`, () => {
      expect([def.w, def.h]).toEqual(EXPECTED[name]);
      expect(def.rows.length).toBe(def.h);
      for (const row of def.rows) {
        expect(row.length).toBe(def.w);
        for (const ch of row) expect(SPRITE_LEGEND).toContain(ch);
      }
    });
  }
});
