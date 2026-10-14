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

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
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
