// Screen layout (§20.1) and a tiny DOM helper.

import { CONFIG } from '../config';
import { fitOn } from './theme';

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Creates an element. Keys starting with "on" become listeners; `class`/`text` are shortcuts. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

export interface Layout {
  toolbar: HTMLElement;
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  tooltip: HTMLElement;
  toast: HTMLElement;
  banner: HTMLElement;
  tabs: HTMLElement;
  tabBody: HTMLElement;
  bottom: HTMLElement;
}

export function buildLayout(root: HTMLElement): Layout {
  root.style.setProperty('--toolbar', `${CONFIG.ui.toolbarPx}px`);
  root.style.setProperty('--panel', `${CONFIG.ui.rightPanelPx}px`);
  root.style.setProperty('--bottom', `${CONFIG.ui.bottomBarPx}px`);
  if (fitOn) {
    // Visual fixes E: styles.css (:root[data-fit]) lets the panel shrink to --panel-min and centres the app.
    const L = CONFIG.render.fixes.layout;
    document.documentElement.dataset.fit = '';
    document.documentElement.style.setProperty('--panel-min', `${L.panelMinPx}px`);
  }
  const toolbar = h('aside', { class: 'toolbar' });
  const canvas = h('canvas', { id: 'map' });
  const tooltip = h('div', { class: 'tooltip' });
  const toast = h('div', { class: 'toast' });
  const banner = h('div', { class: 'banner' });
  const stage = h('main', { class: 'stage' }, canvas, tooltip, toast, banner);
  const tabs = h('nav', { class: 'tabs' });
  const tabBody = h('div', { class: 'tab-body' });
  const panel = h('section', { class: 'panel' }, tabs, tabBody);
  const bottom = h('footer', { class: 'bottombar' });
  root.className = 'app';
  root.append(toolbar, stage, panel, bottom);
  // Visual fixes E: a panel narrower than it was made for (a window under 1680 px) marks the page, so
  // the tabs take the smaller caption type (CSS in tray.css; no media queries, tests/tray.test.ts).
  if (fitOn && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      document.documentElement.toggleAttribute('data-narrow', panel.getBoundingClientRect().width < CONFIG.ui.rightPanelPx - 1);
    }).observe(panel);
  }
  return { toolbar, stage, canvas, tooltip, toast, banner, tabs, tabBody, bottom };
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(el: HTMLElement, text: string): void {
  el.textContent = text;
  el.style.display = 'block';
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, CONFIG.ui.toastMs);
}
