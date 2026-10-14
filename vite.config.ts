import { defineConfig } from 'vite';

export default defineConfig({
  base: './',              // relative paths so the build works on itch.io
  worker: { format: 'es' },
});
