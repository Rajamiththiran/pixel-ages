// People dialog (§20.4). Generates an explicit FounderPerson list; Math.random is fine
// here because the generated people are saved in the setup, so runs stay repeatable.

import { CONFIG } from '../config';
import { Sex } from '../shared/ids';
import type { FounderGroup, FounderPerson } from '../shared/types';
import { GROUP_COLORS, GROUP_COLOR_NAMES } from '../render/palette';
import { h } from './layout';

const D = CONFIG.ui.peopleDialog;
const T = CONFIG.people.traits;

export interface PeopleDialogResult {
  name: string;
  colorIndex: number;
  people: FounderPerson[];
}

export interface PeopleDialogOptions {
  title: string;
  confirmText: string;
  initial: FounderGroup | null;
  defaultName: string;
  defaultColor: number;
  usedColors: ReadonlySet<number>;
  onDone: (r: PeopleDialogResult) => void;
}

interface GenFields {
  men: number; women: number; ageMin: number; ageMax: number;
  intelligence: number; cooperation: number; strength: number; variation: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Visual/setup-only gaussian (Irwin–Hall, same shape as the sim's). */
const setupGaussian = (): number =>
  (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.7320508075688772;

export function generatePeople(f: GenFields): FounderPerson[] {
  const out: FounderPerson[] = [];
  const trait = (base: number, t: { setupMin: number; setupMax: number; setupSpreadSd: number }): number =>
    Math.round(clamp(f.variation ? base + setupGaussian() * t.setupSpreadSd : base, t.setupMin, t.setupMax));
  const add = (sex: Sex): void => {
    out.push({
      sex,
      age: f.ageMin + Math.floor(Math.random() * (f.ageMax - f.ageMin + 1)),
      intelligence: trait(f.intelligence, T.intelligence),
      cooperation: trait(f.cooperation, T.cooperation),
      strength: trait(f.strength, T.strength),
    });
  };
  for (let k = 0; k < f.men; k++) add(Sex.Male);
  for (let k = 0; k < f.women; k++) add(Sex.Female);
  return out;
}

function fieldsFrom(g: FounderGroup | null): GenFields {
  if (!g || g.people.length === 0) {
    return {
      men: D.men, women: D.women, ageMin: D.ageMin, ageMax: D.ageMax,
      intelligence: D.intelligence, cooperation: D.cooperation, strength: D.strength, variation: false,
    };
  }
  const p = g.people;
  const avg = (k: 'intelligence' | 'cooperation' | 'strength'): number =>
    Math.round(p.reduce((s, x) => s + x[k], 0) / p.length);
  return {
    men: p.filter((x) => x.sex === Sex.Male).length,
    women: p.filter((x) => x.sex === Sex.Female).length,
    ageMin: Math.min(...p.map((x) => x.age)),
    ageMax: Math.max(...p.map((x) => x.age)),
    intelligence: avg('intelligence'),
    cooperation: avg('cooperation'),
    strength: avg('strength'),
    variation: false,
  };
}

export function openPeopleDialog(o: PeopleDialogOptions): void {
  const f = fieldsFrom(o.initial);
  let people: FounderPerson[] = o.initial ? o.initial.people.map((p) => ({ ...p })) : generatePeople(f);
  let colorIndex = o.initial ? o.initial.colorIndex : o.defaultColor;

  const nameInput = h('input', { type: 'text', maxlength: D.nameMaxLength, value: o.initial?.name ?? o.defaultName });

  const colors = h('div', { class: 'colors' });
  const colorButtons = GROUP_COLORS.map((c, k) => {
    const b = h('button', {
      title: GROUP_COLOR_NAMES[k] + (o.usedColors.has(k) ? ' (used by another group)' : ''),
      class: o.usedColors.has(k) ? 'used' : '',
      onclick: () => { colorIndex = k; refreshColors(); },
    });
    b.style.background = c;
    colors.append(b);
    return b;
  });
  const refreshColors = (): void => colorButtons.forEach((b, k) => b.classList.toggle('selected', k === colorIndex));
  refreshColors();

  // Generator fields: any change regenerates the person list.
  const num = (value: number, min: number, max: number, set: (v: number) => void): HTMLInputElement => {
    const el = h('input', { type: 'number', min, max, value });
    el.addEventListener('change', () => {
      const v = clamp(Math.round(Number(el.value) || 0), min, max);
      el.value = String(v);
      set(v);
      regenerate();
    });
    return el;
  };
  const menIn = num(f.men, D.minCount, D.maxCount, (v) => { f.men = v; });
  const womenIn = num(f.women, D.minCount, D.maxCount, (v) => { f.women = v; });
  const ageMinIn = num(f.ageMin, D.ageLimitMin, D.ageLimitMax, (v) => { f.ageMin = v; });
  const ageMaxIn = num(f.ageMax, D.ageLimitMin, D.ageLimitMax, (v) => { f.ageMax = v; });
  const intIn = num(f.intelligence, T.intelligence.setupMin, T.intelligence.setupMax, (v) => { f.intelligence = v; });
  const coopIn = num(f.cooperation, T.cooperation.setupMin, T.cooperation.setupMax, (v) => { f.cooperation = v; });
  const strIn = num(f.strength, T.strength.setupMin, T.strength.setupMax, (v) => { f.strength = v; });
  const varIn = h('input', { type: 'checkbox' });
  varIn.checked = f.variation;
  varIn.addEventListener('change', () => { f.variation = varIn.checked; regenerate(); });

  const tableBody = h('tbody');
  const msgs = h('div', { class: 'msgs' });
  const confirm = h('button', { class: 'primary', text: o.confirmText });

  function regenerate(): void {
    if (f.ageMin > f.ageMax) { validate(); return; }
    people = generatePeople(f);
    renderTable();
  }

  function renderTable(): void {
    tableBody.replaceChildren();
    people.forEach((p, k) => {
      const cell = (key: 'age' | 'intelligence' | 'cooperation' | 'strength', min: number, max: number): HTMLElement => {
        const el = h('input', { type: 'number', min, max, value: p[key] });
        el.addEventListener('change', () => {
          const v = clamp(Math.round(Number(el.value) || 0), min, max);
          el.value = String(v);
          p[key] = v;
          validate();
        });
        return h('td', {}, el);
      };
      const sexSel = h('select', {},
        h('option', { value: Sex.Male, text: 'Man' }),
        h('option', { value: Sex.Female, text: 'Woman' }));
      sexSel.value = String(p.sex);
      sexSel.addEventListener('change', () => { p.sex = Number(sexSel.value) as Sex; validate(); });
      tableBody.append(h('tr', {},
        h('td', { text: String(k + 1) }),
        h('td', {}, sexSel),
        cell('age', D.ageLimitMin, D.ageLimitMax),
        cell('intelligence', T.intelligence.setupMin, T.intelligence.setupMax),
        cell('cooperation', T.cooperation.setupMin, T.cooperation.setupMax),
        cell('strength', T.strength.setupMin, T.strength.setupMax),
      ));
    });
    validate();
  }

  function validate(): boolean {
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = nameInput.value.trim();
    if (name.length < 1 || name.length > D.nameMaxLength) errors.push(`Name must be 1–${D.nameMaxLength} characters.`);
    if (f.ageMin > f.ageMax) errors.push('Youngest age is above the oldest age.');
    if (people.length === 0) errors.push('A group needs at least 1 person.');
    if (people.length > D.maxPeople) errors.push(`A group can have at most ${D.maxPeople} people.`);
    const men = people.filter((p) => p.sex === Sex.Male).length;
    if (people.length > 0 && (men === 0 || men === people.length)) {
      warnings.push("This group can't have children and will die out.");
    }
    msgs.replaceChildren(
      ...errors.map((e) => h('div', { class: 'msg-err', text: e })),
      ...warnings.map((w) => h('div', { class: 'msg-warn', text: w })),
    );
    confirm.disabled = errors.length > 0;
    return errors.length === 0;
  }

  nameInput.addEventListener('input', () => validate());

  const close = (): void => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  confirm.addEventListener('click', () => {
    if (!validate()) return;
    close();
    o.onDone({ name: nameInput.value.trim(), colorIndex, people });
  });

  const body = h('div', { class: 'body' },
    h('div', { class: 'form-grid' },
      h('label', { text: 'Name' }), nameInput,
      h('label', { text: 'Colour' }), colors,
      h('label', { text: 'Men' }), menIn,
      h('label', { text: 'Women' }), womenIn,
      h('label', { text: 'Ages' }), h('div', { class: 'row' }, ageMinIn, h('span', { text: 'to' }), ageMaxIn),
      h('label', { text: 'Intelligence' }), intIn,
      h('label', { text: 'Cooperation' }), coopIn,
      h('label', { text: 'Strength' }), strIn,
      h('label', { text: 'Natural variation' }), h('div', { class: 'row' }, varIn,
        h('span', { class: 'hint', text: 'each person gets a small random difference' })),
    ),
    h('div', { class: 'section' },
      h('h3', { text: 'Edit each person' }),
      h('div', { class: 'hint', text: 'Changing a field above makes a new list.' }),
      h('table', { class: 'people-table' },
        h('thead', {}, h('tr', {},
          h('th', { text: '#' }), h('th', { text: 'Sex' }), h('th', { text: 'Age' }),
          h('th', { text: 'Int' }), h('th', { text: 'Coop' }), h('th', { text: 'Str' }))),
        tableBody),
    ),
  );

  const back = h('div', { class: 'modal-back' },
    h('div', { class: 'modal' },
      h('header', { text: o.title }),
      body,
      h('footer', {}, msgs, h('button', { text: 'Cancel', onclick: close }), confirm),
    ),
  );
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  renderTable();
  nameInput.focus();
  nameInput.select();
}
