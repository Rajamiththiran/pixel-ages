import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Simulation tests run hundreds of simulated years, several files at once; give them room.
    testTimeout: 300000,
  },
});
