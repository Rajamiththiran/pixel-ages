// PersonPool (§7.4): every band-mode person, struct-of-arrays. Capacity doubles when full;
// freed slots are reused, but person ids are never reused, so id order stays stable.

export interface PersonPool {
  capacity: number;
  nextId: number;
  free: number[];                // freed slots, reused last-in first-out
  slotOf: Map<number, number>;   // person id → slot, alive people only
  id: Int32Array;
  alive: Uint8Array;
  groupId: Int32Array;
  sex: Uint8Array;
  ageMonths: Uint16Array;
  motherId: Int32Array;          // -1 for founders
  fatherId: Int32Array;
  partnerId: Int32Array;         // -1 if none
  potInt: Float32Array; potCoop: Float32Array; potStr: Float32Array;
  actInt: Float32Array; actCoop: Float32Array; actStr: Float32Array;
  health: Float32Array;          // 0–100
  fed: Float32Array;             // last month's fed ratio 0–1
  nutrition: Float32Array;       // 12-month moving average of fed
  childFedSum: Float32Array;     // sum of monthly fed while age < 15
  childAdversity: Uint16Array;   // months as a child with war, plague or starving
  nursing: Uint8Array;           // months left before she can conceive again
  action: Uint8Array;            // Action id this month
  workTile: Int32Array;          // tile where they work this month
  skin: Uint8Array;              // 0–2, visual only
  hair: Uint8Array;              // 0–2, visual only
  injured: Uint8Array;           // 1 if hurt this month (no health regen this month)
}

type ArrayKey = {
  [K in keyof PersonPool]: PersonPool[K] extends ArrayBufferView ? K : never
}[keyof PersonPool];

/** Every per-person array, in a fixed order (used for growing, cloning and hashing). */
export const POOL_ARRAYS: readonly ArrayKey[] = [
  'id', 'alive', 'groupId', 'sex', 'ageMonths', 'motherId', 'fatherId', 'partnerId',
  'potInt', 'potCoop', 'potStr', 'actInt', 'actCoop', 'actStr',
  'health', 'fed', 'nutrition', 'childFedSum', 'childAdversity', 'nursing', 'action', 'workTile',
  'skin', 'hair', 'injured',
];

export function createPool(capacity = 64): PersonPool {
  // Free slots highest-first, so pop() hands out slot 0, 1, 2…
  const free: number[] = [];
  for (let s = capacity - 1; s >= 0; s--) free.push(s);
  return {
    capacity,
    nextId: 1,
    free,
    slotOf: new Map(),
    id: new Int32Array(capacity),
    alive: new Uint8Array(capacity),
    groupId: new Int32Array(capacity),
    sex: new Uint8Array(capacity),
    ageMonths: new Uint16Array(capacity),
    motherId: new Int32Array(capacity),
    fatherId: new Int32Array(capacity),
    partnerId: new Int32Array(capacity),
    potInt: new Float32Array(capacity), potCoop: new Float32Array(capacity), potStr: new Float32Array(capacity),
    actInt: new Float32Array(capacity), actCoop: new Float32Array(capacity), actStr: new Float32Array(capacity),
    health: new Float32Array(capacity),
    fed: new Float32Array(capacity),
    nutrition: new Float32Array(capacity),
    childFedSum: new Float32Array(capacity),
    childAdversity: new Uint16Array(capacity),
    nursing: new Uint8Array(capacity),
    action: new Uint8Array(capacity),
    workTile: new Int32Array(capacity),
    skin: new Uint8Array(capacity),
    hair: new Uint8Array(capacity),
    injured: new Uint8Array(capacity),
  };
}

function grow(p: PersonPool): void {
  const cap = p.capacity * 2;
  for (const k of POOL_ARRAYS) {
    const old = p[k];
    const next = new (old.constructor as new (n: number) => typeof old)(cap);
    next.set(old as never);
    (p as unknown as Record<string, ArrayBufferView>)[k] = next;
  }
  // Newly added slots are free, highest first so the lowest is handed out next.
  for (let s = cap - 1; s >= p.capacity; s--) p.free.push(s);
  p.capacity = cap;
}

/** Allocates a slot for a new person with a fresh id. All fields start at 0 except the ids. */
export function allocPerson(p: PersonPool): number {
  if (p.free.length === 0) grow(p);
  const slot = p.free.pop()!;
  for (const k of POOL_ARRAYS) p[k][slot] = 0;
  const id = p.nextId++;
  p.id[slot] = id;
  p.alive[slot] = 1;
  p.motherId[slot] = -1;
  p.fatherId[slot] = -1;
  p.partnerId[slot] = -1;
  p.workTile[slot] = -1;
  p.slotOf.set(id, slot);
  return slot;
}

/** Removes a person; their partner becomes single. The caller removes them from the group's member list. */
export function freePerson(p: PersonPool, slot: number): void {
  const partner = p.partnerId[slot]!;
  if (partner >= 0) {
    const ps = p.slotOf.get(partner);
    if (ps !== undefined) p.partnerId[ps] = -1;
  }
  p.slotOf.delete(p.id[slot]!);
  p.alive[slot] = 0;
  p.partnerId[slot] = -1;
  p.free.push(slot);
}

export function clonePool(p: PersonPool): PersonPool {
  const c = { ...p, free: p.free.slice(), slotOf: new Map(p.slotOf) } as PersonPool;
  for (const k of POOL_ARRAYS) (c as unknown as Record<string, ArrayBufferView>)[k] = p[k].slice();
  return c;
}

/** Age in whole years. */
export const ageYears = (p: PersonPool, slot: number): number => Math.floor(p.ageMonths[slot]! / 12);
