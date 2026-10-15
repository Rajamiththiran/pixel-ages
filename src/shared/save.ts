// JSON encode/decode for map presets and run files (§17.4).
// Typed arrays are stored as base64 strings of their bytes.

import type { MapData, RunSetup, FounderGroup, PlannedEvent, ClimateDrift } from './types';

// Version 2 (F1) adds the Tin and Salt resources; version 1 files are still valid and load as 2.
export const SAVE_VERSION = 2;
export const OLDEST_LOADABLE_VERSION = 1;
export const WRONG_VERSION_MESSAGE = 'This file was made by a different version';

export class SaveError extends Error {}

export function bytesToBase64(bytes: Uint8Array): string {
  // Chunked so large arrays don't overflow the argument limit of fromCharCode.
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface MapJson {
  version: number;
  width: number;
  height: number;
  ground: string;
  plantType: string;
  plantDensity: string;
  resourceType: string;
  resourceAmount: string;
  rain: string;
  animals: [string, string, string, string];
  wall: string;
}

export function mapToJson(map: MapData): MapJson {
  return {
    version: map.version,
    width: map.width,
    height: map.height,
    ground: bytesToBase64(map.ground),
    plantType: bytesToBase64(map.plantType),
    plantDensity: bytesToBase64(map.plantDensity),
    resourceType: bytesToBase64(map.resourceType),
    resourceAmount: bytesToBase64(map.resourceAmount),
    rain: bytesToBase64(map.rain),
    animals: [
      bytesToBase64(map.animals[0]),
      bytesToBase64(map.animals[1]),
      bytesToBase64(map.animals[2]),
      bytesToBase64(map.animals[3]),
    ],
    wall: bytesToBase64(map.wall),
  };
}

function layer(value: unknown, n: number, name: string): Uint8Array {
  if (typeof value !== 'string') throw new SaveError(`Map layer "${name}" is missing`);
  const bytes = base64ToBytes(value);
  if (bytes.length !== n) throw new SaveError(`Map layer "${name}" has the wrong size`);
  return bytes;
}

function checkVersion(obj: unknown): Record<string, unknown> {
  if (typeof obj !== 'object' || obj === null) throw new SaveError('This is not a Pixel Ages file');
  const rec = obj as Record<string, unknown>;
  const v = rec.version;
  if (typeof v !== 'number' || v < OLDEST_LOADABLE_VERSION || v > SAVE_VERSION) throw new SaveError(WRONG_VERSION_MESSAGE);
  return rec;
}

export function mapFromJson(obj: unknown): MapData {
  const j = checkVersion(obj);
  const width = j.width;
  const height = j.height;
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    throw new SaveError('Map size is missing');
  }
  const n = width * height;
  const animals = j.animals;
  if (!Array.isArray(animals) || animals.length !== 4) throw new SaveError('Map animal layers are missing');
  return {
    version: 2,
    width,
    height,
    ground: layer(j.ground, n, 'ground'),
    plantType: layer(j.plantType, n, 'plantType'),
    plantDensity: layer(j.plantDensity, n, 'plantDensity'),
    resourceType: layer(j.resourceType, n, 'resourceType'),
    resourceAmount: layer(j.resourceAmount, n, 'resourceAmount'),
    rain: layer(j.rain, n, 'rain'),
    animals: [
      layer(animals[0], n, 'animals[0]'),
      layer(animals[1], n, 'animals[1]'),
      layer(animals[2], n, 'animals[2]'),
      layer(animals[3], n, 'animals[3]'),
    ],
    wall: layer(j.wall, n, 'wall'),
  };
}

export function encodeMap(map: MapData): string {
  return JSON.stringify(mapToJson(map));
}

export function decodeMap(text: string): MapData {
  return mapFromJson(parseJson(text));
}

export function encodeRun(run: RunSetup): string {
  return JSON.stringify({
    version: run.version,
    name: run.name,
    seed: run.seed,
    climateDrift: run.climateDrift,
    map: mapToJson(run.map),
    founders: run.founders,
    events: run.events,
  });
}

const DRIFTS: ReadonlyArray<ClimateDrift> = ['off', 'slow', 'strong'];

export function decodeRun(text: string): RunSetup {
  const j = checkVersion(parseJson(text));
  const map = mapFromJson(j.map);
  if (!Array.isArray(j.founders)) throw new SaveError('Run file has no founder list');
  if (!Array.isArray(j.events)) throw new SaveError('Run file has no event list');
  const seed = typeof j.seed === 'number' ? j.seed >>> 0 : 0;
  const drift = DRIFTS.includes(j.climateDrift as ClimateDrift) ? (j.climateDrift as ClimateDrift) : 'off';
  return {
    version: 2,
    name: typeof j.name === 'string' ? j.name : '',
    map,
    founders: j.founders as FounderGroup[],
    events: j.events as PlannedEvent[],
    seed,
    climateDrift: drift,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SaveError('This file is not valid JSON');
  }
}
