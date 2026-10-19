// Pixel font (F8 §14.7): 5×7 capitals, digits and punctuation, drawn in the game's pixel style.
// Map labels blit it straight onto the canvas (crisp at every zoom). For the page, the same
// glyphs are turned into a tiny TrueType font in memory and loaded with FontFace, so headings
// use it too — no font file, no package. Lower case is drawn as capitals.

/** Glyph rows, top to bottom; '#' is ink. Widths vary (space, punctuation are narrow). */
export const GLYPHS: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '..', '.#', '#.'],
  ':': ['.', '.', '#', '.', '.', '#', '.'],
  ';': ['..', '..', '.#', '..', '..', '.#', '#.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '"': ['#.#', '#.#', '...', '...', '...', '...', '...'],
  '(': ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  ')': ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##'],
  '#': ['.#.#.', '#####', '.#.#.', '.#.#.', '.#.#.', '#####', '.#.#.'],
  '×': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
  '→': ['.....', '...#.', '....#', '#####', '....#', '...#.', '.....'],
  '·': ['.', '.', '.', '#', '.', '.', '.'],
  '—': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '–': ['....', '....', '....', '####', '....', '....', '....'],
};

export const GLYPH_H = 7;

/** The glyph for one character: capitals for lower case, accents dropped, '?' for anything unknown. */
export function glyphOf(ch: string): readonly string[] {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS[ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()] ?? GLYPHS['?']!;
}

/** Text width in pixels: glyph widths plus one pixel between glyphs. */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += glyphOf(ch)[0]!.length + 1;
  return Math.max(0, w - 1);
}

// ---------- canvas ----------

const cache = new Map<string, HTMLCanvasElement>();

/** The text in `colour` with a dark shadow one pixel down-right, cached. */
export function textCanvas(text: string, colour: string, shadow = 'rgba(28, 26, 36, 0.85)'): HTMLCanvasElement {
  const key = `${text}|${colour}|${shadow}`;
  let c = cache.get(key);
  if (c) return c;
  if (cache.size > 600) cache.clear();
  c = document.createElement('canvas');
  c.width = textWidth(text) + 1;
  c.height = GLYPH_H + 1;
  const ctx = c.getContext('2d')!;
  for (const [dx, col] of [[1, shadow], [0, colour]] as const) {
    ctx.fillStyle = col;
    let x = 0;
    for (const ch of text) {
      const g = glyphOf(ch);
      for (let r = 0; r < GLYPH_H; r++) {
        const row = g[r]!;
        for (let k = 0; k < row.length; k++) if (row[k] === '#') ctx.fillRect(x + k + dx, r + dx, 1, 1);
      }
      x += g[0]!.length + 1;
    }
  }
  cache.set(key, c);
  return c;
}

/** Draws pixel text with its anchor at (x, y), on whole pixels. */
export function drawPixelText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string,
  align: 'left' | 'center' | 'right' = 'left', baseline: 'top' | 'bottom' = 'top',
): void {
  const c = textCanvas(text, colour);
  const left = align === 'left' ? x : align === 'center' ? x - (c.width >> 1) : x - c.width;
  const top = baseline === 'top' ? y : y - c.height;
  ctx.drawImage(c, Math.round(left), Math.round(top));
}

// ---------- TrueType ----------

const UNIT = 100;                  // font units per pixel
const ASCENT = (GLYPH_H + 1) * UNIT;
const DESCENT = 2 * UNIT;

/** One glyph as rectangles (merged horizontal runs): [x, y, w, h] in pixels, y from the top. */
function runs(g: readonly string[]): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  g.forEach((row, r) => {
    let k = 0;
    while (k < row.length) {
      if (row[k] !== '#') { k++; continue; }
      const start = k;
      while (k < row.length && row[k] === '#') k++;
      out.push([start, r, k - start, 1]);
    }
  });
  return out;
}

class Bytes {
  private buf: number[] = [];
  u8(v: number): this { this.buf.push(v & 255); return this; }
  u16(v: number): this { return this.u8(v >> 8).u8(v); }
  i16(v: number): this { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v: number): this { return this.u16(Math.floor(v / 65536) & 0xffff).u16(v & 0xffff); }
  tag(s: string): this { for (let k = 0; k < 4; k++) this.u8(s.charCodeAt(k)); return this; }
  pad4(): this { while (this.buf.length % 4) this.u8(0); return this; }
  get length(): number { return this.buf.length; }
  bytes(): Uint8Array { return Uint8Array.from(this.buf); }
}

function checksum(b: Uint8Array): number {
  let sum = 0;
  for (let k = 0; k < b.length; k += 4) {
    sum = (sum + (((b[k] ?? 0) << 24) >>> 0) + ((b[k + 1] ?? 0) << 16) + ((b[k + 2] ?? 0) << 8) + (b[k + 3] ?? 0)) >>> 0;
  }
  return sum;
}

/**
 * A complete TrueType font of the glyphs (tables: cmap, glyf, head, hhea, hmtx, loca, maxp,
 * name, OS/2, post). Each lit pixel row run is one rectangular contour.
 */
export function buildPixelFont(family = 'Pixel Ages'): Uint8Array {
  const chars = Object.keys(GLYPHS);
  // Glyph 0 is .notdef (empty); then one glyph per character.
  const glyphs: Array<readonly string[] | null> = [null, ...chars.map((c) => GLYPHS[c]!)];
  const cmap = new Map<number, number>();
  chars.forEach((c, k) => {
    cmap.set(c.codePointAt(0)!, k + 1);
    const lower = c.toLowerCase();
    if (lower !== c && !GLYPHS[lower]) cmap.set(lower.codePointAt(0)!, k + 1);
  });

  // glyf + loca + hmtx
  const glyf = new Bytes();
  const loca: number[] = [];
  const hmtx = new Bytes();
  let maxPoints = 0, maxContours = 0, advanceMax = 0;
  let xMinAll = 0, xMaxAll = 0;
  for (const g of glyphs) {
    loca.push(glyf.length);
    const width = g ? g[0]!.length : 3;
    const advance = (width + 1) * UNIT;
    advanceMax = Math.max(advanceMax, advance);
    const rects = g ? runs(g) : [];
    hmtx.u16(advance).i16(rects.length ? Math.min(...rects.map((r) => r[0])) * UNIT : 0);
    if (rects.length === 0) continue;   // an empty glyph has no data
    const toY = (row: number): number => (GLYPH_H - row) * UNIT;
    const xs = rects.flatMap(([x, , w]) => [x * UNIT, (x + w) * UNIT]);
    const ys = rects.flatMap(([, y, , h]) => [toY(y + h), toY(y)]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
    xMinAll = Math.min(xMinAll, xMin); xMaxAll = Math.max(xMaxAll, xMax);
    glyf.i16(rects.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
    rects.forEach((_, k) => glyf.u16(k * 4 + 3));
    glyf.u16(0);                         // no instructions
    for (let k = 0; k < rects.length * 4; k++) glyf.u8(1); // every point on the curve, 16-bit deltas
    // Clockwise in y-up units: top-left, top-right, bottom-right, bottom-left.
    const pts: Array<[number, number]> = [];
    for (const [x, y, w, h] of rects) {
      const x0 = x * UNIT, x1 = (x + w) * UNIT, y1 = toY(y), y0 = toY(y + h);
      pts.push([x0, y1], [x1, y1], [x1, y0], [x0, y0]);
    }
    let px = 0, py = 0;
    for (const [x] of pts) { glyf.i16(x - px); px = x; }
    for (const [, y] of pts) { glyf.i16(y - py); py = y; }
    glyf.pad4();
    maxPoints = Math.max(maxPoints, pts.length);
    maxContours = Math.max(maxContours, rects.length);
  }
  loca.push(glyf.length);
  const locaB = new Bytes();
  for (const o of loca) locaB.u32(o);

  const n = glyphs.length;
  const head = new Bytes()
    .u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5)
    .u16(0x000b).u16(UNIT * 10)
    .u32(0).u32(0).u32(0).u32(0)          // created, modified
    .i16(xMinAll).i16(-DESCENT).i16(xMaxAll).i16(ASCENT)
    .u16(0).u16(8).i16(2).i16(1).i16(0);
  const hhea = new Bytes()
    .u32(0x00010000).i16(ASCENT).i16(-DESCENT).i16(0).u16(advanceMax)
    .i16(0).i16(0).i16(xMaxAll).i16(1).i16(0).i16(0)
    .i16(0).i16(0).i16(0).i16(0).i16(0).u16(n);
  const maxp = new Bytes()
    .u32(0x00010000).u16(n).u16(maxPoints).u16(maxContours).u16(0).u16(0)
    .u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);
  const codes = [...cmap.keys()].sort((a, b) => a - b);
  const os2 = new Bytes()
    .u16(4).i16(500).u16(400).u16(5).u16(0)
    .i16(650).i16(700).i16(0).i16(140).i16(650).i16(700).i16(0).i16(480).i16(50).i16(250)
    .i16(0);
  for (let k = 0; k < 10; k++) os2.u8(0);                    // panose
  os2.u32(1).u32(0).u32(0).u32(0).tag('NONE').u16(0x40)
    .u16(codes[0]!).u16(Math.min(0xffff, codes[codes.length - 1]!))
    .i16(ASCENT).i16(-DESCENT).i16(0).u16(ASCENT).u16(DESCENT)
    .u32(1).u32(0).i16(GLYPH_H * UNIT).i16(GLYPH_H * UNIT).u16(0).u16(32).u16(1);
  const post = new Bytes().u32(0x00030000).u32(0).i16(-UNIT).i16(UNIT / 2).u32(0).u32(0).u32(0).u32(0).u32(0);

  // cmap: format 4, one segment per character, plus the 0xFFFF end segment.
  const segs = [...codes.filter((c) => c < 0xffff), 0xffff];
  const segX2 = segs.length * 2;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segs.length));
  const sub = new Bytes();
  const subLen = 16 + segs.length * 8;
  sub.u16(4).u16(subLen).u16(0).u16(segX2).u16(searchRange).u16(Math.log2(searchRange / 2)).u16(segX2 - searchRange);
  for (const c of segs) sub.u16(c);
  sub.u16(0);
  for (const c of segs) sub.u16(c);
  for (const c of segs) sub.u16(c === 0xffff ? 1 : (cmap.get(c)! - c + 65536) % 65536);
  for (let k = 0; k < segs.length; k++) sub.u16(0);
  const cmapB = new Bytes().u16(0).u16(1).u16(3).u16(1).u32(12);
  const cmapBytes = new Uint8Array([...cmapB.bytes(), ...sub.bytes()]);

  // name: Windows, Unicode BMP, US English.
  const names: Array<[number, string]> = [[1, family], [2, 'Regular'], [3, `${family} Regular`], [4, family], [6, family.replace(/\s/g, '')]];
  const strings = names.map(([, s]) => { const b = new Bytes(); for (const ch of s) b.u16(ch.charCodeAt(0)); return b.bytes(); });
  const nameB = new Bytes().u16(0).u16(names.length).u16(6 + names.length * 12);
  let off = 0;
  names.forEach(([id], k) => { nameB.u16(3).u16(1).u16(0x409).u16(id).u16(strings[k]!.length).u16(off); off += strings[k]!.length; });
  const nameBytes = new Uint8Array([...nameB.bytes(), ...strings.flatMap((s) => [...s])]);

  const tables: Array<[string, Uint8Array]> = [
    ['OS/2', os2.bytes()], ['cmap', cmapBytes], ['glyf', glyf.bytes()], ['head', head.bytes()], ['hhea', hhea.bytes()],
    ['hmtx', hmtx.bytes()], ['loca', locaB.bytes()], ['maxp', maxp.bytes()], ['name', nameBytes], ['post', post.bytes()],
  ];
  tables.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const numTables = tables.length;
  const sr = 16 * 2 ** Math.floor(Math.log2(numTables));
  const dir = new Bytes().u32(0x00010000).u16(numTables).u16(sr).u16(Math.log2(sr / 16)).u16(numTables * 16 - sr);
  let offset = 12 + numTables * 16;
  const body = new Bytes();
  const headAt: number[] = [];
  for (const [tag, data] of tables) {
    dir.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
    if (tag === 'head') headAt.push(offset);
    for (const b of data) body.u8(b);
    body.pad4();
    offset = 12 + numTables * 16 + body.length;
  }
  const font = new Uint8Array([...dir.bytes(), ...body.bytes()]);
  // head.checkSumAdjustment makes the whole font sum to 0xB1B0AFBA.
  const adj = (0xb1b0afba - checksum(font) + 2 ** 32) % 2 ** 32;
  const at = headAt[0]! + 8;
  font[at] = adj >>> 24; font[at + 1] = (adj >>> 16) & 255; font[at + 2] = (adj >>> 8) & 255; font[at + 3] = adj & 255;
  return font;
}

/** Registers the pixel font with the page as "Pixel Ages". Resolves false if the browser refuses it. */
export async function installPixelFont(): Promise<boolean> {
  try {
    const face = new FontFace('Pixel Ages', buildPixelFont().buffer as ArrayBuffer);
    await face.load();
    document.fonts.add(face);
    document.documentElement.classList.add('pixel-font');
    return true;
  } catch {
    return false;
  }
}
