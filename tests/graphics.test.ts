// F8 — graphics and sound (future blueprint §14). Pure parts only: the test runner has no canvas.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Action, Hazard } from '../src/shared/ids';
import { Discovery, DISCOVERIES } from '../src/shared/discoveries';
import { Look, PERSON_FLOATS, TILE_BYTES, lookLevel, packTile, unpackTile } from '../src/shared/protocol';
import type { LogEntry, LogType } from '../src/shared/types';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { hashState } from '../src/sim/serialize';
import { computeLook, groupViews, packPeople } from '../src/sim/view';
import { Farmed } from '../src/sim/people/farming';
import { SPRITES } from '../src/render/spriteData';
import { seasonWeights, classTint, TintClass } from '../src/render/season';
import { darknessAt } from '../src/render/light';
import { encodeGif, lzwEncode, quantize } from '../src/render/gif';
import { GLYPHS, GLYPH_H, buildPixelFont, textWidth } from '../src/render/pixelFont';
import { discoveryIcon, logIcon, ERA_ICONS, EVENT_ICONS } from '../src/render/icons';
import { StoryDirector, isBigMoment } from '../src/render/storyCam';
import { Camera } from '../src/render/camera';
import { cloudNoise } from '../src/render/weather';
import { scenarioA } from './fixtures';

const RENDER = import.meta.glob('../src/render/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('rendering never touches the simulation (§14 tests)', () => {
  it('files under src/render import only shared/, config and other render files', () => {
    expect(Object.keys(RENDER).length).toBeGreaterThan(10);
    for (const [path, src] of Object.entries(RENDER)) {
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1]!;
        const ok = spec.startsWith('./') || spec.startsWith('../shared/') || spec === '../config';
        expect(ok, `${path} imports ${spec}`).toBe(true);
      }
    }
  });
});

describe('frame data for F8', () => {
  it('tiles pack 10 bytes and the look byte survives the round trip', () => {
    expect(TILE_BYTES).toBe(10);
    const n = 4;
    const t = { ground: new Uint8Array(n), plantType: new Uint8Array(n), plantDensity: new Uint8Array(n), resourceType: new Uint8Array(n), resourceAmount: new Uint8Array(n), wall: new Uint8Array(n) };
    const look = Uint8Array.from([0, 0, 0b0110_1101, 0]);
    const out = new Uint8Array(TILE_BYTES);
    packTile(t, new Uint8Array(n), new Uint8Array(n), null, null, look, 2, out, 0);
    const back = new Uint8Array(n);
    unpackTile(out, 0, { ...t }, new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), back, 2);
    expect(back[2]).toBe(0b0110_1101);
    expect(lookLevel(back[2]!, Look.wornShift)).toBe(1);
    expect(lookLevel(back[2]!, Look.saltShift)).toBe(3);
    expect(lookLevel(back[2]!, Look.ashShift)).toBe(2);
    expect(back[2]! & Look.Silt).toBe(Look.Silt);
  });

  it('the look byte: worn soil, salt, ash stage and silt, by the config thresholds', () => {
    const s = createState(scenarioA(1));
    const T = CONFIG.render.f8.look;
    s.fertility[0] = T.wornBelow[0] - 0.01;          // worn 1
    s.fertility[1] = T.wornBelow[2] - 0.01;          // worn 3
    s.salinity[2] = T.saltAbove[1] + 0.01;           // salt 2
    s.ash[3] = 2;                                     // fresh ash
    s.ash[4] = 7;                                     // capped at 3
    s.farmedThisYear[5] = Farmed.Flooded;            // flooded, water gone → silt
    s.farmedThisYear[6] = Farmed.Flooded;
    s.floodMonths[6] = 1;                            // still under water → no silt yet
    const look = computeLook(s, new Uint8Array(s.width * s.height));
    expect(lookLevel(look[0]!, Look.wornShift)).toBe(1);
    expect(lookLevel(look[1]!, Look.wornShift)).toBe(3);
    expect(lookLevel(look[2]!, Look.saltShift)).toBe(2);
    expect(lookLevel(look[3]!, Look.ashShift)).toBe(2);
    expect(lookLevel(look[4]!, Look.ashShift)).toBe(3);
    expect(look[5]! & Look.Silt).toBe(Look.Silt);
    expect(look[6]! & Look.Silt).toBe(0);
    expect(look[7]).toBe(0);
  });

  it('people carry their group id; groups carry walls, chief and sickness', () => {
    const s = createState(scenarioA(1));
    runTicks(s, 12);
    const p = packPeople(s);
    expect(p.length % PERSON_FLOATS).toBe(0);
    const gids = new Set(s.groups.map((g) => g.id));
    for (let o = 0; o < p.length; o += PERSON_FLOATS) expect(gids.has(p[o + 8]!)).toBe(true);
    const g = s.groups[0]!;
    g.fortification = 2;
    g.chief = true;
    s.hazardsActive.push({ kind: Hazard.Outbreak, groupId: g.id, endYear: s.year + 1 });
    const v = groupViews(s).find((x) => x.id === g.id)!;
    expect([v.fortification, v.chief, v.sick]).toEqual([2, true, true]);
  });

  it('building the frame views never changes the run', () => {
    const a = createState(scenarioA(4));
    const b = createState(scenarioA(4));
    for (let y = 0; y < 20; y++) {
      runTicks(a, 12);
      runTicks(b, 12);
      packPeople(a); groupViews(a); computeLook(a, new Uint8Array(a.width * a.height));
    }
    expect(hashState(a)).toBe(hashState(b));
  });
});

describe('seasons and day', () => {
  it('season weights sum to 1 and peak in the middle month of each season', () => {
    for (let m = 0; m < 12; m += 0.25) {
      const w = seasonWeights(m);
      expect(w[0]! + w[1]! + w[2]! + w[3]!).toBeCloseTo(1, 9);
    }
    expect([...seasonWeights(1)]).toEqual([1, 0, 0, 0]);
    expect([...seasonWeights(10)]).toEqual([0, 0, 0, 1]);
    const between = seasonWeights(2.5);
    expect(between[0]).toBeCloseTo(0.5);
    expect(between[1]).toBeCloseTo(0.5);
    // Winter wraps round to January.
    expect(seasonWeights(11.5)[3]).toBeCloseTo(0.5);
    expect(seasonWeights(11.5)[0]).toBeCloseTo(0.5);
  });

  it('a class tint is the weighted mix of the season tints', () => {
    const S = CONFIG.render.f8.season;
    const t = classTint(TintClass.Cold, [0, 0, 0, 1], [0, 0, 0, 0]);
    expect(t[3]).toBeCloseTo(S.winter.cold[1]);
    const half = classTint(TintClass.Forest, [0, 0, 0.5, 0.5], [0, 0, 0, 0]);
    expect(half[3]).toBeCloseTo(0.5 * S.autumn.forest[1] + 0.5 * S.winter.forest[1]);
    expect(classTint(TintClass.None, [1, 0, 0, 0], [0, 0, 0, 0])[3]).toBe(0);
  });

  it('the day: light, dusk, night, dawn', () => {
    const L = CONFIG.render.f8.light;
    const dayEnd = 1 - L.nightShare - 2 * L.dusk;
    expect(darknessAt(0)).toBe(0);
    expect(darknessAt(dayEnd / 2)).toBe(0);
    expect(darknessAt(dayEnd + L.dusk / 2)).toBeCloseTo(0.5);
    expect(darknessAt(dayEnd + L.dusk + L.nightShare / 2)).toBe(1);
    expect(darknessAt(1 - L.dusk / 2)).toBeCloseTo(0.5);
    expect(darknessAt(1.25)).toBe(darknessAt(0.25));
  });

  it('cloud noise stays within 0–1 and changes smoothly', () => {
    let prev = cloudNoise(0, 3.3);
    for (let x = 0.05; x < 20; x += 0.05) {
      const v = cloudNoise(x, 3.3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.15);
      prev = v;
    }
  });
});

/** A GIF reader just for the test: global palette and each frame's indices. */
function readGif(b: Uint8Array): { w: number; h: number; palette: Uint8Array; frames: Uint8Array[] } {
  const u16 = (o: number): number => b[o]! | (b[o + 1]! << 8);
  expect(String.fromCharCode(...b.slice(0, 6))).toBe('GIF89a');
  const w = u16(6), h = u16(8);
  const palette = b.slice(13, 13 + 768);
  let o = 13 + 768;
  const frames: Uint8Array[] = [];
  while (b[o] !== 0x3b) {
    if (b[o] === 0x21) { o += 2; while (b[o]! > 0) o += b[o]! + 1; o++; continue; }
    expect(b[o]).toBe(0x2c);
    o += 10;
    const min = b[o++]!;
    const data: number[] = [];
    while (b[o]! > 0) { const n = b[o]!; data.push(...b.slice(o + 1, o + 1 + n)); o += n + 1; }
    o++;
    frames.push(lzwDecode(Uint8Array.from(data), min, w * h));
  }
  return { w, h, palette, frames };
}

function lzwDecode(data: Uint8Array, min: number, count: number): Uint8Array {
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, dict: number[][] = [], prev: number[] | null = null;
  const reset = (): void => { dict = []; for (let k = 0; k < clear; k++) dict[k] = [k]; dict[clear] = []; dict[eoi] = []; size = min + 1; prev = null; };
  reset();
  const out: number[] = [];
  let bit = 0;
  const read = (): number => {
    let v = 0;
    for (let k = 0; k < size; k++, bit++) v |= ((data[bit >> 3]! >> (bit & 7)) & 1) << k;
    return v;
  };
  for (;;) {
    const code = read();
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code]!;
    else entry = [...prev!, prev![0]!];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]!]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  expect(out.length).toBe(count);
  return Uint8Array.from(out);
}

describe('GIF export', () => {
  it('two frames decode back to the same pixels', () => {
    const w = 40, h = 30;
    const frames = [0, 1].map((f) => {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const c = ((i % w) + Math.floor(i / w) * 3 + f * 7) % 5;
        d[i * 4] = c * 60; d[i * 4 + 1] = 255 - c * 50; d[i * 4 + 2] = c * 20; d[i * 4 + 3] = 255;
      }
      return d;
    });
    const { palette, indexed } = quantize(frames);
    const gif = encodeGif(indexed, w, h, palette, 10);
    expect(gif[gif.length - 1]).toBe(0x3b);
    const back = readGif(gif);
    expect([back.w, back.h]).toEqual([w, h]);
    expect(back.frames).toHaveLength(2);
    back.frames.forEach((f, k) => expect(Array.from(f)).toEqual(Array.from(indexed[k]!)));
    // Five colours, each exactly in the palette (5 bits per channel keeps these exact).
    for (let i = 0; i < 5; i++) {
      const idx = indexed[0]![i]!;
      expect(Math.abs(back.palette[idx * 3]! - frames[0]![i * 4]!)).toBeLessThanOrEqual(7);
    }
  });

  it('LZW handles a long image that fills the 4,096-code table (clear codes)', () => {
    const n = 200_000;
    const px = new Uint8Array(n);
    let x = 12345;
    for (let k = 0; k < n; k++) { x = (x * 1103515245 + 12345) >>> 0; px[k] = (x >>> 16) & 15; }
    const enc = lzwEncode(px, 8);
    expect(Array.from(lzwDecode(enc, 8, n))).toEqual(Array.from(px));
  });
});

describe('sprites and icons', () => {
  it('every discovery, era, event and log type has a drawn icon', () => {
    for (const d of DISCOVERIES) expect(SPRITES[`icon_${discoveryIcon(d.id)}`], d.name).toBeDefined();
    expect(discoveryIcon(Discovery.fire)).toBe('fire');
    for (const i of ERA_ICONS) expect(SPRITES[`icon_${i}`]).toBeDefined();
    for (const i of Object.values(EVENT_ICONS)) expect(SPRITES[`icon_${i}`]).toBeDefined();
    const types: LogType[] = ['discovery', 'lostDiscovery', 'eraUp', 'eraDown', 'ranOut', 'split', 'migrate', 'becameVillage', 'becameBand',
      'firstContact', 'tradeStart', 'war', 'conquered', 'absorbed', 'raid', 'alliance', 'society', 'breach', 'event', 'intervention',
      'animalsGone', 'hazard', 'groupExtinct', 'lineageExtinct', 'cannotReproduce', 'perf'];
    for (const type of types) {
      const e: LogEntry = { year: 1, month: 0, type, groupId: 1, otherId: null, lineageId: 1, text: 'Red discovered Copper Working', x: 1, y: 1 };
      expect(SPRITES[`icon_${logIcon(e)}`], type).toBeDefined();
    }
    expect(logIcon({ year: 1, month: 0, type: 'discovery', groupId: 1, otherId: null, lineageId: 1, text: 'Red discovered Copper Working', x: 1, y: 1 })).toBe('metal');
    expect(logIcon({ year: 1, month: 0, type: 'eraUp', groupId: 1, otherId: null, lineageId: 1, text: 'Red reached era 3: Farmers', x: 1, y: 1 })).toBe('wheat');
  });

  it('work poses exist for every action that has one', () => {
    for (const pose of ['gather', 'farm', 'cut', 'fish', 'build']) for (const f of [1, 2]) expect(SPRITES[`${pose}_${f}`]).toBeDefined();
    expect(Action.CutWood).toBeGreaterThan(0);
  });
});

describe('pixel font', () => {
  it('every glyph is 7 rows of one width', () => {
    for (const [ch, rows] of Object.entries(GLYPHS)) {
      expect(rows.length, ch).toBe(GLYPH_H);
      for (const r of rows) expect(r.length, ch).toBe(rows[0]!.length);
      for (const r of rows) expect(/^[#.]+$/.test(r), ch).toBe(true);
    }
    expect(textWidth('AB')).toBe(11);
    expect(textWidth('ab')).toBe(11);   // lower case is drawn as capitals
  });

  it('the TrueType font is well formed: sorted tables, checksums, glyph count, cmap', () => {
    const f = buildPixelFont();
    const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
    expect(v.getUint32(0)).toBe(0x00010000);
    const numTables = v.getUint16(4);
    const tables = new Map<string, { off: number; len: number; sum: number }>();
    let prevTag = '';
    for (let k = 0; k < numTables; k++) {
      const o = 12 + k * 16;
      const tag = String.fromCharCode(f[o]!, f[o + 1]!, f[o + 2]!, f[o + 3]!);
      expect(tag > prevTag).toBe(true);
      prevTag = tag;
      tables.set(tag, { off: v.getUint32(o + 8), len: v.getUint32(o + 12), sum: v.getUint32(o + 4) });
    }
    for (const t of ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']) expect(tables.has(t), t).toBe(true);
    const sumOf = (off: number, len: number, skipAdj = -1): number => {
      let s = 0;
      for (let k = 0; k < len; k += 4) {
        if (off + k === skipAdj) continue;
        s = (s + (((f[off + k] ?? 0) << 24) >>> 0) + ((f[off + k + 1] ?? 0) << 16) + ((f[off + k + 2] ?? 0) << 8) + (f[off + k + 3] ?? 0)) >>> 0;
      }
      return s;
    };
    const head = tables.get('head')!;
    for (const [tag, t] of tables) {
      const pad = Math.ceil(t.len / 4) * 4;
      expect(sumOf(t.off, Math.min(pad, f.length - t.off), tag === 'head' ? head.off + 8 : -1), tag).toBe(t.sum);
    }
    // The whole font sums to the magic number once head.checkSumAdjustment is in.
    expect(sumOf(0, f.length)).toBe(0xb1b0afba);
    const maxp = tables.get('maxp')!;
    expect(v.getUint16(maxp.off + 4)).toBe(Object.keys(GLYPHS).length + 1);
    expect(v.getUint32(head.off + 12)).toBe(0x5f0f3cf5);
    expect(v.getUint16(head.off + 18)).toBe(1000);
  });
});

describe('story mode', () => {
  const entry = (type: LogType, text = '', year = 1): LogEntry => ({ year, month: 0, type, groupId: 1, otherId: null, lineageId: 1, text, x: 3, y: 4 });

  it('picks big moments: contact, wars, new eras, deadly disasters', () => {
    expect(isBigMoment(entry('firstContact'))).toBe(true);
    expect(isBigMoment(entry('war'))).toBe(true);
    expect(isBigMoment(entry('eraUp'))).toBe(true);
    expect(isBigMoment(entry('discovery'))).toBe(false);
    expect(isBigMoment(entry('hazard', 'The river flooded Red’s fields and homes (12 drowned)'))).toBe(true);
    expect(isBigMoment(entry('hazard', 'A fire burned 3 km² (2 died)'))).toBe(false);
    expect(isBigMoment({ ...entry('war'), x: null, y: null })).toBe(false);
  });

  it('shows each moment for holdMs, newest few kept, and waits after the owner acts', () => {
    const ST = CONFIG.render.f8.story;
    const d = new StoryDirector();
    d.push([entry('war')]);
    expect(d.update(0)).toBeNull();                 // off: ignores everything
    d.on = true;
    for (let k = 0; k < ST.queueMax + 3; k++) d.push([entry('war', `war ${k}`)]);
    const first = d.update(0)!;
    expect(first.fresh).toBe(true);
    expect(first.entry.text).toBe('war 3');         // the oldest were dropped
    expect(d.update(ST.holdMs - 1)!.fresh).toBe(false);
    d.userActed(ST.holdMs - 1);
    expect(d.update(ST.holdMs + 1)).toBeNull();      // the owner is looking around
    expect(d.update(ST.holdMs + ST.idleAfterInputMs)!.entry.text).toBe('war 4');
  });
});

describe('camera', () => {
  it('cycles 1× → 2× → 4× → 1× and eases there, then sits on whole screen pixels', () => {
    const c = new Camera(1280, 720);
    c.toggle(640, 360);
    expect(c.targetZoom).toBe(2);
    for (let k = 0; k < 200; k++) c.update(16);
    expect(c.zoom).toBe(2);
    expect(c.viewW).toBe(640);
    expect((c.ox * c.zoom) % 1).toBe(0);
    c.toggle(640, 360);
    expect(c.targetZoom).toBe(4);
    c.toggle(640, 360);
    expect(c.targetZoom).toBe(1);
  });

  it('the wheel zooms around the cursor and the view never leaves the map', () => {
    const c = new Camera(1280, 720);
    c.wheel(-1, 300, 200);
    for (let k = 0; k < 200; k++) c.update(16);
    // The point under the cursor stays put: (300 − ox) × zoom = 300 at 1×.
    expect((300 - c.ox) * c.zoom).toBeCloseTo(300, 0);
    expect((200 - c.oy) * c.zoom).toBeCloseTo(200, 0);
    c.pan(-5000, -5000);
    expect([c.ox, c.oy]).toEqual([0, 0]);
    c.pan(9000, 9000);
    expect(c.ox).toBe(1280 - c.viewW);
    expect(c.oy).toBe(720 - c.viewH);
  });

  it('follows a point, zooming in if needed', () => {
    const c = new Camera(1280, 720);
    c.follow = { x: 1000, y: 500 };
    for (let k = 0; k < 400; k++) c.update(16);
    expect(c.zoom).toBe(2);
    expect(c.ox + c.viewW / 2).toBeCloseTo(960, 0);  // as near as the map edge allows
  });
});

