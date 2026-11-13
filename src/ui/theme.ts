// Toy Diorama UI switch (docs/diorama-plan/05-ui-tray.md). The tray styles are scoped under
// :root[data-ui="tray"], so turning it off leaves the old stylesheet in charge.

import { CONFIG } from '../config';
import { styleOff } from '../render/ramps';

export const trayOn: boolean = CONFIG.render.diorama.trayUi.on && !styleOff('tray');

/** Visual fixes E: the layout fits a 1600 px window and sits centred (?off=fit: the fixed 1680 px page). */
export const fitOn: boolean = CONFIG.render.fixes.layout.on && !styleOff('fit');

/** Visual fixes E: the fps readout is a developer's tool, shown only with ?fps in the URL. */
export const fpsShown: boolean = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fps');

/** Design-system colours the UI draws with in code (graphs, map label plates); tokens/colors.css. */
export const TRAY = {
  tray900: '#120c09', tray800: '#1d1410', tray700: '#241812', tray600: '#2a1f19', tray500: '#3a2a20',
  tray400: '#5a4231', cream: '#f3e7cf', creamSoft: '#d8c7a8', creamMuted: '#c9b495', brass: '#e0b030',
} as const;

/** The font the UI draws canvas text with (graphs): Pixelify Sans in the tray UI. */
export const UI_FONT = '"Pixelify Sans", ui-monospace, monospace';
