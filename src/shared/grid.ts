// Grid helpers: index ↔ x,y, neighbours, disks, distance (§8.1).
// Pure and integer-only so both the simulation and the editor can use them.

export const idx = (x: number, y: number, width: number): number => y * width + x;
export const xOf = (i: number, width: number): number => i % width;
export const yOf = (i: number, width: number): number => Math.floor(i / width);

export const inBounds = (x: number, y: number, width: number, height: number): boolean =>
  x >= 0 && y >= 0 && x < width && y < height;

export const dist2 = (x0: number, y0: number, x1: number, y1: number): number => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return dx * dx + dy * dy;
};

export const distance = (x0: number, y0: number, x1: number, y1: number): number =>
  Math.sqrt(dist2(x0, y0, x1, y1));

// Offsets in a fixed order so callers iterate deterministically.
export const N4: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1]];
export const N8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** Calls fn for each in-bounds 4-neighbour index of tile i, in N4 order. */
export function forEach4(i: number, width: number, height: number, fn: (n: number) => void): void {
  const x = i % width;
  const y = (i - x) / width;
  if (y > 0) fn(i - width);
  if (x > 0) fn(i - 1);
  if (x < width - 1) fn(i + 1);
  if (y < height - 1) fn(i + width);
}

/**
 * Calls fn for each passable 8-neighbour of tile i. A diagonal step is only allowed
 * if both orthogonal neighbours are passable (no corner cutting through walls, §8.1).
 */
export function forEach8Passable(
  i: number, width: number, height: number,
  passable: (n: number) => boolean, fn: (n: number) => void,
): void {
  const x = i % width;
  const y = (i - x) / width;
  for (const [dx, dy] of N8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny, width, height)) continue;
    const n = ny * width + nx;
    if (!passable(n)) continue;
    if (dx !== 0 && dy !== 0) {
      if (!passable(y * width + nx) || !passable(ny * width + x)) continue;
    }
    fn(n);
  }
}

/**
 * Calls fn for every in-bounds tile with dx² + dy² ≤ r2 around (cx, cy),
 * in ascending index order.
 */
export function forEachInDisk(
  cx: number, cy: number, r2: number, width: number, height: number,
  fn: (i: number, x: number, y: number) => void,
): void {
  const r = Math.floor(Math.sqrt(r2));
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(height - 1, cy + r);
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(width - 1, cx + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (dist2(cx, cy, x, y) <= r2) fn(y * width + x, x, y);
    }
  }
}

/** Integer tiles on the line from (x0,y0) to (x1,y1), both ends included (Bresenham). */
export function lineTiles(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}
