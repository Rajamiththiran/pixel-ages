// Presentation strip in the bottom bar (F8 §14.6–14.7): camera (zoom, follow, story,
// time-lapse), capture (screenshot, GIF, photo mode) and look (day and night, weather, sound,
// colour-blind colours). Camera and capture work in setup too, except what needs a run.

import { h } from './layout';

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
  root.append(h('div', { class: 'present' }, zoom, follow, story, lapse, h('div', { class: 'sep' }), shot, gif, photo, h('div', { class: 'sep' }), day, weather, sound, cb));
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
