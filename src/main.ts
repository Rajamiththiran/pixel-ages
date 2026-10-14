// Bootstraps the UI, editor and renderer. Step 1: setup mode only (no worker yet).

import './ui/styles.css';
import { CONFIG } from './config';
import {
  Ground, WallType, Plant, Resource,
  GROUND_NAMES, PLANT_NAMES, RESOURCE_NAMES, WALL_NAMES, SPECIES_NAMES,
} from './shared/ids';
import type { FounderGroup, MapData, RunSetup } from './shared/types';
import { decodeMap, decodeRun, encodeMap, encodeRun } from './shared/save';
import { areaName } from './sim/world/regions';
import { Editor } from './editor/editor';
import { Layer, createMap } from './editor/mapState';
import { RegionsPreview } from './editor/regionsPreview';
import { Renderer, type SetupView } from './render/renderer';
import { GROUP_COLORS } from './render/palette';
import { buildLayout, showToast } from './ui/layout';
import { buildToolbar } from './ui/toolbar';
import { buildSetupPanel, type SetupState } from './ui/setupPanel';
import { buildBottomBar } from './ui/runControls';
import { openPeopleDialog } from './ui/peopleDialog';
import * as storage from './ui/storage';

const TILE = CONFIG.map.tilePx;

const ui = buildLayout(document.getElementById('app')!);

const setup: SetupState = {
  name: 'Untitled run',
  founders: [],
  events: [],
  seed: CONFIG.editor.defaultSeed,
  climateDrift: 'off',
};

// ---------- editor + renderer ----------

let animalsDirty = false;

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
};

const renderer = new Renderer(ui.canvas, view);
const regions = new RegionsPreview(editor.map, (a) => renderer.setAreas(a));
renderer.setAreas(regions.current);

const bottom = buildBottomBar(ui.bottom);
renderer.onFps = (fps) => bottom.setFps(fps);
bottom.setMode('Setup — paint the world and place people');

/** Wild animal sprites are re-placed after a stroke ends, not while painting, so they don't jitter. */
function flushAnimals(): void {
  if (!animalsDirty || editor.painting) return;
  animalsDirty = false;
  renderer.rebuildAnimals();
}

function syncView(): void {
  view.showRain = editor.tool.kind === 'rain';
  view.brushSize = editor.tool.kind === 'people' || editor.fillMode ? null : editor.brushSize;
  ui.canvas.classList.toggle('place', editor.tool.kind === 'people' || movingGroupId !== null);
}

const toolbar = buildToolbar(ui.toolbar, editor, syncView, () => { editor.undo(); flushAnimals(); }, () => { editor.redo(); flushAnimals(); });

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

function setMoving(id: number | null): void {
  movingGroupId = id;
  const g = setup.founders.find((f) => f.id === id);
  ui.banner.textContent = g ? `Click the map to move ${g.name} (Esc to cancel)` : '';
  ui.banner.style.display = g ? 'block' : 'none';
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

const panel = buildSetupPanel(ui.tabs, ui.tabBody, setup, {
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
});

// ---------- mouse ----------

function tileAt(e: MouseEvent): { x: number; y: number } | null {
  const r = ui.canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * ui.canvas.width / TILE);
  const y = Math.floor(((e.clientY - r.top) / r.height) * ui.canvas.height / TILE);
  if (x < 0 || y < 0 || x >= editor.map.width || y >= editor.map.height) return null;
  return { x, y };
}

ui.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

ui.canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const t = tileAt(e);
  if (!t) return;
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

window.addEventListener('mouseup', () => {
  if (!editor.painting) return;
  editor.end();
  flushAnimals();
});

ui.canvas.addEventListener('mousemove', (e) => {
  const t = tileAt(e);
  view.hover = t;
  if (!t) { ui.tooltip.style.display = 'none'; return; }
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
  const m = editor.map;
  const i = y * m.width + x;
  const parts = [`(${x}, ${y}) km`];
  const wall = m.wall[i]!;
  if (wall !== WallType.None) parts.push(`${WALL_NAMES[wall]} wall`);
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
  parts.push(`Rain ${m.rain[i]}`);
  for (let s = 0; s < 4; s++) {
    const d = m.animals[s]![i]!;
    if (d > 0) parts.push(`${SPECIES_NAMES[s]} ${Math.round((d / 255) * 100)}%`);
  }
  const home = setup.founders.find((g: FounderGroup) => g.x === x && g.y === y);
  if (home) parts.push(`Home of ${home.name}`);
  return parts.join(' · ');
}

// ---------- keyboard (§20.7) ----------

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
  if (document.querySelector('.modal-back')) return;
  const key = e.key.toLowerCase();
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
  toolbar.refresh();
  syncView();
});

syncView();
renderer.start();
