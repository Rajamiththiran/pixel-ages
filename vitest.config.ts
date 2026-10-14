import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Simulation tests run hundreds of simulated years; give them room.
    testTimeout: 60000,
  },
});
