import { it } from 'vitest';
import { encodeRun, decodeRun } from '../../src/shared/save';
import { scenarioA, scenarioB, scenarioC, scenarioD } from '../../src/presets/scenarios';

const fs = (globalThis as any).process.getBuiltinModule('fs');
it('export presets', () => {
  const runs = [
    ['scenario-a-garden', scenarioA(1)],
    ['scenario-b-smart-desert-vs-rich-forest', scenarioB(48213)],
    ['scenario-c-collapse', scenarioC(1)],
    ['scenario-d-performance', scenarioD(1)],
  ] as const;
  for (const [file, run] of runs) {
    const text = encodeRun(run);
    decodeRun(text); // must load back
    fs.writeFileSync(`presets/${file}.run.json`, text);
  }
});
