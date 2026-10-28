// Main draw loop (§18). Each frame: terrain → sprites sorted by y → overlays.
// Rendering only reads state; it never changes the map or the simulation.
// F8 (§14): seasons, trampled ground, weather, day and night with lights, settlements by era,
// traffic, battles, effects, smooth zoom. Run mode only; setup shows the map as painted.

import { CONFIG } from '../config';
import { Ground, Plant, WallType, Action } from '../shared/ids';
import type { FounderGroup, LogEntry, MapData } from '../shared/types';
import type { AreaResult } from '../shared/areas';
import { TerrainLayer } from './terrain';
import {
  AreaOverlay, ElevationOverlay, FogOverlay, HeatOverlay, RainOverlay, TerritoryOverlay, drawBrushPreview, drawHoverTile, drawLines,
  type MapLine,
} from './overlays';
import type { GroupView, HeatLayer, RelationView } from '../shared/protocol';
import { BuildingLayer, CampLayer, CampLife, TrampleLayer, WildAnimals, paintedDensities, type WalkerSprite } from './decor';
import { getSprite } from './sprites';
import { PeopleLayer, Battles, collectFounders, drawGroupLabels, type GroupLabel } from './people';
import { RealmLayer } from './realms';
import { Camera } from './camera';
import { SpriteLayer } from './blit';
import { SeasonLayer } from './season';
import { DayNight } from './light';
import { Weather } from './weather';
import { Effects, Particle, type View } from './effects';
import { Traffic } from './traffic';

/** What is on screen now, for the ambient sound (0–1 shares unless said otherwise). */
export interface SoundScene {
  forest: number; grass: number; water: number; mountain: number;
  rain: number; snow: number;
  fires: number;                 // campfires and burning tiles in view (count)
  workers: number;               // people chopping, building, hoeing in view (count)
  day: number;                   // 1 day, 0 night
  birdSeason: number;            // spring + summer weight
  winter: number;
  playing: boolean;
}

export interface SetupView {
  map: MapData;
  founders: readonly FounderGroup[];
  hover: { x: number; y: number } | null;
  showRain: boolean;
  showElevation: boolean;        // F4: height view while the Elevation brush is selected
  showHeat: HeatLayer | null;    // F5 risk views, F7 heatmaps (run only)
  showTerritoryFill: boolean;    // F7: lineages' land softly coloured
  lines: MapLine[];              // F7: relation lines and migration trails
  showAreas: boolean;
  brushSize: number | null;      // null = no brush preview
  hoverArea: number;             // region to highlight, -1 for none
  // Run mode only:
  running: boolean;
  playing: boolean;              // F8: the day turns and the world bustles only while it plays
  runGroups: GroupLabel[];       // group names above homes
  showFog: boolean;
  /** Territory (§18.7): range circles (tile centre, radius in tiles, colour) of the selected lineage. */
  territory: Array<{ x: number; y: number; r: number; colour: string }>;
  selectedPerson: number | null;
  photo: boolean;                // F8 photo mode: no labels, lines or markers
}

// Reused draw list so the frame loop doesn't allocate per sprite.
interface DrawItem { img: HTMLCanvasElement; x: number; y: number }
// Sort key = y × stride + index; must exceed the most sprites in one frame (6,000 people + 400 animals + buildings + effects).
const SORT_STRIDE = 16384;
const TILE = CONFIG.map.tilePx;
const L8 = CONFIG.render.f8.light;
const WORK_SOUNDS = new Set<number>([Action.CutWood, Action.Build, Action.Farm, Action.Wall, Action.Craft]);

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private terrain: TerrainLayer;
  readonly areas: AreaOverlay;
  readonly camera: Camera;
  private readonly rain: RainOverlay;
  private readonly elevation: ElevationOverlay;
  private readonly heat: HeatOverlay;
  private readonly territoryFill: TerritoryOverlay;
  private readonly realms = new RealmLayer();      // C4: realm borders, banners, tribute bearers
  private readonly animals = new WildAnimals();
  readonly people = new PeopleLayer();
  readonly buildings = new BuildingLayer();
  readonly camps = new CampLayer();
  readonly life = new CampLife();
  readonly traffic = new Traffic();
  readonly battles = new Battles();
  readonly season: SeasonLayer;
  readonly light = new DayNight();
  readonly weather: Weather;
  readonly effects: Effects;
  private readonly trample: TrampleLayer;
  private bridgeImg: HTMLCanvasElement | null = null;
  readonly fog: FogOverlay;
  private items: DrawItem[] = [];
  private itemCount = 0;
  private sortKeys = new Float64Array(1024);
  private readonly sprites: SpriteLayer;
  private lights: number[] = [];
  private lastMs = 0;
  private frames = 0;
  private fpsWindowStart = 0;
  private hazards: Uint8Array | null = null;
  private sound: SoundScene | null = null;
  private soundAt = 0;
  /** Max terrain redraw per frame in ms. Infinity in setup (instant), limited during a run. */
  terrainBudgetMs = Infinity;
  onFps: ((fps: number, frameMs: number) => void) | null = null;
  /** Average JavaScript time of one frame (ms), shown beside the fps. */
  frameMs = 0;
  /** Called every frame after the camera moved (story mode, follow cam, sound). */
  onFrame: ((nowMs: number, dtMs: number) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private view: SetupView) {
    canvas.width = view.map.width * TILE;
    canvas.height = view.map.height * TILE;
    this.ctx = canvas.getContext('2d')!;
    this.terrain = new TerrainLayer(view.map);
    this.areas = new AreaOverlay(view.map.width, view.map.height);
    this.rain = new RainOverlay(view.map.width, view.map.height);
    this.elevation = new ElevationOverlay(view.map.width, view.map.height);
    this.heat = new HeatOverlay(view.map.width, view.map.height);
    this.territoryFill = new TerritoryOverlay(view.map.width, view.map.height);
    this.fog = new FogOverlay(view.map.width, view.map.height);
    this.season = new SeasonLayer(view.map);
    this.weather = new Weather(view.map);
    this.effects = new Effects(view.map);
    this.trample = new TrampleLayer(view.map.width, view.map.height);
    this.sprites = new SpriteLayer(canvas.width, canvas.height);
    this.camera = new Camera(canvas.width, canvas.height);
    this.people.splash = (x, y) => this.effects.spawn(Particle.Spark, x, y, 0, -6, 300);
    this.battles.dust = (x, y) => this.effects.puff(x, y);
    this.rebuildAnimals();
  }

  /** The map object was replaced (new map, load, import, run start/stop). */
  setMap(map: MapData): void {
    this.view.map = map;
    this.terrain.setMap(map);
    this.season.setMap(map);
    this.effects.setMap(map);
    this.people.setMap(map);
    this.rain.invalidate();
    this.rebuildAnimals();
  }

  markTiles(tiles: Iterable<number>): void {
    const list = Array.isArray(tiles) ? tiles : [...tiles];
    this.terrain.mapChanged(list);
    this.season.tilesChanged();
    if (this.hazards) this.effects.hazardsChanged(this.hazards, list, performance.now());
  }

  markAllTiles(): void {
    this.terrain.setMap(this.view.map);
    this.season.tilesChanged();
    if (this.hazards) this.effects.hazardsChanged(this.hazards, 'all', performance.now());
  }

  /**
   * Run-mode layers (null in setup): F4 marks, F5 hazards, F8 look and the painted map (stumps,
   * drought cracks). Redraws everything when they change.
   */
  setRunLayers(marks: Uint8Array | null, hazards: Uint8Array | null, look: Uint8Array | null, base: MapData | null): void {
    this.terrain.setRunLayers(marks, hazards, look, base);
    this.hazards = hazards;
    this.traffic.marks = marks;
    const running = base !== null;
    this.season.enabled = running;
    this.animals.lively = running;
    this.weather.setMap(this.view.map, base ? base.rain : null);
    this.effects.clear();
    this.trample.clear();
    this.terrain.setMap(this.view.map);
    this.season.tilesChanged();
  }

  /** Breached wall tiles (run mode); null in setup. */
  setCrossing(crossing: Uint8Array | null): void {
    this.terrain.crossing = crossing;
    this.people.setCrossing(crossing);
  }

  /** The month on screen; `jump` after a jump in time (the season snaps instead of easing). */
  setMonth(month: number, jump: boolean): void {
    this.season.setMonth(month, jump);
  }

  invalidateRain(): void { this.rain.invalidate(); this.weather.rainChanged(); }
  invalidateElevation(): void { this.elevation.invalidate(); }
  setHeat(kind: HeatLayer, data: Uint8Array): void { this.heat.set(kind, data, this.view.map.width, this.view.map.height); }
  setTerritory(data: Uint8Array): void { this.territoryFill.set(data, this.view.map.width, this.view.map.height); }

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

  /** A frame's groups and relations: buildings, camps, walkers, traffic, battles, trampled ground. */
  setGroups(groups: readonly GroupView[], relations: readonly RelationView[], walker: WalkerSprite): void {
    const m = this.view.map;
    this.buildings.update(m, groups);
    this.camps.update(groups);
    this.life.update(m, groups, walker);
    this.traffic.update(m, groups);
    this.battles.update(m, groups, relations);
    this.realms.update(m, groups, performance.now());
    this.trample.update(m, groups);
    this.effects.setGroups(groups);
    this.effects.chimneys = this.buildings.chimneys;
    this.effects.fires = this.camps.fires;
  }

  /** Live log lines: discovery sparkles, era rings, rockfalls. */
  onLog(entries: readonly LogEntry[]): void { this.effects.onLog(entries, performance.now()); }

  /** Clears everything a run drew (stop, new run). */
  clearRun(): void {
    this.people.clear();
    this.buildings.clear();
    this.camps.clear();
    this.life.clear();
    this.traffic.clear();
    this.battles.clear();
    this.realms.clear();
    this.effects.clear();
    this.trample.clear();
  }

  /** The visible map rectangle in map px. */
  get viewRect(): View {
    const c = this.camera;
    return { x: c.ox, y: c.oy, w: c.viewW, h: c.viewH };
  }

  start(): void {
    let reported = false;
    const loop = (now: number): void => {
      // One bad frame must not stop the drawing for good: report it once and carry on.
      try { this.frame(now); } catch (e) { if (!reported) { reported = true; console.error(e); } }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // The visible map rectangle (map px, with a margin): sprites outside it are skipped.
  private cullX0 = 0; private cullY0 = 0; private cullX1 = 0; private cullY1 = 0;

  private push = (img: HTMLCanvasElement, x: number, y: number): void => {
    if (x < this.cullX0 || x > this.cullX1 || y < this.cullY0 || y > this.cullY1) return;
    let it = this.items[this.itemCount];
    if (!it) { it = { img, x, y }; this.items.push(it); }
    it.img = img; it.x = x; it.y = y;
    this.itemCount++;
  };

  private frame(now: number): void {
    const t0 = performance.now();
    this.drawFrame(now);
    this.frameMs += (performance.now() - t0 - this.frameMs) * 0.05;
  }

  private drawFrame(now: number): void {
    // 0–100 ms: a long pause (a hidden tab) or a clock that steps back never throws movement off.
    const dt = this.lastMs === 0 ? 0 : Math.max(0, Math.min(100, now - this.lastMs));
    this.lastMs = now;
    this.countFps(now);

    const v = this.view;
    const ctx = this.ctx;
    this.onFrame?.(now, dt);
    this.camera.update(dt);
    const vr = this.viewRect;
    const pad = 3 * TILE;
    this.cullX0 = vr.x - pad; this.cullY0 = vr.y - pad; this.cullX1 = vr.x + vr.w + pad; this.cullY1 = vr.y + vr.h + pad * 2;
    this.terrain.animate(now);
    this.terrain.flush(this.terrainBudgetMs);
    if (v.running) {
      this.season.update(dt);
      this.light.update(dt, v.playing);
      this.weather.update(now, dt, vr, this.season.weights[3]!, v.playing);
      this.effects.update(now, dt, vr, CONFIG.render.f8.weather.windPxPerS);
      this.people.setNight(this.light.darkness, this.camps.fireGroup);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.camera.apply(ctx);
    ctx.drawImage(this.terrain.canvas, 0, 0);
    if (v.running) {
      this.drawBridges(ctx);
      if (!this.trample.empty) ctx.drawImage(this.trample.canvas, 0, 0);
      this.weather.drawGround(ctx);
      this.season.draw(ctx);
    }

    if (v.showAreas) ctx.drawImage(this.areas.canvas, 0, 0);
    if (v.running && v.showTerritoryFill) this.territoryFill.draw(ctx);
    if (v.running && !v.photo) this.realms.drawGround(ctx, now);
    if (v.hoverArea >= 0) this.areas.drawHover(ctx, v.hoverArea, v.map.width, v.map.height);
    if (v.running) this.effects.drawGround(ctx, now);

    // Sprites, sorted by y (feet position) so nearer things overlap farther ones.
    this.itemCount = 0;
    this.animals.update(now, dt);
    this.animals.collect(now, this.push);
    if (v.running) {
      const night = this.light.darkness > 0.45;
      this.people.animate(now, dt);
      this.people.collect(now, this.push);
      this.buildings.collect(this.push, night);
      this.camps.collect(now, this.push);
      this.life.animate(now, dt);
      this.life.collect(now, this.push);
      this.traffic.animate(dt, v.playing);
      this.traffic.collect(this.push);
      this.battles.animate(now);
      this.battles.collect(now, this.push);
      this.realms.animate(dt, v.playing);
      this.realms.collect(now, this.push);
      this.effects.collect(now, this.push);
    } else {
      collectFounders(v.founders, this.push);
    }
    // Sort by a numeric key (whole-pixel y, then push order) in a reused typed array: native
    // numeric sort, no allocation, and ties keep a stable order so sprites don't flicker.
    const list = this.items;
    const n = Math.min(this.itemCount, SORT_STRIDE);
    if (this.sortKeys.length < n) this.sortKeys = new Float64Array(n * 2);
    const keys = this.sortKeys.subarray(0, n);
    // Effects and scenes can sit just above the map's top edge: clamp so keys stay positive.
    for (let k = 0; k < n; k++) keys[k] = Math.max(0, Math.round(list[k]!.y)) * SORT_STRIDE + k;
    keys.sort();
    const layer = this.sprites;
    layer.begin();
    for (let k = 0; k < n; k++) {
      const it = list[keys[k]! % SORT_STRIDE]!;
      layer.blit(it.img, Math.round(it.x) - (it.img.width >> 1), Math.round(it.y) - it.img.height);
    }
    ctx.drawImage(layer.end(), 0, 0);
    if (v.running) {
      this.weather.drawSky(ctx);
      this.effects.drawSky(ctx, now);
      this.drawNight(ctx, vr);
    }
    if (v.showFog) this.fog.draw(ctx);
    if (v.running && !v.photo) drawTerritory(ctx, v.territory);
    if (v.running && !v.photo) drawLines(ctx, v.lines);
    if (v.running && !v.photo) this.drawSelectedPerson(ctx, v.selectedPerson);

    if (v.showRain) this.rain.draw(ctx, v.map.rain, v.map);
    if (v.showElevation) this.elevation.draw(ctx, v.map);
    if (v.showHeat) this.heat.draw(ctx, v.map);
    if (v.hover && !v.photo) {
      drawHoverTile(ctx, v.hover.x, v.hover.y);
      if (v.brushSize !== null) drawBrushPreview(ctx, v.hover.x, v.hover.y, v.brushSize);
    }
    // Labels in screen space: crisp pixel text at 1×, doubled once zoomed in (not 4× wide at 4×).
    const c = this.camera;
    const scale = c.zoom >= CONFIG.render.f8.camera.labelScaleFromZoom ? 2 : 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const project = (mx: number, my: number): [number, number] => [((mx - c.ox) * c.zoom) / scale, ((my - c.oy) * c.zoom) / scale];
    if (v.running) {
      if (!v.photo) drawGroupLabels(ctx, v.runGroups, project);
    } else {
      drawGroupLabels(ctx, v.founders.map((f) => ({ name: f.name, x: f.x, y: f.y, colorIndex: f.colorIndex })), project);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Night: the world darkens, then campfires, wildfires and lit windows glow. */
  private drawNight(ctx: CanvasRenderingContext2D, vr: View): void {
    if (this.light.darkness <= 0) return;
    this.light.drawTint(ctx, vr.x, vr.y, vr.w, vr.h);
    const out = this.lights;
    let n = 0;
    const f = this.camps.fires;
    for (let k = 0; k < f.length; k += 2) { out[n * 3] = f[k]!; out[n * 3 + 1] = f[k + 1]! - 2; out[n * 3 + 2] = L8.fireGlowRadiusPx; n++; }
    const w = this.buildings.windows;
    for (let k = 0; k < w.length; k += 2) { out[n * 3] = w[k]!; out[n * 3 + 1] = w[k + 1]!; out[n * 3 + 2] = L8.glowRadiusPx; n++; }
    n = this.effects.addLights(out, n);
    // Only the lights on screen.
    let m = 0;
    for (let k = 0; k < n; k++) {
      const x = out[k * 3]!, y = out[k * 3 + 1]!, r = out[k * 3 + 2]!;
      if (x + r < vr.x || y + r < vr.y || x - r > vr.x + vr.w || y - r > vr.y + vr.h) continue;
      out[m * 3] = x; out[m * 3 + 1] = y; out[m * 3 + 2] = r; m++;
    }
    this.light.drawLights(ctx, out, m);
  }

  /**
   * What is on screen, for the ambient sound (worked out a few times a second).
   */
  soundScene(nowMs: number): SoundScene {
    if (this.sound && nowMs - this.soundAt < CONFIG.render.f8.sound.updateMs) return this.sound;
    this.soundAt = nowMs;
    const m = this.view.map;
    const vr = this.viewRect;
    const x0 = Math.max(0, Math.floor(vr.x / TILE)), x1 = Math.min(m.width - 1, Math.floor((vr.x + vr.w) / TILE));
    const y0 = Math.max(0, Math.floor(vr.y / TILE)), y1 = Math.min(m.height - 1, Math.floor((vr.y + vr.h) / TILE));
    let forest = 0, grass = 0, water = 0, mountain = 0, n = 0;
    // Every other tile is plenty for a mix of sounds.
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        const i = y * m.width + x;
        n++;
        const wall = m.wall[i];
        if (wall === WallType.River || wall === WallType.Sea || m.ground[i] === Ground.Water) water++;
        else if (wall === WallType.Mountain || m.ground[i] === Ground.Mountain) mountain++;
        else if (m.plantType[i] === Plant.Forest) forest++;
        else grass++;
      }
    }
    const fires = this.effects.burningIn(vr) + countIn(this.camps.fires, vr);
    const w = this.season.weights;
    this.sound = {
      forest: forest / Math.max(1, n), grass: grass / Math.max(1, n), water: water / Math.max(1, n), mountain: mountain / Math.max(1, n),
      rain: this.weather.rainOnScreen, snow: this.weather.snowOnScreen,
      fires, workers: this.view.running ? this.people.countIn(vr.x, vr.y, vr.w, vr.h, WORK_SOUNDS) : 0,
      day: 1 - this.light.darkness, birdSeason: this.view.running ? w[0]! + w[1]! : 1, winter: this.view.running ? w[3]! : 0,
      playing: this.view.running && this.view.playing,
    };
    return this.sound;
  }

  /** A bridge on every crossing of a River or Sea wall (§18.5), filling the tile (top-left anchored, §19.5). */
  private drawBridges(ctx: CanvasRenderingContext2D): void {
    const crossing = this.terrain.crossing;
    if (!crossing) return;
    const m = this.view.map;
    for (let i = 0; i < crossing.length; i++) {
      if (crossing[i] !== 1) continue;
      const wall = m.wall[i];
      if (wall !== WallType.River && wall !== WallType.Sea) continue;
      this.bridgeImg ??= getSprite('bridge');
      ctx.drawImage(this.bridgeImg, (i % m.width) * TILE, Math.floor(i / m.width) * TILE);
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
      this.onFps?.(Math.round((this.frames * 1000) / (now - this.fpsWindowStart)), this.frameMs);
      this.frames = 0;
      this.fpsWindowStart = now;
    }
  }
}

/** Points (x, y pairs) inside the view rectangle. */
function countIn(points: ArrayLike<number>, v: View): number {
  let n = 0;
  for (let k = 0; k < points.length; k += 2) {
    const x = points[k]!, y = points[k + 1]!;
    if (x >= v.x && y >= v.y && x <= v.x + v.w && y <= v.y + v.h) n++;
  }
  return n;
}

/** Dotted circle of radius R around each home (§18.7 Territory). */
function drawTerritory(ctx: CanvasRenderingContext2D, circles: SetupView['territory']): void {
  if (circles.length === 0) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  for (const c of circles) {
    ctx.strokeStyle = c.colour;
    ctx.beginPath();
    ctx.arc((c.x + 0.5) * TILE, (c.y + 0.5) * TILE, c.r * TILE, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
