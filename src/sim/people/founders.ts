// Founder groups (§11.1): one band per placed group, at its home tile, knowing the tiles
// within radius 3 that are connected to home.

import { CONFIG } from '../../config';
import { int } from '../../shared/rng';
import type { SimState } from '../state';
import { allocPerson } from './persons';
import { addGroup, newGroup } from './groups';
import { revealAround } from './explore';
import { needOf } from './food';

const P = CONFIG.people;

export function createFounders(s: SimState): void {
  const founders = [...s.setup.founders].sort((a, b) => a.id - b.id);
  const p = s.persons;
  for (const f of founders) {
    s.lineages.push({ id: f.id, name: f.name, colorIndex: f.colorIndex, extinctYear: null, splitCounter: P.splitNameStart - 1 });
    const g = newGroup(s, f.id, f.name, f.id, f.x, f.y);
    // Every founder lineage speaks its own language (F6 §12.5, DECISIONS 13.6).
    const lang = s.nextLanguageId++;
    s.languages.push({ id: lang, name: f.name, parentId: -1, sinceYear: 0 });
    g.languageId = lang;
    for (const fp of f.people) {
      const slot = allocPerson(p);
      p.groupId[slot] = g.id;
      p.sex[slot] = fp.sex;
      p.ageMonths[slot] = Math.max(0, Math.round(fp.age * 12));
      p.potInt[slot] = p.actInt[slot] = fp.intelligence;
      p.potCoop[slot] = p.actCoop[slot] = fp.cooperation;
      p.potStr[slot] = p.actStr[slot] = fp.strength;
      p.health[slot] = P.health.max;
      p.fed[slot] = 1;
      p.nutrition[slot] = 1;
      // Founders' childhood so far is assumed well fed and calm.
      p.childFedSum[slot] = Math.min(p.ageMonths[slot]!, P.childMonths);
      p.workTile[slot] = f.y * s.width + f.x;
      p.skin[slot] = int(s.rng, 3);
      p.hair[slot] = int(s.rng, 3);
      g.members.push(slot);
    }
    revealAround(s, g, f.x, f.y, P.founderKnownRadius);
    let need = 0;
    for (const slot of g.members) need += needOf(p, slot);
    g.foodStock = need * P.founderFoodMonths;
    addGroup(s, g);
    s.nextGroupId = Math.max(s.nextGroupId, f.id + 1);
  }
}
