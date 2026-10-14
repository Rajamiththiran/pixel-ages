// Main draw loop (§18). Each frame: terrain → sprites sorted by y → overlays.
// Rendering only reads state; it never changes the map or the simulation.

import { CONFIG } from '../config';
import type { FounderGroup, MapData } from '../shared/types';
import type { AreaResult } from '../sim/world/regions';
import { TerrainLayer } from './terrain';
import { AreaOverlay, RainOverlay, drawBrushPreview, drawHoverTile } from './overlays';
import { WildAnimals, paintedDensities } from './decor';
import { collectFounders, drawGroupLabels } from './people';
import { Camera } from './camera';
import type { Season } from '../shared/ids';

export interface SetupView {
  map: MapData;
  founders: readonly FounderGroup[];
  hover: { x: number; y: number } | null;
  showRain: boolean;
  showAreas: boolean;
  brushSize: number | null;      // null = no brush preview
  hoverArea: number;             // region to highlight, -1 for none
}

// Reused draw list so the frame loop doesn't allocate per sprite.
interface DrawItem { img: HTMLCanvasElement; x: number; y: number }

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private terrain: TerrainLayer;
  readonly areas: AreaOverlay;
  readonly camera: Camera;
  private readonly rain: RainOverlay;
  private readonly animals = new WildAnimals();
  private items: DrawItem[] = [];
  private itemCount = 0;
  private lastMs = 0;
  private frames = 0;
  private fpsWindowStart = 0;
  /** Max terrain redraw per frame in ms. Infinity in setup (instant), limited during a run. */
  terrainBudgetMs = Infinity;
  onFps: ((fps: number) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private view: SetupView) {
    canvas.width = view.map.width * CONFIG.map.tilePx;
    canvas.height = view.map.height * CONFIG.map.tilePx;
    this.ctx = canvas.getContext('2d')!;
    this.terrain = new TerrainLayer(view.map);
    this.areas = new AreaOverlay(view.map.width, view.map.height);
    this.rain = new RainOverlay(view.map.width, view.map.height);
    this.camera = new Camera(canvas.width, canvas.height);
    this.rebuildAnimals();
  }

  /** The map object was replaced (new map, load, import, run start/stop). */
  setMap(map: MapData): void {
    this.view.map = map;
    this.terrain.setMap(map);
    this.rain.invalidate();
    this.rebuildAnimals();
  }

  markTiles(tiles: Iterable<number>): void {
    this.terrain.mapChanged(tiles);
  }

  markAllTiles(): void {
    this.terrain.setMap(this.view.map);
  }

  /** Breached wall tiles (run mode); null in setup. */
  setCrossing(crossing: Uint8Array | null): void {
    this.terrain.crossing = crossing;
  }

  setSeason(season: Season): void {
    this.terrain.setSeason(season);
  }

  invalidateRain(): void { this.rain.invalidate(); }

  setAreas(a: AreaResult): void {
    this.areas.setAreas(a, this.view.map.width, this.view.map.height);
  }

  /** Wild animal sprites from the painted map (setup). */
  rebuildAnimals(): void {
    this.animals.rebuild(this.view.map, paintedDensities(this.view.map));
  }

  /** Wild animal sprites from live densities 0..1 (run, once a year). */
  setAnimalDensities(density: Float32Array[]): void {
    this.animals.rebuild(this.view.map, density);
  }

  start(): void {
    const loop = (now: number): void => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private push = (img: HTMLCanvasElement, x: number, y: number): void => {
    let it = this.items[this.itemCount];
    if (!it) { it = { img, x, y }; this.items.push(it); }
    it.img = img; it.x = x; it.y = y;
    this.itemCount++;
  };

  private frame(now: number): void {
    const dt = this.lastMs === 0 ? 0 : Math.min(100, now - this.lastMs);
    this.lastMs = now;
    this.countFps(now);

    const v = this.view;
    const ctx = this.ctx;
    this.terrain.animate(now);
    this.terrain.flush(this.terrainBudgetMs);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.camera.apply(ctx);
    ctx.drawImage(this.terrain.canvas, 0, 0);

    if (v.showAreas) ctx.drawImage(this.areas.canvas, 0, 0);
    if (v.hoverArea >= 0) this.areas.drawHover(ctx, v.hoverArea, v.map.width, v.map.height);

    // Sprites, sorted by y (feet position) so nearer things overlap farther ones.
    this.itemCount = 0;
    this.animals.update(now, dt);
    this.animals.collect(now, this.push);
    collectFounders(v.founders, this.push);
    const list = this.items;
    const n = this.itemCount;
    // Insertion sort on a mostly-sorted small list; avoids allocating a sorted copy.
    for (let a = 1; a < n; a++) {
      const it = list[a]!;
      let b = a - 1;
      while (b >= 0 && list[b]!.y > it.y) { list[b + 1] = list[b]!; b--; }
      list[b + 1] = it;
    }
    for (let k = 0; k < n; k++) {
      const it = list[k]!;
      ctx.drawImage(it.img, Math.round(it.x) - (it.img.width >> 1), Math.round(it.y) - it.img.height);
    }
    drawGroupLabels(ctx, v.founders);

    if (v.showRain) this.rain.draw(ctx, v.map.rain, v.map);
    if (v.hover) {
      drawHoverTile(ctx, v.hover.x, v.hover.y);
      if (v.brushSize !== null) drawBrushPreview(ctx, v.hover.x, v.hover.y, v.brushSize);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private countFps(now: number): void {
    this.frames++;
    if (now - this.fpsWindowStart >= 1000) {
      this.onFps?.(Math.round((this.frames * 1000) / (now - this.fpsWindowStart)));
      this.frames = 0;
      this.fpsWindowStart = now;
    }
  }
}
