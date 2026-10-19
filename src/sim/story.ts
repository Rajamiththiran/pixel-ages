// Family tree and life story of one band person (future blueprint F7, §13). The worker keeps a
// recorder for the person the owner follows and calls `observe` after every live month: it only
// reads the state, so following someone never changes the run. Stories are kept for that one
// person only (memory); people who died or joined a village's counts keep their last story.

import { CONFIG } from '../config';
import { ACTION_NAMES, Action } from '../shared/ids';
import type { PersonStory } from '../shared/protocol';
import type { SimState } from './state';

const P = CONFIG.people;
const MAX_EVENTS = CONFIG.ui.storyMaxEvents;

export interface StoryRecorder {
  id: number;
  alive: boolean;
  groupId: number;
  groupName: string;
  partnerId: number;
  children: number[];            // ids of every child born while followed, or alive when following began
  actionMonths: Int32Array;      // this year's months per job
  lastJob: number;               // the main job of the last full year (−1 none yet)
  events: PersonStory['events'];
  version: number;               // +1 whenever the story changes
}

const name = (id: number): string => `#${id}`;

function add(rec: StoryRecorder, s: SimState, text: string): void {
  rec.events.push({ year: s.year, month: s.month, text });
  if (rec.events.length > MAX_EVENTS) rec.events.splice(1, 1);   // keep the birth line
  rec.version++;
}

/** Children of `id` alive now, in id order. */
function childrenOf(s: SimState, id: number): number[] {
  const p = s.persons;
  const out: number[] = [];
  for (const slot of p.slotOf.values()) if (p.motherId[slot] === id || p.fatherId[slot] === id) out.push(p.id[slot]!);
  return out.sort((a, b) => a - b);
}

/** Starts following person `id` (a living band person); null if there is no such person. */
export function startStory(s: SimState, id: number): StoryRecorder | null {
  const p = s.persons;
  const slot = p.slotOf.get(id);
  if (slot === undefined) return null;
  const g = s.groups.find((o) => o.id === p.groupId[slot]);
  const months = p.ageMonths[slot]!;
  const born = s.year * 12 + s.month - months;
  const rec: StoryRecorder = {
    id, alive: true, groupId: p.groupId[slot]!, groupName: g?.name ?? '?', partnerId: p.partnerId[slot]!,
    children: childrenOf(s, id), actionMonths: new Int32Array(ACTION_NAMES.length), lastJob: -1, events: [], version: 0,
  };
  const mother = p.motherId[slot]!;
  const father = p.fatherId[slot]!;
  const parents = mother >= 0 ? `, child of ${name(mother)} and ${name(father)}` : ' (a founder)';
  rec.events.push({ year: Math.floor(born / 12), month: ((born % 12) + 12) % 12, text: `Born${parents}` });
  add(rec, s, `Followed from here: ${Math.floor(months / 12)} years old, living with ${rec.groupName}`);
  return rec;
}

/** One live month later: record what changed. */
export function observe(rec: StoryRecorder, s: SimState): void {
  if (!rec.alive) return;
  const p = s.persons;
  const slot = p.slotOf.get(rec.id);
  if (slot === undefined) {
    rec.alive = false;
    const g = s.groups.find((o) => o.id === rec.groupId);
    if (g?.village) add(rec, s, `${rec.groupName} grew into a village: from here on they are one of its counted people`);
    else add(rec, s, `Died (${causeOfDeath(rec, s)})`);
    return;
  }
  const gid = p.groupId[slot]!;
  if (gid !== rec.groupId) {
    const g = s.groups.find((o) => o.id === gid);
    rec.groupId = gid;
    rec.groupName = g?.name ?? '?';
    add(rec, s, `Now lives with ${rec.groupName}`);
  }
  const partner = p.partnerId[slot]!;
  if (partner !== rec.partnerId) {
    if (rec.partnerId >= 0) add(rec, s, p.slotOf.has(rec.partnerId) ? `Parted from ${name(rec.partnerId)}` : `Partner ${name(rec.partnerId)} died`);
    if (partner >= 0) add(rec, s, `Paired with ${name(partner)}`);
    rec.partnerId = partner;
  }
  // New children are born into the parent's group: only its members need checking.
  const g = s.groups.find((o) => o.id === gid);
  for (const c of g?.members ?? []) {
    if ((p.motherId[c] === rec.id || p.fatherId[c] === rec.id) && !rec.children.includes(p.id[c]!)) {
      rec.children.push(p.id[c]!);
      add(rec, s, `Child ${name(p.id[c]!)} born (${p.sex[c] === 1 ? 'a girl' : 'a boy'})`);
    }
  }
  if (p.injured[slot]) add(rec, s, 'Hurt (a hunt or a predator)');
  if (p.ageMonths[slot] === P.ages.adult * 12) add(rec, s, 'Grew up: traits are now fixed');
  // Jobs: the main job of each year, noted when it changes.
  const action = p.action[slot]!;
  rec.actionMonths[action] = rec.actionMonths[action]! + 1;
  if (s.month === 0) {
    let best = -1, bestN = 0;
    for (let a = 0; a < rec.actionMonths.length; a++) {
      if (a === Action.Child || a === Action.None) continue;
      if (rec.actionMonths[a]! > bestN) { bestN = rec.actionMonths[a]!; best = a; }
    }
    if (best >= 0 && best !== rec.lastJob) add(rec, s, `Mostly worked at: ${ACTION_NAMES[best]!.toLowerCase()} (${bestN} months last year)`);
    if (best >= 0) rec.lastJob = best;
    rec.actionMonths.fill(0);
  }
}

/** Best guess from what the recorder last saw: a battle this month, starving, old age, injury, illness. */
function causeOfDeath(rec: StoryRecorder, s: SimState): string {
  const recent = s.log.slice(-50);
  if (recent.some((e) => e.year === s.year && (e.type === 'war' || e.type === 'raid') && (e.groupId === rec.groupId || e.otherId === rec.groupId))) {
    return 'probably in the fighting';
  }
  if (recent.some((e) => e.year === s.year && e.type === 'hazard' && e.groupId === rec.groupId)) return 'probably in the disaster';
  const last = rec.events.length;
  const age = Math.floor((s.year * 12 + s.month - (rec.events[0]!.year * 12 + rec.events[0]!.month)) / 12);
  if (age >= P.ages.elder) return `old age, ${age}`;
  if (last > 1 && rec.events[last - 1]!.text.startsWith('Hurt')) return `injuries, at ${age}`;
  return `illness or hunger, at ${age}`;
}

/** The story to send: family (parents, partner, children, siblings) and the recorded events. */
export function storyView(rec: StoryRecorder, s: SimState): PersonStory {
  const p = s.persons;
  const family: PersonStory['family'] = [];
  const person = (role: string, id: number, extra = ''): void => {
    if (id < 0) return;
    const slot = p.slotOf.get(id);
    const alive = slot !== undefined;
    const age = alive ? `, ${Math.floor(p.ageMonths[slot]! / 12)}` : '';
    family.push({ role, id, alive, text: `${name(id)}${alive ? `${age}` : ' (gone)'}${extra}` });
  };
  const slot = p.slotOf.get(rec.id);
  const mother = slot !== undefined ? p.motherId[slot]! : -1;
  const father = slot !== undefined ? p.fatherId[slot]! : -1;
  person('Mother', mother);
  person('Father', father);
  if (rec.alive) person('Partner', rec.partnerId);
  for (const c of rec.children) person('Child', c);
  if (mother >= 0) {
    for (const s2 of p.slotOf.values()) {
      const sid = p.id[s2]!;
      if (sid !== rec.id && p.motherId[s2] === mother) person('Sibling', sid);
    }
  }
  return { id: rec.id, alive: rec.alive, groupName: rec.groupName, family, events: rec.events.slice() };
}
