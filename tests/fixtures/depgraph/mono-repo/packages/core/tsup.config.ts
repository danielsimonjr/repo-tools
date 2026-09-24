import { defineConfig } from 'tsup';

export default defineConfig([
  { entry: ['src/index.ts'], format: ['esm'] },
  { entry: ['src/worker.ts'], format: ['esm'] },
]);
