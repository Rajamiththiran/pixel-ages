// Perfection pass, step 2 (DECISIONS 20.4–20.11): kin peace, absorb only the failing, wars that
// end in a truce, lasting alliances, and a log that tells each story once. Tiny worlds, seconds.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createMap } from '../src/editor/mapState';
import { Hazard, Plant } from '../src/shared/ids';
import { Discovery, addBit, maskOf } from '../src/shared/discoveries';
import type { FounderPerson } from '../src/shared/types';
import { createState, type Group, type SimState } from '../src/sim/state';
import { logQuiet, population } from '../src/sim/people/groups';
import { decisionScores, kinship, updateAlliances, contactPairs, yearlyContact } from '../src/sim/society/contact';
import { warPressure } from '../src/sim/society/walls';
import { strike } from '../src/sim/world/hazards';
import { runOf } from './fixtures';

const C = CONFIG.contact;

function adults(n: number, strength = 50): FounderPerson[] {
  return Array.from({ length: n }, (_, k) => ({ sex: (k % 2) as 0 | 1, age: 20 + (k % 20), intelligence: 100, cooperation: 50, strength }));
}

/** Groups on forest land at the given homes, named G1, G2, … */
function world(homes: Array<{ x: number; y: number; people: FounderPerson[] }>): SimState {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  const run = runOf(m, 4);
  run.founders = homes.map((h, k) => ({ id: k + 1, name: `G${k + 1}`, colorIndex: k, x: h.x, y: h.y, people: h.people }));
  return createState(run);
}
const G = (s: SimState, id: number): Group => s.groups.find((g) => g.id === id)!;

const base = {
  coopA: 50, coopB: 50, sameLineage: true, pA: 0.6, pB: 0.6, hA: 10, hB: 10,
  powerA: 40, powerB: 10, discoveriesDiffer: false,
};

describe('deciding (DECISIONS 20.4–20.6)', () => {
  it('close kin are less likely to fight; a truce rules war out', () => {
    const free = decisionScores(base).war!;
    expect(decisionScores({ ...base, kin: 1 }).war).toBeCloseTo(free - C.kinWarPenalty);
    expect(decisionScores({ ...base, kin: 0.5 }).war).toBeCloseTo(free - C.kinWarPenalty / 2);
    expect(decisionScores({ ...base, truce: true }).war).toBeNull();
  });

  it('a stronger group absorbs a weaker one only if the weaker is failing', () => {
    expect(decisionScores({ ...base, weakFailing: false }).absorb).toBeNull();
    expect(decisionScores({ ...base, weakFailing: true }).absorb).not.toBeNull();
  });

  it('kinship: parent and daughter, or sisters, fade over kinFadeYears; others are not close kin', () => {
    const s = world([{ x: 40, y: 40, people: adults(10) }, { x: 50, y: 40, people: adults(10) }, { x: 45, y: 48, people: adults(10) }]);
    const [mother, daughter, sister] = [G(s, 1), G(s, 2), G(s, 3)];
    daughter.parentId = 1;
    sister.parentId = 1;
    daughter.languageId = sister.languageId = mother.languageId;   // split-off groups speak the mother's language
    s.year = 10;
    daughter.foundedYear = 10;
    sister.foundedYear = 10;
    expect(kinship(s, mother, daughter)).toBe(1);
    expect(kinship(s, daughter, sister)).toBe(1);
    s.year = 10 + C.kinFadeYears / 2;
    expect(kinship(s, mother, daughter)).toBeCloseTo(0.5);
    s.year = 10 + C.kinFadeYears;
    expect(kinship(s, mother, daughter)).toBe(0);
    sister.parentId = -1;
    s.year = 10;
    expect(kinship(s, daughter, sister)).toBe(0);
  });

  it('a stopped skill pushes to war only against a neighbour who has it working', () => {
    const s = world([{ x: 40, y: 40, people: adults(10) }, { x: 50, y: 40, people: adults(10) }]);
    const [a, b] = [G(s, 1), G(s, 2)];
    a.hunger = 0; a.crowding = 0; b.hunger = 0; b.crowding = 0;
    addBit(a.discoveries, Discovery.pottery);
    addBit(a.inactive, Discovery.pottery);
    expect(warPressure(a, b)).toBe(0);                      // nobody nearby has it
    addBit(b.discoveries, Discovery.pottery);
    expect(warPressure(a, b)).toBe(CONFIG.walls.inactivePressure);
    a.hunger = 90;
    expect(warPressure(a, b)).toBeCloseTo(0.9);            // hunger still counts in full
  });
});

describe('wars end (DECISIONS 20.6)', () => {
  it('a war ends in peace and a truce within warMaxYears, and is logged as one story', () => {
    const s = world([{ x: 40, y: 40, people: adults(30) }, { x: 50, y: 40, people: adults(30) }]);
    const [a, b] = [G(s, 1), G(s, 2)];
    s.relations = [{ a: 1, b: 2, kind: 'war', sinceYear: 0, reviewYear: 99, pa: 0, pb: 0,
      warPopA: population(a), warPopB: population(b), warDeadA: 0, warDeadB: 0, truceUntil: 0 }];
    let peaceYear = -1;
    for (let y = 0; y < C.warMaxYears + 1 && peaceYear < 0; y++) {
      s.year = y;
      yearlyContact(s);
      const r = s.relations[0];
      if (!r || s.groups.length < 2) break;                // conquered: also an end
      if (r.kind !== 'war') peaceYear = y;
    }
    if (s.groups.length === 2) {
      expect(peaceYear).toBeGreaterThanOrEqual(0);
      expect(peaceYear).toBeLessThan(C.warMaxYears);
      expect(s.relations[0]!.truceUntil).toBe(peaceYear + C.truceYears);
      expect(s.log.some((e) => /^G1 and G2 made peace after \d+ years? of war/.test(e.text) && !e.minor)).toBe(true);
    }
    // Battles are small events; the war's end is a big one.
    expect(s.log.filter((e) => / beat /.test(e.text)).every((e) => e.minor)).toBe(true);
  });
});

describe('the log tells each story once (DECISIONS 20.8–20.9)', () => {
  it('logQuiet: the same key is logged again only after `years`; small unless told otherwise', () => {
    const s = world([{ x: 40, y: 40, people: adults(4) }]);
    logQuiet(s, 'k', 10, 'ranOut', 'one');
    s.year = 9;
    logQuiet(s, 'k', 10, 'ranOut', 'two');
    s.year = 10;
    logQuiet(s, 'k', 10, 'ranOut', 'three', null, null, null, null, false);
    expect(s.log.map((e) => [e.text, e.minor ?? false])).toEqual([['one', true], ['three', false]]);
  });

  it('one line per alliance bloc, even when it holds against several enemies', () => {
    const s = world([
      { x: 40, y: 40, people: adults(10) }, { x: 48, y: 40, people: adults(10) },
      { x: 44, y: 46, people: adults(60) }, { x: 44, y: 34, people: adults(60) },
    ]);
    s.relations = [{ a: 1, b: 2, kind: 'coexist', sinceYear: 0, reviewYear: 99, pa: 0, pb: 0, warPopA: 0, warPopB: 0, warDeadA: 0, warDeadB: 0, truceUntil: 0 }];
    updateAlliances(s, contactPairs(s));
    expect(s.alliances.map((x) => x.against)).toEqual([3, 4]);
    const lines = s.log.filter((e) => e.type === 'alliance');
    expect(lines.map((e) => e.text)).toEqual(['G1 and G2 allied against G3']);
    // Next year, the same bloc: nothing new to say.
    s.year = 1;
    updateAlliances(s, contactPairs(s));
    expect(s.log.filter((e) => e.type === 'alliance')).toHaveLength(1);
  });

  it('disasters: deadly ones are big events; small ones once per group and hazard in hazardQuietYears', () => {
    const s = world([{ x: 40, y: 40, people: adults(10) }]);
    const g = G(s, 1);
    strike(s, g, Hazard.Blight, 'blight 1');
    strike(s, g, Hazard.Blight, 'blight 2');
    strike(s, g, Hazard.FlashFlood, 'flood', CONFIG.log.majorDead);
    strike(s, g, Hazard.FlashFlood, 'flood again', CONFIG.log.majorDead);
    s.year = CONFIG.log.hazardQuietYears;
    strike(s, g, Hazard.Blight, 'blight 3');
    expect(s.log.filter((e) => e.type === 'hazard').map((e) => [e.text, e.minor ?? false])).toEqual([
      ['blight 1', true], ['flood', false], ['flood again', false], ['blight 3', true],
    ]);
  });
});

void maskOf;
