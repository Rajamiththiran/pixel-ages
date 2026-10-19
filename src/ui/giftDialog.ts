// Intervention mode (F7, D5): pick a discovery to give the selected group. Discoveries whose
// requirements the group lacks are listed but can't be picked.

import { DISCOVERIES, ERA_NAMES, has } from '../shared/discoveries';
import { h } from './layout';

export function openGiftDialog(groupName: string, owned: ArrayLike<number>, onPick: (d: number) => void): void {
  const close = (): void => back.remove();
  const list = h('div', { class: 'gift-list' });
  for (let era = 1; era < ERA_NAMES.length; era++) {
    const defs = DISCOVERIES.filter((d) => d.era === era && !has(owned, d.id));
    if (defs.length === 0) continue;
    list.append(h('div', { class: 'tb-group-label', text: `Era ${era}: ${ERA_NAMES[era]}` }));
    for (const def of defs) {
      const missing = def.needs.filter((n) => !has(owned, n)).map((n) => DISCOVERIES[n]!.name);
      const b = h('button', {
        text: missing.length ? `${def.name} (needs ${missing.join(', ')})` : def.name,
        title: def.effect,
        onclick: () => { close(); onPick(def.id); },
      });
      b.disabled = missing.length > 0;
      list.append(h('div', { class: 'row' }, b));
    }
  }
  const back = h('div', { class: 'modal-back' },
    h('div', { class: 'modal small' },
      h('header', { text: `Give ${groupName} a discovery` }),
      h('div', { class: 'body' },
        h('p', { class: 'hint', text: 'It arrives at the start of the next month. Resources it uses still have to be found and mined.' }),
        list),
      h('footer', {}, h('button', { text: 'Cancel', onclick: close }))));
  document.body.append(back);
}
