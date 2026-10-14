// Right panel in setup mode (§20.2): Groups, Events, Run, Maps tabs.

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
    return [
      h('h3', { text: 'Run' }),
      h('div', { class: 'row' }, h('span', { text: 'Run name' }), name),
      h('p', { class: 'hint', text: 'Seed, climate drift and the Run button arrive in build step 2. The run name is used when you export a run file.' }),
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
