// Investigation (temporary): why Scenario A bands die out before year 100.
import { it } from 'vitest';
import { Sex } from '../../src/shared/ids';
import { createState } from '../../src/sim/state';
import { tick } from '../../src/sim/tick';
import { scenarioA } from '../fixtures';
import { CONFIG } from '../../src/config';

const env = (globalThis as any).process.env as Record<string, string | undefined>;

it('why', () => {
  for (const [k, v] of Object.entries(JSON.parse(env.OVERRIDES ?? '{}'))) { const ks = k.split('.'); let o: any = CONFIG; for (const x of ks.slice(0, -1)) o = o[x]; o[ks.at(-1)!] = v; }
  const lines: string[] = [];
  for (const seed of (env.SEEDS ?? '7').split(',').map(Number)) {
    const s = createState(scenarioA(seed));
    const p = s.persons;
    let hungry = 0, months = 0;
    lines.push(`=== seed ${seed}`);
    for (let m = 0; m < 120 * 12; m++) {
      tick(s);
      for (const g of s.groups) { months++; if (g.hunger > 60) hungry++; }
      if (s.month === 0 && s.year % 5 === 0) {
        const parts = s.groups.map((g) => {
          const ppl = g.members.map((x) => `${p.sex[x] === Sex.Male ? 'M' : 'F'}${Math.floor(p.ageMonths[x]! / 12)}${p.partnerId[x] !== -1 ? '*' : ''}`).join(' ');
          return `[${g.name} H${g.hunger.toFixed(0)} fed${g.fed12?.toFixed?.(2) ?? ''}: ${ppl}]`;
        });
        lines.push(`y${s.year} ${parts.join(' ')}`);
      }
      if (s.groups.length === 0) { lines.push(`extinct ${s.year}`); break; }
    }
    lines.push(`hungry months ${hungry}/${months}`);
    lines.push(s.log.slice(0, 30).map((e) => `${e.year} ${e.text}`).join(' | '));
  }
  (globalThis as any).process.getBuiltinModule('fs').writeFileSync(env.OUT ?? 'why.txt', lines.join('\n'));
}, 600000);
