// Setup toolbar (§20.2): brush buttons grouped by layer, plus brush options.

import { CONFIG } from '../config';
import { Ground, Plant, Resource, Species, WallType } from '../shared/ids';
import { ANIMAL_ERASER, type Tool, strengthToHeight } from '../editor/brushes';
import type { Editor } from '../editor/editor';
import { PALETTE } from '../render/palette';
import { AgeClass, personSprite } from '../render/sprites';
import { h } from './layout';

interface ToolSpec { name: string; tool: Tool; swatch: string | 'eraser' | 'people'; dot?: boolean }
interface ToolGroup { label: string; tools: ToolSpec[] }

export const TOOL_GROUPS: ToolGroup[] = [
  {
    label: 'Ground', tools: [
      { name: 'Grassland', tool: { kind: 'ground', value: Ground.Grassland }, swatch: PALETTE.grass },
      { name: 'Desert', tool: { kind: 'ground', value: Ground.Desert }, swatch: PALETTE.sand },
      { name: 'Water', tool: { kind: 'ground', value: Ground.Water }, swatch: PALETTE.water },
      { name: 'Mountain', tool: { kind: 'ground', value: Ground.Mountain }, swatch: PALETTE.stone },
    ],
  },
  {
    label: 'Plants', tools: [
      { name: 'Forest', tool: { kind: 'plant', value: Plant.Forest }, swatch: PALETTE.forest },
      { name: 'Fruit bushes', tool: { kind: 'plant', value: Plant.FruitBushes }, swatch: PALETTE.fruitBush, dot: true },
      { name: 'Grass', tool: { kind: 'plant', value: Plant.Grass }, swatch: PALETTE.grassLight },
      { name: 'Plant eraser', tool: { kind: 'plant', value: Plant.None }, swatch: 'eraser' },
    ],
  },
  {
    label: 'Resources', tools: [
      { name: 'Stone', tool: { kind: 'resource', value: Resource.Stone }, swatch: PALETTE.stoneLight },
      { name: 'Clay', tool: { kind: 'resource', value: Resource.Clay }, swatch: PALETTE.clay },
      { name: 'Copper', tool: { kind: 'resource', value: Resource.Copper }, swatch: PALETTE.copper },
      { name: 'Iron', tool: { kind: 'resource', value: Resource.Iron }, swatch: PALETTE.iron },
      { name: 'Tin', tool: { kind: 'resource', value: Resource.Tin }, swatch: PALETTE.tin },
      { name: 'Salt', tool: { kind: 'resource', value: Resource.Salt }, swatch: PALETTE.salt },
      { name: 'Resource eraser', tool: { kind: 'resource', value: Resource.None }, swatch: 'eraser' },
    ],
  },
  {
    label: 'Rain', tools: [
      { name: 'Rain (strength = rain 0–100)', tool: { kind: 'rain' }, swatch: PALETTE.waterLight },
    ],
  },
  {
    label: 'Height', tools: [
      { name: 'Elevation (strength = height 0–9)', tool: { kind: 'elevation' }, swatch: PALETTE.stoneLight },
    ],
  },
  {
    label: 'Animals', tools: [
      { name: 'Prey (deer)', tool: { kind: 'animal', species: Species.Prey }, swatch: PALETTE.mudBrick },
      { name: 'Predator (wolves)', tool: { kind: 'animal', species: Species.Predator }, swatch: PALETTE.stone },
      { name: 'Herd (goats)', tool: { kind: 'animal', species: Species.Herd }, swatch: PALETTE.stoneLight },
      { name: 'Riding (horses)', tool: { kind: 'animal', species: Species.Riding }, swatch: PALETTE.wood },
      { name: 'Animal eraser', tool: { kind: 'animal', species: ANIMAL_ERASER }, swatch: 'eraser' },
    ],
  },
  {
    label: 'Walls', tools: [
      { name: 'River wall', tool: { kind: 'wall', value: WallType.River }, swatch: PALETTE.water },
      { name: 'Mountain wall', tool: { kind: 'wall', value: WallType.Mountain }, swatch: PALETTE.mountainDark },
      { name: 'Sea wall', tool: { kind: 'wall', value: WallType.Sea }, swatch: PALETTE.deepWater },
      { name: 'Wall eraser', tool: { kind: 'wall', value: WallType.None }, swatch: 'eraser' },
    ],
  },
  {
    label: 'People', tools: [
      { name: 'Place group (click the map)', tool: { kind: 'people' }, swatch: 'people' },
    ],
  },
];

/** Run view modes (§18.7). 'follow' = fog + territory for the followed group (§21.1). */
export type ViewMode = 'normal' | 'rain' | 'fog' | 'territory' | 'follow' | 'fireRisk' | 'floodRisk';

export interface RunToolbarApi {
  refresh(mode: ViewMode, zoomed: boolean): void;
}

/** Run-mode toolbar (§20.3): view modes, zoom, stop. Fog and Territory need a selected group. */
export function buildRunToolbar(
  root: HTMLElement,
  onView: (m: ViewMode) => void, onZoom: () => void, onStop: () => void,
): RunToolbarApi {
  root.replaceChildren();
  root.append(h('div', { class: 'tb-group-label', text: 'View' }));
  const views = h('div', { class: 'tb-view' });
  const normal = h('button', { text: 'Normal', title: 'Normal view', onclick: () => onView('normal') });
  const rain = h('button', { text: 'Rain', title: 'Show rain right now', onclick: () => onView('rain') });
  const fog = h('button', { text: 'Fog', title: 'Darken what the selected group has not explored (click a group first)', onclick: () => onView('fog') });
  const territory = h('button', { text: 'Territory', title: 'Dotted range circles around every home of the selected lineage (click a group first)', onclick: () => onView('territory') });
  const fire = h('button', { text: 'Fire risk', title: 'How likely each tile is to burn: summer dryness × fuel (F5)', onclick: () => onView('fireRisk') });
  const flood = h('button', { text: 'Flood risk', title: 'River floodplains: more in a wet year, less behind kept-up levees (F5)', onclick: () => onView('floodRisk') });
  views.append(normal, rain, fog, territory, fire, flood);
  root.append(views);
  root.append(h('div', { class: 'tb-group-label', text: 'Zoom' }));
  const zoom = h('button', { class: 'tb-opt', text: 'Zoom 2×', title: 'Zoom 2× on the cursor (Z). Pan with right-drag or arrows/WASD', onclick: onZoom });
  root.append(h('div', { class: 'tb-view' }, zoom));
  root.append(h('button', { class: 'tb-stop', text: 'Stop run', title: 'Stop and return to setup', onclick: onStop }));
  return {
    refresh(mode, zoomed) {
      normal.classList.toggle('selected', mode === 'normal');
      rain.classList.toggle('selected', mode === 'rain');
      fog.classList.toggle('selected', mode === 'fog' || mode === 'follow');
      territory.classList.toggle('selected', mode === 'territory' || mode === 'follow');
      fire.classList.toggle('selected', mode === 'fireRisk');
      flood.classList.toggle('selected', mode === 'floodRisk');
      zoom.classList.toggle('selected', zoomed);
    },
  };
}

export const sameTool =(a: Tool, b: Tool): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface ToolbarApi {
  refresh(): void;
}

export function buildToolbar(
  root: HTMLElement, editor: Editor,
  onOptionsChange: () => void, onUndo: () => void, onRedo: () => void,
): ToolbarApi {
  root.replaceChildren();
  const toolButtons: Array<[HTMLButtonElement, Tool]> = [];

  for (const g of TOOL_GROUPS) {
    root.append(h('div', { class: 'tb-group-label', text: g.label }));
    const grid = h('div', { class: 'tb-grid' });
    for (const spec of g.tools) {
      const b = h('button', { class: 'tb-btn', title: spec.name });
      if (spec.swatch === 'eraser') b.classList.add('eraser');
      else if (spec.swatch === 'people') {
        b.classList.add('wide');
        b.append(personSprite({ female: false, ageClass: AgeClass.Adult, colorIndex: 0, skin: 1, hair: 0, clothed: false }, 1));
        b.append(personSprite({ female: true, ageClass: AgeClass.Adult, colorIndex: 0, skin: 0, hair: 1, clothed: false }, 1));
      } else b.style.background = spec.swatch;
      if (spec.dot) b.append(h('span', { class: 'dot' }));
      b.addEventListener('click', () => {
        editor.tool = spec.tool;
        // Fill doesn't apply to placing people.
        if (spec.tool.kind === 'people') editor.fillMode = false;
        refresh();
        onOptionsChange();
      });
      grid.append(b);
      toolButtons.push([b, spec.tool]);
    }
    root.append(grid);
  }

  root.append(h('div', { class: 'tb-group-label', text: 'Brush' }));
  const sizes = h('div', { class: 'tb-sizes' });
  const sizeButtons: Array<[HTMLButtonElement, number]> = [];
  for (const s of CONFIG.editor.brushSizes) {
    const b = h('button', { text: String(s), title: `Brush size ${s} ([ / ])`, onclick: () => { editor.brushSize = s; refresh(); onOptionsChange(); } });
    sizes.append(b);
    sizeButtons.push([b, s]);
  }
  root.append(sizes);

  const strengthLabel = h('div', { class: 'tb-strength-label' });
  const strength = h('input', { type: 'range', min: 0, max: 100, step: 1, class: 'tb-strength', title: 'Strength: plant density, resource amount, rain value, height, animal density' });
  strength.value = String(editor.strength);
  strength.addEventListener('input', () => { editor.strength = Number(strength.value); refresh(); });
  root.append(strength, strengthLabel);

  const opts = h('div', { class: 'tb-opts' });
  const fill = h('button', { class: 'tb-opt', text: 'Fill', title: 'Fill bucket (F)', onclick: () => { editor.fillMode = !editor.fillMode; refresh(); onOptionsChange(); } });
  const undo = h('button', { class: 'tb-opt', text: 'Undo', title: 'Undo (Ctrl+Z)', onclick: onUndo });
  const redo = h('button', { class: 'tb-opt', text: 'Redo', title: 'Redo (Ctrl+Shift+Z)', onclick: onRedo });
  opts.append(fill, undo, redo);
  root.append(opts);

  function refresh(): void {
    for (const [b, t] of toolButtons) b.classList.toggle('selected', sameTool(t, editor.tool));
    for (const [b, s] of sizeButtons) b.classList.toggle('selected', s === editor.brushSize);
    strength.value = String(editor.strength);
    strengthLabel.textContent = editor.tool.kind === 'rain' ? `Rain ${editor.strength}`
      : editor.tool.kind === 'elevation' ? `Height ${strengthToHeight(editor.strength)}` : `Strength ${editor.strength}%`;
    fill.classList.toggle('selected', editor.fillMode);
    fill.disabled = editor.tool.kind === 'people';
    undo.disabled = !editor.canUndo;
    redo.disabled = !editor.canRedo;
  }

  refresh();
  return { refresh };
}
