// Editor controller: owns the setup map, the current tool and undo history.
// Turns mouse strokes into brush/fill calls and reports which tiles and layers changed.

import { CONFIG } from '../config';
import { Ground } from '../shared/ids';
import type { MapData } from '../shared/types';
import { stamp, strokeSegment, type Tool } from './brushes';
import { fillBucket } from './fill';
import { copyMapInto, createMap } from './mapState';
import { StrokeRecorder, UndoStack, type Stroke } from './undo';

export interface EditorChange {
  tiles: number[];
  layers: Set<number>;
}

export class Editor {
  readonly map: MapData = createMap();
  tool: Tool = { kind: 'ground', value: Ground.Grassland };
  brushSize: number = CONFIG.editor.defaultBrushSize;
  strength: number = CONFIG.editor.defaultStrength;
  fillMode = false;
  private readonly history = new UndoStack();
  private rec: StrokeRecorder | null = null;
  private lastX = 0;
  private lastY = 0;
  private fullTiles = new Set<number>();

  constructor(
    private readonly onChange: (c: EditorChange) => void,
    private readonly onHistory: () => void,
  ) {}

  get canUndo(): boolean { return this.history.canUndo; }
  get canRedo(): boolean { return this.history.canRedo; }
  get painting(): boolean { return this.rec !== null; }

  /** Mouse down on tile (x, y). With the fill bucket on, fills immediately as one stroke. */
  begin(x: number, y: number): void {
    if (this.tool.kind === 'people') return;
    const rec = new StrokeRecorder(this.map);
    if (this.fillMode) {
      fillBucket(this.map, rec, this.tool, y * this.map.width + x, this.strength);
      this.finish(rec);
      return;
    }
    this.rec = rec;
    this.fullTiles = new Set();
    this.lastX = x;
    this.lastY = y;
    stamp(this.map, rec, this.tool, x, y, this.brushSize, this.strength, this.fullTiles);
    this.emit(rec);
  }

  /** Mouse moved to tile (x, y) while painting. */
  drag(x: number, y: number): void {
    const rec = this.rec;
    if (!rec || (x === this.lastX && y === this.lastY)) return;
    strokeSegment(this.map, rec, this.tool, this.lastX, this.lastY, x, y, this.brushSize, this.strength, this.fullTiles);
    this.lastX = x;
    this.lastY = y;
    this.emit(rec);
  }

  end(): void {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    this.finish(rec);
  }

  undo(): void {
    if (this.rec) return;
    this.emitStroke(this.history.undo(this.map));
  }

  redo(): void {
    if (this.rec) return;
    this.emitStroke(this.history.redo(this.map));
  }

  /** Replaces the whole map (new map, preset load, import). Clears undo history. */
  replaceMap(src: MapData): void {
    this.rec = null;
    copyMapInto(this.map, src);
    this.history.clear();
    this.onHistory();
  }

  private finish(rec: StrokeRecorder): void {
    this.emit(rec);
    const s = rec.finish();
    if (s) {
      this.history.push(s);
      this.onHistory();
    }
  }

  private emit(rec: StrokeRecorder): void {
    const tiles = rec.takePending();
    if (tiles.length > 0) this.onChange({ tiles, layers: rec.touchedLayers });
  }

  private emitStroke(s: Stroke | null): void {
    if (!s) return;
    this.onChange({ tiles: [...new Set(s.tile)], layers: new Set(s.layer) });
    this.onHistory();
  }
}
