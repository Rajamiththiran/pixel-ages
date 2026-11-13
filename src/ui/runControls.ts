// Bottom bar (§20.3): play/pause, the six speeds (speeds plan, plus Drift), step, year · season, real speed, timeline,
// "Back to now". In setup mode the run controls are shown disabled.

import { SEASON_NAMES } from '../shared/ids';
import { CONFIG } from '../config';
import type { Frame, Speed } from '../shared/protocol';
import { inMonths, SPEEDS, speedKey, speedRow, speedTitle } from '../shared/speeds';
import { h } from './layout';
import { fpsShown, trayOn } from './theme';

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
  /**
   * Seasons Phase 4 (mockup D): `held` (the fast-forward look) names the held season, Summer, in the
   * year; `note` is the caption under it ("season held at Fly", "drought year"); `warn` shows it in
   * the warning colour. An empty note hides the line.
   */
  setSeason(held: boolean, note: string, warn: boolean): void;
  setSetupMode(text: string): void;
  setRunMode(): void;
  update(f: Frame): void;
}

export const yearLabel = (year: number, month: number, held = false): string =>
  `Year ${year.toLocaleString('en-US')} · ${SEASON_NAMES[held ? HELD_SEASON : CONFIG.seasonOfMonth[month]!]}`;

/** The season the held fast-forward look shows (mockup D: summer). */
const HELD_SEASON = 1;

/** Writes text only when it changed: at 8× the frame comes every tick, and a rewrite relays out the bar. */
const setText = (el: HTMLElement, t: string): void => { if (el.textContent !== t) el.textContent = t; };

export function buildBottomBar(root: HTMLElement, hd: BottomBarHandlers): BottomBarApi {
  let last: Frame | null = null;
  let dragging = false;
  let setup = true;

  // Diorama phase 5: Play is the bar's one brass control; 1× and 8× sit in a sunken well.
  const play = h('button', { class: trayOn ? 'primary bb-play' : undefined, text: '▶', title: 'Play / pause (Space)' });
  // Speeds plan Phase 2: one button per speed in the table, named by its label; the tooltip
  // carries the real rate and the key.
  const speedBtns = SPEEDS.map((v) => h('button', { text: speedRow(v).label, title: `${speedTitle(v)} (${speedKey(v)})`, 'aria-pressed': 'false' }));
  const step = h('button', { text: 'Step', title: 'Advance one month (.)' });
  const yearbox = h('span', { class: 'yearbox' });
  // Seasons Phase 4: the caption under the year (mockup D), hidden while empty.
  const yearnote = h('span', { class: 'yearnote' });
  yearnote.style.display = 'none';
  let heldSeason = false;
  const speedLabel = h('span', { class: trayOn ? 'mode rate' : 'mode' });
  const slider = h('input', { type: 'range', min: 0, max: 0, value: 0, step: 1, title: 'Timeline: drag to view any past year' });
  const back = h('button', { class: 'primary', text: 'Back to now' });
  const fps = h('span', { class: 'fps' });
  // Visual fixes E: players don't see the frame timing; ?fps shows it.
  if (!fpsShown) fps.style.display = 'none';
  const mode = h('span', { class: 'mode' });

  play.addEventListener('click', () => {
    if (setup) hd.start();
    else if (last?.playing) hd.pause();
    else hd.play();
  });
  speedBtns.forEach((b, k) => b.addEventListener('click', () => hd.speed(SPEEDS[k]!)));
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
    h('div', { class: 'bb-speed', role: 'group', 'aria-label': 'Speed' }, ...speedBtns),
    step,
    h('div', { class: 'sep' }),
    h('div', { class: 'yearwrap' }, yearbox, yearnote),
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
    for (const b of [...speedBtns, step]) b.disabled = true;
    play.title = 'Start the world (same as Run ▶ in the Run tab)';
    play.textContent = trayOn ? 'Run ▶' : '▶';
    play.style.width = trayOn ? 'auto' : '';
    for (const b of speedBtns) { b.classList.remove('selected-speed'); b.setAttribute('aria-pressed', 'false'); }
    slider.disabled = true;
    slider.max = '0';
    slider.value = '0';
    setFill();
    yearbox.textContent = yearLabel(0, 0);
    setSeason(false, '', false);
    speedLabel.textContent = '';
    back.style.display = 'none';
    mode.textContent = text;
  }

  function setRunMode(): void {
    setup = false;
    for (const b of [play, ...speedBtns]) b.disabled = false;
    play.title = 'Play / pause (Space)';
    play.style.width = '';
    slider.disabled = false;
    mode.textContent = '';
  }

  function update(f: Frame): void {
    last = f;
    setText(play, f.playing ? '❚❚' : '▶');
    speedBtns.forEach((b, k) => {
      const on = f.speed === SPEEDS[k];
      if (b.classList.contains('selected-speed') !== on) { b.classList.toggle('selected-speed', on); b.setAttribute('aria-pressed', String(on)); }
    });
    step.disabled = f.playing;
    if (!dragging) {
      setText(yearbox, yearLabel(f.year, f.month, heldSeason));
      slider.max = String(f.liveYear);
      slider.value = String(f.year);
      setFill();
    }
    // A pace in months is the set one: at Watch a 1 s measuring window holds 0 or 1 month, so the
    // measured rate flickered 0.0 / 1.0, and a pace this slow never falls behind (seasons Phase 3b).
    setText(speedLabel, !f.playing ? 'Paused'
      : inMonths(speedRow(f.speed).yearsPerSecond) ? `${speedRow(f.speed).yearsPerSecond * CONFIG.time.ticksPerYear} months/s`
      : `${f.yearsPerSecond.toFixed(1)} years/s`);
    back.style.display = f.isPast ? '' : 'none';
  }

  function setSeason(held: boolean, note: string, warn: boolean): void {
    heldSeason = held;
    setText(yearnote, note);
    yearnote.style.display = note ? '' : 'none';
    yearnote.classList.toggle('warn', warn);
    if (last && !dragging) setText(yearbox, yearLabel(last.year, last.month, held));
  }

  setSetupMode('');
  return {
    setSeason,
    // F8: the frame's drawing time beside the fps (the 60 fps budget is 16.7 ms).
    setFps: (v, ms) => { fps.textContent = ms === undefined ? `${v} fps` : `${v} fps · ${ms.toFixed(1)} ms`; fps.title = 'Frames per second and the average time one frame takes to draw'; },
    setSetupMode, setRunMode, update,
  };
}
