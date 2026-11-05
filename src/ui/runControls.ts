// Bottom bar (§20.3): play/pause, 1×, 8×, step, year · season, real speed, timeline,
// "Back to now". In setup mode the run controls are shown disabled.

import { SEASON_NAMES } from '../shared/ids';
import { CONFIG } from '../config';
import type { Frame, Speed } from '../shared/protocol';
import { h } from './layout';
import { trayOn } from './theme';

export interface BottomBarHandlers {
  /** ▶ in setup mode: same as the Run tab's Run ▶ button. */
  start(): void;
  play(): void;
  pause(): void;
  speed(v: Speed): void;
  step(): void;
  viewYear(year: number): void;
  backToNow(): void;
}

export interface BottomBarApi {
  setFps(fps: number, frameMs?: number): void;
  setSetupMode(text: string): void;
  setRunMode(): void;
  update(f: Frame): void;
}

export const yearLabel = (year: number, month: number): string =>
  `Year ${year.toLocaleString('en-US')} · ${SEASON_NAMES[CONFIG.seasonOfMonth[month]!]}`;

/** Writes text only when it changed: at 8× the frame comes every tick, and a rewrite relays out the bar. */
const setText = (el: HTMLElement, t: string): void => { if (el.textContent !== t) el.textContent = t; };

export function buildBottomBar(root: HTMLElement, hd: BottomBarHandlers): BottomBarApi {
  let last: Frame | null = null;
  let dragging = false;
  let setup = true;

  // Diorama phase 5: Play is the bar's one brass control; 1× and 8× sit in a sunken well.
  const play = h('button', { class: trayOn ? 'primary bb-play' : undefined, text: '▶', title: 'Play / pause (Space)' });
  const x1 = h('button', { text: '1×', title: '1 year per second (1)' });
  const x8 = h('button', { text: '8×', title: '8 years per second (8)' });
  const step = h('button', { text: 'Step', title: 'Advance one month (.)' });
  const yearbox = h('span', { class: 'yearbox' });
  const speedLabel = h('span', { class: trayOn ? 'mode rate' : 'mode' });
  const slider = h('input', { type: 'range', min: 0, max: 0, value: 0, step: 1, title: 'Timeline: drag to view any past year' });
  const back = h('button', { class: 'primary', text: 'Back to now' });
  const fps = h('span', { class: 'fps' });
  const mode = h('span', { class: 'mode' });

  play.addEventListener('click', () => {
    if (setup) hd.start();
    else if (last?.playing) hd.pause();
    else hd.play();
  });
  x1.addEventListener('click', () => hd.speed(1));
  x8.addEventListener('click', () => hd.speed(8));
  step.addEventListener('click', () => hd.step());
  back.addEventListener('click', () => hd.backToNow());
  slider.addEventListener('input', () => {
    dragging = true;
    setFill();
    yearbox.textContent = `→ Year ${Number(slider.value).toLocaleString('en-US')}`;
  });
  slider.addEventListener('change', () => {
    dragging = false;
    hd.viewYear(Number(slider.value));
  });

  // The timeline (tray): a sunken track, the elapsed part in brass-track, the range's brass thumb on top.
  const fill = h('div', { class: 'bb-fill' });
  root.append(
    play,
    trayOn ? h('div', { class: 'bb-speed', role: 'group', 'aria-label': 'Speed' }, x1, x8) : x1,
    ...(trayOn ? [] : [x8]),
    step,
    h('div', { class: 'sep' }),
    yearbox,
    speedLabel,
    h('div', { class: 'sep' }),
    h('div', { class: 'grow' }, trayOn ? h('div', { class: 'bb-track' }, fill, slider) : slider),
    back,
    mode,
    fps,
  );
  const setFill = (): void => {
    const max = Number(slider.max);
    fill.style.width = max > 0 ? `${(Number(slider.value) / max) * 100}%` : '0';
  };

  function setSetupMode(text: string): void {
    last = null;
    setup = true;
    // ▶ stays live so the world can be started from here too; the rest waits for the run.
    play.disabled = false;
    for (const b of [x1, x8, step]) b.disabled = true;
    play.title = 'Start the world (same as Run ▶ in the Run tab)';
    play.textContent = trayOn ? 'Run ▶' : '▶';
    play.style.width = trayOn ? 'auto' : '';
    x1.classList.remove('selected-speed');
    x8.classList.remove('selected-speed');
    slider.disabled = true;
    slider.max = '0';
    slider.value = '0';
    setFill();
    yearbox.textContent = yearLabel(0, 0);
    speedLabel.textContent = '';
    back.style.display = 'none';
    mode.textContent = text;
  }

  function setRunMode(): void {
    setup = false;
    for (const b of [play, x1, x8]) b.disabled = false;
    play.title = 'Play / pause (Space)';
    play.style.width = '';
    slider.disabled = false;
    mode.textContent = '';
  }

  function update(f: Frame): void {
    last = f;
    setText(play, f.playing ? '❚❚' : '▶');
    x1.classList.toggle('selected-speed', f.speed === 1);
    x8.classList.toggle('selected-speed', f.speed === 8);
    step.disabled = f.playing;
    if (!dragging) {
      setText(yearbox, yearLabel(f.year, f.month));
      slider.max = String(f.liveYear);
      slider.value = String(f.year);
      setFill();
    }
    setText(speedLabel, f.playing ? `${f.yearsPerSecond.toFixed(1)} years/s` : 'Paused');
    back.style.display = f.isPast ? '' : 'none';
  }

  setSetupMode('');
  return {
    // F8: the frame's drawing time beside the fps (the 60 fps budget is 16.7 ms).
    setFps: (v, ms) => { fps.textContent = ms === undefined ? `${v} fps` : `${v} fps · ${ms.toFixed(1)} ms`; fps.title = 'Frames per second and the average time one frame takes to draw'; },
    setSetupMode, setRunMode, update,
  };
}
