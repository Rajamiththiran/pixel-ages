// F2 — inventions from practice (future blueprint §8.5). Hand-checked numbers from the §8 rules.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createMap } from '../src/editor/mapState';
import { Action, Hazard, Need, Plant, Practice, Species } from '../src/shared/ids';
import {
  DISCOVERIES, Discovery, MASK_WORDS, addBit, clearAll, has, idsOf, isEmpty, maskKey, maskOf, orInto, sameMask,
} from '../src/shared/discoveries';
import { createState, type SimState } from '../src/sim/state';
import { cloneState, hashState } from '../src/sim/serialize';
import { tick } from '../src/sim/tick';
import {
  discoveryChance, forgetUnused, learnLesson, lessonActive, practiceShare, rollDiscoveries, yearlyPractice,
} from '../src/sim/progress/discoveryRules';
import { addPractice, battlePractice, monthlyPractice } from '../src/sim/people/practice';
import { diffuse } from '../src/sim/society/contact';
import { exploreRange } from '../src/sim/people/explore';
import { farmToolMult, gatherCapOf, huntSuccess } from '../src/sim/people/foodJobs';
import { spoil } from '../src/sim/people/food';
import { at, fourPeople, runOf } from './fixtures';

const PR = CONFIG.future.practice;
const D = Discovery;

/** A forest world with one or two bands of `n` people. */
function world(n = 10, two = false, edit?: (m: ReturnType<typeof createMap>) => void): SimState {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  edit?.(m);
  const run = runOf(m);
  const people = n === 4 ? fourPeople() : Array.from({ length: n }, (_, k) => ({ sex: (k % 2) as 0 | 1, age: 25, intelligence: 100, cooperation: 50, strength: 50 }));
  run.founders = [{ id: 1, name: 'Oak', colorIndex: 0, x: 50, y: 40, people }];
  if (two) run.founders.push({ id: 2, name: 'Ash', colorIndex: 1, x: 54, y: 40, people });
  return createState(run);
}

describe('64-bit discovery sets (§5.3)', () => {
  it('v1 discoveries keep their ids; F2 ids go up to 39 in the second word', () => {
    expect([D.fire, D.stoneTools, D.spear, D.raft, D.clothing, D.taming, D.farming, D.pottery, D.boat, D.mudBrick,
      D.irrigation, D.wheel, D.riding, D.copperWorking, D.mining, D.cart, D.writing, D.ironWorking, D.city, D.bronzeWorking])
      .toEqual([...Array(20).keys()]);
    expect(MASK_WORDS).toBe(2);
    const m = maskOf(D.fire, D.sails, D.palisade);
    expect([...m]).toEqual([1, (1 << (D.sails - 32)) | (1 << (D.palisade - 32))]);
    expect(has(m, D.sails)).toBe(true);
    expect(has(m, D.stoneTools)).toBe(false);
    expect(idsOf(m)).toEqual([D.fire, D.palisade, D.sails]);
    addBit(m, 31);                                       // bit 31 must not turn the word negative
    expect(has(m, 31)).toBe(true);
    expect(m[0]).toBe(0x80000001);
    clearAll(m, maskOf(D.fire, D.sails));
    expect(idsOf(m)).toEqual([31, D.palisade]);
    const u = maskOf();
    orInto(u, m);
    expect(sameMask(u, m)).toBe(true);
    expect(maskKey(u)).toBe(`${0x80000000}.${1 << (D.palisade - 32)}`);
    expect(isEmpty(maskOf())).toBe(true);
  });

  it('keyframes and the hash cover discoveries, practice, needs and lessons', () => {
    const s = world();
    const g = s.groups[0]!;
    addBit(g.discoveries, D.sails);
    g.practice[Practice.hunting] = 12;
    g.lessons[Hazard.Outbreak] = 40;
    const c = cloneState(s);
    expect(hashState(c)).toBe(hashState(s));
    const cg = c.groups[0]!;
    expect(has(cg.discoveries, D.sails)).toBe(true);
    cg.practice[Practice.hunting] = 13;
    expect(g.practice[Practice.hunting]).toBe(12);       // deep copy
    expect(hashState(c)).not.toBe(hashState(s));
    cg.practice[Practice.hunting] = 12;
    cg.lessons[Hazard.Outbreak] = 41;
    expect(hashState(c)).not.toBe(hashState(s));
  });
});

describe('discovery chance with practice, need and lessons (§8.2)', () => {
  const base = { avgInt: 100, population: 25, fed12: 1, writing: false, teachBonus: 1 };
  const bow = DISCOVERIES[D.bow]!;                       // era 2: base 1.5%

  it('multiplies the v1 chance by (1 + practice share) × (1 + need) × lesson 3', () => {
    const v1 = discoveryChance(bow, base);
    expect(v1).toBeCloseTo(0.015, 12);
    expect(discoveryChance(bow, { ...base, practiceShare: 0.5 })).toBeCloseTo(v1 * 1.5, 12);
    expect(discoveryChance(bow, { ...base, need: 0.4 })).toBeCloseTo(v1 * 1.4, 12);
    expect(discoveryChance(bow, { ...base, lesson: true })).toBeCloseTo(v1 * 3, 12);
    expect(discoveryChance(bow, { ...base, practiceShare: 1, need: 1, lesson: true })).toBeCloseTo(v1 * 2 * 2 * 3, 12);
  });

  it('practice share = practice / (24 × population), at most 1, from the discovery\'s own activity', () => {
    const s = world();
    const g = s.groups[0]!;
    g.practice[Practice.hunting] = 120;                  // 10 people: 120 / 240 = 0.5
    expect(practiceShare(g, D.bow, 10)).toBeCloseTo(0.5, 12);
    expect(practiceShare(g, D.spear, 10)).toBeCloseTo(0.5, 12);
    expect(practiceShare(g, D.sickle, 10)).toBe(0);       // farming
    g.practice[Practice.hunting] = 1000;
    expect(practiceShare(g, D.bow, 10)).toBe(1);
  });

  it('each new discovery has an activity and the needs follow §8.2', () => {
    expect(DISCOVERIES[D.fire]!.need).toBe(Need.cold);
    expect(DISCOVERIES[D.clothing]!.need).toBe(Need.cold);
    expect(DISCOVERIES[D.farming]!.need).toBe(Need.hunger);
    expect(DISCOVERIES[D.palisade]!.need).toBe(Need.war);
    expect(DISCOVERIES[D.ironWorking]!.need).toBe(Need.war);
    expect(DISCOVERIES[D.fireSafety]!.need).toBe(Need.fires);
    expect(DISCOVERIES[D.firebreaks]!.need).toBe(Need.fires);
    expect(DISCOVERIES[D.drainage]!.need).toBe(Need.floods);
    expect(DISCOVERIES[D.levees]!.need).toBe(Need.floods);
    expect(DISCOVERIES[D.bow]!.practice).toBe(Practice.hunting);
    expect(DISCOVERIES[D.sickle]!.practice).toBe(Practice.farming);
    for (const d of DISCOVERIES.filter((x) => x.id >= 20)) expect(d.practice).toBeGreaterThanOrEqual(0);
  });

  it('a hunting group finds Bow far sooner than a group that never hunts (seeded trials)', () => {
    const yearsTo = (hunt: boolean): number => {
      let total = 0;
      for (let trial = 0; trial < 60; trial++) {
        const s = world(25);
        s.rng[0] = (s.rng[0]! + trial * 7919) >>> 0;
        s.rng[1] = (s.rng[1]! ^ Math.imul(trial + 1, 2654435761)) >>> 0;
        const g = s.groups[0]!;
        g.discoveries = maskOf(D.fire, D.stoneTools, D.spear);
        g.hasHunted = true;
        g.practice[Practice.hunting] = hunt ? PR.full * 25 : 0;
        let y = 0;
        while (!has(g.discoveries, D.bow) && y < 2000) { rollDiscoveries(s, g); y++; }
        total += y;
      }
      return total / 60;
    };
    const hunters = yearsTo(true);
    const others = yearsTo(false);
    expect(hunters).toBeLessThan(others * 0.7);           // ×2 chance → about half the wait
  });
});

describe('practice and needs month by month (§8.1)', () => {
  it('each worker adds a month to their job; Fire adds a quarter month of fire use each', () => {
    const s = world();
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.fire);
    const workers: Record<number, number> = { [Action.Hunt]: 3, [Action.Gather]: 5, [Action.CutWood]: 2 };
    monthlyPractice(s, g, (a) => workers[a] ?? 0, 10);
    expect(g.practice[Practice.hunting]).toBe(3);
    expect(g.practice[Practice.gathering]).toBe(5);
    expect(g.practice[Practice.woodWork]).toBe(2);
    expect(g.practice[Practice.fireUse]).toBeCloseTo(10 * PR.fireUseShare, 6);
    expect(g.practice[Practice.farming]).toBe(0);
  });

  it('a year rolls over: 2% fade, idle years count, needs become 0–1', () => {
    const s = world();
    const g = s.groups[0]!;
    addPractice(g, Practice.hunting, 100);
    g.idleYears[Practice.farming] = 7;
    for (let m = 0; m < 12; m++) { s.month = m; g.hunger = 50; monthlyPractice(s, g, () => 0, 10); }
    yearlyPractice(g);
    expect(g.practice[Practice.hunting]).toBeCloseTo(98, 4);
    expect(g.idleYears[Practice.hunting]).toBe(0);
    expect(g.idleYears[Practice.farming]).toBe(8);
    expect(g.needs[Need.hunger]).toBeCloseTo(0.5, 6);
    expect(g.needs[Need.cold]).toBeCloseTo(0.5, 6);       // a winter without fire
    // Next year nothing is practised: hunting counts one idle year.
    yearlyPractice(g);
    expect(g.idleYears[Practice.hunting]).toBe(1);
  });

  it('battles add fighting practice and the war need (10% lost = full)', () => {
    const s = world();
    const g = s.groups[0]!;
    battlePractice(g, 6, 1, 20);                          // 5% of 20 people
    yearlyPractice(g);
    expect(g.needs[Need.war]).toBeCloseTo(0.5, 6);
    expect(g.practice[Practice.fighting]).toBeCloseTo(6 * 0.98, 6);
  });
});

describe('lessons (§4.5)', () => {
  it('a lesson boosts its prevention discoveries for 30 years, then expires', () => {
    const s = world();
    const g = s.groups[0]!;
    s.year = 100;
    learnLesson(s, g, Hazard.Outbreak);
    expect(lessonActive(s, g, D.wells)).toBe(true);
    expect(lessonActive(s, g, D.sewers)).toBe(true);
    expect(lessonActive(s, g, D.bow)).toBe(false);
    s.year = 129;
    expect(lessonActive(s, g, D.wells)).toBe(true);
    s.year = 130;
    expect(lessonActive(s, g, D.wells)).toBe(false);
  });

  it('a planned plague teaches the outbreak lesson', () => {
    const m = createMap();
    const run = runOf(m);
    run.founders = [{ id: 1, name: 'Oak', colorIndex: 0, x: 50, y: 40, people: fourPeople() }];
    run.events = [{ kind: 'plague', at: { x: 50, y: 40 }, startYear: 0, strength: 50 }];
    const s = createState(run);
    tick(s);                                              // the plague starts in year 0
    expect(s.groups[0]!.lessons[Hazard.Outbreak]).toBe(CONFIG.future.lessons.years);
  });
});

describe('forgetting unused skills (§8.4)', () => {
  it('only discoveries whose activity was idle 50+ years are forgotten (5% a year)', () => {
    const s = world();
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.fire, D.stoneTools, D.spear, D.farming);
    g.idleYears[Practice.hunting] = 50;                   // Spear: hunting
    g.idleYears[Practice.gathering] = 0;                  // Fire, Stone Tools, Farming: gathering
    for (let y = 0; y < 400 && has(g.discoveries, D.spear); y++) forgetUnused(s, g);
    expect(has(g.discoveries, D.spear)).toBe(false);
    expect(idsOf(g.discoveries)).toEqual([D.fire, D.stoneTools, D.farming]);
    expect(s.log.some((e) => e.text === 'Oak forgot Spear (nobody practised hunting for 50 years)')).toBe(true);
  });

  it('49 idle years are not enough', () => {
    const s = world();
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.stoneTools, D.spear);
    g.idleYears[Practice.hunting] = 49;
    for (let y = 0; y < 400; y++) forgetUnused(s, g);
    expect(has(g.discoveries, D.spear)).toBe(true);
  });
});

describe('contact diffusion (§8.4)', () => {
  it('neighbours learn each other\'s discoveries, but only when they meet the requirements', () => {
    const s = world(10, true, (m) => { m.resourceType[at(55, 40)] = 1; m.resourceAmount[at(55, 40)] = 100; });
    const [a, b] = s.groups as [SimState['groups'][number], SimState['groups'][number]];
    a.discoveries = maskOf(D.fire, D.stoneTools, D.taming);
    for (let y = 0; y < 2000 && !(has(b.discoveries, D.fire) && has(b.discoveries, D.stoneTools)); y++) diffuse(s, a, b);
    expect(has(b.discoveries, D.fire)).toBe(true);        // forest is known
    expect(has(b.discoveries, D.stoneTools)).toBe(true);  // the stone deposit is in sight
    expect(has(b.discoveries, D.taming)).toBe(false);     // no herd animals anywhere
    expect(s.log.some((e) => e.text === 'Ash learned Fire from Oak')).toBe(true);
  });

  it('the chance is 2% × intelligence / 100 a year (× 0.5 between kin who grew apart, F6)', () => {
    const rate = (shareLanguage: boolean): number => {
      let learned = 0;
      for (let trial = 0; trial < 4000; trial++) {
        const s = world(10, true);
        s.rng[0] = (s.rng[0]! + trial * 104729) >>> 0;
        s.rng[1] = (s.rng[1]! ^ Math.imul(trial + 1, 2654435761)) >>> 0; // the first draw depends on word 1
        s.groups[0]!.discoveries = maskOf(D.fire);
        // One lineage; the second group either still speaks its language or has grown its own.
        s.groups[1]!.lineageId = s.groups[0]!.lineageId;
        if (shareLanguage) s.groups[1]!.languageId = s.groups[0]!.languageId;
        diffuse(s, s.groups[0]!, s.groups[1]!);
        if (has(s.groups[1]!.discoveries, D.fire)) learned++;
      }
      return learned / 4000;
    };
    const same = rate(true);
    expect(same).toBeGreaterThan(0.013);
    expect(same).toBeLessThan(0.027);
    const foreign = rate(false);
    expect(foreign).toBeGreaterThan(0.005);
    expect(foreign).toBeLessThan(0.0145);
  });
});

describe('new discovery effects (§8.3)', () => {
  it('Digging Stick gathers ×1.1, Bow ×1.3 and Dogs ×1.2 hunt, Sickle farms ×1.1', () => {
    const s = world();
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.stoneTools);
    const cap = gatherCapOf(g, 1);
    addBit(g.discoveries, D.diggingStick);
    expect(gatherCapOf(g, 1)).toBeCloseTo(cap * 1.1, 12);
    g.discoveries = maskOf(D.stoneTools);
    const hunt = huntSuccess(g, 0, 0);                    // 0.25: well below the 0.95 cap
    addBit(g.discoveries, D.bow);
    expect(huntSuccess(g, 0, 0)).toBeCloseTo(hunt * 1.3, 12);
    addBit(g.discoveries, D.dogs);
    expect(huntSuccess(g, 0, 0)).toBeCloseTo(hunt * 1.3 * 1.2, 12);
    g.discoveries = maskOf(D.farming);
    expect(farmToolMult(g)).toBe(1);
    addBit(g.discoveries, D.sickle);
    expect(farmToolMult(g)).toBeCloseTo(1.1, 12);
  });

  it('Salting: food spoils ×0.8; Sails: explore range ×1.5', () => {
    const s = world();
    const g = s.groups[0]!;
    g.discoveries = maskOf(D.salting);
    g.foodStock = 100;
    g.need = 100;                                         // one month of food: no pests
    spoil(s, g);
    expect(g.foodStock).toBeCloseTo(100 * (1 - 0.1 * 0.8), 6);
    g.discoveries = maskOf();
    const r = exploreRange(g);
    g.discoveries = maskOf(D.raft, D.stoneTools, D.boat, D.sails);
    expect(exploreRange(g)).toBeCloseTo(r * 1.5, 12);
  });

  it('Dogs need wolves found and a successful hunt', () => {
    const s = world(10, false, (m) => { m.animals[Species.Predator][at(51, 40)] = 100; });
    const g = s.groups[0]!;
    g.hasHunted = false;
    for (let y = 0; y < 3000; y++) rollDiscoveries(s, g);
    expect(has(g.discoveries, D.dogs)).toBe(false);
    g.hasHunted = true;
    for (let y = 0; y < 3000 && !has(g.discoveries, D.dogs); y++) rollDiscoveries(s, g);
    expect(has(g.discoveries, D.dogs)).toBe(true);
  });
});
