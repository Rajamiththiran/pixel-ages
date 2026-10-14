// Live area preview during setup (§8.3): recompute areas 200 ms after the last wall edit.

import { CONFIG } from '../config';
import type { MapData } from '../shared/types';
import { computeAreas, type AreaResult } from '../sim/world/regions';

export class RegionsPreview {
  private timer: ReturnType<typeof setTimeout> | null = null;
  current: AreaResult;

  constructor(private map: MapData, private readonly onChange: (a: AreaResult) => void) {
    this.current = computeAreas(map.wall, map.width, map.height);
  }

  setMap(map: MapData): void {
    this.map = map;
    this.recomputeNow();
  }

  /** Debounced: walls changed. */
  schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.recomputeNow(), CONFIG.editor.areaDebounceMs);
  }

  recomputeNow(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.current = computeAreas(this.map.wall, this.map.width, this.map.height);
    this.onChange(this.current);
  }
}
