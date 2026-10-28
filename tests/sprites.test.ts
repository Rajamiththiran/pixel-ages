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
  // F8 (future blueprint §14): poses, carried items, buildings by era, special buildings,
  // fortifications, effects and icons.
  gather_1: [5, 6], gather_2: [5, 6], farm_1: [6, 7], farm_2: [6, 7], cut_1: [6, 7], cut_2: [6, 7],
  fish_1: [8, 7], fish_2: [8, 7], build_1: [6, 6], build_2: [6, 6], staff: [2, 6],
  item_basket: [2, 2], item_meat: [2, 2], item_wood: [2, 2], item_pot: [2, 2], item_fish: [2, 1],
  leanTo: [8, 8], longhouse: [16, 16], stoneHouse: [16, 16],
  granary: [8, 8], well: [8, 8], kiln: [8, 8], smithy: [8, 8], scriptorium: [8, 8], temple: [16, 16],
  palisadePost: [2, 5], stoneWallPiece: [3, 3], flame_1: [4, 5], flame_2: [4, 5], sailboat: [8, 7],
  ...Object.fromEntries([
    'fire', 'tool', 'weapon', 'boat', 'cloth', 'animal', 'wheat', 'pot', 'house', 'wheel', 'metal', 'scroll',
    'drop', 'fish', 'wave', 'rock', 'dust', 'skull', 'bug', 'leaf', 'sun', 'cloud', 'snow', 'hand', 'berry',
    'trade', 'shield', 'arrow', 'eye', 'star', 'people',
    'crown', 'flag', 'chain',       // C4 realms
  ].map((k) => [`icon_${k}`, [7, 7] as [number, number]])),
  // C4 realm banners and pennants.
  banner_1: [5, 10], banner_2: [5, 10], banner_royal_1: [6, 12], banner_royal_2: [6, 12], pennant_1: [4, 7], pennant_2: [4, 7],
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
