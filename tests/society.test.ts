// F6 — society, conflict and animals (future blueprint §12.9). Hand-checked numbers from the §12 rules.

import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createMap } from '../src/editor/mapState';
import { Culture, Plant, Practice, Resource, WallType } from '../src/shared/ids';
import { Discovery, DISCOVERIES, maskOf } from '../src/shared/discoveries';
import type { FounderPerson } from '../src/shared/types';
import { createState, type Group, type SimState } from '../src/sim/state';
import { population } from '../src/sim/people/groups';
import { cloneState } from '../src/sim/serialize';
import { createRng } from '../src/shared/rng';
import { toVillage } from '../src/sim/people/village';
import { births } from '../src/sim/people/lifecycle';
import { spawnGroup, takeSlots } from '../src/sim/people/transfer';
import { payBuilding } from '../src/sim/people/wood';
import { discoveryChance } from '../src/sim/progress/discoveryRules';
import {
  battle, contactPairs, decisionScores, forceOf, raid, updateAlliances, yearlyContact,
} from '../src/sim/society/contact';
import {
  blendCulture, buildFortifications, craftMult, fortMult, inbreedMult, intermarry, languageDrift, learnMult, mixCulture,
  nextInequality, ploughMult, specialistShare, weaponMult, yearlySociety,
} from '../src/sim/society/society';
import { at, runOf } from './fixtures';

const FU = CONFIG.future;
const SO = FU.society;
const D = Discovery;

/** Restores any config numbers a test changed. */
const saved: Array<[Record<string, number>, string, number]> = [];
const force = (obj: object, key: string, v: number): void => {
  const o = obj as Record<string, number>;
  saved.push([o, key, o[key]!]);
  o[key] = v;
};
afterEach(() => { while (saved.length) { const [o, k, v] = saved.pop()!; o[k] = v; } });

function adults(n: number, age = 20, strength = 50): FounderPerson[] {
  return Array.from({ length: n }, (_, k) => ({ sex: (k % 2) as 0 | 1, age, intelligence: 100, cooperation: 50, strength }));
}

/** Forest land with stone; groups at the given homes (ids 1, 2, 3…), each its own lineage. */
function world(groups: Array<{ x: number; y: number; people: FounderPerson[] }>, edit?: (m: ReturnType<typeof createMap>) => void): SimState {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  edit?.(m);
  const run = runOf(m, 5);
  run.founders = groups.map((g, k) => ({ id: k + 1, name: `G${k + 1}`, colorIndex: k, x: g.x, y: g.y, people: g.people }));
  return createState(run);
}

const G = (s: SimState, id: number): Group => s.groups.find((g) => g.id === id)!;

describe('specialists (§12.1)', () => {
  it('min(0.15, 0.02 × months stored), only above 6 months and 150 people', () => {
    expect(specialistShare(6, 500)).toBe(0);
    expect(specialistShare(7, 500)).toBeCloseTo(0.14, 10);
    expect(specialistShare(10, 500)).toBeCloseTo(0.15, 10);
    expect(specialistShare(10, 149)).toBe(0);
  });

  it('each 1% gives +2% discovery chance and +2% tool and weapon quality', () => {
    const def = DISCOVERIES[D.farming]!;
    const x = { avgInt: 100, population: 400, fed12: 1, writing: false, teachBonus: 1 };
    expect(discoveryChance(def, { ...x, specialists: 0.1 }) / discoveryChance(def, x)).toBeCloseTo(1.2, 10);
    const s = world([{ x: 40, y: 40, people: adults(10) }]);
    const g = G(s, 1);
    const before = forceOf(s, g).power;
    g.specialists = 0.15;
    expect(craftMult(g)).toBeCloseTo(1.3, 10);
    expect(forceOf(s, g).power / before).toBeCloseTo(1.3, 10);
  });

  it('villages with a big store get specialists at the yearly step; bands never do', () => {
    const s = world([{ x: 40, y: 40, people: adults(200) }]);
    const g = G(s, 1);
    toVillage(s, g);
    g.storeMonthsSum = 12 * 7;                              // 7 months stored all year
    yearlySociety(s);
    expect(g.specialists).toBeCloseTo(0.14, 10);
  });
});

describe('chiefs and inequality (§12.2)', () => {
  it('a chief appears at 300+ people with a surplus and goes below 150', () => {
    const s = world([{ x: 40, y: 40, people: adults(320) }]);
    const g = G(s, 1);
    toVillage(s, g);
    g.storeMonthsSum = 12 * 8;
    yearlySociety(s);
    expect(g.chief).toBe(true);
    expect(s.log.some((e) => e.type === 'society' && e.text === 'G1 now has a chief')).toBe(true);
    g.village!.counts.fill(0);
    g.village!.counts[2] = 70;
    g.village!.counts[8] = 70;
    yearlySociety(s);
    expect(g.chief).toBe(false);
  });

  it('inequality grows with a chief and surplus and with wins, and falls with cooperation', () => {
    // (0 + 0.02) × (1 − 0.05 × 0.5)
    expect(nextInequality(0, true, true, 0, 50)).toBeCloseTo(0.02 * 0.95, 10);
    expect(nextInequality(0, false, true, 0, 50)).toBe(0);
    expect(nextInequality(0, false, false, 2, 0)).toBeCloseTo(0.1, 10);
    expect(nextInequality(0.5, false, false, 0, 100)).toBeCloseTo(0.5 * 0.9, 10);
    // With a chief and a steady surplus it settles at 0.02 × (1 − f) / f, f = 0.1 × coop/100.
    let v = 0;
    for (let k = 0; k < 2000; k++) v = nextInequality(v, true, true, 0, 80);
    expect(v).toBeCloseTo((0.02 * (1 - 0.08)) / 0.08, 3);
  });

  it('inequality makes war likelier and trade and absorbing less likely', () => {
    const base = { coopA: 50, coopB: 50, sameLineage: false, pA: 0.3, pB: 0.3, hA: 10, hB: 10, powerA: 90, powerB: 10, discoveriesDiffer: false };
    const eq = decisionScores(base);
    const uneq = decisionScores({ ...base, inequality: 1 });
    expect(uneq.war! - eq.war!).toBeCloseTo(5, 10);
    expect(eq.trade! - uneq.trade!).toBeCloseTo(5, 10);
    expect(eq.absorb! - uneq.absorb!).toBeCloseTo(5, 10);
  });
});

describe('marriage between groups and inbreeding (§12.3)', () => {
  it('intermarriage moves unpaired young adults both ways and ends isolation', () => {
    force(SO, 'marriageShare', 0.5);
    const s = world([{ x: 40, y: 40, people: adults(20) }, { x: 48, y: 40, people: adults(20) }]);
    const [a, b] = [G(s, 1), G(s, 2)];
    a.isolationYears = 300;
    b.isolationYears = 300;
    const idsA = new Set(a.members.map((slot) => s.persons.id[slot]));
    const moved = intermarry(s, a, b);
    expect(moved).toBeGreaterThan(0);
    expect(population(a) + population(b)).toBe(40);
    expect(b.members.some((slot) => idsA.has(s.persons.id[slot]!))).toBe(true);
    expect(a.members.some((slot) => !idsA.has(s.persons.id[slot]!))).toBe(true);
    expect(a.isolationYears).toBe(0);
    expect(b.isolationYears).toBe(0);
  });

  it('paired and older people stay home', () => {
    force(SO, 'marriageShare', 1);
    const s = world([{ x: 40, y: 40, people: adults(10, 40) }, { x: 48, y: 40, people: adults(10, 40) }]);
    expect(intermarry(s, G(s, 1), G(s, 2))).toBe(0);
  });

  it('villages exchange counts of young adults', () => {
    force(SO, 'marriageShare', 1);
    force(SO, 'villageUnpairedShare', 0.5);
    const s = world([{ x: 40, y: 40, people: adults(200) }, { x: 48, y: 40, people: adults(10) }]);
    const [v, band] = [G(s, 1), G(s, 2)];
    toVillage(s, v);
    const total = population(v) + population(band);
    expect(intermarry(s, v, band)).toBeGreaterThan(0);
    expect(population(v) + population(band)).toBe(total);
    expect(population(band)).toBeGreaterThan(10);
  });

  it('births × (1 − 0.3 × min(1, isolated years / 200)) only under 50 people', () => {
    const s = world([{ x: 40, y: 40, people: adults(4) }]);
    const g = G(s, 1);
    g.isolationYears = 100;
    expect(inbreedMult(g, 40)).toBeCloseTo(0.85, 10);
    g.isolationYears = 400;
    expect(inbreedMult(g, 40)).toBeCloseTo(0.7, 10);
    expect(inbreedMult(g, 50)).toBe(1);
  });

  it('an isolated tiny band has fewer births than a connected one', () => {
    const base = world([{ x: 40, y: 40, people: adults(10, 20) }]);
    const p0 = base.persons;
    const g0 = G(base, 1);
    for (let k = 0; k + 1 < g0.members.length; k += 2) {
      const [m, w] = [g0.members[k]!, g0.members[k + 1]!];
      p0.partnerId[m] = p0.id[w]!;
      p0.partnerId[w] = p0.id[m]!;
    }
    const count = (iso: number): number => {
      let n = 0;
      for (let seed = 0; seed < 1000; seed++) {
        const s = cloneState(base);
        s.rng.set(createRng(1000 + seed));
        const g = G(s, 1);
        g.isolationYears = iso;
        const before = g.members.length;
        births(s, g);
        n += g.members.length - before;
      }
      return n;
    };
    const free = count(0);
    const isolated = count(400);
    expect(isolated / free).toBeGreaterThan(0.55);
    expect(isolated / free).toBeLessThan(0.85);
  });
});

describe('culture and language (§12.4–12.5)', () => {
  it('splits copy culture with drift; neighbours blend 2% of the gap; newcomers mix in', () => {
    const s = world([{ x: 40, y: 40, people: adults(20) }]);
    const g = G(s, 1);
    g.culture.set([80, 20, 60]);
    const child = spawnGroup(s, g, takeSlots(g, g.members.slice(0, 8)), at(60, 40));
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(child.culture[k]! - g.culture[k]!)).toBeLessThan(5 * SO.cultureDrift);
    }
    expect(child.languageId).toBe(g.languageId);
    child.culture.set([0, 0, 0]);
    g.culture.set([100, 100, 100]);
    blendCulture(g, child);
    expect(g.culture[0]).toBeCloseTo(98, 4);
    expect(child.culture[0]).toBeCloseTo(2, 4);
    mixCulture(child, g, 0.25);
    expect(child.culture[1]).toBeCloseTo(2 + 0.25 * 96, 4);
  });

  it('warlike and open cultures lean to war and trade; open groups learn more', () => {
    const base = { coopA: 50, coopB: 50, sameLineage: false, pA: 0.3, pB: 0.3, hA: 10, hB: 10, powerA: 10, powerB: 10, discoveriesDiffer: false };
    expect(decisionScores({ ...base, warlike: 100 }).war! - decisionScores(base).war!).toBeCloseTo(20, 10);
    expect(decisionScores({ ...base, openness: 0 }).trade! - decisionScores(base).trade!).toBeCloseTo(-20, 10);
    const s = world([{ x: 40, y: 40, people: adults(4) }, { x: 48, y: 40, people: adults(4) }]);
    const [a, b] = [G(s, 1), G(s, 2)];
    b.languageId = a.languageId;
    a.culture[Culture.openness] = 100;
    expect(learnMult(a, b)).toBeCloseTo(1.5, 10);
  });

  it('kin who grew apart: trade and learning × 0.5, coexist −10; other lineages only with the switch on', () => {
    const s = world([{ x: 40, y: 40, people: adults(4) }, { x: 48, y: 40, people: adults(4) }]);
    const [a, b] = [G(s, 1), G(s, 2)];
    expect(a.languageId).not.toBe(b.languageId);            // every founder lineage has its own
    expect(learnMult(a, b)).toBe(1);                        // v1 already treats other lineages as strangers
    (SO as unknown as Record<string, boolean>).languageBetweenLineages = true;
    try { expect(learnMult(a, b)).toBeCloseTo(0.5, 10); } finally {
      (SO as unknown as Record<string, boolean>).languageBetweenLineages = false;
    }
    b.lineageId = a.lineageId;                              // one lineage, two languages
    expect(learnMult(a, b)).toBeCloseTo(0.5, 10);
    const base = { coopA: 50, coopB: 50, sameLineage: false, pA: 0.3, pB: 0.3, hA: 10, hB: 10, powerA: 10, powerB: 10, discoveriesDiffer: false };
    expect(decisionScores({ ...base, sameLanguage: false }).coexist).toBe(CONFIG.contact.coexistScore - 10);
  });

  it('after 500 years apart, one of two groups of a language grows its own', () => {
    const s = world([{ x: 20, y: 40, people: adults(20) }]);
    const g = G(s, 1);
    const far = spawnGroup(s, g, takeSlots(g, g.members.slice(0, 8)), at(140, 40));
    const lang = g.languageId;
    s.year = 500;
    languageDrift(s);
    expect(g.languageId).toBe(lang);                        // exactly 500 years: not yet
    s.year = 501;
    languageDrift(s);
    expect(g.languageId).not.toBe(lang);
    expect(far.languageId).toBe(lang);                      // the other keeps the old one
    expect(s.languages.find((l) => l.id === g.languageId)!.parentId).toBe(lang);
    expect(s.log.some((e) => e.type === 'society' && e.text.includes('its own language'))).toBe(true);
  });

  it('meeting keeps a language together', () => {
    const s = world([{ x: 40, y: 40, people: adults(20) }]);
    const g = G(s, 1);
    const near = spawnGroup(s, g, takeSlots(g, g.members.slice(0, 8)), at(50, 40));
    s.year = 600;
    yearlyContact(s);
    languageDrift(s);
    expect(g.languageId).toBe(near.languageId);
  });
});

describe('weapons and fortifications (§12.6)', () => {
  const owned = (g: Group, ...ids: number[]): void => { g.discoveries = maskOf(...ids); };

  it('the best weapon the group can equip: metal covers fighters at 0.1 a head, wood the rest', () => {
    const s = world([{ x: 40, y: 40, people: adults(4) }]);
    const g = G(s, 1);
    expect(weaponMult(g, 10)).toBe(1);
    owned(g, D.stoneTools, D.spear);
    expect(weaponMult(g, 10)).toBeCloseTo(1.1, 10);
    owned(g, D.stoneTools, D.spear, D.bow);
    expect(weaponMult(g, 10)).toBeCloseTo(1.2, 10);
    owned(g, D.stoneTools, D.spear, D.bow, D.pottery, D.copperWorking, D.ironWorking);
    g.metal = 1;                                            // covers all 10 fighters
    expect(weaponMult(g, 10)).toBeCloseTo(1.68, 10);
    g.metal = 0.5;                                          // half of them
    expect(weaponMult(g, 10)).toBeCloseTo((1.68 + 1.2) / 2, 10);
    g.metal = 0;
    expect(weaponMult(g, 10)).toBeCloseTo(1.2, 10);
    owned(g, D.pottery, D.copperWorking, D.bronzeWorking);
    g.metal = 5;
    expect(weaponMult(g, 10)).toBeCloseTo(1.5, 10);
  });

  it('a threatened group builds a palisade (200 wood), then a stone wall (500 stone)', () => {
    const s = world([{ x: 40, y: 40, people: adults(4) }], (m) => {
      m.resourceType[at(41, 40)] = Resource.Stone; m.resourceAmount[at(41, 40)] = 255;
      m.resourceType[at(42, 40)] = Resource.Stone; m.resourceAmount[at(42, 40)] = 255;
    });
    const g = G(s, 1);
    owned(g, D.stoneTools, D.spear, D.farming, D.palisade);
    g.wood = 250;
    buildFortifications(s, g);
    expect(g.fortification).toBe(0);                        // no threat, no wall
    g.underThreat = true;
    buildFortifications(s, g);
    expect(g.fortification).toBe(1);
    expect(g.wood).toBe(50);
    expect(fortMult(g)).toBe(1.3);
    owned(g, D.stoneTools, D.spear, D.farming, D.palisade, D.clothing, D.pottery, D.mudBrick, D.copperWorking, D.stoneBuilding);
    buildFortifications(s, g);
    expect(g.fortification).toBe(2);
    expect(fortMult(g)).toBe(1.8);
    expect(s.resourceAmount[at(41, 40)]! + s.resourceAmount[at(42, 40)]!).toBe(510 - 500);
  });

  it('the defender fights behind its walls', () => {
    let walled = 0, open = 0;
    for (let seed = 0; seed < 200; seed++) {
      for (const fort of [0, 2]) {
        const s = world([{ x: 40, y: 40, people: adults(30) }, { x: 48, y: 40, people: adults(30) }]);
        s.rng.set(createRng(1000 + seed));
        const [a, b] = [G(s, 1), G(s, 2)];
        a.hunger = 90;                                      // a attacks (more pressure); b defends
        b.fortification = fort;
        const r = battle(s, a, b);
        if (r.winner === b) { if (fort) walled++; else open++; }
      }
    }
    expect(open).toBeGreaterThan(60);
    expect(open).toBeLessThan(140);
    expect(walled).toBeGreaterThan(190);
  });

  it('stone houses: 2 wood and 30 stone with Stone Building', () => {
    const s = world([{ x: 40, y: 40, people: adults(4) }], (m) => {
      m.resourceType[at(41, 40)] = Resource.Stone; m.resourceAmount[at(41, 40)] = 100;
    });
    const g = G(s, 1);
    owned(g, D.stoneTools, D.farming, D.clothing, D.spear, D.pottery, D.mudBrick, D.copperWorking, D.stoneBuilding);
    g.wood = 3;
    expect(payBuilding(s, g, true)).toBe(true);
    expect(g.wood).toBe(1);
    expect(s.resourceAmount[at(41, 40)]).toBe(70);
  });
});

describe('raids and alliances (§12.7)', () => {
  it('a raid takes 20% of the store, and of the herd with Taming', () => {
    let wins = 0;
    for (let seed = 0; seed < 40; seed++) {
      const s = world([{ x: 40, y: 40, people: adults(30, 25, 90) }, { x: 48, y: 40, people: adults(6) }]);
      s.rng.set(createRng(1000 + seed));
      const [r, t] = [G(s, 1), G(s, 2)];
      r.discoveries = maskOf(D.taming);
      r.foodStock = 0;
      t.foodStock = 100;
      t.herd = 50;
      if (!raid(s, r, t)) { expect(t.foodStock).toBe(100); continue; }
      wins++;
      expect(t.foodStock).toBeCloseTo(80, 6);
      expect(r.foodStock).toBeCloseTo(20, 6);
      expect(t.herd).toBeCloseTo(40, 6);
      expect(r.herd).toBeCloseTo(10, 6);
      expect(t.underThreat).toBe(true);
      expect(s.log.at(-1)!.type).toBe('raid');
    }
    expect(wins).toBeGreaterThan(25);                       // the raiders are far stronger
  });

  it('two groups at peace facing a 2× stronger third ally, and their power adds up', () => {
    const s = world([
      { x: 40, y: 40, people: adults(10) }, { x: 48, y: 40, people: adults(10) }, { x: 44, y: 46, people: adults(60) },
    ]);
    const [a, b, c] = [G(s, 1), G(s, 2), G(s, 3)];
    s.relations = [{ a: 1, b: 2, kind: 'coexist', sinceYear: 0, reviewYear: 99, pa: 0, pb: 0, warPopA: 0, warPopB: 0, warDeadA: 0, warDeadB: 0, truceUntil: 0 }];
    updateAlliances(s, contactPairs(s));
    expect(s.alliances).toEqual([{ a: 1, b: 2, against: 3, sinceYear: 0, lastYear: 0 }]);
    expect(s.log.some((e) => e.type === 'alliance' && e.text === 'G1 and G2 allied against G3')).toBe(true);
    const together = forceOf(s, a).power + forceOf(s, b).power;
    const r = battle(s, a, c, [b], []);
    const effSide = r.winner === a ? r.effW : r.effL;
    expect(effSide / together).toBeGreaterThanOrEqual(0.8);
    expect(effSide / together).toBeLessThanOrEqual(1.2);
    expect(s.log.at(-1)!.text).toContain('(with G2)');
    // Not threatened by an equal: the alliance lasts allianceKeepYears more (DECISIONS 20.8), then ends.
    c.members = c.members.slice(0, 12);
    updateAlliances(s, contactPairs(s));
    expect(s.alliances).toHaveLength(1);
    s.year += CONFIG.future.society.allianceKeepYears;
    updateAlliances(s, contactPairs(s));
    expect(s.alliances).toEqual([]);
  });
});

describe('animals (§12.8)', () => {
  it('Plough + oxen: farm yield × (1 + 0.5 × share of fields with 2 oxen)', () => {
    const s = world([{ x: 40, y: 40, people: adults(4) }]);
    const g = G(s, 1);
    g.discoveries = maskOf(D.farming, D.taming, D.plough);
    g.farmTiles = [1, 2, 3, 4, 5];
    g.herd = 10;
    expect(ploughMult(g)).toBeCloseTo(1.5, 10);
    g.herd = 5;
    expect(ploughMult(g)).toBeCloseTo(1.25, 10);
    g.herd = 0;
    expect(ploughMult(g)).toBe(1);
  });

  it('a herded herd grows tamer 1% a year; a lost herd loses it', () => {
    const s = world([{ x: 40, y: 40, people: adults(4) }]);
    const g = G(s, 1);
    g.herd = 30;
    g.idleYears[Practice.herding] = 0;
    yearlySociety(s);
    yearlySociety(s);
    expect(g.domestication).toBeCloseTo(0.02, 10);
    g.idleYears[Practice.herding] = 3;                      // not herded this year
    yearlySociety(s);
    expect(g.domestication).toBeCloseTo(0.02, 10);
    g.herd = 0;
    yearlySociety(s);
    expect(g.domestication).toBe(0);
  });

  it('horses widen contact: 15 tiles apart, only with Riding', () => {
    const s = world([{ x: 40, y: 40, people: adults(4) }, { x: 55, y: 40, people: adults(4) }], (m) => {
      for (let y = 0; y < 90; y++) m.wall[at(100, y)] = WallType.Mountain;
    });
    expect(contactPairs(s)).toEqual([]);
    G(s, 1).discoveries = maskOf(D.taming, D.riding);
    expect(contactPairs(s).map(([a, b]) => [a.id, b.id])).toEqual([[1, 2]]);
  });
});
