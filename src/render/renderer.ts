// Main draw loop (§18). Each frame: terrain → sprites sorted by y → overlays.
// Rendering only reads state; it never changes the map or the simulation.

import { CONFIG } from '../config';
import type { FounderGroup, MapData } from '../shared/types';
import type { AreaResult } from '../sim/world/regions';
import { TerrainLayer } from './terrain';
import { AreaOverlay, FogOverlay, RainOverlay, drawBrushPreview, drawHoverTile } from './overlays';
import { BuildingLayer, CampLayer, CampLife, WildAnimals, paintedDensities } from './decor';
import { getSprite } from './sprites';
import { WallType } from '../shared/ids';
import { PeopleLayer, collectFounders, drawGroupLabels, type GroupLabel } from './people';
import { Camera } from './camera';
import { SpriteLayer } from './blit';
import type { Season } from '../shared/ids';

export interface SetupView {
  map: MapData;
  founders: readonly FounderGroup[];
  hover: { x: number; y: number } | null;
  showRain: boolean;
  showAreas: boolean;
  brushSize: number | null;      // null = no brush preview
  hoverArea: number;             // region to highlight, -1 for none
  // Run mode only:
  running: boolean;
  runGroups: GroupLabel[];       // group names above homes
  showFog: boolean;
  selectedPerson: number | null;
}

// Reused draw list so the frame loop doesn't allocate per sprite.
interface DrawItem { img: HTMLCanvasElement; x: number; y: number }
// Sort key = y × stride + index; must exceed the most sprites in one frame (6,000 people + 400 animals + buildings).
const SORT_STRIDE = 16384;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private terrain: TerrainLayer;
  readonly areas: AreaOverlay;
  readonly camera: Camera;
  private readonly rain: RainOverlay;
  private readonly animals = new WildAnimals();
  readonly people = new PeopleLayer();
  readonly buildings = new BuildingLayer();
  readonly camps = new CampLayer();
  readonly life = new CampLife();
  private bridgeImg: HTMLCanvasElement | null = null;
  readonly fog: FogOverlay;
  private items: DrawItem[] = [];
  private itemCount = 0;
  private sortKeys = new Float64Array(1024);
  private readonly sprites: SpriteLayer;
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
    this.fog = new FogOverlay(view.map.width, view.map.height);
    this.sprites = new SpriteLayer(canvas.width, canvas.height);
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
    if (v.running) this.drawBridges(ctx);

    if (v.showAreas) ctx.drawImage(this.areas.canvas, 0, 0);
    if (v.hoverArea >= 0) this.areas.drawHover(ctx, v.hoverArea, v.map.width, v.map.height);

    // Sprites, sorted by y (feet position) so nearer things overlap farther ones.
    this.itemCount = 0;
    this.animals.update(now, dt);
    this.animals.collect(now, this.push);
    if (v.running) {
      this.people.animate(now, dt);
      this.people.collect(now, this.push);
      this.buildings.collect(this.push);
      this.camps.collect(now, this.push);
      this.life.animate(now, dt);
      this.life.collect(now, this.push);
    } else {
      collectFounders(v.founders, this.push);
    }
    // Sort by a numeric key (whole-pixel y, then push order) in a reused typed array: native
    // numeric sort, no allocation, and ties keep a stable order so sprites don't flicker.
    const list = this.items;
    const n = this.itemCount;
    if (this.sortKeys.length < n) this.sortKeys = new Float64Array(n * 2);
    const keys = this.sortKeys.subarray(0, n);
    for (let k = 0; k < n; k++) keys[k] = Math.round(list[k]!.y) * SORT_STRIDE + k;
    keys.sort();
    const layer = this.sprites;
    layer.begin();
    for (let k = 0; k < n; k++) {
      const it = list[keys[k]! % SORT_STRIDE]!;
      layer.blit(it.img, Math.round(it.x) - (it.img.width >> 1), Math.round(it.y) - it.img.height);
    }
    ctx.drawImage(layer.end(), 0, 0);
    if (v.showFog) this.fog.draw(ctx);
    if (v.running) {
      drawGroupLabels(ctx, v.runGroups);
      this.drawSelectedPerson(ctx, v.selectedPerson);
    } else {
      drawGroupLabels(ctx, v.founders.map((f) => ({ name: f.name, x: f.x, y: f.y, colorIndex: f.colorIndex })));
    }

    if (v.showRain) this.rain.draw(ctx, v.map.rain, v.map);
    if (v.hover) {
      drawHoverTile(ctx, v.hover.x, v.hover.y);
      if (v.brushSize !== null) drawBrushPreview(ctx, v.hover.x, v.hover.y, v.brushSize);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** A bridge on every crossing of a River or Sea wall (§18.5), filling the tile (top-left anchored, §19.5). */
  private drawBridges(ctx: CanvasRenderingContext2D): void {
    const crossing = this.terrain.crossing;
    if (!crossing) return;
    const m = this.view.map;
    const T = CONFIG.map.tilePx;
    for (let i = 0; i < crossing.length; i++) {
      if (crossing[i] !== 1) continue;
      const wall = m.wall[i];
      if (wall !== WallType.River && wall !== WallType.Sea) continue;
      this.bridgeImg ??= getSprite('bridge');
      ctx.drawImage(this.bridgeImg, (i % m.width) * T, Math.floor(i / m.width) * T);
    }
  }

  /** Small white corner brackets around the selected person. */
  private drawSelectedPerson(ctx: CanvasRenderingContext2D, id: number | null): void {
    if (id === null) return;
    const p = this.people.position(id);
    if (!p) return;
    const x = Math.round(p.x) - 4;
    const y = Math.round(p.y) - 9;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, 2, 1); ctx.fillRect(x, y, 1, 2);                 // top-left
    ctx.fillRect(x + 7, y, 2, 1); ctx.fillRect(x + 8, y, 1, 2);         // top-right
    ctx.fillRect(x, y + 10, 2, 1); ctx.fillRect(x, y + 9, 1, 2);        // bottom-left
    ctx.fillRect(x + 7, y + 10, 2, 1); ctx.fillRect(x + 8, y + 9, 1, 2); // bottom-right
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
