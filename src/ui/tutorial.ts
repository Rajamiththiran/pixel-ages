// First-launch tutorial (§20.8) and the About panel: plain modals.

import { VERSION } from '../version';
import { h } from './layout';

/** Credits in the About panel (names given by the owner, DECISIONS 7.5). */
const CREDITS = 'Created by Rajamiththiran. Built with TypeScript, Vite and Canvas 2D. Every sprite, terrain tile, the pixel font and the ambient sound are made in code.';

const CARDS: Array<[string, string[]]> = [
  ['1 · Paint the world', [
    'Pick a brush on the left: ground, plants, resources, rain, animals or walls. Drag on the map to paint.',
    'Rivers, mountain ranges and seas painted as walls split the land into areas that people can only cross much later.',
  ]],
  ['2 · Place people', [
    'Choose "Place group" in the People tools and click the map. Set how many men and women, their ages, intelligence, cooperation and strength.',
    'Each group you place starts a lineage with its own colour.',
  ]],
  ['3 · Add events (optional)', [
    'In the Events tab, plan droughts, wet periods, plagues, harsh winters, animal die-offs or earthquakes for chosen years.',
    'Nothing can be changed once the run starts: you only watch. (Intervention mode, in the Run tab, is the one exception: the floods, fires, gifts and moves you make become part of the run.)',
  ]],
  ['4 · Seed & Run', [
    'In the Run tab, pick a seed and the climate drift, then press Run ▶. Space pauses, 8× speeds up.',
    'The same setup with the same seed always gives the same history, so you can change one thing and compare.',
  ]],
  ['5 · The land changes', [
    'People cut forests for huts, fires, boats and metal; goats overgraze grass into desert; fields wear out and irrigated soil turns salty. Paths wear into roads, and abandoned villages become ruins that the forest slowly takes back.',
    'The land shapes what people do next: they move, invent, or collapse.',
  ]],
  ['6 · Disasters have causes', [
    'Fires, floods, landslides, dust storms, disease and pests have causes: dry seasons and thatch burn, floodplains flood, crowded villages beside their herds fall sick, cleared slopes slide.',
    'After a disaster the discovery that prevents it (Fire Safety, Levees, Wells…) gets more likely for a while: people learn. Heatmap → Fire risk or Flood risk shows where danger builds up.',
  ]],
  ['7 · Read the results', [
    'Click a person, a home or a tile to inspect it. Graphs compare the lineages; the Log lists what happened.',
    'Click a log line or a point on a graph — or drag the timeline — to see any past year.',
  ]],
];

function modal(title: string, body: Node[], footer: Node[], onClose: () => void): { close: () => void } {
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = (): void => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose();
  };
  const back = h('div', { class: 'modal-back' },
    h('div', { class: 'modal small' }, h('header', { text: title }), h('div', { class: 'body' }, ...body), h('footer', {}, ...footer)));
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  return { close };
}

/** The 7-card tutorial (F9 added "The land changes" and "Disasters have causes"). `onLoadExample` loads "Smart desert vs rich forest" (Scenario B). */
export function openTutorial(onDone: () => void, onLoadExample: () => void): void {
  let k = 0;
  const body = h('div');
  const next = h('button', { class: 'primary' });
  const dots = h('span', { class: 'hint' });
  const render = (): void => {
    const [title, paras] = CARDS[k]!;
    body.replaceChildren(h('h3', { text: title }), ...paras.map((p) => h('p', { text: p })));
    next.textContent = k === CARDS.length - 1 ? 'Start painting' : 'Next';
    dots.textContent = `${k + 1} / ${CARDS.length}`;
  };
  const m = modal('Welcome to Pixel Ages', [body], [
    dots,
    h('button', { text: 'Skip', onclick: () => m.close() }),
    h('button', { text: 'Load the example', title: 'Smart desert vs rich forest: two groups, one river, seed 48213', onclick: () => { m.close(); onLoadExample(); } }),
    next,
  ], onDone);
  next.addEventListener('click', () => { if (k < CARDS.length - 1) { k++; render(); } else m.close(); });
  render();
}

/** About (§24 step 7): version, how seeds work, credits. */
export function openAbout(onTutorial: () => void, onLoadExample: () => void): void {
  const m = modal(`Pixel Ages ${VERSION}`, [
    h('p', { text: 'A hands-off god-sim experiment: paint a world, place small groups of people, and watch them explore, discover, grow into villages, meet, trade, fight and collapse over up to 10,000 years. Since version 2 the land changes under them, and disasters come from how they live.' }),
    h('h3', { text: 'Seeds' }),
    h('p', { text: 'All randomness in a run comes from its seed. The same map, groups, events, drift and seed always replay the exact same history — speed, pausing and looking at the past never change it. Export the run (Maps tab) to keep or share an experiment.' }),
    h('h3', { text: 'How "real" it is' }),
    h('p', { text: 'The rules follow real-world patterns — forager birth and death rates, Dunbar\'s number, farming feeding far more people per km², fields wearing out, irrigation salting the soil, fire spreading through dry fuel, disease hitting dense settlements — as simple models, never exact science. Intelligence is a game stat; it models no real population.' }),
    h('h3', { text: 'Credits' }),
    h('p', { text: CREDITS }),
  ], [
    h('button', { text: 'Show tutorial', onclick: () => { m.close(); onTutorial(); } }),
    h('button', { text: 'Load the example', onclick: () => { m.close(); onLoadExample(); } }),
    h('button', { class: 'primary', text: 'Close', onclick: () => m.close() }),
  ], () => {});
}
