// Bottom bar (§20.3). In step 1 there is no simulation yet, so run controls are shown disabled.

import { SEASON_NAMES } from '../shared/ids';
import { h } from './layout';

export interface BottomBarApi {
  setFps(fps: number): void;
  setMode(text: string): void;
}

export function buildBottomBar(root: HTMLElement): BottomBarApi {
  const fps = h('span', { class: 'fps' });
  const mode = h('span', { class: 'mode' });
  const later = 'Available once the world can run (build step 2)';
  root.append(
    h('button', { text: '▶', title: later, disabled: true }),
    h('button', { text: '1×', title: later, disabled: true }),
    h('button', { text: '8×', title: later, disabled: true }),
    h('button', { text: 'Step', title: later, disabled: true }),
    h('div', { class: 'sep' }),
    h('span', { class: 'yearbox', text: `Year 0 · ${SEASON_NAMES[0]}` }),
    h('div', { class: 'sep' }),
    h('div', { class: 'grow' }, h('input', { type: 'range', min: 0, max: 0, value: 0, disabled: true, title: 'Timeline (build step 2)' })),
    mode,
    fps,
  );
  return {
    setFps: (v) => { fps.textContent = `${v} fps`; },
    setMode: (t) => { mode.textContent = t; },
  };
}
