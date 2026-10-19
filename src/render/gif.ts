// A small animated-GIF encoder (F8 §14.6, "short GIF export"): colours reduced to one shared
// palette, frames LZW-compressed (GIF89a), looping forever. No packages: pure byte work.

/**
 * Reduces RGBA frames to at most `maxColours` (≤ 256) shared colours. Colours are bucketed at 5
 * bits per channel; the most used buckets become the palette, and every other bucket maps to
 * its nearest palette colour. Pixel art has few colours, so little is lost.
 */
export function quantize(frames: readonly Uint8ClampedArray[], maxColours = 256): { palette: Uint8Array; indexed: Uint8Array[] } {
  const counts = new Uint32Array(32768);
  const key = (d: Uint8ClampedArray, o: number): number => ((d[o]! >> 3) << 10) | ((d[o + 1]! >> 3) << 5) | (d[o + 2]! >> 3);
  for (const f of frames) for (let o = 0; o < f.length; o += 4) counts[key(f, o)]!++;
  const used: number[] = [];
  for (let k = 0; k < counts.length; k++) if (counts[k]! > 0) used.push(k);
  used.sort((a, b) => counts[b]! - counts[a]!);
  const top = used.slice(0, Math.min(256, maxColours));
  const palette = new Uint8Array(256 * 3);
  const rgbOf = (k: number): [number, number, number] => {
    const r = (k >> 10) & 31, g = (k >> 5) & 31, b = k & 31;
    return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2)];
  };
  top.forEach((k, i) => palette.set(rgbOf(k), i * 3));
  const map = new Int16Array(32768).fill(-1);
  top.forEach((k, i) => { map[k] = i; });
  for (const k of used) {
    if (map[k]! >= 0) continue;
    const [r, g, b] = rgbOf(k);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < top.length; i++) {
      const dr = palette[i * 3]! - r, dg = palette[i * 3 + 1]! - g, db = palette[i * 3 + 2]! - b;
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;   // greens matter most to the eye
      if (d < bestD) { bestD = d; best = i; }
    }
    map[k] = best;
  }
  const indexed = frames.map((f) => {
    const out = new Uint8Array(f.length / 4);
    for (let o = 0, p = 0; o < f.length; o += 4, p++) out[p] = map[key(f, o)]!;
    return out;
  });
  return { palette, indexed };
}

/** GIF's variable-width LZW: clear code first, codes grow from minCodeSize + 1 bits up to 12. */
export function lzwEncode(indices: Uint8Array, minCodeSize = 8): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out: number[] = [];
  let bitBuf = 0, bitCount = 0;
  let size = minCodeSize + 1;
  const emit = (code: number): void => {
    bitBuf |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) { out.push(bitBuf & 255); bitBuf >>>= 8; bitCount -= 8; }
  };
  let dict = new Map<number, number>();
  let next = eoi + 1;
  emit(clear);
  if (indices.length === 0) { emit(eoi); if (bitCount > 0) out.push(bitBuf & 255); return Uint8Array.from(out); }
  let prefix = indices[0]!;
  for (let k = 1; k < indices.length; k++) {
    const c = indices[k]!;
    const id = prefix * 256 + c;
    const found = dict.get(id);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(id, next++);
      // The decoder widens one code later than the encoder adds the entry.
      if (next > (1 << size) && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      size = minCodeSize + 1;
    }
    prefix = c;
  }
  emit(prefix);
  emit(eoi);
  if (bitCount > 0) out.push(bitBuf & 255);
  return Uint8Array.from(out);
}

/** An animated GIF: indexed frames over one 256-colour palette, `delayCs` hundredths of a second each. */
export function encodeGif(frames: readonly Uint8Array[], width: number, height: number, palette: Uint8Array, delayCs: number): Uint8Array {
  const out: number[] = [];
  const u8 = (v: number): void => { out.push(v & 255); };
  const u16 = (v: number): void => { u8(v); u8(v >> 8); };
  const str = (s: string): void => { for (const ch of s) u8(ch.charCodeAt(0)); };
  str('GIF89a');
  u16(width); u16(height);
  u8(0xf7); u8(0); u8(0);                       // global colour table, 256 entries
  for (let k = 0; k < 256 * 3; k++) u8(palette[k] ?? 0);
  // Loop forever (NETSCAPE2.0).
  u8(0x21); u8(0xff); u8(11); str('NETSCAPE2.0'); u8(3); u8(1); u16(0); u8(0);
  for (const f of frames) {
    u8(0x21); u8(0xf9); u8(4); u8(0x04); u16(delayCs); u8(0); u8(0); // graphic control: keep the frame
    u8(0x2c); u16(0); u16(0); u16(width); u16(height); u8(0);
    u8(8);                                         // LZW minimum code size
    const data = lzwEncode(f, 8);
    for (let o = 0; o < data.length; o += 255) {
      const n = Math.min(255, data.length - o);
      u8(n);
      for (let k = 0; k < n; k++) out.push(data[o + k]!);
    }
    u8(0);
  }
  u8(0x3b);
  return Uint8Array.from(out);
}
