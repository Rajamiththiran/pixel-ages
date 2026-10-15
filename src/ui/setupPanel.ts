// Right panel in setup mode (§20.2): Groups, Events, Run, Maps tabs.

import { CONFIG } from '../config';
import { Sex } from '../shared/ids';
import type { ClimateDrift, FounderGroup, PlannedEvent } from '../shared/types';
import { GROUP_COLORS } from '../render/palette';
import { eventYears } from '../sim/events';
import { h } from './layout';
import { listPresets } from './storage';
import type { Validation } from './validation';

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
  addEvent(): void;
  editEvent(index: number): void;
  deleteEvent(index: number): void;
  /** "Drought in Area 2 (strength 70)" for the event list. */
  describeEvent(ev: PlannedEvent): string;
  validate(): Validation;
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
      case 'Events': return renderEvents();
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

  function renderEvents(): Node[] {
    const order = state.events.map((ev, k) => ({ ev, k, start: eventYears(ev).start })).sort((a, b) => a.start - b.start || a.k - b.k);
    const out: Node[] = [
      h('h3', { text: `Planned events (${state.events.length})` }),
      h('div', { class: 'row' }, h('button', { class: 'primary', text: '+ Add event', onclick: () => actions.addEvent() })),
    ];
    if (order.length === 0) out.push(h('p', { class: 'hint', text: 'No events: the world runs on its own. Add droughts, plagues, harsh winters or earthquakes to test how groups cope.' }));
    for (const { ev, k } of order) {
      const { start, end } = eventYears(ev);
      out.push(h('div', { class: 'group-card' },
        h('div', { class: 'title', text: actions.describeEvent(ev) }),
        h('div', { class: 'meta', text: end - start === 1 ? `Year ${start.toLocaleString('en-US')}` : `Years ${start.toLocaleString('en-US')}–${(end - 1).toLocaleString('en-US')}` }),
        h('div', { class: 'row' },
          h('button', { text: 'Edit', onclick: () => actions.editEvent(k) }),
          h('button', { class: 'danger', text: 'Delete', onclick: () => actions.deleteEvent(k) })),
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
      ...checks(),
    ];
  }

  /** Validation (§20.6): errors disable Run; warnings are shown but allowed. */
  function checks(): Node[] {
    const v = actions.validate();
    const run = h('button', { class: 'primary run-big', text: 'Run ▶', onclick: () => actions.startRun() });
    run.disabled = v.errors.length > 0;
    return [
      ...v.errors.map((e) => h('div', { class: 'msg-err', text: `✕ ${e}` })),
      ...v.warnings.map((w) => h('div', { class: 'msg-warn', text: `! ${w}` })),
      run,
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

