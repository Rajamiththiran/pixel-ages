// Bootstraps the UI, editor, renderer and (during a run) the simulation worker.
// Two modes: setup (paint + place people) and run (watch; nothing can be edited).

import './ui/styles.css';
import { CONFIG } from './config';
import {
  Ground, WallType, Plant, Resource,
  GROUND_NAMES, PLANT_NAMES, RESOURCE_NAMES, WALL_NAMES, SPECIES_NAMES,
} from './shared/ids';
import type { FounderGroup, Intervention, LogEntry, MapData, PlannedEvent, RunSetup, YearStats } from './shared/types';
import type { Frame, GroupView, HeatLayer } from './shared/protocol';
import { ERA_NAMES } from './shared/discoveries';
import { logCsv, statsCsv } from './shared/csv';
import type { MapLine } from './render/overlays';
import type { GraphMarker } from './ui/graphs';
import { buildCompare, type CompareApi } from './ui/compare';
import { openGiftDialog } from './ui/giftDialog';
import { eventYears } from './sim/events';
import { decodeMap, decodeRun, encodeMap, encodeRun } from './shared/save';
import { areaName } from './sim/world/regions';
import { Editor } from './editor/editor';
import { Layer, cloneMap, createMap } from './editor/mapState';
import { RegionsPreview } from './editor/regionsPreview';
import { Renderer, type SetupView } from './render/renderer';
import { GROUP_COLORS, usePalette } from './render/palette';
import { AgeClass, carrySprite, clearComposites, personSprite } from './render/sprites';
import type { WalkerSprite } from './render/decor';
import { StoryDirector } from './render/storyCam';
import { GifRecorder, screenshot } from './render/capture';
import { installPixelFont } from './render/pixelFont';
import { Ambient } from './audio/ambient';
import { buildPresentBar } from './ui/presentBar';
import { buildLayout, showToast } from './ui/layout';
import { buildRunToolbar, buildToolbar, type InterveneTool, type RunToolbarApi, type ToolbarApi, type ViewMode } from './ui/toolbar';
import { buildSetupPanel, type SetupPanelActions, type SetupPanelApi, type SetupState } from './ui/setupPanel';
import { buildRunPanel, type RunPanelApi } from './ui/runPanel';
import { openEventDialog, type PickKind } from './ui/eventDialog';
import { validateRun } from './ui/validation';
import { describeEvent } from './sim/events';
import type { LineageInfo } from './ui/graphs';
import { buildBottomBar, yearLabel } from './ui/runControls';
import { openPeopleDialog } from './ui/peopleDialog';
import * as storage from './ui/storage';
import { RunSession } from './runSession';
import { openAbout, openTutorial } from './ui/tutorial';
import { scenarioB } from './presets/scenarios';
import { BUILTIN_SCENARIOS } from './presets/builtins';
import { h } from './ui/layout';

const TILE = CONFIG.map.tilePx;
const SETUP_HINT = 'Setup — paint the world and place people, then press ▶ to start';
const NO_FOUNDERS: readonly FounderGroup[] = [];

const ui = buildLayout(document.getElementById('app')!);

const setup: SetupState = {
  name: 'Untitled run',
  founders: [],
  events: [],
  seed: CONFIG.editor.defaultSeed,
  climateDrift: 'off',
  interventionMode: false,
  interventions: [],
};

let mode: 'setup' | 'run' = 'setup';

// ---------- editor + renderer ----------

let animalsDirty = false;
let toolbar: ToolbarApi | null = null;

const editor = new Editor(
  (c) => {
    renderer.markTiles(c.tiles);
    if (c.layers.has(Layer.Wall)) regions.schedule();
    if (c.layers.has(Layer.Rain)) renderer.invalidateRain();
    if (c.layers.has(Layer.Elevation)) renderer.invalidateElevation();
    for (let s = 0; s < 4; s++) if (c.layers.has(Layer.Animal0 + s)) animalsDirty = true;
  },
  () => toolbar?.refresh(),
);

const view: SetupView = {
  map: editor.map,
  founders: setup.founders,
  hover: null,
  showRain: false,
  showElevation: false,
  showHeat: null,
  showTerritoryFill: false,
  lines: [],
  showAreas: true,
  brushSize: editor.brushSize,
  hoverArea: -1,
  running: false,
  playing: false,
  runGroups: [],
  showFog: false,
  territory: [],
  selectedPerson: null,
  photo: false,
};

// F8 look settings (day and night, weather, sound, colour-blind colours), remembered in this browser.
const look = storage.loadLook();
if (look.colourBlind) usePalette('colourBlind');
const renderer = new Renderer(ui.canvas, view);
renderer.light.enabled = look.dayNight;
renderer.weather.enabled = look.weather;
const ambient = new Ambient(look.muted);
const story = new StoryDirector();
const gif = new GifRecorder();
const caption = h('div', { class: 'caption' });
ui.stage.append(caption);
let followOn = false;
let lastLapse = false;
void installPixelFont();
const regions = new RegionsPreview(editor.map, (a) => renderer.setAreas(a));
renderer.setAreas(regions.current);

/** Wild animal sprites are re-placed after a stroke ends, not while painting, so they don't jitter. */
function flushAnimals(): void {
  if (!animalsDirty || editor.painting) return;
  animalsDirty = false;
  renderer.rebuildAnimals();
}

function syncView(): void {
  if (mode !== 'setup') return;
  view.showRain = editor.tool.kind === 'rain';
  view.showElevation = editor.tool.kind === 'elevation';
  view.brushSize = editor.tool.kind === 'people' || editor.fillMode ? null : editor.brushSize;
  ui.canvas.classList.toggle('place', editor.tool.kind === 'people' || movingGroupId !== null);
}

function buildSetupToolbar(): void {
  toolbar = buildToolbar(ui.toolbar, editor, syncView,
    () => { editor.undo(); flushAnimals(); },
    () => { editor.redo(); flushAnimals(); });
}

// ---------- groups ----------

let movingGroupId: number | null = null;

function canPlaceAt(x: number, y: number): boolean {
  const i = y * editor.map.width + x;
  return editor.map.ground[i] !== Ground.Water && editor.map.wall[i] === WallType.None;
}

function nextUnusedColor(): number {
  const used = new Set(setup.founders.map((g) => g.colorIndex));
  for (let k = 0; k < GROUP_COLORS.length; k++) if (!used.has(k)) return k;
  return setup.founders.length % GROUP_COLORS.length;
}

function renumberGroups(): void {
  // Founder ids are also lineage ids, so keep them 1, 2, 3… with no gaps.
  setup.founders.forEach((g, k) => { g.id = k + 1; });
}

function placeGroup(x: number, y: number): void {
  openPeopleDialog({
    title: 'New group',
    confirmText: 'Create',
    initial: null,
    defaultName: `Group ${setup.founders.length + 1}`,
    defaultColor: nextUnusedColor(),
    usedColors: new Set(setup.founders.map((g) => g.colorIndex)),
    onDone: (r) => {
      setup.founders.push({ id: setup.founders.length + 1, name: r.name, colorIndex: r.colorIndex, x, y, people: r.people });
      panel.show('Groups');
    },
  });
}

function editGroup(id: number): void {
  const g = setup.founders.find((f) => f.id === id);
  if (!g) return;
  openPeopleDialog({
    title: `Edit ${g.name}`,
    confirmText: 'Save',
    initial: g,
    defaultName: g.name,
    defaultColor: g.colorIndex,
    usedColors: new Set(setup.founders.filter((f) => f.id !== id).map((f) => f.colorIndex)),
    onDone: (r) => {
      g.name = r.name;
      g.colorIndex = r.colorIndex;
      g.people = r.people;
      panel.refresh();
    },
  });
}

function setBanner(text: string | null): void {
  ui.banner.textContent = text ?? '';
  ui.banner.style.display = text ? 'block' : 'none';
}

function setMoving(id: number | null): void {
  movingGroupId = id;
  const g = setup.founders.find((f) => f.id === id);
  setBanner(g ? `Click the map to move ${g.name} (Esc to cancel)` : null);
  syncView();
}

// ---------- maps / files ----------

function replaceMap(m: MapData): boolean {
  if (m.width !== CONFIG.map.width || m.height !== CONFIG.map.height) {
    panel.setStatus(`This map is ${m.width}×${m.height}; Pixel Ages maps are ${CONFIG.map.width}×${CONFIG.map.height}.`, 'err');
    return false;
  }
  editor.replaceMap(m);
  renderer.setMap(editor.map);
  regions.setMap(editor.map);
  animalsDirty = false;
  return true;
}

/** Puts a whole run setup (map, groups, events, seed, drift) into the editor. */
function applyRun(run: RunSetup): boolean {
  if (!replaceMap(run.map)) return false;
  setup.name = run.name || setup.name;
  setup.founders.splice(0, setup.founders.length, ...run.founders);
  renumberGroups();
  setup.events = run.events;
  setup.seed = run.seed;
  setup.climateDrift = run.climateDrift;
  setup.interventionMode = run.interventionMode === true;
  setup.interventions = run.interventions ?? [];
  panel.refresh();
  return true;
}

/** Loads a ready-made run into the editor, asking first if that would replace the owner's work. */
function loadScenario(build: () => RunSetup, label: string, hint: string): void {
  if (mode === 'run') { showToast(ui.toast, 'Stop the run first (Stop run, top left).'); return; }
  const busy = setup.founders.length > 0 || editor.canUndo;
  if (busy && !confirm(`Load ${label}? The current map, groups and events will be replaced.`)) return;
  if (!applyRun(build())) return;
  panel.show('Run');
  showToast(ui.toast, hint);
}

/** The example from the tutorial (§20.8): Scenario B, "Smart desert vs rich forest", seed 48213. */
function loadExample(): void {
  loadScenario(() => scenarioB(), 'the example', 'Example loaded: press Run ▶, then 8× to watch the two groups.');
}

function currentRun(): RunSetup {
  return {
    version: 3,
    name: setup.name,
    map: editor.map,
    founders: setup.founders,
    events: setup.events,
    seed: setup.seed,
    climateDrift: setup.climateDrift,
    ...(setup.interventionMode ? { interventionMode: true, interventions: setup.interventions } : {}),
  };
}

// ---------- planned events (§15, §20.5) ----------

/** Picking an area or a wall point for the event dialog (the dialog waits, hidden). */
let picking: { kind: PickKind; done: (tile: { x: number; y: number } | null) => void } | null = null;

function setPicking(p: typeof picking): void {
  picking = p;
  view.hoverArea = -1;
  setBanner(p ? (p.kind === 'area' ? 'Click an area on the map (Esc to cancel)' : 'Click a wall tile on the map (Esc to cancel)') : null);
  ui.canvas.classList.toggle('place', p !== null);
}

function areaAt(x: number, y: number): number {
  return regions.current.regionId[y * editor.map.width + x] ?? -1;
}

function describeSetupEvent(ev: PlannedEvent): string {
  const area = 'at' in ev && ev.kind !== 'earthquake' && ev.at.x >= 0 ? areaAt(ev.at.x, ev.at.y) : -1;
  return describeEvent(ev, area);
}

function openEvent(index: number | null): void {
  const initial = index === null ? null : setup.events[index]!;
  openEventDialog({
    title: index === null ? 'New planned event' : 'Edit planned event',
    confirmText: index === null ? 'Add' : 'Save',
    initial,
    map: editor.map,
    regionId: regions.current.regionId,
    describeTile: (kind, x, y) => (kind === 'wall'
      ? `${WALL_NAMES[editor.map.wall[y * editor.map.width + x]!]} wall at (${x}, ${y})`
      : areaAt(x, y) >= 0 ? areaName(areaAt(x, y)) : 'not an area'),
    pick: (kind, done) => setPicking({ kind, done }),
    cancelPick: () => setPicking(null),
    onDone: (ev) => {
      if (index === null) setup.events.push(ev); else setup.events[index] = ev;
      panel.show('Events');
    },
  });
}

/** A click while picking: areas need a non-wall tile, earthquakes a wall tile (§20.5). */
function pickAt(x: number, y: number): void {
  if (!picking) return;
  const wall = editor.map.wall[y * editor.map.width + x] !== WallType.None;
  if (picking.kind === 'wall' && !wall) { showToast(ui.toast, 'An earthquake needs a wall tile: click a river, mountain or sea wall.'); return; }
  if (picking.kind === 'area' && (wall || areaAt(x, y) < 0)) { showToast(ui.toast, 'Click inside an area, not on a wall.'); return; }
  const done = picking.done;
  setPicking(null);
  done({ x, y });
}

const currentValidation = () => validateRun(editor.map, setup.founders, setup.events, regions.current.regionId);

const panelActions: SetupPanelActions = {
  editGroup,
  moveGroup: (id) => setMoving(id),
  deleteGroup: (id) => {
    const g = setup.founders.find((f) => f.id === id);
    if (!g || !confirm(`Delete ${g.name}?`)) return;
    setup.founders.splice(setup.founders.indexOf(g), 1);
    renumberGroups();
    panel.refresh();
  },
  newMap: () => {
    if (!confirm('Start a new empty map? The painted world will be lost (placed groups stay).')) return;
    replaceMap(createMap());
    panel.setStatus('New map ready.', 'ok');
  },
  loadBuiltin: (id) => {
    const b = BUILTIN_SCENARIOS.find((s) => s.id === id);
    if (b) loadScenario(b.build, `"${b.name}"`, `"${b.name}" loaded: press Run ▶ and watch.`);
  },
  savePreset: (name) => {
    if (!name) { panel.setStatus('Type a preset name first.', 'err'); return; }
    const exists = storage.listPresets();
    if (exists.ok && exists.value.includes(name) && !confirm(`Replace the preset "${name}"?`)) return;
    const r = storage.savePreset(name, editor.map);
    panel.refresh();
    panel.setStatus(r.ok ? `Saved preset "${name}".` : r.error, r.ok ? 'ok' : 'err');
  },
  loadPreset: (name) => {
    if (!confirm(`Load "${name}"? The current map will be replaced.`)) return;
    const r = storage.loadPreset(name);
    if (!r.ok) { panel.setStatus(r.error, 'err'); return; }
    if (replaceMap(r.value)) panel.setStatus(`Loaded preset "${name}".`, 'ok');
  },
  deletePreset: (name) => {
    if (!confirm(`Delete the preset "${name}"?`)) return;
    const r = storage.deletePreset(name);
    panel.refresh();
    if (!r.ok) panel.setStatus(r.error, 'err');
  },
  exportMap: () => {
    storage.downloadText(`${storage.safeFileName(setup.name)}.map.json`, encodeMap(editor.map));
  },
  importMap: async () => {
    const text = await storage.pickTextFile('.json,application/json');
    if (text === null) return;
    try {
      if (replaceMap(decodeMap(text))) panel.setStatus('Map imported.', 'ok');
    } catch (e) {
      panel.setStatus((e as Error).message, 'err');
    }
  },
  exportRun: () => {
    storage.downloadText(`${storage.safeFileName(setup.name)}.run.json`, encodeRun(currentRun()));
  },
  importRun: async () => {
    const text = await storage.pickTextFile('.json,application/json');
    if (text === null) return;
    try {
      if (applyRun(decodeRun(text))) panel.setStatus(`Run "${setup.name}" imported.`, 'ok');
    } catch (e) {
      panel.setStatus((e as Error).message, 'err');
    }
  },
  startRun: () => startRun(),
  addEvent: () => openEvent(null),
  editEvent: (k) => openEvent(k),
  deleteEvent: (k) => {
    const ev = setup.events[k];
    if (!ev || !confirm(`Delete "${describeSetupEvent(ev)}"?`)) return;
    setup.events.splice(k, 1);
    panel.refresh();
  },
  describeEvent: describeSetupEvent,
  validate: currentValidation,
};

let panel: SetupPanelApi = buildSetupPanel(ui.tabs, ui.tabBody, setup, panelActions);

// ---------- run mode ----------

let session: RunSession | null = null;
let runView: ViewMode = 'normal';
let runToolbar: RunToolbarApi | null = null;
let runAnimals: Float32Array[] | null = null;
// F7 observer tools.
let runSetup: RunSetup | null = null;
let heat: HeatLayer | null = null;
let linesOn = false;
let trailsOn = false;
let tool: InterveneTool | null = null;
let compare: CompareApi | null = null;

const bottom = buildBottomBar(ui.bottom, {
  start: () => startRun(),
  play: () => session?.send({ type: 'play' }),
  pause: () => session?.send({ type: 'pause' }),
  speed: (v) => session?.send({ type: 'speed', value: v }),
  step: () => session?.send({ type: 'step' }),
  viewYear: (y) => {
    if (!session) return;
    setBanner(`Going to year ${y.toLocaleString('en-US')}…`);
    session.send({ type: 'viewYear', year: y });
  },
  backToNow: () => session?.send({ type: 'backToNow' }),
});
renderer.onFps = (fps, ms) => bottom.setFps(fps, ms);
bottom.setSetupMode(SETUP_HINT);

// Selection and inspector (§21.1).
let runPanel: RunPanelApi | null = null;
const runLog: LogEntry[] = [];
const runStats: YearStats[] = [];
let runLineages: LineageInfo[] = [];
let lastViewYear: number | null = null;     // the past year on screen, null when live
let selection: { x: number; y: number; personId: number | null; groupId: number | null } | null = null;
let selectedGroup: number | null = null;
let inspectTimer: ReturnType<typeof setInterval> | null = null;

const fogOn = (): boolean => (runView === 'fog' || runView === 'follow') && selectedGroup !== null;
const territoryOn = (): boolean => runView === 'territory' || runView === 'follow';

function refreshRunToolbar(): void {
  runToolbar?.refresh({ mode: runView, heat, lines: linesOn, trails: trailsOn, tool });
  refreshPresent();
}

function setRunView(m: ViewMode): void {
  runView = m;
  view.showRain = m === 'rain';
  view.showFog = fogOn();
  // F7: every lineage's land is filled in while Territory is on; the worker sends it each year.
  view.showTerritoryFill = territoryOn();
  session?.send({ type: 'territory', on: view.showTerritoryFill });
  updateTerritory();
  refreshRunToolbar();
  if (m === 'fog' && selectedGroup === null) showToast(ui.toast, 'Click a group (its home or one of its people) first.');
}

/** F5 risk views and F7 heatmaps: the worker sends the layer each year while one is shown. */
function setHeat(k: HeatLayer | null): void {
  heat = k;
  view.showHeat = k;
  session?.send({ type: 'layer', layer: k });
  refreshRunToolbar();
}

// ---------- F7: relation lines and migration trails ----------

/** C4: a kingdom's label line and realm lines. */
const KINGDOM_GOLD = '#e8c547';
const LINE_COLOURS = { trade: '#6fcf4f', war: '#d94f4f', alliance: '#4f7fd9', coexist: '#a39d92', realm: KINGDOM_GOLD } as const;
interface Trail { x1: number; y1: number; x2: number; y2: number; colour: string; year: number }
let trails: Trail[] = [];
let trailHomes = new Map<number, { x: number; y: number; lineageId: number }>();
let trailYear = -1;

/** Moves and new groups since the last frame become trails; a jump in time starts them afresh. */
function updateTrails(f: Frame): void {
  if (f.isPast || f.year < trailYear) {
    trails = [];
    trailHomes = new Map();
  }
  trailYear = f.year;
  if (f.isPast) return;
  const fresh = trailHomes.size === 0;
  const next = new Map<number, { x: number; y: number; lineageId: number }>();
  for (const g of f.groups) {
    const colour = GROUP_COLORS[g.colourIndex % GROUP_COLORS.length]!;
    const was = trailHomes.get(g.id);
    if (was && (was.x !== g.homeX || was.y !== g.homeY)) {
      trails.push({ x1: was.x, y1: was.y, x2: g.homeX, y2: g.homeY, colour, year: f.year });
    } else if (!was && !fresh) {
      // A new group set off from the nearest home of its lineage (a split or refugees).
      let from: { x: number; y: number } | null = null;
      let best = Infinity;
      for (const o of trailHomes.values()) {
        if (o.lineageId !== g.lineageId) continue;
        const d = (o.x - g.homeX) ** 2 + (o.y - g.homeY) ** 2;
        if (d < best) { best = d; from = o; }
      }
      if (from) trails.push({ x1: from.x, y1: from.y, x2: g.homeX, y2: g.homeY, colour, year: f.year });
    }
    next.set(g.id, { x: g.homeX, y: g.homeY, lineageId: g.lineageId });
  }
  trailHomes = next;
  trails = trails.filter((t) => f.year - t.year < CONFIG.render.trailYears);
}

function updateLines(f: Frame): void {
  const out: MapLine[] = [];
  if (linesOn) {
    const home = new Map(f.groups.map((g) => [g.id, g]));
    // C4: a subject and its ruler get one gold dotted line, not also a trade line.
    const realmPairs = new Set(f.relations.filter((r) => r.kind === 'realm').map((r) => r.a * 65536 + r.b));
    for (const r of f.relations) {
      const a = home.get(r.a);
      const b = home.get(r.b);
      if (!a || !b) continue;
      if (r.kind !== 'realm' && realmPairs.has(r.a * 65536 + r.b)) continue;
      out.push({
        x1: a.homeX, y1: a.homeY, x2: b.homeX, y2: b.homeY, colour: LINE_COLOURS[r.kind], alpha: CONFIG.render.relationLineAlpha,
        dash: r.kind === 'coexist' ? [2, 3] : r.kind === 'alliance' ? [5, 2] : r.kind === 'realm' ? [1, 2] : [], arrow: false,
      });
    }
  }
  if (trailsOn) {
    for (const t of trails) {
      const fade = 1 - (f.year - t.year) / CONFIG.render.trailYears;
      out.push({ x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, colour: t.colour, alpha: CONFIG.render.trailAlpha * fade, dash: [], arrow: true });
    }
  }
  view.lines = out;
}

/** F7 graph markers: planned events shaded, disasters and interventions as ticks. */
function graphMarkers(): GraphMarker[] {
  const out: GraphMarker[] = [];
  for (const ev of runSetup?.events ?? []) {
    const { start, end } = eventYears(ev);
    out.push({ start, end, colour: ev.kind === 'drought' ? '#e0c48a' : ev.kind === 'plague' ? '#b8323a' : '#5d9cc9', label: describeEvent(ev, -1) });
  }
  // One tick per year with disasters (a busy world logs thousands), labelled with the first.
  const disasters = new Map<number, { first: string; n: number }>();
  for (const e of runLog) {
    if (e.type === 'intervention') out.push({ start: e.year, end: e.year + 1, colour: '#ffffff', label: e.text });
    else if (e.type === 'hazard') {
      const d = disasters.get(e.year);
      if (d) d.n++; else disasters.set(e.year, { first: e.text, n: 1 });
    }
  }
  for (const [year, d] of disasters) {
    out.push({ start: year, end: year + 1, colour: '#e8833a', label: d.n > 1 ? `${d.first} (+${d.n - 1} more)` : d.first });
  }
  return out;
}

/** Territory (§18.7): a dotted range circle around every home of the selected group's lineage. */
function updateTerritory(): void {
  const groups = session?.lastFrame?.groups ?? [];
  const sel = groups.find((g) => g.id === selectedGroup);
  view.territory = territoryOn() && sel
    ? groups.filter((g) => g.lineageId === sel.lineageId).map((g) => ({
      x: g.homeX, y: g.homeY, r: g.range, colour: GROUP_COLORS[g.colourIndex % GROUP_COLORS.length]!,
    }))
    : [];
}

function selectGroup(id: number | null): void {
  if (id === selectedGroup) return;
  selectedGroup = id;
  session?.send({ type: 'select', groupId: id });
  if (id === null) renderer.fog.setKnown(null);
  view.showFog = fogOn();
  updateTerritory();
}

/** Graph click (§21.2): go to that year. */
function jumpToYear(year: number): void {
  if (!session) return;
  setBanner(`Going to year ${year.toLocaleString('en-US')}…`);
  session.send({ type: 'viewYear', year });
}

/** Log click (§21.3): go to the year, select the group, and centre on it when zoomed. */
function pickLogEntry(e: LogEntry): void {
  jumpToYear(e.year);
  if (e.groupId !== null) {
    selectGroup(e.groupId);
    if (e.x !== null && e.y !== null) selection = { x: e.x, y: e.y, personId: null, groupId: e.groupId };
  }
  if (e.x !== null && e.y !== null) renderer.camera.centreOn((e.x + 0.5) * TILE, (e.y + 0.5) * TILE);
}

function requestInspect(): void {
  if (session && selection) session.send({ type: 'inspect', ...selection });
}

/** Run-mode click: a person within 3 px, else a group whose home or building is on the tile, plus the tile. */
function inspectAt(tx: number, ty: number, mx: number, my: number): void {
  const personId = renderer.people.pick(mx, my);
  const groups = session?.lastFrame?.groups ?? [];
  let group = groups.find((g) => g.homeX === tx && g.homeY === ty) ?? null;
  if (!group && renderer.buildings.buildingAt(tx, ty)) {
    // A building belongs to the nearest home.
    group = groups.reduce<GroupView | null>((best, g) => {
      const d = (g.homeX - tx) ** 2 + (g.homeY - ty) ** 2;
      return !best || d < (best.homeX - tx) ** 2 + (best.homeY - ty) ** 2 ? g : best;
    }, null);
  }
  selection = { x: tx, y: ty, personId, groupId: group?.id ?? null };
  // F7: the clicked band person's family and life story are recorded from now on.
  if (personId !== view.selectedPerson) session?.send({ type: 'person', personId });
  view.selectedPerson = personId;
  if (group) selectGroup(group.id);
  requestInspect();
  runPanel?.show('Inspect');
}

function clearSelection(): void {
  selection = null;
  if (view.selectedPerson !== null) session?.send({ type: 'person', personId: null });
  view.selectedPerson = null;
  selectGroup(null);
  runPanel?.setInspect(null);
}

// ---------- F7: intervention mode (D5) ----------

function setTool(t: InterveneTool | null): void {
  tool = t;
  if (t === 'gift') {
    tool = null;
    const g = session?.lastFrame?.groups.find((o) => o.id === selectedGroup);
    if (!g) showToast(ui.toast, 'Click a group first, then Gift.');
    else openGiftDialog(g.name, g.discoveries, (d) => intervene({ kind: 'gift', year: 0, month: 0, groupId: g.id, discovery: d }));
  } else if (t === 'move' && selectedGroup === null) {
    tool = null;
    showToast(ui.toast, 'Click a group first, then Move.');
  }
  ui.canvas.classList.toggle('place', tool !== null);
  setBanner(tool === 'flood' ? 'Click where the flood strikes (Esc to cancel)'
    : tool === 'fire' ? 'Click where the fire starts (Esc to cancel)'
      : tool === 'move' ? 'Click the new home of the selected group (Esc to cancel)' : null);
  refreshRunToolbar();
}

/** Sends an intervention; the worker stamps it with the live month and makes it part of the run. */
function intervene(iv: Intervention): void {
  if (!session) return;
  if (session.lastFrame?.isPast) { showToast(ui.toast, 'Go back to now first: interventions happen in the present.'); return; }
  session.send({ type: 'intervene', intervention: iv });
}

/** A map click with an intervention tool picked. */
function interveneAt(x: number, y: number): void {
  const t = tool;
  setTool(null);
  if (t === 'flood') intervene({ kind: 'flood', year: 0, month: 0, at: { x, y } });
  else if (t === 'fire') intervene({ kind: 'fire', year: 0, month: 0, at: { x, y } });
  else if (t === 'move' && selectedGroup !== null) {
    const m = session!.map;
    const i = y * m.width + x;
    if (m.ground[i] === Ground.Water || (m.wall[i] !== WallType.None && !session!.crossing[i])) {
      showToast(ui.toast, 'A home must be on land, not water or a wall.');
      return;
    }
    intervene({ kind: 'move', year: 0, month: 0, groupId: selectedGroup, to: { x, y } });
  }
}

/** Village walkers are ordinary adults in the village colour (§18.5); F8: some carry something. */
const walkerSprite: WalkerSprite = (look, frame, carry) => {
  const p = { ...look, ageClass: AgeClass.Adult };
  return carry ? carrySprite(p, carry, frame) : personSprite(p, frame);
};

function startRun(): void {
  const v = currentValidation();
  if (v.errors.length > 0) {
    showToast(ui.toast, v.errors[0]!);
    panel.show('Run');
    return;
  }
  const runSetup0: RunSetup = {
    version: 3,
    name: setup.name,
    map: cloneMap(editor.map),
    founders: structuredClone(setup.founders),
    events: structuredClone(setup.events),
    seed: setup.seed >>> 0,
    climateDrift: setup.climateDrift,
    // F7: earlier interventions replay at their months; new ones are added as they are made.
    ...(setup.interventionMode ? { interventionMode: true, interventions: structuredClone(setup.interventions) } : {}),
  };
  runSetup = runSetup0;
  setMoving(null);
  mode = 'run';
  runAnimals = null;
  trails = [];
  trailHomes = new Map();
  trailYear = -1;
  tool = null;
  runLog.length = 0;
  runStats.length = 0;
  lastViewYear = null;
  runLineages = runSetup0.founders.map((f) => ({ id: f.id, name: f.name, colour: GROUP_COLORS[f.colorIndex % GROUP_COLORS.length]! }));
  selection = null;
  selectedGroup = null;
  view.selectedPerson = null;
  followOn = false;
  story.clear();
  renderer.clearRun();
  renderer.fog.setKnown(null);
  session = new RunSession(runSetup0, {
    started: () => {},
    terrainChanged: (tiles) => (tiles === 'all' ? renderer.markAllTiles() : renderer.markTiles(tiles)),
    rainChanged: () => renderer.invalidateRain(),
    animalsChanged: (d) => { runAnimals = d; renderer.setAnimalDensities(d); },
    frame: (f) => {
      bottom.update(f);
      if (f.timelapse !== lastLapse) { lastLapse = f.timelapse; refreshPresent(); }
      // The world changes under a still mouse, so keep the hover tooltip live.
      if (view.hover && ui.tooltip.style.display === 'block') ui.tooltip.textContent = tileInfo(view.hover.x, view.hover.y);
      // F8: seasons ease with the months; a jump in time (full tiles) snaps them.
      renderer.setMonth(f.month, f.fullTiles !== undefined);
      view.playing = f.playing;
      setBanner(f.timelapse ? `Time-lapse — ${yearLabel(f.year, f.month)} of ${f.liveYear.toLocaleString('en-US')}`
        : f.isPast ? `Viewing the past — ${yearLabel(f.year, f.month)}` : null);
      renderer.people.update(f.people, f.speed === 8 || f.timelapse, performance.now(), f.groups);
      renderer.setGroups(f.groups, f.relations, walkerSprite);
      view.runGroups = f.groups.map((g) => ({
        name: g.name, x: g.homeX, y: g.homeY, colorIndex: g.colourIndex, selected: g.id === selectedGroup,
        // C4: a capital's second line names its realm (gold for a kingdom) instead of its era.
        sub: g.subjects > 0 ? `${g.realmRank === 2 ? 'Kingdom' : 'Chiefdom'} · ${g.subjects + 1} villages` : ERA_NAMES[g.era],
        subColour: g.subjects > 0 && g.realmRank === 2 ? KINGDOM_GOLD : undefined,
      }));
      if (f.selectedKnown) renderer.fog.setKnown(f.selectedKnown);
      updateTerritory();
      updateTrails(f);
      updateLines(f);
      compare?.sync();
      const vy = f.isPast ? f.year : null;
      if (vy !== lastViewYear) { lastViewYear = vy; runPanel?.viewChanged(); }
    },
    progress: (label) => setBanner(label),
    error: (message) => {
      console.error(message);
      showToast(ui.toast, 'The simulation hit an error — see the browser console.');
    },
    log: (entries) => {
      // F8: discovery sparkles, era rings and rockfalls for what happens now; story mode's big moments.
      if (!session?.lastFrame?.isPast) { renderer.onLog(entries); story.push(entries); }
      runLog.push(...entries);
      // Trim in place: the log panel holds this same array.
      if (runLog.length > CONFIG.log.maxEntries) runLog.splice(0, runLog.length - CONFIG.log.maxEntries);
      runPanel?.logChanged();
    },
    stats: (rows) => {
      runStats.push(...rows);
      runPanel?.statsChanged();
    },
    inspect: (result) => runPanel?.setInspect(result),
    layer: (kind, data) => (kind === 'territory' ? renderer.setTerritory(data) : renderer.setHeat(kind, data)),
    person: (story) => runPanel?.setStory(story),
    intervened: (iv) => {
      // Now part of this run; kept for the next run of the setup and for Export run.
      runSetup0.interventions = [...(runSetup0.interventions ?? []), iv];
      showToast(ui.toast, `Intervention saved for year ${iv.year.toLocaleString('en-US')}: it is part of this run now.`);
    },
  });
  renderer.setMap(session.map);
  renderer.setCrossing(session.crossing);
  // The painted map (editor.map, unchanged during a run) shows where forest was cut and how dry this year is.
  renderer.setRunLayers(session.marks, session.hazards, session.look, editor.map);
  renderer.terrainBudgetMs = CONFIG.render.terrainBudgetMs;
  // During a run, people come from the simulation, not from the setup.
  view.founders = NO_FOUNDERS;
  view.running = true;
  view.runGroups = [];
  view.showAreas = false;
  view.brushSize = null;
  view.hoverArea = -1;
  ui.canvas.classList.remove('place');
  runToolbar = buildRunToolbar(ui.toolbar, {
    view: setRunView,
    heat: setHeat,
    lines: (on) => { linesOn = on; refreshRunToolbar(); if (session?.lastFrame) updateLines(session.lastFrame); },
    trails: (on) => { trailsOn = on; refreshRunToolbar(); if (session?.lastFrame) updateLines(session.lastFrame); },
    stop: () => stopRun(),
    // F7 (D5): intervention tools only in intervention mode; experiments stay hands-off.
    intervene: runSetup0.interventionMode ? setTool : undefined,
  });
  setRunView(runView === 'fog' ? 'normal' : runView);
  setHeat(heat);
  const lineageName = (id: number): string => runLineages.find((l) => l.id === id)?.name ?? `Lineage ${id}`;
  compare = buildCompare({
    statsA: runStats,
    setupA: () => runSetup0,
    lineages: () => runLineages,
    viewYear: () => lastViewYear,
    onJump: jumpToYear,
    markers: graphMarkers,
    liveYear: () => session?.lastFrame?.liveYear ?? 0,
    toast: (text) => showToast(ui.toast, text),
  });
  runPanel = buildRunPanel(ui.tabs, ui.tabBody, {
    log: runLog,
    stats: runStats,
    lineages: () => runLineages,
    viewYear: () => lastViewYear,
    onFollow: (groupId) => { selectGroup(groupId); setRunView('follow'); followOn = true; refreshPresent(); },
    onJump: jumpToYear,
    onLogPick: pickLogEntry,
    markers: graphMarkers,
    compare,
    exportStats: () => storage.downloadText(`${storage.safeFileName(runSetup0.name)}.graphs.csv`, statsCsv(runStats, lineageName), 'text/csv'),
    exportLog: () => storage.downloadText(`${storage.safeFileName(runSetup0.name)}.log.csv`, logCsv(runLog), 'text/csv'),
  });
  inspectTimer = setInterval(requestInspect, CONFIG.ui.inspectRefreshMs);
  bottom.setRunMode();
  refreshPresent();
}

function stopRun(): void {
  if (!session) return;
  if (!confirm('Stop and return to setup? You can replay this exact run any time with the same seed.')) return;
  session.stop();
  session = null;
  compare?.stop();
  compare = null;
  // Interventions made in this run stay with the setup: the next run replays them (F7).
  if (runSetup?.interventionMode) setup.interventions = structuredClone(runSetup.interventions ?? []);
  tool = null;
  view.lines = [];
  view.showHeat = null;
  view.showTerritoryFill = false;
  runToolbar = null;
  runAnimals = null;
  runPanel = null;
  if (inspectTimer !== null) clearInterval(inspectTimer);
  inspectTimer = null;
  selection = null;
  selectedGroup = null;
  view.running = false;
  view.playing = false;
  view.showFog = false;
  view.territory = [];
  view.selectedPerson = null;
  followOn = false;
  story.on = false;
  story.clear();
  caption.style.display = 'none';
  setPicking(null);
  renderer.clearRun();
  mode = 'setup';
  setBanner(null);
  renderer.setCrossing(null);
  renderer.setRunLayers(null, null, null, null);
  renderer.terrainBudgetMs = Infinity;
  renderer.setMap(editor.map);
  view.founders = setup.founders;
  view.showAreas = true;
  buildSetupToolbar();
  panel = buildSetupPanel(ui.tabs, ui.tabBody, setup, panelActions);
  panel.show('Run');
  bottom.setSetupMode(SETUP_HINT);
  syncView();
  refreshPresent();
}

// ---------- zoom and pan (§18.8; F8: 1× / 2× / 4×, wheel, follow cam, story mode) ----------

let lastMouseMap = { x: renderer.camera.viewW / 2, y: renderer.camera.viewH / 2 };

function toggleZoom(): void {
  renderer.camera.toggle(lastMouseMap.x, lastMouseMap.y);
  story.userActed(performance.now());
  refreshPresent();
}

ui.canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = canvasPoint(e);
  const m = renderer.camera.toMap(p.x, p.y);
  renderer.camera.wheel(e.deltaY, m.x, m.y);
  story.userActed(performance.now());
  refreshPresent();
}, { passive: false });

/** Every frame: the follow cam, story mode's camera and caption, and the ambient sound. */
renderer.onFrame = (now) => {
  const groups = session?.lastFrame?.groups ?? [];
  const followed = followOn ? groups.find((g) => g.id === selectedGroup) : undefined;
  renderer.camera.follow = followed ? { x: (followed.homeX + 0.5) * TILE, y: (followed.homeY + 0.5) * TILE } : null;
  const moment = mode === 'run' ? story.update(now) : null;
  if (moment?.fresh && moment.entry.x !== null && moment.entry.y !== null) {
    renderer.camera.centreOn((moment.entry.x + 0.5) * TILE, (moment.entry.y + 0.5) * TILE, CONFIG.render.f8.story.zoom);
    caption.textContent = `Year ${moment.entry.year.toLocaleString('en-US')} — ${moment.entry.text}`;
    caption.style.display = 'block';
    refreshPresent();
  } else if (!moment) caption.style.display = 'none';
  ambient.update(now, renderer.soundScene(now));
};

// ---------- F8 presentation: camera, capture and look ----------

const appRoot = document.getElementById('app')!;

function setPhoto(on: boolean): void {
  view.photo = on;
  appRoot.classList.toggle('photo', on);
  if (on) showToast(ui.toast, 'Photo mode: press P or Esc to show the controls again.');
}

function saveLook(): void {
  storage.saveLook(look);
  refreshPresent();
}

/** Lineage colours changed: forget every sprite and list drawn in the old ones. */
function restyle(): void {
  clearComposites();
  renderer.people.restyle();
  renderer.life.clear();
  renderer.battles.clear();
  if (session?.lastFrame) renderer.setGroups(session.lastFrame.groups, session.lastFrame.relations, walkerSprite);
  if (runSetup) runLineages = runSetup.founders.map((f) => ({ id: f.id, name: f.name, colour: GROUP_COLORS[f.colorIndex % GROUP_COLORS.length]! }));
  runPanel?.statsChanged();
  runPanel?.logChanged();
  if (session && view.showTerritoryFill) session.send({ type: 'territory', on: true });
  if (mode === 'setup') panel.refresh();
}

const fileYear = (): string => `pixel-ages-${storage.safeFileName(setup.name)}-year-${session?.lastFrame?.year ?? 0}`;

const present = buildPresentBar(ui.bottom, {
  zoom: () => toggleZoom(),
  follow: () => {
    if (!followOn && selectedGroup === null) { showToast(ui.toast, 'Click a group (its home or one of its people) first.'); return; }
    followOn = !followOn;
    refreshPresent();
  },
  story: () => {
    story.on = !story.on;
    if (!story.on) { story.clear(); caption.style.display = 'none'; }
    else showToast(ui.toast, 'Story mode: the camera will jump to big moments as they happen.');
    refreshPresent();
  },
  timelapse: () => {
    if (!session) return;
    session.send({ type: 'timelapse' });
  },
  shot: () => screenshot(ui.canvas, `${fileYear()}.png`),
  gif: () => gif.start(ui.canvas, `${fileYear()}.gif`, (text) => { showToast(ui.toast, text); refreshPresent(); }),
  photo: () => setPhoto(!view.photo),
  dayNight: () => { look.dayNight = !look.dayNight; renderer.light.enabled = look.dayNight; saveLook(); },
  weather: () => { look.weather = !look.weather; renderer.weather.enabled = look.weather; saveLook(); },
  sound: () => { look.muted = !look.muted; ambient.setMuted(look.muted); saveLook(); },
  colourBlind: () => {
    look.colourBlind = !look.colourBlind;
    usePalette(look.colourBlind ? 'colourBlind' : 'default');
    restyle();
    saveLook();
  },
});

function refreshPresent(): void {
  present.refresh({
    zoom: renderer.camera.targetZoom, follow: followOn, story: story.on, timelapse: session?.lastFrame?.timelapse ?? false,
    recording: gif.busy, dayNight: look.dayNight, weather: look.weather, muted: look.muted, colourBlind: look.colourBlind,
    running: mode === 'run',
  });
}

// ---------- mouse ----------

function canvasPoint(e: MouseEvent): { x: number; y: number } {
  const r = ui.canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * ui.canvas.width,
    y: ((e.clientY - r.top) / r.height) * ui.canvas.height,
  };
}

function tileAt(e: MouseEvent): { x: number; y: number } | null {
  const p = canvasPoint(e);
  const m = renderer.camera.toMap(p.x, p.y);
  const x = Math.floor(m.x / TILE);
  const y = Math.floor(m.y / TILE);
  if (x < 0 || y < 0 || x >= editor.map.width || y >= editor.map.height) return null;
  return { x, y };
}

ui.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

let panning: { x: number; y: number } | null = null;

ui.canvas.addEventListener('mousedown', (e) => {
  story.userActed(performance.now());
  if (e.button === 2) {
    if (renderer.camera.zoom > 1) panning = { x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0) return;
  const t = tileAt(e);
  if (!t) return;
  if (mode === 'run') {
    if (tool !== null) { interveneAt(t.x, t.y); return; }
    const p = canvasPoint(e);
    const m = renderer.camera.toMap(p.x, p.y);
    inspectAt(t.x, t.y, m.x, m.y);
    return;
  }
  if (picking) { pickAt(t.x, t.y); return; }
  if (movingGroupId !== null) {
    if (!canPlaceAt(t.x, t.y)) { showToast(ui.toast, "People can't be placed on Water or walls."); return; }
    const g = setup.founders.find((f) => f.id === movingGroupId);
    if (g) { g.x = t.x; g.y = t.y; }
    setMoving(null);
    panel.refresh();
    return;
  }
  if (editor.tool.kind === 'people') {
    if (!canPlaceAt(t.x, t.y)) { showToast(ui.toast, "People can't be placed on Water or walls."); return; }
    placeGroup(t.x, t.y);
    return;
  }
  editor.begin(t.x, t.y);
  flushAnimals();
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 2) panning = null;
  if (!editor.painting) return;
  editor.end();
  flushAnimals();
});

window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  const r = ui.canvas.getBoundingClientRect();
  const scale = ui.canvas.width / r.width / renderer.camera.zoom;
  renderer.camera.pan(-(e.clientX - panning.x) * scale, -(e.clientY - panning.y) * scale);
  panning = { x: e.clientX, y: e.clientY };
});

ui.canvas.addEventListener('mousemove', (e) => {
  const p = canvasPoint(e);
  lastMouseMap = renderer.camera.toMap(p.x, p.y);
  const t = tileAt(e);
  view.hover = t;
  if (!t) { ui.tooltip.style.display = 'none'; return; }
  // Picking an event area: the hovered area lights up (§18.7, §20.5).
  if (picking?.kind === 'area') view.hoverArea = areaAt(t.x, t.y);
  if (editor.painting) editor.drag(t.x, t.y);
  showTileInfo(t.x, t.y, e);
});

ui.canvas.addEventListener('mouseleave', () => {
  view.hover = null;
  ui.tooltip.style.display = 'none';
});

let lastInfoMs = 0;
function showTileInfo(x: number, y: number, e: MouseEvent): void {
  const now = performance.now();
  // Throttled: the tooltip text doesn't need to change on every mouse event.
  if (now - lastInfoMs >= CONFIG.ui.hoverInfoRefreshMs) {
    lastInfoMs = now;
    ui.tooltip.textContent = tileInfo(x, y);
  }
  const r = ui.stage.getBoundingClientRect();
  const left = e.clientX - r.left + 14;
  const top = e.clientY - r.top + 14;
  ui.tooltip.style.display = 'block';
  const w = ui.tooltip.offsetWidth;
  const hgt = ui.tooltip.offsetHeight;
  ui.tooltip.style.left = `${left + w > r.width ? left - w - 28 : left}px`;
  ui.tooltip.style.top = `${top + hgt > r.height ? top - hgt - 28 : top}px`;
}

function tileInfo(x: number, y: number): string {
  // In a run the tooltip shows live values: the session map's `rain` holds rain right now.
  const m = session ? session.map : editor.map;
  const i = y * m.width + x;
  const parts = [`(${x}, ${y}) km`];
  const wall = m.wall[i]!;
  if (wall !== WallType.None) parts.push(`${WALL_NAMES[wall]} wall${session?.crossing[i] ? ' (crossing)' : ''}`);
  else {
    parts.push(GROUND_NAMES[m.ground[i]!]!);
    const area = regions.current.regionId[i]!;
    if (area >= 0) parts.push(areaName(area));
  }
  if (m.plantType[i] !== Plant.None) {
    parts.push(`${PLANT_NAMES[m.plantType[i]!]} ${Math.round((m.plantDensity[i]! / 255) * 100)}%`);
  }
  if (m.resourceType[i] !== Resource.None) {
    parts.push(`${RESOURCE_NAMES[m.resourceType[i]!]} ${Math.round((m.resourceAmount[i]! / 255) * 100)}%`);
  }
  parts.push(`Rain ${m.rain[i]}${session ? ' now' : ''}`);
  // Height never changes during a run, so the painted map always has it.
  if (editor.map.elevation[i]! > 0) parts.push(`Height ${editor.map.elevation[i]}`);
  for (let s = 0; s < 4; s++) {
    const d = runAnimals ? runAnimals[s]![i]! : m.animals[s]![i]! / 255;
    if (d > 0) parts.push(`${SPECIES_NAMES[s]} ${Math.round(d * 100)}%`);
  }
  if (!session) {
    const home = setup.founders.find((g: FounderGroup) => g.x === x && g.y === y);
    if (home) parts.push(`Home of ${home.name}`);
  }
  return parts.join(' · ');
}

// ---------- keyboard (§20.7) ----------

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
  if (document.querySelector('.modal-back')) return;
  const key = e.key.toLowerCase();

  // Both modes: photo mode, zoom and pan.
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (key === 'p' || (e.key === 'Escape' && view.photo)) { setPhoto(!view.photo); return; }
    if (key === 'z') { toggleZoom(); return; }
    const pan = CONFIG.render.panStepPx;
    const d: Record<string, [number, number]> = {
      arrowleft: [-pan, 0], a: [-pan, 0], arrowright: [pan, 0], d: [pan, 0],
      arrowup: [0, -pan], w: [0, -pan], arrowdown: [0, pan], s: [0, pan],
    };
    const step = d[key];
    if (step && renderer.camera.zoom > 1) {
      e.preventDefault();
      renderer.camera.pan(step[0], step[1]);
      story.userActed(performance.now());
      return;
    }
  }

  if (mode === 'run') {
    if (!session || e.ctrlKey || e.metaKey || e.altKey) return;
    const f = session.lastFrame;
    if (e.key === ' ') { e.preventDefault(); session.send({ type: f?.playing ? 'pause' : 'play' }); }
    else if (e.key === '1') session.send({ type: 'speed', value: 1 });
    else if (e.key === '8') session.send({ type: 'speed', value: 8 });
    else if (e.key === '.') session.send({ type: 'step' });
    else if (e.key === 'Escape') {
      if (tool !== null) setTool(null);
      else if (selection || selectedGroup !== null) clearSelection();
      else if (f?.isPast) session.send({ type: 'backToNow' });
    }
    else if (key === 'i') runPanel?.show('Inspect');
    else if (key === 'g') runPanel?.show('Graphs');
    else if (key === 'l') runPanel?.show('Log');
    // F8: follow cam, story mode, time-lapse.
    else if (key === 'c') { if (selectedGroup !== null || followOn) { followOn = !followOn; refreshPresent(); } }
    else if (key === 'm') { story.on = !story.on; if (!story.on) { story.clear(); caption.style.display = 'none'; } refreshPresent(); }
    else if (key === 't') session.send({ type: 'timelapse' });
    return;
  }

  if ((e.ctrlKey || e.metaKey) && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) editor.redo(); else editor.undo();
    flushAnimals();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'y') {
    e.preventDefault();
    editor.redo();
    flushAnimals();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const sizes: readonly number[] = CONFIG.editor.brushSizes;
  if (e.key === '[' || e.key === ']') {
    const k = sizes.indexOf(editor.brushSize);
    const next = sizes[Math.max(0, Math.min(sizes.length - 1, k + (e.key === ']' ? 1 : -1)))];
    if (next !== undefined) editor.brushSize = next;
  } else if (key === 'f') {
    if (editor.tool.kind !== 'people') editor.fillMode = !editor.fillMode;
  } else if (e.key === 'Escape') {
    setMoving(null);
  } else {
    return;
  }
  toolbar?.refresh();
  syncView();
});

buildSetupToolbar();
syncView();
refreshPresent();
renderer.start();

// About (version, seeds, credits) and the first-launch tutorial (§20.8).
const showTutorial = (): void => openTutorial(() => storage.markTutorialSeen(), () => { storage.markTutorialSeen(); loadExample(); });
ui.bottom.append(h('button', { class: 'about-btn', text: 'About', title: 'Version, seeds, credits and the tutorial', onclick: () => openAbout(showTutorial, loadExample) }));
if (!storage.tutorialSeen()) showTutorial();
