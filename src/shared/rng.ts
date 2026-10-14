// Seeded PRNG (§16.1): sfc32 seeded through splitmix32. The 4 × uint32 state lives in
// SimState and in every keyframe, so a restored state continues the exact same sequence.

export type RngState = Uint32Array; // length 4

function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function createRng(seed: number): RngState {
  const sm = splitmix32(seed);
  const s = new Uint32Array([sm(), sm(), sm(), sm()]);
  for (let i = 0; i < 12; i++) nextU32(s); // warm up
  return s;
}

export function nextU32(s: RngState): number {
  let a = s[0]!, b = s[1]!, c = s[2]!, d = s[3]!;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  s[0] = a; s[1] = b; s[2] = c; s[3] = d;
  return t >>> 0;
}

export const float = (s: RngState): number => nextU32(s) / 4294967296;          // [0, 1)
export const chance = (s: RngState, p: number): boolean => float(s) < p;
export const int = (s: RngState, n: number): number => Math.floor(float(s) * n);  // 0..n-1

// Irwin–Hall: sum of 4 uniforms, scaled to mean 0, sd 1. No log/sin needed.
export function gaussian(s: RngState): number {
  return (float(s) + float(s) + float(s) + float(s) - 2) * 1.7320508075688772;
}

// 2.3 → 2 or 3, with a 30% chance of 3
export function stochasticRound(s: RngState, x: number): number {
  const f = Math.floor(x);
  return f + (float(s) < x - f ? 1 : 0);
}
