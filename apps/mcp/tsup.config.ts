import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  clean: true,
  // gbfs-core is private: bundle it (with its catalog snapshot); SDK and zod stay npm dependencies.
  noExternal: ['@gbfs-france/core'],
});
