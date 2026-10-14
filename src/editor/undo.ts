// Undo/redo by strokes (§20.2). Each stroke stores (layer, tile, old value, new value).

import { CONFIG } from '../config';
import type { MapData } from '../shared/types';
import { layerArray } from './mapState';

export interface Stroke {
  layer: Uint8Array;
  tile: Int32Array;
  oldValue: Uint8Array;
  newValue: Uint8Array;
}

/**
 * Records every change made during one stroke. The first write to a (layer, tile)
 * keeps the original value; the new value is read when the stroke ends.
 */
export class StrokeRecorder {
  private readonly seen = new Map<number, number>();
  private readonly layers: number[] = [];
  private readonly tiles: number[] = [];
  private readonly olds: number[] = [];
  /** Tiles touched by this stroke (for dirty redraw). */
  readonly touched = new Set<number>();
  /** Layers touched by this stroke. */
  readonly touchedLayers = new Set<number>();
  private readonly pending = new Set<number>();

  constructor(private readonly map: MapData) {}

  private key(layer: number, tile: number): number {
    return layer * this.map.width * this.map.height + tile;
  }

  /** Value of (layer, tile) before this stroke began. */
  original(layer: number, tile: number): number {
    const at = this.seen.get(this.key(layer, tile));
    return at === undefined ? layerArray(this.map, layer)[tile]! : this.olds[at]!;
  }

  set(layer: number, tile: number, value: number): void {
    const arr = layerArray(this.map, layer);
    const old = arr[tile]!;
    if (old === value) return;
    const k = this.key(layer, tile);
    if (!this.seen.has(k)) {
      this.seen.set(k, this.layers.length);
      this.layers.push(layer);
      this.tiles.push(tile);
      this.olds.push(old);
    }
    arr[tile] = value;
    this.touched.add(tile);
    this.touchedLayers.add(layer);
    this.pending.add(tile);
  }

  /** Tiles changed since the last call (for redrawing while the stroke is still going). */
  takePending(): number[] {
    const out = [...this.pending];
    this.pending.clear();
    return out;
  }

  /** Builds the stroke, dropping entries that ended at their original value. Null if nothing changed. */
  finish(): Stroke | null {
    const keep: number[] = [];
    for (let e = 0; e < this.layers.length; e++) {
      if (layerArray(this.map, this.layers[e]!)[this.tiles[e]!] !== this.olds[e]) keep.push(e);
    }
    if (keep.length === 0) return null;
    const s: Stroke = {
      layer: new Uint8Array(keep.length),
      tile: new Int32Array(keep.length),
      oldValue: new Uint8Array(keep.length),
      newValue: new Uint8Array(keep.length),
    };
    keep.forEach((e, k) => {
      s.layer[k] = this.layers[e]!;
      s.tile[k] = this.tiles[e]!;
      s.oldValue[k] = this.olds[e]!;
      s.newValue[k] = layerArray(this.map, this.layers[e]!)[this.tiles[e]!]!;
    });
    return s;
  }
}

export class UndoStack {
  private undoList: Stroke[] = [];
  private redoList: Stroke[] = [];

  constructor(private readonly limit: number = CONFIG.editor.undoStrokes) {}

  push(s: Stroke): void {
    this.undoList.push(s);
    if (this.undoList.length > this.limit) this.undoList.shift();
    this.redoList = [];
  }

  clear(): void {
    this.undoList = [];
    this.redoList = [];
  }

  get canUndo(): boolean { return this.undoList.length > 0; }
  get canRedo(): boolean { return this.redoList.length > 0; }

  /** Reverts the last stroke on `map`. Returns it (for dirty tiles) or null. */
  undo(map: MapData): Stroke | null {
    const s = this.undoList.pop();
    if (!s) return null;
    // Reverse order so overlapping entries end at the oldest value.
    for (let k = s.layer.length - 1; k >= 0; k--) layerArray(map, s.layer[k]!)[s.tile[k]!] = s.oldValue[k]!;
    this.redoList.push(s);
    return s;
  }

  redo(map: MapData): Stroke | null {
    const s = this.redoList.pop();
    if (!s) return null;
    for (let k = 0; k < s.layer.length; k++) layerArray(map, s.layer[k]!)[s.tile[k]!] = s.newValue[k]!;
    this.undoList.push(s);
    return s;
  }
}
