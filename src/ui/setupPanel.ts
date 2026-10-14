// Right panel in setup mode (§20.2): Groups, Events, Run, Maps tabs.

import { CONFIG } from '../config';
import { Sex } from '../shared/ids';
import type { ClimateDrift, FounderGroup, PlannedEvent } from '../shared/types';
import { GROUP_COLORS } from '../render/palette';
import { h } from './layout';
import { listPresets } from './storage';

export interface SetupState {
  name: string;
  founders: FounderGroup[];
  events: PlannedEvent[];
  seed: number;
  climateDrift: ClimateDrift;
}

export interface SetupPanelActions {
  editGroup(id: number): void;
  moveGroup(id: number): void;
  deleteGroup(id: number): void;
  newMap(): void;
  savePreset(name: string): void;
  loadPreset(name: string): void;
  deletePreset(name: string): void;
  exportMap(): void;
  importMap(): void;
  exportRun(): void;
  importRun(): void;
  startRun(): void;
}

type TabName = 'Groups' | 'Events' | 'Run' | 'Maps';
const TABS: TabName[] = ['Groups', 'Events', 'Run', 'Maps'];

export interface SetupPanelApi {
  refresh(): void;
  show(tab: TabName): void;
  setStatus(text: string, kind: 'ok' | 'err' | ''): void;
}

export function buildSetupPanel(
  tabsEl: HTMLElement, bodyEl: HTMLElement, state: SetupState, actions: SetupPanelActions,
): SetupPanelApi {
  let current: TabName = 'Groups';
  let status = { text: '', kind: '' as 'ok' | 'err' | '' };
  tabsEl.replaceChildren();
  const tabButtons = TABS.map((t) => {
    const b = h('button', { text: t, onclick: () => show(t) });
    tabsEl.append(b);
    return b;
  });

  function show(t: TabName): void {
    current = t;
    status = { text: '', kind: '' };
    refresh();
  }

  function refresh(): void {
    tabButtons.forEach((b, k) => b.classList.toggle('active', TABS[k] === current));
    bodyEl.replaceChildren(...render());
  }

  function render(): Node[] {
    switch (current) {
      case 'Groups': return renderGroups();
      case 'Events': return [
        h('h3', { text: 'Planned events' }),
        h('p', { class: 'hint', text: 'Droughts, plagues, earthquakes and other events are added in build step 6.' }),
      ];
      case 'Run': return renderRun();
      case 'Maps': return renderMaps();
    }
  }

  function renderGroups(): Node[] {
    const out: Node[] = [
      h('h3', { text: `Groups (${state.founders.length})` }),
      h('p', { class: 'hint', text: 'Pick "Place group" in the People tools, then click the map.' }),
    ];
    for (const g of state.founders) {
      const men = g.people.filter((p) => p.sex === Sex.Male).length;
      const women = g.people.length - men;
      const avg = (k: 'intelligence' | 'cooperation' | 'strength'): number =>
        g.people.length ? Math.round(g.people.reduce((s, p) => s + p[k], 0) / g.people.length) : 0;
      const dot = h('span', { class: 'swatch-dot' });
      dot.style.background = GROUP_COLORS[g.colorIndex % GROUP_COLORS.length]!;
      out.push(h('div', { class: 'group-card' },
        h('div', { class: 'title' }, dot, g.name),
        h('div', { class: 'meta', text: `${men} men · ${women} women · home (${g.x}, ${g.y})` }),
        h('div', { class: 'meta', text: `Intelligence ${avg('intelligence')} · Cooperation ${avg('cooperation')} · Strength ${avg('strength')}` }),
        men === 0 || women === 0 ? h('div', { class: 'warn', text: "Can't have children — will die out." }) : null,
        h('div', { class: 'row' },
          h('button', { text: 'Edit', onclick: () => actions.editGroup(g.id) }),
          h('button', { text: 'Move', onclick: () => actions.moveGroup(g.id) }),
          h('button', { class: 'danger', text: 'Delete', onclick: () => actions.deleteGroup(g.id) }),
        ),
      ));
    }
    return out;
  }

  function renderRun(): Node[] {
    const name = h('input', { type: 'text', value: state.name, maxlength: 60 });
    name.addEventListener('input', () => { state.name = name.value; });

    const seed = h('input', { type: 'number', min: 0, max: CONFIG.editor.maxSeed, step: 1, value: state.seed });
    seed.style.width = '120px';
    seed.addEventListener('change', () => {
      const v = Math.floor(Number(seed.value));
      state.seed = Number.isFinite(v) ? Math.min(CONFIG.editor.maxSeed, Math.max(0, v)) : 0;
      seed.value = String(state.seed);
    });
    const dice = h('button', {
      text: '🎲', title: 'Random seed',
      onclick: () => {
        state.seed = Math.floor(Math.random() * (CONFIG.editor.maxSeed + 1));
        seed.value = String(state.seed);
      },
    });

    const drift = h('select', {},
      h('option', { value: 'off', text: 'Off' }),
      h('option', { value: 'slow', text: 'Slow (±10% over centuries)' }),
      h('option', { value: 'strong', text: 'Strong (±25% over centuries)' }));
    drift.value = state.climateDrift;
    drift.addEventListener('change', () => { state.climateDrift = drift.value as ClimateDrift; });

    return [
      h('h3', { text: 'Run' }),
      h('div', { class: 'form-grid' },
        h('label', { text: 'Run name' }), name,
        h('label', { text: 'Seed' }), h('div', { class: 'row' }, seed, dice),
        h('label', { text: 'Climate drift' }), drift,
      ),
      h('p', { class: 'hint', text: 'Same map + same seed = the same history, every time. Change one thing and keep the seed to compare.' }),
      h('p', { class: 'hint', text: 'Build step 2: the world (plants, animals, rain) comes alive. People start living in step 3.' }),
      h('button', { class: 'primary run-big', text: 'Run ▶', onclick: () => actions.startRun() }),
    ];
  }

  function renderMaps(): Node[] {
    const presetName = h('input', { type: 'text', placeholder: 'Preset name', maxlength: 40 });
    const presets = listPresets();
    const list = h('ul', { class: 'preset-list' });
    if (presets.ok) {
      if (presets.value.length === 0) list.append(h('li', { class: 'hint', text: 'No saved presets yet.' }));
      for (const p of presets.value) {
        list.append(h('li', {},
          h('span', { text: p, title: p }),
          h('button', { text: 'Load', onclick: () => actions.loadPreset(p) }),
          h('button', { class: 'danger', text: '✕', title: 'Delete preset', onclick: () => actions.deletePreset(p) }),
        ));
      }
    } else {
      list.append(h('li', { class: 'msg-err', text: presets.error }));
    }
    return [
      h('h3', { text: 'Map' }),
      h('div', { class: 'row' }, h('button', { text: 'New map', onclick: () => actions.newMap() })),
      h('div', { class: 'section' },
        h('h3', { text: 'Presets (this browser)' }),
        h('div', { class: 'row' }, presetName,
          h('button', { text: 'Save preset', onclick: () => actions.savePreset(presetName.value.trim()) })),
        list,
      ),
      h('div', { class: 'section' },
        h('h3', { text: 'Files' }),
        h('div', { class: 'row' },
          h('button', { text: 'Export map', onclick: () => actions.exportMap() }),
          h('button', { text: 'Import map', onclick: () => actions.importMap() })),
        h('div', { class: 'row' },
          h('button', { text: 'Export run', onclick: () => actions.exportRun() }),
          h('button', { text: 'Import run', onclick: () => actions.importRun() })),
        h('p', { class: 'hint', text: 'A map file holds the painted world. A run file holds the map, groups, events, seed and drift.' }),
      ),
      h('div', { class: `status ${status.kind}`, text: status.text }),
    ];
  }

  function setStatus(text: string, kind: 'ok' | 'err' | ''): void {
    status = { text, kind };
    const el = bodyEl.querySelector('.status');
    if (el) { el.textContent = text; el.className = `status ${kind}`; }
  }

  refresh();
  return { refresh, show, setStatus };
}

type RunTab = 'Inspect' | 'Graphs' | 'Log';
const RUN_TABS: RunTab[] = ['Inspect', 'Graphs', 'Log'];

/** Right panel during a run (§20.3). The full inspector, graphs and log arrive in steps 3–6. */
export function buildRunPanel(tabsEl: HTMLElement, bodyEl: HTMLElement): { show(t: RunTab): void } {
  tabsEl.replaceChildren();
  const buttons = RUN_TABS.map((t) => {
    const b = h('button', { text: t, onclick: () => show(t) });
    tabsEl.append(b);
    return b;
  });
  function show(t: RunTab): void {
    buttons.forEach((b, k) => b.classList.toggle('active', RUN_TABS[k] === t));
    bodyEl.replaceChildren(...(
      t === 'Inspect' ? [
        h('h3', { text: 'Inspect' }),
        h('p', { class: 'hint', text: 'Hover any tile to see its rain, plants and animals right now.' }),
        h('p', { class: 'hint', text: 'Clicking for full tile, group and person cards comes with people in build step 3.' }),
      ] : t === 'Graphs' ? [
        h('h3', { text: 'Graphs' }),
        h('p', { class: 'hint', text: 'Population, traits, eras and food per lineage arrive in build step 6.' }),
      ] : [
        h('h3', { text: 'Event log' }),
        h('p', { class: 'hint', text: 'The log fills up once people live in the world (build step 3).' }),
      ]
    ));
  }
  show('Inspect');
  return { show };
}
