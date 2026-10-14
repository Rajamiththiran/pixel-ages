import { describe, expect, it } from 'vitest';

// §16.2 rule 5 / §25: the simulation must not use non-deterministic or
// platform-dependent APIs. Scans every file under src/sim.
const FILES = import.meta.glob('../src/sim/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const FORBIDDEN = ['Math.random', 'Math.pow', 'Math.exp', 'Math.log', 'Math.sin', 'Math.cos', 'Date', 'performance.now'];

describe('forbidden-API scan of src/sim', () => {
  it('finds sim files', () => {
    expect(Object.keys(FILES).length).toBeGreaterThan(0);
  });

  for (const [path, source] of Object.entries(FILES)) {
    it(path, () => {
      for (const name of FORBIDDEN) {
        const re = new RegExp(`\\b${name.replace('.', '\\.')}\\b`);
        expect(re.test(source), `${path} uses ${name}`).toBe(false);
      }
    });
  }
});
