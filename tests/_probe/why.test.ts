// Investigation: forest loss, animal use, and early extinction in a typical painted world.
import { it } from 'vitest';
import { createMap } from '../../src/editor/mapState';
import { Action, ACTION_NAMES, Plant, Species } from '../../src/shared/ids';
import { createState } from '../../src/sim/state';
import { tick } from '../../src/sim/tick';
import { population } from '../../src/sim/people/groups';
import { runOf, fourPeople } from '../fixtures';

const SEED = Number((globalThis as any).process.env.SEED ?? 1);

it('why', () => {
  // Like a painted map: forest (density 255) on the west 100 columns at the default rain 50,
  // deer in the forest, goats and horses on the grassland east of it.
  const m = createMap();
  for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) {
    const i = y * 160 + x;
    if (x < 100) { m.plantType[i] = Plant.Forest; m.plantDensity[i] = 255; m.animals[Species.Prey][i] = 153; }
    else { m.animals[Species.Herd][i] = 128; m.animals[Species.Riding][i] = 102; }
  }
  const run = runOf(m, SEED);
  run.founders = [{ id: 1, name: 'Oak', colorIndex: 0, x: 95, y: 45, people: fourPeople() }];
  const s = createState(run);
  const count = (t: number): number => { let n = 0; for (let i = 0; i < s.plantType.length; i++) if (s.plantType[i] === t) n++; return n; };
  const acts = new Map<string, number>();
  let starvingMonths = 0, monthsWithPeople = 0;
  const lines: string[] = [];
  for (let month = 0; month < 300 * 12; month++) {
    tick(s);
    for (const g of s.groups) {
      if (g.village) continue;
      monthsWithPeople++;
      if (g.hunger > 60) starvingMonths++;
      for (const slot of g.members) {
        const a = ACTION_NAMES[s.persons.action[slot]!]!;
        if (s.persons.action[slot] !== Action.Child) acts.set(a, (acts.get(a) ?? 0) + 1);
      }
    }
    if (s.month === 0 && s.year % 25 === 0) {
      const pop = s.groups.reduce((n, g) => n + population(g), 0);
      const g = s.groups[0];
      lines.push(`y${s.year}: pop ${pop} groups ${s.groups.length} | forest ${count(Plant.Forest)} farmland ${count(Plant.Farmland)} grass ${count(Plant.Grass)} | `
        + (g ? `H ${g.hunger.toFixed(0)} PA ${g.plantAvail.toFixed(2)} YA ${g.preyAvail.toFixed(2)} crowd ${g.crowding.toFixed(2)} stock ${g.foodStock.toFixed(0)} need ${g.need.toFixed(1)} disc ${g.discoveries.toString(2)}` : ''));
    }
    if (s.groups.length === 0) { lines.push(`extinct at year ${s.year}`); break; }
  }
  const total = [...acts.values()].reduce((a, b) => a + b, 0);
  console.log(`SEED ${SEED}\n` + lines.join('\n'));
  console.log('adult months by action: ' + [...acts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / total).toFixed(0)}%`).join(', '));
  console.log(`band-months with H > 60: ${starvingMonths}/${monthsWithPeople}`);
  console.log(s.log.filter((e) => e.type !== 'split').slice(0, 25).map((e) => `${e.year} ${e.text}`).join(' | '));
}, 600000);
