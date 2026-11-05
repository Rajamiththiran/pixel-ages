// Presentation strip in the bottom bar (F8 §14.6–14.7): camera (zoom, follow, story,
// time-lapse), capture (screenshot, GIF, photo mode) and look (day and night, weather, sound,
// colour-blind colours). Camera and capture work in setup too, except what needs a run.
// Diorama phase 5 (owner): in the tray UI they live in a "View" popover on the bar, so the bar
// keeps only the time controls; every keyboard shortcut still works with it closed.

import { h } from './layout';
import { trayOn } from './theme';

export interface PresentState {
  zoom: number; follow: boolean; story: boolean; timelapse: boolean; recording: boolean;
  dayNight: boolean; weather: boolean; muted: boolean; colourBlind: boolean; running: boolean;
}

export interface PresentActions {
  zoom(): void;
  follow(): void;
  story(): void;
  timelapse(): void;
  shot(): void;
  gif(): void;
  photo(): void;
  dayNight(): void;
  weather(): void;
  sound(): void;
  colourBlind(): void;
}

export interface PresentApi { refresh(st: PresentState): void }

export function buildPresentBar(root: HTMLElement, a: PresentActions): PresentApi {
  const b = (text: string, title: string, on: () => void): HTMLButtonElement =>
    h('button', { class: 'pb-btn', text, title, onclick: on });
  const zoom = b('Zoom 1×', 'Zoom 1× / 2× / 4× on the cursor (Z, or the mouse wheel). Pan with right-drag or arrows/WASD', a.zoom);
  const follow = b('Follow', 'Follow cam: keep the selected group in the middle (C)', a.follow);
  const story = b('Story', 'Story mode: the camera jumps to big moments as they happen (M)', a.story);
  const lapse = b('Time-lapse', 'Replay the whole history fast from year 0 up to now (T)', a.timelapse);
  const shot = b('Shot', 'Save a screenshot of the map (PNG)', a.shot);
  const gif = b('GIF', 'Record a few seconds of the map as an animated GIF', a.gif);
  const photo = b('Photo', 'Photo mode: hide everything but the map (P; Esc to leave)', a.photo);
  const day = b('Day/night', 'Day and night (visual only: the simulation counts months)', a.dayNight);
  const weather = b('Weather', 'Clouds, rain and snow, cracks and puddles (visual only)', a.weather);
  const sound = b('Sound', 'Ambient sound on / off', a.sound);
  const cb = b('Colour-blind', 'Lineage colours that colour-blind eyes tell apart (Okabe–Ito)', a.colourBlind);
  if (trayOn) root.append(viewPopover([
    ['Camera', [zoom, follow, story, lapse]], ['Capture', [shot, gif, photo]], ['Look', [day, weather, sound, cb]],
  ]));
  else root.append(h('div', { class: 'present' }, zoom, follow, story, lapse, h('div', { class: 'sep' }), shot, gif, photo, h('div', { class: 'sep' }), day, weather, sound, cb));
  return {
    refresh(st) {
      zoom.textContent = `Zoom ${st.zoom}×`;
      zoom.classList.toggle('selected', st.zoom > 1);
      follow.classList.toggle('selected', st.follow);
      story.classList.toggle('selected', st.story);
      lapse.classList.toggle('selected', st.timelapse);
      gif.classList.toggle('selected', st.recording);
      day.classList.toggle('selected', st.dayNight);
      weather.classList.toggle('selected', st.weather);
      sound.textContent = st.muted ? 'Sound off' : 'Sound on';
      sound.classList.toggle('selected', !st.muted);
      cb.classList.toggle('selected', st.colourBlind);
      for (const btn of [follow, story, lapse, day, weather]) btn.disabled = !st.running;
    },
  };
}

/** The "View" button and its popover card (opaque, above the bar), closed by Esc or a click outside. */
function viewPopover(sections: Array<[string, HTMLButtonElement[]]>): HTMLElement {
  const pop = h('div', { class: 'view-pop', role: 'dialog', 'aria-label': 'View' });
  for (const [title, buttons] of sections) pop.append(h('p', { class: 'pop-head', text: title }), ...buttons);
  pop.hidden = true;
  const btn = h('button', { class: 'view-btn', text: 'View', title: 'Camera, capture and look: zoom, follow, story, time-lapse, shot, GIF, photo, day and night, weather, sound, colour-blind', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
  const wrap = h('div', { class: 'view-wrap' }, pop, btn);
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.focus(); } };
  const onDown = (e: MouseEvent): void => { if (!wrap.contains(e.target as Node)) setOpen(false); };
  function setOpen(open: boolean): void {
    if (pop.hidden === !open) return;
    pop.hidden = !open;
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) { document.addEventListener('keydown', onKey, true); document.addEventListener('mousedown', onDown, true); }
    else { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown, true); }
  }
  btn.addEventListener('click', () => setOpen(pop.hidden));
  return wrap;
}
