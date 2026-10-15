// Event dialog (§20.5): kind, then that kind's fields (§15). Areas and wall points are picked
// on the map: the dialog steps aside while the owner clicks, then comes back.

import { CONFIG } from '../config';
import { SPECIES_NAMES, type Species } from '../shared/ids';
import type { PlannedEvent } from '../shared/types';
import { eventYears, validateEvent } from '../sim/events';
import { h } from './layout';

export type PickKind = 'area' | 'wall';

export interface EventDialogOptions {
  title: string;
  confirmText: string;
  initial: PlannedEvent | null;
  map: { width: number; height: number; wall: Uint8Array };
  regionId: Int32Array;
  /** "Area 2" / "River wall at (80, 45)" for a picked tile. */
  describeTile: (kind: PickKind, x: number, y: number) => string;
  /** Lets the owner click the map; calls back with the tile, or null if cancelled. */
  pick: (kind: PickKind, done: (tile: { x: number; y: number } | null) => void) => void;
  cancelPick: () => void;
  onDone: (ev: PlannedEvent) => void;
}

type Kind = PlannedEvent['kind'];
const KINDS: Array<[Kind, string]> = [
  ['drought', 'Drought'], ['wetPeriod', 'Wet period'], ['plague', 'Plague'],
  ['harshWinters', 'Harsh winters'], ['animalDieOff', 'Animal die-off'], ['earthquake', 'Earthquake'],
];

const UNSET = { x: -1, y: -1 };
const D = CONFIG.ui.eventDialog;

/** Fields shared by every kind; the event is built from them. */
interface Fields {
  kind: Kind; at: { x: number; y: number }; wallAt: { x: number; y: number };
  year: number; length: number; strength: number; species: Species;
}

function fieldsFrom(ev: PlannedEvent | null): Fields {
  const f: Fields = { kind: 'drought', at: { ...UNSET }, wallAt: { ...UNSET }, year: D.year, length: D.length, strength: D.strength, species: 0 };
  if (!ev) return f;
  f.kind = ev.kind;
  if (ev.kind === 'earthquake') f.wallAt = { ...ev.at };
  else if ('at' in ev) f.at = { ...ev.at };
  f.year = 'startYear' in ev ? ev.startYear : ev.year;
  if ('lengthYears' in ev) f.length = ev.lengthYears;
  if ('strength' in ev) f.strength = ev.strength;
  if (ev.kind === 'animalDieOff') f.species = ev.species;
  return f;
}

function build(f: Fields): PlannedEvent {
  switch (f.kind) {
    case 'drought': return { kind: 'drought', at: { ...f.at }, startYear: f.year, lengthYears: f.length, strength: f.strength };
    case 'wetPeriod': return { kind: 'wetPeriod', at: { ...f.at }, startYear: f.year, lengthYears: f.length, strength: f.strength };
    case 'plague': return { kind: 'plague', at: { ...f.at }, startYear: f.year, strength: f.strength };
    case 'harshWinters': return { kind: 'harshWinters', startYear: f.year, lengthYears: f.length };
    case 'animalDieOff': return { kind: 'animalDieOff', at: { ...f.at }, year: f.year, species: f.species };
    case 'earthquake': return { kind: 'earthquake', at: { ...f.wallAt }, year: f.year };
  }
}

export function openEventDialog(o: EventDialogOptions): void {
  const f = fieldsFrom(o.initial);
  let picking = false;

  const kindSel = h('select', {}, ...KINDS.map(([k, name]) => h('option', { value: k, text: name })));
  kindSel.value = f.kind;
  kindSel.addEventListener('change', () => { f.kind = kindSel.value as Kind; render(); });

  const num = (get: () => number, set: (v: number) => void, min: number, max: number): HTMLInputElement => {
    const el = h('input', { type: 'number', min, max, step: 1, value: get() });
    el.addEventListener('change', () => {
      const v = Math.round(Number(el.value));
      set(Number.isFinite(v) ? v : min);
      el.value = String(get());
      validate();
    });
    return el;
  };

  const grid = h('div', { class: 'form-grid' });
  const note = h('p', { class: 'hint' });
  const msgs = h('div', { class: 'msgs' });
  const confirm = h('button', { class: 'primary', text: o.confirmText });

  function pickButton(kind: PickKind): HTMLElement {
    const target = kind === 'wall' ? f.wallAt : f.at;
    const label = h('span', { text: target.x < 0 ? 'not picked yet' : o.describeTile(kind, target.x, target.y) });
    const btn = h('button', {
      text: kind === 'wall' ? 'Pick wall point on map' : 'Pick area on map',
      onclick: () => {
        picking = true;
        back.style.display = 'none';
        o.pick(kind, (tile) => {
          picking = false;
          back.style.display = '';
          if (tile) {
            target.x = tile.x;
            target.y = tile.y;
          }
          render();
        });
      },
    });
    return h('div', { class: 'row' }, btn, label);
  }

  function render(): void {
    const rows: Node[] = [h('label', { text: 'Kind' }), kindSel];
    const k = f.kind;
    if (k === 'earthquake') rows.push(h('label', { text: 'Wall point' }), pickButton('wall'));
    else if (k !== 'harshWinters') rows.push(h('label', { text: 'Area' }), pickButton('area'));
    if (k === 'animalDieOff') {
      const sp = h('select', {}, ...SPECIES_NAMES.map((n, i) => h('option', { value: i, text: n })));
      sp.value = String(f.species);
      sp.addEventListener('change', () => { f.species = Number(sp.value) as Species; validate(); });
      rows.push(h('label', { text: 'Animals' }), sp);
    }
    const instant = k === 'animalDieOff' || k === 'earthquake';
    rows.push(h('label', { text: instant ? 'Year' : 'Start year' }),
      num(() => f.year, (v) => { f.year = v; }, 0, CONFIG.events.maxYear));
    if (k === 'drought' || k === 'wetPeriod' || k === 'harshWinters') {
      rows.push(h('label', { text: 'Length (years)' }), num(() => f.length, (v) => { f.length = v; }, 1, CONFIG.events.maxYear));
    }
    if (k === 'drought' || k === 'wetPeriod' || k === 'plague') {
      rows.push(h('label', { text: 'Strength' }), num(() => f.strength, (v) => { f.strength = v; }, 1, 100));
    }
    grid.replaceChildren(...rows);
    validate();
  }

  /** What the event will do, in words; refreshed with every change. */
  function describe(ev: PlannedEvent): string {
    const { start, end } = eventYears(ev);
    const years = end - start === 1 ? `year ${start}` : `years ${start}–${end - 1}`;
    switch (ev.kind) {
      case 'drought': return `Rain × ${(1 - ev.strength / 100).toFixed(2)} in the area, ${years} (half strength in the first and last year).`;
      case 'wetPeriod': return `Rain × ${(1 + ev.strength / 100).toFixed(2)} in the area, ${years} (half strength in the first and last year).`;
      case 'plague': return `Deaths rise for groups living in the area, ${years} — most in big settlements that keep animals.`;
      case 'harshWinters': return `Whole map, ${years}: in winter plants regrow half as fast, foraging gives half, and deaths rise without Fire or Clothing.`;
      case 'animalDieOff': return `At the start of year ${start}, ${SPECIES_NAMES[ev.species]} in the area drop to 20%.`;
      case 'earthquake': return `At the start of year ${start}, the wall opens at this point (a 3×3 crossing).`;
    }
  }

  function validate(): boolean {
    const ev = build(f);
    const errs = validateEvent(ev, o.map, o.regionId);
    msgs.replaceChildren(...errs.map((e) => h('div', { class: 'msg-err', text: e })));
    note.textContent = describe(ev);
    confirm.disabled = errs.length > 0;
    return errs.length === 0;
  }

  const close = (): void => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (picking) {
      // Esc while picking: back to the dialog, nothing picked.
      picking = false;
      o.cancelPick();
      back.style.display = '';
      render();
    } else {
      close();
    }
  };
  confirm.addEventListener('click', () => {
    if (!validate()) return;
    close();
    o.onDone(build(f));
  });

  const back = h('div', { class: 'modal-back' },
    h('div', { class: 'modal small' },
      h('header', { text: o.title }),
      h('div', { class: 'body' }, grid, note),
      h('footer', {}, msgs, h('button', { text: 'Cancel', onclick: close }), confirm),
    ),
  );
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  render();
}
