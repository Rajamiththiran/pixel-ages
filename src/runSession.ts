// Main-thread side of a run: owns the worker, sends commands, and applies frames to a
// local copy of the tiles that the renderer draws. Rendering never changes sim state.

import type { LogEntry, MapData, RunSetup } from './shared/types';
import {
  TILE_BYTES, TILE_UPDATE_BYTES, unpackTile, type AreaInfo, type Frame, type FromWorker, type InspectResult, type ToWorker,
} from './shared/protocol';
import { cloneMap } from './editor/mapState';

export interface RunHandlers {
  started(areas: AreaInfo[]): void;
  /** Tiles whose terrain look changed (not rain-only changes). */
  terrainChanged(tiles: number[] | 'all'): void;
  rainChanged(): void;
  animalsChanged(density: Float32Array[]): void;
  frame(f: Frame): void;
  progress(label: string): void;
  error(message: string): void;
  log(entries: LogEntry[]): void;
  inspect(result: InspectResult): void;
}

export class RunSession {
  private readonly worker: Worker;
  /** Current displayed tiles. `rain` holds rainNow. */
  readonly map: MapData;
  readonly crossing: Uint8Array;
  lastFrame: Frame | null = null;

  constructor(setup: RunSetup, private readonly h: RunHandlers) {
    this.map = cloneMap(setup.map);
    this.crossing = new Uint8Array(setup.map.width * setup.map.height);
    this.worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => h.error(e.message || 'The simulation stopped with an error.');
    this.send({ type: 'start', setup });
  }

  send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  stop(): void {
    this.send({ type: 'stop' });
    this.worker.terminate();
  }

  private receive(msg: FromWorker): void {
    switch (msg.type) {
      case 'started': this.h.started(msg.areas); return;
      case 'frame': this.applyFrame(msg.frame); return;
      case 'progress': this.h.progress(msg.label); return;
      case 'error': this.h.error(msg.message); return;
      case 'log': this.h.log(msg.entries); return;
      case 'inspectResult': this.h.inspect(msg.result); return;
      case 'stats': return; // graphs arrive in step 6
    }
  }

  private applyFrame(f: Frame): void {
    const m = this.map;
    const n = m.width * m.height;
    if (f.fullTiles) {
      for (let i = 0; i < n; i++) unpackTile(f.fullTiles, i * TILE_BYTES, m, m.rain, this.crossing, i);
      this.h.terrainChanged('all');
      this.h.rainChanged();
    } else if (f.tileUpdates) {
      const u = f.tileUpdates;
      const terrain: number[] = [];
      let rain = false;
      for (let o = 0; o < u.length; o += TILE_UPDATE_BYTES) {
        const i = u[o]! | (u[o + 1]! << 8);
        const oldRain = m.rain[i];
        const before = lookBytes(m, this.crossing, i);
        unpackTile(u, o + 2, m, m.rain, this.crossing, i);
        if (m.rain[i] !== oldRain) rain = true;
        // Rain alone doesn't change how a tile looks; skip the (costly) terrain redraw.
        if (lookBytes(m, this.crossing, i) !== before) terrain.push(i);
      }
      if (terrain.length > 0) this.h.terrainChanged(terrain);
      if (rain) this.h.rainChanged();
    }
    if (f.animalDensity) {
      const d = f.animalDensity;
      const out = [0, 1, 2, 3].map((sp) => {
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) a[i] = d[sp * n + i]! / 255;
        return a;
      });
      this.h.animalsChanged(out);
    }
    this.lastFrame = f;
    this.h.frame(f);
  }
}

/** Packs the bytes that affect a tile's terrain look into one number for comparison. */
function lookBytes(m: MapData, crossing: Uint8Array, i: number): number {
  return (
    m.ground[i]! * 2 ** 40 + m.plantType[i]! * 2 ** 32 + m.plantDensity[i]! * 2 ** 24 +
    m.resourceType[i]! * 2 ** 16 + m.resourceAmount[i]! * 2 ** 8 + (m.wall[i]! | (crossing[i]! << 4))
  );
}
