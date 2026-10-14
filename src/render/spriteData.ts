// Pixel grids from §19, copied exactly. Legend in SPRITE_LEGEND.

export interface SpriteDef { w: number; h: number; rows: string[] }

/** Every character a grid may use (§19.1). */
export const SPRITE_LEGEND = '.KHSCDLWwYMmGgFf';

export const SPRITES: Record<string, SpriteDef> = {
  // §19.2 People
  adult_m_1: { w: 4, h: 6, rows: ['.HH.', '.SS.', 'SCCS', '.CC.', '.LL.', 'L..L'] },
  adult_m_2: { w: 4, h: 6, rows: ['.HH.', '.SS.', 'SCCS', '.CC.', '.LL.', '.LL.'] },
  adult_f_1: { w: 4, h: 6, rows: ['.HH.', 'HSSH', 'SCCS', '.CC.', '.CC.', 'L..L'] },
  adult_f_2: { w: 4, h: 6, rows: ['.HH.', 'HSSH', 'SCCS', '.CC.', '.CC.', '.LL.'] },
  child_1: { w: 3, h: 4, rows: ['.H.', '.S.', 'SCS', 'L.L'] },
  child_2: { w: 3, h: 4, rows: ['.H.', '.S.', 'SCS', '.L.'] },
  spear: { w: 1, h: 5, rows: ['G', 'W', 'W', 'W', 'W'] },

  // §19.3 Animals (face right)
  deer_1: { w: 6, h: 5, rows: ['.....w', '....MM', 'YMMMM.', '.MMMM.', '.w..w.'] },
  deer_2: { w: 6, h: 5, rows: ['.....w', '....MM', 'YMMMM.', '.MMMM.', 'w..w..'] },
  wolf_1: { w: 6, h: 4, rows: ['G...GG', 'GGGGG.', '.GGGG.', '.K..K.'] },
  wolf_2: { w: 6, h: 4, rows: ['G...GG', 'GGGGG.', '.GGGG.', 'K..K..'] },
  goat_1: { w: 5, h: 4, rows: ['...wg', 'gggg.', 'gggg.', '.w.w.'] },
  goat_2: { w: 5, h: 4, rows: ['...wg', 'gggg.', 'gggg.', 'w..w.'] },
  horse_1: { w: 7, h: 5, rows: ['.....wW', '.....WW', 'wWWWWW.', '.WWWWW.', '.w...w.'] },
  horse_2: { w: 7, h: 5, rows: ['.....wW', '.....WW', 'wWWWWW.', '.WWWWW.', 'w...w..'] },

  // §19.4 Buildings
  hut: {
    w: 8, h: 8, rows: [
      '...WW...',
      '..WYYW..',
      '.WYYYYW.',
      'WYYYYYYW',
      'WYYKKYYW',
      'WYYKKYYW',
      '.WWWWWW.',
      '........',
    ],
  },
  house: {
    w: 16, h: 16, rows: [
      '................',
      '.MMMMMMMMMMMMMM.',
      '.MYYYYYYYYYYYYM.',
      '.MYYYYYYYYYYYYM.',
      '.MYYYYYYYYYYYYM.',
      '.MYYYYYYYYYYYYM.',
      '.MMMMMMMMMMMMMM.',
      '.mmmmmmmmmmmmmm.',
      '.mmKKmmmmmmKKmm.',
      '.mmKKmmmmmmKKmm.',
      '.mmmmmmKKmmmmmm.',
      '.mmmmmmKKmmmmmm.',
      '.mmmmmmKKmmmmmm.',
      '.mmmmmmKKmmmmmm.',
      '.wwwwwwwwwwwwww.',
      '................',
    ],
  },
  city: {
    w: 16, h: 24, rows: [
      '....wwwwwwww....',
      '...wmmmmmmmmw...',
      '..wmmmmmmmmmmw..',
      '.wmmmmmmmmmmmmw.',
      'wmmmmmmmmmmmmmmw',
      'wmmmmmmmmmmmmmmw',
      'wwwwwwwwwwwwwwww',
      '.gggggggggggggg.',
      '.gKKgggKKgggKKg.',
      '.gKKgggKKgggKKg.',
      '.gggggggggggggg.',
      '.GGGGGGGGGGGGGG.',
      '.gggggggggggggg.',
      '.gKKgggKKgggKKg.',
      '.gKKgggKKgggKKg.',
      '.gggggggggggggg.',
      '.GGGGGGGGGGGGGG.',
      '.gggggggggggggg.',
      '.gKKggggggggKKg.',
      '.gKKgggKKgggKKg.',
      '.ggggggKKgggggg.',
      '.ggggggKKgggggg.',
      '.ggggggKKgggggg.',
      '.GGGGGGGGGGGGGG.',
    ],
  },

  // §19.5 Objects
  campfire_1: { w: 3, h: 3, rows: ['.F.', 'FfF', 'WwW'] },
  campfire_2: { w: 3, h: 3, rows: ['.fF', 'Ff.', 'WwW'] },
  raft: { w: 6, h: 3, rows: ['WWWWWW', 'wWwWwW', 'WWWWWW'] },
  boat: { w: 8, h: 3, rows: ['W......W', 'WWWWWWWW', '.wwwwww.'] },
  cart: { w: 7, h: 4, rows: ['WWWWW..', 'WwwwW..', 'WWWWWWw', '.K..K..'] },
  bridge: {
    w: 8, h: 8, rows: [
      'wWWWWWWw',
      'wWWWWWWw',
      'wwwwwwww',
      'wWWWWWWw',
      'wWWWWWWw',
      'wwwwwwww',
      'wWWWWWWw',
      'wWWWWWWw',
    ],
  },
};
