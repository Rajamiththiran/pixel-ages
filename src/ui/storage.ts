// localStorage map presets and file download/upload (§17.4).
// Every localStorage call is wrapped: storage can be full, blocked or missing.

import type { MapData } from '../shared/types';
import { decodeMap, encodeMap } from '../shared/save';

const MAP_PREFIX = 'pixelAges.map.';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function listPresets(): Result<string[]> {
  try {
    const names: string[] = [];
    for (let k = 0; k < localStorage.length; k++) {
      const key = localStorage.key(k);
      if (key?.startsWith(MAP_PREFIX)) names.push(key.slice(MAP_PREFIX.length));
    }
    return { ok: true, value: names.sort((a, b) => a.localeCompare(b)) };
  } catch {
    return { ok: false, error: 'Browser storage is blocked, so presets are unavailable. Use Export map instead.' };
  }
}

export function savePreset(name: string, map: MapData): Result<null> {
  try {
    localStorage.setItem(MAP_PREFIX + name, encodeMap(map));
    return { ok: true, value: null };
  } catch {
    return { ok: false, error: 'Could not save: browser storage is full or blocked. Use Export map instead.' };
  }
}

export function loadPreset(name: string): Result<MapData> {
  let text: string | null;
  try {
    text = localStorage.getItem(MAP_PREFIX + name);
  } catch {
    return { ok: false, error: 'Browser storage is blocked.' };
  }
  if (text === null) return { ok: false, error: `No preset called "${name}".` };
  try {
    return { ok: true, value: decodeMap(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function deletePreset(name: string): Result<null> {
  try {
    localStorage.removeItem(MAP_PREFIX + name);
    return { ok: true, value: null };
  } catch {
    return { ok: false, error: 'Browser storage is blocked.' };
  }
}

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Opens a file picker and resolves with the chosen file's text (or null if cancelled). */
export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      file.text().then(resolve, () => resolve(null));
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** File-name-safe version of a user-entered name. */
export const safeFileName = (name: string): string =>
  name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'untitled';

const TUTORIAL_KEY = 'pixelAges.tutorialSeen';

/** True once the first-launch tutorial (§20.8) has been finished or skipped. Blocked storage counts as not seen. */
export function tutorialSeen(): boolean {
  try { return localStorage.getItem(TUTORIAL_KEY) === '1'; } catch { return false; }
}

/** F8 look settings, remembered in this browser. */
export interface LookSettings { muted: boolean; colourBlind: boolean; dayNight: boolean; weather: boolean }
const LOOK_KEY = 'pixelAges.look';
// D8: sound is on by default.
const LOOK_DEFAULT: LookSettings = { muted: false, colourBlind: false, dayNight: true, weather: true };

export function loadLook(): LookSettings {
  try {
    const v = JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}') as Partial<LookSettings>;
    return { ...LOOK_DEFAULT, ...v };
  } catch {
    return { ...LOOK_DEFAULT };
  }
}

export function saveLook(s: LookSettings): void {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(s)); } catch { /* storage blocked: settings last for this visit */ }
}

export function markTutorialSeen(): void {
  try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* storage blocked: the tutorial just shows again next time */ }
}
