// C4 (pixel-ages-c4-plan.md, DECISIONS 21.x): chiefdoms and kingdoms on tiny worlds, in seconds.

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createMap } from '../src/editor/mapState';
import { Mode, Plant } from '../src/shared/ids';
import { Discovery, addBit } from '../src/shared/discoveries';
import type { FounderPerson } from '../src/shared/types';
import { createState, type Group, type Relation, type SimState } from '../src/sim/state';
import { population, removeGroups } from '../src/sim/people/groups';
import { toVillage } from '../src/sim/people/village';
import { conquer, yearlyContact } from '../src/sim/society/contact';
import { canHold, makeSubject, realmPower, sameRealm, unrestOf, yearlyRealms } from '../src/sim/society/realms';
import { runOf } from './fixtures';

const RC = CONFIG.realms;

function adults(n: number, strength = 50): FounderPerson[] {
  return Array.from({ length: n }, (_, k) => ({ sex: (k % 2) as 0 | 1, age: 20 + (k % 20), intelligence: 100, cooperation: 50, strength }));
}

/** Groups on forest land at the given homes, named G1, G2, …, all speaking one language. */
function world(homes: Array<{ x: number; y: number; people: FounderPerson[] }>): SimState {
  const m = createMap();
  m.plantType.fill(Plant.Forest);
  m.plantDensity.fill(255);
  const run = runOf(m, 4);
  run.founders = homes.map((h, k) => ({ id: k + 1, name: `G${k + 1}`, colorIndex: k, x: h.x, y: h.y, people: h.people }));
  const s = createState(run);
  for (const g of s.groups) { g.languageId = s.groups[0]!.languageId; g.hunger = 0; }
  return s;
}
const G = (s: SimState, id: number): Group => s.groups.find((g) => g.id === id)!;

/** A settled village (members become counts). */
const village = (s: SimState, g: Group): Group => { toVillage(s, g); return g; };
/** A village that can rule: a chief and working fields. */
function chiefdom(s: SimState, g: Group): Group {
  village(s, g);
  g.chief = true;
  addBit(g.discoveries, Discovery.farming);
  return g;
}

const rel = (a: number, b: number, kind: Relation['kind']): Relation =>
  ({ a, b, kind, sinceYear: 0, reviewYear: 99, pa: 0, pb: 0, warPopA: 0, warPopB: 0, warDeadA: 0, warDeadB: 0, truceUntil: 0 });

describe('becoming a subject (plan §4.1–4.2)', () => {
  it('a farming village with a chief keeps a settled village it beats: it stays, keeps its name and pays tribute', () => {
    const s = world([{ x: 40, y: 40, people: adults(40, 60) }, { x: 50, y: 40, people: adults(20, 40) }]);
    const a = chiefdom(s, G(s, 1));
    const b = village(s, G(s, 2));
    expect(conquer(s, a, b)).toBe(true);
    expect(b.overlordId).toBe(a.id);
    expect([b.homeX, b.homeY]).toEqual([50, 40]);
    expect(population(b)).toBe(18);                              // a tenth taken, not half
    expect(a.realmRank).toBe(1);
    expect(s.log.some((e) => e.type === 'realm' && e.text === 'G1 conquered G2: it now pays tribute (2 captured)')).toBe(true);
    expect(s.log.some((e) => e.type === 'realm' && /^G1 founded a chiefdom: 2 villages, \d+ people$/.test(e.text))).toBe(true);
    expect(sameRealm(a, b)).toBe(true);
  });

  it('no chief, no farming, a band, or out of range: driven off as before', () => {
    const s = world([{ x: 40, y: 40, people: adults(40, 60) }, { x: 50, y: 40, people: adults(20) }, { x: 40, y: 60, people: adults(20) }]);
    const a = chiefdom(s, G(s, 1));
    const band = G(s, 2);
    const far = village(s, G(s, 3));
    expect(canHold(s, a, band)).toBe(false);                     // bands can't be taxed
    expect(canHold(s, a, far)).toBe(false);                      // 20 tiles > 16
    village(s, band);
    expect(canHold(s, a, band)).toBe(true);
    a.chief = false;
    expect(canHold(s, a, band)).toBe(false);
    a.chief = true;
    addBit(a.inactive, Discovery.farming);
    expect(canHold(s, a, band)).toBe(false);
  });

  it('beating a ruler hands over its villages in range; the realm stays two levels deep', () => {
    const s = world([
      { x: 40, y: 40, people: adults(60, 60) }, { x: 50, y: 40, people: adults(30) },
      { x: 55, y: 45, people: adults(20) }, { x: 70, y: 40, people: adults(20) },
    ]);
    const big = chiefdom(s, G(s, 1));
    const mid = chiefdom(s, G(s, 2));
    const near = village(s, G(s, 3));
    const far = village(s, G(s, 4));
    makeSubject(s, mid, near);
    makeSubject(s, mid, far);
    expect(mid.realmRank).toBe(1);
    const r = makeSubject(s, big, mid);
    expect(r).toEqual({ taken: 1, freed: 1, founded: true });                // G4 is 30 tiles from G1
    expect([mid.overlordId, near.overlordId, far.overlordId]).toEqual([1, 1, -1]);
    expect(mid.realmRank).toBe(0);
  });
});

describe('inside a realm (plan §4.3)', () => {
  it('members never fight: a war between them becomes trade', () => {
    const s = world([{ x: 40, y: 40, people: adults(40) }, { x: 48, y: 40, people: adults(30) }]);
    const a = chiefdom(s, G(s, 1));
    const b = village(s, G(s, 2));
    s.relations = [rel(1, 2, 'war')];
    makeSubject(s, a, b);
    expect(s.relations[0]!.kind).toBe('trade');
    s.relations[0]!.kind = 'war';                                // even if something set it again
    yearlyContact(s);
    expect(s.relations[0]!.kind).toBe('trade');
    expect(s.log.some((e) => / beat |raided/.test(e.text))).toBe(false);
    expect(a.trading && b.trading).toBe(true);
  });

  it('tribute: a tenth of the store each year; a starving subject pays nothing and is fed instead', () => {
    const s = world([{ x: 40, y: 40, people: adults(60, 70) }, { x: 48, y: 40, people: adults(10, 30) }]);
    const a = chiefdom(s, G(s, 1));
    const b = village(s, G(s, 2));
    makeSubject(s, a, b);
    b.parentId = a.id;                                          // close kin: hardly any unrest
    a.foodStock = 0;
    b.foodStock = 100;
    yearlyRealms(s);
    expect(b.overlordId).toBe(a.id);
    expect(b.foodStock).toBeCloseTo(100 * (1 - RC.tributeShare));
    expect(a.foodStock).toBeCloseTo(100 * RC.tributeShare);
    expect(b.tributePaid).toBeCloseTo(100 * RC.tributeShare);
    a.foodStock = 200;
    b.foodStock = 0;
    b.hunger = RC.reliefHunger;
    yearlyRealms(s);
    if (b.overlordId === a.id) {
      expect(b.foodStock).toBeCloseTo(200 * RC.reliefShare);
      expect(b.tributePaid).toBe(0);
    }
  });

  it('realm-mates and the ruler fight beside a subject that is at war', () => {
    const s = world([{ x: 40, y: 40, people: adults(40) }, { x: 48, y: 40, people: adults(20) }, { x: 52, y: 46, people: adults(20) }]);
    const a = chiefdom(s, G(s, 1));
    const b = village(s, G(s, 2));
    makeSubject(s, a, b);
    s.relations = [rel(1, 2, 'trade'), { ...rel(2, 3, 'war'), warPopA: 20, warPopB: 20 }];
    G(s, 3).hungerPeak = 0;                                     // no raid instead of a battle
    b.hungerPeak = 0;
    yearlyContact(s);
    const fight = s.log.find((e) => / beat /.test(e.text));
    expect(fight?.text).toMatch(/^G2 \(with G1\) beat G3|^G3 beat G2 \(with G1\)/);
  });

  it('an outsider cannot absorb a subject; neighbours weigh the whole realm', () => {
    const s = world([{ x: 40, y: 40, people: adults(40) }, { x: 48, y: 40, people: adults(20) }]);
    const a = chiefdom(s, G(s, 1));
    const b = village(s, G(s, 2));
    const alone = realmPower(s, a);
    makeSubject(s, a, b);
    expect(realmPower(s, a)).toBeGreaterThan(alone);
    expect(realmPower(s, b)).toBe(realmPower(s, a));
  });
});

describe('unrest and revolt (plan §4.5)', () => {
  it('unrest: weak ruler, hunger, distance and language raise it; years in the realm, kin and a kingdom lower it', () => {
    const s = world([{ x: 40, y: 40, people: adults(40) }, { x: 44, y: 40, people: adults(20) }, { x: 54, y: 40, people: adults(20) }]);
    const a = chiefdom(s, G(s, 1));
    const near = village(s, G(s, 2));
    const far = village(s, G(s, 3));
    makeSubject(s, a, near);
    makeSubject(s, a, far);
    // Newly beaten: only a weak ruler can lose it.
    expect(unrestOf(s, near, a, 300, 100)).toBe(0);
    expect(unrestOf(s, near, a, 200, 100)).toBeCloseTo(RC.rebelWeak);
    near.subjectSince = far.subjectSince = -RC.cowedYears;          // past the cowed years …
    const asm = 1 - RC.assimilateCut * (RC.cowedYears / RC.assimilateYears);   // … which count toward assimilation
    expect(unrestOf(s, near, a, 300, 100)).toBeCloseTo(RC.rebelBase * asm);
    expect(unrestOf(s, near, a, 200, 100)).toBeCloseTo((RC.rebelBase + RC.rebelWeak) * asm);   // the rest is only 1×
    near.hunger = 50;
    expect(unrestOf(s, near, a, 300, 100)).toBeCloseTo((RC.rebelBase + RC.rebelHunger / 2) * asm);
    near.hunger = 0;
    // 14 tiles of 16: (0.875 − 0.5) × 2 = 0.75 of rebelFar.
    expect(unrestOf(s, far, a, 300, 100)).toBeCloseTo((RC.rebelBase + 0.75 * RC.rebelFar) * asm);
    near.languageId = 99;
    expect(unrestOf(s, near, a, 300, 100)).toBeCloseTo((RC.rebelBase + RC.rebelForeign) * asm);
    near.languageId = a.languageId;
    s.year = RC.assimilateYears;
    expect(unrestOf(s, near, a, 300, 100)).toBeCloseTo(RC.rebelBase * (1 - RC.assimilateCut));
    s.year = 0;
    a.realmRank = 2;
    expect(unrestOf(s, near, a, 300, 100)).toBeCloseTo(RC.rebelBase * asm * RC.kingdomRebelMult);
  });

  it('a revolt frees the village and starts a war of independence when they are in contact', () => {
    const s = world([{ x: 40, y: 40, people: adults(10) }, { x: 48, y: 40, people: adults(40, 70) }]);
    const a = chiefdom(s, G(s, 1));
    const b = village(s, G(s, 2));
    makeSubject(s, a, b);
    s.relations = [rel(1, 2, 'trade')];
    b.hunger = 55;                                             // weak ruler and a hungry subject
    let year = 0;
    while (b.overlordId >= 0 && year < 200) { s.year = ++year; yearlyRealms(s); }
    expect(b.overlordId).toBe(-1);
    expect(s.relations[0]!.kind).toBe('war');
    expect(s.relations[0]!.warPopB).toBe(population(b));
    expect(s.log.some((e) => e.text === 'G2 rebelled against G1')).toBe(true);
    // The ruler may win it back: the chiefdom ends only after graceYears without a village.
    const ended = (): boolean => s.log.some((e) => /^The chiefdom of G1 is no more$/.test(e.text));
    expect(ended()).toBe(false);
    s.relations = [];                                          // no war of independence to fight here
    for (let k = 0; k < RC.graceYears; k++) { s.year = ++year; yearlyRealms(s); }
    expect(ended()).toBe(true);
    expect(a.realmRank).toBe(0);
  });

  it('a ruler that loses its chief, or is gone, lets every village go, logged once', () => {
    const s = world([{ x: 40, y: 40, people: adults(40) }, { x: 48, y: 40, people: adults(20) }, { x: 40, y: 48, people: adults(20) }]);
    const a = chiefdom(s, G(s, 1));
    makeSubject(s, a, village(s, G(s, 2)));
    makeSubject(s, a, village(s, G(s, 3)));
    a.chief = false;
    yearlyRealms(s);
    expect(G(s, 2).overlordId).toBe(-1);
    expect(G(s, 3).overlordId).toBe(-1);
    expect(s.log.filter((e) => e.type === 'realm' && /fell apart|no more/.test(e.text)).map((e) => e.text))
      .toEqual(['The chiefdom of G1 fell apart: it lost its chief (2 villages went free)']);

    a.chief = true;
    makeSubject(s, a, G(s, 2));
    removeGroups(s, [a]);
    expect(G(s, 2).overlordId).toBe(-1);
    expect(s.log.some((e) => e.text === 'The chiefdom of G1 fell apart (1 village went free)')).toBe(true);
  });

  it('a subject whose ruler moved away goes free', () => {
    const s = world([{ x: 40, y: 40, people: adults(40) }, { x: 48, y: 40, people: adults(20) }]);
    const a = chiefdom(s, G(s, 1));
    const b = village(s, G(s, 2));
    makeSubject(s, a, b);
    a.homeX = 10;
    s.year = 5;                                               // not a daughter settling in its first year
    yearlyRealms(s);
    expect(b.overlordId).toBe(-1);
    expect(s.log.some((e) => e.text === 'G2 is beyond the reach of G1 now and pays no more tribute')).toBe(true);
  });
});

describe('ranks (plan §4.6)', () => {
  it('a kingdom needs Writing, a City, 3 villages and 1,000 people; it does not flap at the line', () => {
    const s = world([
      { x: 40, y: 40, people: adults(40) }, { x: 48, y: 40, people: adults(20) },
      { x: 40, y: 48, people: adults(20) }, { x: 32, y: 40, people: adults(20) },
    ]);
    const a = chiefdom(s, G(s, 1));
    const subs = [2, 3, 4].map((id) => village(s, G(s, id)));
    for (const g of subs) { makeSubject(s, a, g); g.parentId = a.id; }   // loyal kin
    addBit(a.discoveries, Discovery.writing);
    addBit(a.discoveries, Discovery.city);
    yearlyRealms(s);
    expect(a.realmRank).toBe(1);                                 // 100 people: too few
    a.village!.counts[2] = a.village!.counts[2]! + 1000;
    yearlyRealms(s);
    expect(a.realmRank).toBe(2);
    expect(s.log.some((e) => /^G1 became the Kingdom of G1: 4 villages, 1,\d{3} people$/.test(e.text))).toBe(true);
    removeGroups(s, [subs[2]!]);                                 // down to 2 villages: still a kingdom
    yearlyRealms(s);
    expect(a.realmRank).toBe(2);
  });
});

describe('submission (plan §4.2)', () => {
  it('a war-weary weaker village submits to a much stronger chiefdom instead of making peace', () => {
    const s = world([{ x: 40, y: 40, people: adults(80, 70) }, { x: 48, y: 40, people: adults(30, 40) }]);
    const a = chiefdom(s, G(s, 1));
    const b = village(s, G(s, 2));
    s.relations = [{ ...rel(1, 2, 'war'), warPopA: 80, warPopB: 30, warDeadB: 25 }];
    a.hungerPeak = 0;
    b.hungerPeak = 0;
    yearlyContact(s);
    expect(b.overlordId).toBe(a.id);                             // by conquest or by submitting
    expect(s.relations[0]!.kind).toBe('trade');
    expect(s.log.some((e) => e.type === 'realm' && /^G2 submitted to G1 after 1 year of war|^G1 conquered G2: it now pays tribute/.test(e.text))).toBe(true);
    expect(b.mode).toBe(Mode.Village);
  });
});
