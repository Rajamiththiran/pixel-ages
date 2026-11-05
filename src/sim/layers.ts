// Heatmaps and territory fills (future blueprint F7, §13): one byte per tile, worked out in the
// worker when a view asks for it. Read-only: nothing here changes the simulation.

import { CONFIG } from '../config';
import { Ground, Species, WallType } from '../shared/ids';
import type { LogEntry } from '../shared/types';
import type { MapLayer } from '../shared/protocol';
import type { SimState } from './state';
import { homeRange } from './people/food';
import { population } from './people/groups';
import { riskLayer } from './world/hazards';

const HL = CONFIG.render.heat;
const ERAS = 6;

const land = (s: SimState, i: number): boolean => s.wall[i] === WallType.None && s.ground[i] !== Ground.Water;

/** 0–255 for one tile from a 0–1 value. */
const byte = (v: number): number => Math.round(255 * Math.min(1, Math.max(0, v)));

/**
 * The layer `kind` for the state on screen. `log` is the run's log (conflict uses the battles,
 * raids and conquests of the last 50 years up to the year shown).
 */
export function mapLayer(s: SimState, kind: MapLayer, log: readonly LogEntry[]): Uint8Array {
  const n = s.width * s.height;
  const out = new Uint8Array(n);
  switch (kind) {
    case 'fireRisk':
    case 'floodRisk':
      return riskLayer(s, kind);
    case 'population': {
      // Each group's people spread over its home range; the square root keeps small bands visible.
      const dens = new Float32Array(n);
      for (const g of s.groups) {
        const range = homeRange(s, g);
        if (range.length === 0) continue;
        const per = population(g) / range.length;
        for (const i of range) dens[i] = dens[i]! + per;
      }
      for (let i = 0; i < n; i++) if (dens[i]! > 0) out[i] = Math.max(1, byte(Math.sqrt(dens[i]! / HL.populationFull)));
      return out;
    }
    case 'food': {
      // Wild food on the tile now: plants, plus prey at its hunting value.
      const prey = s.animal[Species.Prey];
      for (let i = 0; i < n; i++) {
        if (!land(s, i)) continue;
        out[i] = byte((s.plantFood[i]! + prey[i]! * CONFIG.people.food.huntYield) / HL.foodFull);
      }
      return out;
    }
    case 'era': {
      // The highest era of any group whose range covers the tile (0 = no one there).
      for (const g of s.groups) {
        const v = Math.max(1, byte((g.era + 1) / (ERAS + 1)));
        for (const i of homeRange(s, g)) if (v > out[i]!) out[i] = v;
      }
      return out;
    }
    case 'conflict': {
      // Battles, raids and conquests of the last 50 years, each spread over a radius of 6 tiles.
      const R = CONFIG.people.range.forage;
      const count = new Float32Array(n);
      for (const e of log) {
        if (e.year > s.year || e.year <= s.year - HL.conflictYears || e.x === null || e.y === null) continue;
        // C4: conquests that made a tributary, submissions and revolts are fighting too.
        const realmFight = e.type === 'realm' && /conquered|submitted|rebelled/.test(e.text);
        if (e.type !== 'war' && e.type !== 'raid' && e.type !== 'conquered' && !realmFight) continue;
        for (let y = Math.max(0, e.y - R); y <= Math.min(s.height - 1, e.y + R); y++) {
          for (let x = Math.max(0, e.x - R); x <= Math.min(s.width - 1, e.x + R); x++) {
            if ((x - e.x) ** 2 + (y - e.y) ** 2 <= R * R) count[y * s.width + x] = count[y * s.width + x]! + 1;
          }
        }
      }
      for (let i = 0; i < n; i++) if (count[i]! > 0) out[i] = Math.max(1, byte(count[i]! / HL.conflictFull));
      return out;
    }
    case 'fertility':
      // Worn soil: 0 = fresh land (nothing drawn), 255 = no fertility left.
      for (let i = 0; i < n; i++) if (land(s, i) && s.fertility[i]! < 1) out[i] = Math.max(1, byte(1 - s.fertility[i]!));
      return out;
    case 'salinity':
      for (let i = 0; i < n; i++) if (s.salinity[i]! > 0) out[i] = Math.max(1, byte(s.salinity[i]!));
      return out;
    case 'territory':
      return territory(s, out);
  }
}

/**
 * Territory fills: every tile in a group's home range gets its lineage's colour index + 1; where
 * ranges overlap, the nearest home wins (ties → the lower group id). 0 = nobody's land.
 */
function territory(s: SimState, out: Uint8Array): Uint8Array {
  const best = new Float64Array(out.length).fill(Infinity);
  const colour = new Map(s.lineages.map((l) => [l.id, l.colorIndex]));
  for (const g of s.groups) {
    const c = (colour.get(g.lineageId) ?? 0) + 1;
    for (const i of homeRange(s, g)) {
      const x = i % s.width;
      const d = (x - g.homeX) ** 2 + ((i - x) / s.width - g.homeY) ** 2;
      if (d < best[i]!) { best[i] = d; out[i] = c; }
    }
  }
  return out;
}
