// Bootstraps the UI, editor, renderer and (during a run) the simulation worker.
// Two modes: setup (paint + place people) and run (watch; nothing can be edited).

import './ui/styles.css';
import { CONFIG } from './config';
import {
  Ground, WallType, Plant, Resource,
  GROUND_NAMES, PLANT_NAMES, RESOURCE_NAMES, WALL_NAMES, SPECIES_NAMES,
  type Season,
} from './shared/ids';
import type { FounderGroup, LogEntry, MapData, PlannedEvent, RunSetup, YearStats } from './shared/types';
import type { GroupView } from './shared/protocol';
import { ERA_NAMES } from './shared/discoveries';
import { decodeMap, decodeRun, encodeMap, encodeRun } from './shared/save';
import { areaName } from './sim/world/regions';
import { Editor } from './editor/editor';
import { Layer, cloneMap, createMap } from './editor/mapState';
import { RegionsPreview } from './editor/regionsPreview';
import { Renderer, type SetupView } from './render/renderer';
import { GROUP_COLORS } from './render/palette';
import { AgeClass, personSprite } from './render/sprites';
import type { WalkerSprite } from './render/decor';
import { buildLayout, showToast } from './ui/layout';
import { buildRunToolbar, buildToolbar, type RunToolbarApi, type ToolbarApi, type ViewMode } from './ui/toolbar';
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
    for (let s = 0; s < 4; s++) if (c.layers.has(Layer.Animal0 + s)) animalsDirty = true;
  },
  () => toolbar?.refresh(),
);

const view: SetupView = {
  map: editor.map,
  founders: setup.founders,
  hover: null,
  showRain: false,
  showAreas: true,
  brushSize: editor.brushSize,
  hoverArea: -1,
  running: false,
  runGroups: [],
  showFog: false,
  territory: [],
  selectedPerson: null,
};

const renderer = new Renderer(ui.canvas, view);
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

function currentRun(): RunSetup {
  return {
    version: 1,
    name: setup.name,
    map: editor.map,
    founders: setup.founders,
    events: setup.events,
    seed: setup.seed,
    climateDrift: setup.climateDrift,
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
      const run = decodeRun(text);
      if (!replaceMap(run.map)) return;
      setup.name = run.name || setup.name;
      setup.founders.splice(0, setup.founders.length, ...run.founders);
      renumberGroups();
      setup.events = run.events;
      setup.seed = run.seed;
      setup.climateDrift = run.climateDrift;
      panel.refresh();
      panel.setStatus(`Run "${setup.name}" imported.`, 'ok');
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
renderer.onFps = (fps) => bottom.setFps(fps);
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

function setRunView(m: ViewMode): void {
  runView = m;
  view.showRain = m === 'rain';
  view.showFog = fogOn();
  updateTerritory();
  runToolbar?.refresh(runView, renderer.camera.zoom > 1);
  if ((m === 'fog' || m === 'territory') && selectedGroup === null) showToast(ui.toast, 'Click a group (its home or one of its people) first.');
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
  view.selectedPerson = personId;
  if (group) selectGroup(group.id);
  requestInspect();
  runPanel?.show('Inspect');
}

function clearSelection(): void {
  selection = null;
  view.selectedPerson = null;
  selectGroup(null);
  runPanel?.setInspect(null);
}

/** Village walkers are ordinary adults in the village colour (§18.5). */
const walkerSprite: WalkerSprite = (look, frame) => personSprite({ ...look, ageClass: AgeClass.Adult }, frame);

function startRun(): void {
  const v = currentValidation();
  if (v.errors.length > 0) {
    showToast(ui.toast, v.errors[0]!);
    panel.show('Run');
    return;
  }
  const runSetup: RunSetup = {
    version: 1,
    name: setup.name,
    map: cloneMap(editor.map),
    founders: structuredClone(setup.founders),
    events: structuredClone(setup.events),
    seed: setup.seed >>> 0,
    climateDrift: setup.climateDrift,
  };
  setMoving(null);
  mode = 'run';
  runAnimals = null;
  runLog.length = 0;
  runStats.length = 0;
  lastViewYear = null;
  runLineages = runSetup.founders.map((f) => ({ id: f.id, name: f.name, colour: GROUP_COLORS[f.colorIndex % GROUP_COLORS.length]! }));
  selection = null;
  selectedGroup = null;
  view.selectedPerson = null;
  renderer.people.clear();
  renderer.buildings.clear();
  renderer.camps.clear();
  renderer.life.clear();
  renderer.fog.setKnown(null);
  session = new RunSession(runSetup, {
    started: () => {},
    terrainChanged: (tiles) => (tiles === 'all' ? renderer.markAllTiles() : renderer.markTiles(tiles)),
    rainChanged: () => renderer.invalidateRain(),
    animalsChanged: (d) => { runAnimals = d; renderer.setAnimalDensities(d); },
    frame: (f) => {
      bottom.update(f);
      // The world changes under a still mouse, so keep the hover tooltip live.
      if (view.hover && ui.tooltip.style.display === 'block') ui.tooltip.textContent = tileInfo(view.hover.x, view.hover.y);
      renderer.setSeason(CONFIG.seasonOfMonth[f.month] as Season);
      setBanner(f.isPast ? `Viewing the past — ${yearLabel(f.year, f.month)}` : null);
      renderer.people.update(f.people, f.speed === 8, performance.now());
      renderer.buildings.update(session!.map, f.groups);
      renderer.camps.update(session!.map, f.groups);
      renderer.life.update(session!.map, f.groups, walkerSprite);
      view.runGroups = f.groups.map((g) => ({
        name: g.name, x: g.homeX, y: g.homeY, colorIndex: g.colourIndex, selected: g.id === selectedGroup,
        sub: ERA_NAMES[g.era],
      }));
      if (f.selectedKnown) renderer.fog.setKnown(f.selectedKnown);
      updateTerritory();
      const vy = f.isPast ? f.year : null;
      if (vy !== lastViewYear) { lastViewYear = vy; runPanel?.viewChanged(); }
    },
    progress: (label) => setBanner(label),
    error: (message) => {
      console.error(message);
      showToast(ui.toast, 'The simulation hit an error — see the browser console.');
    },
    log: (entries) => {
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
  });
  renderer.setMap(session.map);
  renderer.setCrossing(session.crossing);
  renderer.terrainBudgetMs = CONFIG.render.terrainBudgetMs;
  // During a run, people come from the simulation, not from the setup.
  view.founders = NO_FOUNDERS;
  view.running = true;
  view.runGroups = [];
  view.showAreas = false;
  view.brushSize = null;
  view.hoverArea = -1;
  ui.canvas.classList.remove('place');
  runToolbar = buildRunToolbar(ui.toolbar, setRunView, () => toggleZoom(), () => stopRun());
  setRunView(runView === 'fog' ? 'normal' : runView);
  runPanel = buildRunPanel(ui.tabs, ui.tabBody, {
    log: runLog,
    stats: runStats,
    lineages: () => runLineages,
    viewYear: () => lastViewYear,
    onFollow: (groupId) => { selectGroup(groupId); setRunView('follow'); },
    onJump: jumpToYear,
    onLogPick: pickLogEntry,
  });
  inspectTimer = setInterval(requestInspect, CONFIG.ui.inspectRefreshMs);
  bottom.setRunMode();
}

function stopRun(): void {
  if (!session) return;
  if (!confirm('Stop and return to setup? You can replay this exact run any time with the same seed.')) return;
  session.stop();
  session = null;
  runToolbar = null;
  runAnimals = null;
  runPanel = null;
  if (inspectTimer !== null) clearInterval(inspectTimer);
  inspectTimer = null;
  selection = null;
  selectedGroup = null;
  view.running = false;
  view.showFog = false;
  view.territory = [];
  view.selectedPerson = null;
  setPicking(null);
  renderer.people.clear();
  renderer.buildings.clear();
  renderer.camps.clear();
  renderer.life.clear();
  mode = 'setup';
  setBanner(null);
  renderer.setCrossing(null);
  renderer.terrainBudgetMs = Infinity;
  renderer.setMap(editor.map);
  view.founders = setup.founders;
  view.showAreas = true;
  buildSetupToolbar();
  panel = buildSetupPanel(ui.tabs, ui.tabBody, setup, panelActions);
  panel.show('Run');
  bottom.setSetupMode(SETUP_HINT);
  syncView();
}

// ---------- zoom and pan (§18.8) ----------

let lastMouseMap = { x: renderer.camera.viewW / 2, y: renderer.camera.viewH / 2 };

function toggleZoom(): void {
  renderer.camera.toggle(lastMouseMap.x, lastMouseMap.y);
  runToolbar?.refresh(runView, renderer.camera.zoom > 1);
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
  if (e.button === 2) {
    if (renderer.camera.zoom > 1) panning = { x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0) return;
  const t = tileAt(e);
  if (!t) return;
  if (mode === 'run') {
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

  // Both modes: zoom and pan.
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
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
      if (selection || selectedGroup !== null) clearSelection();
      else if (f?.isPast) session.send({ type: 'backToNow' });
    }
    else if (key === 'i') runPanel?.show('Inspect');
    else if (key === 'g') runPanel?.show('Graphs');
    else if (key === 'l') runPanel?.show('Log');
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
renderer.start();
