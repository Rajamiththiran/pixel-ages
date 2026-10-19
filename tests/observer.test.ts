// F7 — observer tools and intervention mode (future blueprint §13).

import { describe, expect, it } from 'vitest';
import { createMap } from '../src/editor/mapState';
import { Plant, WallType } from '../src/shared/ids';
import { Discovery, has } from '../src/shared/discoveries';
import type { LogEntry, RunSetup } from '../src/shared/types';
import { STAT_COLUMNS, csvField, logCsv, statsCsv } from '../src/shared/csv';
import { decodeRun, encodeRun } from '../src/shared/save';
import { createState } from '../src/sim/state';
import { runTicks } from '../src/sim/tick';
import { cloneState, hashState } from '../src/sim/serialize';
import { mapLayer } from '../src/sim/layers';
import { floodArea } from '../src/sim/interventions';
import { observe, startStory, storyView } from '../src/sim/story';
import { at, fourPeople, runOf, scenarioA } from './fixtures';

function forestRun(): RunSetup {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  m.rain.fill(30);
  for (let y = 0; y < 90; y++) m.wall[at(100, y)] = WallType.River;
  const run = runOf(m, 3);
  run.founders = [
    { id: 1, name: 'Oak', colorIndex: 0, x: 40, y: 40, people: fourPeople() },
    { id: 2, name: 'Ash', colorIndex: 1, x: 70, y: 40, people: fourPeople() },
  ];
  return run;
}

describe('CSV export', () => {
  it('the graph CSV has one column per YearStats field, in that order', () => {
    const s = createState(scenarioA(1));
    runTicks(s, 3 * 12);
    const row = s.stats[0]!.perLineage[0]!;
    expect([...STAT_COLUMNS].sort()).toEqual(Object.keys(row).sort());
    const csv = statsCsv(s.stats, () => 'Garden').trim().split('\n');
    expect(csv[0]).toBe(`year,lineage,${STAT_COLUMNS.join(',')},discoveryNames`);
    expect(csv).toHaveLength(1 + s.stats.length);
    const cells = csv[1]!.split(',');
    expect(cells[0]).toBe(String(s.stats[0]!.year));
    expect(cells[1]).toBe('Garden');
    expect(Number(cells[2 + STAT_COLUMNS.indexOf('population')])).toBe(row.population);
  });

  it('log CSV quotes text with commas and quotes', () => {
    const e: LogEntry = { year: 3, month: 0, type: 'war', groupId: 1, otherId: 2, lineageId: 1, text: 'A beat B, "badly"', x: 4, y: 5 };
    expect(logCsv([e]).split('\n')[1]).toBe('3,1,war,1,2,1,4,5,"A beat B, ""badly"""');
    expect(csvField(null)).toBe('');
    expect(csvField(0.5)).toBe('0.5000');
  });
});

describe('intervention mode (D5)', () => {
  const withInterventions = (): RunSetup => {
    const run = forestRun();
    run.interventionMode = true;
    run.interventions = [
      { kind: 'fire', year: 2, month: 4, at: { x: 55, y: 40 } },
      { kind: 'flood', year: 3, month: 1, at: { x: 40, y: 40 } },
      { kind: 'gift', year: 4, month: 0, groupId: 1, discovery: Discovery.fire },
      { kind: 'move', year: 5, month: 6, groupId: 2, to: { x: 80, y: 20 } },
    ];
    return run;
  };

  it('each intervention happens at its month and is logged', () => {
    const s = createState(withInterventions());
    runTicks(s, 6 * 12);
    const lines = s.log.filter((e) => e.type === 'intervention').map((e) => `${e.year}/${e.month} ${e.text}`);
    expect(lines[0]).toMatch(/^2\/4 Intervention: a fire at \(55, 40\) burned \d+ km²$/);
    expect(lines[1]).toMatch(/^3\/1 Intervention: a flood at \(40, 40\) covered \d+ km²$/);
    expect(lines.some((l) => l.startsWith('4/0 Intervention: Oak was given Fire') || l.startsWith('4/0 Intervention: Oak'))).toBe(true);
    expect(has(s.groups.find((g) => g.id === 1)!.discoveries, Discovery.fire)).toBe(true);
    const ash = s.groups.find((g) => g.id === 2);
    if (ash) expect([ash.homeX, ash.homeY]).toEqual([80, 20]);
  });

  it('a run with interventions replays identically, from the start and from a keyframe', () => {
    const a = createState(withInterventions());
    runTicks(a, 8 * 12);
    const b = createState(withInterventions());
    runTicks(b, 3 * 12);
    const kf = cloneState(b);
    runTicks(b, 5 * 12);
    const c = cloneState(kf);
    runTicks(c, 5 * 12);
    expect(hashState(b)).toBe(hashState(a));
    expect(hashState(c)).toBe(hashState(a));
  });

  it('run files keep interventions; hands-off files stay as they were', () => {
    const back = decodeRun(encodeRun(withInterventions()));
    expect(back.interventionMode).toBe(true);
    expect(back.interventions).toHaveLength(4);
    const plain = forestRun();
    const text = encodeRun(plain);
    expect(text.includes('intervention')).toBe(false);
    expect(decodeRun(text).interventionMode).toBeUndefined();
  });

  it('a flood off any floodplain covers the low land within 3 tiles', () => {
    const s = createState(forestRun());
    const tiles = floodArea(s, 40, 40);
    expect(tiles.length).toBe(29);                       // radius 3 disk, all flat land
    expect(tiles).toContain(at(40, 40));
  });
});

describe('compare two runs', () => {
  it('a run compared with itself gives identical graph lines', () => {
    const a = createState(scenarioA(7));
    const b = createState(scenarioA(7));
    runTicks(a, 60 * 12);
    runTicks(b, 60 * 12);
    expect(JSON.stringify(b.stats)).toBe(JSON.stringify(a.stats));
    const other = createState(scenarioA(8));
    runTicks(other, 60 * 12);
    expect(JSON.stringify(other.stats)).not.toBe(JSON.stringify(a.stats));
  });
});

describe('heatmaps and territory', () => {
  it('population, era and territory light up the groups\' ranges only', () => {
    const s = createState(forestRun());
    const pop = mapLayer(s, 'population', []);
    expect(pop[at(40, 40)]).toBeGreaterThan(0);
    expect(pop[at(10, 80)]).toBe(0);
    const era = mapLayer(s, 'era', []);
    expect(era[at(40, 40)]).toBeGreaterThan(0);
    const terr = mapLayer(s, 'territory', []);
    expect(terr[at(40, 40)]).toBe(1);                    // Oak: colour 0 + 1
    expect(terr[at(70, 40)]).toBe(2);                    // Ash: colour 1 + 1
    expect(terr[at(10, 80)]).toBe(0);
  });

  it('conflict counts battles of the last 50 years near where they happened', () => {
    const s = createState(forestRun());
    s.year = 100;
    const war = (year: number): LogEntry => ({ year, month: 0, type: 'war', groupId: 1, otherId: 2, lineageId: 1, text: '', x: 50, y: 40 });
    const layer = mapLayer(s, 'conflict', [war(90), war(95), war(40)]);
    expect(layer[at(50, 40)]).toBe(Math.round((255 * 2) / 5));
    expect(layer[at(10, 10)]).toBe(0);
  });

  it('worn soil and salt show only where they are', () => {
    const s = createState(forestRun());
    s.fertility[at(5, 5)] = 0.5;
    s.salinity[at(6, 6)] = 0.25;
    expect(mapLayer(s, 'fertility', [])[at(5, 5)]).toBe(128);
    expect(mapLayer(s, 'fertility', [])[at(7, 7)]).toBe(0);
    expect(mapLayer(s, 'salinity', [])[at(6, 6)]).toBe(64);
  });
});

describe('family tree and life story', () => {
  it('records pairing, children and the end of a followed founder', () => {
    const s = createState(scenarioA(2));
    const p = s.persons;
    const woman = s.groups[0]!.members.find((slot) => p.sex[slot] === 1)!;
    const id = p.id[woman]!;
    const rec = startStory(s, id)!;
    expect(rec.events[0]!.text).toBe('Born (a founder)');
    let ticks = 0;
    while (rec.alive && ticks < 120 * 12) { runTicks(s, 1); observe(rec, s); ticks++; }
    const texts = rec.events.map((e) => e.text);
    expect(texts.some((t) => t.startsWith('Paired with #'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Child #'))).toBe(true);
    expect(rec.alive).toBe(false);
    expect(texts.at(-1)).toMatch(/^Died \(|grew into a village/);
    const view = storyView(rec, s);
    expect(view.family.filter((f) => f.role === 'Child').length).toBe(rec.children.length);
  }, 60000);

  it('following someone never changes the run', () => {
    const a = createState(scenarioA(2));
    const b = createState(scenarioA(2));
    const rec = startStory(b, b.persons.id[b.groups[0]!.members[0]!]!)!;
    for (let k = 0; k < 30 * 12; k++) { runTicks(a, 1); runTicks(b, 1); observe(rec, b); }
    expect(hashState(b)).toBe(hashState(a));
  });
});
